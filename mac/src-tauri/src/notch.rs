// TIP 노치 아일랜드 창의 macOS 패널 설정·배치 — v1.12.1
//
// 왜 필요한가:
//   일반 NSWindow(always_on_top = NSFloatingWindowLevel 3)는 WindowServer 가 메뉴 막대 아래
//   (visibleFrame, 약 y=37pt)로 강제로 밀어내서 아무리 y=0 으로 set_position 해도 화면 최상단
//   노치 자리에 붙지 않는다. 그래서 노치 창만 NSPanel 로 바꾸고(AppKit 의 표준 노치 앱 방식),
//     · level = NSMainMenuWindowLevel(24) + 3 = 27  → 메뉴 막대(24)·상태바(25) 위, 팝업 메뉴(101) 아래
//     · styleMask |= NonactivatingPanel(1<<7)      → 클릭해도 다른 앱의 포커스를 뺏지 않는다
//     · collectionBehavior = CanJoinAllSpaces | Stationary | FullScreenAuxiliary | IgnoresCycle
//   로 둔 뒤, NSScreen 의 frame.maxY 기준으로 y = frame.maxY - height 에 정확히 붙인다.
//
// 노치 디스플레이 선택: auxiliaryTopLeftArea / auxiliaryTopRightArea 가 비어 있지 않은 화면
// (= 물리적 노치가 있는 내장 디스플레이)을 먼저 고르고, 없으면 NSScreen.main 을 쓴다.

/// NSMainMenuWindowLevel(24) + 3 — 메뉴 막대와 상태바 위, 팝업 메뉴 아래.
#[cfg(target_os = "macos")]
const NOTCH_WINDOW_LEVEL: objc2_app_kit::NSWindowLevel = 27;

/// 창을 NSPanel 로 바꾸고 노치용 레벨·동작을 건다. 성공하면 true.
#[cfg(target_os = "macos")]
pub fn pin(win: &tauri::WebviewWindow) -> bool {
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::{NSPanel, NSWindowCollectionBehavior, NSWindowStyleMask};

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        eprintln!("[TIP] 노치 패널 설정은 메인 스레드에서만 할 수 있습니다");
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        eprintln!("[TIP] 노치 창의 NSWindow 를 가져오지 못했습니다");
        return false;
    };
    let Some(panel_class) = AnyClass::get(c"NSPanel") else {
        eprintln!("[TIP] NSPanel 클래스를 찾지 못했습니다");
        return false;
    };

    // SAFETY: 메인 스레드에서 방금 만든 이 창의 NSWindow 포인터다. NSWindow 와 NSPanel 은
    // 인스턴스 크기가 같아(둘 다 추가 ivar 없음) 클래스만 바꾸는 방식이 표준이다.
    unsafe {
        let object = &*(ptr as *const AnyObject);
        AnyObject::set_class(object, panel_class);
        let panel = &*(ptr as *const NSPanel);

        panel.setStyleMask(NSWindowStyleMask::NonactivatingPanel);
        panel.setLevel(NOTCH_WINDOW_LEVEL);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        panel.setFloatingPanel(true);
        panel.setBecomesKeyOnlyIfNeeded(false);
        panel.setHidesOnDeactivate(false);
        panel.setReleasedWhenClosed(false);
    }
    true
}

/// 창을 화면 최상단(y = 0) 가운데에 width×height 로 붙인다. 성공하면 true.
#[cfg(target_os = "macos")]
pub fn place(win: &tauri::WebviewWindow, width: f64, height: f64) -> bool {
    use objc2_app_kit::{NSScreen, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        return false;
    };
    let Some(frame) = notch_screen_frame(mtm) else {
        return false;
    };

    // AppKit 좌표는 화면 왼쪽 아래가 원점 — 화면 윗변(frame.maxY)에서 창 높이만큼 내린다.
    let x = frame.origin.x + (frame.size.width - width) / 2.0;
    let y = frame.origin.y + frame.size.height - height;
    let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));

    // SAFETY: 메인 스레드에서 이 창의 NSWindow 포인터로 프레임만 바꾼다.
    unsafe {
        let window = &*(ptr as *const NSWindow);
        window.setFrame_display(rect, true);
    }
    true
}

/// 노치가 있는 화면(없으면 주 화면)의 전체 프레임.
#[cfg(target_os = "macos")]
fn notch_screen_frame(mtm: objc2::MainThreadMarker) -> Option<objc2_foundation::NSRect> {
    use objc2_app_kit::NSScreen;

    for screen in NSScreen::screens(mtm).iter() {
        let left = screen.auxiliaryTopLeftArea();
        let right = screen.auxiliaryTopRightArea();
        // 노치가 있는 내장 디스플레이는 노치 양옆 영역이 0 이 아니다.
        if left.size.width > 1.0 && left.size.height > 1.0
            && right.size.width > 1.0 && right.size.height > 1.0
        {
            return Some(screen.frame());
        }
    }
    NSScreen::mainScreen(mtm).map(|screen| screen.frame())
}

/* ---- macOS 가 아닌 곳(문서 빌드·다른 OS 확인용) — 아무것도 하지 않는다 ---- */

#[cfg(not(target_os = "macos"))]
pub fn pin(_win: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn place(_win: &tauri::WebviewWindow, _width: f64, _height: f64) -> bool {
    false
}
