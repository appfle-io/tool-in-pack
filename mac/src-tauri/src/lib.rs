// TIP (TOOL-IN-PACK) macOS 앱 — 메뉴 막대 반원 퀵바 + 전체 창.
//
// - 전체 창(main): 웹(PWA)과 같은 화면. 창을 닫아도 앱은 살아 있고 메뉴 막대에서 다시 연다.
// - 메뉴 막대 아이콘(트레이) 좌클릭: 아이콘 아래에 반원 퀵바(quickbar)를 띄우고, 다시 누르면 닫는다.
// - 퀵바의 ⚙ 버튼은 메인 창을 띄우고 `tip://open-settings` 로 설정 시트를 연다(창이 이미 떠 있어도).
// - 퀵바에서 모듈을 고르면 420×680 컴팩트 창(tool)이 그 모듈 화면으로 열린다.
// - 모든 창은 같은 origin 이라 localStorage(모듈 켜기/끄기, 순서, 테마)를 그대로 공유한다.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine as _;
use futures_util::StreamExt;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod apps;
mod autostart;
mod capture;
mod clip;
mod dialogs;
mod files;
mod media;
mod notch;
mod sticky;
mod system;

const QUICKBAR: &str = "quickbar";
const TOOL: &str = "tool";
const NOTCH: &str = "notch";
const SEARCH: &str = "search";
const PARCEL: &str = "parcel";
/// 우편번호 검색 전용 창(v1.15.1) — capabilities/default.json 의 windows 목록에 없으므로
/// Tauri IPC 권한이 전혀 없다.
const POSTCODE: &str = "postcode";

// 퀵바 창 — 납작한 반타원 판(가로 284·세로 176)이 위쪽 일직선으로 메뉴 막대에 붙고,
// 아래로 176px 내려간다. 창 높이 206 = 판 176 + 아래 그림자 여백 30.
const QUICKBAR_W: f64 = 580.0;
const QUICKBAR_H: f64 = 206.0;
const TOOL_W: f64 = 420.0;
const TOOL_H: f64 = 680.0;

// 노치 아일랜드 — 화면 최상단 중앙(y=0, 노치 자리). 접힌 알약과 펼친 패널의 크기만 다르다.
// v1.12.2 — 알약 높이를 46 → 28 로 줄여 화면 최상단에 밀착한다(노치 화면에서는 노치 높이).
// v1.12.4 — 알약 창 너비를 240 → 92 로 줄인다. 알약(TIP ●)은 72px 남짓인데 창이 240px 이라
//  양옆으로 84px 씩 투명한 창이 메뉴 막대 아이콘을 덮어 클릭이 먹지 않았다.
const NOTCH_PILL_W: f64 = 92.0;
const NOTCH_PILL_H: f64 = 28.0;
const NOTCH_OPEN_W: f64 = 452.0;
// v1.15.2 — 펼친 패널의 높이. 예전 한 값(600) 대신 내용에 맞춰 화면이 요청한 높이를 쓴다
// (notch_resize). 아래 한계 안에서만 움직이고, 기본값은 그보다 조금 낮춘 540 이다.
const NOTCH_OPEN_H: f64 = 540.0;
const NOTCH_OPEN_MIN_H: f64 = 300.0;
const NOTCH_OPEN_MAX_H: f64 = 600.0;
// v1.15.0 — 접힌 알약이 음악·타이머를 품을 때 더하는 폭(논리 pt).
//   음악 날개: 이퀄라이저 + 짧은 곡 제목 + 진행률 바 / 타이머 날개: 남은 시간.
const NOTCH_PILL_MEDIA_W: f64 = 150.0;
const NOTCH_PILL_TIMER_W: f64 = 84.0;

// 전역 빠른 실행 검색 — 화면 가운데 위쪽의 작은 팔레트.
// v1.14.0 — 계산기·웹 검색·파일·앱·스니펫까지 담느라 440 → 520 으로 조금 높였다.
const SEARCH_W: f64 = 640.0;
const SEARCH_H: f64 = 520.0;

// 배송 조회 — 네이버 배송조회를 앱 안에서 여는 컴팩트 창(일반 창이라 사용자가 닫·크기 조절).
// v1.13.0 — 네이버의 PC 웹 레이아웃이 480px 창에 가로로 넘쳐, 모바일 판(m.search.naver.com)을
// 아이폰 Safari User-Agent 로 열고 창을 460×740(모바일 화면 비율)에 맞춘다.
const PARCEL_W: f64 = 460.0;
const PARCEL_H: f64 = 740.0;

// 우편번호 창(v1.15.1) — 다음(카카오) 우편번호 서비스를 앱 본문과 다른 창에서 띄운다.
// 일반 창이라 사용자가 닫을 수 있고, 창 라벨(postcode)은 capabilities 에 없어 IPC 권한이 없다.
const POSTCODE_W: f64 = 520.0;
const POSTCODE_H: f64 = 720.0;
/// 우편번호 창에서 Tauri 전역을 지우는 초기화 스크립트 — 카카오 스크립트가 IPC 를 찾지 못하게.
/// (창 자체에 IPC 권한이 없지만, 창에 window.__TAURI__ 와 parent.__TAURI__ 를 둘 다 못 쓰게 한다.)
const POSTCODE_HIDE_TAURI: &str = "try{delete window.__TAURI__;delete window.__TAURI_INTERNALS__;}catch(e){}";
/// 우편번호 창이 주소를 골랐을 때 이동하는 페이지 — 그 조각(#d=<base64 JSON>)만 결과로 받는다.
const POSTCODE_DONE_PAGE: &str = "postcode-done.html";
/// 배송 조회 창이 스스로를 모바일 Safari 로 알리는 값 — 네이버가 모바일 레이아웃을 내려 준다.
const PARCEL_USER_AGENT: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) \
     AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DEFAULT_SEARCH_SHORTCUT: &str = "Alt+Space";
/// 전역 단축키 표에서 검색을 가리키는 키.
const SEARCH_KEY: &str = "search";
/// 열어도 되는 웹 주소 — 전역 검색의 웹 검색 두 곳과 문의 메일만.
const WEB_ALLOWED_HOSTS: [&str; 4] = ["www.google.com", "google.com", "search.naver.com", "m.search.naver.com"];

const RELEASES_LATEST: &str = "https://api.github.com/repos/appfle-io/tool-in-pack/releases/latest";

/// 마지막으로 누른 메뉴 막대 아이콘의 사각형(물리 픽셀: x, y, w, h).
static TRAY_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

/// 우편번호 창이 고른 주소 — 마지막 결과 한 건.
/// 창에서 온 결과를 이벤트로 바로 알리고, 화면이 늦게 붙었을 때도 꺼낼 수 있게 같이 남긴다(v1.15.1).
static POSTCODE_RESULT: Mutex<Option<(i64, String)>> = Mutex::new(None);

/// 메인 창의 화면이 아직 준비되기 전에 환경설정 요청이 왔는지 — 앱이 켜질 때 한 번 꺼낸다.
static PENDING_SETTINGS: Mutex<bool> = Mutex::new(false);

/// 노치 아일랜드가 펼쳐져 있는지(창 크기 상태).
static NOTCH_OPEN: Mutex<bool> = Mutex::new(false);

/// 펼친 패널의 높이 — 화면(notch.js)이 내용 높이를 재서 알려 준 값(v1.15.2).
/// None 이면 기본값(NOTCH_OPEN_H)을 쓴다. 값은 NOTCH_OPEN_MIN_H..=NOTCH_OPEN_MAX_H 로 자른다.
static NOTCH_OPEN_HEIGHT: Mutex<Option<f64>> = Mutex::new(None);

/// 접힌 알약에 지금 무엇을 보여 주는지 — 화면(notch.js)이 알린다(v1.15.0).
/// true 인 쪽만큼 알약 창을 넓혀 곡 제목·진행률과 타이머를 담는다.
static PILL_MEDIA: AtomicBool = AtomicBool::new(false);
static PILL_TIMER: AtomicBool = AtomicBool::new(false);

/// 환경설정의 '마우스를 올려서 열기'(기본 OFF) — 프런트가 값을 밀어 준다.
static HOVER_OPEN: AtomicBool = AtomicBool::new(false);
/// 프런트가 '지금은 접지 마라'고 알린 상태(입력 중·파일 드래그 중).
static HOVER_HOLD: AtomicBool = AtomicBool::new(false);
/// 커서 감시 스레드를 이미 띄웠는지.
static HOVER_WATCH: AtomicBool = AtomicBool::new(false);
/// 펼친 패널 밖으로 커서가 나간 시각 — 0.7초 넘게 밖에 있으면 접는다.
static HOVER_OUTSIDE_SINCE: Mutex<Option<Instant>> = Mutex::new(None);

/// 지금 등록된 전역 빠른 실행 단축키.
static SEARCH_SHORTCUT: Mutex<Option<String>> = Mutex::new(None);

/// 전역 단축키 표 — (키, accelerator). 키는 "search" 또는 기능 id(모듈 id·"snap:left" 등).
/// 값의 진짜 주인은 화면(localStorage)이고, 앱이 켜질 때 set_module_shortcuts 로 밀어 준다.
/// v1.14.0 — 검색 단축키 하나만 있던 것을 기능별 단축키까지 함께 등록하는 표로 넓혔다.
static SHORTCUT_TABLE: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
/// 표를 실제 단축키로 풀어 둔 것 — 눌렸을 때 어느 기능인지 찾는 데 쓴다.
static SHORTCUT_ACTIVE: Mutex<Vec<(String, tauri_plugin_global_shortcut::Shortcut)>> = Mutex::new(Vec::new());

/// check_app_update 가 찾은 자동 업데이트 대상 — 설치 커맨드는 이 값만 쓴다(v1.12.4).
/// 프런트가 임의의 주소를 넘겨 임의 파일을 설치하지 못하게 하기 위해서다.
static UPDATE_TARGET: Mutex<Option<UpdateTarget>> = Mutex::new(None);

/// 드롭으로 받은 파일 경로 — read_shelf_file 은 이 목록에 있는 경로만 한 번 읽는다(v1.12.4).
static SHELF_ALLOWED: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// 허용 목록에 담아 둘 최대 개수 — 넘치면 오래된 것부터 버린다.
const SHELF_ALLOWED_MAX: usize = 64;

/* ----------------------------- 창 위치 계산 ----------------------------- */

/// 메뉴 막대 아이콘의 (가운데 x, 아래 y, 화면 배율) — 논리 좌표.
fn tray_anchor(app: &AppHandle) -> Option<(f64, f64)> {
    let rect = *TRAY_RECT.lock().unwrap();
    let scale = app
        .get_webview_window("main")
        .and_then(|win| win.scale_factor().ok())
        .unwrap_or(2.0);

    match rect {
        Some((x, y, w, h)) if w > 0.0 => Some(((x + w / 2.0) / scale, (y + h) / scale)),
        Some((x, y, _, _)) => Some((x / scale, y / scale)),
        None => None,
    }
}

/// 창을 메뉴 막대 아이콘 바로 아래에 놓는다. 화면 밖으로 나가지 않게 안쪽으로 밀어 넣는다.
/// `gap` 은 아이콘 아래 여백 — 반원 퀵바는 위쪽 일직선이 메뉴 막대에 붙도록 2px 로 둔다.
fn place_under_tray(app: &AppHandle, win: &WebviewWindow, width: f64, height: f64, gap: f64) {
    let Some((anchor_x, anchor_y)) = tray_anchor(app) else {
        return;
    };

    let mut x = anchor_x - width / 2.0;
    let mut y = anchor_y + gap;

    if let Ok(Some(monitor)) = win.current_monitor() {
        let scale = monitor.scale_factor();
        let screen = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        let min_x = origin.x + 8.0;
        let max_x = origin.x + screen.width - width - 8.0;
        let max_y = origin.y + screen.height - height - 8.0;

        x = x.clamp(min_x, max_x.max(min_x));
        y = y.min(max_y).max(origin.y + gap);
    }

    let _ = win.set_position(Position::Logical(LogicalPosition::new(x, y)));
}

/* ------------------------------- 퀵바 창 ------------------------------- */

fn quickbar_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(win) = app.get_webview_window(QUICKBAR) {
        return Ok(win);
    }

    let mut builder = WebviewWindowBuilder::new(app, QUICKBAR, WebviewUrl::App("radial.html".into()))
        .title("TIP 퀵바")
        .inner_size(QUICKBAR_W, QUICKBAR_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // v1.16.0 — 만들 때 앱을 활성화하면 다른 앱의 전체화면 Space 에서 벗어난다.
        // 초점은 show_quickbar 가 make_key 로 직접 준다.
        .focused(false);

    #[cfg(target_os = "macos")]
    {
        // 첫 클릭이 창을 활성화하는 데만 쓰이지 않고 바로 모듈을 누를 수 있게 한다.
        builder = builder.accept_first_mouse(true);
    }

    let win = builder.build()?;

    // 바깥을 누르거나 다른 앱으로 옮겨 가면(=포커스 아웃) 퀵바를 닫는다.
    let handle = win.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            let _ = handle.hide();
        }
    });

    Ok(win)
}

fn show_quickbar(app: &AppHandle) {
    let win = match quickbar_window(app) {
        Ok(win) => win,
        Err(error) => {
            eprintln!("[TIP] 퀵바 창을 만들지 못했습니다: {error}");
            return;
        }
    };

    // v1.16.0 — 전체화면 앱(별도 Space) 위에서도 화면 전환 없이 메뉴 아이콘 아래에 뜨게 NSPanel 로 만든다.
    // 검색 창과 같은 방식: orderFrontRegardless + makeKeyWindow, 앱은 활성화하지 않는다.
    // 바깥을 누르면 Focused(false) 이벤트가 그대로 와서 창을 닫는다.
    let _ = notch::pin_search(&win);
    place_under_tray(app, &win, QUICKBAR_W, QUICKBAR_H, 2.0);
    let _ = win.show();
    let _ = notch::order_front(&win);
    let _ = notch::make_key(&win);
    let _ = win.emit("tip://quickbar-refresh", ());
}

fn toggle_quickbar(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(QUICKBAR) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    show_quickbar(app);
}

/* --------------------------- 노치 아일랜드 창 (v1.12.0) --------------------------- */

/// 화면 최상단 가운데 — 노치 자리. `offset` 만큼 아래로 내린다.
fn place_top_center(app: &AppHandle, win: &WebviewWindow, width: f64, height: f64, offset: f64) {
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let x = origin.x + (screen.width - width) / 2.0;
    let y = origin.y + offset;

    let _ = win.set_size(Size::Logical(LogicalSize::new(width, height)));
    let _ = win.set_position(Position::Logical(LogicalPosition::new(x, y)));
}

fn notch_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(win) = app.get_webview_window(NOTCH) {
        return Ok(win);
    }

    // v1.12.2 — 접힌 알약은 화면 물리적 최상단에 밀착한다. 노치 화면이면 노치를 감싸는 크기.
    let (pill_w, pill_h) = collapsed_pill_size();

    let mut builder = WebviewWindowBuilder::new(app, NOTCH, WebviewUrl::App("notch.html".into()))
        .title("TIP 노치 아일랜드")
        .inner_size(pill_w, pill_h)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false);
    // v1.12.2 — Finder 파일 드롭은 HTML5 dataTransfer 가 아니라 Tauri 네이티브
    // DragDrop 이벤트(WindowEvent::DragDrop)로 받는다. 그래서 disable_drag_drop_handler 를
    // 켜지 않고 기본값 그대로 둔다(아래 on_window_event 가 tip://shelf-drop 으로 넘긴다).

    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    let win = builder.build()?;

    // v1.12.1 — 일반 창은 메뉴 막대 아래로 밀려서 노치 자리에 붙지 못한다.
    // 이 창만 NSPanel 로 바꿔 레벨을 올리고 화면 최상단(y=0) 가운데에 붙인다.
    // v1.12.2 — 같은 패널을 키 입력을 받는 서브클래스(TipNotchPanel)로 바꾼다.
    if !notch::pin(&win) {
        eprintln!("[TIP] 노치 창을 패널로 바꾸지 못했습니다 — 일반 창 배치로 물러섭니다");
    }
    place_notch(app, &win, pill_w, pill_h, false);
    // Finder 에서 끌어온 파일 — 네이티브 드롭 이벤트를 프런트(보관함 위젯)로 넘긴다.
    let drop_win = win.clone();
    win.on_window_event(move |event| {
        let WindowEvent::DragDrop(drag) = event else { return };
        match drag {
            tauri::DragDropEvent::Enter { .. } => {
                let _ = drop_win.emit("tip://shelf-drag", true);
            }
            tauri::DragDropEvent::Drop { paths, .. } => {
                let files: Vec<String> = paths
                    .iter()
                    .map(|path| path.to_string_lossy().to_string())
                    .collect();
                // v1.12.4 — 실제로 드롭된 경로만 read_shelf_file 이 읽을 수 있게 허용 목록에 담는다.
                allow_shelf_paths(&paths);
                let _ = drop_win.emit("tip://shelf-drop", files);
            }
            tauri::DragDropEvent::Leave => {
                let _ = drop_win.emit("tip://shelf-drag", false);
            }
            _ => {}
        }
    });

    // 접힘은 프런트(notch.js)가 맡는다 — 마우스가 창을 나가면·Esc·접기(⌃) 버튼.
    // NonActivatingPanel 은 다른 앱을 눌러도 포커스가 오지 않아 Focused(false) 가 오지 않고,
    // 그 이벤트로 접으면 알약을 클릭하는 순간 리사이즈와 겹쳐 멈추던 원인이었다.
    Ok(win)
}

/// 노치 창을 화면 최상단 가운데(width×height)에 붙인다 — AppKit 패널 배치가 우선.
fn place_notch(app: &AppHandle, win: &WebviewWindow, width: f64, height: f64, open: bool) {
    if notch::place(win, width, height, open) {
        return;
    }
    place_top_center(app, win, width, height, 0.0);
}

/// 접힌 알약 창의 크기 — 노치 화면이면 노치를 감싸고, 지금 보여 주는 내용만큼 넓어진다.
fn collapsed_pill_size() -> (f64, f64) {
    let (width, height) = notch::pill_size(NOTCH_PILL_W, NOTCH_PILL_H);
    let mut extra = 0.0;
    if PILL_MEDIA.load(Ordering::Relaxed) {
        extra += NOTCH_PILL_MEDIA_W;
    }
    if PILL_TIMER.load(Ordering::Relaxed) {
        extra += NOTCH_PILL_TIMER_W;
    }
    (width + extra, height)
}

/// 펼친 패널의 높이 — 화면이 재서 알려 준 값(한계 안으로 자른 값), 없으면 기본값.
fn notch_open_height() -> f64 {
    NOTCH_OPEN_HEIGHT
        .lock()
        .ok()
        .and_then(|slot| *slot)
        .unwrap_or(NOTCH_OPEN_H)
        .clamp(NOTCH_OPEN_MIN_H, NOTCH_OPEN_MAX_H)
}

/// 접힘/펼침 — 창 크기를 바꾸고 다시 화면 최상단 가운데에 붙인다.
fn set_notch_open(app: &AppHandle, open: bool) {
    let Some(win) = app.get_webview_window(NOTCH) else { return };
    let (width, height) = if open {
        (NOTCH_OPEN_W, notch_open_height())
    } else {
        collapsed_pill_size()
    };
    *NOTCH_OPEN.lock().unwrap() = open;
    place_notch(app, &win, width, height, open);
}

fn show_notch(app: &AppHandle) {
    let win = match notch_window(app) {
        Ok(win) => win,
        Err(error) => {
            eprintln!("[TIP] 노치 창을 만들지 못했습니다: {error}");
            return;
        }
    };
    let open = *NOTCH_OPEN.lock().unwrap();
    let (width, height) = if open {
        (NOTCH_OPEN_W, notch_open_height())
    } else {
        collapsed_pill_size()
    };
    place_notch(app, &win, width, height, open);
    // v1.12.3 — win.show()(makeKeyAndOrderFront)는 다른 앱이 전체화면일 때 노치를 그 Space 뒤로 내리고
    // 키 창을 가져가려 한다. 패널을 활성화하지 않고 순서만 올리는 orderFrontRegardless 를 쓴다.
    // (실패하면 — 패널로 바꾸지 못한 환경 — 예전처럼 show 로 물러선다.)
    if !notch::order_front(&win) {
        let _ = win.show();
        if !notch::order_front(&win) {
            eprintln!("[TIP] 노치 창을 메뉴 막대 위로 올리지 못했습니다");
        }
    }
    place_notch(app, &win, width, height, open);
    let _ = win.emit("tip://notch-refresh", ());
}

#[tauri::command]
fn notch_expand(app: AppHandle) {
    set_notch_open(&app, true);
}

#[tauri::command]
fn notch_collapse(app: AppHandle) {
    set_notch_open(&app, false);
}

/// 펼친 패널의 높이를 내용에 맞춘다(v1.15.2). 화면(notch.js)이 잰 높이를 넘기고,
/// Rust 가 한계(300~600pt) 안으로 자른 값만 쓴다. 펼쳐져 있을 때만 창을 다시 배치한다.
#[tauri::command]
fn notch_resize(app: AppHandle, height: f64) {
    if !height.is_finite() {
        return;
    }
    let clamped = height.clamp(NOTCH_OPEN_MIN_H, NOTCH_OPEN_MAX_H);
    let changed = {
        let Ok(mut slot) = NOTCH_OPEN_HEIGHT.lock() else { return };
        let previous = slot.unwrap_or(NOTCH_OPEN_H);
        if (previous - clamped).abs() < 1.0 {
            return;
        }
        *slot = Some(clamped);
        true
    };
    if !changed || !*NOTCH_OPEN.lock().unwrap() {
        return;
    }
    if let Some(win) = app.get_webview_window(NOTCH) {
        place_notch(&app, &win, NOTCH_OPEN_W, clamped, true);
    }
}

/* ------------------- 접힌 알약의 내용·크기 (v1.15.0) ------------------- */

/// 접힌 알약에 음악·타이머를 보일지 알린다. 값이 바뀌면 접힌 창 크기를 바로 다시 잡는다
/// (펼쳐져 있으면 접을 때 새 크기로 돌아간다). 화면이 필요 없는 값은 보내지 않는다.
#[tauri::command]
fn set_notch_pill(app: AppHandle, media: bool, timer: bool) {
    let was_media = PILL_MEDIA.swap(media, Ordering::Relaxed);
    let was_timer = PILL_TIMER.swap(timer, Ordering::Relaxed);
    let changed = was_media != media || was_timer != timer;
    if !changed {
        return;
    }
    if *NOTCH_OPEN.lock().unwrap() {
        return;
    }
    if let Some(win) = app.get_webview_window(NOTCH) {
        let (width, height) = collapsed_pill_size();
        place_notch(&app, &win, width, height, false);
    }
}

/// 노치 화면 정보 — 화면 크기와 노치 크기(없으면 0). 화면은 가운데를 비워 둔다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NotchMetrics {
    has_notch: bool,
    notch_width: f64,
    notch_height: f64,
    screen_width: f64,
    screen_height: f64,
}

#[tauri::command]
fn notch_metrics() -> NotchMetrics {
    match notch::metrics() {
        Some((screen_width, screen_height, width, height)) => NotchMetrics {
            has_notch: width > 1.0 && height > 1.0,
            notch_width: width,
            notch_height: height,
            screen_width,
            screen_height,
        },
        None => NotchMetrics {
            has_notch: false,
            notch_width: 0.0,
            notch_height: 0.0,
            screen_width: 0.0,
            screen_height: 0.0,
        },
    }
}

/* --------------------- 커서 감시 — 다른 앱을 쓰는 중에도 열린다 (v1.12.4) --------------------- */

/// 환경설정의 '마우스를 올려서 열기' — 프런트(store.js)가 저장값을 그대로 밀어 준다.
/// 켜면 커서 감시 스레드가 알약 위로 커서가 들어오는 순간 펼친다(클릭 불필요).
#[tauri::command]
fn set_notch_hover(app: AppHandle, enabled: bool) {
    HOVER_OPEN.store(enabled, Ordering::Relaxed);
    if enabled {
        start_hover_watch(app);
    } else if let Ok(mut slot) = HOVER_OUTSIDE_SINCE.lock() {
        *slot = None;
    }
}

/// 프런트가 알리는 '지금은 접지 마라' — 빠른 메모 입력 중·파일 드래그 중.
#[tauri::command]
fn notch_hover_hold(hold: bool) {
    HOVER_HOLD.store(hold, Ordering::Relaxed);
}

/// 130ms 마다 커서 위치를 본다 — WKWebView 는 앱이 백그라운드일 때 DOM mouseenter 를 보내지 않아
/// 다른 앱(사파리·피클)을 쓰는 중에는 마우스를 올려도 반응이 없었다. NSEvent::mouseLocation() 은
/// 손쉬운 사용 권한 없이 쓸 수 있는 AppKit 의 커서 좌표다(창 프레임과 같은 좌표계).
fn start_hover_watch(app: AppHandle) {
    if HOVER_WATCH.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(130));
        if !HOVER_OPEN.load(Ordering::Relaxed) {
            if let Ok(mut slot) = HOVER_OUTSIDE_SINCE.lock() {
                *slot = None;
            }
            continue;
        }
        // AppKit 을 만지는 부분은 메인 스레드로 보낸는다(웹뷰·창은 메인 스레드 소유).
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || hover_tick(&handle));
    });
}

/// 한 번의 커서 확인 — 접혀 있으면 알약 위로 들어올 때 펼치고,
/// 펼쳐져 있으면 패널 밖으로 0.7초 넘게 나가 있으면 접는다.
fn hover_tick(app: &AppHandle) {
    let Some(win) = app.get_webview_window(NOTCH) else { return };
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    let open = *NOTCH_OPEN.lock().unwrap();
    // 여유를 조금 둔다 — 알약 가장자리에서 깜박이지 않게.
    let Some(inside) = notch::cursor_inside(&win, if open { 6.0 } else { 4.0 }) else {
        return;
    };

    if inside {
        if let Ok(mut slot) = HOVER_OUTSIDE_SINCE.lock() {
            *slot = None;
        }
        if !open {
            set_notch_open(app, true);
            let _ = app.emit("tip://notch-hover-enter", ());
        }
        return;
    }

    if !open || HOVER_HOLD.load(Ordering::Relaxed) {
        if let Ok(mut slot) = HOVER_OUTSIDE_SINCE.lock() {
            *slot = None;
        }
        return;
    }

    let now = Instant::now();
    let elapsed = {
        let mut slot = match HOVER_OUTSIDE_SINCE.lock() {
            Ok(slot) => slot,
            Err(_) => return,
        };
        match *slot {
            Some(since) => now.duration_since(since),
            None => {
                *slot = Some(now);
                Duration::from_millis(0)
            }
        }
    };
    if elapsed >= Duration::from_millis(700) {
        set_notch_open(app, false);
        if let Ok(mut slot) = HOVER_OUTSIDE_SINCE.lock() {
            *slot = None;
        }
        let _ = app.emit("tip://notch-hover-leave", ());
    }
}

/// 노치 창을 key window 로 만든다 — 빠른 메모(textarea)를 클릭했을 때 바로 타이핑되게.
/// borderless NSPanel 은 스스로 key window 가 되지 못해 입력이 들어가지 않았다(v1.12.2).
///
/// v1.15.3 — win.set_focus() 를 함께 부르면 앱 활성화와 key 창 전환이 겹쳐 커서가 한 번
/// 사라졌다. make_key 하나만 부르고, 이미 key window 면 그 안에서 그대로 돌아온다.
#[tauri::command]
fn notch_focus(app: AppHandle) {
    let Some(win) = app.get_webview_window(NOTCH) else { return };
    if !notch::make_key(&win) {
        eprintln!("[TIP] 노치 창을 키 창으로 만들지 못했습니다");
    }
}

/// macOS 시스템 설정의 '개인정보 보호 및 보안' 해당 항목을 연다(v1.12.3).
/// 허용한 다섯 가지만 연다 — 문자열을 그대로 주소로 쓰지 않는다.
#[tauri::command]
fn open_privacy_settings(kind: String) -> Result<(), String> {
    let pane = match kind.as_str() {
        "automation" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
        "calendars" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
        "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
        // v1.14.0 — 창 분할(손쉬운 사용)과 화면 도구(화면 기록)
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "screen-recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        _ => return Err("알 수 없는 권한 항목입니다".into()),
    };
    std::process::Command::new("open")
        .arg(pane)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("시스템 설정을 열지 못했습니다: {error}"))
}

/// 클립보드에 글자를 넣는다 — 계산기 결과·스니펫·색상 코드 복사.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    let mut board = arboard::Clipboard::new().map_err(|error| format!("클립보드를 열지 못했습니다: {error}"))?;
    board.set_text(text).map_err(|error| format!("복사하지 못했습니다: {error}"))
}

/// 바깥 주소를 기본 앱으로 연다 — 웹 검색(http·https 허용 목록)과 문의 메일(mailto)만.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let value = url.trim();
    if value.is_empty() {
        return Err("주소가 비어 있습니다".into());
    }

    if let Some(rest) = value.strip_prefix("mailto:") {
        let address = rest.split(['?', '&', '#']).next().unwrap_or("").trim();
        if address != "appfle.io@gmail.com" {
            return Err("TIP 문의 주소만 열 수 있습니다".into());
        }
    } else {
        let parsed: tauri::Url = value.parse().map_err(|_| "주소를 읽지 못했습니다".to_string())?;
        if parsed.scheme() != "https" {
            return Err("https 주소만 열 수 있습니다".into());
        }
        let host = parsed.host_str().unwrap_or_default();
        if !WEB_ALLOWED_HOSTS.contains(&host) {
            return Err("허용된 검색 주소만 열 수 있습니다".into());
        }
    }

    std::process::Command::new("open")
        .arg(value)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("주소를 열지 못했습니다: {error}"))
}

/// 화면에 짧은 안내를 띄운다 — 메인 창이 듣는다(js/app.js).
fn emit_toast(app: &AppHandle, message: &str) {
    let _ = app.emit("tip://toast", message.to_string());
}

/// 전역 단축키가 눌렸을 때 — 표에서 키를 찾아 그 기능을 바로 실행한다(v1.14.0).
fn shortcut_pressed(app: &AppHandle, shortcut: &tauri_plugin_global_shortcut::Shortcut) {
    let key = SHORTCUT_ACTIVE
        .lock()
        .ok()
        .and_then(|list| {
            list.iter()
                .find(|(_, value)| value == shortcut)
                .map(|(key, _)| key.clone())
        });
    let Some(key) = key else { return };

    match key.as_str() {
        SEARCH_KEY => toggle_search(app),
        "sticky:new" => {
            if let Err(error) = sticky::create_new(app, None, None) {
                emit_toast(app, &error);
            }
        }
        "screen-picker" => {
            if let Err(error) = capture::pick_screen_color(app.clone()) {
                emit_toast(app, &error);
            }
        }
        "drag-ocr" => match capture::capture_for_shortcut(app) {
            Ok(()) => {
                let _ = open_tool(app.clone(), "ocr-reader".to_string(), Some("글자 추출".to_string()));
            }
            Err(error) => emit_toast(app, &error),
        },
        other if other.starts_with("snap:") => {
            let preset = other.trim_start_matches("snap:").to_string();
            let handle = app.clone();
            // AX 호출은 메인 스레드로 넘어가 기다리므로, 단축키 스레드를 잡지 않게 따로 돌린다.
            std::thread::spawn(move || {
                if let Err(error) = capture::snap_blocking(&handle, &preset) {
                    let text = error.trim_start_matches("[permission]").trim().to_string();
                    emit_toast(&handle, &text);
                }
            });
        }
        id => {
            if let Err(error) = open_tool(app.clone(), id.to_string(), None) {
                emit_toast(app, &error);
            }
        }
    }
}

/// 임시 보관함 — 드롭한 파일 하나를 읽어 바이트로 돌려준다.
/// 프런트(notch.js)가 이 바이트로 File 을 만들어 보관함에 넣는다.
/// v1.12.4 — 아무 경로나 읽지 않는다. Finder 드롭으로 받은 경로만(한 번만) 읽는다.
/// 안전 장치: 드롭 허용 목록 · 일반 파일만 · 50MB 이하만 · 절대 경로만.
const SHELF_MAX_BYTES: u64 = 50 * 1024 * 1024;

/// 드롭 이벤트로 받은 경로를 허용 목록에 넣는다(최대 SHELF_ALLOWED_MAX개, 넘으면 비운다).
fn allow_shelf_paths(paths: &[PathBuf]) {
    let mut slot = match SHELF_ALLOWED.lock() {
        Ok(slot) => slot,
        Err(_) => return,
    };
    let set = slot.get_or_insert_with(HashSet::new);
    if set.len() + paths.len() > SHELF_ALLOWED_MAX {
        set.clear();
    }
    for path in paths {
        set.insert(path.clone());
    }
}

/// read_shelf_file 이 읽어도 되는 경로인지 — 목록에 있으면 꺼내 오고(1회성) 없으면 None.
fn take_shelf_path(path: &Path) -> bool {
    let mut slot = match SHELF_ALLOWED.lock() {
        Ok(slot) => slot,
        Err(_) => return false,
    };
    match slot.as_mut() {
        Some(set) => set.remove(path),
        None => false,
    }
}

#[tauri::command]
async fn read_shelf_file(path: String) -> Result<tauri::ipc::Response, String> {
    // 50MB 까지 읽을 수 있어 메인(UI) 스레드를 막지 않게 워커 스레드에서 읽는다.
    tauri::async_runtime::spawn_blocking(move || read_shelf_bytes(&path))
        .await
        .map_err(|error| format!("파일 읽기를 마치지 못했습니다: {error}"))?
}

fn read_shelf_bytes(path: &str) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err("절대 경로가 아닙니다".into());
    }
    if path.components().count() < 2 {
        return Err("파일 경로가 아닙니다".into());
    }
    // 드롭으로 받은 경로만 읽는다 — 목록에서 꺼내면 다시 읽을 수 없다.
    if !take_shelf_path(&path) {
        return Err("보관함에 끌어다 놓은 파일만 담을 수 있습니다".into());
    }

    let meta = fs::metadata(&path).map_err(|error| format!("파일을 찾지 못했습니다: {error}"))?;
    if !meta.is_file() {
        return Err("일반 파일이 아닙니다".into());
    }
    if meta.len() > SHELF_MAX_BYTES {
        return Err(format!(
            "50MB가 넘는 파일은 담을 수 없습니다({:.1}MB)",
            meta.len() as f64 / 1_048_576.0
        ));
    }

    let bytes = fs::read(&path).map_err(|error| format!("파일을 읽지 못했습니다: {error}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// 환경설정의 '노치 아일랜드 사용' 스위치 — 끄면 창을 숨긴다.
#[tauri::command]
fn set_notch_enabled(app: AppHandle, enabled: bool) {
    if enabled {
        show_notch(&app);
    } else {
        set_notch_open(&app, false);
        if let Some(win) = app.get_webview_window(NOTCH) {
            let _ = win.hide();
        }
    }
}

/* --------------------------- 빠른 실행 검색 창 (v1.12.0) --------------------------- */

fn search_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(win) = app.get_webview_window(SEARCH) {
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(app, SEARCH, WebviewUrl::App("search.html".into()))
        .title("TIP 빠른 실행 검색")
        .inner_size(SEARCH_W, SEARCH_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // v1.15.5 — 만들 때 앱을 활성화하면 다른 앱의 전체화면 Space 에서 벗어난다.
        // 초점은 show_search 가 make_key 로 직접 준다.
        .focused(false)
        .build()?;

    // 바깥을 누르면 닫는다.
    let handle = win.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            let _ = handle.hide();
        }
    });

    Ok(win)
}

fn show_search(app: &AppHandle) {
    let win = match search_window(app) {
        Ok(win) => win,
        Err(error) => {
            eprintln!("[TIP] 검색 창을 만들지 못했습니다: {error}");
            return;
        }
    };
    // v1.15.5 — 전체화면 앱(별도 Space) 위에서도 화면 전환 없이 뜨고 바로 입력되게 NSPanel 로 만든다.
    // Tauri 의 set_focus() 는 앱을 활성화해 다른 앱의 전체화면 Space 를 벗어나므로, 대신
    // orderFrontRegardless + makeKeyWindow 로 창만 앞에 세우고 키 입력을 받는다.
    let _ = notch::pin_search(&win);
    place_top_center(app, &win, SEARCH_W, SEARCH_H, 120.0);
    let _ = win.show();
    let _ = notch::order_front(&win);
    let _ = notch::make_key(&win);
    let _ = win.emit("tip://search-refresh", ());
}

fn toggle_search(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(SEARCH) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    show_search(app);
}

#[tauri::command]
fn open_search(app: AppHandle) {
    show_search(&app);
}

#[tauri::command]
fn hide_search(app: AppHandle) {
    if let Some(win) = app.get_webview_window(SEARCH) {
        let _ = win.hide();
    }
}

/* ------------------------- 전역 단축키 표 (v1.14.0) ------------------------- */
//
// v1.12.0 은 검색 단축키 하나만 등록했다. v1.14.0 부터는 검색 + 기능별(모듈·창 분할 등)
// 단축키를 한 표에 모아 함께 등록한다. 표를 고칠 때는 통째로 다시 등록한다(등록·해제는 macOS
// 메인 스레드에서 일어나고, 겹친 단축키는 등록에 실패하므로 그 실패를 화면에 그대로 돌려준다).

/// 표를 실제 단축키로 등록한다. 실패한 항목은 "키|accelerator|이유" 문자열로 돌려준다.
fn sync_shortcuts(app: &AppHandle) -> Vec<String> {
    let table: Vec<(String, String)> = SHORTCUT_TABLE.lock().map(|slot| slot.clone()).unwrap_or_default();
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let mut active: Vec<(String, tauri_plugin_global_shortcut::Shortcut)> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for (key, accelerator) in &table {
        let parsed = match accelerator.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            Ok(parsed) => parsed,
            Err(error) => {
                failures.push(format!("{key}|{accelerator}|{error}"));
                continue;
            }
        };
        match shortcuts.register(parsed) {
            Ok(()) => active.push((key.clone(), parsed)),
            Err(error) => failures.push(format!("{key}|{accelerator}|{error}")),
        }
    }
    if let Ok(mut slot) = SHORTCUT_ACTIVE.lock() {
        *slot = active;
    }
    failures
}

/// 검색 단축키를 표에 넣는다(이전 값은 지운다).
fn set_search_binding(accelerator: &str) {
    if let Ok(mut table) = SHORTCUT_TABLE.lock() {
        table.retain(|(key, _)| key != SEARCH_KEY);
        table.insert(0, (SEARCH_KEY.to_string(), accelerator.to_string()));
    }
    if let Ok(mut slot) = SEARCH_SHORTCUT.lock() {
        *slot = Some(accelerator.to_string());
    }
}

/// 지금 표에 적힌 기능 단축키 — 화면이 읽어 간다.
fn action_table() -> Vec<(String, String)> {
    SHORTCUT_TABLE
        .lock()
        .map(|table| {
            table
                .iter()
                .filter(|(key, _)| key != SEARCH_KEY)
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// 전역 단축키를 새 값으로 바꾼다. 실패하면 기본값으로 되돌린다.
fn apply_search_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let previous = SEARCH_SHORTCUT.lock().ok().and_then(|slot| slot.clone());
    set_search_binding(accelerator);
    let failures = sync_shortcuts(app);
    let mine = failures.iter().find(|line| line.starts_with(&format!("{SEARCH_KEY}|"))).cloned();
    if let Some(failure) = mine {
        let reason = failure.rsplit('|').next().unwrap_or("").to_string();
        // 되돌린다 — 처음 값(없으면 기본값)으로.
        let fallback = previous.unwrap_or_else(|| DEFAULT_SEARCH_SHORTCUT.to_string());
        set_search_binding(&fallback);
        let _ = sync_shortcuts(app);
        return Err(format!("{accelerator} 를 등록하지 못했습니다 ({reason}). {fallback} 로 두었습니다"));
    }
    Ok(())
}

#[tauri::command]
fn set_search_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    let value = accelerator.trim().to_string();
    if value.is_empty() {
        return Err("단축키가 비어 있습니다".into());
    }
    apply_search_shortcut(&app, &value)
}

#[tauri::command]
fn get_search_shortcut() -> String {
    SEARCH_SHORTCUT
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| DEFAULT_SEARCH_SHORTCUT.to_string())
}

/// 기능(모듈·창 분할) 단축키를 통째로 새로 등록한다. 표의 주인은 화면(localStorage)이다.
/// 돌려주는 값은 등록하지 못한 항목 목록 — 화면이 토스트로 알린다.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutFailure {
    key: String,
    accelerator: String,
    reason: String,
}

#[tauri::command]
fn set_module_shortcuts(app: AppHandle, items: Vec<(String, String)>) -> Vec<ShortcutFailure> {
    if let Ok(mut table) = SHORTCUT_TABLE.lock() {
        table.retain(|(key, _)| key == SEARCH_KEY);
        for (key, accelerator) in items {
            let key = key.trim().to_string();
            let accelerator = accelerator.trim().to_string();
            if key.is_empty() || accelerator.is_empty() || key == SEARCH_KEY {
                continue;
            }
            table.push((key, accelerator));
        }
    }
    sync_shortcuts(&app)
        .into_iter()
        .filter_map(|line| {
            let mut parts = line.split('|');
            let key = parts.next()?.to_string();
            let accelerator = parts.next().unwrap_or("").to_string();
            let reason = parts.next().unwrap_or("").to_string();
            if key == SEARCH_KEY {
                return None;
            }
            Some(ShortcutFailure { key, accelerator, reason })
        })
        .collect()
}

#[tauri::command]
fn get_module_shortcuts() -> Vec<(String, String)> {
    action_table()
}

/* ------------------------------- 메인 창 ------------------------------- */

/// 메인 창을 띄운다. `settings` 면 환경설정 시트를 바로 열게 알린다(퀵바의 ⚙ 버튼).
fn show_main(app: &AppHandle, module: Option<String>, settings: bool) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "메인 창을 찾을 수 없습니다".to_string())?;

    win.show().map_err(|error| error.to_string())?;
    let _ = win.unminimize();
    win.set_focus().map_err(|error| error.to_string())?;

    if settings {
        // 화면이 아직 안 떴으면 앱이 시작할 때 take_pending_settings 로 꺼낸다.
        *PENDING_SETTINGS.lock().unwrap() = true;
        let _ = win.emit("tip://open-settings", ());
    } else if let Some(id) = module {
        let _ = win.emit("tip://open-module", id);
    }
    if let Some(quickbar) = app.get_webview_window(QUICKBAR) {
        let _ = quickbar.hide();
    }
    Ok(())
}

/* ------------------------------ 타이머 알림 (v1.15.0) ------------------------------ */

/// 타이머가 끝났을 때 — 소리와 알림 센터 알림. 화면(js/timer-store.js)이 부른다.
/// osascript 의 display notification 은 별도 권한이 없어도 알림 센터에 뜨고(거부되면 조용히 실패),
/// 소리는 afplay 로 낸다 — 알림이 막혀도 소리는 남는다.
#[tauri::command]
fn timer_alert(app: AppHandle, title: Option<String>, body: Option<String>) {
    let _ = &app;
    let title = title.unwrap_or_else(|| "TIP 타이머".to_string());
    let body = body.unwrap_or_else(|| "타이머가 끝났습니다".to_string());

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("afplay")
            .arg("/System/Library/Sounds/Glass.aiff")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        // AppleScript 문자열 안의 따옴표·역슬래시만 이스케이프한다 — 셸을 거치지 않는다.
        let escape = |text: &str| text.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            escape(&body),
            escape(&title)
        );
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, title, body);
    }
}

/* -------------------------------- 명령 -------------------------------- */

/// 퀵바(Esc·바깥 클릭) 닫기 — 웹에서는 `hide_radial` 로 부른다.
#[tauri::command]
fn hide_radial(app: AppHandle) {
    if let Some(win) = app.get_webview_window(QUICKBAR) {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_main(app: AppHandle, module: Option<String>, settings: Option<bool>) -> Result<(), String> {
    show_main(&app, module, settings.unwrap_or(false))
}

/// 시작 직후 날아온 환경설정 요청을 화면이 한 번 가져간다.
#[tauri::command]
fn take_pending_settings() -> bool {
    let mut flag = PENDING_SETTINGS.lock().unwrap();
    let value = *flag;
    *flag = false;
    value
}

/// 상단 메뉴 막대 아이콘(트레이)을 보일지 정한다 — 끄면 열려 있던 반원 퀵바도 닫는다.
#[tauri::command]
fn set_tray_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("tip") {
        tray.set_visible(visible).map_err(|error| error.to_string())?;
    }
    if !visible {
        if let Some(win) = app.get_webview_window(QUICKBAR) {
            let _ = win.hide();
        }
    }
    Ok(())
}

/// 창에 Finder 파일을 끌어다 놓으면 그 경로를 허용 목록에 담고 화면에 알린다(v1.14.0).
/// 파일 일괄 이름 변경 같은 기능이 실제 디스크 경로를 받는 통로다.
fn attach_file_drop(win: &WebviewWindow) {
    let handle = win.clone();
    win.on_window_event(move |event| {
        let WindowEvent::DragDrop(drag) = event else { return };
        match drag {
            tauri::DragDropEvent::Enter { .. } => {
                let _ = handle.emit("tip://files-drag", true);
            }
            tauri::DragDropEvent::Drop { paths, .. } => {
                files::allow_paths(&paths);
                let list: Vec<String> = paths
                    .iter()
                    .map(|path| path.to_string_lossy().to_string())
                    .collect();
                let _ = handle.emit("tip://files-drop", list);
            }
            tauri::DragDropEvent::Leave => {
                let _ = handle.emit("tip://files-drag", false);
            }
            _ => {}
        }
    });
}

#[tauri::command]
fn open_tool(app: AppHandle, id: String, title: Option<String>) -> Result<(), String> {
    let label = title.unwrap_or_else(|| "TIP".to_string());

    if let Some(win) = app.get_webview_window(TOOL) {
        // 이미 떠 있으면 그 창에서 모듈만 바꾼다(app.js 가 듣는다).
        let _ = win.set_title(&label);
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("tip://open-module", id);
        if let Some(quickbar) = app.get_webview_window(QUICKBAR) {
            let _ = quickbar.hide();
        }
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        &app,
        TOOL,
        WebviewUrl::App(format!("index.html?module={id}").into()),
    )
    .title(label.clone())
    .inner_size(TOOL_W, TOOL_H)
    .min_inner_size(360.0, 520.0)
    .resizable(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;

    place_under_tray(&app, &win, TOOL_W, TOOL_H, 6.0);
    attach_file_drop(&win);
    let _ = win.show();
    let _ = win.set_focus();

    if let Some(quickbar) = app.get_webview_window(QUICKBAR) {
        let _ = quickbar.hide();
    }
    Ok(())
}

/// 배송 조회 — 네이버 배송조회 화면을 앱 안의 컴팩트 창(parcel)에서 바로 연다.
/// 이미 열려 있으면 그 창의 주소만 바꾼다. 네이버 검색 주소(https, PC·모바일)만 허용한다.
#[tauri::command]
fn open_parcel_webview(app: AppHandle, url: String, title: String) -> Result<(), String> {
    let target: tauri::Url = url.parse().map_err(|_| "주소를 읽지 못했습니다".to_string())?;
    if target.scheme() != "https" {
        return Err("https 주소만 열 수 있습니다".into());
    }
    let host = target.host_str().unwrap_or_default();
    if !(host == "search.naver.com" || host == "m.search.naver.com") {
        return Err("배송 조회는 네이버 검색 주소만 열 수 있습니다".into());
    }

    if let Some(win) = app.get_webview_window(PARCEL) {
        let _ = win.set_title(&title);
        win.navigate(target).map_err(|error| error.to_string())?;
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(&app, PARCEL, WebviewUrl::External(target))
        .title(title)
        .inner_size(PARCEL_W, PARCEL_H)
        .min_inner_size(360.0, 560.0)
        // v1.13.0 — 모바일 Safari 로 알려 네이버가 모바일 레이아웃(한 열)을 내려 주게 한다.
        .user_agent(PARCEL_USER_AGENT)
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/* ------------------------- 우편번호 창 (v1.15.1) ------------------------- */

/// 우편번호 창의 주소 조각(#d=base64(JSON))을 풀어 JSON 문자열로 돌려준다.
/// 받은 값은 그대로 화면에 보여 줄 뿐 파일·명령에 쓰지 않는다.
fn postcode_payload(url: &tauri::Url) -> Option<String> {
    if !url.path().ends_with(POSTCODE_DONE_PAGE) {
        return None;
    }
    let fragment = url.fragment()?;
    let encoded = fragment.strip_prefix("d=")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    if !value.is_object() {
        return None;
    }
    Some(text)
}

/// 한국 주소(다음 우편번호)를 별도 창에서 연다.
/// 이 창은 capabilities 에 없어 IPC 권한이 0 이고, 초기화 스크립트가 Tauri 전역까지 지운다.
/// 고른 주소는 postcode-done.html 로 이동할 때의 주소 조각에서 읽어 `tip://postcode-result` 로
/// 화면에 넘긴다(웹뷰 스크립트에 아무 권한도 주지 않는 길).
#[tauri::command]
fn open_postcode_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(POSTCODE) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let handle = app.clone();
    let win = WebviewWindowBuilder::new(&app, POSTCODE, WebviewUrl::App("postcode.html".into()))
        .title("우편번호 검색")
        .inner_size(POSTCODE_W, POSTCODE_H)
        .min_inner_size(420.0, 520.0)
        .resizable(true)
        .visible(false)
        // v1.15.2 — 저장소를 메인 앱과 완전히 분리한다. 카카오 우편번호 스크립트가 쓰는
        // 쿠키·localStorage 가 앱 창(같은 출처)의 저장소에 닿지 않게, 이 창은 비공개(incognito)
        // 데이터 저장소를 쓴다. 창을 닫으면 그 저장소도 함께 사라진다.
        .incognito(true)
        .initialization_script(POSTCODE_HIDE_TAURI)
        .on_navigation(move |url| {
            // 앱 안의 문서(우편번호·결과 안내)와 카카오 우편번호의 https 프레임만 지나가게 한다.
            let scheme = url.scheme();
            if scheme != "tauri" && scheme != "http" && scheme != "https" {
                return false;
            }
            if let Some(payload) = postcode_payload(url) {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|value| value.as_millis() as i64)
                    .unwrap_or(0);
                if let Ok(mut slot) = POSTCODE_RESULT.lock() {
                    *slot = Some((stamp, payload.clone()));
                }
                let _ = handle.emit("tip://postcode-result", payload);
            }
            true
        })
        .build()
        .map_err(|error| error.to_string())?;

    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// 우편번호 창을 닫는다 — 주소를 받았거나 사용자가 그만 두었을 때 화면이 부른다.
#[tauri::command]
fn close_postcode_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window(POSTCODE) {
        let _ = win.close();
    }
}

/// 마지막으로 고른 주소 한 건을 꺼낸다(한 번 꺼내면 비운다) — 이벤트를 놓쳤을 때의 보험.
#[tauri::command]
fn take_postcode_result() -> Option<String> {
    POSTCODE_RESULT.lock().ok()?.take().map(|(_, json)| json)
}

/* ------------------------------ 앱 업데이트 ------------------------------ */

/// 자동 업데이트로 설치할 파일 — check_app_update 가 찾은 값만 여기에 남는다(v1.12.4).
/// 설치 커맨드는 인자를 받지 않으므로, 화면(웹뷰 스크립트)이 임의의 주소로 다른 파일을
/// 설치하게 만들 수 없다.
#[derive(Clone)]
struct UpdateTarget {
    version: String,
    /// `.app.tar.gz` 내려받기 주소 — GitHub Releases 의 자산 주소만 받는다.
    archive: String,
    /// `SHA256SUMS.txt` 내려받기 주소 — 같은 릴리스의 자산만 받는다.
    sums: String,
}

/// TIP 의 공개 릴리스 자산 주소 꾸러미 — 이 접두사로 시작하는 주소만 내려받는다.
const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/appfle-io/tool-in-pack/releases/download/";

/// 내려받아도 되는 주소인지 — TIP 저장소의 릴리스 자산(HTTPS)만.
fn is_release_asset(url: &str) -> bool {
    url.starts_with(RELEASE_DOWNLOAD_PREFIX)
        && !url.contains(' ')
        && !url.contains("..")
        && !url.to_ascii_lowercase().contains("%2e%2e")
}

/// GitHub Releases 최신 정보 — 프런트가 그대로 쓴다(check_app_update).
#[derive(serde::Serialize)]
struct UpdateInfo {
    available: bool,
    current: String,
    version: Option<String>,
    url: Option<String>,
    notes: Option<String>,
    message: String,
}

/// 진행률 이벤트 payload — `tip://update-progress`.
#[derive(Clone, serde::Serialize)]
struct UpdateProgress {
    stage: String,
    percent: Option<f64>,
}

fn emit_progress(app: &AppHandle, stage: &str, percent: Option<f64>) {
    let _ = app.emit(
        "tip://update-progress",
        UpdateProgress { stage: stage.to_string(), percent },
    );
}

/// "v1.10.0" / "1.10.0-beta.1" → (1, 10, 0)
fn parse_version(text: &str) -> (u64, u64, u64) {
    let trimmed = text.trim();
    let core = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let core = core.split(['-', '+']).next().unwrap_or(core);
    let mut parts = core.split('.').map(|part| part.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// 현재 앱 버전(Cargo)과 GitHub 최신 릴리스 태그를 비교한다.
#[tauri::command]
async fn check_app_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::builder()
        .user_agent(concat!("TIP/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(RELEASES_LATEST)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("업데이트 서버에 연결하지 못했습니다: {error}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateInfo {
            available: false,
            current: current.clone(),
            version: None,
            url: None,
            notes: None,
            message: format!("공개된 새 버전이 없습니다. 현재 v{current} 입니다."),
        });
    }
    if !response.status().is_success() {
        return Err(format!("업데이트를 확인하지 못했습니다 (HTTP {})", response.status()));
    }

    let body: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    let tag = body.get("tag_name").and_then(|value| value.as_str()).unwrap_or("");
    let notes = body.get("body").and_then(|value| value.as_str()).unwrap_or("");
    let assets = body.get("assets").and_then(|value| value.as_array());

    // 자산 두 개를 찾는다 — 설치 파일(`.app.tar.gz`)과 해시 목록(`SHA256SUMS.txt`).
    let asset_url = |predicate: &dyn Fn(&str) -> bool| -> Option<String> {
        assets.and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name").and_then(|value| value.as_str()).unwrap_or("");
                if !predicate(name) {
                    return None;
                }
                asset
                    .get("browser_download_url")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            })
        })
    };
    let url = asset_url(&|name| name.ends_with(".app.tar.gz")).filter(|url| is_release_asset(url));
    let sums = asset_url(&|name| name == "SHA256SUMS.txt").filter(|url| is_release_asset(url));

    let latest = tag.trim().trim_start_matches('v').to_string();
    let newer = !latest.is_empty() && parse_version(&latest) > parse_version(&current);

    // 설치 파일과 해시 목록 주소가 "둘 다" TIP 릴리스 자산으로 확인될 때만 설치 대상을 남긴다.
    let target = match (&url, &sums) {
        (Some(archive), Some(sums)) if is_release_asset(archive) && is_release_asset(sums) => {
            Some(UpdateTarget {
                version: latest.clone(),
                archive: archive.clone(),
                sums: sums.clone(),
            })
        }
        _ => None,
    };
    let installable = newer && target.is_some();
    if let Ok(mut slot) = UPDATE_TARGET.lock() {
        *slot = if installable { target } else { None };
    }

    let message = if !newer {
        format!("최신 버전입니다 (v{current})")
    } else if url.is_none() {
        format!("새 버전 v{latest} 이 있지만 설치 파일(.app.tar.gz)이 없습니다. 릴리스 페이지에서 내려받아 주세요.")
    } else if !installable {
        format!("새 버전 v{latest} 이 있지만 해시 목록(SHA256SUMS.txt)이 없어 자동 설치할 수 없습니다. 릴리스 페이지에서 내려받아 주세요.")
    } else {
        format!("새 버전 v{latest} 이 있습니다.")
    };

    Ok(UpdateInfo {
        available: installable,
        current,
        version: if latest.is_empty() { None } else { Some(latest) },
        url,
        notes: if notes.trim().is_empty() { None } else { Some(notes.to_string()) },
        message,
    })
}

/// 압축 안에서 첫 `.app` 번들을 찾는다.
fn find_app_bundle(dir: &Path) -> Option<PathBuf> {
    let mut children = Vec::new();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().map(|ext| ext == "app").unwrap_or(false) {
            return Some(path);
        }
        if path.is_dir() {
            children.push(path);
        }
    }
    children.iter().find_map(|child| find_app_bundle(child))
}

/// 실행 중인 번들 경로 — `.../TIP.app/Contents/MacOS/tip` 에서 세 단계 위.
fn current_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let bundle = exe.parent()?.parent()?.parent()?;
    if bundle.extension().map(|ext| ext == "app").unwrap_or(false) {
        Some(bundle.to_path_buf())
    } else {
        None
    }
}

/// 외부 명령을 실행하고, 실패하면 stderr 를 담은 오류를 돌려준다(v1.12.0).
fn run_tool(program: &str, args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} 를 실행하지 못했습니다: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = stderr.trim();
    Err(if text.is_empty() {
        format!("{program} 가 실패했습니다 (종료 코드 {:?})", output.status.code())
    } else {
        format!("{program} 실패: {text}")
    })
}

/// 폴더를 복사한다 — ditto --norsrc 를 먼저, 안 되면 cp -pR. 두 오류를 함께 남긴다.
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    let from = from.to_string_lossy().to_string();
    let to = to.to_string_lossy().to_string();
    run_tool("ditto", &["--norsrc", &from, &to]).or_else(|first| {
        run_tool("cp", &["-pR", &from, &to]).map_err(|second| format!("{first} / {second}"))
    })
}

/// 같은 볼륨이면 rename(즉시·원자적), 다른 볼륨이면 복사.
fn move_or_copy(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)
}

/// 기존 번들을 백업하고 새 번들로 교체한다. 실패하면 이전 버전으로 되돌리고 stderr 를 함께 알린다.
fn replace_bundle(target: &Path, new_app: &Path, work: &Path) -> Result<(), String> {
    // 다운로드 폴더에서 바로 실행하면 App Translocation 경로라 번들을 바꿀 수 없다.
    if target.to_string_lossy().contains("AppTranslocation") {
        return Err("다운로드 폴더에서 바로 실행한 앱이라 스스로 업데이트할 수 없습니다. \
응용 프로그램(Applications) 폴더로 옮겨 실행한 뒤 다시 업데이트해 주세요."
            .into());
    }

    let backup = work.join("backup.app");
    let _ = fs::remove_dir_all(&backup);

    // 1) 기존 앱 백업 — rename 우선, 실패하면 복사.
    if fs::rename(target, &backup).is_err() {
        copy_dir(target, &backup).map_err(|error| {
            format!("기존 앱을 백업하지 못했습니다: {error}. /Applications 쓰기 권한을 확인하세요.")
        })?;
        let _ = fs::remove_dir_all(target);
    }

    // 2) 새 앱 설치 — rename(같은 볼륨) 우선, 아니면 ditto --norsrc → cp -pR.
    let install_error = match fs::rename(new_app, target) {
        Ok(()) => String::new(),
        Err(rename_error) => {
            let mut message = format!("rename 실패({rename_error})");
            if let Err(error) = copy_dir(new_app, target) {
                message = format!("{message} / {error}");
            }
            message
        }
    };

    let ok = target.join("Contents/Info.plist").exists();
    if !ok {
        let _ = fs::remove_dir_all(target);
        let rollback = if fs::rename(&backup, target).is_ok() {
            Ok(())
        } else {
            copy_dir(&backup, target)
        };
        let suffix = if rollback.is_ok() {
            "이전 버전으로 되돌렸습니다."
        } else {
            "이전 버전으로 되돌리지도 못했습니다. 릴리스 페이지에서 다시 내려받아 설치해 주세요."
        };
        return Err(format!(
            "새 앱을 설치하지 못했습니다{}
{suffix}",
            if install_error.is_empty() { String::new() } else { format!(" ({install_error})") }
        ));
    }

    // 3) 격리 표시 제거 — 다시 열 때 Gatekeeper 경고가 뜨지 않게. 실패해도 설치는 유지한다.
    let _ = std::process::Command::new("xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(target)
        .status();

    Ok(())
}

/// 파일의 SHA-256 — 설치 파일이 릴리스의 해시 목록과 같은지 대조한다(v1.12.4).
fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let mut file = fs::File::open(path).map_err(|error| format!("파일을 열지 못했습니다: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("파일을 읽지 못했습니다: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// `SHA256SUMS.txt` 본문에서 파일 이름에 해당하는 해시를 꺼낸다.
/// 줄 형식: `<64자리 hex>  <파일 이름>` (sha256sum 기본 출력).
fn hash_from_sums(sums: &str, file_name: &str) -> Option<String> {
    for line in sums.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let hash = parts.next().unwrap_or("");
        let name = parts.next().unwrap_or("").trim_start_matches('*');
        if name == file_name && hash.len() == 64 && hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
            return Some(hash.to_ascii_lowercase());
        }
    }
    None
}

/// `.app.tar.gz` 를 내려받아 설치하고 앱을 다시 시작한다(진행률은 이벤트로 보낸다).
/// v1.12.4 — 인자가 없다. check_app_update 가 확인한 TIP 릴리스 자산만 내려받고,
/// 같은 릴리스의 SHA256SUMS.txt 와 해시가 같을 때만 설치한다.
#[tauri::command]
async fn install_app_update_and_restart(app: AppHandle) -> Result<(), String> {
    let target = UPDATE_TARGET
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .ok_or_else(|| "먼저 '업데이트 확인'을 해 주세요 — 설치할 파일 주소가 없습니다".to_string())?;

    // 저장된 값이라도 한 번 더 본다 — 주소는 TIP 릴리스 자산만, 버전은 지금보다 높은 것만.
    if !is_release_asset(&target.archive) || !is_release_asset(&target.sums) {
        return Err("업데이트 주소가 TIP 릴리스가 아닙니다 — 설치를 중단했습니다".into());
    }
    if parse_version(&target.version) <= parse_version(env!("CARGO_PKG_VERSION")) {
        return Err(format!(
            "설치할 버전(v{})이 지금 버전(v{})보다 높지 않습니다 — 설치를 중단했습니다",
            target.version,
            env!("CARGO_PKG_VERSION")
        ));
    }

    emit_progress(&app, "download", Some(0.0));

    let work = std::env::temp_dir().join("tip-update");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;
    let archive_name = target
        .archive
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "설치 파일 이름을 읽지 못했습니다".to_string())?
        .to_string();
    if !archive_name.ends_with(".app.tar.gz") {
        return Err("설치 파일 형식이 아닙니다 — 설치를 중단했습니다".into());
    }
    let archive = work.join("TIP.app.tar.gz");

    let client = reqwest::Client::builder()
        .user_agent(concat!("TIP/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(target.archive.as_str())
        .send()
        .await
        .map_err(|error| format!("내려받지 못했습니다: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("내려받기 실패 (HTTP {})", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file =
        fs::File::create(&archive).map_err(|error| format!("파일을 만들지 못했습니다: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("내려받는 중 끊겼습니다: {error}"))?;
        file.write_all(&chunk)
            .map_err(|error| format!("저장하지 못했습니다: {error}"))?;
        received += chunk.len() as u64;
        if total > 0 {
            emit_progress(&app, "download", Some(received as f64 / total as f64 * 100.0));
        }
    }
    drop(file);

    // 해시 대조 — 목록을 받지 못하거나 값이 다르면 압축을 풀지도 않고 멈춘다.
    emit_progress(&app, "verify", Some(100.0));
    let sums_text = client
        .get(target.sums.as_str())
        .send()
        .await
        .map_err(|error| format!("해시 목록을 내려받지 못했습니다: {error}"))?
        .error_for_status()
        .map_err(|error| format!("해시 목록을 내려받지 못했습니다: {error}"))?
        .text()
        .await
        .map_err(|error| format!("해시 목록을 읽지 못했습니다: {error}"))?;
    let expected = hash_from_sums(&sums_text, &archive_name).ok_or_else(|| {
        format!("SHA256SUMS.txt 에 {archive_name} 의 해시가 없습니다 — 설치를 중단했습니다")
    })?;
    let actual = sha256_file(&archive)?;
    if actual != expected {
        let _ = fs::remove_dir_all(&work);
        return Err(format!(
            "내려받은 파일의 해시가 릴리스와 다릅니다 — 설치를 중단했습니다\n(기대 {expected} / 실제 {actual})"
        ));
    }

    emit_progress(&app, "extract", Some(100.0));
    let unpacked = work.join("unpacked");
    fs::create_dir_all(&unpacked).map_err(|error| error.to_string())?;
    let extracted = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&unpacked)
        .status()
        .map_err(|error| format!("압축을 풀지 못했습니다: {error}"))?;
    if !extracted.success() {
        return Err("압축을 풀지 못했습니다".into());
    }

    let new_app = find_app_bundle(&unpacked)
        .ok_or_else(|| "내려받은 파일 안에 앱(.app)이 없습니다".to_string())?;

    emit_progress(&app, "install", Some(100.0));
    let target_bundle = current_bundle_path()
        .ok_or_else(|| "앱 번들 위치를 찾지 못했습니다(개발 빌드에서는 자동 설치를 쓸 수 없습니다)".to_string())?;
    replace_bundle(&target_bundle, &new_app, &work)?;

    emit_progress(&app, "restart", Some(100.0));
    std::process::Command::new("open")
        .arg("-n")
        .arg(&target_bundle)
        .spawn()
        .map_err(|error| format!("앱을 다시 시작하지 못했습니다: {error}"))?;

    std::thread::sleep(std::time::Duration::from_millis(400));
    app.exit(0);
    Ok(())
}

/* --------------------------------- 실행 --------------------------------- */

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // v1.14.0 — 검색뿐 아니라 기능별 단축키도 이 표에서 찾아 실행한다.
                        shortcut_pressed(app, shortcut);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            hide_radial,
            open_main,
            open_tool,
            open_parcel_webview,
            open_postcode_window,
            close_postcode_window,
            take_postcode_result,
            take_pending_settings,
            set_tray_visible,
            check_app_update,
            install_app_update_and_restart,
            clip::clipboard_list,
            clip::set_clipboard_exclude_secret,
            clip::clipboard_copy,
            clip::clipboard_pin,
            clip::clipboard_delete,
            clip::clipboard_clear,
            clip::clipboard_add_text,
            clip::clipboard_add_image,
            clip::clipboard_restore,
            media::media_state,
            media::media_control,
            media::calendar_today,
            media::calendar_list,
            media::calendar_events,
            media::calendar_create,
            notch_expand,
            notch_collapse,
            notch_resize,
            set_notch_pill,
            notch_metrics,
            timer_alert,
            notch_focus,
            set_notch_hover,
            notch_hover_hold,
            open_privacy_settings,
            read_shelf_file,
            set_notch_enabled,
            open_search,
            hide_search,
            set_search_shortcut,
            get_search_shortcut,
            set_module_shortcuts,
            get_module_shortcuts,
            copy_text,
            open_external_url,
            apps::list_installed_apps,
            apps::open_local_app,
            apps::search_local_files,
            apps::open_local_file,
            capture::pick_screen_color,
            capture::capture_region,
            capture::read_capture,
            capture::take_pending_shot,
            capture::snap_active_window,
            capture::accessibility_trusted,
            system::run_system_command,
            system::set_system_commands,
            files::rename_files,
            autostart::get_autostart,
            autostart::set_autostart,
            sticky::sticky_list,
            sticky::sticky_get,
            sticky::sticky_create,
            sticky::sticky_update,
            sticky::sticky_set_pin,
            sticky::sticky_close,
            sticky::sticky_delete,
            sticky::sticky_open,
            sticky::sticky_restore,
            dialogs::save_backup_file,
            dialogs::open_backup_file,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // v1.12.0 — 클립보드 히스토리 감시(기기 안에서만)와 기본 전역 단축키.
            clip::start(handle.clone());
            // v1.14.0 — 검색 단축키는 표의 기본값으로 두고, 기능 단축키는 화면이 켜지면서 밀어 준다.
            set_search_binding(DEFAULT_SEARCH_SHORTCUT);
            let _ = sync_shortcuts(&handle);

            // 열려 있던 스티커 메모를 그 자리·그 크기로 되살린다.
            sticky::restore(&handle);

            // 메인 창 X — 앱을 끄지 않고 숨긴다. 메뉴 막대·Dock 에서 다시 연다.
            if let Some(main) = app.get_webview_window("main") {
                // v1.14.0 — 메인 창으로도 파일을 끌어다 놓을 수 있게 한다(파일 이름 변경 등).
                attach_file_drop(&main);
                let main_handle = main.clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = main_handle.hide();
                    }
                });
            }

            // 메뉴 막대 아이콘 — v1.10.0 부터 PWA 앱 아이콘과 같은 색(tray-icon.png, 44×44).
            // icon_as_template(false) 라야 macOS 가 흑백 실루엣으로 바꾸지 않는다.
            let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

            let open_main_item =
                MenuItem::with_id(&handle, "open_main", "TIP 열기", true, None::<&str>)?;
            let open_quickbar_item =
                MenuItem::with_id(&handle, "open_quickbar", "메뉴 막대 퀵바", true, None::<&str>)?;
            let open_notch_item =
                MenuItem::with_id(&handle, "open_notch", "노치 아일랜드", true, None::<&str>)?;
            let open_search_item =
                MenuItem::with_id(&handle, "open_search_menu", "빠른 실행 검색…", true, None::<&str>)?;
            // v1.14.0 — 바탕화면 스티커와 화면 스포이드를 메뉴 막대에서도 바로.
            let new_sticky_item =
                MenuItem::with_id(&handle, "new_sticky", "새 스티커 메모", true, None::<&str>)?;
            let pick_color_item =
                MenuItem::with_id(&handle, "pick_color", "화면에서 색 고르기", true, None::<&str>)?;
            let open_settings_item =
                MenuItem::with_id(&handle, "open_settings", "환경설정…", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(&handle, "quit", "TIP 종료", true, None::<&str>)?;
            let menu = MenuBuilder::new(&handle)
                .item(&open_main_item)
                .item(&open_quickbar_item)
                .item(&open_notch_item)
                .item(&open_search_item)
                .separator()
                .item(&new_sticky_item)
                .item(&pick_color_item)
                .separator()
                .item(&open_settings_item)
                .separator()
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::with_id("tip")
                .icon(icon)
                .icon_as_template(false)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("TIP · TOOL-IN-PACK")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        rect,
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        // rect 는 dpi 의 Position/Size 열거형이라 물리 픽셀로 직접 바꿔 저장한다.
                        let scale = tray
                            .app_handle()
                            .get_webview_window("main")
                            .and_then(|win| win.scale_factor().ok())
                            .unwrap_or(2.0);
                        let (px, py) = match rect.position {
                            Position::Physical(pos) => (pos.x as f64, pos.y as f64),
                            Position::Logical(pos) => (pos.x * scale, pos.y * scale),
                        };
                        let (pw, ph) = match rect.size {
                            tauri::Size::Physical(size) => (size.width as f64, size.height as f64),
                            tauri::Size::Logical(size) => (size.width * scale, size.height * scale),
                        };
                        {
                            let mut slot = TRAY_RECT.lock().unwrap();
                            *slot = Some((px, py, pw, ph));
                        }
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            toggle_quickbar(tray.app_handle());
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open_main" => {
                        let _ = show_main(app, None, false);
                    }
                    "open_quickbar" => show_quickbar(app),
                    "open_notch" => show_notch(app),
                    "open_search_menu" => show_search(app),
                    "new_sticky" => {
                        if let Err(error) = sticky::create_new(app, None, None) {
                            emit_toast(app, &error);
                        }
                    }
                    "pick_color" => {
                        if let Err(error) = capture::pick_screen_color(app.clone()) {
                            emit_toast(app, &error);
                        }
                    }
                    "open_settings" => {
                        let _ = show_main(app, None, true);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("TIP 앱을 시작하지 못했습니다")
        .run(|app, event| {
            // Dock 아이콘 클릭 등으로 다시 열릴 때 메인 창을 보여 준다.
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = show_main(app, None, false);
            }
        });
}
