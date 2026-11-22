// TIP (TOOL-IN-PACK) macOS 앱 — 메뉴 막대 반원 퀵바 + 전체 창.
//
// - 전체 창(main): 웹(PWA)과 같은 화면. 창을 닫아도 앱은 살아 있고 메뉴 막대에서 다시 연다.
// - 메뉴 막대 아이콘(트레이) 좌클릭: 아이콘 아래에 반원 퀵바(quickbar)를 띄우고, 다시 누르면 닫는다.
// - 퀵바에서 모듈을 고르면 420×680 컴팩트 창(tool)이 그 모듈 화면으로 열린다.
// - 모든 창은 같은 origin 이라 localStorage(모듈 켜기/끄기, 순서, 테마)를 그대로 공유한다.

use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalPosition, Manager, Position, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const QUICKBAR: &str = "quickbar";
const TOOL: &str = "tool";

const QUICKBAR_W: f64 = 580.0;
const QUICKBAR_H: f64 = 260.0;
const TOOL_W: f64 = 420.0;
const TOOL_H: f64 = 680.0;

/// 마지막으로 누른 메뉴 막대 아이콘의 사각형(물리 픽셀: x, y, w, h).
static TRAY_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

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
fn place_under_tray(app: &AppHandle, win: &WebviewWindow, width: f64, height: f64) {
    let Some((anchor_x, anchor_y)) = tray_anchor(app) else {
        return;
    };

    let mut x = anchor_x - width / 2.0;
    let mut y = anchor_y + 6.0;

    if let Ok(Some(monitor)) = win.current_monitor() {
        let scale = monitor.scale_factor();
        let screen = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        let min_x = origin.x + 8.0;
        let max_x = origin.x + screen.width - width - 8.0;
        let max_y = origin.y + screen.height - height - 8.0;

        x = x.clamp(min_x, max_x.max(min_x));
        y = y.min(max_y).max(origin.y + 6.0);
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

    place_under_tray(app, &win, QUICKBAR_W, QUICKBAR_H);
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

/* ------------------------------- 메인 창 ------------------------------- */

fn show_main(app: &AppHandle, module: Option<String>) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "메인 창을 찾을 수 없습니다".to_string())?;

    win.show().map_err(|error| error.to_string())?;
    let _ = win.unminimize();
    win.set_focus().map_err(|error| error.to_string())?;

    if let Some(id) = module {
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
fn open_main(app: AppHandle, module: Option<String>) -> Result<(), String> {
    show_main(&app, module)
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

    place_under_tray(&app, &win, TOOL_W, TOOL_H);
    let _ = win.show();
    let _ = win.set_focus();

    if let Some(quickbar) = app.get_webview_window(QUICKBAR) {
        let _ = quickbar.hide();
    }
    Ok(())
}

/* --------------------------------- 실행 --------------------------------- */

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![hide_radial, open_main, open_tool])
        .setup(|app| {
            let handle = app.handle().clone();

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

            // 메뉴 막대 아이콘 — 흑백 템플릿이라 라이트/다크 메뉴 막대에 맞춰 색이 바뀐다.
            let icon = Image::from_bytes(include_bytes!("../icons/trayTemplate.png"))?;

            let open_main_item =
                MenuItem::with_id(&handle, "open_main", "TIP 열기", true, None::<&str>)?;
            let open_quickbar_item =
                MenuItem::with_id(&handle, "open_quickbar", "메뉴 막대 퀵바", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(&handle, "quit", "TIP 종료", true, None::<&str>)?;
            let menu = MenuBuilder::new(&handle)
                .item(&open_main_item)
                .item(&open_quickbar_item)
                .separator()
                .item(&quit_item)
                .build()?;

            TrayIconBuilder::with_id("tip")
                .icon(icon)
                .icon_as_template(true)
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
                        let _ = show_main(app, None);
                    }
                    "open_quickbar" => show_quickbar(app),
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
                let _ = show_main(app, None);
            }
        });
}
