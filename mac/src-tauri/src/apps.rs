// TIP Spotlight 형 검색의 macOS 부분 — v1.14.0, v1.15.1(파일 열기 범위 축소) (Mac 앱 전용)
//
// 전역 검색(Option+Space)이 쓰는 세 가지를 여기서 만든다.
//  · list_installed_apps — /Applications · /System/Applications · ~/Applications 의 .app 번들 목록.
//    한 번 읽어 메모리에 캐시한다(앱이 켜져 있는 동안 그대로).
//  · open_local_app      — 목록에서 고른 .app 만 연다(허용 폴더·.app 확장자·실존 확인).
//  · search_local_files  — macOS 내장 mdfind 로 홈 디렉토리의 파일 이름을 찾는다(최대 12건, 1초 제한).
//  · open_local_file     — **방금 mdfind 가 돌려준 경로만** 연다(v1.15.1).
//
// v1.15.1 — '홈 폴더 아래면 다 열어 준다' 규칙을 없앴다. 웹뷰가 임의의 홈 경로(예: ~/Library 의
//   스크립트)를 넘겨도 열리지 않고, 사용자가 화면에서 실제로 고른 검색 결과만 열린다.
//   그리고 .command·.sh·.tool·.terminal·.workflow·.pkg 같은 스크립트·설치 파일은 실행하지 않고
//   Finder 에서 위치만 보여 준다(open -R). .app 은 앱 실행기 UX 를 위해 그대로 연다.
//   문서·이미지 같은 일반 파일은 예전치럼 연다.
//
// 모두 기기 안에서만 돈다 — 검색어도 결과도 밖으로 보내지 않는다.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    /// 폴더 이름(확장자 뺀 이름) — 늘 있는 값.
    pub name: String,
    /// Info.plist 의 표시 이름(한글 이름이 있으면 그 값).
    pub display_name: String,
    /// .app 번들의 절대 경로.
    pub path: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

static APP_CACHE: Mutex<Option<Vec<AppEntry>>> = Mutex::new(None);
/// 방금 mdfind 로 찾아 화면에 돌려준 경로 — open_local_file 은 여기 있는 경로만 연다(v1.15.1).
static FILE_HITS: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);

const FILE_HIT_MAX: usize = 12;
const MDFIND_TIMEOUT: Duration = Duration::from_millis(1000);

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn app_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from("/Applications/Utilities"),
    ];
    if let Some(home) = home_dir() {
        roots.push(home.join("Applications"));
    }
    roots
}

/// Info.plist 에서 CFBundleDisplayName / CFBundleName 을 꺼낸다.
/// XML plist 는 그대로 읽고, 이진 plist 는 이름만으로 물러선다(폴더 이름을 쓴다).
fn bundle_display_name(app: &Path, fallback: &str) -> String {
    let plist = app.join("Contents/Info.plist");
    let Ok(text) = fs::read_to_string(&plist) else {
        return fallback.to_string();
    };
    for key in ["CFBundleDisplayName", "CFBundleName"] {
        let marker = format!("<key>{key}</key>");
        let Some(index) = text.find(&marker) else { continue };
        let rest = &text[index + marker.len()..];
        let Some(start) = rest.find("<string>") else { continue };
        let rest = &rest[start + "<string>".len()..];
        let Some(end) = rest.find("</string>") else { continue };
        let value = rest[..end].trim();
        if !value.is_empty() {
            return value.to_string();
        }
    }
    fallback.to_string()
}

/// .app 번들을 모은다 — 허용 폴더의 바로 아래 한 단계까지.
fn scan_apps() -> Vec<AppEntry> {
    let mut list: Vec<AppEntry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut push = |path: PathBuf| {
        let name = path
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.is_empty() {
            return;
        }
        let key = path.to_string_lossy().to_string();
        if !seen.insert(key.clone()) {
            return;
        }
        let display_name = bundle_display_name(&path, &name);
        list.push(AppEntry { name, display_name, path: key });
    };

    for root in app_roots() {
        let Ok(entries) = fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|ext| ext == "app").unwrap_or(false) {
                push(path);
                continue;
            }
            // /Applications/Utilities 처럼 한 단계 더 들어간 묶음 폴더도 본다(중첩은 한 단계만).
            if path.is_dir() {
                if let Ok(inner) = fs::read_dir(&path) {
                    for child in inner.flatten() {
                        let child_path = child.path();
                        if child_path.extension().map(|ext| ext == "app").unwrap_or(false) {
                            push(child_path);
                        }
                    }
                }
            }
        }
    }

    list.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    list
}

#[tauri::command]
pub fn list_installed_apps() -> Vec<AppEntry> {
    let mut slot = APP_CACHE.lock().unwrap();
    if slot.is_none() {
        *slot = Some(scan_apps());
    }
    slot.clone().unwrap_or_default()
}

/// 열어도 되는 .app 경로인지 — 허용 폴더 안의 .app 번들만.
fn is_openable_app(path: &Path) -> bool {
    if !path.is_absolute() || !path.is_dir() {
        return false;
    }
    if path.extension().map(|ext| ext != "app").unwrap_or(true) {
        return false;
    }
    app_roots().iter().any(|root| path.starts_with(root))
}

#[tauri::command]
pub fn open_local_app(path: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if !is_openable_app(&path) {
        return Err("응용 프로그램 폴더의 앱만 열 수 있습니다".into());
    }
    Command::new("open")
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("앱을 열지 못했습니다: {error}"))
}

/// mdfind 검색어로 쓸 수 있게 다듬는다 — 따옴표·와일드카드로 질의를 깨지 못하게.
fn clean_query(query: &str) -> String {
    query
        .chars()
        .filter(|ch| !matches!(ch, '\'' | '"' | '\\' | '*' | '?' | '[' | ']' | '{' | '}'))
        .collect::<String>()
        .trim()
        .to_string()
}

/// 홈 디렉토리에서 파일 이름으로 찾는다. 1초를 넘기면 그때까지 모은 것만 돌려준다.
fn run_mdfind(query: &str) -> Vec<PathBuf> {
    let home = match home_dir() {
        Some(home) => home,
        None => return Vec::new(),
    };
    let predicate = format!("kMDItemFSName == '*{query}*'cd");
    let mut child = match Command::new("mdfind")
        .arg("-onlyin")
        .arg(&home)
        .arg(&predicate)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return Vec::new(),
    };

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < MDFIND_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .take(FILE_HIT_MAX)
        .collect()
}

#[tauri::command]
pub async fn search_local_files(query: String) -> Vec<FileHit> {
    let cleaned = clean_query(&query);
    if cleaned.chars().count() < 2 {
        return Vec::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let paths = run_mdfind(&cleaned);
        let mut list = Vec::new();
        let mut allowed: HashSet<PathBuf> = HashSet::new();
        for path in paths {
            let Ok(meta) = fs::metadata(&path) else { continue };
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            allowed.insert(path.clone());
            list.push(FileHit {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
            });
        }
        if let Ok(mut slot) = FILE_HITS.lock() {
            // v1.15.1 — 매 검색의 결과로 통째로 바꾼다. 예전 결과는 열 수 없게 지운다.
            *slot = Some(allowed);
        }
        list
    })
    .await
    .unwrap_or_default()
}

/// 실행하지 않고 Finder 에서 위치만 보여 줄 확장자(v1.15.1) — 스크립트·설치 파일.
const SCRIPT_EXTENSIONS: [&str; 6] = ["command", "sh", "tool", "terminal", "workflow", "pkg"];

/// 이 경로가 스크립트·설치 파일인지 — 대소문자 구분 없이 확장자만 본다.
fn is_script_file(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .map(|ext| SCRIPT_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

/// 열어도 되는 경로인지 — 방금 mdfind 가 돌려준 경로만(홈 아래라는 이유만으로 열지 않는다).
fn is_openable_file(path: &Path) -> bool {
    if !path.is_absolute() || !path.exists() {
        return false;
    }
    if path.to_string_lossy().contains("..") {
        return false;
    }
    match FILE_HITS.lock() {
        Ok(slot) => slot
            .as_ref()
            .map(|set| set.contains(path))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// 실행해도 되는 .app 번들인지 — 시스템·사용자 응용 프로그램 폴더 아래만(v1.15.2).
/// 내려받은(~/Downloads) 앱이나 메신저로 받은 앱을 검색 결과에서 한 번에 실행하지 못하게,
/// 그 밖의 .app 은 open -R 로 Finder 에서 위치만 보여 준다.
fn is_app_in_applications(path: &Path) -> bool {
    app_roots().iter().any(|root| path.starts_with(root))
}

/// 이 경로가 .app 번들인지 — 경로 이름으로 본다(번들 안을 가리키는 경로도 있다).
fn is_app_bundle(path: &Path) -> bool {
    path.components().any(|part| {
        part.as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(".app")
    })
}

#[tauri::command]
pub fn open_local_file(path: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if !is_openable_file(&path) {
        return Err("검색 결과에 있는 경로만 열 수 있습니다".into());
    }
    // v1.15.2 — 응용 프로그램 폴더 밖의 .app 은 실행하지 않고 Finder 에서 위치만 보여 준다.
    if is_app_bundle(&path) && !is_app_in_applications(&path) {
        return Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map(|_| ())
            .map_err(|error| format!("Finder 에서 위치를 보여 주지 못했습니다: {error}"));
    }
    // v1.15.1 — 스크립트·설치 파일은 실행하지 않고 Finder 에서 위치만 보여 준다.
    if is_script_file(&path) {
        return Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map(|_| ())
            .map_err(|error| format!("Finder 에서 위치를 보여 주지 못했습니다: {error}"));
    }
    // Finder 에서 고른 것처럼 연다. 실패하면 Finder 에서 위치를 보여 준다.
    let opened = Command::new("open").arg(&path).status();
    if matches!(opened, Ok(status) if status.success()) {
        return Ok(());
    }
    Command::new("open")
        .arg("-R")
        .arg(&path)
        .status()
        .map(|_| ())
        .map_err(|error| format!("파일을 열지 못했습니다: {error}"))
}
