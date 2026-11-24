// TIP 로그인 시 자동 실행 — v1.14.0 (Mac 앱 전용)
//
// macOS 의 LaunchAgent 하나만 쓴다 — ~/Library/LaunchAgents/io.appfle.tip.plist.
//  · 켤 때: 지금 실행 중인 TIP 번들의 실행 파일 경로를 ProgramArguments 에 적고 RunAtLoad=true.
//  · 끌 때: 그 파일을 지운다.
// 임의의 경로를 등록하지 않는다 — 실행 파일 이름이 tip 이고 …/TIP.app/Contents/MacOS/tip 안에
// 있을 때만 쓴다(다른 앱·스크립트를 대신 등록하는 통로가 되지 않게).
// 시스템 설정의 '로그인 항목'과 같은 역할이지만, 앱이 스스로 켜고 끌 수 있게 파일로 관리한다.

use std::fs;
use std::path::PathBuf;

const LABEL: &str = "io.appfle.tip";

fn agent_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let dir = home.join("Library/LaunchAgents");
    let _ = fs::create_dir_all(&dir);
    Some(dir.join(format!("{LABEL}.plist")))
}

/// 지금 실행 중인 TIP 의 실행 파일 — 번들 안(Contents/MacOS/tip)일 때만 인정한다.
fn own_executable() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| format!("실행 경로를 읽지 못했습니다: {error}"))?;
    let name = exe.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default();
    let macos_dir = exe.parent().map(|path| path.file_name().map(|v| v.to_string_lossy().to_string())).flatten().unwrap_or_default();
    let in_app = exe
        .ancestors()
        .any(|path| path.extension().map(|ext| ext == "app").unwrap_or(false));
    if name != "tip" || macos_dir != "MacOS" || !in_app {
        return Err("앱 번들(TIP.app)로 설치한 뒤에 자동 실행을 켤 수 있습니다".into());
    }
    let text = exe.to_string_lossy().to_string();
    if text.contains('&') || text.contains('<') || text.contains('>') {
        return Err("실행 경로에 plist 에 쓸 수 없는 문자가 있습니다".into());
    }
    Ok(exe)
}

/// 지금 자동 실행이 켜져 있는지 — plist 가 있고 그 안의 경로가 지금 앱을 가리키는지.
#[tauri::command]
pub fn get_autostart() -> bool {
    let Some(path) = agent_path() else { return false };
    let Ok(text) = fs::read_to_string(&path) else { return false };
    let Ok(exe) = own_executable() else { return false };
    text.contains(&format!("<string>{}</string>", exe.to_string_lossy()))
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<bool, String> {
    let Some(path) = agent_path() else {
        return Err("홈 폴더를 찾지 못했습니다".into());
    };

    if !enabled {
        if path.exists() {
            fs::remove_file(&path).map_err(|error| format!("자동 실행 파일을 지우지 못했습니다: {error}"))?;
        }
        // 지금 돌고 있는 앱은 건드리지 않는다 — 다음 로그인부터 뜨지 않는다.
        return Ok(false);
    }

    let exe = own_executable()?;
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
"#,
        label = LABEL,
        exe = exe.to_string_lossy(),
    );
    fs::write(&path, body).map_err(|error| format!("자동 실행 파일을 쓰지 못했습니다: {error}"))?;
    // launchctl 로 바로 load 하지 않는다 — load 는 곧바로 두 번째 인스턴스를 띄운다.
    // LaunchAgent 는 다음 로그인 때 launchd 가 알아서 읽는다.
    Ok(true)
}
