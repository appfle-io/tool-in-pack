#!/usr/bin/env node
/**
 * TIP v1.13.1 릴리스 사전 점검 — 코드가 약속한 것을 실제로 담고 있는지 센다.
 *
 * CI(macos-latest)에서 빌드 전에, 그리고 로컬에서 `node tools/verify-release.mjs` 로 돌린다.
 * 실패하면 목록을 보여 주고 exit code 1 로 끝난다(빌드·태그를 막는다).
 *
 * v1.13.1 — 우편번호 스크립트 도메인을 t1.kakaocdn.net 으로 옮긴 것(daumcdn 잔존 참조 없음,
 *          CSP script/style/img/font/frame/connect 에 kakaocdn 허용)을 검사한다.
 * v1.13.0 — 캘린더 달력 보기(일·주·월)·독립 필터, 주소 검색 흰 화면 수정(CSP 카카오 우편번호
 *          프레임·샌드박스 제거), 배송 조회 모바일 판/User-Agent 를 함께 검사한다.
 * v1.12.4 — 버전을 mac/src-tauri/tauri.conf.json 에서 읽는다(한 곳만 고치면 되게).
 *          보안 4종(업데이트 URL·해시 검증 / 보관함 허용 목록 / parcel 창 권한 제외 · CSP /
 *          주소 검색 iframe 격리)과 이번 기능(EventKit 캘린더 · 노치 커서 감시 · 알약 폭 ·
 *          카드 > 아이콘)까지 함께 검사한다.
 *
 * 검사 항목
 *   1. 버전 — tauri.conf.json · Cargo.toml · mac/package.json · sw.js · js/app.js 가 같은 버전
 *   2. 노치 밀착 — css/notch.css 의 위쪽 여백 제거 · 알약 높이/폭 · lib.rs 의 NOTCH_PILL_H·W
 *   3. 권한 — Entitlements 의 세 권한 · Info.plist 사용 설명(캘린더 전체 접근 포함)
 *   4. 빠른 메모 키 입력 — NSPanel 서브클래스(canBecomeKeyWindow) · makeKeyWindow · notch_focus
 *   5. 파일 드롭 — 네이티브 DragDrop · read_shelf_file · 보관함 허용 목록(1회성)
 *   6. 설정 동기화 — store.js notifyWindows(emitTo 'notch') · notch.js 의 tip://notch-refresh
 *   7. 카테고리 — 5묶음 정의와 20개 모듈의 배분(3·4·5·5·3)
 *   8. 캘린더 — EventKit(EKEventStore) 조회 · 권한 요청 · AppleScript 제거 · 밀리초 반환
 *               + 캘린더 목록(calendar_list) · 기간 조회·필터(calendar_events) · 달력 보기(일·주·월)
 *   14. 배송 조회 — 모바일 판(m.search.naver.com) · 아이폰 User-Agent · 460×740 창
 *   9. 커서 감시 — setAcceptsMouseMovedEvents · NSEvent.mouseLocation · set_notch_hover
 *  10. 업데이트 보안 — URL 은 릴리스 자산만 · SHA256SUMS.txt 대조 · sha2
 *  11. 창 권한·CSP — parcel 제외 · csp 지시문(wasm·worker·카메라·IPC·외부 API)
 *  12. 주소 검색 — 다음 우편번호를 iframe 으로 격리 · 메인 문서 직접 삽입 없음
 *  13. 홈 카드 — '실행' 글자 버튼 대신 > 아이콘
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const exists = (path) => existsSync(join(ROOT, path));
const fails = [];
const passes = [];

function check(name, ok, detail = '') {
  if (ok) passes.push(name);
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------ 1. 버전 ------------------------------ */

const conf = JSON.parse(read('mac/src-tauri/tauri.conf.json'));
const VERSION = conf.version;
check('tauri.conf.json 버전 형식', /^\d+\.\d+\.\d+$/.test(String(VERSION)), String(VERSION));
check('Cargo.toml 버전', new RegExp(`^version = "${VERSION}"`, 'm').test(read('mac/src-tauri/Cargo.toml')));
check('mac/package.json 버전', JSON.parse(read('mac/package.json')).version === VERSION);
check('sw.js 캐시 버전', read('sw.js').includes(`tip-v${VERSION}`));
check('js/app.js APP_VERSION', read('js/app.js').includes(`APP_VERSION = '${VERSION}'`));
check('버전이 1.13.1 이상', (([major, minor, patch]) => major > 1 || (major === 1 && (minor > 13 || (minor === 13 && patch >= 1))))(VERSION.split('.').map(Number)), String(VERSION));

/* ------------------------------ 2. 노치 밀착 ------------------------------ */

const css = read('css/notch.css');
const pillBlock = css.slice(css.indexOf('.pill {'), css.indexOf('.pill:hover'));
const panelBlock = css.slice(css.indexOf('.panel {'), css.indexOf(":root[data-theme='light'] .panel"));
check('css .pill margin-top 0', /margin-top:\s*0;/.test(pillBlock), pillBlock.trim().slice(0, 60));
check('css .pill 높이 100%', /height:\s*calc\(100% - 3px\);/.test(pillBlock));
check('css .pill 폭 넘침 방지', /max-width:\s*100%;/.test(pillBlock));
check('css .panel margin-top 0', /margin-top:\s*0;/.test(panelBlock));
check('css .panel max-height 100%', /max-height:\s*100%;/.test(panelBlock));
check('css 에 24px/34px 하드코딩 없음', !/margin-top:\s*(24px|34px)/.test(css));

const lib = read('mac/src-tauri/src/lib.rs');
const pillH = Number((lib.match(/const NOTCH_PILL_H: f64 = ([\d.]+);/) || [])[1]);
const pillW = Number((lib.match(/const NOTCH_PILL_W: f64 = ([\d.]+);/) || [])[1]);
check('NOTCH_PILL_H 26~30', pillH >= 26 && pillH <= 30, String(pillH));
check('NOTCH_PILL_W 100 이하(메뉴 막대 아이콘 가리지 않음)', pillW > 60 && pillW <= 100, String(pillW));
check('notch.rs 화면 최상단 배치', /frame\.size\.height - top_inset - height/.test(read('mac/src-tauri/src/notch.rs')));
check('notch.rs 노치 감지(auxiliaryTopLeftArea)', read('mac/src-tauri/src/notch.rs').includes('auxiliaryTopLeftArea'));
check('notch.rs 노치 양옆 여유 16', /NOTCH_SIDE_ROOM: f64 = 16\.0;/.test(read('mac/src-tauri/src/notch.rs')));

/* ------------------------------ 3. 권한(Entitlements) ------------------------------ */

const entPath = 'mac/src-tauri/Entitlements.plist';
check('Entitlements.plist 존재', exists(entPath));
if (exists(entPath)) {
  const ent = read(entPath);
  ['com.apple.security.automation.apple-events',
    'com.apple.security.personal-information.calendars',
    'com.apple.security.device.camera'].forEach((key) => {
    check(`Entitlements ${key}`, ent.includes(`<key>${key}</key>`));
  });
  check('Entitlements cs.allow-jit', ent.includes('<key>com.apple.security.cs.allow-jit</key>'));
}
check('tauri.conf bundle.macOS.entitlements', conf.bundle?.macOS?.entitlements === 'Entitlements.plist',
  String(conf.bundle?.macOS?.entitlements));
const plist = read('mac/src-tauri/Info.plist');
check('Info.plist 사용 설명 3종', ['NSAppleEventsUsageDescription', 'NSCalendarsUsageDescription', 'NSCameraUsageDescription']
  .every((key) => plist.includes(key)));
check('Info.plist 캘린더 전체 접근 설명(macOS 14+)', plist.includes('NSCalendarsFullAccessUsageDescription'));

/* ------------------------------ 4. 빠른 메모 키 입력 ------------------------------ */

const notchRs = read('mac/src-tauri/src/notch.rs');
check('TipNotchPanel 등록', notchRs.includes('ClassBuilder::new(c"TipNotchPanel"'));
check('canBecomeKeyWindow = YES', /sel!\(canBecomeKeyWindow\)/.test(notchRs));
check('makeKeyWindow 호출', notchRs.includes('makeKeyWindow()'));
check('lib.rs notch_focus 커맨드', /fn notch_focus\(/.test(lib));
check('notch_focus 등록', /notch_focus,/.test(lib));

const notchJs = read('js/notch.js');
check('notch.js 가 notch_focus 호출', notchJs.includes("invoke('notch_focus')"));

/* ------------------------------ 5. 파일 드롭 ------------------------------ */

check('lib.rs disable_drag_drop_handler 호출 없음', !/\.disable_drag_drop_handler\(\)/.test(lib));
check('lib.rs DragDrop Drop 처리', /DragDropEvent::Drop \{ paths/.test(lib));
check('lib.rs tip://shelf-drop 송신', lib.includes('tip://shelf-drop'));
check('lib.rs read_shelf_file', /fn read_shelf_file\(path: String\)/.test(lib));
check('read_shelf_file 50MB 제한', lib.includes('SHELF_MAX_BYTES: u64 = 50 * 1024 * 1024'));
check('read_shelf_file 등록', /read_shelf_file,/.test(lib));
check('보관함 허용 목록(드롭한 경로만)', /fn allow_shelf_paths\(/.test(lib) && /fn take_shelf_path\(/.test(lib));
check('드롭 시 허용 목록 기록', /allow_shelf_paths\(&paths\)/.test(lib));
check('허용 목록 1회성(꺼내면 다시 못 읽음)', /if !take_shelf_path\(&path\)/.test(lib));
check('notch.js tip://shelf-drop 수신', notchJs.includes("listen('tip://shelf-drop'"));
check('notch.js read_shelf_file 호출', notchJs.includes("invoke('read_shelf_file'"));
check('보관함 클릭 → 파일 선택창', notchJs.includes('id="shelf-file"') && /picker\.click\(\)/.test(notchJs));

/* ------------------------------ 6. 설정 동기화 ------------------------------ */

const store = read('js/store.js');
check('store.js notifyWindows', /function notifyWindows\(\)/.test(store));
check('store.js emitTo notch', store.includes("emitTo('notch', 'tip://notch-refresh'"));
check('notch.js tip://notch-refresh', notchJs.includes("listen('tip://notch-refresh'"));
check('notch.js 테마·색 적용', /applyTheme\(getTheme\(\)\)/.test(notchJs));
check('notch.js 펼칠 때 재렌더', /if \(renderedSignature !== settingsSignature\(\)\) renderWidgets\(\)/.test(notchJs));
check('notch.js 설정 지문 비교', /function settingsSignature\(\)/.test(notchJs));
check('notch.js 캐시 무효화(syncStore)', /import \{[^}]*syncStore/.test(notchJs) && /syncStore\(\);\n  const \{ widgets \}/.test(notchJs));
check('store.js syncStore 가 notchCache 를 비운다', /function syncStore\(\)[\s\S]{0,240}notchCache = null;/.test(store));

/* ------------------------------ 7. 카테고리 ------------------------------ */

const registry = read('modules/registry.js');
const CATS = [
  ['document', '문서'],
  ['media', '미디어'],
  ['dev', '개발'],
  ['utility', '유틸리티'],
  ['online', '조회 · 연동'],
];
CATS.forEach(([id, label]) => {
  check(`CATEGORIES ${id}`, registry.includes(`{ id: '${id}', label: '${label}' }`));
});
check('CATEGORIES 정확히 5개', (registry.match(/\{ id: '[a-z]+', label: '/g) || []).length === 5);

const ORDER = ['document', 'media', 'dev', 'utility', 'online'];
const orderLine = (store.match(/ORDER_SECTIONS = \[([^\]]+)\]/) || [, ''])[1];
ORDER.forEach((id) => check(`ORDER_SECTIONS ${id}`, orderLine.includes(`'${id}'`)));
check('ORDER_SECTIONS 옛 이름 호환', /ORDER_SECTION_ALIASES = \{ docs: 'document'/.test(store));
check('categoryOf 옛 이름 호환', /CATEGORY_ALIASES = \{ docs: 'document' \}/.test(registry));

const EXPECTED = {
  document: ['doc-reader', 'pdf-tools', 'md-editor'],
  media: ['img-converter', 'photo-privacy', 'video-gif', 'video-mosaic'],
  dev: ['dev-tools', 'text-diff', 'regex-tester', 'color-tools', 'icon-gen'],
  utility: ['clipboard-history', 'qr-gen', 'file-compress', 'ocr-reader', 'unit-converter'],
  online: ['address-search', 'parcel-tracker', 'currency-calc'],
};

// registry 목록에 적힌 모듈만 센다(파일 시스템 탐색에 기대지 않는다).
const listed = [...registry.matchAll(/^import\s+(\w+)\s+from\s+'\.\/([^/]+)\/module\.js';/gm)].map((m) => m[2]);
const total = Object.values(EXPECTED).flat();
check('registry 모듈 20개', listed.length === 20 && total.length === 20, `${listed.length}/${total.length}`);
check('registry 가 20개 모듈을 모두 담음', total.every((id) => listed.includes(id)));

Object.entries(EXPECTED).forEach(([category, ids]) => {
  ids.forEach((id) => {
    const src = read(`modules/${id}/module.js`);
    // 모듈 정의(export default) 안의 category 만 본다 — 도구 내부의 category 필드와 섞이지 않게
    // 마지막 `category:` 줄을 쓴다(모듈 정의는 파일 끝 export default 블록에 있다).
    const matches = [...src.matchAll(/^\s*category: '([a-z-]+)',?$/gm)];
    const value = matches.length ? matches[matches.length - 1][1] : null;
    check(`${id} → ${category}`, value === category, String(value));
  });
});

/* ------------------------------ 8. 캘린더(EventKit) ------------------------------ */

const media = read('mac/src-tauri/src/media.rs');
check('media.rs EKEventStore 사용', media.includes('EKEventStore'));
check('media.rs 권한 상태 확인', media.includes('authorizationStatusForEntityType'));
check('media.rs 전체 접근 권한 요청', media.includes('requestFullAccessToEventsWithCompletion'));
check('media.rs 권한 응답 대기(타임아웃)', /recv_timeout\(CALENDAR_PERMISSION_WAIT\)/.test(media));
check('media.rs 오늘 범위 술어', media.includes('predicateForEventsWithStartDate_endDate_calendars'));
check('media.rs eventsMatchingPredicate', media.includes('eventsMatchingPredicate'));
check('media.rs AppleScript 캘린더 제거', !media.includes('const CALENDAR_SCRIPT') && !/osascript\(CALENDAR_SCRIPT/.test(media) && !/tell application "Calendar"\n/.test(media));
check('CalEvent.start 가 밀리초(i64)', /pub start: i64/.test(media));
check('notch.js 가 start 를 밀리초/문자열 모두 처리', /function startMs\(event\)/.test(notchJs));
check('notch.js 캘린더 오류 원인 표시', /cal-error/.test(notchJs) && /function errorText\(/.test(notchJs));

// v1.13.0 — 달력 보기(일·주·월)와 독립 캘린더 필터
check('media.rs calendar_list 커맨드', /fn calendar_list\(/.test(media) && /calendarsForEntityType\(EKEntityType::Event\)/.test(media));
check('media.rs calendar_events 커맨드', /fn calendar_events\(/.test(media));
check('calendar_events 가 calendar_ids 를 받음', /calendar_ids: Option<Vec<String>>/.test(media));
check('캘린더 필터를 식별자로 거름', /filter\.contains\(&calendar_id\)/.test(media));
check('CalEvent 끝 시각·종일·캘린더 id·색', /pub end: i64/.test(media) && /pub all_day: bool/.test(media)
  && /pub calendar_id: String/.test(media) && /pub color: String/.test(media));
check('EKEvent.isAllDay 사용', media.includes('event.isAllDay()'));
check('캘린더 색 #RRGGBB 변환', /fn color_hex\(/.test(media) && media.includes('colorUsingColorSpace'));
check('CalEvent camelCase 직렬화', /rename_all = "camelCase"/.test(media));
check('캘린더 캐시가 기간·필터별', /struct CalCacheEntry/.test(media) && /CALENDAR_CACHE_MAX/.test(media));
check('lib.rs calendar_list 등록', /media::calendar_list,/.test(lib));
check('lib.rs calendar_events 등록', /media::calendar_events,/.test(lib));

check('notch.js 가 calendar_events 사용', notchJs.includes("invoke('calendar_events'"));
check('notch.js 독립 필터 저장 키', notchJs.includes("tip.calendar.selectedIds.v1"));
check('notch.js 필터 초기값 전체 선택', /storedCalendarIds\(\) \?\? all/.test(notchJs) && /return stored === null \? true/.test(notchJs));
check('notch.js 캘린더 목록 조회', notchJs.includes("invoke('calendar_list'"));
check('notch.js 일·주·월 탭 전환', /\['day', 'week', 'month'\]\.includes\(mode\)/.test(notchJs)
  && notchJs.includes('function renderMonthGrid(') && notchJs.includes('function renderWeekStrip('));

const notchHtml = read('notch.html');
check('notch.html 달력 보기 컨테이너', notchHtml.includes('id="cal-view"'));
check('notch.html 일·주·월 탭', ['day', 'week', 'month'].every((mode) => notchHtml.includes(`data-cal-mode=\"${mode}\"`)));
check('notch.html 필터 목록', notchHtml.includes('id="cal-filter-list"'));
const notchCss = read('css/notch.css');
check('css 달력 격자·주간 스트립', notchCss.includes('.cal-grid {') && notchCss.includes('.cal-week {') && notchCss.includes('.cal-filter-list'));
check('css 오늘·선택 표시', notchCss.includes('.cal-cell.is-today') && notchCss.includes('.cal-cell.is-sel'));

/* ------------------------------ 9. 커서 감시 ------------------------------ */

check('notch.rs setAcceptsMouseMovedEvents', notchRs.includes('setAcceptsMouseMovedEvents(true)'));
check('notch.rs NSEvent::mouseLocation', notchRs.includes('NSEvent::mouseLocation()'));
check('notch.rs cursor_inside', /pub fn cursor_inside\(/.test(notchRs));
check('lib.rs 커서 감시 스레드', /fn start_hover_watch\(/.test(lib) && /hover_tick\(/.test(lib));
check('lib.rs 130ms 주기', /Duration::from_millis\(130\)/.test(lib));
check('lib.rs set_notch_hover 커맨드', /fn set_notch_hover\(/.test(lib) && /set_notch_hover,/.test(lib));
check('lib.rs notch_hover_hold 커맨드', /fn notch_hover_hold\(/.test(lib) && /notch_hover_hold,/.test(lib));
check('lib.rs hover 이벤트 송신', lib.includes('tip://notch-hover-enter') && lib.includes('tip://notch-hover-leave'));
check('notch.js hover 이벤트 수신', notchJs.includes("listen('tip://notch-hover-enter'"));
check('notch.js hover 설정을 Rust 로', /invoke\('set_notch_hover'/.test(notchJs));
check('app.js hover 스위치가 Rust 로', /invokeTauri\('set_notch_hover'/.test(read('js/app.js')));

/* ------------------------------ 10. 업데이트 보안 ------------------------------ */

check('install 커맨드가 url 을 받지 않음', /fn install_app_update_and_restart\(app: AppHandle\)/.test(lib));
check('설치 대상은 Rust 가 보관', /static UPDATE_TARGET: Mutex<Option<UpdateTarget>>/.test(lib));
check('릴리스 자산 주소만 허용', /const RELEASE_DOWNLOAD_PREFIX: &str =\s*\n?\s*"https:\/\/github\.com\/appfle-io\/tool-in-pack\/releases\/download\/"/.test(lib));
check('is_release_asset 검증', /fn is_release_asset\(/.test(lib));
check('SHA256SUMS.txt 자산 찾기', lib.includes('SHA256SUMS.txt'));
check('해시 대조 함수', /fn sha256_file\(/.test(lib) && /fn hash_from_sums\(/.test(lib));
check('해시 불일치 시 설치 중단', /해시가 릴리스와 다릅니다 — 설치를 중단했습니다/.test(lib));
check('sha2 의존성', /^sha2 = "0\.10"/m.test(read('mac/src-tauri/Cargo.toml')));
const appJs = read('js/app.js');
check('app.js 가 url 없이 설치 요청', /invokeTauri\('install_app_update_and_restart'\)/.test(appJs)
  && !/install_app_update_and_restart', \{ url/.test(appJs));
check('업데이트에 verify 단계 문구', appJs.includes('verify'));

/* ------------------------------ 11. 창 권한 · CSP ------------------------------ */

const capability = read('mac/src-tauri/capabilities/default.json');
check('capability 에 parcel 창 없음', !/"parcel"/.test(capability));
['main', 'quickbar', 'tool', 'notch', 'search'].forEach((win) => {
  check(`capability 창 ${win}`, capability.includes(`"${win}"`));
});

const csp = conf.app?.security?.csp;
check('CSP 설정됨', typeof csp === 'string' && csp.length > 40);
if (typeof csp === 'string') {
  [
    ["default-src 'self'", /default-src 'self'/],
    ['script-src wasm', /script-src [^;]*'wasm-unsafe-eval'/],
    ['script-src 인라인 부트스트랩 해시', /script-src [^;]*'sha256-/],
    // v1.13.1 — 카카오가 t1.daumcdn.net 을 닫아 스크립트를 t1.kakaocdn.net 에서 받는다.
    ['script-src 카카오 우편번호 CDN', /script-src [^;]*https:\/\/t1\.kakaocdn\.net/],
    ['script-src 카카오 CDN 와일드카드', /script-src [^;]*https:\/\/\*\.kakaocdn\.net/],
    ['style-src 카카오 CDN', /style-src [^;]*https:\/\/t1\.kakaocdn\.net/],
    ['img-src 카카오 CDN', /img-src [^;]*https:\/\/t1\.kakaocdn\.net/],
    ['font-src 카카오 CDN', /font-src [^;]*https:\/\/t1\.kakaocdn\.net/],
    ['frame-src 카카오 CDN', /frame-src [^;]*https:\/\/t1\.kakaocdn\.net/],
    ['connect-src 카카오 CDN', /connect-src [^;]*https:\/\/t1\.kakaocdn\.net/],
    ['worker-src blob', /worker-src [^;]*blob:/],
    ['img-src blob·data', /img-src [^;]*blob:[^;]*data:/],
    ['media-src 카메라', /media-src [^;]*mediastream:/],
    ["style-src 'unsafe-inline'", /style-src [^;]*'unsafe-inline'/],
    ['connect-src IPC', /connect-src [^;]*ipc:[^;]*http:\/\/ipc\.localhost/],
    ['connect-src 환율 API', /connect-src [^;]*https:\/\/open\.er-api\.com/],
    ['connect-src frankfurter', /connect-src [^;]*https:\/\/api\.frankfurter\.app/],
    ['connect-src nominatim', /connect-src [^;]*https:\/\/nominatim\.openstreetmap\.org/],
    ['connect-src github api', /connect-src [^;]*https:\/\/api\.github\.com/],
    ['frame-src 다음 우편번호', /frame-src [^;]*https:\/\/postcode\.map\.daum\.net/],
    // v1.13.0 — postcode.v2.js 는 자기 UI 를 postcode.map.kakao.com/search iframe 으로 그린다.
    // 이 도메인이 frame-src 에 없어 Mac 앱에서 흰 화면만 떴다.
    ['frame-src 카카오 우편번호', /frame-src [^;]*https:\/\/postcode\.map\.kakao\.com/],
    ['script-src 카카오 우편번호', /script-src [^;]*https:\/\/\*\.kakao\.com/],
    ['connect-src 카카오 우편번호', /connect-src [^;]*https:\/\/postcode\.map\.kakao\.com/],
  ].forEach(([name, pattern]) => check(`CSP ${name}`, pattern.test(csp)));
  check('CSP 에 script unsafe-inline 없음', !/script-src[^;]*'unsafe-inline'/.test(csp));
}

/* ------------------------------ 12. 주소 검색 격리 ------------------------------ */

const address = read('modules/address-search/module.js');
check('address-frame.html 존재', exists('address-frame.html'));
check('address-frame.js 존재', exists('js/address-frame.js'));
check('주소 검색이 iframe 사용', address.includes('address-frame.html') && address.includes('createElement(\'iframe\')'));
check('메인 문서에 다음 스크립트 직접 삽입 없음', !address.includes('t1.daumcdn.net') && !address.includes('t1.kakaocdn.net') && !/createElement\('script'\)/.test(address));
check('iframe 메시지 출처 확인', /event\.source !== daumFrame\.contentWindow/.test(address));
check('iframe 에 불투명 출처 샌드박스 없음(v1.13.0)', !/setAttribute\('sandbox'/.test(address) && !/sandboxRetried/.test(address));
const addressFrame = read('js/address-frame.js');
check('프레임이 우편번호 스크립트 로드', addressFrame.includes('https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'));
check('프레임 SRC 가 종료된 daumcdn 아님(v1.13.1)', !/=\s*'https:\/\/t1\.daumcdn\.net/.test(addressFrame));
const readmeAddressLine = read('README.md').split('\n').find((line) => line.includes('우편번호 서비스**'));
check('README 프라이버시의 주소 스크립트 도메인(v1.13.1)', !!readmeAddressLine && readmeAddressLine.includes('t1.kakaocdn.net'), readmeAddressLine ? readmeAddressLine.replace(/\*\*/g, '').slice(0, 48) : '문단 없음');
check('프레임이 결과만 postMessage', addressFrame.includes("type: 'tip:address:result'"));
check('collect-web 이 address-frame 포함', read('mac/scripts/collect-web.sh').includes('address-frame.html'));
check('sw.js 가 address-frame 캐시', read('sw.js').includes("'./address-frame.html'"));

/* 이스케이프 — 외부 응답·사용자 입력을 innerHTML 에 넣는 파일은 escapeHtml 을 갖고 쓴다 */
['modules/address-search/module.js', 'modules/currency-calc/module.js',
  'modules/parcel-tracker/module.js', 'js/notch.js'].forEach((path) => {
  const src = read(path);
  check(`${path} escapeHtml 정의`, /function escapeHtml\(/.test(src));
  check(`${path} escapeHtml 사용`, /escapeHtml\(/.test(src));
});
check('주소 검색 외부 결과 이스케이프', /escapeHtml\(item\.display_name/.test(address)
  && /escapeHtml\(name \|\| query\)/.test(address));
check('송장 목록 이스케이프 확인', /escapeHtml\(item\.nickname \|\| item\.invoice\)/.test(read('modules/parcel-tracker/module.js')));

/* ------------------------------ 14. 배송 조회 모바일 ------------------------------ */

const parcel = read('modules/parcel-tracker/module.js');
check('배송 조회가 모바일 판 주소', parcel.includes('https://m.search.naver.com/search.naver'));
check('parcel-tracker 에 PC 판 주소 없음', !/`https:\/\/search\.naver\.com\/search\.naver/.test(parcel));
check('Rust 가 아이폰 User-Agent 를 건다', /const PARCEL_USER_AGENT: &str = "Mozilla\/5\.0 \(iPhone;/.test(lib)
  && lib.includes('.user_agent(PARCEL_USER_AGENT)'));
check('배송 창 460×740', /const PARCEL_W: f64 = 460\.0;/.test(lib) && /const PARCEL_H: f64 = 740\.0;/.test(lib));
check('배송 창이 m.search.naver.com 허용', lib.includes('host == "m.search.naver.com"'));

/* ------------------------------ 13. 홈 카드 > 아이콘 ------------------------------ */

check('홈 카드 버튼이 > 아이콘', /class: 'open-btn module-open'/.test(appJs) && /html: icons\.right/.test(appJs));
check('홈 카드에 실행 글자 버튼 없음', !/text: state\.enabled \? '실행' : '중지'/.test(appJs));
check('카드 버튼 aria-label 유지', /'aria-label': state\.enabled \? `\$\{mod\.name\} 실행`/.test(appJs));

/* ------------------------------ 결과 ------------------------------ */

const width = String(passes.length + fails.length).length;
console.log(`TIP v${VERSION} 사전 점검 — 통과 ${passes.length} / 실패 ${fails.length}`);
if (fails.length) {
  fails.forEach((line, index) => console.log(`  ${String(index + 1).padStart(width)}. ✗ ${line}`));
  process.exit(1);
}
console.log('  ✓ 전부 통과');
