// TIP 미디어·캘린더 위젯 — v1.13.0
//
// 노치 아일랜드가 쓰는 작은 조회/조작.
//  · 미디어 — AppleScript(osascript)를 거쳐 Apple Music · Spotify 재생 정보를 읽고 조작한다.
//  · 캘린더 — v1.12.4 부터 macOS 네이티브 EventKit(EKEventStore)으로 직접 읽는다.
// 권한이 없으면 오류 문자열을 돌려주고 화면은 "권한을 확인하세요" 안내로 바뀐다.
// 외부로 보내는 데이터는 없다. 읽은 값은 이 기기 안에서만 쓰인다.
//
// v1.13.0 — 달력 보기(일·주·월)와 독립 캘린더 필터를 위해 두 커맨드를 더한다.
//  · calendar_list     — 사용자의 모든 일정 캘린더(id·이름·색·계정) 목록
//  · calendar_events   — 지정 기간의 일정(시작·끝·종일·캘린더 id·이름·색), 고른 캘린더만 필터
//  캐시도 한 칸(오늘)에서 (기간·필터)별 여러 칸으로 넓혀, 오늘 요약과 달력 보기가 번갈아
//  들어와도 EventKit 에 다시 묻지 않는다. macOS 캘린더 앱의 체크 상태와는 무관하다 —
//  필터는 TIP 화면(localStorage 'tip.calendar.selectedIds.v1')에만 있다.
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
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub title: String,
    /// 시작 시각 — 에포크 밀리초(예: 1763937600000). 화면(notch.js)은 `new Date(start)` 로 읽는다.
    pub start: i64,
    /// 끝 시각 — 에포크 밀리초. 종일 일정은 그날 00:00 ~ 다음 날 00:00 이다.
    pub end: i64,
    /// 종일 일정 — 화면은 시각 대신 '종일'로 적는다.
    pub all_day: bool,
    /// 캘린더 식별자(EKCalendar.calendarIdentifier) — TIP 안의 독립 필터가 이 값으로 거른다.
    pub calendar_id: String,
    pub calendar: String,
    /// 캘린더 색 `#RRGGBB` — 화면의 점·막대 색.
    pub color: String,
}

/// 캘린더 한 개 — 화면의 독립 필터 목록(체크박스)에 그대로 쓴다.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CalCalendar {
    pub id: String,
    pub title: String,
    pub color: String,
    /// 계정 이름(iCloud·Google 등) — 같은 이름의 캘린더를 구분한다.
    pub source: String,
}

/// 캘린더를 읽을 수 없거나 색을 못 읽었을 때 쓰는 기본 색(팩인백 딥그린).
const DEFAULT_CALENDAR_COLOR: &str = "#2E5E4E";
/// 한 번에 조회하는 최대 기간(400일) — 화면이 실수로 몇 년 치를 묻지 않게 막는다.
const CALENDAR_MAX_RANGE_MS: f64 = 400.0 * 86_400_000.0;
/// 조회 캐시에 담아 두는 최대 항목 수(오늘 요약·월·주·일 보기가 번갈아 들어와도 다시 묻지 않게).
const CALENDAR_CACHE_MAX: usize = 8;

/// 캘린더 조회 캐시 한 줄 — 같은 (기간·필터) 조회는 TTL 안에서 EventKit 에 다시 묻지 않는다.
struct CalCacheEntry {
    key: String,
    at: Instant,
    result: Result<Vec<CalEvent>, String>,
}

/// v1.13.0 — 조회가 오늘 하루뿐 아니라 보이는 기간(월·주·일)마다 달라져, 한 칸짜리 캐시 대신
/// (기간·필터) 별로 몇 줄 담아 둔다. 실패도 담아 권한 없는 상태에서 매번 권한 요청을 새로 하지 않는다.
static CALENDAR_CACHE: Mutex<Vec<CalCacheEntry>> = Mutex::new(Vec::new());

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

/// macOS — EventKit 창고(EKEventStore)를 권한까지 확인해 연다.
/// 권한이 NotDetermined 면 시스템 권한 팝업을 띄우고(최대 15초) 답을 기다린다.
/// 호출한 쪽은 이 안에서만 store 를 쓰고, 끝나면 자동 해제 풀과 함께 사라진다.
#[cfg(target_os = "macos")]
fn with_calendar_store<T>(
    work: impl FnOnce(&objc2_event_kit::EKEventStore) -> T,
) -> Result<T, String> {
    use block2::RcBlock;
    use objc2::rc::autoreleasepool;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore};
    use objc2_foundation::NSError;

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

        Ok(work(&store))
    })
}

/// NSColor → `#RRGGBB`. 캘린더 색은 기기 색 공간(P3 등)일 수 있어 sRGB 로 옮겨 성분을 읽는다.
#[cfg(target_os = "macos")]
fn color_hex(color: &objc2_app_kit::NSColor) -> String {
    use objc2_app_kit::NSColorSpace;

    let Some(rgb) = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace()) else {
        return DEFAULT_CALENDAR_COLOR.to_string();
    };
    let channel = |value: f64| (value * 255.0).round().clamp(0.0, 255.0) as u8;
    format!(
        "#{:02X}{:02X}{:02X}",
        channel(rgb.redComponent()),
        channel(rgb.greenComponent()),
        channel(rgb.blueComponent())
    )
}

/// EKCalendar → (식별자, 이름, 색). 일정(EKEvent)과 필터 목록이 같은 값을 쓴다.
#[cfg(target_os = "macos")]
fn calendar_meta(calendar: &objc2_event_kit::EKCalendar) -> (String, String, String) {
    // SAFETY: EventKit 이 돌려준 EKCalendar — 식별자·이름은 항상 있다.
    unsafe {
        (
            calendar.calendarIdentifier().to_string(),
            calendar.title().to_string(),
            color_hex(&calendar.color()),
        )
    }
}

/// macOS — EventKit 으로 사용자의 모든 일정 캘린더를 읽는다(독립 필터 목록).
#[cfg(target_os = "macos")]
fn read_calendars() -> Result<Vec<CalCalendar>, String> {
    use objc2_event_kit::EKEntityType;

    with_calendar_store(|store| {
        let calendars = unsafe { store.calendarsForEntityType(EKEntityType::Event) };
        let mut list: Vec<CalCalendar> = calendars
            .to_vec()
            .iter()
            .map(|calendar| {
                let (id, title, color) = calendar_meta(calendar);
                // SAFETY: 같은 스레드에서 만든 캘린더만 읽는다. source 는 없을 수 있다.
                let source = unsafe {
                    calendar
                        .source()
                        .map(|source| source.title().to_string())
                        .unwrap_or_default()
                };
                CalCalendar { id, title, color, source }
            })
            .collect();
        // 계정 → 이름 순 — 화면의 체크 목록이 매번 같은 차례로 나오게 한다.
        list.sort_by(|a, b| a.source.cmp(&b.source).then_with(|| a.title.cmp(&b.title)));
        list
    })
}

/// macOS 가 아닌 곳(문서 빌드·다른 OS 확인용) — EventKit 이 없으므로 빈 목록 대신 오류를 돌려준다.
#[cfg(not(target_os = "macos"))]
fn read_calendars() -> Result<Vec<CalCalendar>, String> {
    Err("캘린더는 macOS 앱에서만 읽습니다".into())
}

/// macOS — 주어진 기간(에포크 밀리초)의 일정을 읽는다. `ids` 가 있으면 그 캘린더만 남긴다.
#[cfg(target_os = "macos")]
fn read_events_between(
    start_ms: f64,
    end_ms: f64,
    ids: Option<Vec<String>>,
) -> Result<Vec<CalEvent>, String> {
    use objc2_foundation::NSDate;

    let filter: Option<std::collections::HashSet<String>> =
        ids.map(|list| list.into_iter().collect());

    with_calendar_store(|store| {
        let start = NSDate::dateWithTimeIntervalSince1970(start_ms / 1000.0);
        let end = NSDate::dateWithTimeIntervalSince1970(end_ms / 1000.0);

        // SAFETY: 같은 스레드에서 만든 store·날짜·술어만 쓴다. calendars 는 nil(모든 달력)이고,
        // 화면이 고른 캘린더는 아래에서 식별자로 거른다 — 결과는 같고 술어를 만드는 코드가 짧다.
        let (events, _predicate) = unsafe {
            let predicate = store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
            let events = store.eventsMatchingPredicate(&predicate);
            (events, predicate)
        };

        let mut list: Vec<CalEvent> = Vec::new();
        for event in events.to_vec() {
            // SAFETY: EventKit 이 돌려준 EKEvent — 제목·시작/끝은 항상 있다.
            let (title, start, end, all_day, calendar_id, calendar_name, color) = unsafe {
                let title = event.title().to_string();
                let start = (event.startDate().timeIntervalSince1970() * 1000.0).round() as i64;
                let end = (event.endDate().timeIntervalSince1970() * 1000.0).round() as i64;
                let all_day = event.isAllDay();
                let (calendar_id, calendar_name, color) = match event.calendar() {
                    Some(calendar) => calendar_meta(&calendar),
                    None => (String::new(), String::new(), DEFAULT_CALENDAR_COLOR.to_string()),
                };
                (title, start, end, all_day, calendar_id, calendar_name, color)
            };
            if let Some(filter) = filter.as_ref() {
                if !filter.contains(&calendar_id) {
                    continue;
                }
            }
            list.push(CalEvent { title, start, end, all_day, calendar_id, calendar: calendar_name, color });
        }
        // 시작 순 — 같은 시각이면 끝나는 시각 순. 종일 일정을 먼저 두는 정리는 화면이 한다.
        list.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.end.cmp(&b.end)));
        list
    })
}

#[cfg(not(target_os = "macos"))]
fn read_events_between(
    _start_ms: f64,
    _end_ms: f64,
    _ids: Option<Vec<String>>,
) -> Result<Vec<CalEvent>, String> {
    Err("캘린더는 macOS 앱에서만 읽습니다".into())
}

/// 오늘 00:00 ~ 내일 00:00 (사용자 로컬 달력 기준) — 에포크 밀리초.
#[cfg(target_os = "macos")]
fn today_range_ms() -> Result<(f64, f64), String> {
    use objc2_foundation::{NSCalendar, NSDate};

    let calendar = NSCalendar::currentCalendar();
    let start = calendar.startOfDayForDate(&NSDate::now());
    let start_ms = start.timeIntervalSince1970() * 1000.0;
    Ok((start_ms, start_ms + 86_400_000.0))
}

#[cfg(not(target_os = "macos"))]
fn today_range_ms() -> Result<(f64, f64), String> {
    Err("캘린더는 macOS 앱에서만 읽습니다".into())
}

/* ------------------------------ 캘린더 캐시 ------------------------------ */

/// 캐시에 살아 있는 같은 조회가 있으면 그대로 돌려준다(락은 잠깐만 잡는다).
fn cache_lookup(key: &str) -> Option<Result<Vec<CalEvent>, String>> {
    let guard = CALENDAR_CACHE.lock().ok()?;
    let entry = guard.iter().find(|entry| entry.key == key)?;
    let ttl = if entry.result.is_ok() { CALENDAR_TTL } else { CALENDAR_ERROR_TTL };
    if entry.at.elapsed() < ttl {
        Some(entry.result.clone())
    } else {
        None
    }
}

fn cache_store(key: String, result: Result<Vec<CalEvent>, String>) {
    if let Ok(mut guard) = CALENDAR_CACHE.lock() {
        guard.retain(|entry| entry.key != key);
        guard.push(CalCacheEntry { key, at: Instant::now(), result });
        while guard.len() > CALENDAR_CACHE_MAX {
            guard.remove(0);
        }
    }
}

/// 기간·필터가 같은 조회를 한 줄 키로 만든다 — 필터는 순서와 상관없이 같은 키가 되게 정렬한다.
fn cache_key(start_ms: f64, end_ms: f64, ids: &Option<Vec<String>>) -> String {
    let filter = match ids {
        Some(list) => {
            let mut sorted = list.clone();
            sorted.sort();
            sorted.join(",")
        }
        None => "*".to_string(),
    };
    format!("{start_ms:.0}-{end_ms:.0}-{filter}")
}

async fn events_for_range(
    start_ms: f64,
    end_ms: f64,
    ids: Option<Vec<String>>,
) -> Result<Vec<CalEvent>, String> {
    if !(end_ms > start_ms) {
        return Err("조회 기간이 올바르지 않습니다".into());
    }
    if end_ms - start_ms > CALENDAR_MAX_RANGE_MS {
        return Err("한 번에 400일까지만 조회합니다".into());
    }

    let key = cache_key(start_ms, end_ms, &ids);
    if let Some(cached) = cache_lookup(&key) {
        return cached;
    }

    let fresh = tauri::async_runtime::spawn_blocking(move || read_events_between(start_ms, end_ms, ids))
        .await
        .map_err(|error| format!("캘린더 조회를 마치지 못했습니다: {error}"))?;

    cache_store(key, fresh.clone());
    fresh
}

/// 사용자의 캘린더 목록 — 화면의 독립 필터가 이 목록으로 체크박스를 만든다.
#[tauri::command]
pub async fn calendar_list() -> Result<Vec<CalCalendar>, String> {
    tauri::async_runtime::spawn_blocking(read_calendars)
        .await
        .map_err(|error| format!("캘린더 목록을 마치지 못했습니다: {error}"))?
}

/// 지정 기간의 일정 — `calendarIds` 를 주면 그 캘린더만. 달력(월·주·일) 보기가 쓴다.
#[tauri::command]
pub async fn calendar_events(
    start_ms: f64,
    end_ms: f64,
    calendar_ids: Option<Vec<String>>,
) -> Result<Vec<CalEvent>, String> {
    events_for_range(start_ms, end_ms, calendar_ids).await
}

#[tauri::command]
pub async fn calendar_today() -> Result<Vec<CalEvent>, String> {
    let (start, end) = today_range_ms()?;
    events_for_range(start, end, None).await
}
