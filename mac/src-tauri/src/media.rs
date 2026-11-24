// TIP 미디어·캘린더 위젯 — v1.12.4
//
// 노치 아일랜드가 쓰는 작은 조회/조작.
//  · 미디어 — AppleScript(osascript)를 거쳐 Apple Music · Spotify 재생 정보를 읽고 조작한다.
//  · 캘린더 — v1.12.4 부터 macOS 네이티브 EventKit(EKEventStore)으로 직접 읽는다.
// 권한이 없으면 오류 문자열을 돌려주고 화면은 "권한을 확인하세요" 안내로 바뀐다.
// 외부로 보내는 데이터는 없다. 읽은 값은 이 기기 안에서만 쓰인다.
//
// v1.12.4 — 캘린더를 AppleScript → EventKit 으로 바꾼 이유
//   예전 CALENDAR_SCRIPT 는 `tell application "Calendar"` 로 Calendar.app 을 조종했다. 이 방식은
//   ① 시스템 설정의 '캘린더' 권한(Privacy_Calendars)이 아니라 '자동화'(Apple Events) 권한을 따로
//      요구해서, 캘린더 권한을 켜 두어도 계속 읽지 못했고,
//   ② Calendar.app 이 수년 치 일정을 훑느라 10~30초씩 걸려 6초 타임아웃에 걸려 죽었다.
//   EKEventStore 는 같은 '캘린더' 권한을 그대로 쓰고, 오늘 하루 범위의 술어(predicate)만 묻기 때문에
//   밀리초 단위로 즉시 끝난다.
//
// v1.12.1 — 노치를 켜고 클릭할 때 화면 전체가 멈추던 문제의 근본 수정:
//  · 커맨드 모두 `async fn` + `tauri::async_runtime::spawn_blocking` 으로 워커 스레드에서 돈다.
//    Tauri 는 `async` 가 없는 커맨드를 메인(UI) 스레드에서 실행하므로, 예전처럼 동기 `fn` 으로
//    두면 작업이 도는 동안 AppKit 이벤트 루프가 통째로 멈춘다.
//  · osascript 는 짧은 타임아웃(미디어 2초)을 걸고, 넘으면 자식 프로세스를 kill 한다.
//
// v1.12.3 — 권한 거부를 다른 오류와 구분한다. TCC 가 자동화(Apple Events)를 막으면 osascript 가
//  -1743(errAEEventNotPermitted) / "Not authorized to send Apple events" 로 실패한다. 예전에는
//  이것도 "음악 앱을 조작하지 못했어요" 같은 일반 오류로 보여 무엇을 고쳐야 하는지 알 수 없었다.
//  이제 권한 거부는 앞에 [permission] 표시를 붙여 돌려주고, 노치 화면이 그 표시를 보고
//  '권한 설정' 버튼(시스템 설정 열기)을 바로 띄운다. EventKit 쪽도 같은 표시를 쓴다.

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// osascript 한 번에 기다리는 최대 시간 — 미디어(가벼움).
const MEDIA_TIMEOUT: Duration = Duration::from_secs(2);
/// 캘린더 권한 팝업에 사용자가 답할 때까지 기다리는 시간(EventKit 요청).
const CALENDAR_PERMISSION_WAIT: Duration = Duration::from_secs(15);
/// 오늘 일정 캐시 — 성공 60초, 실패(권한 없음 등) 30초.
const CALENDAR_TTL: Duration = Duration::from_secs(60);
const CALENDAR_ERROR_TTL: Duration = Duration::from_secs(30);

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
    /// 시작 시각 — 에포크 밀리초(예: 1763937600000). 화면(notch.js)은 `new Date(start)` 로 읽는다.
    pub start: i64,
    pub calendar: String,
}

/// 마지막 캘린더 조회 결과 — (조회 시각, 결과). 실패도 담아 권한 없는 상태에서 매번
/// 권한 요청·조회를 새로 하지 않는다.
static CALENDAR_CACHE: Mutex<Option<(Instant, Result<Vec<CalEvent>, String>)>> = Mutex::new(None);

/* ------------------------------ 권한 오류 구분 ------------------------------ */

/// 권한이 막힌 오류에 붙이는 표시 — 프런트(notch.js)가 이 문자열을 찾아 버튼을 띄운다.
pub const PERMISSION_TAG: &str = "[permission]";

/// AppleScript 오류 문장이 '권한 거부'인지 — errAEEventNotPermitted(-1743) 등.
fn is_permission_denied(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("-1743")
        || lower.contains("not authorized")
        || lower.contains("not permitted")
        || lower.contains("erraeeventnotpermitted")
        || lower.contains("apple events")
}

/// 권한 거부면 화면이 알아볼 수 있는 문장으로 바꾼다. 다른 오류는 그대로 돌려준다.
fn with_permission_hint(label: &str, error: String) -> String {
    if is_permission_denied(&error) {
        format!("{PERMISSION_TAG} {label} 권한이 필요합니다")
    } else {
        error
    }
}

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
        .map_err(|error| with_permission_hint("음악 앱 자동화", error))
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
        .map_err(|error| with_permission_hint("음악 앱 자동화", error))
}

/* ------------------------------ 캘린더 (EventKit) ------------------------------ */

/// macOS — EventKit 으로 오늘 00:00 ~ 내일 00:00 일정을 읽는다.
/// 권한이 NotDetermined 면 시스템 권한 팝업을 띄우고(최대 15초) 답을 기다린다.
#[cfg(target_os = "macos")]
fn read_calendar_events() -> Result<Vec<CalEvent>, String> {
    use block2::RcBlock;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
    use objc2_foundation::{NSCalendar, NSDate, NSError};

    autoreleasepool(|_pool| {
        let store = unsafe { EKEventStore::new() };
        let mut status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };

        if status == EKAuthorizationStatus::NotDetermined {
            // completion 블록은 EventKit 의 큐에서 불린다 — 채널로 결과만 받아 여기서 기다린다.
            let (tx, rx) = std::sync::mpsc::channel::<bool>();
            let handler: RcBlock<dyn Fn(Bool, *mut NSError)> =
                RcBlock::new(move |granted: Bool, _error: *mut NSError| {
                    let _ = tx.send(granted.as_bool());
                });
            let completion =
                RcBlock::as_ptr(&handler) as *mut block2::DynBlock<dyn Fn(Bool, *mut NSError)>;
            // SAFETY: 완료 핸들러는 요청이 끝날 때까지 살아 있어야 한다 — 응답을 기다린 뒤
            // 블록은 회수하지 않고 넘긴다(EventKit 이 늦게부르는 경우에도 안전하게).
            unsafe {
                // macOS 14+ — 전체 접근 요청. 13 이하에는 이 메서드가 없어 선택자로 확인한다.
                if store.respondsToSelector(objc2::sel!(requestFullAccessToEventsWithCompletion:)) {
                    store.requestFullAccessToEventsWithCompletion(completion);
                } else {
                    #[allow(deprecated)]
                    store.requestAccessToEntityType_completion(EKEntityType::Event, completion);
                }
            }
            let _ = rx.recv_timeout(CALENDAR_PERMISSION_WAIT);
            std::mem::forget(handler);
            status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
        }

        // 거부·제한·쓰기 전용은 조회할 수 없다 — 화면이 '권한 설정' 버튼을 띄울 수 있게 표시를 붙인다.
        if status != EKAuthorizationStatus::FullAccess {
            return Err(format!("{PERMISSION_TAG} 캘린더 권한이 필요합니다"));
        }

        // 오늘 00:00 ~ 내일 00:00 (사용자 로컬 달력 기준).
        let calendar = NSCalendar::currentCalendar();
        let start = calendar.startOfDayForDate(&NSDate::now());
        let end = NSDate::dateWithTimeInterval_sinceDate(86_400.0, &start);

        // SAFETY: 같은 스레드에서 만든 store·날짜·술어만 쓴다. calendars 는 nil(모든 달력).
        let (events, predicate) = unsafe {
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
            let events = store.eventsMatchingPredicate(&predicate);
            (events, predicate)
        };
        let _ = predicate;

        let mut list: Vec<CalEvent> = Vec::new();
        for event in events.to_vec() {
            // SAFETY: EventKit 이 돌려준 EKEvent — 제목·시작일은 항상 있다.
            let (title, start_ms, calendar_name) = unsafe {
                let title = event.title().to_string();
                let start_ms = (event.startDate().timeIntervalSince1970() * 1000.0).round() as i64;
                let calendar_name = event
                    .calendar()
                    .map(|calendar| calendar.title().to_string())
                    .unwrap_or_default();
                (title, start_ms, calendar_name)
            };
            list.push(CalEvent { title, start: start_ms, calendar: calendar_name });
        }
        list.sort_by_key(|event| event.start);
        Ok(list)
    })
}

/// macOS 가 아닌 곳(문서 빌드·다른 OS 확인용) — EventKit 이 없으므로 빈 목록 대신 오류를 돌려준다.
#[cfg(not(target_os = "macos"))]
fn read_calendar_events() -> Result<Vec<CalEvent>, String> {
    Err("캘린더는 macOS 앱에서만 읽습니다".into())
}

#[tauri::command]
pub async fn calendar_today() -> Result<Vec<CalEvent>, String> {
    // 캐시가 살아 있으면 권한 요청·조회를 아예 하지 않는다(락은 잠깐만 잡는다).
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
