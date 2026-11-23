// TIP 미디어·캘린더 위젯 — v1.12.0
//
// 노치 아일랜드가 쓰는 작은 조회/조작. macOS 의 AppleScript(osascript)를 거쳐
// Apple Music · Spotify 재생 정보와 오늘 일정을 읽는다. 권한이 없으면 오류 문자열을 돌려주고
// 화면은 "권한을 확인하세요" 안내로 바뀐다. 외부로 보내는 데이터는 없다.

use std::process::Command;

#[derive(serde::Serialize)]
pub struct MediaState {
    pub app: String,
    pub playing: bool,
    pub title: String,
    pub artist: String,
}

#[derive(serde::Serialize)]
pub struct CalEvent {
    pub title: String,
    pub start: String,
    pub calendar: String,
}

fn osascript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("osascript 를 실행하지 못했습니다: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(format!("AppleScript 오류: {}", message.trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

const STATE_SCRIPT: &str = r#"
set out to ""
if application "Spotify" is running then
  tell application "Spotify"
    set st to (player state as text)
    set t to ""
    set ar to ""
    try
      set t to name of current track
      set ar to artist of current track
    end try
    set out to "Spotify" & tab & st & tab & t & tab & ar
  end tell
else if application "Music" is running then
  tell application "Music"
    set st to (player state as text)
    set t to ""
    set ar to ""
    try
      set t to name of current track
      set ar to artist of current track
    end try
    set out to "Music" & tab & st & tab & t & tab & ar
  end tell
end if
return out
"#;

#[tauri::command]
pub fn media_state() -> Result<MediaState, String> {
    let raw = osascript(STATE_SCRIPT)?;
    if raw.trim().is_empty() {
        return Ok(MediaState {
            app: String::new(),
            playing: false,
            title: String::new(),
            artist: String::new(),
        });
    }
    let parts: Vec<&str> = raw.split('\t').collect();
    let app = parts.first().copied().unwrap_or("").to_string();
    let playing = parts.get(1).map(|state| state.contains("playing")).unwrap_or(false);
    let title = parts.get(2).copied().unwrap_or("").to_string();
    let artist = parts.get(3).copied().unwrap_or("").to_string();
    Ok(MediaState { app, playing, title, artist })
}

#[tauri::command]
pub fn media_control(action: String) -> Result<(), String> {
    let state = media_state()?;
    if state.app.is_empty() {
        return Err("재생 중인 음악 앱이 없습니다".into());
    }

    // 문자열을 스크립트에 그대로 넣지 않는다 — 허용한 값만 쓴다.
    let command = match action.as_str() {
        "playpause" => "playpause",
        "play" => "play",
        "pause" => "pause",
        "next" => "next track",
        "previous" => "previous track",
        _ => return Err("알 수 없는 동작입니다".into()),
    };
    let target = if state.app == "Spotify" { "Spotify" } else { "Music" };
    let script = format!("tell application \"{target}\" to {command}");
    osascript(&script)?;
    Ok(())
}

const CALENDAR_SCRIPT: &str = r#"
set out to ""
set startOfDay to (current date)
set time of startOfDay to 0
set endOfDay to startOfDay + (24 * 60 * 60)
tell application "Calendar"
  repeat with cal in calendars
    try
      repeat with ev in (every event of cal whose start date ≥ startOfDay and start date < endOfDay)
        set out to out & (summary of ev) & tab & ((start date of ev) as «class isot» as string) & tab & (name of cal) & linefeed
      end repeat
    end try
  end repeat
end tell
return out
"#;

#[tauri::command]
pub fn calendar_today() -> Result<Vec<CalEvent>, String> {
    let raw = osascript(CALENDAR_SCRIPT)?;
    let mut events = Vec::new();
    for line in raw.lines() {
        let mut parts = line.splitn(3, '\t');
        let title = parts.next().unwrap_or("").trim();
        let start = parts.next().unwrap_or("").trim();
        let calendar = parts.next().unwrap_or("").trim();
        if start.is_empty() {
            continue;
        }
        events.push(CalEvent {
            title: title.to_string(),
            start: start.to_string(),
            calendar: calendar.to_string(),
        });
    }
    events.sort_by(|a, b| a.start.cmp(&b.start));
    Ok(events)
}
