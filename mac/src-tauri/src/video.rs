// TIP · 영상 편집(video-editor) 엔진 — v1.24.0
//
// 하는 일 네 가지.
//   1) 온디맨드 ffmpeg/ffprobe — .dmg 를 가볍게 두려고 앱에 넣지 않는다. 사용자가 영상 편집을
//      열었을 때 (a) 앱 전용 폴더(app_data_dir/bin), (b) 이미 설치된 Homebrew 경로 순으로 찾고,
//      없으면 화면의 '고속 편집 엔진 다운로드' 버튼이 공식 정적 빌드를 받아 SHA-256 을 대조한 뒤
//      실행 권한(0755)을 주고 저장한다.
//      내려받는 곳: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.0 (ffmpeg 6.0 정적 빌드)
//      URL·해시는 실제 릴리스 자산을 받아 직접 확인한 값이다(가짜 해시 금지).
//   2) 영상 내보내기 — 클립·전환(xfade)·오버레이(PIP)·줌/팬(zoompan)·자막(drawtext)·BGM(amix)·
//      배속·색감·페이드를 한 번의 ffmpeg 실행으로 합쳐 MP4 로 저장한다. h264_videotoolbox 로 먼저
//      시도하고, 실패하면 libx264 로 다시 한다. 진행률은 tip://video-export-progress 로 알린다.
//   3) 자동 자막 — whisper.cpp CLI(whisper-cli)와 ggml 모델을 버튼을 누를 때만 받아(같은 방식으로
//      SHA-256 대조·0755) 타임라인 소리를 16kHz 모노 WAV 로 뽑아 받아 적고, 구간별 자막을 돌려준다.
//      진행률은 tip://video-whisper-progress.
//   4) 파일 고르기 — macOS 의 NSOpenPanel/NSSavePanel 로 경로를 받는다. 고른 경로만 허용 목록에
//      담아 두고, 내보내기는 그 목록에 있는 파일만 읽는다(화면이 임의 경로를 넘기지 못한다).
//      프로젝트 파일(.tipproj)로 되살린 경로는 video_project_media 로만 목록에 들어간다.
//
// 보안: 앱 커맨드는 이 창(tool/main)에서만 부를 수 있다(capabilities/default.json).
//       ffmpeg·whisper 에 넘기는 경로는 사용자가 방금 고른 파일과 앱이 만든 임시·결과 파일뿐이다.

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

use crate::video_graph::{self, ExportSpec, Graph, GraphEnv};

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

/// 자동 자막 엔진 — whisper.cpp CLI 정적 빌드(zip)와 ggml 모델.
/// 아래 해시는 2026-11-27 에 실제로 내려받아 `sha256sum` 으로 확인한 값이다.
///   whisper-cli: https://github.com/sjoerdteunisse/whisper.cpp/releases/tag/v1.0.0
///   모델: https://huggingface.co/ggerganov/whisper.cpp (ggml-base.bin, 141MB)
const WHISPER_TAG: &str = "v1.0.0";
const WHISPER_BASE: &str = "https://github.com/sjoerdteunisse/whisper.cpp/releases/download";
const WHISPER_ARM64: (&str, &str) = (
    "whisper-cpp-darwin-arm64.zip",
    "d033bd3f590cad50f39957bf86354f87b44394cb001e3f78a7b47264358103e3",
);
const WHISPER_X64: (&str, &str) = (
    "whisper-cpp-darwin-x64.zip",
    "f0f2ab6c2e92b7022ac02f0759a7a38f3ea110764e00b05a6f0d6c1dcadd571c",
);
const MODEL_NAME: &str = "ggml-base.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_SHA256: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const MODEL_BYTES: u64 = 147_951_465;

/// 사용자가 고른 파일 경로 — 내보내기는 이 목록에 있는 경로만 읽는다.
static PICKED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// 지금 내보내는 중인지 — 한 번에 하나만.
static EXPORTING: AtomicBool = AtomicBool::new(false);
/// 취소 요청.
static CANCEL: AtomicBool = AtomicBool::new(false);
/// 실행 중인 ffmpeg 의 프로세스 id — 취소할 때 죽인다.
static RUNNING_PID: AtomicU64 = AtomicU64::new(0);
/// 받아 적기(whisper) 취소 — ffmpeg 과 따로 둔다.
static TRANSCRIBE_CANCEL: AtomicBool = AtomicBool::new(false);
static TRANSCRIBE_PID: AtomicU64 = AtomicU64::new(0);
static TRANSCRIBING: AtomicBool = AtomicBool::new(false);

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

/// 무음 구간 찾기 — ffmpeg silencedetect 로 [start, end] 사이의 무음을 돌려준다.
/// 돌려주는 시각은 클립 시작(trimStart)을 0 으로 한 상대 초다.
#[derive(Serialize)]
pub struct SilenceRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Serialize)]
pub struct SilenceResult {
    pub ranges: Vec<SilenceRange>,
}

#[tauri::command]
pub async fn video_silence(
    app: AppHandle,
    path: String,
    start: f64,
    end: f64,
    threshold: f64,
    min_silence: f64,
) -> Result<SilenceResult, String> {
    // ffmpeg 를 기다리는 동안 화면이 멈추지 않게 별도 스레드에서 돈다(긴 영상에서 몇 초 걸린다).
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_silence(&handle, &path, start, end, threshold, min_silence))
        .await
        .map_err(|error| format!("무음을 찾지 못했습니다: {error}"))?
}

fn run_silence(
    app: &AppHandle,
    path: &str,
    start: f64,
    end: f64,
    threshold: f64,
    min_silence: f64,
) -> Result<SilenceResult, String> {
    let (ffmpeg, _) = find_engine(app);
    let ffmpeg = ffmpeg.ok_or_else(|| "편집 엔진이 없습니다".to_string())?;
    check_allowed(Path::new(path))?;
    let from = start.max(0.0);
    let span = (end - from).max(0.1);
    let noise = threshold.clamp(-80.0, -5.0);
    let minimum = min_silence.clamp(0.1, 5.0);
    let output = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-ss",
            &format!("{from:.3}"),
            "-t",
            &format!("{span:.3}"),
            "-i",
            path,
            "-af",
            &format!("silencedetect=noise={noise:.0}dB:d={minimum:.2}"),
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("무음을 찾지 못했습니다: {error}"))?;
    let text = String::from_utf8_lossy(&output.stderr).to_string();
    let mut ranges: Vec<SilenceRange> = Vec::new();
    let mut opened: Option<f64> = None;
    for line in text.lines() {
        if let Some(at) = line.find("silence_start: ") {
            let rest = &line[at + "silence_start: ".len()..];
            opened = rest
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());
        } else if let Some(at) = line.find("silence_end: ") {
            let rest = &line[at + "silence_end: ".len()..];
            let value = rest
                .split_whitespace()
                .next()
                .and_then(|item| item.parse::<f64>().ok());
            if let (Some(begin), Some(finish)) = (opened.take(), value) {
                ranges.push(SilenceRange { start: begin.max(0.0), end: finish.min(span) });
            }
        }
    }
    if let Some(begin) = opened {
        ranges.push(SilenceRange { start: begin.max(0.0), end: span });
    }
    ranges.retain(|range| range.end - range.start >= 0.05);
    Ok(SilenceResult { ranges })
}

/// 그림(PNG base64)을 저장한다 — save=true 면 macOS 저장 창, false 면 임시 파일(프리즈 프레임용).
#[tauri::command]
pub fn video_save_png(data: String, name: String, save: bool) -> Result<Option<String>, String> {
    let bytes = video_graph::decode_png(&data)?;
    if !save {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("tip-still-{stamp}.png"));
        fs::write(&path, &bytes).map_err(|error| format!("그림을 쓰지 못했습니다: {error}"))?;
        return Ok(Some(path.to_string_lossy().to_string()));
    }
    #[cfg(target_os = "macos")]
    {
        let safe = if name.to_lowercase().ends_with(".png") { name } else { format!("{name}.png") };
        if let Some(path) = save_png_panel(&safe)? {
            fs::write(&path, &bytes).map_err(|error| format!("그림을 쓰지 못했습니다: {error}"))?;
            return Ok(Some(path));
        }
        return Ok(None);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = name;
        Err("그림 저장은 macOS 앱에서만 됩니다".to_string())
    }
}

#[cfg(target_os = "macos")]
fn save_png_panel(name: &str) -> Result<Option<String>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new().ok_or_else(|| "화면 스레드를 찾지 못했습니다".to_string())?;
    let panel = NSSavePanel::savePanel(mtm);
    panel.setTitle(Some(&NSString::from_str("스틸컷 저장")));
    panel.setMessage(Some(&NSString::from_str("지금 화면을 PNG 로 저장합니다.")));
    panel.setNameFieldStringValue(&NSString::from_str(name));
    panel.setCanCreateDirectories(true);
    activate_app();
    if panel.runModal() != NSModalResponseOK {
        return Ok(None);
    }
    let url = panel.URL().ok_or_else(|| "저장 위치를 읽지 못했습니다".to_string())?;
    Ok(url.path().map(|value| value.to_string()))
}

#[tauri::command]
pub fn video_cancel_export() {
    CANCEL.store(true, Ordering::SeqCst);
    let pid = RUNNING_PID.load(Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).status();
    }
}

/// 내보내기를 취소한다 — 받아 적기도 함께 멈춘다.
#[tauri::command]
pub fn video_cancel_transcribe() {
    TRANSCRIBE_CANCEL.store(true, Ordering::SeqCst);
    let pid = TRANSCRIBE_PID.load(Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).status();
    }
}

/// 프로젝트 파일(.tipproj)로 되살린 원본 경로를 허용 목록에 넣는다.
/// 확장자가 미디어(.mp4·.mov·.mp3 …)이고 실제로 있는 파일만 받는다.
#[tauri::command]
pub fn video_project_media(paths: Vec<String>) -> Result<Vec<PickedMedia>, String> {
    const MAX_PATHS: usize = 300;
    let mut allowed = PICKED
        .lock()
        .map_err(|_| "허용 목록을 잠그지 못했습니다".to_string())?;
    let list = allowed.get_or_insert_with(HashSet::new);
    let mut out = Vec::new();
    for path in paths.into_iter().take(MAX_PATHS) {
        let target = PathBuf::from(&path);
        if !target.is_file() || !has_media_extension(&path) {
            continue;
        }
        let size = fs::metadata(&target).map(|meta| meta.len()).unwrap_or(0);
        let name = target
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());
        list.insert(target.clone());
        out.push(PickedMedia {
            path,
            name,
            kind: media_kind(&target.to_string_lossy()),
            size,
        });
    }
    Ok(out)
}

fn has_media_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    const VIDEO: [&str; 10] = [
        ".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mpg", ".mpeg", ".ts", ".wmv",
    ];
    const IMAGE: [&str; 9] = [
        ".jpg", ".jpeg", ".png", ".heic", ".webp", ".gif", ".bmp", ".tif", ".tiff",
    ];
    const AUDIO: [&str; 7] = [".mp3", ".m4a", ".aac", ".wav", ".aiff", ".flac", ".ogg"];
    VIDEO.iter().any(|ext| lower.ends_with(ext))
        || IMAGE.iter().any(|ext| lower.ends_with(ext))
        || AUDIO.iter().any(|ext| lower.ends_with(ext))
}

/* ------------------------------ 자동 자막 (whisper.cpp) ------------------------------ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStatus {
    pub available: bool,
    pub binary: Option<String>,
    pub model: Option<String>,
    pub model_size: Option<u64>,
    pub binary_dir: String,
    pub download_size: Option<u64>,
    pub message: Option<String>,
}

fn one() -> f64 {
    1.0
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeClip {
    pub path: String,
    #[serde(default)]
    pub trim_start: f64,
    #[serde(default)]
    pub trim_end: f64,
    #[serde(default = "one")]
    pub speed: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeSpec {
    pub clips: Vec<TranscribeClip>,
    #[serde(default)]
    pub language: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub segments: Vec<TranscribeSegment>,
    pub model: String,
    pub seconds: f64,
}

/// whisper-cli 와 모델의 자리 — bin/whisper-cli, bin/models/ggml-base.bin.
fn whisper_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    let dir = binary_dir(app)?;
    Some((dir.join("whisper-cli"), dir.join("models").join(MODEL_NAME)))
}

fn whisper_status(app: &AppHandle) -> WhisperStatus {
    let (binary, model) = match whisper_paths(app) {
        Some(pair) => pair,
        None => {
            return WhisperStatus {
                available: false,
                binary: None,
                model: None,
                model_size: None,
                binary_dir: String::new(),
                download_size: Some(MODEL_BYTES + 3 * 1024 * 1024),
                message: Some("앱 데이터 폴더를 찾지 못했습니다".to_string()),
            }
        }
    };
    let has_binary = binary.is_file();
    let has_model = model.is_file();
    WhisperStatus {
        available: has_binary && has_model,
        binary: if has_binary { Some(binary.to_string_lossy().to_string()) } else { None },
        model: if has_model { Some(MODEL_NAME.to_string()) } else { None },
        model_size: if has_model { fs::metadata(&model).ok().map(|meta| meta.len()) } else { None },
        binary_dir: binary.parent().map(|dir| dir.to_string_lossy().to_string()).unwrap_or_default(),
        download_size: if has_binary && has_model { None } else { Some(MODEL_BYTES + 3 * 1024 * 1024) },
        message: if has_binary && has_model { None } else { Some("자동 자막 엔진을 아직 받지 않았습니다".to_string()) },
    }
}

#[tauri::command]
pub fn video_whisper_status(app: AppHandle) -> WhisperStatus {
    whisper_status(&app)
}

/// whisper-cli(zip)와 ggml 모델을 받는다 — 둘 다 SHA-256 이 맞을 때만 저장한다.
#[tauri::command]
pub async fn video_whisper_download(app: AppHandle) -> Result<WhisperStatus, String> {
    let dir = binary_dir(&app).ok_or_else(|| "앱 데이터 폴더를 찾지 못했습니다".to_string())?;
    let models = dir.join("models");
    fs::create_dir_all(&models).map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
    let messages = whisper_paths(&app).ok_or_else(|| "앱 데이터 폴더를 찾지 못했습니다".to_string())?;
    let (binary, model) = messages;

    let (asset, hash) = if arch_name() == "arm64" { WHISPER_ARM64 } else { WHISPER_X64 };
    let url = format!("{WHISPER_BASE}/{WHISPER_TAG}/{asset}");
    let zip = dir.join("whisper-cli.zip");
    fetch_asset(&app, &url, &zip, 0.0, 25.0).await?;
    let actual = crate::sha256_file(&zip)?;
    if !actual.eq_ignore_ascii_case(hash) {
        let _ = fs::remove_file(&zip);
        return Err(format!(
            "내려받은 자동 자막 엔진의 해시가 다릅니다(기대 {hash}, 실제 {actual}). 안전을 위해 저장하지 않았습니다."
        ));
    }

    // zip 풀기 — macOS 의 ditto 를 쓴다(추가 크레이트 없이).
    let extract = dir.join("whisper-extract");
    let _ = fs::remove_dir_all(&extract);
    fs::create_dir_all(&extract).map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
    let unpacked = Command::new("/usr/bin/ditto")
        .arg("-x")
        .arg("-k")
        .arg(&zip)
        .arg(&extract)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("압축을 풀지 못했습니다: {error}"))?;
    if !unpacked.success() {
        let _ = fs::remove_dir_all(&extract);
        let _ = fs::remove_file(&zip);
        return Err("자동 자막 엔진의 압축을 풀지 못했습니다".to_string());
    }
    let mut source: Option<PathBuf> = None;
    if let Ok(entries) = fs::read_dir(&extract) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with("whisper") {
                source = Some(path);
                break;
            }
            if source.is_none() {
                source = Some(path);
            }
        }
    }
    let source = source.ok_or_else(|| "압축 안에서 실행 파일을 찾지 못했습니다".to_string())?;
    let _ = fs::remove_file(&binary);
    fs::rename(&source, &binary).map_err(|error| format!("엔진을 저장하지 못했습니다: {error}"))?;
    let _ = fs::remove_dir_all(&extract);
    let _ = fs::remove_file(&zip);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&binary, fs::Permissions::from_mode(0o755));
    }
    // arm64 는 서명이 없으면 실행되지 않는다 — 임시(ad-hoc) 서명을 붙인다(실패해도 이미 서명된 경우가 많다).
    let _ = Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-"])
        .arg(&binary)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    // 모델 — 내려받은 뒤 크기와 해시를 함께 본다.
    let temp = models.join(format!("{MODEL_NAME}.part"));
    fetch_asset(&app, MODEL_URL, &temp, 25.0, 75.0).await?;
    let size = fs::metadata(&temp).map(|meta| meta.len()).unwrap_or(0);
    if size != MODEL_BYTES {
        let _ = fs::remove_file(&temp);
        return Err(format!("모델 크기가 다릅니다(기대 {MODEL_BYTES}, 실제 {size}). 안전을 위해 저장하지 않았습니다."));
    }
    let actual = crate::sha256_file(&temp)?;
    if !actual.eq_ignore_ascii_case(MODEL_SHA256) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "모델의 해시가 다릅니다(기대 {MODEL_SHA256}, 실제 {actual}). 안전을 위해 저장하지 않았습니다."
        ));
    }
    let _ = fs::remove_file(&model);
    fs::rename(&temp, &model).map_err(|error| format!("모델을 저장하지 못했습니다: {error}"))?;

    let _ = app.emit(
        "tip://video-whisper-progress",
        serde_json::json!({ "stage": "done", "percent": 100.0 }),
    );
    Ok(whisper_status(&app))
}

/// 파일 하나를 받아 `target` 에 쓰면서 `tip://video-whisper-progress` 로 진행률을 알린다.
async fn fetch_asset(
    app: &AppHandle,
    url: &str,
    target: &Path,
    base_percent: f64,
    span_percent: f64,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60))
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
            let percent = base_percent + received as f64 / total as f64 * span_percent;
            let _ = app.emit(
                "tip://video-whisper-progress",
                serde_json::json!({ "stage": "download", "percent": percent, "received": received, "total": total }),
            );
        }
    }
    drop(file);
    Ok(())
}

#[tauri::command]
pub async fn video_transcribe(app: AppHandle, spec: TranscribeSpec) -> Result<TranscribeResult, String> {
    if spec.clips.is_empty() {
        return Err("받아 적을 영상이 없습니다".to_string());
    }
    for clip in &spec.clips {
        check_allowed(Path::new(&clip.path))?;
    }
    let (binary, model) = whisper_paths(&app).ok_or_else(|| "앱 데이터 폴더를 찾지 못했습니다".to_string())?;
    if !binary.is_file() || !model.is_file() {
        return Err("자동 자막 엔진이 아직 없습니다. 먼저 내려받아 주세요.".to_string());
    }
    if TRANSCRIBING.swap(true, Ordering::SeqCst) {
        return Err("이미 자막을 만드는 중입니다".to_string());
    }
    TRANSCRIBE_CANCEL.store(false, Ordering::SeqCst);

    let handle = app.clone();
    let clips = spec.clips.clone();
    let language = spec.language.clone();
    let work = tauri::async_runtime::spawn_blocking(move || {
        run_transcribe(&handle, &binary, &model, &clips, &language)
    });
    let result = work
        .await
        .map_err(|error| format!("받아 적기를 마치지 못했습니다: {error}"))?;
    TRANSCRIBING.store(false, Ordering::SeqCst);
    TRANSCRIBE_PID.store(0, Ordering::SeqCst);
    result
}

fn run_transcribe(
    app: &AppHandle,
    binary: &Path,
    model: &Path,
    clips: &[TranscribeClip],
    language: &str,
) -> Result<TranscribeResult, String> {
    let started = std::time::Instant::now();
    let (ffmpeg, _) = find_engine(app);
    let ffmpeg = ffmpeg.ok_or_else(|| "편집 엔진(ffmpeg)이 필요합니다".to_string())?;
    let ffprobe = find_ffprobe(app, &ffmpeg);

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tip-whisper-{stamp}"));
    fs::create_dir_all(&dir).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;
    let wav = dir.join("speech.wav");
    let prefix = dir.join("result");

    let _ = app.emit(
        "tip://video-whisper-progress",
        serde_json::json!({ "stage": "extract", "percent": 1.0 }),
    );
    if let Err(error) = build_speech_wav(&ffmpeg, ffprobe.as_deref(), clips, &wav) {
        let _ = fs::remove_dir_all(&dir);
        return Err(error);
    }
    if TRANSCRIBE_CANCEL.load(Ordering::SeqCst) {
        let _ = fs::remove_dir_all(&dir);
        return Err("자막 만들기를 취소했습니다".to_string());
    }

    let threads = std::thread::available_parallelism()
        .map(|value| value.get().clamp(2, 8))
        .unwrap_or(4);
    let mut command = Command::new(binary);
    command
        .arg("-m")
        .arg(model)
        .arg("-f")
        .arg(&wav)
        .arg("-oj")
        .arg("-of")
        .arg(&prefix)
        .arg("-np")
        .arg("--print-progress")
        .arg("-t")
        .arg(threads.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if !language.is_empty() && language != "auto" {
        command.arg("-l").arg(language);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("자동 자막 엔진을 실행하지 못했습니다: {error}"))?;
    TRANSCRIBE_PID.store(child.id() as u64, Ordering::SeqCst);

    let mut error_text = String::new();
    if let Some(pipe) = child.stderr.take() {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            if let Some(at) = line.find("progress =") {
                let number: String = line[at + 10..]
                    .chars()
                    .filter(|ch| ch.is_ascii_digit())
                    .collect();
                if let Ok(percent) = number.parse::<f64>() {
                    let _ = app.emit(
                        "tip://video-whisper-progress",
                        serde_json::json!({ "stage": "transcribe", "percent": 4.0 + percent * 0.96 }),
                    );
                }
            } else if line.to_lowercase().contains("error") {
                error_text.push_str(&line);
                error_text.push('\n');
            }
        }
    }
    let status = child.wait().map_err(|error| format!("받아 적기 상태를 읽지 못했습니다: {error}"))?;
    if TRANSCRIBE_CANCEL.load(Ordering::SeqCst) {
        let _ = fs::remove_dir_all(&dir);
        return Err("자막 만들기를 취소했습니다".to_string());
    }
    if !status.success() {
        let _ = fs::remove_dir_all(&dir);
        let summary = error_text.trim();
        return Err(if summary.is_empty() {
            "받아 적기가 끝나지 않았습니다".to_string()
        } else {
            format!("받아 적기가 실패했습니다: {summary}")
        });
    }

    let json_path = prefix.with_extension("json");
    let text = fs::read_to_string(&json_path)
        .map_err(|error| format!("받아 적은 결과를 읽지 못했습니다: {error}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "받아 적은 결과를 해석하지 못했습니다".to_string())?;
    let mut segments = Vec::new();
    if let Some(list) = parsed.get("transcription").and_then(|value| value.as_array()) {
        for item in list {
            let from = item
                .get("offsets")
                .and_then(|value| value.get("from"))
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0)
                / 1000.0;
            let to = item
                .get("offsets")
                .and_then(|value| value.get("to"))
                .and_then(|value| value.as_f64())
                .unwrap_or(from * 1000.0 + 500.0)
                / 1000.0;
            let text = item
                .get("text")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if text.is_empty() || text == "[BLANK_AUDIO]" {
                continue;
            }
            segments.push(TranscribeSegment {
                start: from.max(0.0),
                end: to.max(from + 0.3),
                text,
            });
        }
    }
    let _ = fs::remove_dir_all(&dir);
    Ok(TranscribeResult {
        segments,
        model: MODEL_NAME.to_string(),
        seconds: started.elapsed().as_secs_f64(),
    })
}

/// 타임라인 소리를 16kHz 모노 WAV 로 뽑는다 — 내보내기와 같은 자르기·배속·겹침을 쓴다.
fn build_speech_wav(
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    clips: &[TranscribeClip],
    out: &Path,
) -> Result<(), String> {
    let mut inputs: Vec<String> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    let mut labels: Vec<String> = Vec::new();

    for (index, clip) in clips.iter().enumerate() {
        let span = (clip.trim_end - clip.trim_start).max(0.05);
        let speed = clip.speed.max(0.05);
        let visible = span / speed;
        inputs.push("-ss".into());
        inputs.push(format!("{:.3}", clip.trim_start));
        inputs.push("-t".into());
        inputs.push(format!("{span:.3}"));
        inputs.push("-i".into());
        inputs.push(clip.path.clone());
        let has_audio = ffprobe
            .and_then(|probe| probe_has_audio(probe, Path::new(&clip.path)).ok())
            .unwrap_or(false);
        if has_audio {
            let mut chain: Vec<String> = vec![
                "aresample=16000".into(),
                "aformat=sample_fmts=s16:channel_layouts=mono".into(),
            ];
            let tempo = video_graph::atempo_chain(speed);
            if !tempo.is_empty() {
                chain.push(tempo);
            }
            chain.push("asetpts=PTS-STARTPTS".into());
            chain.push("apad".into());
            chain.push(format!("atrim=0:{visible:.3}"));
            parts.push(format!("[{index}:a]{}[s{index}]", chain.join(",")));
        } else {
            parts.push(format!(
                "anullsrc=r=16000:cl=mono,atrim=0:{visible:.3},asetpts=PTS-STARTPTS[s{index}]"
            ));
        }
        labels.push(format!("s{index}"));
    }

    let mut current = labels[0].clone();
    for index in 1..labels.len() {
        let previous = {
            let clip = &clips[index - 1];
            let span = (clip.trim_end - clip.trim_start).max(0.05);
            span / clip.speed.max(0.05)
        };
        let clip = &clips[index];
        let span = (clip.trim_end - clip.trim_start).max(0.05);
        let visible = span / clip.speed.max(0.05);
        // 겹침은 내보내기와 길은 기본값(한 프레임)을 쓴다.
        let overlap = 0.04f64.min(previous * 0.5).min(visible * 0.5).max(0.02);
        let next = format!("x{index}");
        parts.push(format!(
            "[{current}][{}]acrossfade=d={overlap:.3}:c1=tri:c2=tri[{next}]",
            labels[index]
        ));
        current = next;
    }
    parts.push(format!("[{current}]anull[sout]"));

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-nostdin".into(), "-y".into()];
    args.extend(inputs);
    args.extend([
        "-filter_complex".into(),
        parts.join(";"),
        "-map".into(),
        "[sout]".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-ar".into(),
        "16000".into(),
        "-ac".into(),
        "1".into(),
    ]);
    args.push(out.to_string_lossy().to_string());

    let output = Command::new(ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("소리를 뽑지 못했습니다: {error}"))?;
    if !output.status.success() {
        let text = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).rev().take(3).collect();
        return Err(format!("소리를 뽑지 못했습니다: {}", tail.into_iter().rev().collect::<Vec<_>>().join(" / ")));
    }
    Ok(())
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
    for overlay in &spec.overlays {
        check_allowed(Path::new(&overlay.path))?;
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

    let total = video_graph::total_visible(spec);

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

/// 앱이 가진 Pretendard·임시 폴더를 붙여 순수 그래프 빌더(video_graph)로 넘긴다.
fn build_graph(
    app: &AppHandle,
    spec: &ExportSpec,
    has_audio: &[bool],
    temp_files: &mut Vec<PathBuf>,
) -> Result<Graph, String> {
    let env = GraphEnv {
        bundled_font: bundled_font(app),
        temp_dir: std::env::temp_dir(),
    };
    video_graph::build_graph(spec, has_audio, &env, temp_files)
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
