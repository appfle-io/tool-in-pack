// TIP · 백업 파일 저장·열기 대화상자 (v1.16.0)
//
// 웹(PWA)은 <a download> 와 <input type=file> 로 백업 파일을 다룬다. Mac 앱에서는 WKWebView 가
// 그 두 가지를 앱답게 처리하지 못하므로, macOS 의 NSSavePanel·NSOpenPanel 을 직접 띄운다.
//   · 저장: 이름을 미리 채운 저장 패널 → 고른 경로에 UTF-8 JSON 을 쓴다.
//   · 열기: JSON 한 개만 고를 수 있게 하고, 12MB 를 넘으면 읽지 않는다.
// 두 패널 모두 메인 스레드에서만 띄울 수 있어 run_on_main_thread 로 넘기고 결과를 기다린다.
// 읽고 쓰는 파일은 사용자가 방금 고른 그 파일 하나뿐이다(다른 경로는 건드리지 않는다).

use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// 백업 파일 최대 크기 — 실수로 고른 거대한 파일을 읽지 않는다.
const MAX_BACKUP_BYTES: usize = 12 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    pub path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub fn save_backup_file(app: AppHandle, name: String, content: String) -> Result<Option<SavedFile>, String> {
    if content.len() > MAX_BACKUP_BYTES {
        return Err("백업 내용이 너무 큽니다(12MB 초과)".into());
    }
    let (tx, rx) = mpsc::channel();
    let file_name = name.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(save_panel(&file_name));
    })
    .map_err(|error| format!("저장 대화상자를 열지 못했습니다: {error}"))?;

    let answer = rx
        .recv_timeout(Duration::from_secs(300))
        .map_err(|_| "저장 대화상자가 응답하지 않습니다".to_string())?;

    match answer {
        Some(path) => {
            std::fs::write(&path, content).map_err(|error| format!("백업 파일을 쓰지 못했습니다: {error}"))?;
            Ok(Some(SavedFile { path }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn open_backup_file(app: AppHandle) -> Result<Option<OpenedFile>, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(open_panel());
    })
    .map_err(|error| format!("열기 대화상자를 열지 못했습니다: {error}"))?;

    let answer = rx
        .recv_timeout(Duration::from_secs(300))
        .map_err(|_| "열기 대화상자가 응답하지 않습니다".to_string())?;

    match answer {
        Some((name, content)) => Ok(Some(OpenedFile { name, content })),
        None => Ok(None),
    }
}

/* ------------------------------ macOS 패널 ------------------------------ */

#[cfg(target_os = "macos")]
fn activate_app() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let Some(mtm) = MainThreadMarker::new() else { return };
    let app = NSApplication::sharedApplication(mtm);
    // 메뉴 막대 앱이라 다른 앱 뒤에 있으면 패널이 가려진다 — 잠깐 앞으로 가져온다.
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
}

#[cfg(target_os = "macos")]
fn save_panel(name: &str) -> Option<String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSSavePanel};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new()?;
    let panel = NSSavePanel::savePanel(mtm);
    panel.setTitle(Some(&NSString::from_str("TIP 백업 파일 저장")));
    panel.setMessage(Some(&NSString::from_str("설정과 기록을 JSON 한 파일로 저장합니다.")));
    panel.setNameFieldStringValue(&NSString::from_str(name));
    panel.setCanCreateDirectories(true);
    activate_app();
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    let url = panel.URL()?;
    Some(url.path()?.to_string())
}

#[cfg(target_os = "macos")]
fn open_panel() -> Option<(String, String)> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new()?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setTitle(Some(&NSString::from_str("TIP 백업 파일 열기")));
    panel.setMessage(Some(&NSString::from_str("TIP 에서 만든 tip-backup-YYYYMMDD.json 파일을 고르세요.")));
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(false);
    panel.setAllowsMultipleSelection(false);
    panel.setResolvesAliases(true);
    activate_app();
    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    let url = panel.URL()?;
    let path = url.path()?.to_string();
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() as usize > MAX_BACKUP_BYTES {
        return None;
    }
    let content = std::fs::read_to_string(&path).ok()?;
    let name = url
        .lastPathComponent()
        .map(|value| value.to_string())
        .unwrap_or_else(|| "tip-backup.json".to_string());
    Some((name, content))
}

#[cfg(not(target_os = "macos"))]
fn save_panel(_name: &str) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn open_panel() -> Option<(String, String)> {
    None
}
