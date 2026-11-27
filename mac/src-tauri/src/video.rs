// TIP · 영상 편집(video-editor) 엔진 — v1.23.0
//
// 하는 일 세 가지.
//   1) 온디맨드 ffmpeg/ffprobe — .dmg 를 가볍게 두려고 앱에 넣지 않는다. 사용자가 영상 편집을
//      열었을 때 (a) 앱 전용 폴더(app_data_dir/bin), (b) 이미 설치된 Homebrew 경로 순으로 찾고,
//      없으면 화면의 '고속 편집 엔진 다운로드' 버튼이 공식 정적 빌드를 받아 SHA-256 을 대조한 뒤
//      실행 권한(0755)을 주고 저장한다.
//      내려받는 곳: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.0 (ffmpeg 6.0 정적 빌드)
//      URL·해시는 실제 릴리스 자산을 받아 직접 확인한 값이다(가짜 해시 금지).
//   2) 영상 내보내기 — 클립·전환(xfade)·자막(drawtext)·BGM(amix)·배속·색감·페이드를 한 번의
//      ffmpeg 실행으로 합쳐 MP4 로 저장한다. h264_videotoolbox 로 먼저 시도하고, 실패하면
//      libx264 로 다시 한다. 진행률은 tip://video-export-progress 로 알린다.
//   3) 파일 고르기 — macOS 의 NSOpenPanel/NSSavePanel 로 경로를 받는다. 고른 경로만 허용 목록에
//      담아 두고, 내보내기는 그 목록에 있는 파일만 읽는다(화면이 임의 경로를 넘기지 못한다).
//
// 보안: 앱 커맨드는 이 창(tool/main)에서만 부를 수 있다(capabilities/default.json).
//       ffmpeg 에 넘기는 경로는 사용자가 방금 고른 파일과 앱이 만든 임시·결과 파일뿐이다.

use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// 앱 전용 엔진 폴더 이름 — app_data_dir 아래.
const BIN_DIR: &str = "bin";
/// 이미 Mac 에 설치된 ffmpeg 를 찾을 자리(Apple Silicon → Intel 순).
const SYSTEM_FFMPEG: [&str; 2] = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"];

/// 내려받는 정적 빌드 — ffmpeg-static b6.0(ffmpeg 6.0). 아래 해시는 이 자산을 직접 받아
/// `sha256sum` 으로 확인한 값이다. 자산이 바뀌면 해시도 함께 바뀌어야 한다(대조 실패 = 설치 안 함).
const ENGINE_TAG: &str = "b6.0";
const ENGINE_BASE: &str = "https://github.com/eugeneware/ffmpeg-static/releases/download";
const FFMPEG_ARM64: (&str, &str) = (
    "ffmpeg-darwin-arm64",
    "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584",
);
const FFMPEG_X64: (&str, &str) = (
    "ffmpeg-darwin-x64",
    "cfe20936c83ecf5d68e424b87e8cc45b24dd6be81787810123bb964a0df686f9",
);
const FFPROBE_ARM64: (&str, &str) = (
    "ffprobe-darwin-arm64",
    "bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64",
);
const FFPROBE_X64: (&str, &str) = (
    "ffprobe-darwin-x64",
    "30391ba3d662a6fac1c2f7c21fdd3120422377892a090e654936a0aaedba0c53",
);

/// 사용자가 고른 파일 경로 — 내보내기는 이 목록에 있는 경로만 읽는다.
static PICKED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// 지금 내보내는 중인지 — 한 번에 하나만.
static EXPORTING: AtomicBool = AtomicBool::new(false);
/// 취소 요청.
static CANCEL: AtomicBool = AtomicBool::new(false);
/// 실행 중인 ffmpeg 의 프로세스 id — 취소할 때 죽인다.
static RUNNING_PID: AtomicU64 = AtomicU64::new(0);

/* ------------------------------ 자료형 ------------------------------ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub available: bool,
    pub path: Option<String>,
    pub source: Option<String>,
    pub version: Option<String>,
    pub arch: String,
    pub ffprobe: Option<String>,
    pub binary_dir: String,
    pub download_size: Option<u64>,
    pub message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedMedia {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub percent: f64,
    pub time: f64,
    pub total: f64,
    pub stage: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub seconds: f64,
    pub encoder: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportTransition {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub duration: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub path: String,
    /// "video" | "image"
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub trim_end: f64,
    #[serde(default = "one")]
    pub speed: f64,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub brightness: f64,
    #[serde(default = "one")]
    pub contrast: f64,
    #[serde(default = "one")]
    pub saturation: f64,
    #[serde(default)]
    pub transition: Option<ExportTransition>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSubtitle {
    pub text: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    /// 글꼴 키(Pretendard·helvetica…) 또는 빈 값.
    #[serde(default)]
    pub font: String,
    /// 사용자가 고른 폰트 파일(.ttf/.otf) 경로 — 있으면 이것을 쓴다.
    #[serde(default)]
    pub font_file: Option<String>,
    #[serde(default)]
    pub font_size: f64,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub outline_color: String,
    #[serde(default)]
    pub outline_width: f64,
    #[serde(default)]
    pub background: f64,
    #[serde(default = "half")]
    pub x: f64,
    #[serde(default = "four_fifths")]
    pub y: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportAudio {
    pub path: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default = "one")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub duration: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpec {
    pub clips: Vec<ExportClip>,
    #[serde(default)]
    pub subtitles: Vec<ExportSubtitle>,
    #[serde(default)]
    pub audios: Vec<ExportAudio>,
    pub width: u32,
    pub height: u32,
    #[serde(default = "thirty")]
    pub fps: u32,
    pub output: String,
}

fn one() -> f64 {
    1.0
}
fn half() -> f64 {
    0.5
}
fn four_fifths() -> f64 {
    0.82
}
fn thirty() -> u32 {
    30
}

/* ------------------------------ 경로 도우미 ------------------------------ */

fn arch_name() -> String {
    match std::env::consts::ARCH {
        "aarch64" => "arm64".to_string(),
        other => other.to_string(),
    }
}

/// 앱 전용 엔진 폴더.
fn binary_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join(BIN_DIR);
    let _ = fs::create_dir_all(&dir);
    Some(dir)
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

/// 지금 쓸 ffmpeg — 앱 전용 폴더 → Homebrew 순. ffprobe 는 그 옆에서 찾는다.
fn find_engine(app: &AppHandle) -> (Option<PathBuf>, Option<String>) {
    if let Some(dir) = binary_dir(app) {
        let local = dir.join("ffmpeg");
        if is_executable_file(&local) {
            return (Some(local), Some("app".to_string()));
        }
    }
    for candidate in SYSTEM_FFMPEG {
        let path = PathBuf::from(candidate);
        if is_executable_file(&path) {
            let source = if candidate.starts_with("/opt/homebrew") {
                "homebrew"
            } else {
                "usr-local"
            };
            return (Some(path), Some(source.to_string()));
        }
    }
    (None, None)
}

fn find_ffprobe(app: &AppHandle, ffmpeg: &Path) -> Option<PathBuf> {
    if let Some(dir) = binary_dir(app) {
        let local = dir.join("ffprobe");
        if is_executable_file(&local) {
            return Some(local);
        }
    }
    let sibling = ffmpeg.with_file_name("ffprobe");
    if is_executable_file(&sibling) {
        return Some(sibling);
    }
    for candidate in ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"] {
        let path = PathBuf::from(candidate);
        if is_executable_file(&path) {
            return Some(path);
        }
    }
    None
}

fn engine_version(ffmpeg: &Path) -> Option<String> {
    let output = Command::new(ffmpeg)
        .arg("-version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim().to_string();
    // "ffmpeg version 6.0 Copyright ..." → "6.0"
    first
        .split_whitespace()
        .nth(2)
        .map(|value| value.trim().to_string())
}

fn status(app: &AppHandle) -> EngineStatus {
    let (ffmpeg, source) = find_engine(app);
    let arch = arch_name();
    let binary = binary_dir(app)
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default();
    match ffmpeg {
        Some(path) => {
            let ffprobe = find_ffprobe(app, &path);
            EngineStatus {
                available: true,
                version: engine_version(&path),
                path: Some(path.to_string_lossy().to_string()),
                source,
                arch,
                ffprobe: ffprobe.map(|probe| probe.to_string_lossy().to_string()),
                binary_dir: binary,
                download_size: None,
                message: None,
            }
        }
        None => EngineStatus {
            available: false,
            path: None,
            source: None,
            version: None,
            arch,
            ffprobe: None,
            binary_dir: binary,
            download_size: Some(download_size()),
            message: Some("편집 엔진(ffmpeg)이 아직 없습니다".to_string()),
        },
    }
}

fn download_size() -> u64 {
    if arch_name() == "arm64" {
        92 * 1024 * 1024
    } else {
        158 * 1024 * 1024
    }
}

/* ------------------------------ 커맨드 ------------------------------ */

#[tauri::command]
pub fn video_engine_status(app: AppHandle) -> EngineStatus {
    status(&app)
}

/// 정적 빌드를 내려받아 앱 전용 폴더에 둔다. SHA-256 이 다르면 저장하지 않는다.
#[tauri::command]
pub async fn video_engine_download(app: AppHandle) -> Result<EngineStatus, String> {
    let dir = binary_dir(&app).ok_or_else(|| "앱 데이터 폴더를 찾지 못했습니다".to_string())?;
    let arm = arch_name() == "arm64";
    let (ffmpeg_asset, ffmpeg_hash) = if arm { FFMPEG_ARM64 } else { FFMPEG_X64 };
    let (ffprobe_asset, ffprobe_hash) = if arm { FFPROBE_ARM64 } else { FFPROBE_X64 };

    download_one(&app, ffmpeg_asset, ffmpeg_hash, &dir, "ffmpeg", 0.0).await?;
    download_one(&app, ffprobe_asset, ffprobe_hash, &dir, "ffprobe", 50.0).await?;

    let _ = app.emit(
        "tip://video-engine-progress",
        serde_json::json!({ "stage": "done", "percent": 100.0 }),
    );
    Ok(status(&app))
}

/// 파일 하나를 받아 해시를 대조하고 `dir/<name>` 으로 옮긴다.
async fn download_one(
    app: &AppHandle,
    asset: &str,
    expected: &str,
    dir: &Path,
    name: &str,
    base_percent: f64,
) -> Result<(), String> {
    let url = format!("{ENGINE_BASE}/{ENGINE_TAG}/{asset}");
    let temp = dir.join(format!("{name}.part"));
    let target = dir.join(name);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 20))
        .build()
        .map_err(|error| format!("다운로드를 준비하지 못했습니다: {error}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("엔진을 내려받지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("엔진 주소가 응답하지 않습니다 ({})", response.status()));
    }
    let total = response.content_length().unwrap_or(0);

    let mut file = fs::File::create(&temp).map_err(|error| format!("파일을 만들지 못했습니다: {error}"))?;
    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("내려받는 중 끊겼습니다: {error}"))?;
        file.write_all(&chunk)
            .map_err(|error| format!("파일을 쓰지 못했습니다: {error}"))?;
        received += chunk.len() as u64;
        if total > 0 {
            let percent = base_percent + received as f64 / total as f64 * 50.0;
            let _ = app.emit(
                "tip://video-engine-progress",
                serde_json::json!({
                    "stage": name,
                    "percent": percent,
                    "received": received,
                    "total": total,
                }),
            );
        }
    }
    drop(file);

    let actual = crate::sha256_file(&temp)?;
    if !actual.eq_ignore_ascii_case(expected) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "내려받은 {name} 의 해시가 다릅니다(기대 {expected}, 실제 {actual}). 안전을 위해 저장하지 않았습니다."
        ));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temp, fs::Permissions::from_mode(0o755));
    }
    let _ = fs::remove_file(&target);
    fs::rename(&temp, &target).map_err(|error| format!("엔진을 저장하지 못했습니다: {error}"))?;
    Ok(())
}

/// 미디어 파일 고르기 — macOS 패널로 경로를 받고 허용 목록에 담는다.
#[tauri::command]
pub fn video_pick_media(_app: AppHandle, kind: String) -> Result<Vec<PickedMedia>, String> {
    let picked = pick_media_panel(&kind)?;
    let mut allowed = PICKED.lock().map_err(|_| "허용 목록을 잠그지 못했습니다".to_string())?;
    let list = allowed.get_or_insert_with(HashSet::new);
    for item in &picked {
        list.insert(PathBuf::from(&item.path));
    }
    Ok(picked)
}

/// 폰트 파일(.ttf/.otf) 고르기 — 자막에서 쓴다.
#[tauri::command]
pub fn video_pick_font() -> Result<Option<PickedMedia>, String> {
    let picked = pick_font_panel()?;
    if let Some(item) = &picked {
        let mut allowed = PICKED.lock().map_err(|_| "허용 목록을 잠그지 못했습니다".to_string())?;
        let list = allowed.get_or_insert_with(HashSet::new);
        list.insert(PathBuf::from(&item.path));
    }
    Ok(picked)
}

/// 결과 파일을 둘 곳 고르기.
#[tauri::command]
pub fn video_save_path(name: String) -> Result<Option<String>, String> {
    save_panel(&name)
}

/// 파일을 실제로 연다 — 결과를 확인하거나 Finder 에서 보여 준다.
#[tauri::command]
pub fn video_reveal(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err("파일을 찾지 못했습니다".to_string());
    }
    let mut command = Command::new("open");
    command.arg("-R").arg(&target);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Finder 를 열지 못했습니다: {error}"))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
    pub has_video: bool,
}

/// ffprobe 로 길이·크기·오디오 유무를 읽는다.
#[tauri::command]
pub fn video_probe(app: AppHandle, path: String) -> Result<ProbeResult, String> {
    let target = PathBuf::from(&path);
    if !target.is_file() {
        return Err("파일을 찾지 못했습니다".to_string());
    }
    let (ffmpeg, _) = find_engine(&app);
    let ffmpeg = ffmpeg.ok_or_else(|| "편집 엔진이 없습니다".to_string())?;
    let probe = find_ffprobe(&app, &ffmpeg).ok_or_else(|| "ffprobe 가 없습니다".to_string())?;

    let output = Command::new(&probe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(&target)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("파일을 읽지 못했습니다: {error}"))?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "파일 정보를 해석하지 못했습니다".to_string())?;

    let mut duration = parsed
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let mut width = 0u32;
    let mut height = 0u32;
    let mut has_audio = false;
    let mut has_video = false;

    if let Some(streams) = parsed.get("streams").and_then(|value| value.as_array()) {
        for stream in streams {
            let codec_type = stream.get("codec_type").and_then(|value| value.as_str()).unwrap_or("");
            if codec_type == "video" {
                has_video = true;
                width = stream.get("width").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
                height = stream.get("height").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
                if let Some(value) = stream
                    .get("duration")
                    .and_then(|value| value.as_str())
                    .and_then(|value| value.parse::<f64>().ok())
                {
                    if value > duration {
                        duration = value;
                    }
                }
            } else if codec_type == "audio" {
                has_audio = true;
            }
        }
    }

    Ok(ProbeResult {
        duration,
        width,
        height,
        has_audio,
        has_video,
    })
}

/// 클립의 소리만 뽑아 .m4a 로 저장하고 그 경로를 돌려준다(오디오 분리).
#[tauri::command]
pub fn video_extract_audio(
    app: AppHandle,
    path: String,
    start: f64,
    end: f64,
) -> Result<String, String> {
    let source = PathBuf::from(&path);
    check_allowed(&source)?;
    let (ffmpeg, _) = find_engine(&app);
    let ffmpeg = ffmpeg.ok_or_else(|| "편집 엔진이 없습니다".to_string())?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "앱 데이터 폴더를 찾지 못했습니다".to_string())?
        .join("audio");
    fs::create_dir_all(&dir).map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let target = dir.join(format!("clip-audio-{stamp}.m4a"));

    let span = (end - start).max(0.2);
    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-nostdin", "-y", "-ss", &format!("{start:.3}"), "-t", &format!("{span:.3}")])
        .arg(&source)
        .args(["-vn", "-c:a", "aac", "-b:a", "192k"])
        .arg(&target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("소리를 뽑지 못했습니다: {error}"))?;
    if !status.success() {
        return Err("이 클립에는 뽑을 소리가 없거나 형식을 읽지 못했습니다".to_string());
    }
    if let Ok(mut allowed) = PICKED.lock() {
        if let Some(list) = allowed.as_mut() {
            list.insert(target.clone());
        }
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn video_cancel_export() {
    CANCEL.store(true, Ordering::SeqCst);
    let pid = RUNNING_PID.load(Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).status();
    }
}

/* ------------------------------ 내보내기 ------------------------------ */

#[tauri::command]
pub async fn video_export(app: AppHandle, spec: ExportSpec) -> Result<ExportResult, String> {
    if spec.clips.is_empty() {
        return Err("타임라인이 비어 있습니다".to_string());
    }
    let output = PathBuf::from(&spec.output);
    if !output.is_absolute() {
        return Err("저장 경로가 올바르지 않습니다".to_string());
    }
    for clip in &spec.clips {
        check_allowed(Path::new(&clip.path))?;
    }
    for audio in &spec.audios {
        check_allowed(Path::new(&audio.path))?;
    }
    if let Some(font) = spec.subtitles.iter().find_map(|item| item.font_file.clone()) {
        check_allowed(Path::new(&font))?;
    }
    if EXPORTING.swap(true, Ordering::SeqCst) {
        return Err("이미 내보내는 중입니다".to_string());
    }
    CANCEL.store(false, Ordering::SeqCst);

    let handle = app.clone();
    let work = tauri::async_runtime::spawn_blocking(move || run_export(&handle, &spec));
    let result = work
        .await
        .map_err(|error| format!("내보내기를 마치지 못했습니다: {error}"))?;
    EXPORTING.store(false, Ordering::SeqCst);
    RUNNING_PID.store(0, Ordering::SeqCst);

    match &result {
        Ok(done) => {
            let _ = app.emit(
                "tip://video-export-progress",
                ExportProgress {
                    percent: 100.0,
                    time: done.seconds,
                    total: done.seconds,
                    stage: "done".to_string(),
                },
            );
            let _ = app.emit("tip://video-export-done", serde_json::json!({
                "ok": true,
                "path": done.path,
                "seconds": done.seconds,
                "encoder": done.encoder,
            }));
        }
        Err(error) => {
            let canceled = CANCEL.load(Ordering::SeqCst);
            let _ = app.emit("tip://video-export-done", serde_json::json!({
                "ok": false,
                "canceled": canceled,
                "message": error,
            }));
        }
    }
    result
}

fn check_allowed(path: &Path) -> Result<(), String> {
    // 앱이 만든 임시 폴더는 언제나 허용한다.
    if path.starts_with(std::env::temp_dir()) {
        return Ok(());
    }
    let allowed = PICKED
        .lock()
        .map_err(|_| "허용 목록을 잠그지 못했습니다".to_string())?;
    if let Some(list) = allowed.as_ref() {
        if list.contains(path) {
            return Ok(());
        }
    }
    Err(format!(
        "{} 은(는) 이번 작업에서 고른 파일이 아닙니다",
        path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()
    ))
}

/// 클립 하나의 타임라인 길이(초) — 배속을 반영한다.
fn clip_visible(clip: &ExportClip) -> f64 {
    let span = (clip.trim_end - clip.trim_start).max(0.05);
    if clip.kind == "image" {
        span
    } else {
        (span / clip.speed.max(0.05)).max(0.05)
    }
}

/// 이어 붙이는 경계의 전환 길이 — 전환이 없으면 한 프레임(0.04초)짜리 아주 짧은 페이드로 붙인다.
/// (화면 미리보기도 같은 값을 써서 자막 시각이 어긋나지 않는다.)
fn boundary_duration(clip: &ExportClip, previous: f64) -> f64 {
    let asked = clip
        .transition
        .as_ref()
        .map(|item| item.duration)
        .unwrap_or(0.0);
    let want = if asked > 0.0 { asked } else { 0.04 };
    want.min(previous * 0.5).min(clip_visible(clip) * 0.5).max(0.02)
}

fn transition_name(clip: &ExportClip) -> String {
    let asked = clip
        .transition
        .as_ref()
        .map(|item| item.kind.clone())
        .unwrap_or_default();
    const KNOWN: [&str; 34] = [
        "fade", "fadeblack", "fadewhite", "dissolve", "pixelize", "radial",
        "wipeleft", "wiperight", "wipeup", "wipedown",
        "wipetl", "wipetr", "wipebl", "wipebr",
        "slideleft", "slideright", "slideup", "slidedown",
        "circleopen", "circleclose", "rectcrop",
        "vertopen", "vertclose", "horzopen", "horzclose",
        "diagtl", "diagtr", "diagbl", "diagbr",
        "hlslice", "hrslice", "vuslice", "vdslice", "squeezeh",
    ];
    if KNOWN.contains(&asked.as_str()) {
        asked
    } else if asked == "squeezev" || asked == "zoomin" || asked == "smoothleft"
        || asked == "smoothright" || asked == "smoothup" || asked == "smoothdown"
    {
        asked
    } else {
        "fade".to_string()
    }
}

fn atempo_chain(mut speed: f64) -> String {
    // atempo 는 0.5~100 만 받는다 — 그 밖은 두 단계로 나눈다.
    let mut parts = Vec::new();
    while speed < 0.5 {
        parts.push("atempo=0.5".to_string());
        speed /= 0.5;
    }
    while speed > 100.0 {
        parts.push("atempo=100".to_string());
        speed /= 100.0;
    }
    if (speed - 1.0).abs() > 0.001 {
        parts.push(format!("atempo={speed:.4}"));
    }
    parts.join(",")
}

/// 필터 안에 넣는 경로 — 작은따옴표로 감싸고 안의 특수 문자를 이스케이프한다.
fn filter_path(path: &Path) -> String {
    let text = path.to_string_lossy().to_string();
    let escaped = text.replace('\\', "\\\\").replace('\'', "'\\''").replace(':', "\\:");
    format!("'{escaped}'")
}

fn hex_color(value: &str) -> String {
    let trimmed = value.trim().trim_start_matches('#');
    if trimmed.len() == 6 && trimmed.chars().all(|ch| ch.is_ascii_hexdigit()) {
        format!("0x{trimmed}")
    } else {
        "0xFFFFFF".to_string()
    }
}

/// 자막 하나를 drawtext 로 — 글자는 임시 파일에 넣어 특수 문자 문제를 없앤다.
fn drawtext_filter(
    item: &ExportSubtitle,
    text_file: &Path,
    font_file: &Path,
    out_label: &str,
    in_label: &str,
    height: u32,
) -> String {
    let size = if item.font_size > 0.0 {
        item.font_size * (height as f64 / 1080.0).max(0.35)
    } else {
        54.0 * (height as f64 / 1080.0).max(0.35)
    };
    let outline = item.outline_width.max(0.0) * (height as f64 / 1080.0).max(0.35);
    let x = format!("(w-text_w)*{:.4}", item.x.clamp(0.0, 1.0));
    let y = format!("(h-text_h)*{:.4}", item.y.clamp(0.0, 1.0));
    let mut parts = vec![
        format!("fontfile={}", filter_path(font_file)),
        format!("textfile={}", filter_path(text_file)),
        format!("fontsize={size:.1}"),
        format!("fontcolor={}", hex_color(&item.color)),
        format!("x={x}"),
        format!("y={y}"),
        format!(
            "enable='between(t,{:.3},{:.3})'",
            item.start.max(0.0),
            item.end.max(item.start + 0.1)
        ),
    ];
    if outline > 0.1 {
        parts.push(format!("borderw={outline:.1}"));
        parts.push(format!("bordercolor={}", hex_color(&item.outline_color)));
    }
    if item.background > 0.0 {
        parts.push("box=1".to_string());
        parts.push(format!("boxcolor=0x000000@{:.2}", item.background.clamp(0.0, 1.0)));
        parts.push("boxborderw=10".to_string());
    }
    format!("[{in_label}]drawtext={}[{out_label}]", parts.join(":"))
}

fn run_export(app: &AppHandle, spec: &ExportSpec) -> Result<ExportResult, String> {
    let (ffmpeg, _) = find_engine(app);
    let ffmpeg = ffmpeg.ok_or_else(|| "편집 엔진이 없습니다".to_string())?;
    let ffprobe = find_ffprobe(app, &ffmpeg);

    // 클립마다 소리가 있는지 확인 — 없으면 무음 소스를 붙여야 필터가 실패하지 않는다.
    let mut has_audio: Vec<bool> = Vec::new();
    for clip in &spec.clips {
        if clip.kind == "image" {
            has_audio.push(false);
            continue;
        }
        let probe = ffprobe
            .as_ref()
            .and_then(|probe| probe_has_audio(probe, Path::new(&clip.path)).ok());
        has_audio.push(probe.unwrap_or(true));
    }

    let total: f64 = {
        let mut sum = 0.0;
        for (index, clip) in spec.clips.iter().enumerate() {
            sum += clip_visible(clip);
            if index > 0 {
                sum -= boundary_duration(clip, clip_visible(&spec.clips[index - 1]));
            }
        }
        sum.max(0.1)
    };

    let mut temp_files: Vec<PathBuf> = Vec::new();
    let graph = build_graph(app, spec, &has_audio, &mut temp_files)?;

    let fps = if spec.fps == 0 { 30 } else { spec.fps };
    let out = PathBuf::from(&spec.output);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("저장 폴더를 만들지 못했습니다: {error}"))?;
    }

    let bitrate = match spec.height {
        h if h >= 2000 => "45M",
        h if h >= 1400 => "22M",
        h if h >= 1000 => "12M",
        _ => "7M",
    };

    let mut attempts: Vec<(&str, Vec<String>)> = Vec::new();
    attempts.push(("h264_videotoolbox", vec![
        "-c:v".into(), "h264_videotoolbox".into(),
        "-b:v".into(), bitrate.into(),
        "-allow_sw".into(), "1".into(),
    ]));
    attempts.push(("libx264", vec![
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "medium".into(),
        "-crf".into(), "20".into(),
    ]));

    let started = std::time::Instant::now();
    let mut last_error = String::new();

    for (encoder, encoder_args) in attempts.iter() {
        if CANCEL.load(Ordering::SeqCst) {
            cleanup(&temp_files);
            return Err("내보내기를 취소했습니다".to_string());
        }
        let mut args: Vec<String> = vec![
            "-hide_banner".into(),
            "-nostdin".into(),
            "-y".into(),
            "-progress".into(),
            "pipe:1".into(),
            "-nostats".into(),
        ];
        args.extend(graph.inputs.clone());
        args.extend([
            "-filter_complex".into(),
            graph.complex.clone(),
            "-map".into(),
            "[vout]".into(),
            "-map".into(),
            "[aout]".into(),
            "-r".into(),
            fps.to_string(),
            "-pix_fmt".into(),
            "yuv420p".into(),
        ]);
        args.extend(encoder_args.clone());
        args.extend([
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-movflags".into(),
            "+faststart".into(),
        ]);
        args.push(out.to_string_lossy().to_string());

        let result = run_ffmpeg(app, &ffmpeg, &args, total);
        match result {
            Ok(()) => {
                let _ = fs::remove_file(out.with_extension("mp4.part"));
                cleanup(&temp_files);
                return Ok(ExportResult {
                    path: out.to_string_lossy().to_string(),
                    seconds: started.elapsed().as_secs_f64(),
                    encoder: (*encoder).to_string(),
                });
            }
            Err(error) => {
                if CANCEL.load(Ordering::SeqCst) {
                    cleanup(&temp_files);
                    return Err("내보내기를 취소했습니다".to_string());
                }
                last_error = error;
                // 첫 시도(하드웨어)가 실패하면 두 번째(libx264)로 넘어간다.
            }
        }
    }

    cleanup(&temp_files);
    Err(if last_error.is_empty() {
        "내보내기를 마치지 못했습니다".to_string()
    } else {
        last_error
    })
}

fn cleanup(files: &[PathBuf]) {
    for file in files {
        let _ = fs::remove_file(file);
    }
}

fn probe_has_audio(probe: &Path, media: &Path) -> Result<bool, String> {
    let output = Command::new(probe)
        .args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0"])
        .arg(media)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| error.to_string())?;
    Ok(!String::from_utf8_lossy(&output.stdout).trim().is_empty())
}

struct Graph {
    inputs: Vec<String>,
    complex: String,
}

fn build_graph(
    app: &AppHandle,
    spec: &ExportSpec,
    has_audio: &[bool],
    temp_files: &mut Vec<PathBuf>,
) -> Result<Graph, String> {
    let width = spec.width.max(16) - spec.width % 2;
    let height = spec.height.max(16) - spec.height % 2;
    let fps = if spec.fps == 0 { 30 } else { spec.fps };

    let mut inputs: Vec<String> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    let mut input_index = 0usize;
    let mut video_labels: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();

    for (index, clip) in spec.clips.iter().enumerate() {
        let span = (clip.trim_end - clip.trim_start).max(0.05);
        if clip.kind == "image" {
            inputs.push("-loop".into());
            inputs.push("1".into());
            inputs.push("-t".into());
            inputs.push(format!("{span:.3}"));
        } else {
            inputs.push("-ss".into());
            inputs.push(format!("{:.3}", clip.trim_start));
            inputs.push("-t".into());
            inputs.push(format!("{span:.3}"));
        }
        inputs.push("-i".into());
        inputs.push(clip.path.clone());

        let speed = if clip.kind == "image" { 1.0 } else { clip.speed.max(0.05) };
        let eq = format!(
            "eq=brightness={:.3}:contrast={:.3}:saturation={:.3}",
            clip.brightness.clamp(-1.0, 1.0),
            clip.contrast.clamp(0.0, 3.0),
            clip.saturation.clamp(0.0, 3.0)
        );
        parts.push(format!(
            "[{input_index}:v]trim=0:{span:.3},setpts=(PTS-STARTPTS)/{speed:.4},fps={fps},\
scale={width}:{height}:force_original_aspect_ratio=decrease,\
pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,{eq},format=yuv420p[v{index}]"
        ));
        video_labels.push(format!("v{index}"));

        let visible = clip_visible(clip);
        if has_audio.get(index).copied().unwrap_or(false) {
            let mut chain: Vec<String> = vec![
                "aresample=48000".into(),
                "aformat=sample_fmts=fltp:channel_layouts=stereo".into(),
            ];
            let tempo = atempo_chain(speed);
            if !tempo.is_empty() {
                chain.push(tempo);
            }
            chain.push(format!("asetpts=PTS-STARTPTS"));
            chain.push(format!("volume={:.3}", clip.volume.clamp(0.0, 4.0)));
            if clip.fade_in > 0.01 {
                chain.push(format!("afade=t=in:st=0:d={:.3}", clip.fade_in.min(visible)));
            }
            if clip.fade_out > 0.01 {
                let start = (visible - clip.fade_out).max(0.0);
                chain.push(format!("afade=t=out:st={start:.3}:d={:.3}", clip.fade_out.min(visible)));
            }
            chain.push("apad".into());
            chain.push(format!("atrim=0:{visible:.3}"));
            parts.push(format!("[{input_index}:a]{}[a{index}]", chain.join(",")));
        } else {
            parts.push(format!(
                "anullsrc=r=48000:cl=stereo,atrim=0:{visible:.3},asetpts=PTS-STARTPTS[a{index}]"
            ));
        }
        audio_labels.push(format!("a{index}"));
        input_index += 1;
    }

    // 이어 붙이기 — 전환은 xfade, 소리는 acrossfade 로 같은 길이만큼 겹친다.
    let mut current_v = video_labels[0].clone();
    let mut current_a = audio_labels[0].clone();
    let mut offset = 0.0;
    for index in 1..spec.clips.len() {
        let previous = clip_visible(&spec.clips[index - 1]);
        let duration = boundary_duration(&spec.clips[index], previous);
        offset += previous - duration;
        let name = if spec.clips[index].transition.as_ref().map(|item| item.duration).unwrap_or(0.0) > 0.0 {
            transition_name(&spec.clips[index])
        } else {
            "fade".to_string()
        };
        let next_v = format!("vx{index}");
        parts.push(format!(
            "[{current_v}][{current_v_in}]xfade=transition={name}:duration={duration:.3}:offset={offset:.3}[{next_v}]",
            current_v_in = video_labels[index]
        ));
        let next_a = format!("ax{index}");
        parts.push(format!(
            "[{current_a}][{current_a_in}]acrossfade=d={duration:.3}:c1=tri:c2=tri[{next_a}]",
            current_a_in = audio_labels[index]
        ));
        current_v = next_v;
        current_a = next_a;
    }

    let mut video_out = current_v;
    let mut audio_out = current_a;

    // BGM — 시작 지연·볼륨·페이드.
    let mut mix_labels: Vec<String> = Vec::new();
    for (index, audio) in spec.audios.iter().enumerate() {
        inputs.push("-i".into());
        inputs.push(audio.path.clone());
        let mut chain: Vec<String> = vec![
            "aresample=48000".into(),
            "aformat=sample_fmts=fltp:channel_layouts=stereo".into(),
            format!("volume={:.3}", audio.volume.clamp(0.0, 4.0)),
        ];
        if audio.fade_in > 0.01 {
            chain.push(format!("afade=t=in:st=0:d={:.3}", audio.fade_in));
        }
        if audio.fade_out > 0.01 && audio.duration > 0.0 {
            let start = (audio.duration - audio.fade_out).max(0.0);
            chain.push(format!("afade=t=out:st={start:.3}:d={:.3}", audio.fade_out));
        }
        if audio.start > 0.01 {
            let delay = (audio.start * 1000.0).round() as i64;
            chain.push(format!("adelay={delay}|{delay}"));
        }
        let label = format!("bgm{index}");
        parts.push(format!("[{input_index}:a]{}[{label}]", chain.join(",")));
        mix_labels.push(label);
        input_index += 1;
    }
    if !mix_labels.is_empty() {
        let mut list = format!("[{audio_out}]");
        for label in &mix_labels {
            list.push_str(&format!("[{label}]"));
        }
        parts.push(format!(
            "{list}amix=inputs={}:duration=first:dropout_transition=0:normalize=0[amixed]",
            mix_labels.len() + 1
        ));
        audio_out = "amixed".to_string();
    }

    // 자막 — 글자는 임시 파일에 넣는다.
    let font_for = |item: &ExportSubtitle| -> Result<PathBuf, String> {
        if let Some(path) = &item.font_file {
            let candidate = PathBuf::from(path);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        let bundled = bundled_font(app);
        let key = item.font.trim().to_lowercase();
        let system: Option<&str> = match key.as_str() {
            "helvetica" => Some("/System/Library/Fonts/Helvetica.ttc"),
            "helvetica-neue" => Some("/System/Library/Fonts/HelveticaNeue.ttc"),
            "arial" => Some("/System/Library/Fonts/Supplemental/Arial.ttf"),
            "georgia" => Some("/System/Library/Fonts/Supplemental/Georgia.ttf"),
            "impact" => Some("/System/Library/Fonts/Supplemental/Impact.ttf"),
            "apple-gothic" => Some("/System/Library/Fonts/Supplemental/AppleGothic.ttf"),
            "menlo" => Some("/System/Library/Fonts/Menlo.ttc"),
            _ => None,
        };
        if let Some(path) = system {
            let candidate = PathBuf::from(path);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
        if let Some(path) = bundled {
            return Ok(path);
        }
        if let Some(path) = system {
            // 파일이 없어도 경로는 넘겨 본다(설치된 macOS 에는 늘 있다).
            return Ok(PathBuf::from(path));
        }
        Err("자막에 쓸 글꼴을 찾지 못했습니다".to_string())
    };

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    for (index, item) in spec.subtitles.iter().enumerate() {
        if item.text.trim().is_empty() || item.end <= item.start {
            continue;
        }
        let text_file = std::env::temp_dir().join(format!("tip-subtitle-{stamp}-{index}.txt"));
        fs::write(&text_file, &item.text).map_err(|error| format!("자막을 쓰지 못했습니다: {error}"))?;
        temp_files.push(text_file.clone());
        let font = font_for(item)?;
        let next = format!("vt{index}");
        parts.push(drawtext_filter(item, &text_file, &font, &next, &video_out, height));
        video_out = next;
    }

    if video_out != "vout" {
        parts.push(format!("[{video_out}]null[vout]"));
    }
    if audio_out != "aout" {
        parts.push(format!("[{audio_out}]anull[aout]"));
    }

    Ok(Graph {
        inputs,
        complex: parts.join(";"),
    })
}

fn bundled_font(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join(BIN_DIR).join("fonts");
    let target = dir.join("Pretendard-Regular.otf");
    if target.is_file() {
        return Some(target);
    }
    let _ = fs::create_dir_all(&dir);
    // 앱 바이너리에 담아 둔 Pretendard(OFL)를 처음 한 번 꺼내 쓴다.
    fs::write(&target, include_bytes!("../assets/Pretendard-Regular.otf")).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o644));
    }
    Some(target)
}

fn run_ffmpeg(
    app: &AppHandle,
    ffmpeg: &Path,
    args: &[String],
    total: f64,
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("편집 엔진을 실행하지 못했습니다: {error}"))?;
    RUNNING_PID.store(child.id() as u64, Ordering::SeqCst);

    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let mut out_time = 0.0f64;

    // stdout 의 -progress 줄을 읽어 진행률을 알린다.
    if let Some(pipe) = stdout.take() {
        let reader = BufReader::new(pipe);
        for line in reader.lines().flatten() {
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(micros) = value.trim().parse::<i64>() {
                    out_time = micros as f64 / 1_000_000.0;
                    let percent = if total > 0.01 { (out_time / total * 100.0).clamp(0.0, 99.0) } else { 0.0 };
                    if percent > 0.0 {
                        let _ = app.emit(
                            "tip://video-export-progress",
                            ExportProgress {
                                percent,
                                time: out_time,
                                total,
                                stage: "encoding".to_string(),
                            },
                        );
                    }
                }
            }
        }
    }

    let mut error_text = String::new();
    if let Some(pipe) = stderr.take() {
        let mut reader = BufReader::new(pipe);
        let mut text = String::new();
        let _ = reader.read_to_string(&mut text);
        error_text = text;
    }

    let status = child.wait().map_err(|error| format!("편집 엔진 상태를 읽지 못했습니다: {error}"))?;
    if status.success() {
        let _ = out_time;
        return Ok(());
    }
    if CANCEL.load(Ordering::SeqCst) {
        return Err("내보내기를 취소했습니다".to_string());
    }
    let tail: Vec<&str> = error_text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .rev()
        .take(4)
        .collect();
    let summary = tail.into_iter().rev().collect::<Vec<_>>().join(" / ");
    Err(format!("편집 엔진이 실패했습니다: {summary}"))
}

/* ------------------------------ macOS 패널 ------------------------------ */

#[cfg(target_os = "macos")]
fn activate_app() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
}

#[cfg(target_os = "macos")]
fn pick_media_panel(kind: &str) -> Result<Vec<PickedMedia>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;

    let message = match kind {
        "image" => "편집에 넣을 이미지를 고르세요.",
        "audio" => "배경 음악이나 소리 파일을 고르세요.",
        _ => "편집에 넣을 영상·이미지를 고르세요.",
    };
    let title = match kind {
        "image" => "이미지 추가",
        "audio" => "오디오 추가",
        _ => "미디어 추가",
    };

    let mtm = MainThreadMarker::new().ok_or_else(|| "화면 스레드를 찾지 못했습니다".to_string())?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setTitle(Some(&NSString::from_str(title)));
    panel.setMessage(Some(&NSString::from_str(message)));
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(true);
    panel.setResolvesAliases(true);
    activate_app();
    if panel.runModal() != NSModalResponseOK {
        return Ok(Vec::new());
    }
    let urls = panel.URLs();
    let mut out = Vec::new();
    for url in urls.iter() {
        let Some(path) = url.path() else { continue };
        let path = path.to_string();
        let name = url
            .lastPathComponent()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "file".to_string());
        let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        out.push(PickedMedia {
            kind: media_kind(&path),
            path,
            name,
            size,
        });
    }
    Ok(out)
}

#[cfg(target_os = "macos")]
fn pick_font_panel() -> Result<Option<PickedMedia>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new().ok_or_else(|| "화면 스레드를 찾지 못했습니다".to_string())?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setTitle(Some(&NSString::from_str("자막 글꼴 파일")));
    panel.setMessage(Some(&NSString::from_str(".ttf 또는 .otf 글꼴 파일을 고르세요.")));
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(false);
    activate_app();
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let url = panel.URL().ok_or_else(|| "글꼴을 고르지 못했습니다".to_string())?;
    let path = url.path().map(|value| value.to_string()).ok_or_else(|| "글꼴 경로를 읽지 못했습니다".to_string())?;
    let name = url
        .lastPathComponent()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "font".to_string());
    let size = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    Ok(Some(PickedMedia {
        path,
        name,
        kind: "font".to_string(),
        size,
    }))
}

#[cfg(target_os = "macos")]
fn save_panel(name: &str) -> Result<Option<String>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new().ok_or_else(|| "화면 스레드를 찾지 못했습니다".to_string())?;
    let panel = NSSavePanel::savePanel(mtm);
    panel.setTitle(Some(&NSString::from_str("편집한 영상 저장")));
    panel.setMessage(Some(&NSString::from_str("MP4 파일로 저장합니다.")));
    panel.setNameFieldStringValue(&NSString::from_str(name));
    panel.setCanCreateDirectories(true);
    activate_app();
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let url = panel.URL().ok_or_else(|| "저장 위치를 읽지 못했습니다".to_string())?;
    Ok(url.path().map(|value| value.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn pick_media_panel(_kind: &str) -> Result<Vec<PickedMedia>, String> {
    Err("파일 고르기는 macOS 앱에서만 됩니다".to_string())
}

#[cfg(not(target_os = "macos"))]
fn pick_font_panel() -> Result<Option<PickedMedia>, String> {
    Err("파일 고르기는 macOS 앱에서만 됩니다".to_string())
}

#[cfg(not(target_os = "macos"))]
fn save_panel(_name: &str) -> Result<Option<String>, String> {
    Err("저장 위치 고르기는 macOS 앱에서만 됩니다".to_string())
}

fn media_kind(path: &str) -> String {
    let lower = path.to_lowercase();
    let image_ext = [".jpg", ".jpeg", ".png", ".heic", ".webp", ".gif", ".bmp", ".tif", ".tiff"];
    let audio_ext = [".mp3", ".m4a", ".aac", ".wav", ".aiff", ".flac", ".ogg"];
    if image_ext.iter().any(|ext| lower.ends_with(ext)) {
        "image".to_string()
    } else if audio_ext.iter().any(|ext| lower.ends_with(ext)) {
        "audio".to_string()
    } else {
        "video".to_string()
    }
}
