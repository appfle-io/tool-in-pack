// TIP (TOOL-IN-PACK) macOS 앱 — 메뉴 막대 반원 퀵바 + 전체 창.
//
// - 전체 창(main): 웹(PWA)과 같은 화면. 창을 닫아도 앱은 살아 있고 메뉴 막대에서 다시 연다.
// - 메뉴 막대 아이콘(트레이) 좌클릭: 아이콘 아래에 반원 퀵바(quickbar)를 띄우고, 다시 누르면 닫는다.
// - 퀵바의 ⚙ 버튼은 메인 창을 띄우고 `tip://open-settings` 로 설정 시트를 연다(창이 이미 떠 있어도).
// - 퀵바에서 모듈을 고르면 420×680 컴팩트 창(tool)이 그 모듈 화면으로 열린다.
// - 모든 창은 같은 origin 이라 localStorage(모듈 켜기/끄기, 순서, 테마)를 그대로 공유한다.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use futures_util::StreamExt;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod clip;
mod media;
mod notch;

const QUICKBAR: &str = "quickbar";
const TOOL: &str = "tool";
const NOTCH: &str = "notch";
const SEARCH: &str = "search";
const PARCEL: &str = "parcel";

// 퀵바 창 — 납작한 반타원 판(가로 284·세로 176)이 위쪽 일직선으로 메뉴 막대에 붙고,
// 아래로 176px 내려간다. 창 높이 206 = 판 176 + 아래 그림자 여백 30.
const QUICKBAR_W: f64 = 580.0;
const QUICKBAR_H: f64 = 206.0;
const TOOL_W: f64 = 420.0;
const TOOL_H: f64 = 680.0;

// 노치 아일랜드 — 화면 최상단 중앙(y=0, 노치 자리). 접힌 알약과 펼친 패널의 크기만 다르다.
// v1.12.2 — 알약 높이를 46 → 28 로 줄여 화면 최상단에 밀착한다(노치 화면에서는 노치 높이).
const NOTCH_PILL_W: f64 = 240.0;
const NOTCH_PILL_H: f64 = 28.0;
const NOTCH_OPEN_W: f64 = 452.0;
const NOTCH_OPEN_H: f64 = 600.0;

// 전역 빠른 실행 검색 — 화면 가운데 위쪽의 작은 팔레트.
const SEARCH_W: f64 = 640.0;
const SEARCH_H: f64 = 440.0;

// 배송 조회 — 네이버 배송조회를 앱 안에서 여는 컴팩트 창(일반 창이라 사용자가 닫·크기 조절).
const PARCEL_W: f64 = 480.0;
const PARCEL_H: f64 = 720.0;
const DEFAULT_SEARCH_SHORTCUT: &str = "Alt+Space";

const RELEASES_LATEST: &str = "https://api.github.com/repos/appfle-io/tool-in-pack/releases/latest";

/// 마지막으로 누른 메뉴 막대 아이콘의 사각형(물리 픽셀: x, y, w, h).
static TRAY_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

/// 메인 창의 화면이 아직 준비되기 전에 환경설정 요청이 왔는지 — 앱이 켜질 때 한 번 꺼낸다.
static PENDING_SETTINGS: Mutex<bool> = Mutex::new(false);

/// 노치 아일랜드가 펼쳐져 있는지(창 크기 상태).
static NOTCH_OPEN: Mutex<bool> = Mutex::new(false);

/// 지금 등록된 전역 빠른 실행 단축키.
static SEARCH_SHORTCUT: Mutex<Option<String>> = Mutex::new(None);

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
        .focused(true);

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

    place_under_tray(app, &win, QUICKBAR_W, QUICKBAR_H, 2.0);
    let _ = win.show();
    let _ = win.set_focus();
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
    let (pill_w, pill_h) = notch::pill_size(NOTCH_PILL_W, NOTCH_PILL_H);

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

/// 접힘/펼침 — 창 크기를 바꾸고 다시 화면 최상단 가운데에 붙인다.
fn set_notch_open(app: &AppHandle, open: bool) {
    let Some(win) = app.get_webview_window(NOTCH) else { return };
    let (width, height) = if open {
        (NOTCH_OPEN_W, NOTCH_OPEN_H)
    } else {
        notch::pill_size(NOTCH_PILL_W, NOTCH_PILL_H)
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
        (NOTCH_OPEN_W, NOTCH_OPEN_H)
    } else {
        notch::pill_size(NOTCH_PILL_W, NOTCH_PILL_H)
    };
    place_notch(app, &win, width, height, open);
    let _ = win.show();
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

/// 노치 창을 key window 로 만든다 — 빠른 메모(textarea)를 클릭했을 때 바로 타이핑되게.
/// borderless NSPanel 은 스스로 key window 가 되지 못해 입력이 들어가지 않았다(v1.12.2).
#[tauri::command]
fn notch_focus(app: AppHandle) {
    let Some(win) = app.get_webview_window(NOTCH) else { return };
    let _ = win.set_focus();
    if !notch::make_key(&win) {
        eprintln!("[TIP] 노치 창을 키 창으로 만들지 못했습니다");
    }
}

/// 임시 보관함 — 드롭한 파일 하나를 읽어 바이트로 돌려준다.
/// 프런트(notch.js)가 이 바이트로 File 을 만들어 보관함에 넣는다.
/// 안전 장치: 일반 파일만 · 50MB 이하만 · 읽을 수 있는 절대 경로만.
const SHELF_MAX_BYTES: u64 = 50 * 1024 * 1024;

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
        .focused(true)
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
    place_top_center(app, &win, SEARCH_W, SEARCH_H, 120.0);
    let _ = win.show();
    let _ = win.set_focus();
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

/// 전역 단축키를 새 값으로 바꾼다. 실패하면 기본값으로 되돌린다.
fn apply_search_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    match shortcuts.register(accelerator) {
        Ok(()) => {
            *SEARCH_SHORTCUT.lock().unwrap() = Some(accelerator.to_string());
            Ok(())
        }
        Err(error) => {
            let fallback = shortcuts.register(DEFAULT_SEARCH_SHORTCUT);
            *SEARCH_SHORTCUT.lock().unwrap() = Some(DEFAULT_SEARCH_SHORTCUT.to_string());
            if fallback.is_err() {
                return Err(format!("단축키를 등록하지 못했습니다: {error}"));
            }
            Err(format!("{accelerator} 를 등록하지 못해 기본값으로 되돌렸습니다"))
        }
    }
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
    let _ = win.show();
    let _ = win.set_focus();

    if let Some(quickbar) = app.get_webview_window(QUICKBAR) {
        let _ = quickbar.hide();
    }
    Ok(())
}

/// 배송 조회 — 네이버 배송조회 화면을 앱 안의 컴팩트 창(parcel)에서 바로 연다.
/// 이미 열려 있으면 그 창의 주소만 바꾼다. 네이버 주소(https://search.naver.com/…)만 허용한다.
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
        .min_inner_size(360.0, 480.0)
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/* --------------------------------- 실행 --------------------------------- */

/* ------------------------------ 앱 업데이트 ------------------------------ */

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
    let url = body
        .get("assets")
        .and_then(|value| value.as_array())
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name").and_then(|value| value.as_str()).unwrap_or("");
                if name.ends_with(".app.tar.gz") {
                    asset
                        .get("browser_download_url")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                } else {
                    None
                }
            })
        });

    let latest = tag.trim().trim_start_matches('v').to_string();
    let newer = !latest.is_empty() && parse_version(&latest) > parse_version(&current);

    let message = if !newer {
        format!("최신 버전입니다 (v{current})")
    } else if url.is_none() {
        format!("새 버전 v{latest} 이 있지만 설치 파일(.app.tar.gz)이 없습니다. 릴리스 페이지에서 내려받아 주세요.")
    } else {
        format!("새 버전 v{latest} 이 있습니다.")
    };

    Ok(UpdateInfo {
        available: newer && url.is_some(),
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

/// `.app.tar.gz` 를 내려받아 설치하고 앱을 다시 시작한다(진행률은 이벤트로 보낸다).
#[tauri::command]
async fn install_app_update_and_restart(app: AppHandle, url: String) -> Result<(), String> {
    emit_progress(&app, "download", Some(0.0));

    let work = std::env::temp_dir().join("tip-update");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|error| format!("임시 폴더를 만들지 못했습니다: {error}"))?;
    let archive = work.join("TIP.app.tar.gz");

    let client = reqwest::Client::builder()
        .user_agent(concat!("TIP/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(url.as_str())
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
    let target = current_bundle_path()
        .ok_or_else(|| "앱 번들 위치를 찾지 못했습니다(개발 빌드에서는 자동 설치를 쓸 수 없습니다)".to_string())?;
    replace_bundle(&target, &new_app, &work)?;

    emit_progress(&app, "restart", Some(100.0));
    std::process::Command::new("open")
        .arg("-n")
        .arg(&target)
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
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_search(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            hide_radial,
            open_main,
            open_tool,
            open_parcel_webview,
            take_pending_settings,
            set_tray_visible,
            check_app_update,
            install_app_update_and_restart,
            clip::clipboard_list,
            clip::clipboard_copy,
            clip::clipboard_pin,
            clip::clipboard_delete,
            clip::clipboard_clear,
            clip::clipboard_add_text,
            clip::clipboard_add_image,
            media::media_state,
            media::media_control,
            media::calendar_today,
            notch_expand,
            notch_collapse,
            notch_focus,
            read_shelf_file,
            set_notch_enabled,
            open_search,
            hide_search,
            set_search_shortcut,
            get_search_shortcut
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // v1.12.0 — 클립보드 히스토리 감시(기기 안에서만)와 기본 전역 단축키.
            clip::start(handle.clone());
            let _ = apply_search_shortcut(&handle, DEFAULT_SEARCH_SHORTCUT);

            // 메인 창 X — 앱을 끄지 않고 숨긴다. 메뉴 막대·Dock 에서 다시 연다.
            if let Some(main) = app.get_webview_window("main") {
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
            let open_settings_item =
                MenuItem::with_id(&handle, "open_settings", "환경설정…", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(&handle, "quit", "TIP 종료", true, None::<&str>)?;
            let menu = MenuBuilder::new(&handle)
                .item(&open_main_item)
                .item(&open_quickbar_item)
                .item(&open_notch_item)
                .item(&open_search_item)
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
