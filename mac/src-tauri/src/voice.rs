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
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// 녹음을 맡는 숨은 상주 창의 라벨 — capabilities/default.json 의 windows 목록에도 있다.
const RECORDER: &str = "recorder";
const RECORDER_W: f64 = 360.0;
const RECORDER_H: f64 = 240.0;

/// 전역 단축키 표에서 '녹음 시작/중지'를 가리키는 키.
/// 화면(js/feature-settings.js)의 VOICE_ACTION_KEY 와 같아야 한다.
pub const VOICE_ACTION_KEY: &str = "voice:record";

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
    /// recorder 창이 준비되기 전에 보내 둘 명령("start" / "stop").
    pending: Option<&'static str>,
    bytes: u64,
}

impl Voice {
    const fn new() -> Self {
        Voice {
            phase: Phase::Idle,
            started_at: None,
            accumulated_ms: 0,
            file: None,
            name: None,
            mime: String::new(),
            level: 0.0,
            error: None,
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

fn begin(app: &AppHandle) -> Result<(), String> {
    {
        let mut voice = lock();
        if voice.phase.busy() {
            return Ok(());
        }
        voice.phase = Phase::Starting;
        voice.started_at = None;
        voice.accumulated_ms = 0;
        voice.file = None;
        voice.name = None;
        voice.mime = String::new();
        voice.level = 0.0;
        voice.error = None;
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
    let (name, file, bytes) = {
        let mut voice = lock();
        if voice.phase != Phase::Saving {
            return;
        }
        voice.phase = Phase::Idle;
        voice.pending = None;
        (voice.name.clone(), voice.file.clone(), voice.bytes)
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
        if let Some(name) = name {
            toast(app, &format!("녹음을 저장했습니다: {name}"));
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
pub fn voice_start(app: AppHandle) -> Result<VoiceState, String> {
    begin(&app)?;
    Ok(snapshot(&app))
}

/// 단축키 토글 — 녹음 중이 아니면 시작, 녹음 중이면 중지·저장.
#[tauri::command]
pub fn voice_toggle(app: AppHandle) -> Result<VoiceState, String> {
    let phase = lock().phase;
    if phase == Phase::Idle {
        begin(&app)?;
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
    let base = safe_base(&file_name);
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

/// 녹음 하나를 지운다.
#[tauri::command]
pub fn voice_delete(app: AppHandle, name: String) -> Result<(), String> {
    let path = checked_path(&app, &name)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|error| format!("녹음 파일을 지우지 못했습니다: {error}"))
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
