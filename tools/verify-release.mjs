#!/usr/bin/env node
/**
 * TIP v1.12.2 릴리스 사전 점검 — 코드가 약속한 것을 실제로 담고 있는지 센다.
 *
 * CI(macos-latest)에서 빌드 전에, 그리고 로컬에서 `node tools/verify-release.mjs` 로 돌린다.
 * 실패하면 목록을 보여 주고 exit code 1 로 끝난다(빌드·태그를 막는다).
 *
 * 검사 항목
 *   1. 버전 — tauri.conf.json · Cargo.toml · mac/package.json · sw.js · js/app.js 가 모두 같은 버전
 *   2. 노치 밀착 — css/notch.css 의 위쪽 여백 제거 · 알약 높이 · lib.rs 의 NOTCH_PILL_H(26~30)
 *   3. 권한 — Entitlements.plist 의 세 권한 · tauri.conf.json 의 bundle.macOS.entitlements
 *   4. 빠른 메모 키 입력 — NSPanel 서브클래스(canBecomeKeyWindow) · makeKeyWindow · notch_focus
 *   5. 파일 드롭 — 네이티브 DragDrop 이벤트 · read_shelf_file · 클릭 선택(input type=file)
 *   6. 설정 동기화 — store.js notifyWindows(emitTo 'notch') · notch.js 의 tip://notch-refresh
 *   7. 카테고리 — 5묶음 정의와 20개 모듈의 배분(3·4·5·5·3)
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const fails = [];
const passes = [];

function check(name, ok, detail = '') {
  if (ok) passes.push(name);
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

/* ------------------------------ 1. 버전 ------------------------------ */

const VERSION = '1.12.2';
const conf = JSON.parse(read('mac/src-tauri/tauri.conf.json'));
check('tauri.conf.json 버전', conf.version === VERSION, conf.version);
check('Cargo.toml 버전', new RegExp(`^version = "${VERSION}"`, 'm').test(read('mac/src-tauri/Cargo.toml')));
check('mac/package.json 버전', JSON.parse(read('mac/package.json')).version === VERSION);
check('sw.js 캐시 버전', read('sw.js').includes(`tip-v${VERSION}`));
check('js/app.js APP_VERSION', read('js/app.js').includes(`APP_VERSION = '${VERSION}'`));

/* ------------------------------ 2. 노치 밀착 ------------------------------ */

const css = read('css/notch.css');
const pillBlock = css.slice(css.indexOf('.pill {'), css.indexOf('.pill:hover'));
const panelBlock = css.slice(css.indexOf('.panel {'), css.indexOf(':root[data-theme=\'light\'] .panel'));
check('css .pill margin-top 0', /margin-top:\s*0;/.test(pillBlock), pillBlock.trim().slice(0, 60));
check('css .pill 높이 100%', /height:\s*calc\(100% - 3px\);/.test(pillBlock));
check('css .panel margin-top 0', /margin-top:\s*0;/.test(panelBlock));
check('css .panel max-height 100%', /max-height:\s*100%;/.test(panelBlock));
check('css 에 24px/34px 하드코딩 없음', !/margin-top:\s*(24px|34px)/.test(css));

const lib = read('mac/src-tauri/src/lib.rs');
const pillH = Number((lib.match(/const NOTCH_PILL_H: f64 = ([\d.]+);/) || [])[1]);
check('NOTCH_PILL_H 26~30', pillH >= 26 && pillH <= 30, String(pillH));
check('notch.rs 화면 최상단 배치', /frame\.size\.height - top_inset - height/.test(read('mac/src-tauri/src/notch.rs')));
check('notch.rs 노치 감지(auxiliaryTopLeftArea)', read('mac/src-tauri/src/notch.rs').includes('auxiliaryTopLeftArea'));

/* ------------------------------ 3. 권한(Entitlements) ------------------------------ */

const entPath = 'mac/src-tauri/Entitlements.plist';
check('Entitlements.plist 존재', existsSync(join(ROOT, entPath)));
if (existsSync(join(ROOT, entPath))) {
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
check('Info.plist 사용 설명 3종', ['NSAppleEventsUsageDescription', 'NSCalendarsUsageDescription', 'NSCameraUsageDescription']
  .every((key) => read('mac/src-tauri/Info.plist').includes(key)));

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

/* ------------------------------ 결과 ------------------------------ */

const width = String(passes.length + fails.length).length;
console.log(`TIP v${VERSION} 사전 점검 — 통과 ${passes.length} / 실패 ${fails.length}`);
if (fails.length) {
  fails.forEach((line, index) => console.log(`  ${String(index + 1).padStart(width)}. ✗ ${line}`));
  process.exit(1);
}
console.log('  ✓ 전부 통과');
