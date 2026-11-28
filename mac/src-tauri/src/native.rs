// TIP · macOS 네이티브 도우미 (native.rs, v1.29.0)
//
// native/tip-native.swift 를 build.rs 가 컴파일해 이 바이너리에 넣어 두고(include_bytes),
// 처음 쓸 때 app_data_dir/bin/tip-native 로 꺼내 실행한다.
//
//   · 글자 추출 — Vision(VNRecognizeTextRequest). 추가 다운로드 0MB, 전부 기기 안에서.
//   · 화상 회의 — ScreenCaptureKit 으로 시스템 오디오만(상대방 목소리) WAV 로 담는다.
//
// 왜 앱 번들이 아니라 app_data_dir 인가
//   번들 안에 실행 파일을 넣으면 공증·서명 검사가 그 파일까지 본다. ffmpeg·whisper-cli 와 같이
//   앱 데이터 폴더에 꺼내 쓰면 번들 서명과 부딪히지 않고, arm64 에 필요한 ad-hoc 서명도 직접 준다.
//
// 안전
//   도우미에 넘기는 것은 (a) 우리가 만든 임시 이미지 파일 경로, (b) 우리가 만든 출력 WAV 경로뿐이다.
//   이미지 바이트는 이 파일이 만든 임시 폴더에만 쓰고 끝나면 지운다.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use serde::Serialize;
use tauri::AppHandle;

/// build.rs 가 넣어 둔 도우미 바이너리(다른 OS 에서는 빈 파일).
const TOOL_BYTES: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/tip-native"));
/// 임시 이미지·출력 파일 이름에 붙일 최대 크기 — 이보다 큰 그림은 읽지 않는다.
const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    pub confidence: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub text: String,
    pub lines: Vec<OcrLine>,
    pub confidence: f64,
    pub engine: String,
}

/// 도우미가 있는지 — 없으면(빌드할 때 swiftc 가 없었거나 다른 OS) 화면이 안내한다.
pub fn available() -> bool {
    !TOOL_BYTES.is_empty()
}

/// 앱 데이터 bin 폴더 → 도우미 경로. 처음 한 번 꺼내 두고, 크기가 다르면 다시 쓴다.
pub fn tool(app: &AppHandle) -> Result<PathBuf, String> {
    if TOOL_BYTES.is_empty() {
        return Err("이 빌드에는 macOS 네이티브 도우미가 없습니다".to_string());
    }
    let dir = crate::video::binary_dir(app).ok_or_else(|| "앱 데이터 폴더를 찾지 못했습니다".to_string())?;
    let path = dir.join("tip-native");
    let same = fs::metadata(&path)
        .map(|meta| meta.len() as usize == TOOL_BYTES.len())
        .unwrap_or(false);
    if !same {
        let temp = dir.join("tip-native.part");
        fs::write(&temp, TOOL_BYTES).map_err(|error| format!("도우미를 쓰지 못했습니다: {error}"))?;
        let _ = fs::remove_file(&path);
        fs::rename(&temp, &path).map_err(|error| format!("도우미를 저장하지 못했습니다: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o755));
        }
        // arm64 는 서명이 없으면 실행되지 않는다 — 임시(ad-hoc) 서명을 붙인다.
        let _ = Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-"])
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    Ok(path)
}

/// 이미지 바이트로 글자를 읽는다 — Vision. 언어는 "ko-KR" 같은 BCP-47 꼴.
pub fn ocr(app: &AppHandle, bytes: &[u8], languages: &[String]) -> Result<OcrResult, String> {
    if bytes.is_empty() {
        return Err("이미지가 비어 있습니다".to_string());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("이미지가 너무 큽니다(24MB 까지)".to_string());
    }
    let tool = tool(app)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tip-ocr-{stamp}"));
    fs::create_dir_all(&dir).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;
    let image = dir.join(format!("page.{}", guess_ext(bytes)));
    fs::write(&image, bytes).map_err(|error| format!("이미지를 쓰지 못했습니다: {error}"))?;

    let mut command = Command::new(&tool);
    command.arg("ocr").arg("--path").arg(&image);
    if !languages.is_empty() {
        command.arg("--lang").arg(languages.join(","));
    }
    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("글자 추출 도우미를 실행하지 못했습니다: {error}"))?;
    let _ = fs::remove_dir_all(&dir);

    if !output.status.success() {
        let text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let text = text
            .strip_prefix("vision-failed:")
            .map(|value| value.trim().to_string())
            .unwrap_or(text);
        return Err(if text.is_empty() {
            "글자를 읽지 못했습니다".to_string()
        } else {
            text
        });
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|_| "글자 추출 결과를 해석하지 못했습니다".to_string())?;
    let mut lines: Vec<OcrLine> = Vec::new();
    if let Some(items) = parsed.get("lines").and_then(|value| value.as_array()) {
        for item in items {
            let text = item.get("text").and_then(|value| value.as_str()).unwrap_or("").trim().to_string();
            if text.is_empty() {
                continue;
            }
            lines.push(OcrLine {
                text,
                confidence: item.get("confidence").and_then(|value| value.as_f64()).unwrap_or(0.0),
                x: item.get("x").and_then(|value| value.as_f64()).unwrap_or(0.0),
                y: item.get("y").and_then(|value| value.as_f64()).unwrap_or(0.0),
                w: item.get("w").and_then(|value| value.as_f64()).unwrap_or(0.0),
                h: item.get("h").and_then(|value| value.as_f64()).unwrap_or(0.0),
            });
        }
    }

    // Vision 은 위치를 아래에서 위로(y=0 이 맨 아래) 준다 — 위에서 아래로, 같은 줄은 왼쪽부터.
    lines.sort_by(|a, b| {
        let ay = (a.y * 1000.0) as i64;
        let by = (b.y * 1000.0) as i64;
        if ay == by {
            (a.x * 1000.0).partial_cmp(&(b.x * 1000.0)).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            by.cmp(&ay)
        }
    });

    let mut text = String::new();
    let mut last_line: Option<f64> = None;
    for line in &lines {
        match last_line {
            Some(y) if (y - line.y).abs() <= 0.012 => {
                if !text.ends_with(' ') {
                    text.push(' ');
                }
                text.push_str(&line.text);
            }
            Some(_) => {
                text.push('\n');
                text.push_str(&line.text);
            }
            None => text.push_str(&line.text),
        }
        last_line = Some(line.y);
    }
    let confidence = if lines.is_empty() {
        0.0
    } else {
        lines.iter().map(|line| line.confidence).sum::<f64>() / lines.len() as f64
    };

    Ok(OcrResult {
        text: text.trim().to_string(),
        lines,
        confidence: confidence * 100.0,
        engine: "vision".to_string(),
    })
}

/// 시스템 오디오를 WAV 로 담는 도우미를 띄운다 — 부른 쪽(voice.rs)이 SIGTERM 으로 끝낸다.
pub fn start_audio(app: &AppHandle, out: &Path) -> Result<Child, String> {
    let tool = tool(app)?;
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).map_err(|error| format!("폴더를 만들지 못했습니다: {error}"))?;
    }
    Command::new(tool)
        .arg("audio")
        .arg("--out")
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("시스템 오디오 도우미를 실행하지 못했습니다: {error}"))
}

/// 이미지 앞머리로 확장자를 짐작한다 — Vision 은 내용으로 읽지만, 임시 파일 이름이 어긋나면
/// macOS 가 엉뚱한 형식으로 보려 할 수 있어 맞춰 둔다.
fn guess_ext(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "jpg"
    } else if bytes.starts_with(b"GIF8") {
        "gif"
    } else if bytes.starts_with(b"BM") {
        "bmp"
    } else if bytes.len() > 12 && &bytes[4..12] == b"ftypheic" {
        "heic"
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        "heic"
    } else if bytes.len() > 8 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "webp"
    } else {
        "img"
    }
}

/* ------------------------------ 화면이 부르는 커맨드 ------------------------------ */

/// 이미지 글자 추출 — Mac 은 Apple Vision, 추가 다운로드 0MB.
/// 이미지는 base64 로 받아 우리가 만든 임시 파일로만 쓴다(경로를 화면이 정하지 않는다).
#[tauri::command]
pub fn ocr_vision(app: AppHandle, data: String, languages: Option<Vec<String>>) -> Result<OcrResult, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "이미지를 읽지 못했습니다".to_string())?;
    let mut langs: Vec<String> = languages.unwrap_or_default();
    langs.retain(|item| !item.trim().is_empty() && item.len() <= 16);
    langs.truncate(4);
    ocr(&app, &bytes, &langs)
}

/// HEIC/HEIF → PNG. macOS 의 sips 로만 바꾸고, 임시 파일은 곧바로 지운다.
/// 화면은 돌려받은 PNG 바이트를 그대로 기존 변환 경로(자르기·크기 조절·포맷)에 넣는다.
#[tauri::command]
pub fn img_heic_to_png(data: String) -> Result<tauri::ipc::Response, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "이미지를 읽지 못했습니다".to_string())?;
    if bytes.is_empty() {
        return Err("이미지가 비어 있습니다".to_string());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("이미지가 너무 큽니다(24MB 까지)".to_string());
    }
    let head = &bytes[..bytes.len().min(16)];
    let heic = head.len() > 12
        && &head[4..8] == b"ftyp"
        && matches!(&head[8..12], b"heic" | b"heix" | b"hevc" | b"heim" | b"heis" | b"mif1" | b"msf1");
    if !heic {
        return Err("HEIC/HEIF 파일이 아닙니다".to_string());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("tip-heic-{stamp}"));
    fs::create_dir_all(&dir).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;
    let source = dir.join("photo.heic");
    let target = dir.join("photo.png");
    fs::write(&source, &bytes).map_err(|error| format!("이미지를 쓰지 못했습니다: {error}"))?;

    let output = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(&source)
        .arg("--out")
        .arg(&target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            let _ = fs::remove_dir_all(&dir);
            format!("HEIC 변환기를 실행하지 못했습니다: {error}")
        })?;
    if !output.status.success() || !target.is_file() {
        let text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let _ = fs::remove_dir_all(&dir);
        return Err(if text.is_empty() {
            "HEIC 를 바꾸지 못했습니다".to_string()
        } else {
            format!("HEIC 를 바꾸지 못했습니다: {text}")
        });
    }
    let png = fs::read(&target).map_err(|error| format!("바꾼 이미지를 읽지 못했습니다: {error}"))?;
    let _ = fs::remove_dir_all(&dir);
    Ok(tauri::ipc::Response::new(png))
}
