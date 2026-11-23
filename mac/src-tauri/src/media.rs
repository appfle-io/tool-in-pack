// TIP 미디어·캘린더 위젯 — v1.12.1
//
// 노치 아일랜드가 쓰는 작은 조회/조작. macOS 의 AppleScript(osascript)를 거쳐
// Apple Music · Spotify 재생 정보와 오늘 일정을 읽는다. 권한이 없으면 오류 문자열을 돌려주고
// 화면은 "권한을 확인하세요" 안내로 바뀐다. 외부로 보내는 데이터는 없다.
//
// v1.12.1 — 노치를 켜고 클릭할 때 화면 전체가 멈추던 문제의 근본 수정:
//  · 세 커맨드 모두 `async fn` + `tauri::async_runtime::spawn_blocking` 으로 워커 스레드에서
//    돈다. Tauri 는 `async` 가 없는 커맨드를 메인(UI) 스레드에서 실행하므로, 예전처럼 동기
//    `fn` 으로 두면 osascript 가 도는 동안 AppKit 이벤트 루프가 통째로 멈춘다.
//  · osascript 는 짧은 타임아웃(미디어 2초 · 캘린더 6초)을 걸고, 넘으면 자식 프로세스를
//    kill 한다. 권한 팝업이 응답하지 않아도 UI 는 즉시 깔끔한 오류/대기 상태로 돌아온다.
//  · 캘린더는 수년 치 이벤트를 훑는 무거운 조회라 5분 캐시(실패는 60초)를 둬서 노치를
//    열 때마다 반복 실행되지 않게 한다.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// osascript 한 번에 기다리는 최대 시간 — 미디어(가벼움).
const MEDIA_TIMEOUT: Duration = Duration::from_secs(2);
/// 캘린더는 Calendar.app 전체를 훑느라 오래 걸릴 수 있어 조금 더 준다(그래도 백그라운드 + 캐시).
const CALENDAR_TIMEOUT: Duration = Duration::from_secs(6);
/// 오늘 일정 캐시 — 성공 5분, 실패(권한 없음 등) 60초.
const CALENDAR_TTL: Duration = Duration::from_secs(300);
const CALENDAR_ERROR_TTL: Duration = Duration::from_secs(60);

#[derive(serde::Serialize, Clone)]
pub struct MediaState {
    pub app: String,
    pub playing: bool,
    pub title: String,
    pub artist: String,
}

#[derive(serde::Serialize, Clone)]
pub struct CalEvent {
    pub title: String,
    pub start: String,
    pub calendar: String,
}

/// 마지막 캘린더 조회 결과 — (조회 시각, 결과). 실패도 담아 권한 없는 상태에서 매번
/// osascript 를 새로 띄우지 않는다.
static CALENDAR_CACHE: Mutex<Option<(Instant, Result<Vec<CalEvent>, String>)>> = Mutex::new(None);

/* ------------------------------ osascript 실행 ------------------------------ */

/// osascript 를 자식 프로세스로 띄우고 `timeout` 안에 끝나지 않으면 kill 한다.
fn osascript(script: &str, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("osascript 를 실행하지 못했습니다: {error}"))?;

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return collect(child, status.success()),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("AppleScript 응답이 늦어 중단했습니다".into());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("osascript 상태를 읽지 못했습니다: {error}"));
            }
        }
    }
}

/// 이미 끝난 자식의 출력·오류를 읽어 결과 문자열로 만든다.
fn collect(mut child: Child, success: bool) -> Result<String, String> {
    let mut stdout = String::new();
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        let _ = pipe.read_to_string(&mut stdout);
    }
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    if !success {
        let message = stderr.trim();
        return Err(if message.is_empty() {
            "AppleScript 오류".to_string()
        } else {
            format!("AppleScript 오류: {message}")
        });
    }
    Ok(stdout.trim().to_string())
}

/* ------------------------------ 미디어 ------------------------------ */

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

fn read_media_state() -> Result<MediaState, String> {
    let raw = osascript(STATE_SCRIPT, MEDIA_TIMEOUT)?;
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
pub async fn media_state() -> Result<MediaState, String> {
    tauri::async_runtime::spawn_blocking(read_media_state)
        .await
        .map_err(|error| format!("미디어 조회를 마치지 못했습니다: {error}"))?
}

fn control_media(action: &str) -> Result<(), String> {
    // 문자열을 스크립트에 그대로 넣지 않는다 — 허용한 값만 쓴다.
    let command = match action {
        "playpause" => "playpause",
        "play" => "play",
        "pause" => "pause",
        "next" => "next track",
        "previous" => "previous track",
        _ => return Err("알 수 없는 동작입니다".into()),
    };

    let state = read_media_state()?;
    if state.app.is_empty() {
        return Err("재생 중인 음악 앱이 없습니다".into());
    }
    let target = if state.app == "Spotify" { "Spotify" } else { "Music" };
    let script = format!("tell application \"{target}\" to {command}");
    osascript(&script, MEDIA_TIMEOUT)?;
    Ok(())
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || control_media(&action))
        .await
        .map_err(|error| format!("미디어 조작을 마치지 못했습니다: {error}"))?
}

/* ------------------------------ 캘린더 ------------------------------ */

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

fn read_calendar_events() -> Result<Vec<CalEvent>, String> {
    let raw = osascript(CALENDAR_SCRIPT, CALENDAR_TIMEOUT)?;
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

#[tauri::command]
pub async fn calendar_today() -> Result<Vec<CalEvent>, String> {
    // 캐시가 살아 있으면 osascript 를 아예 띄우지 않는다(락은 잠깐만 잡는다).
    if let Ok(guard) = CALENDAR_CACHE.lock() {
        if let Some((at, cached)) = guard.as_ref() {
            let ttl = if cached.is_ok() { CALENDAR_TTL } else { CALENDAR_ERROR_TTL };
            if at.elapsed() < ttl {
                return cached.clone();
            }
        }
    }

    let fresh = tauri::async_runtime::spawn_blocking(read_calendar_events)
        .await
        .map_err(|error| format!("캘린더 조회를 마치지 못했습니다: {error}"))?;

    if let Ok(mut guard) = CALENDAR_CACHE.lock() {
        *guard = Some((Instant::now(), fresh.clone()));
    }
    fresh
}
