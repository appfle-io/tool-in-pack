// TIP · 녹음 (v1.22.0)
//
// 왜 이렇게 만들었나
//   단축키 한 번에 바로 녹음이 시작되고, **모듈 창을 닫아도** 녹음이 끊기지 않아야 한다.
//   그래서 녹음을 화면(모듈 창)이 아니라 **숨은 상주 창(recorder)** 이 맡는다. 이 창은 한 번
//   만들면 닫히지 않고(닫기 요청은 숨기기로 처리), 화면이 없어도 WebKit 의 음성 캡처가 계속 돈다.
//
//   · 녹음 알갱이는 2초마다 recorder 창이 Rust 로 보내고, Rust 가 곧바로 파일에 덧붙인다.
//     그래서 앱이 갑자기 꺼져도 그때까지의 소리가 파일에 남는다.
//   · 상태(녹음 중·일시정지·길이·파일 이름·음량)의 주인은 Rust 다. 노치 알약·반원·펼친 패널과
//     모듈 화면은 모두 `voice_status` 와 `tip://voice-state` 만 본다. 그래서 어느 창이 떠 있든
//     늘 같은 상태를 보여 준다.
//   · 파일은 ~/Music/TIP Recordings 에 `TIP 2026-11-26 22-30-05.m4a` 처럼 저장한다.
//     (Safari/WebKit 의 MediaRecorder 는 audio/mp4 를 만든다. 브라우저가 webm 만 만들면 .webm.)
//
//   마이크 권한: macOS 는 Hardened Runtime 앱에서 Entitlements 의
//   com.apple.security.device.audio-input 과 Info.plist 의 NSMicrophoneUsageDescription 이
//   없으면 권한 팝업조차 띄우지 않는다. 상태 확인·요청은 AVCaptureDevice 로 하고(설정 → 권한 탭),
//   실제 캡처는 recorder 창의 getUserMedia 가 맡는다(같은 앱 권한을 쓴다).

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// 녹음을 맡는 숨은 상주 창의 라벨 — capabilities/default.json 의 windows 목록에도 있다.
const RECORDER: &str = "recorder";
const RECORDER_W: f64 = 360.0;
const RECORDER_H: f64 = 240.0;

/// 전역 단축키 표에서 '녹음 시작/중지'를 가리키는 키.
/// 화면(js/feature-settings.js)의 VOICE_ACTION_KEY 와 같아야 한다.
pub const VOICE_ACTION_KEY: &str = "voice:record";

/// v1.29.0 — 대면 회의·화상 회의 모드의 단축키. 화면의 action key 와 같아야 한다.
pub const VOICE_INPERSON_KEY: &str = "voice:meeting-inperson";
pub const VOICE_ONLINE_KEY: &str = "voice:meeting-online";

/// v1.29.0 — 녹음 3모드.
///   Normal  일반 녹음(마이크만, 지금까지와 같다)
///   InPerson 대면 회의(마이크 → 화자 분리 + 받아 적기)
///   Online  화상 회의(마이크 '나' + macOS 시스템 오디오 '상대방' → 각각 받아 적기)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Normal,
    InPerson,
    Online,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Normal => "normal",
            Mode::InPerson => "inperson",
            Mode::Online => "online",
        }
    }

    fn parse(value: &str) -> Mode {
        match value.trim() {
            "inperson" | "인대면" | "meeting-inperson" | "voice:meeting-inperson" => Mode::InPerson,
            "online" | "화상" | "meeting-online" | "voice:meeting-online" => Mode::Online,
            _ => Mode::Normal,
        }
    }

    fn meeting(self) -> bool {
        matches!(self, Mode::InPerson | Mode::Online)
    }
}

/// 저장 폴더 이름 — ~/Music 아래.
const VOICE_DIR_NAME: &str = "TIP Recordings";
/// 이보다 짧은 파일은 '녹음 실패'로 보고 지운다(권한 거부 등으로 빈 파일만 남는 경우).
const VOICE_MIN_BYTES: u64 = 1024;

/// recorder 창이 화면을 열고 준비를 마쳤는지 — 준비 전에 보낸 명령은 pending 에 둔다.
static RECORDER_READY: AtomicBool = AtomicBool::new(false);
/// 마지막으로 음량 이벤트를 보낸 시각 — 초당 12번이면 파형처럼 보인다.
static LAST_LEVEL_AT: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Starting,
    Recording,
    Paused,
    Saving,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Starting => "starting",
            Phase::Recording => "recording",
            Phase::Paused => "paused",
            Phase::Saving => "saving",
        }
    }

    /// 녹음이 살아 있는 상태(중지해야 하는 상태).
    fn busy(self) -> bool {
        matches!(self, Phase::Starting | Phase::Recording | Phase::Paused | Phase::Saving)
    }
}

struct Voice {
    phase: Phase,
    /// v1.29.0 — 지금 모드(일반·대면·화상).
    mode: Mode,
    /// 마지막으로 (다시) 시작한 시각 — 멈춰 있는 동안에는 None.
    started_at: Option<Instant>,
    /// 멈추기 전까지 확정된 길이(ms).
    accumulated_ms: i64,
    /// 지금 쓰고 있는 파일.
    file: Option<PathBuf>,
    name: Option<String>,
    mime: String,
    level: f32,
    /// 마지막 오류 — 화면이 한 번 읽어 간다.
    error: Option<String>,
    /// 화상 회의 — 시스템 오디오(상대방) 파일과 그 도우미 프로세스.
    system: Option<PathBuf>,
    system_name: Option<String>,
    system_child: Option<Child>,
    /// 화면이 보여 줄 한 줄 안내(권한·엔진 등).
    notice: Option<String>,
    /// recorder 창이 준비되기 전에 보내 둘 명령("start" / "stop").
    pending: Option<&'static str>,
    bytes: u64,
}

impl Voice {
    const fn new() -> Self {
        Voice {
            phase: Phase::Idle,
            mode: Mode::Normal,
            started_at: None,
            accumulated_ms: 0,
            file: None,
            name: None,
            mime: String::new(),
            level: 0.0,
            error: None,
            system: None,
            system_name: None,
            system_child: None,
            notice: None,
            pending: None,
            bytes: 0,
        }
    }
}

static VOICE: Mutex<Voice> = Mutex::new(Voice::new());

fn lock() -> std::sync::MutexGuard<'static, Voice> {
    // 락이 깨져도 녹음은 계속되어야 한다 — 안쪽 값은 늘 유효한 구조체다.
    VOICE.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn elapsed_of(voice: &Voice) -> i64 {
    if voice.phase == Phase::Recording {
        voice.accumulated_ms
            + voice
                .started_at
                .map(|at| at.elapsed().as_millis() as i64)
                .unwrap_or(0)
    } else {
        voice.accumulated_ms
    }
}

/* ------------------------------ 저장 폴더 ------------------------------ */

/// ~/Music/TIP Recordings — 없으면 만든다.
fn folder(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .audio_dir()
        .ok()
        .or_else(|| app.path().home_dir().ok().map(|home| home.join("Music")))
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join(VOICE_DIR_NAME);
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 화면에 보여 줄 폴더(홈은 ~ 로 줄인다).
fn folder_label(app: &AppHandle) -> String {
    let dir = folder(app);
    let text = dir.to_string_lossy().to_string();
    match app.path().home_dir() {
        Ok(home) => {
            let home = home.to_string_lossy().to_string();
            text.replacen(&home, "~", 1)
        }
        Err(_) => text,
    }
}

/// 사용자가 고른 이름에서 파일 이름으로 쓸 수 없는 글자만 걷어낸다.
fn safe_base(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '\0' => '-',
            _ => ch,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "TIP 녹음".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// mime → 확장자. WebKit 은 audio/mp4(=.m4a), Chromium 은 audio/webm.
fn ext_for(mime: &str) -> &'static str {
    let value = mime.to_ascii_lowercase();
    if value.contains("mp4") || value.contains("aac") || value.contains("m4a") {
        "m4a"
    } else if value.contains("ogg") {
        "ogg"
    } else if value.contains("wav") {
        "wav"
    } else {
        "webm"
    }
}

/// 이름 하나가 이 폴더의 파일인지 — 경로 구분자·상위 이동을 막는다.
fn checked_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let value = name.trim();
    if value.is_empty() || value.len() > 160 {
        return Err("파일 이름이 올바르지 않습니다".into());
    }
    if value.contains('/') || value.contains('\\') || value.contains("..") || value.starts_with('.') {
        return Err("파일 이름이 올바르지 않습니다".into());
    }
    let lower = value.to_ascii_lowercase();
    if !(lower.ends_with(".m4a")
        || lower.ends_with(".mp4")
        || lower.ends_with(".webm")
        || lower.ends_with(".ogg")
        || lower.ends_with(".wav"))
    {
        return Err("녹음 파일이 아닙니다".into());
    }
    Ok(folder(app).join(value))
}

/* ------------------------------ 상태 알리기 ------------------------------ */

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceState {
    status: String,
    elapsed_ms: i64,
    level: f64,
    name: Option<String>,
    mime: String,
    error: Option<String>,
    dir: String,
    bytes: u64,
    /// v1.29.0 — normal | inperson | online.
    mode: String,
    /// 화상 회의의 시스템 오디오 파일 이름.
    partner: Option<String>,
    /// 화면에 보여 줄 안내 한 줄(권한·엔진).
    notice: Option<String>,
}

fn snapshot(app: &AppHandle) -> VoiceState {
    let voice = lock();
    VoiceState {
        status: voice.phase.as_str().to_string(),
        elapsed_ms: elapsed_of(&voice),
        level: voice.level as f64,
        name: voice.name.clone(),
        mime: voice.mime.clone(),
        error: voice.error.clone(),
        dir: folder_label(app),
        bytes: voice.bytes,
        mode: voice.mode.as_str().to_string(),
        partner: voice.system_name.clone(),
        notice: voice.notice.clone(),
    }
}

/// 모든 창(노치·모듈·메인)에 지금 상태를 알린다.
fn emit_state(app: &AppHandle) {
    let _ = app.emit("tip://voice-state", snapshot(app));
}

fn toast(app: &AppHandle, message: &str) {
    let _ = app.emit("tip://toast", message.to_string());
}

/* ------------------------------ recorder 창 ------------------------------ */

/// 숨은 상주 창을 만든다. 한 번 만들면 앱이 끝날 때까지 살아 있고, 닫기(X)는 숨기기로 바꾼다.
fn ensure_recorder(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(RECORDER).is_some() {
        return Ok(());
    }
    RECORDER_READY.store(false, Ordering::Relaxed);

    let win = WebviewWindowBuilder::new(app, RECORDER, WebviewUrl::App("recorder.html".into()))
        .title("TIP 녹음")
        .inner_size(RECORDER_W, RECORDER_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|error| format!("녹음 창을 만들지 못했습니다: {error}"))?;

    // 창을 실제로 닫으면 녹음이 사라진다 — 닫기는 숨기기로.
    let handle = win.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = handle.hide();
        }
    });
    Ok(())
}

/// recorder 창에 명령을 보낸다. 창이 아직 준비 전이면 pending 에 담아 두었다가 준비되면 보낸다.
fn send_cmd(app: &AppHandle, action: &'static str) {
    if !RECORDER_READY.load(Ordering::Relaxed) {
        lock().pending = Some(action);
        return;
    }
    if app
        .emit_to(RECORDER, "tip://voice-cmd", action)
        .is_err()
    {
        lock().pending = Some(action);
    }
}

/// pending 명령을 지금 보낸다(recorder 창이 준비를 알렸을 때).
fn flush_pending(app: &AppHandle) {
    let action = lock().pending.take();
    if let Some(action) = action {
        let _ = app.emit_to(RECORDER, "tip://voice-cmd", action);
    }
}

/* ------------------------------ 시작·중지 ------------------------------ */

fn begin(app: &AppHandle, mode: Mode) -> Result<(), String> {
    {
        let mut voice = lock();
        if voice.phase.busy() {
            return Ok(());
        }
        // 지난번 화상 회의의 시스템 오디오 도우미가 남아 있으면 먼저 끝낸다.
        if let Some(mut child) = voice.system_child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        voice.phase = Phase::Starting;
        voice.mode = mode;
        voice.started_at = None;
        voice.accumulated_ms = 0;
        voice.file = None;
        voice.name = None;
        voice.mime = String::new();
        voice.level = 0.0;
        voice.error = None;
        voice.system = None;
        voice.system_name = None;
        voice.notice = None;
        voice.bytes = 0;
        voice.pending = Some("start");
    }
    emit_state(app);

    if let Err(error) = ensure_recorder(app) {
        let mut voice = lock();
        voice.phase = Phase::Idle;
        voice.pending = None;
        voice.error = Some(error.clone());
        drop(voice);
        emit_state(app);
        toast(app, &error);
        return Err(error);
    }
    send_cmd(app, "start");

    // 창이 열렸는데 화면이 명령을 받지 못한 채 시작 상태로 남으면 되돌린다(12초).
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(12));
        let mut voice = lock();
        if voice.phase == Phase::Starting {
            voice.phase = Phase::Idle;
            voice.pending = None;
            voice.error = Some("녹음을 시작하지 못했습니다".into());
            drop(voice);
            emit_state(&handle);
            toast(&handle, "녹음을 시작하지 못했습니다");
        }
    });

    Ok(())
}

fn finish(app: &AppHandle) {
    // 아직 마이크를 열기 전(Starting)에 중지를 누르면 녹음 없이 조용히 되돌린다.
    if lock().phase == Phase::Starting {
        {
            let mut voice = lock();
            voice.phase = Phase::Idle;
            voice.pending = None;
            voice.started_at = None;
            voice.accumulated_ms = 0;
            voice.error = None;
        }
        send_cmd(app, "stop");
        emit_state(app);
        return;
    }
    let (name, bytes, mime) = {
        let mut voice = lock();
        if voice.phase == Phase::Idle {
            return;
        }
        if voice.phase == Phase::Recording {
            voice.accumulated_ms = elapsed_of(&voice);
            voice.started_at = None;
        }
        voice.phase = Phase::Saving;
        voice.level = 0.0;
        (voice.name.clone(), voice.bytes, voice.mime.clone())
    };
    emit_state(app);

    // recorder 창이 마지막 조각을 보내고 voice_finished 를 부르면 그때 마무리한다.
    // 8초 안에 오지 않으면(창이 얼어붙은 경우) 파일 상태 그대로 마무리한다.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8));
        if lock().phase == Phase::Saving {
            finalize(&handle, false);
        }
    });

    // 창이 아직 준비 전이면 stop 도 pending 으로 — 준비되면 바로 멈춘다.
    send_cmd(app, "stop");
    let _ = (name, bytes, mime);
}

/// 저장을 마무리한다 — 빈 파일은 지우고, 아니면 목록에 남긴다.
fn finalize(app: &AppHandle, from_page: bool) {
    // 화상 회의의 시스템 오디오(상대방)는 여기서 닫는다 — 파일 헤더까지 마무리된 다음에 읽어야 한다.
    stop_system(app);
    let (name, file, bytes, mode) = {
        let mut voice = lock();
        if voice.phase != Phase::Saving {
            return;
        }
        voice.phase = Phase::Idle;
        voice.pending = None;
        let mode = voice.mode;
        (voice.name.clone(), voice.file.clone(), voice.bytes, mode)
    };

    let mut error = None;
    if bytes < VOICE_MIN_BYTES {
        if let Some(path) = file.as_deref() {
            let _ = fs::remove_file(path);
        }
        let mut voice = lock();
        voice.name = None;
        voice.file = None;
        error = Some("녹음된 소리가 없습니다(마이크 권한을 확인해 주세요)".to_string());
    }
    if let Some(error) = &error {
        lock().error = Some(error.clone());
    }
    emit_state(app);
    if let Some(error) = error {
        toast(app, &error);
        return;
    }
    if from_page {
        if let Some(name) = name.clone() {
            toast(app, &format!("녹음을 저장했습니다: {name}"));
        }
    }
    // v1.29.0 — 회의 모드는 저장 직후 화자 분리·받아 적기를 이어서 돌린다.
    if let Some(name) = name {
        if mode.meeting() {
            start_job(app, name, mode);
        }
    }
}

/* ------------------------------ 화면이 부르는 커맨드 ------------------------------ */

/// recorder 창이 화면을 열고 명령을 들을 준비를 마쳤다.
#[tauri::command]
pub fn voice_ready(app: AppHandle) {
    RECORDER_READY.store(true, Ordering::Relaxed);
    flush_pending(&app);
}

/// 지금 녹음 상태 — 노치·모듈·메인이 함께 본다.
#[tauri::command]
pub fn voice_status(app: AppHandle) -> VoiceState {
    snapshot(&app)
}

/// 녹음 시작(단축키·모듈 버튼). 이미 녹음 중이면 그대로 둔다.
#[tauri::command]
pub fn voice_start(app: AppHandle, mode: Option<String>) -> Result<VoiceState, String> {
    let mode = mode.map(|value| Mode::parse(&value)).unwrap_or(Mode::Normal);
    begin(&app, mode)?;
    Ok(snapshot(&app))
}

/// 단축키 토글 — 녹음 중이 아니면 시작, 녹음 중이면 중지·저장.
#[tauri::command]
pub fn voice_toggle(app: AppHandle, mode: Option<String>) -> Result<VoiceState, String> {
    let requested = mode.map(|value| Mode::parse(&value)).unwrap_or(Mode::Normal);
    let phase = lock().phase;
    if phase == Phase::Idle {
        begin(&app, requested)?;
    } else {
        finish(&app);
    }
    Ok(snapshot(&app))
}

/// 일시정지 — 길이를 확정하고 recorder 창에 멈추라고 알린다.
#[tauri::command]
pub fn voice_pause(app: AppHandle) -> VoiceState {
    {
        let mut voice = lock();
        if voice.phase == Phase::Recording {
            voice.accumulated_ms = elapsed_of(&voice);
            voice.started_at = None;
            voice.phase = Phase::Paused;
            voice.level = 0.0;
        }
    }
    send_cmd(&app, "pause");
    emit_state(&app);
    snapshot(&app)
}

/// 이어서 녹음.
#[tauri::command]
pub fn voice_resume(app: AppHandle) -> VoiceState {
    {
        let mut voice = lock();
        if voice.phase == Phase::Paused {
            voice.started_at = Some(Instant::now());
            voice.phase = Phase::Recording;
        }
    }
    send_cmd(&app, "resume");
    emit_state(&app);
    snapshot(&app)
}

/// 중지 & 저장.
#[tauri::command]
pub fn voice_stop(app: AppHandle) -> VoiceState {
    finish(&app);
    snapshot(&app)
}

/// recorder 창 — 실제로 녹음이 시작됐다(mime·파일 이름 뼈대).
#[tauri::command]
pub fn voice_started(app: AppHandle, mime: String, file_name: String) -> Result<(), String> {
    let ext = ext_for(&mime);
    let online = lock().mode == Mode::Online;
    // 화상 회의는 마이크 트랙이 '나' — 시스템 오디오('상대방')와 짝을 이루게 이름을 나눈다.
    let mut base = safe_base(&file_name);
    if online {
        base = format!("{base} (나)");
    }
    let dir = folder(&app);
    let path = dir.join(format!("{base}.{ext}"));

    // 같은 이름이 이미 있으면 뒤에 숫자를 붙인다.
    let mut path = path;
    let mut index = 2;
    while path.exists() {
        path = dir.join(format!("{base} {index}.{ext}"));
        index += 1;
        if index > 99 {
            break;
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("녹음 파일을 만들지 못했습니다: {error}"))?;

    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    {
        let mut voice = lock();
        voice.phase = Phase::Recording;
        voice.started_at = Some(Instant::now());
        voice.accumulated_ms = 0;
        voice.file = Some(path);
        voice.name = Some(name);
        voice.mime = mime;
        voice.bytes = 0;
        voice.error = None;
        voice.pending = None;
    }
    emit_state(&app);
    // 화상 회의 — 마이크가 열린 뒤에 시스템 오디오(상대방) 담기를 시작한다.
    if online {
        if let Err(error) = start_system(&app) {
            let mut voice = lock();
            voice.notice = Some(error.clone());
            drop(voice);
            emit_state(&app);
        }
    }
    Ok(())
}

/// recorder 창 — 녹음 알갱이(base64). 곧바로 파일 끝에 덧붙인다.
#[tauri::command]
pub fn voice_chunk(_app: AppHandle, data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|error| format!("녹음 조각을 읽지 못했습니다: {error}"))?;
    if bytes.is_empty() {
        return Ok(());
    }
    let path = {
        let voice = lock();
        if voice.phase != Phase::Recording && voice.phase != Phase::Saving {
            // 멈춘 뒤 늦게 온 조각은 버린다.
            return Ok(());
        }
        voice.file.clone()
    };
    let Some(path) = path else { return Ok(()) };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("녹음 파일에 쓰지 못했습니다: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("녹음 파일에 쓰지 못했습니다: {error}"))?;
    lock().bytes += bytes.len() as u64;
    Ok(())
}

/// recorder 창 — 지금 음량(0~1). 화면 파형을 위해 초당 12번까지 알린다.
#[tauri::command]
pub fn voice_level(app: AppHandle, level: f64) {
    let value = if level.is_finite() {
        (level as f32).clamp(0.0, 1.0)
    } else {
        0.0
    };
    {
        let mut voice = lock();
        if voice.phase != Phase::Recording {
            return;
        }
        voice.level = value;
    }
    let send = {
        let Ok(mut slot) = LAST_LEVEL_AT.lock() else { return };
        let now = Instant::now();
        let due = slot.map(|at| now.duration_since(at).as_millis() >= 80).unwrap_or(true);
        if due {
            *slot = Some(now);
        }
        due
    };
    if send {
        let _ = app.emit("tip://voice-level", value as f64);
    }
}

/// recorder 창 — 저장을 마쳤다(마지막 조각까지 파일에 들어간 뒤).
#[tauri::command]
pub fn voice_finished(app: AppHandle) {
    finalize(&app, true);
}

/// recorder 창 — 시작·저장이 실패했다.
#[tauri::command]
pub fn voice_failed(app: AppHandle, message: String) {
    let text = if message.trim().is_empty() {
        "녹음을 하지 못했습니다".to_string()
    } else {
        message
    };
    {
        let mut voice = lock();
        if let Some(path) = voice.file.take() {
            let _ = fs::remove_file(path);
        }
        voice.phase = Phase::Idle;
        voice.started_at = None;
        voice.accumulated_ms = 0;
        voice.level = 0.0;
        voice.pending = None;
        voice.bytes = 0;
        voice.error = Some(text.clone());
    }
    emit_state(&app);
    toast(&app, &text);
}

/* ------------------------------ 저장한 녹음 ------------------------------ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceFile {
    name: String,
    size: u64,
    /// 파일을 만든 시각(epoch ms).
    created: i64,
}

/// 저장 폴더의 녹음 목록 — 최근 것이 먼저.
#[tauri::command]
pub fn voice_list(app: AppHandle) -> Vec<VoiceFile> {
    let dir = folder(&app);
    let mut items: Vec<VoiceFile> = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return items;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".m4a")
            || lower.ends_with(".mp4")
            || lower.ends_with(".webm")
            || lower.ends_with(".ogg")
            || lower.ends_with(".wav"))
        {
            continue;
        }
        let meta = entry.metadata().ok();
        let size = meta.as_ref().map(|value| value.len()).unwrap_or(0);
        let created = meta
            .and_then(|value| value.created().or_else(|_| value.modified()).ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as i64)
            .unwrap_or(0);
        items.push(VoiceFile { name, size, created });
    }
    items.sort_by(|a, b| b.created.cmp(&a.created));
    items
}

/// 녹음 하나를 소리로 재생할 수 있게 바이트로 돌려준다(화면이 Blob 으로 만든다).
#[tauri::command]
pub fn voice_read(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let path = checked_path(&app, &name)?;
    let bytes = fs::read(&path).map_err(|error| format!("녹음 파일을 읽지 못했습니다: {error}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 녹음 하나를 지운다 — 화상 회의의 상대방 트랙과 대화록(.json·.txt)도 함께.
#[tauri::command]
pub fn voice_delete(app: AppHandle, name: String) -> Result<(), String> {
    let path = checked_path(&app, &name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("녹음 파일을 지우지 못했습니다: {error}"))?;
    }
    // 같은 이름 뼈대의 대화록·상대방 트랙은 남겨 두면 고아 파일이 된다.
    if let Ok((json, text)) = transcript_files(&app, &name) {
        let _ = fs::remove_file(json);
        let _ = fs::remove_file(text);
    }
    if let Ok(base) = base_stem(&name) {
        let partner = folder(&app).join(format!("{base} (상대방).wav"));
        let _ = fs::remove_file(partner);
    }
    Ok(())
}

/// Finder 에서 녹음 파일을 보여 준다.
#[tauri::command]
pub fn voice_reveal(app: AppHandle, name: String) -> Result<(), String> {
    let path = checked_path(&app, &name)?;
    if !path.exists() {
        return Err("녹음 파일이 없습니다".into());
    }
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Finder 를 열지 못했습니다: {error}"))
}

/* ------------------------------ 마이크 권한 ------------------------------ */

/* ------------------------------ 마이크 권한 ------------------------------ */

// AVCaptureDevice 는 AVFoundation 프레임워크에 있다. 이 크레이트가 AVFoundation 을 직접 링크하지
// 않으면(다른 objc2 크레이트는 Foundation·AppKit 만 쓴다) dyld 가 프레임워크를 올리지 않아
// 런타임 클래스 조회가 실패한다 — 그러면 권한 상태가 늘 'unknown' 이 된다.
#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicStatus {
    /// notDetermined | restricted | denied | authorized | unknown
    status: String,
    /// 화면에 그대로 보여 줄 한 줄.
    label: String,
}

/// AVCaptureDevice 의 마이크 권한 상태 — 0 미정, 1 제한, 2 거부, 3 허용.
#[cfg(target_os = "macos")]
fn authorization_status() -> i64 {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    let Some(device) = AnyClass::get(c"AVCaptureDevice") else {
        return -1;
    };
    let media = NSString::from_str("soun");
    // SAFETY: AVCaptureDevice 의 클래스 메서드(+authorizationStatusForMediaType:)를
    // AVMediaTypeAudio 문자열로 부른다. NSInteger 를 돌려준다.
    let status: isize = unsafe { msg_send![device, authorizationStatusForMediaType: &*media] };
    status as i64
}

#[cfg(not(target_os = "macos"))]
fn authorization_status() -> i64 {
    -1
}

fn mic_label(status: i64) -> (&'static str, &'static str) {
    match status {
        0 => ("notDetermined", "아직 묻지 않음 — 녹음을 처음 시작할 때 macOS 가 묻습니다"),
        1 => ("restricted", "이 Mac 에서는 마이크를 쓸 수 없게 막혀 있습니다"),
        2 => ("denied", "거부됨 — 시스템 설정에서 TIP 의 마이크를 켜 주세요"),
        3 => ("authorized", "허용됨"),
        _ => ("unknown", "확인하지 못했습니다"),
    }
}

/// 설정 → 권한 탭의 마이크 상태.
#[tauri::command]
pub fn voice_mic_status() -> MicStatus {
    let (status, label) = mic_label(authorization_status());
    MicStatus {
        status: status.to_string(),
        label: label.to_string(),
    }
}

/// 마이크 권한을 묻는다(아직 묻지 않았을 때). 결과는 tip://voice-mic 으로 알린다.
#[tauri::command]
pub fn voice_mic_request(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use block2::RcBlock;
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, Bool};
        use objc2_foundation::NSString;

        let Some(device) = AnyClass::get(c"AVCaptureDevice") else {
            toast(&app, "마이크 권한을 확인하지 못했습니다");
            return;
        };
        let media = NSString::from_str("soun");
        let handle = app.clone();
        let done = RcBlock::new(move |granted: Bool| {
            let ok = granted == Bool::YES;
            let _ = handle.emit("tip://voice-mic", ok);
            if ok {
                toast(&handle, "마이크를 쓸 수 있습니다");
            } else {
                toast(&handle, "마이크 권한이 거부되었습니다 — 시스템 설정에서 켜 주세요");
            }
        });
        // SAFETY: 클래스 메서드(+requestAccessForMediaType:completionHandler:)에
        // AVMediaTypeAudio 문자열과 완료 블록을 넘긴다. AppKit 이 블록을 복사해 보관한다.
        let _: () = unsafe {
            msg_send![device, requestAccessForMediaType: &*media, completionHandler: &*done]
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        toast(&app, "마이크 권한은 Mac 앱에서만 확인합니다");
    }
}

/// 앱이 켜질 때 한 번 — 저장 폴더를 만들어 두고 화면에 알린다.
pub fn prepare(app: &AppHandle) {
    let _ = folder(app);
    emit_state(app);
}

/// macOS 가 아닌 곳에서 쓰는 경로 확인(문서 빌드·다른 OS) — 파일 경로만 본다.
#[allow(dead_code)]
fn is_recording_file(path: &Path) -> bool {
    path.extension()
        .map(|value| {
            let ext = value.to_string_lossy().to_ascii_lowercase();
            matches!(ext.as_str(), "m4a" | "mp4" | "webm" | "ogg" | "wav")
        })
        .unwrap_or(false)
}

#[allow(dead_code)]
fn now_ms_for_tests() -> i64 {
    now_ms()
}

/* ======================================================================
   v1.29.0 — 회의 모드: 화상 회의 시스템 오디오 · 화자 분리 · 받아 적기
   ======================================================================

   대면 회의   마이크 한 트랙 → ① 화자 분리(sherpa-onnx) ② 받아 적기(whisper.cpp) → 화자별 대화록
   화상 회의   마이크 '나' + 시스템 오디오 '상대방' 두 트랙 → 각각 받아 적어 시간순으로 합침

   엔진은 모두 이 Mac 안에서만 돈다(인터넷 없이). 처음 한 번만 내려받는다.
     · whisper.cpp(음성 인식) — 영상 편집의 자동 자막과 **같은 엔진·같은 모델**을 쓴다.
     · sherpa-onnx(화자 분리) — Apache-2.0. macOS Universal2 공유 빌드 + pyannote 분할 모델
       + 3D-Speaker 임베딩 모델. 내려받은 파일은 크기와 SHA-256 을 함께 대조한다.
   작업은 저장이 끝난 뒤 백그라운드 스레드에서 돌고, 진행률·결과는
   `tip://voice-transcript` 로 알린다. 결과는 녹음 옆에 `.json`(구간)과 `.txt`(대화록)로 남는다.
*/

/// 화상 회의 — 시스템 오디오(상대방) 담기를 시작한다.
fn start_system(app: &AppHandle) -> Result<String, String> {
    if !crate::native::available() {
        return Err("이 빌드에는 시스템 오디오 도우미가 없습니다 — 정식 Mac 앱 빌드에서 됩니다".to_string());
    }
    // 화면 기록 권한이 없으면 macOS 가 담기를 거절한다 — 먼저 물어본다.
    if let Err(error) = crate::capture::ensure_screen_access() {
        return Err(error.replace("[permission]", "").trim().to_string());
    }
    let name = {
        let voice = lock();
        voice.name.clone().ok_or_else(|| "녹음 파일이 아직 없습니다".to_string())?
    };
    let base = base_stem(&name)?;
    let file_name = format!("{base} (상대방).wav");
    let path = folder(app).join(&file_name);
    let child = crate::native::start_audio(app, &path)?;
    {
        let mut voice = lock();
        voice.system = Some(path);
        voice.system_name = Some(file_name.clone());
        voice.system_child = Some(child);
    }
    Ok(file_name)
}

/// 시스템 오디오 담기를 끝낸다 — SIGTERM 을 보내고 WAV 헤더가 마무리될 때까지 기다린다.
fn stop_system(app: &AppHandle) {
    let _ = app;
    let child = lock().system_child.take();
    let Some(mut child) = child else { return };
    let _ = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(child.id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if started.elapsed().as_millis() < 6000 => {
                std::thread::sleep(std::time::Duration::from_millis(120));
            }
            _ => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// 파일 이름에서 '대화록'의 뼈대를 얻는다 — ' (나)'·' (상대방)' 꼬리를 떼어 낸다.
fn base_stem(name: &str) -> Result<String, String> {
    let value = name.trim();
    if value.is_empty()
        || value.len() > 160
        || value.contains('/')
        || value.contains('\\')
        || value.contains("..")
        || value.starts_with('.')
    {
        return Err("파일 이름이 올바르지 않습니다".to_string());
    }
    let stem = Path::new(value)
        .file_stem()
        .map(|part| part.to_string_lossy().to_string())
        .unwrap_or_default();
    let base = stem
        .trim_end_matches(" (나)")
        .trim_end_matches(" (상대방)")
        .trim()
        .to_string();
    if base.is_empty() {
        return Err("파일 이름이 올바르지 않습니다".to_string());
    }
    Ok(base)
}

/// 대화록 파일 두 개(.json 구간, .txt 사람이 읽는 글).
fn transcript_files(app: &AppHandle, name: &str) -> Result<(PathBuf, PathBuf), String> {
    let base = base_stem(name)?;
    let dir = folder(app);
    Ok((dir.join(format!("{base}.json")), dir.join(format!("{base}.txt"))))
}

/* ------------------------------ 대화록 자료형 ------------------------------ */

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Utterance {
    pub start: f64,
    pub end: f64,
    pub speaker: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub name: String,
    pub mode: String,
    pub segments: Vec<Utterance>,
    /// 화자가 나온 차례 — 화면의 이름 바꾸기 목록.
    pub speakers: Vec<String>,
    pub engine: String,
    pub created: i64,
    pub seconds: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceEngineStatus {
    pub whisper: bool,
    pub diarizer: bool,
    pub ready: bool,
    pub missing: Vec<String>,
    pub download_size: u64,
    pub message: Option<String>,
}

/// 음성 인식(whisper.cpp) 준비됨 — 영상 편집과 같은 파일을 쓴다.
fn whisper_ready(app: &AppHandle) -> bool {
    crate::video::whisper_paths(app)
        .map(|(binary, model)| binary.is_file() && model.is_file())
        .unwrap_or(false)
}

/// 화자 분리 파일 자리 — (실행 파일, 라이브러리 폴더, 분할 모델, 임베딩 모델).
fn diarizer_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf, PathBuf, PathBuf)> {
    let root = crate::video::binary_dir(app)?.join("sherpa");
    Some((
        root.join("diarizer"),
        root.join("lib"),
        root.join("models").join("segmentation.onnx"),
        root.join("models").join("embedding.onnx"),
    ))
}

fn diarizer_ready(app: &AppHandle) -> bool {
    diarizer_paths(app)
        .map(|(bin, lib, seg, emb)| {
            bin.is_file() && lib.join("libonnxruntime.dylib").is_file() && seg.is_file() && emb.is_file()
        })
        .unwrap_or(false)
}

fn engine_status(app: &AppHandle) -> VoiceEngineStatus {
    let whisper = whisper_ready(app);
    let diarizer = diarizer_ready(app);
    let mut missing = Vec::new();
    let mut size = 0u64;
    if !whisper {
        missing.push("음성 인식(whisper.cpp, 약 151MB)".to_string());
        size += 151_000_000;
    }
    if !diarizer {
        missing.push("화자 분리(sherpa-onnx, 약 79MB)".to_string());
        size += 79_000_000;
    }
    VoiceEngineStatus {
        whisper,
        diarizer,
        ready: whisper && diarizer,
        missing: missing.clone(),
        download_size: size,
        message: if missing.is_empty() {
            None
        } else {
            Some(format!("회의록 엔진을 아직 받지 않았습니다: {}", missing.join(", ")))
        },
    }
}

#[tauri::command]
pub fn voice_engine_status(app: AppHandle) -> VoiceEngineStatus {
    engine_status(&app)
}

/// 회의록 엔진을 받는다 — whisper.cpp 는 영상 편집과 같은 자리에, sherpa-onnx 는 bin/sherpa 에.
#[tauri::command]
pub async fn voice_engine_download(app: AppHandle) -> Result<VoiceEngineStatus, String> {
    if !whisper_ready(&app) {
        let _ = app.emit(
            "tip://voice-engine-progress",
            serde_json::json!({ "stage": "whisper", "percent": 2.0 }),
        );
        crate::video::video_whisper_download(app.clone()).await?;
    }
    if !diarizer_ready(&app) {
        install_sherpa(&app).await?;
    }
    let _ = app.emit(
        "tip://voice-engine-progress",
        serde_json::json!({ "stage": "done", "percent": 100.0 }),
    );
    Ok(engine_status(&app))
}

/// sherpa-onnx 공유 빌드(Universal2)와 두 모델을 받아 bin/sherpa 에 둔다.
///
/// 내려받는 자산(모두 Apache-2.0, k2-fsa/sherpa-onnx):
///   · sherpa-onnx-v2.0.3-osx-universal2-shared-no-tts.tar.bz2 (43,399,439B)
///   · sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 (6,958,444B)
///   · 3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx (28,281,165B)
/// 크기와 SHA-256 은 2026-11-29 에 직접 받아 확인한 값이다(하나라도 다르면 저장하지 않는다).
const SHERPA_ENGINE: (&str, u64, &str) = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3/sherpa-onnx-v2.0.3-osx-universal2-shared-no-tts.tar.bz2",
    43_399_439,
    "9fa9f41b28b961a32ff538ae640dd54f7e92c3c2942d1a41728f36153e747ce5",
);
const SHERPA_SEGMENT: (&str, u64, &str) = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    6_958_444,
    "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488",
);
const SHERPA_EMBED: (&str, u64, &str) = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    28_281_165,
    "53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b",
);

async fn install_sherpa(app: &AppHandle) -> Result<(), String> {
    let dir = crate::video::binary_dir(app).ok_or_else(|| "앱 데이터 폴더를 찾지 못했습니다".to_string())?;
    let root = dir.join("sherpa");
    let bin = root.join("bin");
    let lib = root.join("lib");
    let models = root.join("models");
    for path in [&root, &bin, &lib, &models] {
        fs::create_dir_all(path).map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
    }
    let temp = dir.join("sherpa-dl");
    let _ = fs::remove_dir_all(&temp);
    fs::create_dir_all(&temp).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;

    // 1) 실행 파일 + onnxruntime
    let engine = temp.join("engine.tar.bz2");
    fetch_to(app, SHERPA_ENGINE.0, &engine, 2.0, 40.0).await?;
    check_asset(&engine, SHERPA_ENGINE.1, SHERPA_ENGINE.2)?;
    let unpack = temp.join("engine");
    untar(&engine, &unpack)?;
    let diarizer = find_named(&unpack, "sherpa-onnx-offline-speaker-diarization")
        .ok_or_else(|| "압축 안에서 화자 분리 실행 파일을 찾지 못했습니다".to_string())?;
    let onnx = find_named(&unpack, "libonnxruntime.dylib")
        .ok_or_else(|| "압축 안에서 onnxruntime 라이브러리를 찾지 못했습니다".to_string())?;
    copy_exec(&diarizer, &bin.join("diarizer"))?;
    fs::copy(&onnx, lib.join("libonnxruntime.dylib"))
        .map_err(|error| format!("라이브러리를 저장하지 못했습니다: {error}"))?;
    // 실행 파일은 @rpath/libonnxruntime.dylib 를 찾는다 — 옆의 lib 을 보게 rpath 를 넣고 다시 서명한다.
    let _ = Command::new("/usr/bin/install_name_tool")
        .args(["-add_rpath", "@executable_path/lib"])
        .arg(bin.join("diarizer"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    sign(&bin.join("diarizer"));
    let _ = fs::remove_dir_all(&unpack);
    let _ = fs::remove_file(&engine);

    // 2) 화자 분할 모델(pyannote)
    let seg = temp.join("segmentation.tar.bz2");
    fetch_to(app, SHERPA_SEGMENT.0, &seg, 40.0, 52.0).await?;
    check_asset(&seg, SHERPA_SEGMENT.1, SHERPA_SEGMENT.2)?;
    let seg_dir = temp.join("segmentation");
    untar(&seg, &seg_dir)?;
    let seg_model = find_named(&seg_dir, "model.onnx")
        .ok_or_else(|| "압축 안에서 분할 모델을 찾지 못했습니다".to_string())?;
    fs::copy(&seg_model, models.join("segmentation.onnx"))
        .map_err(|error| format!("분할 모델을 저장하지 못했습니다: {error}"))?;
    let _ = fs::remove_dir_all(&seg_dir);
    let _ = fs::remove_file(&seg);

    // 3) 화자 임베딩 모델(3D-Speaker)
    let embed = temp.join("embedding.onnx");
    fetch_to(app, SHERPA_EMBED.0, &embed, 52.0, 99.0).await?;
    check_asset(&embed, SHERPA_EMBED.1, SHERPA_EMBED.2)?;
    let _ = fs::remove_file(models.join("embedding.onnx"));
    fs::rename(&embed, models.join("embedding.onnx"))
        .map_err(|error| format!("임베딩 모델을 저장하지 못했습니다: {error}"))?;

    let _ = fs::remove_dir_all(&temp);
    Ok(())
}

/// 내려받은 파일의 크기와 SHA-256 을 함께 본다.
fn check_asset(path: &Path, size: u64, hash: &str) -> Result<(), String> {
    let actual_size = fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if actual_size != size {
        let _ = fs::remove_file(path);
        return Err(format!("내려받은 파일 크기가 다릅니다(기대 {size}, 실제 {actual_size})"));
    }
    let actual = crate::sha256_file(path)?;
    if !actual.eq_ignore_ascii_case(hash) {
        let _ = fs::remove_file(path);
        return Err(format!("내려받은 파일의 해시가 다릅니다(기대 {hash}, 실제 {actual})"));
    }
    Ok(())
}

/// 진행률을 `tip://voice-engine-progress` 로 알리며 파일 하나를 받는다.
async fn fetch_to(app: &AppHandle, url: &str, target: &Path, from: f64, to: f64) -> Result<(), String> {
    use futures_util::StreamExt;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|error| format!("다운로드를 준비하지 못했습니다: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("내려받지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("내려받을 주소가 응답하지 않습니다 ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let mut file = fs::File::create(target).map_err(|error| format!("파일을 만들지 못했습니다: {error}"))?;
    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("내려받는 중 끊겼습니다: {error}"))?;
        file.write_all(&chunk).map_err(|error| format!("파일을 쓰지 못했습니다: {error}"))?;
        received += chunk.len() as u64;
        if total > 0 {
            let percent = from + received as f64 / total as f64 * (to - from);
            let _ = app.emit(
                "tip://voice-engine-progress",
                serde_json::json!({ "stage": "download", "percent": percent, "received": received, "total": total }),
            );
        }
    }
    Ok(())
}

/// tar.bz2 풀기 — macOS 의 bsdtar 가 bzip2 를 안다(추가 크레이트 없이).
fn untar(archive: &Path, into: &Path) -> Result<(), String> {
    fs::create_dir_all(into).map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
    let status = Command::new("/usr/bin/tar")
        .arg("-xjf")
        .arg(archive)
        .arg("-C")
        .arg(into)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("압축을 풀지 못했습니다: {error}"))?;
    if !status.success() {
        return Err("압축을 풀지 못했습니다".to_string());
    }
    Ok(())
}

/// 폴더 아래에서 이름이 같은 파일을 찾는다(깊이 제한 없음, 압축 안 구조를 모르므로).
fn find_named(dir: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        } else if path.file_name().map(|value| value == name).unwrap_or(false) {
            return Some(path);
        }
    }
    for sub in dirs {
        if let Some(found) = find_named(&sub, name) {
            return Some(found);
        }
    }
    None
}

fn copy_exec(from: &Path, to: &Path) -> Result<(), String> {
    fs::copy(from, to).map_err(|error| format!("실행 파일을 저장하지 못했습니다: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(to, fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

/// arm64 는 서명이 없으면 실행되지 않는다 — 임시(ad-hoc) 서명.
fn sign(path: &Path) {
    let _ = Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/* ------------------------------ 받아 적기 ------------------------------ */

/// 지금 대화록을 만드는 중인지 — 한 번에 하나만.
static VOICE_JOB: AtomicBool = AtomicBool::new(false);

fn emit_transcript(app: &AppHandle, name: &str, mode: Mode, stage: &str, percent: f64, error: Option<String>, transcript: Option<&Transcript>) {
    let _ = app.emit(
        "tip://voice-transcript",
        serde_json::json!({
            "name": name,
            "mode": mode.as_str(),
            "stage": stage,
            "percent": percent,
            "error": error,
            "transcript": transcript,
        }),
    );
}

/// 저장 직후 이어서 도는 작업 — 엔진이 없으면 화면에 '내려받기'를 띄우게 알린다.
fn start_job(app: &AppHandle, mic_name: String, mode: Mode) {
    if !mode.meeting() {
        return;
    }
    if VOICE_JOB.swap(true, Ordering::SeqCst) {
        return;
    }
    let engine = engine_status(app);
    if !engine.ready {
        VOICE_JOB.store(false, Ordering::SeqCst);
        emit_transcript(app, &mic_name, mode, "engine-missing", 0.0, None, None);
        return;
    }
    let speakers = 2u32;
    let handle = app.clone();
    emit_transcript(&handle, &mic_name, mode, "start", 1.0, None, None);
    std::thread::spawn(move || {
        let result = run_job(&handle, &mic_name, mode, speakers);
        VOICE_JOB.store(false, Ordering::SeqCst);
        match result {
            Ok(transcript) => {
                emit_transcript(&handle, &mic_name, mode, "done", 100.0, None, Some(&transcript));
                toast(&handle, "대화록을 만들었습니다");
            }
            Err(error) => {
                emit_transcript(&handle, &mic_name, mode, "error", 0.0, Some(error.clone()), None);
                toast(&handle, &format!("대화록을 만들지 못했습니다: {error}"));
            }
        }
    });
}

/// 16kHz 모노 WAV 로 바꾼다 — macOS 기본 afconvert(추가 설치 없음).
fn to_speech_wav(from: &Path, to: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
        .arg(from)
        .arg(to)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("소리를 바꾸지 못했습니다: {error}"))?;
    if !status.success() || !to.is_file() {
        return Err("녹음 소리를 읽지 못했습니다".to_string());
    }
    Ok(())
}

#[derive(Clone)]
struct Cue {
    start: f64,
    end: f64,
    text: String,
}

/// whisper-cli 로 WAV 하나를 받아 적는다(영상 편집의 자동 자막과 같은 방식).
fn whisper_cues(app: &AppHandle, wav: &Path, language: &str, from: f64, to: f64) -> Result<Vec<Cue>, String> {
    let (binary, model) = crate::video::whisper_paths(app)
        .ok_or_else(|| "음성 인식 엔진 자리를 찾지 못했습니다".to_string())?;
    if !binary.is_file() || !model.is_file() {
        return Err("음성 인식 엔진이 아직 없습니다".to_string());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let prefix = std::env::temp_dir().join(format!("tip-voice-asr-{stamp}"));
    let threads = std::thread::available_parallelism()
        .map(|value| value.get().clamp(2, 8))
        .unwrap_or(4);
    let mut command = Command::new(&binary);
    command
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(wav)
        .arg("-oj")
        .arg("-of")
        .arg(&prefix)
        .arg("-np")
        .arg("-t")
        .arg(threads.to_string())
        .arg("-l")
        .arg(if language.is_empty() { "ko" } else { language })
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("음성 인식 엔진을 실행하지 못했습니다: {error}"))?;
    if let Some(pipe) = child.stderr.take() {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            if let Some(at) = line.find("progress =") {
                let number: String = line[at + 10..].chars().filter(|ch| ch.is_ascii_digit()).collect();
                if let Ok(percent) = number.parse::<f64>() {
                    let handle = app.clone();
                    let _ = handle.emit(
                        "tip://voice-transcript",
                        serde_json::json!({ "stage": "transcribe", "percent": from + percent / 100.0 * (to - from) }),
                    );
                }
            }
        }
    }
    let status = child.wait().map_err(|error| format!("받아 적기 상태를 읽지 못했습니다: {error}"))?;
    if !status.success() {
        return Err("받아 적기가 끝나지 않았습니다".to_string());
    }
    let path = prefix.with_extension("json");
    let text = fs::read_to_string(&path).map_err(|error| format!("받아 적은 결과를 읽지 못했습니다: {error}"))?;
    let _ = fs::remove_file(&path);
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|_| "받아 적은 결과를 해석하지 못했습니다".to_string())?;
    let mut cues = Vec::new();
    if let Some(list) = parsed.get("transcription").and_then(|value| value.as_array()) {
        for item in list {
            let start = item
                .get("offsets")
                .and_then(|value| value.get("from"))
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0)
                / 1000.0;
            let end = item
                .get("offsets")
                .and_then(|value| value.get("to"))
                .and_then(|value| value.as_f64())
                .unwrap_or(start * 1000.0 + 700.0)
                / 1000.0;
            let line = item.get("text").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
            if line.is_empty() || line == "[BLANK_AUDIO]" || line.starts_with("[") && line.ends_with("]") {
                continue;
            }
            cues.push(Cue { start, end: end.max(start + 0.3), text: line });
        }
    }
    Ok(cues)
}

#[derive(Clone, Copy)]
struct Turn {
    start: f64,
    end: f64,
    speaker: usize,
}

/// sherpa-onnx 로 화자 구간을 얻는다 — 0.00 -- 3.20 speaker_0 꼴의 줄을 읽는다.
fn diarize(app: &AppHandle, wav: &Path, speakers: u32) -> Result<Vec<Turn>, String> {
    let (binary, lib, segmentation, embedding) =
        diarizer_paths(app).ok_or_else(|| "화자 분리 엔진 자리를 찾지 못했습니다".to_string())?;
    if !binary.is_file() || !segmentation.is_file() || !embedding.is_file() {
        return Err("화자 분리 엔진이 아직 없습니다".to_string());
    }
    let mut command = Command::new(&binary);
    command
        // @rpath/libonnxruntime.dylib 를 옆 폴더에서도 찾게 (rpath 를 못 넣은 경우의 안전망).
        .env("DYLD_LIBRARY_PATH", &lib)
        .arg(format!("--clustering.num-clusters={}", speakers.clamp(2, 4)))
        .arg(format!("--segmentation.pyannote-model={}", segmentation.to_string_lossy()))
        .arg(format!("--embedding.model={}", embedding.to_string_lossy()))
        .arg("--segmentation.num-threads=2")
        .arg("--embedding.num-threads=2")
        .arg(wav)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("화자 분리 엔진을 실행하지 못했습니다: {error}"))?;
    let stderr = child.stderr.take();
    let stdout = child.stdout.take();
    if let Some(pipe) = stderr {
        let handle = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if let Some(value) = line.trim().strip_prefix("progress ") {
                    let number: String = value.chars().filter(|ch| ch.is_ascii_digit() || *ch == '.').collect();
                    if let Ok(percent) = number.parse::<f64>() {
                        let _ = handle.emit(
                            "tip://voice-transcript",
                            serde_json::json!({ "stage": "diarize", "percent": percent }),
                        );
                    }
                }
            }
        });
    }
    let mut turns = Vec::new();
    if let Some(pipe) = stdout {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            let line = line.trim();
            let mut parts = line.split(" -- ");
            let (Some(start), Some(rest)) = (parts.next(), parts.next()) else { continue };
            let mut rest = rest.split_whitespace();
            let Some(end) = rest.next() else { continue };
            let Some(name) = rest.next() else { continue };
            let Some(id) = name.strip_prefix("speaker_") else { continue };
            let (Ok(start), Ok(end), Ok(id)) = (start.parse::<f64>(), end.parse::<f64>(), id.parse::<usize>()) else {
                continue;
            };
            turns.push(Turn { start, end, speaker: id });
        }
    }
    let status = child.wait().map_err(|error| format!("화자 분리 상태를 읽지 못했습니다: {error}"))?;
    if !status.success() {
        return Err("화자 분리를 마치지 못했습니다".to_string());
    }
    Ok(turns)
}

/// 받아 적은 구간에 화자를 붙인다 — 겹치는 구간이 가장 긴 화자, 없으면 가장 가까운 화자.
fn speaker_for(cue: &Cue, turns: &[Turn], labels: &std::collections::BTreeMap<usize, String>, fallback: &str) -> String {
    if turns.is_empty() {
        return fallback.to_string();
    }
    let mut best: Option<(f64, usize)> = None;
    for turn in turns {
        let overlap = (cue.end.min(turn.end) - cue.start.max(turn.start)).max(0.0);
        if overlap > 0.0 {
            match best {
                Some((value, _)) if value >= overlap => {}
                _ => best = Some((overlap, turn.speaker)),
            }
        }
    }
    let id = match best {
        Some((_, id)) => id,
        None => {
            // 겹치는 구간이 없으면 가운데가 가장 가까운 화자.
            let center = (cue.start + cue.end) / 2.0;
            turns
                .iter()
                .min_by(|a, b| {
                    let da = (center - (a.start + a.end) / 2.0).abs();
                    let db = (center - (b.start + b.end) / 2.0).abs();
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|turn| turn.speaker)
                .unwrap_or(0)
        }
    };
    labels.get(&id).cloned().unwrap_or_else(|| fallback.to_string())
}

/// 같은 화자가 이어 말한 줄은 붙인다.
fn merge_utterances(list: Vec<Utterance>) -> Vec<Utterance> {
    let mut out: Vec<Utterance> = Vec::new();
    for item in list {
        if let Some(last) = out.last_mut() {
            if last.speaker == item.speaker && item.start - last.end < 1.6 {
                if !last.text.ends_with(' ') {
                    last.text.push(' ');
                }
                last.text.push_str(&item.text);
                last.end = last.end.max(item.end);
                continue;
            }
        }
        out.push(item);
    }
    out
}

fn run_job(app: &AppHandle, mic_name: &str, mode: Mode, speakers: u32) -> Result<Transcript, String> {
    let started = Instant::now();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tip-voice-{stamp}"));
    fs::create_dir_all(&dir).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;

    let result = run_job_inner(app, mic_name, mode, speakers, &dir);
    let _ = fs::remove_dir_all(&dir);
    result.map(|mut transcript| {
        transcript.seconds = transcript
            .segments
            .iter()
            .map(|item| item.end)
            .fold(0.0_f64, f64::max);
        let _ = started;
        transcript
    })
}

fn run_job_inner(app: &AppHandle, mic_name: &str, mode: Mode, speakers: u32, dir: &Path) -> Result<Transcript, String> {
    let mic = checked_path(app, mic_name)?;
    let mic_wav = dir.join("mic.wav");
    emit_transcript(app, mic_name, mode, "convert", 4.0, None, None);
    to_speech_wav(&mic, &mic_wav)?;

    emit_transcript(app, mic_name, mode, "transcribe", 8.0, None, None);
    let mic_cues = whisper_cues(app, &mic_wav, "ko", 8.0, 70.0)?;

    let mut list: Vec<Utterance> = Vec::new();
    let mut speaker_names: Vec<String> = Vec::new();

    match mode {
        Mode::InPerson => {
            emit_transcript(app, mic_name, mode, "diarize", 72.0, None, None);
            let turns = diarize(app, &mic_wav, speakers).unwrap_or_default();
            // 화자가 처음 나온 차례로 '화자 1, 화자 2 …' 이름을 붙인다.
            let mut labels = std::collections::BTreeMap::new();
            let mut ordered = turns.clone();
            ordered.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
            for turn in &ordered {
                if !labels.contains_key(&turn.speaker) {
                    let name = format!("화자 {}", labels.len() + 1);
                    labels.insert(turn.speaker, name.clone());
                    speaker_names.push(name);
                }
            }
            if speaker_names.is_empty() {
                speaker_names.push("화자 1".to_string());
            }
            for cue in &mic_cues {
                let speaker = speaker_for(cue, &turns, &labels, "화자 1");
                list.push(Utterance { start: cue.start, end: cue.end, speaker, text: cue.text.clone() });
            }
        }
        Mode::Online => {
            let me = "나".to_string();
            speaker_names.push(me.clone());
            for cue in &mic_cues {
                list.push(Utterance { start: cue.start, end: cue.end, speaker: me.clone(), text: cue.text.clone() });
            }
            // 상대방 트랙 — 시스템 오디오가 담겼으면 함께 받아 적는다.
            let base = base_stem(mic_name)?;
            let partner = folder(app).join(format!("{base} (상대방).wav"));
            if partner.is_file() {
                emit_transcript(app, mic_name, mode, "transcribe", 74.0, None, None);
                let partner_wav = dir.join("partner.wav");
                if to_speech_wav(&partner, &partner_wav).is_ok() {
                    if let Ok(cues) = whisper_cues(app, &partner_wav, "ko", 74.0, 98.0) {
                        let them = "상대방".to_string();
                        speaker_names.push(them.clone());
                        for cue in &cues {
                            list.push(Utterance { start: cue.start, end: cue.end, speaker: them.clone(), text: cue.text.clone() });
                        }
                    }
                }
            }
        }
        Mode::Normal => {}
    }

    list.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let segments = merge_utterances(list);
    let transcript = Transcript {
        name: mic_name.to_string(),
        mode: mode.as_str().to_string(),
        segments,
        speakers: speaker_names,
        engine: format!("whisper.cpp + sherpa-onnx ({})", std::env::consts::ARCH),
        created: now_ms(),
        seconds: 0.0,
    };

    // 녹음 옆에 남긴다 — 다시 열어도 대화록이 보이고, 지우면 함께 지워진다.
    let (json, text) = transcript_files(app, mic_name)?;
    if let Ok(body) = serde_json::to_string_pretty(&transcript) {
        let _ = fs::write(&json, body);
    }
    let _ = fs::write(&text, transcript_text(&transcript));
    Ok(transcript)
}

/// 사람이 읽는 대화록 — [00:12] 화자 1: …
fn transcript_text(transcript: &Transcript) -> String {
    let mut out = String::new();
    out.push_str(&format!("TIP 대화록 · {}\n", transcript.name));
    out.push_str(&format!("화자: {}\n\n", transcript.speakers.join(", ")));
    for item in &transcript.segments {
        let total = item.start.max(0.0) as u64;
        out.push_str(&format!(
            "[{:02}:{:02}] {}: {}\n",
            total / 60,
            total % 60,
            item.speaker,
            item.text
        ));
    }
    out
}

/// 저장해 둔 대화록을 읽는다 — 없으면 None.
#[tauri::command]
pub fn voice_transcript(app: AppHandle, name: String) -> Option<Transcript> {
    let (json, _) = transcript_files(&app, &name).ok()?;
    let text = fs::read_to_string(json).ok()?;
    serde_json::from_str(&text).ok()
}

/// 대화록을 다시 만든다(설정에서 화자 수를 바꿨거나 엔진을 늦게 받았을 때).
#[tauri::command]
pub async fn voice_transcribe(app: AppHandle, name: String, speakers: Option<u32>) -> Result<Transcript, String> {
    let mode = {
        let voice = lock();
        if voice.status_mode_meeting() {
            voice.mode
        } else {
            // 목록에서 다시 돌릴 때는 이름으로 짐작한다 — ' (나)' 가 붙었으면 화상 회의.
            if name.contains(" (나)") {
                Mode::Online
            } else {
                Mode::InPerson
            }
        }
    };
    if !engine_status(&app).ready {
        return Err("회의록 엔진을 먼저 내려받아 주세요".to_string());
    }
    if VOICE_JOB.swap(true, Ordering::SeqCst) {
        return Err("이미 대화록을 만드는 중입니다".to_string());
    }
    let speakers = speakers.unwrap_or(2).clamp(2, 4);
    let handle = app.clone();
    let name_for_job = name.clone();
    let work = tauri::async_runtime::spawn_blocking(move || run_job(&handle, &name_for_job, mode, speakers));
    let result = work
        .await
        .map_err(|error| format!("대화록을 마치지 못했습니다: {error}"))?;
    VOICE_JOB.store(false, Ordering::SeqCst);
    let transcript = result?;
    emit_transcript(&app, &name, mode, "done", 100.0, None, Some(&transcript));
    Ok(transcript)
}

impl Voice {
    /// 지금 회의 모드로 녹음 중인지 — 다시 돌릴 때 모드를 정하는 데 쓴다.
    fn status_mode_meeting(&self) -> bool {
        self.phase.busy() && self.mode.meeting()
    }
}
