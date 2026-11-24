// TIP 화면 도구 — 스포이드 · 드래그 OCR · 창 분할 — v1.14.0 (Mac 앱 전용)
//
//  · pick_screen_color   — macOS 내장 NSColorSampler 로 화면의 한 점을 집는다(ESC 로 취소).
//                          고른 색은 tip://color-picked 이벤트로 화면에 알린다.
//  · capture_region      — `screencapture -i -x` 로 사용자가 드래그한 영역만 PNG 로 찍는다.
//                          찍은 파일 경로와 base64 를 함께 돌려준다(OCR 모듈이 그대로 먹는다).
//                          화면 기록 권한이 없으면 [permission] 표시와 함께 물어본다.
//  · snap_active_window  — 손쉬운 사용(Accessibility) 권한으로 지금 앞 창을 좌·우 반쪽, 위·아래 반쪽,
//                          최대, 가운데(70%)로 옮긴다. 권한이 없으면 [permission] 표시를 돌려준다.
//
// 이 파일은 AppKit 접근성(AXUIElement)과 CoreGraphics 를 C 함수 그대로 부른다 —
// 창을 조종하는 데 별도 크레이트를 들이지 않고, 쓰는 함수만 선언해 쓴다.
// 화면 내용은 어디에도 저장·전송하지 않는다. 찍은 PNG 는 임시 폴더에만 잠깐 있다.

use std::collections::HashSet;
use std::ffi::CString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

/// 화면을 찍어 둔 임시 파일 — 다른 커맨드가 읽을 수 있는 경로만 담는다.
static CAPTURES: Mutex<Option<HashSet<PathBuf>>> = Mutex::new(None);
/// 전역 단축키로 찍은 뒤 OCR 창이 가져갈 파일.
static PENDING_SHOT: Mutex<Option<String>> = Mutex::new(None);
/// 스포이드를 두 번 겹쳐 띄우지 않는다.
static SAMPLING: AtomicBool = AtomicBool::new(false);

/* ------------------------------- C 선언부 ------------------------------- */

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

const AX_VALUE_CG_POINT: u32 = 1;
const AX_VALUE_CG_SIZE: u32 = 2;
const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXUIElementCreateApplication(pid: i32) -> *mut std::ffi::c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut std::ffi::c_void,
        attribute: *const std::ffi::c_void,
        value: *mut *mut std::ffi::c_void,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: *mut std::ffi::c_void,
        attribute: *const std::ffi::c_void,
        value: *const std::ffi::c_void,
    ) -> i32;
    fn AXValueCreate(the_type: u32, value: *const std::ffi::c_void) -> *mut std::ffi::c_void;
    fn AXValueGetValue(value: *mut std::ffi::c_void, the_type: u32, value_ptr: *mut std::ffi::c_void) -> u8;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        allocator: *const std::ffi::c_void,
        c_str: *const std::os::raw::c_char,
        encoding: u32,
    ) -> *const std::ffi::c_void;
    fn CFRelease(value: *const std::ffi::c_void);
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/* ------------------------------ 공용 도우미 ------------------------------ */

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn allow_capture(path: &PathBuf) {
    if let Ok(mut slot) = CAPTURES.lock() {
        let set = slot.get_or_insert_with(HashSet::new);
        if set.len() > 64 {
            set.clear();
        }
        set.insert(path.clone());
    }
}

fn is_allowed_capture(path: &PathBuf) -> bool {
    CAPTURES
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|set| set.contains(path)))
        .unwrap_or(false)
}

/// 임시 폴더 안의 tip-shot-*.png 만 읽는다 — 화면이 넘겨준 경로를 그대로 믿지 않는다.
fn check_capture_path(text: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(text.trim());
    if !path.is_absolute() {
        return Err("절대 경로가 아닙니다".into());
    }
    let name = path.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default();
    if !name.starts_with("tip-shot-") || !name.ends_with(".png") {
        return Err("TIP 이 찍은 화면만 열 수 있습니다".into());
    }
    if !is_allowed_capture(&path) {
        return Err("TIP 이 찍은 화면만 열 수 있습니다".into());
    }
    Ok(path)
}

/* ------------------------------- 스포이드 ------------------------------- */

/// 고른 색을 알리는 payload — 화면(search.js·모듈)이 그대로 칠하고 복사한다.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ColorPick {
    color: String,
    r: u8,
    g: u8,
    b: u8,
    /// 사용자가 ESC 로 취소했는지.
    cancelled: bool,
}

/// 화면 어디든 클릭해 색을 고른다. 결과는 tip://color-picked 로 온다.
#[tauri::command]
pub fn pick_screen_color(app: AppHandle) -> Result<(), String> {
    if SAMPLING.swap(true, Ordering::SeqCst) {
        return Err("이미 화면에서 색을 고르는 중입니다".into());
    }

    let handle = app.clone();
    app.run_on_main_thread(move || {
        use block2::RcBlock;
        use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};

        let finish = {
            let handle = handle.clone();
            move |pick: ColorPick| {
                SAMPLING.store(false, Ordering::SeqCst);
                let _ = handle.emit("tip://color-picked", pick);
            }
        };

        // SAFETY: 메인 스레드에서 NSColorSampler 를 만들고, AppKit 이 블록을 복사해 보관한다.
        // 블록은 선택이 끝날 때 AppKit 이 부르고, 그 안에서 우리 상태(SAMPLING)를 되돌린다.
        unsafe {
            let sampler = NSColorSampler::new();
            let block = RcBlock::new(move |color: *mut NSColor| {
                let Some(color) = color.as_ref() else {
                    finish(ColorPick { color: String::new(), r: 0, g: 0, b: 0, cancelled: true });
                    return;
                };
                let rgb = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace());
                let (r, g, b) = match rgb.as_deref() {
                    Some(rgb) => {
                        let channel = |value: f64| (value * 255.0).round().clamp(0.0, 255.0) as u8;
                        (
                            channel(rgb.redComponent()),
                            channel(rgb.greenComponent()),
                            channel(rgb.blueComponent()),
                        )
                    }
                    None => (0, 0, 0),
                };
                finish(ColorPick {
                    color: format!("#{r:02X}{g:02X}{b:02X}"),
                    r,
                    g,
                    b,
                    cancelled: false,
                });
            });
            let handler = RcBlock::as_ptr(&block) as *mut block2::DynBlock<dyn Fn(*mut NSColor)>;
            sampler.showSamplerWithSelectionHandler(&*handler);
            // 샘플러는 선택이 끝날 때까지 AppKit 이 보관하지만, 우리 쪽 참조를 먼저 놓아도
            // 안전하도록 그대로 넘긴다(프로세스가 사는 동안 한 번뿐인 작은 객체).
            std::mem::forget(sampler);
            std::mem::forget(block);
        }
    })
    .map_err(|error| format!("스포이드를 열지 못했습니다: {error}"))
}

/* ------------------------------ 화면 캡처 ------------------------------ */

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    /// 임시 PNG 경로 — OCR 창에 건네는 값.
    pub path: String,
    /// base64 PNG — 화면에 미리 보여 줄 때.
    pub png: String,
}

/// 화면 기록 권한이 없으면 macOS 에 한 번 물어보고, 없으면 [permission] 으로 알린다.
fn ensure_screen_access() -> Result<(), String> {
    if unsafe { CGPreflightScreenCaptureAccess() } {
        return Ok(());
    }
    // 시스템 설정에 항목이 생기도록 한 번 요청한다(이미 거부했으면 창은 다시 뜨지 않는다).
    let granted = unsafe { CGRequestScreenCaptureAccess() };
    if granted {
        return Ok(());
    }
    Err("[permission] 화면 기록 권한이 필요합니다 — 시스템 설정 → 개인정보 보호 및 보안 → 화면 기록에서 TIP 을 켜 주세요".into())
}

/// 사용자가 드래그한 화면 영역을 PNG 로 찍는다(ESC 로 취소하면 Err("취소")).
#[tauri::command]
pub async fn capture_region() -> Result<Capture, String> {
    tauri::async_runtime::spawn_blocking(capture_region_blocking)
        .await
        .map_err(|error| format!("화면을 찍지 못했습니다: {error}"))?
}

fn capture_region_blocking() -> Result<Capture, String> {
    ensure_screen_access()?;

    let path = std::env::temp_dir().join(format!("tip-shot-{}.png", now_ms()));
    let _ = std::fs::remove_file(&path);

    let status = std::process::Command::new("screencapture")
        .args(["-i", "-x", "-t", "png"])
        .arg(&path)
        .status()
        .map_err(|error| format!("screencapture 를 실행하지 못했습니다: {error}"))?;

    if !status.success() || !path.exists() {
        return Err("취소".into());
    }
    let bytes = std::fs::read(&path).map_err(|error| format!("찍은 화면을 읽지 못했습니다: {error}"))?;
    if bytes.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Err("취소".into());
    }

    allow_capture(&path);
    use base64::Engine as _;
    let png = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Capture { path: path.to_string_lossy().to_string(), png })
}

/// 찍은 화면을 base64 로 읽는다 — OCR 창이 손에 든 경로로 부른다.
#[tauri::command]
pub fn read_capture(path: String) -> Result<String, String> {
    let path = check_capture_path(&path)?;
    let bytes = std::fs::read(&path).map_err(|error| format!("찍은 화면을 읽지 못했습니다: {error}"))?;
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// 전역 단축키로 찍은 화면을 OCR 창이 한 번 가져간다.
#[tauri::command]
pub fn take_pending_shot() -> Option<String> {
    PENDING_SHOT.lock().ok().and_then(|mut slot| slot.take())
}

fn set_pending_shot(path: &str) {
    if let Ok(mut slot) = PENDING_SHOT.lock() {
        *slot = Some(path.to_string());
    }
}

/* ------------------------------ 창 분할 ------------------------------ */

/// 화면에서 쓸 수 있는 영역(AX 좌표: 왼쪽 위 원점, y 아래로) — 메뉴 막대·Dock 을 뺀 값.
fn work_area() -> Option<(f64, f64, f64, f64)> {
    use objc2_app_kit::NSScreen;

    let mtm = objc2::MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;
    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let x = visible.origin.x;
    let y = frame.size.height - (visible.origin.y + visible.size.height);
    Some((x, y, visible.size.width, visible.size.height))
}

fn ax_string(name: &str) -> Option<*const std::ffi::c_void> {
    let cstr = CString::new(name).ok()?;
    let value = unsafe { CFStringCreateWithCString(std::ptr::null(), cstr.as_ptr(), CF_STRING_ENCODING_UTF8) };
    if value.is_null() {
        None
    } else {
        Some(value)
    }
}

fn ax_copy(element: *mut std::ffi::c_void, name: &str) -> Option<*mut std::ffi::c_void> {
    let attribute = ax_string(name)?;
    let mut value: *mut std::ffi::c_void = std::ptr::null_mut();
    let result = unsafe { AXUIElementCopyAttributeValue(element, attribute, &mut value) };
    unsafe { CFRelease(attribute) };
    if result == 0 && !value.is_null() {
        Some(value)
    } else {
        None
    }
}

fn ax_set(element: *mut std::ffi::c_void, name: &str, value: *mut std::ffi::c_void) -> bool {
    let Some(attribute) = ax_string(name) else { return false };
    let result = unsafe { AXUIElementSetAttributeValue(element, attribute, value) };
    unsafe { CFRelease(attribute) };
    result == 0
}

fn ax_rect(element: *mut std::ffi::c_void) -> Option<(f64, f64, f64, f64)> {
    let position = ax_copy(element, "AXPosition")?;
    let size = ax_copy(element, "AXSize")?;
    let mut point = CGPoint::default();
    let mut area = CGSize::default();
    let ok_point = unsafe {
        AXValueGetValue(position, AX_VALUE_CG_POINT, &mut point as *mut CGPoint as *mut std::ffi::c_void) != 0
    };
    let ok_size = unsafe {
        AXValueGetValue(size, AX_VALUE_CG_SIZE, &mut area as *mut CGSize as *mut std::ffi::c_void) != 0
    };
    unsafe {
        CFRelease(position);
        CFRelease(size);
    }
    if ok_point && ok_size {
        Some((point.x, point.y, area.width, area.height))
    } else {
        None
    }
}

fn ax_move(element: *mut std::ffi::c_void, x: f64, y: f64, width: f64, height: f64) -> bool {
    let point = CGPoint { x, y };
    let size = CGSize { width, height };
    let size_value = unsafe {
        AXValueCreate(AX_VALUE_CG_SIZE, &size as *const CGSize as *const std::ffi::c_void)
    };
    let point_value = unsafe {
        AXValueCreate(AX_VALUE_CG_POINT, &point as *const CGPoint as *const std::ffi::c_void)
    };
    if size_value.is_null() || point_value.is_null() {
        return false;
    }
    // 크기 → 위치 → 크기 순서로 두 번 건다. 앱마다 위치를 옮길 때 창을 화면 안으로 다시
    // 잘라 내서, 한 번만 걸면 오른쪽·아래 절반이 정확히 붙지 않는다.
    let _ = ax_set(element, "AXSize", size_value);
    let moved = ax_set(element, "AXPosition", point_value);
    let _ = ax_set(element, "AXSize", size_value);
    unsafe {
        CFRelease(size_value);
        CFRelease(point_value);
    }
    moved
}

/// 지금 앞에 있는 앱의 pid — NSWorkspace 가 알려 준다.
fn frontmost_pid() -> Option<i32> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication()?;
    Some(app.processIdentifier())
}

fn snap(preset: &str) -> Result<(), String> {
    let Some((ax, ay, aw, ah)) = work_area() else {
        return Err("화면 크기를 읽지 못했습니다".into());
    };
    let Some(pid) = frontmost_pid() else {
        return Err("앞에 있는 앱을 찾지 못했습니다".into());
    };

    // SAFETY: AXUIElement 는 Copy 규칙으로 돌려받은 값을 CFRelease 로 돌려준다.
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return Err("앞 창을 잡지 못했습니다".into());
        }
        let window = ax_copy(app, "AXFocusedWindow");
        CFRelease(app);
        let Some(window) = window else {
            return Err("앞 창이 없습니다".into());
        };
        let current = ax_rect(window);

        let (x, y, width, height) = match preset {
            "left" => (ax, ay, aw / 2.0, ah),
            "right" => (ax + aw / 2.0, ay, aw / 2.0, ah),
            "top" => (ax, ay, aw, ah / 2.0),
            "bottom" => (ax, ay + ah / 2.0, aw, ah / 2.0),
            "max" => (ax, ay, aw, ah),
            // 가운데 — 화면의 70% 를 정확히 가운데에.
            "center" => {
                let width = aw * 0.7;
                let height = ah * 0.7;
                (ax + (aw - width) / 2.0, ay + (ah - height) / 2.0, width, height)
            }
            // 같은 자리를 두 번 누르면 원래 크기로 되돌린다(두 번 눌러 취소).
            "restore" => match current {
                Some((cx, cy, cw, ch)) if cw > 0.0 && ch > 0.0 => (cx, cy, cw, ch),
                _ => (ax, ay, aw * 0.7, ah * 0.7),
            },
            _ => {
                CFRelease(window);
                return Err("알 수 없는 배치입니다".into());
            }
        };

        let moved = ax_move(window, x, y, width, height);
        CFRelease(window);
        if !moved {
            return Err("이 창은 앱이 크기·위치 변경을 허용하지 않습니다".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

/// 앞 창을 정해진 자리로 옮긴다 — 메인 스레드로 넘겨서 기다린다.
/// 손쉬운 사용 권한이 없으면 [permission] 표시를 돌려준다.
pub fn snap_blocking(app: &AppHandle, preset: &str) -> Result<(), String> {
    if unsafe { AXIsProcessTrusted() } == 0 {
        return Err("[permission] 창을 옮기려면 손쉬운 사용 권한이 필요합니다".into());
    }
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let preset = preset.to_string();
    app.run_on_main_thread(move || {
        let _ = tx.send(snap(&preset));
    })
    .map_err(|error| format!("창 배치를 실행하지 못했습니다: {error}"))?;
    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|_| "창 배치가 응답하지 않습니다".to_string())?
}

#[tauri::command]
pub async fn snap_active_window(app: AppHandle, preset: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || snap_blocking(&app, &preset))
        .await
        .map_err(|error| format!("창 배치를 마치지 못했습니다: {error}"))?
}

/// 전역 단축키에서 바로 부르는 판 — 창을 띄우지 않고 찍고, OCR 창이 가져가게 남긴다.
pub fn capture_for_shortcut(app: &AppHandle) -> Result<(), String> {
    let capture = capture_region_blocking()?;
    set_pending_shot(&capture.path);
    let _ = app.emit("tip://capture-ready", capture.path.clone());
    Ok(())
}

