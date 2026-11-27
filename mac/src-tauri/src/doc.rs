// TIP 문서 리더 — 구형 Word(.doc) HTML 변환 (v1.26.0)
//
// .doc(Word 97-2003)은 바이너리라 브라우저에서 풀 수 없다. macOS 에 기본으로 있는
// `/usr/bin/textutil` 로만 바꾼다 — 외부 도구를 내려받지 않고, 기기 밖으로 나가지 않는다.
//
// 안전 장치
//   · 확장자 허용 목록(doc·dot·docx·rtf·odt·wordml·webarchive·html)만 받는다.
//   · 크기 24MB 이하. 화면이 보낸 base64 를 풀어 우리가 정한 임시 경로에만 쓴다.
//   · 끝나면(실패해도) 임시 파일을 지운다. 15초가 지나면 프로세스를 끝낸다.
//   · 돌려주는 HTML 은 화면(js)에서 DOMPurify 로 한 번 더 지운다.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine as _;

const ALLOWED: &[&str] = &["doc", "dot", "docx", "rtf", "odt", "wordml", "webarchive", "html", "htm"];
const MAX_BYTES: usize = 24 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HTML: usize = 40 * 1024 * 1024;

#[tauri::command]
pub async fn doc_convert_html(name: String, data: String) -> Result<String, String> {
    let extension = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if !ALLOWED.contains(&extension.as_str()) {
        return Err(format!("이 형식은 변환하지 않습니다: .{extension}"));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "파일 내용을 읽지 못했습니다".to_string())?;
    if bytes.is_empty() {
        return Err("빈 파일입니다".to_string());
    }
    if bytes.len() > MAX_BYTES {
        return Err("파일이 너무 큽니다(24MB 이하만 열 수 있습니다)".to_string());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("tip-doc-{}-{stamp}.{extension}", std::process::id()));

    std::fs::write(&path, &bytes).map_err(|error| format!("임시 파일을 쓰지 못했습니다: {error}"))?;

    let mut child = match Command::new("/usr/bin/textutil")
        .args(["-convert", "html", "-stdout", "-encoding", "UTF-8"])
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_file(&path);
            return Err(format!("textutil 을 실행하지 못했습니다: {error}"));
        }
    };

    let deadline = Instant::now() + TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&path);
                    return Err("문서를 바꾸는 데 너무 오래 걸립니다(15초). 파일이 손상되지 않았는지 확인해 주세요".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = std::fs::remove_file(&path);
                return Err(format!("textutil 상태를 확인하지 못했습니다: {error}"));
            }
        }
    }

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.by_ref().take(MAX_HTML as u64).read_to_end(&mut stdout);
    }
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.by_ref().take(8192).read_to_end(&mut stderr);
    }
    let status = child.wait();
    let _ = std::fs::remove_file(&path);

    let status = status.map_err(|error| format!("textutil 결과를 확인하지 못했습니다: {error}"))?;
    if !status.success() || stdout.is_empty() {
        let message = String::from_utf8_lossy(&stderr);
        let message = message.trim();
        return Err(if message.is_empty() {
            "이 .doc 파일을 읽지 못했습니다(손상되었거나 지원하지 않는 형식)".to_string()
        } else {
            format!("이 .doc 파일을 읽지 못했습니다: {message}")
        });
    }

    Ok(String::from_utf8_lossy(&stdout).to_string())
}
