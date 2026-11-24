// TIP Spotlight 식 시스템 명령 — v1.14.0 (Mac 앱 전용)
//
// 전역 검색에서 고른 시스템 명령 하나만 실행한다.
//  · 안전: 화면 잠금 · 잠자기 · 화면 보호기 · 다크/라이트 전환 · 숨김 파일 토글
//  · 위험: 휴지통 비우기 · 재시동 · 시스템 종료 · 로그아웃
//
// 문자열을 그대로 셸에 넘기지 않는다 — 아래 표에 적힌 id 만 받아, 정해진 명령만 실행한다.
// Finder·System Events 조작은 macOS 자동화 권한을 물을 수 있고, 거부되면 [permission] 으로 알린다.
//
// v1.15.1 — 위험한 4개는 웹뷰가 부르는 것만으로 실행되지 않는다.
//   ① Rust 가 설정값을 직접 들고 있다(set_system_commands). 꺼 둔 명령은 Rust 가 거부한다.
//   ② 그 4개는 기본 OFF 다(화면 설정도 같은 기본값으로 시작한다).
//   ③ 켜 둔 명령도 실행 직전에 macOS 네이티브 NSAlert 확인창을 띄우고, 사용자가 [실행]을
//      눌렀을 때만 진행한다(웹뷰 스크립트가 스스로 확인했다고 믿지 않는다).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::AppHandle;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Lock,
    Sleep,
    ScreenSaver,
    DarkMode,
    HiddenFiles,
    EmptyTrash,
    Restart,
    Shutdown,
    Logout,
}

impl Command {
    fn from_id(id: &str) -> Option<Self> {
        match id {
            "lock" => Some(Self::Lock),
            "sleep" => Some(Self::Sleep),
            "screensaver" => Some(Self::ScreenSaver),
            "darkmode" => Some(Self::DarkMode),
            "hiddenfiles" => Some(Self::HiddenFiles),
            "emptytrash" => Some(Self::EmptyTrash),
            "restart" => Some(Self::Restart),
            "shutdown" => Some(Self::Shutdown),
            "logout" => Some(Self::Logout),
            _ => None,
        }
    }

    /// 되돌릴 수 없는 명령 — 확인창을 거치고 설정으로 끌 수 있는 네 가지.
    fn is_risky(self) -> bool {
        matches!(self, Self::EmptyTrash | Self::Restart | Self::Shutdown | Self::Logout)
    }

    fn id(self) -> &'static str {
        match self {
            Self::Lock => "lock",
            Self::Sleep => "sleep",
            Self::ScreenSaver => "screensaver",
            Self::DarkMode => "darkmode",
            Self::HiddenFiles => "hiddenfiles",
            Self::EmptyTrash => "emptytrash",
            Self::Restart => "restart",
            Self::Shutdown => "shutdown",
            Self::Logout => "logout",
        }
    }

    /// 확인창에 쓸 제목·설명·버튼 이름.
    fn confirm_text(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::EmptyTrash => (
                "휴지통을 비울까요?",
                "휴지통 안의 항목을 모두 지웁니다. 되돌릴 수 없습니다.",
                "휴지통 비우기",
            ),
            Self::Restart => (
                "Mac 을 재시동할까요?",
                "열려 있는 앱과 저장하지 않은 작업이 닫힙니다.",
                "재시동",
            ),
            Self::Shutdown => (
                "Mac 을 종료할까요?",
                "열려 있는 앱과 저장하지 않은 작업이 닫힙니다.",
                "시스템 종료",
            ),
            Self::Logout => (
                "로그아웃할까요?",
                "지금 사용자가 로그아웃되고 열려 있는 앱이 닫힙니다.",
                "로그아웃",
            ),
            _ => ("실행할까요?", "", "실행"),
        }
    }
}

/// 화면이 밀어 준 시스템 명령 켜기/끄기 — 값이 없는 명령은 기본값을 따른다.
/// (위험한 네 개만 기본 OFF, 나머지는 ON.)
static COMMAND_SETTINGS: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);

fn command_enabled(command: Command) -> bool {
    let guard = COMMAND_SETTINGS.lock().unwrap();
    let saved = guard.as_ref().and_then(|map| map.get(command.id()).copied());
    saved.unwrap_or(!command.is_risky())
}

/// 환경설정의 시스템 명령 스위치를 Rust 에 옮긴다(v1.15.1).
#[tauri::command]
pub fn set_system_commands(settings: HashMap<String, bool>) {
    *COMMAND_SETTINGS.lock().unwrap() = Some(settings);
}

/// macOS 네이티브 확인창 — 메인 스레드에서만 띄울 수 있어 AppHandle 로 넘겨 받는다.
#[cfg(target_os = "macos")]
fn ask_native(title: &str, message: &str, ok_label: &str) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSApplication};
    use objc2_foundation::NSString;

    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let alert = NSAlert::new(mtm);
    alert.setMessageText(&NSString::from_str(title));
    alert.setInformativeText(&NSString::from_str(message));
    alert.setAlertStyle(NSAlertStyle::Warning);
    alert.addButtonWithTitle(&NSString::from_str(ok_label));
    alert.addButtonWithTitle(&NSString::from_str("취소"));
    // 메뉴 막대 앱이라 다른 앱 뒤에 있으면 창이 가려질 수 있다 — 확인창을 앞으로 가져온다.
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    alert.runModal() == NSAlertFirstButtonReturn
}

#[cfg(not(target_os = "macos"))]
fn ask_native(_title: &str, _message: &str, _ok_label: &str) -> bool {
    false
}

/// 네이티브 확인창을 메인 스레드에 띄우고 결과를 기다린다 — 사용자가 답하지 않으면 60초 뒤 취소.
fn confirm_with_user(app: &AppHandle, command: Command) -> bool {
    let (title, message, ok_label) = command.confirm_text();
    let (tx, rx) = std::sync::mpsc::channel();
    let handle_title = title.to_string();
    let handle_message = message.to_string();
    let handle_label = ok_label.to_string();
    if app
        .run_on_main_thread(move || {
            let answer = ask_native(&handle_title, &handle_message, &handle_label);
            let _ = tx.send(answer);
        })
        .is_err()
    {
        return false;
    }
    rx.recv_timeout(Duration::from_secs(60)).unwrap_or(false)
}

fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} 를 실행하지 못했습니다: {error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(String::new());
    }
    if stderr.contains("-1743") || stderr.contains("Not authorized") || stderr.contains("not allowed") {
        return Err("[permission] 이 명령에는 자동화(System Events) 권한이 필요합니다 — 시스템 설정 → 개인정보 보호 및 보안 → 자동화에서 TIP 을 켜 주세요".into());
    }
    Err(if stderr.is_empty() {
        format!("명령이 실패했습니다 (종료 코드 {:?})", output.status.code())
    } else {
        stderr
    })
}

fn osascript(script: &str) -> Result<String, String> {
    run("osascript", &["-e", script])
}

/// 화면 잠금 — 예전 CGSession 도우미를 먼저, 없으면 디스플레이 잠자기로.
fn lock_screen() -> Result<String, String> {
    let helper = "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession";
    if std::path::Path::new(helper).exists() {
        if run(helper, &["-suspend"]).is_ok() {
            return Ok("화면을 잠갔습니다".into());
        }
    }
    run("pmset", &["displaysleepnow"])?;
    Ok("화면을 잠갔습니다".into())
}

/// 지금 숨김 파일을 보이는 상태인지.
fn hidden_files_visible() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "com.apple.finder", "AppleShowAllFiles"])
        .output()
        .ok()
        .map(|output| {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
            text == "1" || text == "true" || text == "yes"
        })
        .unwrap_or(false)
}

fn toggle_hidden_files() -> Result<String, String> {
    let next = !hidden_files_visible();
    run(
        "defaults",
        &[
            "write",
            "com.apple.finder",
            "AppleShowAllFiles",
            "-bool",
            if next { "true" } else { "false" },
        ],
    )?;
    // Finder 를 다시 띄워야 바뀐 설정이 화면에 반영된다.
    let _ = run("killall", &["Finder"]);
    Ok(if next {
        "숨김 파일을 표시합니다".into()
    } else {
        "숨김 파일을 숨깁니다".into()
    })
}

fn is_dark() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).to_lowercase().contains("dark"))
        .unwrap_or(false)
}

fn toggle_dark_mode() -> Result<String, String> {
    let next = !is_dark();
    osascript(&format!(
        "tell application \"System Events\" to tell appearance preferences to set dark mode to {}",
        if next { "true" } else { "false" }
    ))?;
    Ok(if next {
        "다크 모드로 바꿨습니다".into()
    } else {
        "라이트 모드로 바꿨습니다".into()
    })
}

/// 표에 있는 id 하나를 실행하고, 화면에 보여 줄 짧은 결과를 돌려준다.
pub fn run_command(id: &str) -> Result<String, String> {
    let command = Command::from_id(id).ok_or_else(|| "알 수 없는 시스템 명령입니다".to_string())?;
    match command {
        Command::Lock => lock_screen(),
        Command::Sleep => {
            run("pmset", &["sleepnow"])?;
            Ok("잠자기로 들어갑니다".into())
        }
        Command::ScreenSaver => {
            run("open", &["-a", "ScreenSaverEngine"])?;
            Ok("화면 보호기를 켰습니다".into())
        }
        Command::DarkMode => toggle_dark_mode(),
        Command::HiddenFiles => toggle_hidden_files(),
        Command::EmptyTrash => {
            osascript("tell application \"Finder\" to empty trash")?;
            Ok("휴지통을 비웠습니다".into())
        }
        Command::Restart => {
            osascript("tell application \"System Events\" to restart")?;
            Ok("다시 시작합니다".into())
        }
        Command::Shutdown => {
            osascript("tell application \"System Events\" to shut down")?;
            Ok("시스템을 종료합니다".into())
        }
        Command::Logout => {
            osascript("tell application \"System Events\" to log out")?;
            Ok("로그아웃합니다".into())
        }
    }
}

/// 화면(검색)이 위험 표시를 그릴 때 쓴다 — 목록은 화면이 들고, 여기서는 실행만.
/// v1.15.1 — 위험한 명령은 설정값 확인 → 네이티브 확인창을 거친 뒤에만 실행한다.
#[tauri::command]
pub fn run_system_command(app: AppHandle, id: String) -> Result<String, String> {
    let command = Command::from_id(&id).ok_or_else(|| "알 수 없는 시스템 명령입니다".to_string())?;
    if command.is_risky() {
        if !command_enabled(command) {
            return Err(format!(
                "{} 명령은 환경설정에서 꺼 두었습니다 — 설정 → 검색 → 시스템 명령에서 켜 주세요",
                command.confirm_text().2
            ));
        }
        if !confirm_with_user(&app, command) {
            return Err("실행을 취소했습니다".into());
        }
    }
    run_command(&id)
}
