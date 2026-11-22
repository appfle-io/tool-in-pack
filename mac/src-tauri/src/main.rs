// Windows 콘솔 창 숨김 (macOS 에서는 영향 없음)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tip_lib::run()
}
