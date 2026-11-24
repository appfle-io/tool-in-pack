// TIP 독립 스티커 메모 — v1.14.0 (Mac 앱 전용)
//
// Windows 스티커 노트처럼 바탕화면에 하나씩 떠 있는 작은 창.
//  · 스티커마다 창 라벨 `sticky-{id}` — 여러 개를 동시에 띄울 수 있다.
//  · 테두리 없는 창(decorations=false) + 위쪽 드래그 바(js/sticky.js 의 data-tauri-drag-region).
//  · 내용·위치·크기·색·핀 상태는 앱 데이터 폴더의 sticky-notes.json 하나에만 저장한다.
//  · 앱을 다시 켜면 열려 있던 스티커(open=true)를 그 자리·크기 그대로 되살린다.
//
// 프런트(js/sticky.js)는 커맨드로만 값을 바꾸고, 창 이동·크기는 이 파일이 창 이벤트로 직접 받아 적는다
// (JS 가 창 API 를 몰라도 되게 — 화면 밖으로 나간 스티커도 위치가 어긋나지 않는다).

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// 새 스티커 기본 크기(논리 pt) — 작은 메모 하나가 들어가는 크기.
const STICKY_W: f64 = 300.0;
const STICKY_H: f64 = 300.0;
const STICKY_MIN_W: f64 = 180.0;
const STICKY_MIN_H: f64 = 140.0;
/// 스티커를 겹치지 않게 놓을 때 한 칸씩 밀어 주는 거리.
const STAGGER: f64 = 26.0;
/// 저장 파일 이름 — 앱 데이터 폴더(app_data_dir) 안.
const STORE: &str = "sticky-notes.json";

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sticky {
    pub id: String,
    #[serde(default)]
    pub text: String,
    /// 색 이름 — 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'dark' (css/sticky.css 가 칠한다).
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_w")]
    pub w: f64,
    #[serde(default = "default_h")]
    pub h: f64,
    /// 항상 위(핀).
    #[serde(default)]
    pub pinned: bool,
    /// 창이 떠 있는 상태 — 앱을 다시 켤 때 이 값이 true 인 스티커만 되살린다.
    #[serde(default = "default_open")]
    pub open: bool,
    #[serde(default)]
    pub created: i64,
    #[serde(default)]
    pub updated: i64,
}

fn default_color() -> String {
    "green".to_string()
}
fn default_w() -> f64 {
    STICKY_W
}
fn default_h() -> f64 {
    STICKY_H
}
fn default_open() -> bool {
    true
}

static NOTES: Mutex<Option<Vec<Sticky>>> = Mutex::new(None);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    // 시각 + 프로세스 id 로 짧은 식별자 — 창 라벨(sticky-xxxxxxxx)에 쓴다.
    format!("{:08x}", (now_ms() as u64).wrapping_mul(2654435761) & 0xffff_ffff)
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join(STORE))
}

/// 디스크에서 한 번만 읽어 메모리에 둔다.
fn with_notes<T>(app: &AppHandle, work: impl FnOnce(&mut Vec<Sticky>) -> T) -> T {
    let mut slot = NOTES.lock().unwrap();
    if slot.is_none() {
        let loaded = store_path(app)
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Vec<Sticky>>(&text).ok())
            .unwrap_or_default();
        *slot = Some(loaded);
    }
    work(slot.as_mut().unwrap())
}

fn save(app: &AppHandle) {
    let Some(path) = store_path(app) else { return };
    let snapshot = NOTES.lock().unwrap().clone().unwrap_or_default();
    if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
        let _ = fs::write(path, text);
    }
}

fn window_label(id: &str) -> String {
    format!("sticky-{id}")
}

/// 창의 현재 위치·크기(논리 좌표) — 이동·리사이즈 이벤트 뒤에 읽어 적는다.
fn geometry(win: &WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let scale = win.scale_factor().ok()?;
    let position = win.outer_position().ok()?;
    let size = win.inner_size().ok()?;
    Some((
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

/// 창을 새로 띄운다. 이미 있으면 그 창을 앞으로 꺼낸다.
pub fn create_window(app: &AppHandle, note: &Sticky) -> Result<(), String> {
    let label = window_label(&note.id);
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("sticky.html?id={}", note.id).into()),
    )
    .title("TIP 스티커")
    .inner_size(note.w.max(STICKY_MIN_W), note.h.max(STICKY_MIN_H))
    .min_inner_size(STICKY_MIN_W, STICKY_MIN_H)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(note.pinned)
    .skip_taskbar(true)
    .position(note.x, note.y)
    .visible(false)
    .focused(true)
    .build()
    .map_err(|error| format!("스티커 창을 만들지 못했습니다: {error}"))?;

    // 위치·크기는 이 창이 직접 받아 적는다 — 프런트는 내용만 다룬다.
    let id = note.id.clone();
    let handle = app.clone();
    let watch = win.clone();
    win.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            let Some((x, y, w, h)) = geometry(&watch) else { return };
            with_notes(&handle, |notes| {
                if let Some(note) = notes.iter_mut().find(|entry| entry.id == id) {
                    note.x = x;
                    note.y = y;
                    note.w = w;
                    note.h = h;
                }
            });
            save(&handle);
        }
        tauri::WindowEvent::CloseRequested { .. } => {
            // 닫아도 내용은 남긴다 — 다음에 목록에서 다시 열 수 있고, 앱 재실행 때는 조용히 있다.
            with_notes(&handle, |notes| {
                if let Some(note) = notes.iter_mut().find(|entry| entry.id == id) {
                    note.open = false;
                }
            });
            save(&handle);
            let _ = handle.emit("tip://stickies-changed", ());
        }
        _ => {}
    });

    win.show().map_err(|error| error.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

/// 앱이 켜질 때 — 열려 있던 스티커를 되살린다.
pub fn restore(app: &AppHandle) {
    let open: Vec<Sticky> = with_notes(app, |notes| {
        notes.iter().filter(|note| note.open).cloned().collect()
    });
    for note in open {
        if let Err(error) = create_window(app, &note) {
            eprintln!("[TIP] 스티커를 되살리지 못했습니다: {error}");
        }
    }
}

/// 새 스티커 — 화면 가운데에서 조금씩 밀어 놓는다. `from` 은 이미 놓인 개수(겹침 방지).
fn default_position(app: &AppHandle, count: usize) -> (f64, f64) {
    let monitor = app.primary_monitor().ok().flatten();
    let Some(monitor) = monitor else {
        return (160.0, 160.0);
    };
    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let origin = monitor.position().to_logical::<f64>(scale);
    let step = (count % 6) as f64 * STAGGER;
    let x = origin.x + (screen.width - STICKY_W) / 2.0 - 120.0 + step;
    let y = origin.y + (screen.height - STICKY_H) / 2.0 - 60.0 + step;
    (x, y)
}

/// 새 스티커를 만들고 창을 띄운다 — 홈 모듈·메뉴 막대·전역 단축키가 함께 쓴다.
pub fn create_new(app: &AppHandle, color: Option<String>, at: Option<(f64, f64)>) -> Result<String, String> {
    let color = color
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_color);

    let existing = with_notes(app, |notes| notes.len());
    let (x, y) = at.unwrap_or_else(|| default_position(app, existing));

    let note = Sticky {
        id: new_id(),
        text: String::new(),
        color,
        x,
        y,
        w: STICKY_W,
        h: STICKY_H,
        pinned: false,
        open: true,
        created: now_ms(),
        updated: now_ms(),
    };
    let id = note.id.clone();
    with_notes(app, |notes| notes.push(note.clone()));
    save(app);
    create_window(app, &note)?;
    let _ = app.emit("tip://stickies-changed", ());
    Ok(id)
}

/* -------------------------------- 커맨드 -------------------------------- */

#[tauri::command]
pub fn sticky_list(app: AppHandle) -> Vec<Sticky> {
    with_notes(&app, |notes| {
        let mut list = notes.clone();
        list.sort_by_key(|note| note.created);
        list
    })
}

#[tauri::command]
pub fn sticky_get(app: AppHandle, id: String) -> Option<Sticky> {
    with_notes(&app, |notes| notes.iter().find(|note| note.id == id).cloned())
}

#[tauri::command]
pub fn sticky_create(app: AppHandle, color: Option<String>, x: Option<f64>, y: Option<f64>) -> Result<String, String> {
    let at = match (x, y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    let id = create_new(&app, color, at)?;
    // 새 스티커를 띄운 쪽 창은 잠시 뒤 자기 자신을 닫는다(js/sticky.js) — 여기서는 열기만 한다.
    Ok(id)
}

/// 내용·색을 고친다. 위치·크기는 창 이벤트가 적으므로 여기서는 건드리지 않는다.
#[tauri::command]
pub fn sticky_update(app: AppHandle, id: String, text: Option<String>, color: Option<String>) -> Result<(), String> {
    let found = with_notes(&app, |notes| {
        match notes.iter_mut().find(|note| note.id == id) {
            Some(note) => {
                if let Some(text) = text {
                    note.text = text;
                }
                if let Some(color) = color {
                    if !color.trim().is_empty() {
                        note.color = color;
                    }
                }
                note.updated = now_ms();
                true
            }
            None => false,
        }
    });
    if !found {
        return Err("스티커를 찾지 못했습니다".into());
    }
    save(&app);
    let _ = app.emit("tip://stickies-changed", ());
    Ok(())
}

/// 핀(항상 위) — 창 레벨을 바꾸고 값을 저장한다.
#[tauri::command]
pub fn sticky_set_pin(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let found = with_notes(&app, |notes| {
        match notes.iter_mut().find(|note| note.id == id) {
            Some(note) => {
                note.pinned = pinned;
                note.updated = now_ms();
                true
            }
            None => false,
        }
    });
    if !found {
        return Err("스티커를 찾지 못했습니다".into());
    }
    if let Some(win) = app.get_webview_window(&window_label(&id)) {
        let _ = win.set_always_on_top(pinned);
    }
    save(&app);
    Ok(())
}

/// 창만 닫는다(내용은 남긴다).
#[tauri::command]
pub fn sticky_close(app: AppHandle, id: String) {
    if let Some(win) = app.get_webview_window(&window_label(&id)) {
        let _ = win.close();
    } else {
        with_notes(&app, |notes| {
            if let Some(note) = notes.iter_mut().find(|entry| entry.id == id) {
                note.open = false;
            }
        });
        save(&app);
    }
    let _ = app.emit("tip://stickies-changed", ());
}

/// 스티커를 지운다(창도 함께).
#[tauri::command]
pub fn sticky_delete(app: AppHandle, id: String) {
    if let Some(win) = app.get_webview_window(&window_label(&id)) {
        let _ = win.close();
    }
    with_notes(&app, |notes| notes.retain(|note| note.id != id));
    save(&app);
    let _ = app.emit("tip://stickies-changed", ());
}

/// 저장해 둔 스티커를 다시 띄운다 — 홈 모듈의 목록에서 고를 때.
#[tauri::command]
pub fn sticky_open(app: AppHandle, id: String) -> Result<(), String> {
    let note = with_notes(&app, |notes| {
        match notes.iter_mut().find(|note| note.id == id) {
            Some(note) => {
                note.open = true;
                Some(note.clone())
            }
            None => None,
        }
    })
    .ok_or_else(|| "스티커를 찾지 못했습니다".to_string())?;
    save(&app);
    create_window(&app, &note)?;
    let _ = app.emit("tip://stickies-changed", ());
    Ok(())
}
