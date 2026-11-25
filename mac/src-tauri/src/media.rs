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
    /// 지금 재생 위치(초). v1.15.0 — 노치 알약의 진행률 바.
    pub position: f64,
    /// 곡 길이(초). 0이면 알 수 없음(진행률은 그리지 않는다).
    pub duration: f64,
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
    /// 이 캘린더에 일정을 만들 수 있는지(v1.15.0 — 일정 추가의 선택 목록).
    pub writable: bool,
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

/* v1.17.2 — Spotify(공식 installer)의 재생 정보를 못 읽던 문제.
 *
 * 예전 STATE_SCRIPT 는 `if application "Spotify" is running` + `tell application "Spotify"` 로,
 * 앱 이름으로만 찾았다. 공식 installer 로 깐 Spotify 는 이름이 같아도 AppleScript 가 다른
 * 앱(예: 웹 플레이어를 감싼 것·스토어판)을 집어 오거나, 이름 해석이 실패하면 조용히
 * '재생 중인 곡 없음'으로 보였다. 또 `player state as text` 를 그대로 문자열로 받아
 * "playing" 이 들어 있는지만 봤기 때문에 `is playing` 판정이 흔들렸다.
 *
 * 이제는 ① 실행 중인 앱을 번들 ID(com.spotify.client, com.apple.Music)로 먼저 확인하고
 * (`is running` 은 자동화 권한이 필요 없다), ② `tell application id "..."` 로 그 앱만 정확히
 * 부르며, ③ `player state is playing` 으로 재생 여부를 명시적으로 판정한다.
 * 두 앱이 모두 떠 있으면 재생 중인 쪽을 고르고, 둘 다 멈춰 있으면 곡이 있는 쪽을 고른다.
 * ④ 자동화 권한이 막혀 -1743 이 오면 어느 앱인지 밝혀 "[permission] Spotify 자동화 권한이
 * 필요합니다" 처럼 돌려준다 — 노치 화면의 '권한 설정' 버튼이 그대로 연결된다.
 */

/// TIP 이 읽는 음악 앱 — 번들 ID 로 찾는다. `duration_div` 는 duration 단위 차이
/// (Spotify 는 밀리초, Apple Music 은 초)를 맞추는 값이다.
struct MediaApp {
    key: &'static str,
    name: &'static str,
    label: &'static str,
    bundle: &'static str,
    duration_div: u32,
}

const MEDIA_APPS: [MediaApp; 2] = [
    MediaApp { key: "spotify", name: "Spotify", label: "Spotify", bundle: "com.spotify.client", duration_div: 1000 },
    MediaApp { key: "music", name: "Music", label: "Apple Music", bundle: "com.apple.Music", duration_div: 1 },
];

/// 실행 중인 음악 앱을 번들 ID 로 확인한다 — 없으면 빈 문자열, 있으면 "spotify,music," 처럼.
/// `is running` 은 앱을 띄우지도, 자동화 권한을 묻지도 않는다. 앱이 설치돼 있지 않으면
/// 그 줄이 오류가 날 수 있어 try 로 감싼다(나머지 앱은 그대로 확인한다).
const RUNNING_SCRIPT: &str = r#"
set out to ""
try
  if application id "com.spotify.client" is running then set out to out & "spotify,"
end try
try
  if application id "com.apple.Music" is running then set out to out & "music,"
end try
return out
"#;

/// 앱 하나의 재생 상태 — `player state is playing` 으로 명시적으로 판정한다.
fn state_script(app: &MediaApp) -> String {
    // 번들 ID·이름은 아래 상수에서만 오므로 스크립트에 그대로 넣어도 안전하다.
    format!(
        r#"
set st to "stopped"
set t to ""
set ar to ""
set pos to 0
set dur to 0
tell application id "{bundle}"
  if player state is playing then
    set st to "playing"
  else if player state is paused then
    set st to "paused"
  end if
  try
    set t to name of current track
    set ar to artist of current track
  end try
  try
    set pos to player position
    set dur to (duration of current track) / {div}
  end try
end tell
return "{name}" & tab & st & tab & pos & tab & dur & tab & t & tab & ar
"#,
        bundle = app.bundle,
        div = app.duration_div,
        name = app.name
    )
}

/// AppleScript 가 돌려준 숫자를 0 이상의 초로 맞춘다 — 값이 없거나 이상하면 0.
fn seconds(value: Option<&&str>) -> f64 {
    value
        .and_then(|text| text.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(0.0)
}

/// `앱 이름\t상태\t위치\t길이\t제목\t아티스트` 한 줄을 MediaState 로. 형식이 어긋나면 None.
fn parse_media_state(raw: &str) -> Option<MediaState> {
    let line = raw.trim();
    if line.is_empty() {
        return None;
    }
    let parts: Vec<&str> = line.split('\t').collect();
    let app = parts.first().copied().unwrap_or("").to_string();
    // v1.17.2 — `player state is playing` 으로 이미 "playing"/"paused"/"stopped" 로 정리해 온다.
    // 예전 스크립트가 돌려주던 "playing (1)" 같은 문장도 받아 준다.
    let playing = parts.get(1).map(|state| state.trim().starts_with("playing")).unwrap_or(false);
    let position = seconds(parts.get(2));
    let duration = seconds(parts.get(3));
    // 곡 제목에 탭이 들어 있어도 제목만 어긋나게 하고 아티스트는 끝까지 모은다.
    let title = parts.get(4).copied().unwrap_or("").to_string();
    let artist = parts.iter().skip(5).copied().collect::<Vec<_>>().join("\t");
    let position = if duration > 0.0 { position.min(duration) } else { position };
    Some(MediaState { app, playing, title, artist, position, duration })
}

fn empty_media_state() -> MediaState {
    MediaState {
        app: String::new(),
        playing: false,
        title: String::new(),
        artist: String::new(),
        position: 0.0,
        duration: 0.0,
    }
}

fn read_media_state() -> Result<MediaState, String> {
    let running = osascript(RUNNING_SCRIPT, MEDIA_TIMEOUT)?;
    let running = running.to_ascii_lowercase();

    let mut best: Option<MediaState> = None;
    let mut denied: Vec<&'static str> = Vec::new();
    let mut failure: Option<String> = None;

    for app in MEDIA_APPS.iter() {
        if !running.contains(app.key) {
            continue;
        }
        match osascript(&state_script(app), MEDIA_TIMEOUT) {
            Ok(raw) => {
                let Some(state) = parse_media_state(&raw) else { continue };
                // 재생 중인 앱이 있으면 그것이 답이다.
                if state.playing {
                    return Ok(state);
                }
                // 아니면 곡이 있는 앱을 남겨 두고(멈춤 표시), 없으면 첫 앱을 쓴다.
                let better = match best.as_ref() {
                    Some(current) => current.title.is_empty() && !state.title.is_empty(),
                    None => true,
                };
                if better {
                    best = Some(state);
                }
            }
            Err(error) => {
                if is_permission_denied(&error) {
                    denied.push(app.label);
                } else {
                    failure = Some(with_permission_hint(&format!("{} 자동화", app.label), error));
                }
            }
        }
    }

    if let Some(state) = best {
        Ok(state)
    } else if !denied.is_empty() {
        // 어느 앱의 자동화를 허용해야 하는지 그대로 알린다 — 화면이 '권한 설정' 버튼을 띄운다.
        Err(format!("{PERMISSION_TAG} {} 자동화 권한이 필요합니다", denied.join("·")))
    } else if let Some(error) = failure {
        Err(error)
    } else {
        Ok(empty_media_state())
    }
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
    let Some(app) = MEDIA_APPS.iter().find(|app| app.name == state.app) else {
        return Err("재생 중인 음악 앱이 없습니다".into());
    };
    // v1.17.2 — 앱 이름이 아니라 번들 ID 로 조작한다(공식 installer 로 깐 Spotify 도 같은 앱).
    let script = format!("tell application id \"{}\" to {command}", app.bundle);
    osascript(&script, MEDIA_TIMEOUT)
        .map(|_| ())
        .map_err(|error| with_permission_hint(&format!("{} 자동화", app.label), error))
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || control_media(&action))
        .await
        .map_err(|error| format!("미디어 조작을 마치지 못했습니다: {error}"))?
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
                let (source, writable) = unsafe {
                    (
                        calendar
                            .source()
                            .map(|source| source.title().to_string())
                            .unwrap_or_default(),
                        calendar.allowsContentModifications(),
                    )
                };
                CalCalendar { id, title, color, source, writable }
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

/* --------------------------- 캘린더 — 일정 추가 (v1.15.0) --------------------------- */

/// 캐시를 통째로 버린다 — 새 일정을 저장한 직후 화면이 다시 읽을 때 반드시 새 값을 받도록.
fn clear_calendar_cache() {
    if let Ok(mut guard) = CALENDAR_CACHE.lock() {
        guard.clear();
    }
}

/// macOS — EventKit 으로 일정을 하나 만든다.
/// `calendar_id` 가 없거나 쓸 수 없는 캘린더면 `defaultCalendarForNewEvents`,
/// 그것도 없으면 쓸 수 있는(비어 있지 않은) 첫 캘린더에 넣는다.
/// 읽기 전용(allowsContentModifications == false) 캘린더에는 절대 쓰지 않는다.
#[cfg(target_os = "macos")]
fn create_event(
    title: &str,
    start_ms: f64,
    end_ms: f64,
    all_day: bool,
    calendar_id: Option<String>,
) -> Result<(), String> {
    use objc2_event_kit::{EKEntityType, EKEvent, EKSpan};
    use objc2_foundation::{NSDate, NSString};

    let title = title.trim();
    if title.is_empty() {
        return Err("일정 제목을 넣어 주세요".into());
    }
    let title: String = title.chars().take(200).collect();
    if !(start_ms.is_finite() && end_ms.is_finite()) || end_ms <= start_ms {
        return Err("끝 시각이 시작보다 빨라요".into());
    }

    // with_calendar_store 는 안쪽 Result(저장 결과)를 감싸 돌려준다 — 바깥(권한·store)만 ? 로 풀고
    // 안쪽(일정 저장 성공·실패)은 그대로 돌려준다.
    with_calendar_store(|store| -> Result<(), String> {
        // SAFETY: 메인 스레드가 아닌 워커 스레드의 autoreleasepool 안에서 만든 store 와
        // 그 store 가 돌려준 객체만 이 블록 안에서 쓴다. 저장은 commit: YES 로 바로 반영한다.
        unsafe {
            let calendars = store.calendarsForEntityType(EKEntityType::Event);
            let writable: Vec<_> = calendars
                .to_vec()
                .into_iter()
                .filter(|calendar| calendar.allowsContentModifications())
                .collect();
            if writable.is_empty() {
                return Err("일정을 저장할 수 있는 캘린더가 없습니다 — 캘린더 앱에서 계정을 확인해 주세요".into());
            }

            let wanted = calendar_id.unwrap_or_default();
            let chosen = if wanted.is_empty() {
                store
                    .defaultCalendarForNewEvents()
                    .filter(|calendar| calendar.allowsContentModifications())
                    .or_else(|| writable.first().cloned())
            } else {
                writable
                    .iter()
                    .find(|calendar| calendar.calendarIdentifier().to_string() == wanted)
                    .cloned()
            };
            let Some(calendar) = chosen else {
                return Err("고른 캘린더에는 일정을 쓸 수 없습니다".into());
            };

            let event = EKEvent::eventWithEventStore(&store);
            event.setTitle(Some(&NSString::from_str(&title)));
            let start = NSDate::dateWithTimeIntervalSince1970(start_ms / 1000.0);
            let end = NSDate::dateWithTimeIntervalSince1970(end_ms / 1000.0);
            event.setStartDate(Some(&start));
            event.setEndDate(Some(&end));
            event.setAllDay(all_day);
            event.setCalendar(Some(&calendar));

            store
                .saveEvent_span_commit_error(&event, EKSpan::ThisEvent, true)
                .map_err(|error| format!("일정을 저장하지 못했습니다: {}", error.localizedDescription()))?;
            Ok(())
        }
    })?
}

#[cfg(not(target_os = "macos"))]
fn create_event(
    _title: &str,
    _start_ms: f64,
    _end_ms: f64,
    _all_day: bool,
    _calendar_id: Option<String>,
) -> Result<(), String> {
    Err("일정 추가는 macOS 앱에서만 됩니다".into())
}

/// 노치 달력에서 일정을 하나 만든다. 성공하면 조회 캐시를 비워 화면이 새로 읽게 한다.
#[tauri::command]
pub async fn calendar_create(
    title: String,
    start_ms: f64,
    end_ms: f64,
    all_day: Option<bool>,
    calendar_id: Option<String>,
) -> Result<(), String> {
    let all_day = all_day.unwrap_or(false);
    let result = tauri::async_runtime::spawn_blocking(move || {
        create_event(&title, start_ms, end_ms, all_day, calendar_id)
    })
    .await
    .map_err(|error| format!("일정 추가를 마치지 못했습니다: {error}"))?;

    if result.is_ok() {
        clear_calendar_cache();
    }
    result
}
