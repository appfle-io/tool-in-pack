// TIP Spotlight 식 시스템 명령 — v1.14.0 (Mac 앱 전용)
//
// 전역 검색에서 고른 시스템 명령 하나만 실행한다.
//  · 안전: 화면 잠금 · 잠자기 · 화면 보호기 · 다크/라이트 전환 · 숨김 파일 토글
//  · 위험: 휴지통 비우기 · 재시동 · 시스템 종료 · 로그아웃  (화면이 한 번 더 확인한다)
//
// 문자열을 그대로 셸에 넘기지 않는다 — 아래 표에 적힌 id 만 받아, 정해진 명령만 실행한다.
// Finder·System Events 조작은 macOS 자동화 권한을 물을 수 있고, 거부되면 [permission] 으로 알린다.

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
#[tauri::command]
pub fn run_system_command(id: String) -> Result<String, String> {
    run_command(&id)
}
