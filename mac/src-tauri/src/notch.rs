// TIP 노치 아일랜드 창의 macOS 패널 설정·배치 — v1.12.3
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
// v1.12.3 수정 — 메뉴 막대 위로 완전히 밀착
//   v1.12.2 까지도 알약이 메뉴 막대 아래(y≈24~37pt)에 떴다. 원인은 창 레벨이 아니라 AppKit 의
//   기본 동작이었다. NSWindow 는 setFrame:display: 때마다 -constrainFrameRect:toScreen: 을 불러
//   화면의 visibleFrame(메뉴 막대를 뺀 영역) 안으로 프레임을 잘라 낸다. 그래서 y=0 으로 지정해도
//   메뉴 막대 높이만큼 아래로 클램핑됐다. TipNotchPanel 에 이 메서드를 추가해 받은 프레임을
//   그대로 돌려주면 클램핑이 사라지고, orderFrontRegardless 로 메뉴 막대 위에 올린다.
//
// v1.12.2 수정 두 가지
//   1) 화면 최상단 밀착 — 알약 창 높이를 26~30pt 로 줄이고(노치가 있으면 노치 높이),
//      노치가 있는 화면에서는 펼친 패널이 노치 바로 아래에서 열린다. 위쪽 여백(margin 24/34px)은
//      CSS 에서 없앴다. 노치 여부·높이는 auxiliaryTopLeftArea / auxiliaryTopRightArea 로 판별한다.
//   2) 키보드 입력 — borderless NSPanel 은 canBecomeKeyWindow 가 NO 라서 클릭해도 key window 가
//      되지 않고 <textarea> 에 글자가 들어가지 않는다. objc2 런타임으로 NSPanel 서브클래스
//      (TipNotchPanel)를 등록해 canBecomeKeyWindow = YES 로 바꾸고, notch_focus 커맨드가
//      makeKeyWindow 로 바로 타이핑되게 한다.
//      v1.15.3 — 첫 응답자를 WKWebView 상위 뷰로 강제 지정하던 줄을 뺐다(커서가 사라지던 원인).

/// NSMainMenuWindowLevel(24) + 3 — 메뉴 막대와 상태바 위, 팝업 메뉴 아래.
#[cfg(target_os = "macos")]
const NOTCH_WINDOW_LEVEL: objc2_app_kit::NSWindowLevel = 27;

/// 단축키로 여는 모듈 창의 레벨 — NSFloatingWindowLevel(3)·NSModalPanelWindowLevel(8) 언저리.
/// 메뉴 막대(24)·노치 패널(27)보다는 아래라 매뉴 막대를 가리지 않으면서, 전체화면 앱 위로 올라온다.
#[cfg(target_os = "macos")]
const TOOL_WINDOW_LEVEL: objc2_app_kit::NSWindowLevel = 8;

/// 노치 높이를 화면에서 읽지 못했을 때 쓰는 값(노치 디스플레이의 메뉴 막대 높이).
#[cfg(target_os = "macos")]
const DEFAULT_NOTCH_H: f64 = 32.0;

/// 노치 알약이 노치를 감쌀 때 양옆으로 더 두는 여유(논리 pt).
/// v1.12.4 — 56 → 16. 알약 양옆으로 남는 투명 창이 메뉴 막대 아이콘을 덮지 않을 만큼만 둔다.
#[cfg(target_os = "macos")]
const NOTCH_SIDE_ROOM: f64 = 16.0;

/* ------------------------------ 패널 클래스 ------------------------------ */

/// `canBecomeKeyWindow` 가 YES 인 NSPanel 서브클래스(TipNotchPanel)를 한 번만 등록한다.
/// 이 클래스로 바꿔야 클릭한 노치 창이 key window 가 되어 입력을 받는다.
#[cfg(target_os = "macos")]
fn panel_class() -> Option<&'static objc2::runtime::AnyClass> {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::sel;
    use objc2_foundation::NSRect;

    if let Some(existing) = AnyClass::get(c"TipNotchPanel") {
        return Some(existing);
    }

    let superclass = AnyClass::get(c"NSPanel")?;
    let mut builder = ClassBuilder::new(c"TipNotchPanel", superclass)?;

    // 키보드 입력을 받을 수 있게 한다(기본 NSPanel 은 borderless 일 때 NO).
    // 반환은 Objective-C BOOL — objc2 의 runtime::Bool 로 돌려준다(러스트 bool 은 Encode 미구현).
    // 수신자는 `&AnyObject` 가 아니라 `*mut AnyObject` 다. 참조 수신자는 캐스팅할 때 수명이
    // 하나로 굳어 `MethodImplementation`(higher-ranked) 검사를 통과하지 못한다.
    extern "C-unwind" fn can_become_key_window(_this: *mut AnyObject, _cmd: Sel) -> Bool {
        Bool::YES
    }
    // 메인 창은 되지 않는다 — 다른 앱을 가리지 않고 키 입력만 받는다.
    extern "C-unwind" fn can_become_main_window(_this: *mut AnyObject, _cmd: Sel) -> Bool {
        Bool::NO
    }
    // 화면 밖/메뉴 막대 아래로 잘라 내지 않는다(v1.12.3). AppKit 은 창을 배치할 때마다 이 메서드로
    // 프레임을 화면의 visibleFrame 안으로 클램핑한다 — 받은 프레임을 그대로 돌려주면 그대로 선다.
    // NSRect 는 macOS 64비트에서 CGRect 와 같은 구조체라 인코딩("{CGRect={CGPoint=dd}{CGSize=dd}}")도
    // 부모 클래스의 메서드와 일치한다.
    extern "C-unwind" fn constrain_frame_rect(
        _this: *mut AnyObject,
        _cmd: Sel,
        frame_rect: NSRect,
        _screen: *mut AnyObject,
    ) -> NSRect {
        frame_rect
    }

    // SAFETY: 두 함수 모두 -(BOOL) 시그니처(수신자 + 셀렉터)와 정확히 일치한다.
    unsafe {
        builder.add_method::<AnyObject, _>(
            sel!(canBecomeKeyWindow),
            can_become_key_window as extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool,
        );
        builder.add_method::<AnyObject, _>(
            sel!(canBecomeMainWindow),
            can_become_main_window as extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool,
        );
        // SAFETY: -(NSRect)constrainFrameRect:(NSRect)toScreen:(NSScreen *) 와 시그니처가 같다.
        builder.add_method::<AnyObject, _>(
            sel!(constrainFrameRect:toScreen:),
            constrain_frame_rect as extern "C-unwind" fn(
                *mut AnyObject,
                Sel,
                NSRect,
                *mut AnyObject,
            ) -> NSRect,
        );
    }

    Some(builder.register())
}

/* ------------------------------ 노치 화면 ------------------------------ */

/// 노치 화면의 노치 크기(논리 pt) — 노치가 없는 화면이면 None.
#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct NotchBox {
    width: f64,
    height: f64,
}

/// 노치 창이 붙을 화면 — (전체 프레임, 있으면 노치 크기).
#[cfg(target_os = "macos")]
fn notch_screen(mtm: objc2::MainThreadMarker) -> Option<(objc2_foundation::NSRect, Option<NotchBox>)> {
    use objc2_app_kit::NSScreen;

    for screen in NSScreen::screens(mtm).iter() {
        let left = screen.auxiliaryTopLeftArea();
        let right = screen.auxiliaryTopRightArea();
        // 노치가 있는 내장 디스플레이는 노치 양옆 영역이 0 이 아니다.
        if left.size.width > 1.0 && left.size.height > 1.0 && right.size.width > 1.0 && right.size.height > 1.0
        {
            let frame = screen.frame();
            let width = frame.size.width - left.size.width - right.size.width;
            let height = left.size.height.max(right.size.height);
            let notch = if width > 1.0 {
                Some(NotchBox {
                    width,
                    height: if height > 1.0 { height } else { DEFAULT_NOTCH_H },
                })
            } else {
                None
            };
            return Some((frame, notch));
        }
    }

    NSScreen::mainScreen(mtm).map(|screen| (screen.frame(), None))
}

/* ------------------------------ 창 설정 ------------------------------ */

/// 창을 NSPanel(키 입력을 받는 TipNotchPanel)로 바꾸고 노치용 레벨·동작을 건다. 성공하면 true.
#[cfg(target_os = "macos")]
pub fn pin(win: &tauri::WebviewWindow) -> bool {
    configure_panel(win)
}

/// 빠른 실행 검색 창도 같은 패널로 만든다(v1.15.5).
/// 전체화면 앱(다른 Space) 위에서 화면 전환 없이 뜨고, 앱을 활성화하지 않은 채 키 입력을 받는다.
#[cfg(target_os = "macos")]
pub fn pin_search(win: &tauri::WebviewWindow) -> bool {
    configure_panel(win)
}

/// 단축키로 여는 모듈 창(tool)도 같은 패널로 만든다(v1.20.0).
/// v1.19.0 까지는 일반 창이라, 다른 앱이 전체화면일 때 단축키를 누르면 데스크톱 Space 로 넘어갔다.
/// 제목 표시줄·크기 조절은 그대로 두고 NonactivatingPanel 만 더해 패널로 바꾼다.
#[cfg(target_os = "macos")]
pub fn pin_tool(win: &tauri::WebviewWindow) -> bool {
    use objc2_app_kit::NSWindow;

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        eprintln!("[TIP] 모듈 창 설정은 메인 스레드에서만 할 수 있습니다");
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        eprintln!("[TIP] 모듈 창의 NSWindow 를 가져오지 못했습니다");
        return false;
    };

    // SAFETY: 메인 스레드에서 이 창의 NSWindow 포인터로 레벨·동작만 바꾼다.
    //
    // v1.21.0 버그 수정 — 창 클래스를 NSPanel(TipNotchPanel)로 바꾸지 않는다.
    // v1.20.0 까지는 AnyObject::set_class 로 WryWindow(NSWindow)를 NSPanel 서브클래스로 바꿔 치고
    // setFloatingPanel·setBecomesKeyOnlyIfNeeded 같은 NSPanel 전용 메서드를 불렀다. 그런데
    // 모듈 창은 CloseRequested 처리도 없이 실제로 닫히면 dealloc 되는데, 이때 NSWindow 와
    // NSPanel 의 ivar/dealloc 이 어긋나 EXC_BAD_ACCESS 로 앱이 즉시 강제종료됐다.
    // 이제 클래스는 그대로 두고 NSWindow 자체 메서드만 쓴다 — 전체화면 앱 위에 뜨고
    // 포커스를 뺏지 않는 동작은 setLevel·setCollectionBehavior 로 충분하다.
    unsafe {
        let window = &*(ptr as *const NSWindow);
        window.setLevel(TOOL_WINDOW_LEVEL);
        window.setCollectionBehavior(nonactivating_behavior());
        window.setHidesOnDeactivate(false);
        window.setReleasedWhenClosed(false);
        window.setAcceptsMouseMovedEvents(true);
    }
    true
}

#[cfg(target_os = "macos")]
fn configure_panel(win: &tauri::WebviewWindow) -> bool {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSPanel, NSWindowStyleMask};

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        eprintln!("[TIP] 노치 패널 설정은 메인 스레드에서만 할 수 있습니다");
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        eprintln!("[TIP] 노치 창의 NSWindow 를 가져오지 못했습니다");
        return false;
    };
    let Some(panel_class) = panel_class() else {
        eprintln!("[TIP] 노치 패널 클래스(NSPanel)를 준비하지 못했습니다");
        return false;
    };

    // SAFETY: 메인 스레드에서 방금 만든 이 창의 NSWindow 포인터다. TipNotchPanel 은 NSPanel 의
    // 서브클래스이고 추가 ivar 가 없어 인스턴스 크기가 같다 — 클래스만 바꾸는 표준 방식이다.
    unsafe {
        let object = &*(ptr as *const AnyObject);
        AnyObject::set_class(object, panel_class);
        let panel = &*(ptr as *const NSPanel);

        // v1.12.3 — 순서가 중요하다. styleMask 를 나중에 바꾸면 AppKit 이 collectionBehavior 를
        // 되돌리므로, 창 성격(패널·비활성·가려지지 않음)을 먼저 정하고 레벨·동작을 **마지막에** 건다.
        panel.setStyleMask(NSWindowStyleMask::NonactivatingPanel);
        panel.setFloatingPanel(true);
        panel.setBecomesKeyOnlyIfNeeded(false);
        panel.setHidesOnDeactivate(false);
        panel.setReleasedWhenClosed(false);
        // v1.12.4 — 마우스 이동(mouseMoved) 이벤트를 받는다. 이게 없으면 클릭하기 전에는
        // 비활성 패널에 마우스 이동이 전달되지 않아, 다른 앱을 쓰는 중 알약 위로 커서를 올려도
        // 화면이 반응하지 않았다(한 번 클릭해야 그 뒤부터 먹혔다).
        panel.setAcceptsMouseMovedEvents(true);

        // 마지막에 레벨·동작 — 다른 앱을 전체화면으로 쓸 때 그 Space 에서도 노치가 보여야 한다.
        // CanJoinAllSpaces(모든 Space) + FullScreenAuxiliary(전체화면 위) + Stationary(스크롤해도 제자리).
        panel.setLevel(NOTCH_WINDOW_LEVEL);
        panel.setCollectionBehavior(nonactivating_behavior());
    }
    true
}

/// 전체화면 Space 에서도 남는 창 동작 — pin 과 order_front 가 함께 쓴다.
#[cfg(target_os = "macos")]
fn nonactivating_behavior() -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior;

    NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::IgnoresCycle
}

/// 창 순서를 메뉴 막대·상태바 위로 올린다 — 다른 앱을 활성화하지 않는다(orderFrontRegardless).
/// 레벨과 collectionBehavior 도 매번 다시 건다 — 다른 앱 전체화면으로 넘어간 뒤나 Space 를 바꿔도
/// 노치가 그 Space 에서 사라지지 않게. 크기·위치는 place 가 따로 잡는다.
#[cfg(target_os = "macos")]
pub fn order_front(win: &tauri::WebviewWindow) -> bool {
    order_front_level(win, NOTCH_WINDOW_LEVEL)
}

/// 단축키로 연 모듈 창을 앞으로 — 전체화면 앱 위에서도 Space 를 바꾸지 않는다(v1.20.0).
#[cfg(target_os = "macos")]
pub fn order_front_tool(win: &tauri::WebviewWindow) -> bool {
    order_front_level(win, TOOL_WINDOW_LEVEL)
}

#[cfg(target_os = "macos")]
fn order_front_level(win: &tauri::WebviewWindow, level: objc2_app_kit::NSWindowLevel) -> bool {
    use objc2_app_kit::NSWindow;

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        return false;
    };

    // SAFETY: 메인 스레드에서 이 창의 NSWindow 포인터로 순서·레벨·동작만 바꾼다.
    unsafe {
        let window = &*(ptr as *const NSWindow);
        window.setLevel(level);
        window.setCollectionBehavior(nonactivating_behavior());
        // orderFrontRegardless — 앱을 활성화하지 않고 창만 앞으로. 전체화면 앱 위에서 유일하게 먹는 순서 변경.
        window.orderFrontRegardless();
    }
    true
}

/// 접힌 알약 창의 크기 — 노치 화면이면 노치를 감싸는 크기(노치 너비+양옆 여유 · 노치 높이),
/// 아니면 받은 기본 크기(92×28). 창 위쪽은 항상 화면 최상단(y=0)에 붙는다.
#[cfg(target_os = "macos")]
pub fn pill_size(base_width: f64, base_height: f64) -> (f64, f64) {
    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return (base_width, base_height);
    };
    let Some((_frame, notch)) = notch_screen(mtm) else {
        return (base_width, base_height);
    };
    match notch {
        Some(notch) => (
            base_width.max(notch.width + NOTCH_SIDE_ROOM),
            (notch.height + 4.0).max(base_height),
        ),
        None => (base_width, base_height),
    }
}

/// 노치 화면 정보 — (화면 너비, 화면 높이, 노치 너비, 노치 높이). 노치가 없으면 너비·높이 0.
/// v1.15.0 — 접힌 알약이 음악·타이머로 넓어질 때, 가운데의 물리 노치 자리를 화면이
/// CSS 변수(--notch-gap)로 비워 두게 한다.
#[cfg(target_os = "macos")]
pub fn metrics() -> Option<(f64, f64, f64, f64)> {
    let mtm = objc2::MainThreadMarker::new()?;
    let (frame, notch) = notch_screen(mtm)?;
    let (width, height) = notch.map(|box_| (box_.width, box_.height)).unwrap_or((0.0, 0.0));
    Some((frame.size.width, frame.size.height, width, height))
}

/// 창을 화면 최상단 가운데에 width×height 로 붙인다. 성공하면 true.
/// `open` 이면 펼친 패널 — 노치 화면에서는 노치를 가리지 않게 노치 바로 아래에서 연다.
#[cfg(target_os = "macos")]
pub fn place(win: &tauri::WebviewWindow, width: f64, height: f64, open: bool) -> bool {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let Some(mtm) = objc2::MainThreadMarker::new() else {
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        return false;
    };
    let Some((frame, notch)) = notch_screen(mtm) else {
        return false;
    };

    let notch_h = notch.map(|box_| box_.height).unwrap_or(0.0);
    // 펼친 패널은 노치 아래에서 시작하고, 노치가 없으면 화면 최상단(y=0)에서 시작한다.
    let top_inset = if open { notch_h } else { 0.0 };
    let max_height = (frame.size.height - top_inset - 6.0).max(120.0);
    let height = height.min(max_height);

    // AppKit 좌표는 화면 왼쪽 아래가 원점 — 화면 윗변(frame.maxY)에서 창 높이만큼 내린다.
    let x = frame.origin.x + (frame.size.width - width) / 2.0;
    let y = frame.origin.y + frame.size.height - top_inset - height;
    let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));

    // SAFETY: 메인 스레드에서 이 창의 NSWindow 포인터로 프레임만 바꾼다.
    unsafe {
        let window = &*(ptr as *const NSWindow);
        window.setFrame_display(rect, true);
    }
    true
}

/* ------------------------------ 커서 위치 (v1.12.4) ------------------------------ */

/// 커서가 이 창(알약 또는 펼친 패널) 안에 있는지 — `margin` 만큼 바깥을 여유로 본다.
/// NSEvent::mouseLocation() 은 화면 좌표(왼쪽 아래가 원점)로 창 프레임과 같은 좌표계다.
/// 손쉬운 사용 권한이 필요 없고, 다른 앱이 활성 상태여도 그대로 읽힌다.
#[cfg(target_os = "macos")]
pub fn cursor_inside(win: &tauri::WebviewWindow, margin: f64) -> Option<bool> {
    use objc2_app_kit::{NSEvent, NSWindow};

    // AppKit 은 메인 스레드에서만 만진다.
    objc2::MainThreadMarker::new()?;
    let ptr = win.ns_window().ok()?;

    // SAFETY: 메인 스레드에서 이 창의 NSWindow 포인터로 프레임만 읽는다.
    let (point, frame) = unsafe {
        let window = &*(ptr as *const NSWindow);
        (NSEvent::mouseLocation(), window.frame())
    };

    let inside = point.x >= frame.origin.x - margin
        && point.x <= frame.origin.x + frame.size.width + margin
        && point.y >= frame.origin.y - margin
        && point.y <= frame.origin.y + frame.size.height + margin;
    Some(inside)
}

/// 노치 창을 key window 로 만들어 키보드 입력을 받게 한다(빠른 메모 클릭).
///
/// v1.15.3 — 첫 응답자를 건드리지 않는다. 예전에는 makeKeyWindow 뒤에
/// `makeFirstResponder(contentView)` 를 불렀는데, contentView 는 WKWebView 자체가 아니라
/// 그 위의 NSView 라서 방금 <textarea> 에 들어간 키보드 포커스를 빼앗았다(커서가 한 번
/// 깜빡이고 사라지던 버그). 클릭이 이미 WKWebView 안의 입력칸에 초점을 주므로, 여기서는
/// 창을 key 로만 만들고 이미 key 면 아무것도 하지 않는다.
#[cfg(target_os = "macos")]
pub fn make_key(win: &tauri::WebviewWindow) -> bool {
    use objc2_app_kit::NSPanel;

    let Some(_mtm) = objc2::MainThreadMarker::new() else {
        return false;
    };
    let Ok(ptr) = win.ns_window() else {
        return false;
    };

    // SAFETY: 메인 스레드에서 이 창의 NSPanel 포인터로 key window 여부만 확인하고 바꾼다.
    unsafe {
        let panel = &*(ptr as *const NSPanel);
        if panel.isKeyWindow() {
            // 이미 키 창 — 다시 만들면 포커스가 한 번 튄다.
            return true;
        }
        panel.makeKeyWindow();
    }
    true
}

/* ---- macOS 가 아닌 곳(문서 빌드·다른 OS 확인용) — 아무것도 하지 않는다 ---- */

#[cfg(not(target_os = "macos"))]
pub fn pin(_win: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn pin_search(_win: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn pin_tool(_win: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn order_front_tool(_win: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn order_front(_win: &tauri::WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn pill_size(base_width: f64, base_height: f64) -> (f64, f64) {
    (base_width, base_height)
}

#[cfg(not(target_os = "macos"))]
pub fn metrics() -> Option<(f64, f64, f64, f64)> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn place(_win: &tauri::WebviewWindow, _width: f64, _height: f64, _open: bool) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn cursor_inside(_win: &tauri::WebviewWindow, _margin: f64) -> Option<bool> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn make_key(_win: &tauri::WebviewWindow) -> bool {
    false
}
