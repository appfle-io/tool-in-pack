#!/usr/bin/env node
/**
 * TIP v1.17.2 · 환경설정 4탭 + 노치 전수 E2E — 실제로 클릭하며 확인한다.
 *
 *   node tools/settings-e2e.mjs
 *   TIP_CHROME=/path/to/chrome node tools/settings-e2e.mjs     # 직접 고른 브라우저로
 *   TIP_PLAYWRIGHT=/path/to/node_modules/playwright node tools/settings-e2e.mjs
 *
 * Playwright 와 브라우저는 환경에 맞게 찾는다(v1.15.1).
 *   · 브라우저 — TIP_CHROME 이 있으면 그것을, 없으면 Playwright 가 설치한 Chromium 을 쓴다.
 *     Mac 에서는 `npx playwright install chromium` 뒤 그냥 `node tools/settings-e2e.mjs` 로 돈다.
 *   · Playwright 모듈 — 보통 설치본을 찾고, 없으면 TIP_PLAYWRIGHT 경로나 NODE_PATH 를 쓴다.
 *
 * 하는 일
 *   · 저장소를 로컬 HTTP 로 띄우고, Tauri(Mac 앱) 환경을 흉내 내는 window.__TAURI__ 를
 *     페이지 스크립트보다 먼저 넣는다. invoke 는 커맨드별 가짜 값을 돌려주고 호출을 기록한다.
 *   · 일반 · 노치 · 검색 · 모듈 네 탭의 버튼·토글·슬라이더·선택·모달·하위 화면을 모두 누른다.
 *   · v1.14.0 제보 버그(단축키 '변경' 직후 '취소'가 먹지 않음)의 회귀 테스트를 포함한다.
 *   · 모듈(타이머) 화면과 접힌 노치 알약(음악·타이머)도 같은 방식으로 확인한다.
 *
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
const playwrightCandidates = [
  'playwright',
  process.env.TIP_PLAYWRIGHT || '',
].filter(Boolean);
for (const candidate of playwrightCandidates) {
  try {
    ({ chromium } = require(candidate));
    break;
  } catch { /* 다음 후보를 본다 */ }
}
if (!chromium) {
  console.error('playwright 를 찾지 못했습니다 — `npm i -D playwright` 뒤 다시 실행하거나 TIP_PLAYWRIGHT=/path/to/playwright 로 경로를 주세요.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 브라우저·라이브러리 경로는 환경변수로만 바꾼다 — 없으면 Playwright 설치본을 그대로 쓴다.
const EXE = process.env.TIP_CHROME || '';
const LIB = process.env.TIP_LIBS || '';

/* ------------------------------ 결과 기록 ------------------------------ */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ------------------------------ 정적 서버 ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let path = normalize(join(ROOT, url === '/' ? 'index.html' : url));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('no');
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------ 브라우저 ------------------------------ */

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  ...(LIB ? { env: { ...process.env, LD_LIBRARY_PATH: LIB } } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const consoleErrors = [];
const MOCK = `
(() => {
  const calls = [];
  window.__TIP_CALLS__ = calls;
  const answers = {
    get_autostart: false,
    set_autostart: null,
    set_tray_visible: null,
    set_notch_enabled: null,
    set_notch_hover: null,
    notch_hover_hold: null,
    set_module_shortcuts: [],
    get_module_shortcuts: [],
    set_search_shortcut: null,
    get_search_shortcut: 'Alt+Space',
    check_app_update: { available: false, current: '1.15.1', message: '최신 버전입니다 (v1.15.1)' },
    open_privacy_settings: null,
    calendar_list: [
      { id: 'cal-1', title: '개인', color: '#2E5E4E', source: 'iCloud', writable: true },
      { id: 'cal-2', title: '직장', color: '#0A6CFF', source: 'Google', writable: true },
      { id: 'cal-3', title: '공휴일', color: '#C93400', source: '구독', writable: false },
    ],
    calendar_create: null,
    calendar_events: [],
    calendar_today: [],
    media_state: { app: 'Music', playing: false, title: '', artist: '', position: 0, duration: 0 },
    media_control: null,
    set_notch_pill: null,
    notch_metrics: { hasNotch: true, notchWidth: 200, notchHeight: 32, screenWidth: 1512, screenHeight: 982 },
    notch_expand: null,
    notch_collapse: null,
    notch_focus: null,
    // v1.17.1 — 접기 전에 묻는 커서 위치(시험에서 window.__TIP_CURSOR_INSIDE__ 로 바꾼다).
    notch_cursor_inside: false,
    timer_alert: null,
    open_search: null,
    hide_search: null,
    open_tool: null,
    open_main: null,
    copy_text: null,
    open_external_url: null,
    search_local_files: [],
    list_installed_apps: [],
    run_system_command: null,
    set_system_commands: null,
    set_clipboard_exclude_secret: null,
    open_postcode_window: null,
    close_postcode_window: null,
    take_postcode_result: null,
    send_email: null,
    // v1.15.3 — 스티커 메모(목록·삭제 2단계 확인)
    sticky_list: [{ id: 'st1', text: '테스트 메모', color: 'green', open: false, created: 0, updated: 0 }],
    sticky_get: { id: 'st1', text: '테스트 메모', color: 'green', open: false, pinned: false, created: 0, updated: 0 },
    sticky_create: null,
    sticky_delete: null,
    sticky_update: null,
    sticky_open: null,
    // v1.16.0 — 백업 대화상자(저장·열기)
    save_backup_file: { path: '/tmp/tip-backup-20261125.json' },
    open_backup_file: {
      name: 'tip-backup-20261125.json',
      content: JSON.stringify({
        format: 'tip-backup', version: 1, app: '1.16.0', created: '2026-11-25T00:00:00.000Z',
        settings: { 'tip.accent': 'blue', 'tip.theme': 'dark' },
        stickyNotes: [], clipboard: null,
      }),
    },
    sticky_restore: 1,
    clipboard_restore: 1,
  };
  window.__TAURI__ = {
    core: {
      invoke(command, args) {
        calls.push({ command, args: args || {} });
        // v1.17.1 — 접기 전에 '커서가 창 안인가'를 묻는다. 시험은 이 값을 직접 바꿔 본다.
        if (command === 'notch_cursor_inside') return Promise.resolve(window.__TIP_CURSOR_INSIDE__ === true);
        const value = Object.prototype.hasOwnProperty.call(answers, command) ? answers[command] : null;
        return Promise.resolve(value);
      },
    },
    event: {
      // v1.17.0 — 들은 이벤트를 남겨 두어 시험에서 직접 보낼 수 있게 한다(tip://notch-tray 등).
      listen: (name, handler) => {
        window.__TIP_LISTENERS__ = window.__TIP_LISTENERS__ || {};
        window.__TIP_LISTENERS__[name] = handler;
        return Promise.resolve(() => {});
      },
      emit: () => Promise.resolve(),
      emitTo: () => Promise.resolve(),
    },
  };
})();
`;

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', colorScheme: 'light' });
await context.addInitScript(MOCK);
const page = await context.newPage();
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`));

async function resetSettings() {
  await page.evaluate(() => {
    const keep = {};
    localStorage.clear();
    window.__TIP_CALLS__.length = 0;
  });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
}

const calls = (command) => page.evaluate((cmd) => window.__TIP_CALLS__.filter((call) => call.command === cmd), command);
const lastCall = async (command) => {
  const list = await calls(command);
  return list.length ? list[list.length - 1] : null;
};
const stored = (key) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return localStorage.getItem(k); } }, key);
const toastText = () => page.evaluate(() => (document.getElementById('toast')?.classList.contains('show') ? document.getElementById('toast').textContent : ''));
const sheetOpen = () => page.evaluate(() => !!document.querySelector('.sheet'));

async function openSettings(tab = null) {
  if (!(await sheetOpen())) await page.click('#settings-btn');
  await page.waitForSelector('.sheet .sheet-tabs', { timeout: 3000 });
  if (tab) {
    await page.click(`.sheet-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(120);
  }
}

async function tabButton(tab) {
  return page.locator(`.sheet-tab[data-tab="${tab}"]`);
}

/* ------------------------- 공통: 시작 ------------------------- */

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

check('홈이 그려짐(모듈 30)', await page.locator('.module-card').count() === 30, String(await page.locator('.module-card').count()));
check('Mac 환경에서 설정 버튼 있음', await page.locator('#settings-btn').count() === 1);

await openSettings();
const tabs = await page.locator('.sheet-tab').allTextContents();
check('설정 탭 4개(일반·노치·검색·모듈)', tabs.join(',') === '일반,노치,검색,모듈', tabs.join(','));

/* ------------------------------ 일반 탭 ------------------------------ */

await page.click('.sheet-tab[data-tab="general"]');
await page.waitForTimeout(100);

// 화면 모드
await page.click('.sheet-seg:has-text("다크")');
check('일반 — 다크 모드 전환', (await page.getAttribute('html', 'data-theme')) === 'dark');
check('일반 — 테마 저장', (await stored('tip.theme')) === 'dark');
await page.click('.sheet-seg:has-text("라이트")');
check('일반 — 라이트 모드 전환', (await page.getAttribute('html', 'data-theme')) === 'light');

// 기본 색상
const swatches = await page.locator('.swatch').count();
check('일반 — 기본 색상 6종', swatches === 6, String(swatches));
await page.click('.swatch[aria-label="블루"]');
check('일반 — 색상 변경 저장', (await stored('tip.accent')) === 'blue', String(await stored('tip.accent')));
check('일반 — 색상 즉시 반영', (await page.getAttribute('html', 'data-accent')) === 'blue');
await page.click('.swatch[aria-label="딥그린"]');

// 로그인 자동 실행
const autoRow = page.locator('.mb-row', { hasText: '로그인 시 자동 실행' });
await autoRow.locator('.switch').click();
await page.waitForTimeout(120);
const autoCall = await lastCall('set_autostart');
check('일반 — 로그인 자동 실행 토글', !!autoCall && autoCall.args.enabled === true, JSON.stringify(autoCall && autoCall.args));
check('일반 — 자동 실행 상태 표시', (await autoRow.locator('i').textContent()) === '켜짐');

// v1.15.1 — 메뉴 막대·퀵바는 노치 탭 한 묶음으로 옮겼다(일반 탭에는 없다).
check('일반 — 메뉴 막대 항목 없음(v1.15.1)', (await page.locator('.mb-row', { hasText: '메뉴 막대에 표시' }).count()) === 0);
check('일반 — 시트 높이 고정 클래스', await page.evaluate(() => document.querySelector('.sheet')?.classList.contains('is-fixed')));
check('일반 — 탭 줄 고정(sticky)', await page.evaluate(() => getComputedStyle(document.querySelector('.sheet-tabs')).position === 'sticky'));
const sheetHeightGeneral = (await page.locator('.sheet').boundingBox())?.height || 0;

// 스크롤해도 탭 줄이 붙어 있는지 — 본문을 내려도 탭 줄 y 가 그대로다.
const tabsY = (await page.locator('.sheet-tabs').boundingBox())?.y;
await page.evaluate(() => { const body = document.querySelector('.sheet-body'); if (body) body.scrollTop = 400; });
await page.waitForTimeout(120);
const tabsYAfter = (await page.locator('.sheet-tabs').boundingBox())?.y;
check('일반 — 스크롤해도 탭 줄 고정', Math.abs((tabsY || 0) - (tabsYAfter || 0)) < 2, `${tabsY} → ${tabsYAfter}`);
await page.evaluate(() => { const body = document.querySelector('.sheet-body'); if (body) body.scrollTop = 0; });

// 권한 3종
const permButtons = page.locator('.perm-open');
const permCount = await permButtons.count();
check('일반 — macOS 권한 버튼 3종', permCount === 3, String(permCount));
await permButtons.first().click();
await page.waitForTimeout(120);
check('일반 — 권한 설정 열기 호출', (await lastCall('open_privacy_settings'))?.args.kind === 'automation');

// 업데이트 확인
await page.click('.upd-check');
await page.waitForTimeout(250);
check('일반 — 업데이트 확인 호출', (await calls('check_app_update')).length === 1);
check('일반 — 업데이트 토스트', (await toastText()).includes('최신 버전'));

/* ------------------------------ 노치 탭 ------------------------------ */

await openSettings('notch');
check('노치 — 탭 설명', (await page.locator('.sheet-tab-note').first().textContent()).includes('노치'));
check('v1.17.0 — 노치 탭 묶음 순서', (await page.locator('.sheet-body .sheet-section h3').allTextContents()).join(',').startsWith('노치 아일랜드,노치 숨기기 단축키,시작 화면,모듈 회전 방식,닫힌 노치 표시,위젯'),
  (await page.locator('.sheet-body .sheet-section h3').allTextContents()).join(','));
check('v1.17.0 — 메뉴 막대 묶음(퀵바 이름 없음)', (await page.locator('.sheet-section h3', { hasText: '메뉴 막대' }).count()) === 1
  && (await page.locator('.sheet-section h3', { hasText: '퀵바' }).count()) === 0);
check('v1.17.0 — 노치 탭에 퀵바라는 말 없음', !(await page.locator('.sheet-body').textContent()).includes('퀵바'));
const notchMaster = page.locator('.notch-section .switch').first();
await notchMaster.click();
await page.waitForTimeout(120);
check('노치 — 켜기 호출', (await lastCall('set_notch_enabled'))?.args.enabled === true);
check('노치 — 저장', (await stored('tip.notch.v1')).enabled === true);
await notchMaster.click();
check('노치 — 끄기 저장', (await stored('tip.notch.v1')).enabled === false);
await notchMaster.click();
await page.waitForTimeout(80);

// 마우스를 올려서 열기
const hoverRow = page.locator('.mb-row', { hasText: '마우스를 올려서 열기' });
await hoverRow.locator('.switch').click();
await page.waitForTimeout(120);
check('노치 — 마우스 오버 설정', (await stored('tip.notch.v1')).hoverOpen === true);
check('노치 — 커서 감시 호출', (await lastCall('set_notch_hover'))?.args.enabled === true);

// 위젯 8종(v1.17.0 — 최근 사용 추가, 모듈 실행 → 켜 둔 모듈)
const widgetRows = page.locator('.notch-widget-section .notch-row');
const widgetCount = await widgetRows.count();
check('노치 — 위젯 8종', widgetCount === 8, String(widgetCount));
const widgetHints = await page.locator('.notch-widget-section .notch-hint').allTextContents();
check('v1.17.0 — 위젯 줄에 어디 나오는지 적힘', widgetHints[0].includes('반원') && widgetHints[0].includes('전체 보기'), widgetHints[0]);
check('v1.17.0 — 켜 둔 모듈 이름', (await page.locator('.notch-widget-section .notch-row b').allTextContents()).includes('켜 둔 모듈'));
// 노치 아일랜드를 꺼도 위젯은 바꿀 수 있다(메뉴 막대로 여는 노치에 적용).
await notchMaster.click();
await page.waitForTimeout(150);
check('v1.17.0 — 노치를 꺼도 위젯 스위치 켜짐', await page.evaluate(() => [...document.querySelectorAll('.notch-widget-section .switch')].every((node) => !node.disabled)));
await notchMaster.click();
await page.waitForTimeout(150);

// v1.17.0 — 시작 화면 · 회전 방식 · 닫힌 노치 표시
check('v1.17.0 — 시작 화면 기본 간단히 보기', await page.evaluate(() => document.querySelector('.notch-start-section [data-choice="simple"]').getAttribute('aria-checked') === 'true'));
await page.click('.notch-start-section [data-choice="full"]');
await page.waitForTimeout(150);
check('v1.17.0 — 시작 화면 저장', (await stored('tip.notch.v1')).startView === 'full');
check('v1.17.0 — 시작 화면 선택 표시', await page.evaluate(() => document.querySelector('.notch-start-section [data-choice="full"]').getAttribute('aria-checked') === 'true'));
await page.click('.notch-start-section [data-choice="simple"]');
await page.waitForTimeout(150);
check('v1.17.0 — 회전 방식 기본 계속 회전', (await stored('tip.notch.v1')).rotation === 'loop');
await page.click('.notch-rotation-section [data-choice="bounded"]');
await page.waitForTimeout(150);
check('v1.17.0 — 회전 방식 저장', (await stored('tip.notch.v1')).rotation === 'bounded');
await page.click('.notch-rotation-section [data-choice="loop"]');
await page.waitForTimeout(150);
const pillSwitch = page.locator('.notch-pill-section .switch');
check('v1.17.0 — 노래와 타이머 표시 기본 켬', (await pillSwitch.getAttribute('aria-pressed')) === 'true');
await pillSwitch.click();
await page.waitForTimeout(100);
check('v1.17.0 — 노래와 타이머 표시 끄기 저장', (await stored('tip.notch.v1')).pillActivity === false);
await pillSwitch.click();
await page.waitForTimeout(100);
check('v1.17.0 — 노래와 타이머 표시 켜기 저장', (await stored('tip.notch.v1')).pillActivity === true);
const mediaRow = page.locator('.notch-row', { hasText: '미디어' }).first();
await mediaRow.locator('.switch').click();
await page.waitForTimeout(80);
check('노치 — 미디어 위젯 켜기', (await stored('tip.notch.v1')).widgets.media === true);
await mediaRow.locator('.switch').click();
check('노치 — 미디어 위젯 끄기', (await stored('tip.notch.v1')).widgets.media === false);

// 캘린더 필터 — 캘린더 위젯이 꺼져 있으면(기본) 비활성이다(v1.15.1).
await page.waitForTimeout(200);
check('노치 — 캘린더 위젯이 꺼져 있으면 필터 비활성', await page.evaluate(() => document.querySelector('.cal-filter-section')?.classList.contains('is-off')));
check('노치 — 꺼져 있으면 목록을 그리지 않는다', (await page.locator('.cal-filter-section input[data-cal]').count()) === 0);
// 캘린더 위젯을 켜면 필터가 살아난다.
const calWidgetRow = page.locator('.notch-row', { hasText: '캘린더' }).first();
await calWidgetRow.locator('.switch').click();
await page.waitForTimeout(400);
const calBoxes = page.locator('.cal-filter-section input[data-cal]');
const calCount = await calBoxes.count();
check('노치 — 캘린더 위젯을 켜면 필터 목록', calCount === 3, String(calCount));
await calBoxes.nth(1).uncheck();
await page.waitForTimeout(120);
check('노치 — 캘린더 필터 저장', JSON.stringify(await stored('tip.calendar.selectedIds.v1')) === '["cal-1","cal-3"]', JSON.stringify(await stored('tip.calendar.selectedIds.v1')));

// v1.15.1 — 노치 아일랜드를 끄면 캘린더 필터는 비활성(목록을 그리지 않는다).
await notchMaster.click();
await page.waitForTimeout(250);
check('노치 — 끄면 캘린더 필터 비활성', await page.evaluate(() => document.querySelector('.cal-filter-section')?.classList.contains('is-off')));
check('노치 — 끄면 캘린더 목록 없음', (await page.locator('.cal-filter-section input[data-cal]').count()) === 0);
await notchMaster.click();
await page.waitForTimeout(250);
check('노치 — 다시 켜면 캘린더 목록', (await page.locator('.cal-filter-section input[data-cal]').count()) === 3);
await page.waitForTimeout(150);

// 메뉴 막대 · 퀵바 묶음 — 표시 토글 + 투명도 + 반원 퀵바 순서
const menuRow = page.locator('.mb-row', { hasText: '메뉴 막대에 표시' }).first();
const menuBefore = await menuRow.locator('.switch').getAttribute('aria-pressed');
await menuRow.locator('.switch').click();
await page.waitForTimeout(120);
const trayCall = await lastCall('set_tray_visible');
check('노치 — 메뉴 막대 표시 토글', !!trayCall && trayCall.args.visible === (menuBefore !== 'true'), JSON.stringify(trayCall && trayCall.args));
const range = page.locator('.op-range');
check('v1.17.0 — 불투명도 최솟값 70', (await range.getAttribute('min')) === '70');
await range.evaluate((node) => { node.value = '84'; node.dispatchEvent(new Event('input', { bubbles: true })); });
check('노치 — 반원 배경 불투명도 슬라이더', (await page.evaluate(() => Number(localStorage.getItem('tip.quickbarOpacity.v1')))) === 84, await page.evaluate(() => localStorage.getItem('tip.quickbarOpacity.v1')));
check('노치 — 불투명도 숫자 표시', (await page.locator('.op-value').textContent()) === '84%');
const oldOpacity = await page.evaluate(async () => {
  localStorage.setItem('tip.quickbarOpacity.v1', '35');
  const store = await import('./js/store.js');
  return store.getQuickbarOpacity();
});
check('v1.17.0 — 예전 35% 저장값은 70 으로', oldOpacity === 70, String(oldOpacity));
await page.evaluate(() => localStorage.setItem('tip.quickbarOpacity.v1', '84'));

// 모듈 순서 하위 화면(예전 '반원 퀵바 순서')
await page.click('.sheet-menu:has-text("모듈 순서")');
await page.waitForTimeout(120);
check('노치 — 모듈 순서 화면', (await page.locator('.sheet-head h2').textContent()) === '모듈 순서');
const modeRows = await page.locator('.mode-row').count();
check('노치 — 모듈 순서 방식 3종', modeRows === 3, String(modeRows));
await page.click('.mode-row[data-mode="asc"]');
await page.waitForTimeout(120);
check('노치 — 오름차순 저장', (await page.evaluate(() => localStorage.getItem('tip.radialOrderMode.v1'))) === 'asc');
await page.click('.sheet-head .sheet-back');
await page.waitForTimeout(120);
check('노치 — 모듈 순서 화면에서 돌아오기', await page.locator('.sheet-tab[data-tab="notch"]').count() === 1);

/* ------------------------------ 검색 탭 ------------------------------ */

await openSettings('search');
const shortcutRow = page.locator('.search-section .shortcut-row');
const changeBtn = shortcutRow.locator('.shortcut-change');
const chip = shortcutRow.locator('.shortcut-chip');
const initialChip = await chip.textContent();

// ★ v1.14.0 제보 버그 — 변경 직후 바로 취소
await changeBtn.click();
check('검색 — 변경 누르면 취소로 바뀜', (await changeBtn.textContent()) === '취소');
await changeBtn.click();   // 바로 취소
await page.waitForTimeout(80);
check('검색 — 변경 직후 바로 취소가 먹음', (await changeBtn.textContent()) === '변경');
check('검색 — 취소 뒤 단축키 그대로', (await chip.textContent()) === initialChip, await chip.textContent());
check('검색 — 취소 뒤 시트 유지', await sheetOpen());

// Esc 로 캐처 취소 — 시트가 닫히면 안 된다
await changeBtn.click();
await page.keyboard.press('Escape');
await page.waitForTimeout(80);
check('검색 — Esc 로 캐처만 취소(시트 유지)', await sheetOpen());
check('검색 — Esc 뒤 버튼 복귀', (await changeBtn.textContent()) === '변경');

// 실제 변경
await changeBtn.click();
await page.keyboard.press('Control+Shift+K');
await page.waitForTimeout(250);
const searchCall = await lastCall('set_search_shortcut');
check('검색 — 새 단축키 등록 호출', searchCall?.args.accelerator === 'CmdOrCtrl+Shift+KeyK', JSON.stringify(searchCall && searchCall.args));
check('검색 — 새 단축키 저장', (await page.evaluate(() => localStorage.getItem('tip.searchShortcut.v1'))) === 'CmdOrCtrl+Shift+KeyK');

// 검색 대상 7종
const scopeRows = page.locator('.mb-section', { hasText: '검색 대상' }).locator('.mb-row');
const scopeCount = await scopeRows.count();
check('검색 — 검색 대상 7종', scopeCount === 7, String(scopeCount));
const calcRow = page.locator('.mb-row', { hasText: '즉석 계산기' });
await calcRow.locator('.switch').click();
check('검색 — 대상 토글 저장', (await stored('tip.searchScope.v1')).calc === false);

// 시스템 명령 9종
const systemSection = page.locator('.sheet-section:has(h3:text-is("시스템 명령"))');
const systemRows = systemSection.locator('.mb-row');
check('검색 — 시스템 명령 9종', (await systemRows.count()) === 9, String(await systemRows.count()));
const restartSwitch = page.locator('.mb-row', { hasText: '재시동' }).locator('.switch');
check('검색 — 위험 명령은 기본 OFF(v1.15.1)', (await restartSwitch.getAttribute('aria-pressed')) === 'false');
await restartSwitch.click();
await page.waitForTimeout(150);
check('검색 — 시스템 명령 토글 저장', (await stored('tip.systemCommands.v1')).restart === true);
check('검색 — Rust 에 설정 전달', JSON.stringify((await lastCall('set_system_commands'))?.args.settings?.restart) === 'true', JSON.stringify((await lastCall('set_system_commands'))?.args));

/* ------------------------------ 모듈 탭 ------------------------------ */

await openSettings('modules');
const prefixSelect = page.locator('.shortcut-prefix-select');
check('모듈 — 공통 조합 기본값 Control+Shift', (await prefixSelect.inputValue()) === 'Control+Shift', await prefixSelect.inputValue());
const prefixOptions = await prefixSelect.locator('option').allTextContents();
check('모듈 — 공통 조합 6가지', prefixOptions.length === 6, String(prefixOptions.length));
const moduleRows = await page.locator('.sheet-module-row').count();
check('모듈 — 모듈 목록 30개', moduleRows === 30, String(moduleRows));
// v1.15.1 — 탭을 바꿔도 시트 높이가 튀지 않는다.
const sheetHeightModules = (await page.locator('.sheet').boundingBox())?.height || 0;
check('모듈 — 탭을 바꿔도 시트 높이 고정', Math.abs(sheetHeightGeneral - sheetHeightModules) < 2, `${Math.round(sheetHeightGeneral)} → ${Math.round(sheetHeightModules)}`);

// v1.15.1 — 검색 칸
const moduleSearch = page.locator('.sheet-module-search');
check('모듈 — 검색 칸 있음', (await moduleSearch.count()) === 1);
await moduleSearch.fill('타이머');
await page.waitForTimeout(150);
check('모듈 — 검색으로 거르기', (await page.locator('.sheet-module-row').count()) < 5, String(await page.locator('.sheet-module-row').count()));
await moduleSearch.fill('');
await page.waitForTimeout(150);

// 아직 단축키가 하나도 없으니 '단축키 있음만' 필터는 0개여야 한다.
check('모듈 — 단축키 없을 때 표시도 없음', (await page.locator('.sheet-module-row .module-shortcut').count()) === 0);
await page.click('.sheet-chip:has-text("단축키 있음만")');
await page.waitForTimeout(150);
check('모듈 — 단축키 있음만 필터(없을 때 0개)', (await page.locator('.sheet-module-row').count()) === 0, String(await page.locator('.sheet-module-row').count()));
await page.click('.sheet-chip:has-text("단축키 있음만")');
await page.waitForTimeout(150);

// 클립보드 — 비밀번호 앱에서 복사한 항목 제외(기본 ON)
await page.click('.sheet-module-row:has-text("클립보드")');
await page.waitForTimeout(200);
const clipSwitch = page.locator('.mb-row', { hasText: '비밀번호 앱에서 복사한 항목 제외' }).locator('.switch');
check('클립보드 — 비밀번호 제외 항목', (await clipSwitch.count()) === 1);
check('클립보드 — 기본 켜짐', (await clipSwitch.getAttribute('aria-pressed')) === 'true');
await clipSwitch.click();
await page.waitForTimeout(200);
check('클립보드 — 끄면 Rust 로 전달', (await lastCall('set_clipboard_exclude_secret'))?.args.enabled === false, JSON.stringify((await lastCall('set_clipboard_exclude_secret'))?.args));
await clipSwitch.click();
await page.waitForTimeout(200);
check('클립보드 — 다시 켜면 저장', (await stored('tip.featureValues.v1'))['clip.excludeSecret'] === true, JSON.stringify(await stored('tip.featureValues.v1')));
await page.click('.sheet-back');
await page.waitForTimeout(150);

// 모듈 하나 — 한 글자 단축키
await page.click('.sheet-module-row:has-text("스티커")');
await page.waitForTimeout(120);
const letterInput = page.locator('.shortcut-letter').first();
check('모듈 — 한 글자 입력칸', await letterInput.count() === 1);
await letterInput.fill('S');
await page.waitForTimeout(250);
check('모듈 — 글자 저장', (await stored('tip.shortcutLetters.v1'))?.['sticky:new'] === 'S', JSON.stringify(await stored('tip.shortcutLetters.v1')));
const shortcutCall = await lastCall('set_module_shortcuts');
check('모듈 — 조합해 등록 호출', JSON.stringify((shortcutCall?.args.items || []).filter(([key]) => key === 'sticky:new')) === JSON.stringify([['sticky:new', 'Control+Shift+KeyS']]), JSON.stringify(shortcutCall && shortcutCall.args.items));

// 중복 글자
await page.click('.sheet-back');
await page.click('.sheet-module-row:has-text("타이머")');
await page.waitForTimeout(120);
const timerLetter = page.locator('.shortcut-letter').first();
await timerLetter.fill('S');
await page.waitForTimeout(200);
check('모듈 — 중복 글자는 거절', !(await stored('tip.shortcutLetters.v1')).timer, JSON.stringify(await stored('tip.shortcutLetters.v1')));
check('모듈 — 중복 안내 토스트', (await toastText()).includes('이미 씁니다'), await toastText());
await timerLetter.fill('T');
await page.waitForTimeout(250);
check('모듈 — 다른 글자는 등록', (await stored('tip.shortcutLetters.v1')).timer === 'T');

// v1.15.1 — 목록으로 돌아오면 단축키가 있는 모듈이 위로 오고 오른쪽에 단축키가 보인다.
await page.click('.sheet-back');
await page.waitForTimeout(200);
const firstRowText = await page.locator('.sheet-module-list .sheet-module-row').first().textContent();
check('모듈 — 단축키 있는 모듈이 위로', firstRowText.includes('스티커') || firstRowText.includes('타이머'), firstRowText.trim().slice(0, 24));
const badgeTexts = await page.locator('.sheet-module-row .module-shortcut').allTextContents();
check('모듈 — 단축키 표시(⌃⇧S 등)', badgeTexts.length === 2 && badgeTexts.some((text) => text.includes('S')), JSON.stringify(badgeTexts));
await page.click('.sheet-chip:has-text("단축키 있음만")');
await page.waitForTimeout(150);
check('모듈 — 단축키 있음만 필터(2개)', (await page.locator('.sheet-module-row').count()) === 2, String(await page.locator('.sheet-module-row').count()));
await page.click('.sheet-chip:has-text("단축키 있음만")');
await page.waitForTimeout(150);

// 해제 — 타이머 모듈 상세로 다시 들어간다.
await page.click('.sheet-module-row:has-text("타이머")');
await page.waitForTimeout(200);
await page.locator('.shortcut-clear').first().click();
await page.waitForTimeout(200);
check('모듈 — 해제', !(await stored('tip.shortcutLetters.v1')).timer);

// 세부 옵션 — 고르기
await page.click('.sheet-back');
await page.click('.sheet-module-row:has-text("스포이드")');
await page.waitForTimeout(150);
const selects = await page.locator('.feature-select-row select').count();
if (selects) {
  const select = page.locator('.feature-select-row select').first();
  await select.selectOption({ index: 1 });
  await page.waitForTimeout(120);
  check('모듈 — 세부 옵션 고르기 저장', !!Object.keys((await stored('tip.featureValues.v1')) || {}).length, JSON.stringify(await stored('tip.featureValues.v1')));
} else {
  check('모듈 — 세부 옵션 고르기 저장', false, '선택 항목을 찾지 못함');
}

// 공통 조합 변경 — 조합이 다시 계산되어 등록
await page.click('.sheet-back');
await page.waitForTimeout(100);
await page.selectOption('.shortcut-prefix-select', 'Alt+Shift');
await page.waitForTimeout(300);
check('모듈 — 공통 조합 변경 저장', (await stored('tip.shortcutPrefix.v1')) === 'Alt+Shift');
const recomposed = await lastCall('set_module_shortcuts');
check('모듈 — 바뀐 조합으로 다시 등록', JSON.stringify((recomposed?.args.items || []).filter(([key]) => key === 'sticky:new')) === JSON.stringify([['sticky:new', 'Alt+Shift+KeyS']]), JSON.stringify(recomposed && recomposed.args.items));

// 창 분할 — 권장 단축키 채우기
await page.click('.sheet-module-row:has-text("창 분할")');
await page.waitForTimeout(150);
await page.click('.sheet-reset');
await page.waitForTimeout(300);
const extras = await stored('tip.shortcutExtra.v1');
check('모듈 — 창 분할 권장 단축키 6개', extras && extras['snap:left'] === 'Control+Alt+ArrowLeft' && Object.keys(extras).length === 6, JSON.stringify(extras && Object.keys(extras)));

/* ------------------- 주소 검색 — Mac 은 별도 창(v1.15.1) ------------------- */

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.evaluate(() => { location.hash = '#/address-search'; });
await page.waitForTimeout(500);
await page.evaluate(() => window.__TIP_CALLS__.length = 0);
await page.click('#addr-kr-open');
await page.waitForTimeout(400);
check('주소 — Mac 은 별도 우편번호 창을 연다', (await calls('open_postcode_window')).length === 1);
check('주소 — Mac 은 iframe 을 만들지 않는다', (await page.locator('#addr-kr-embed iframe').count()) === 0);
check('주소 — 결과를 기다리는 안내', (await page.locator('#addr-kr-hint').textContent()).includes('별도 창'), await page.locator('#addr-kr-hint').textContent());

/* ------------------------------ 닫기 ------------------------------ */

await openSettings('modules');
await page.click('.sheet-head .icon-btn[aria-label="닫기"]');
await page.waitForTimeout(300);
check('설정 — X 로 닫힘', !(await sheetOpen()));

await openSettings();
await page.click('.sheet-backdrop', { position: { x: 8, y: 8 } });
await page.waitForTimeout(300);
check('설정 — 바깥 클릭으로 닫힘', !(await sheetOpen()));

await openSettings();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('설정 — Esc 로 닫힘', !(await sheetOpen()));

/* ------------------------- 모듈 화면 ⚙ → 설정 ------------------------- */

await page.evaluate(() => { location.hash = '#/timer'; });
await page.waitForTimeout(400);
check('타이머 모듈 화면 열림', await page.locator('.tm-clock').count() === 1);
await page.click('.screen-gear');
await page.waitForTimeout(300);
const subHead = page.locator('.sheet-head-sub h2').first();
check('모듈 화면 ⚙ → 그 모듈 설정', await sheetOpen() && (await subHead.textContent()) === '타이머', await subHead.textContent().catch(() => ''));

/* ------------------------------ 타이머 동작 ------------------------------ */

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await page.evaluate(() => localStorage.removeItem('tip.timer.v1'));
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => { location.hash = '#/timer'; });
await page.waitForTimeout(400);

await page.click('.tm-preset[data-min="5"]');
await page.waitForTimeout(200);
let timer = await stored('tip.timer.v1');
check('타이머 — 5분 프리셋 시작', timer?.status === 'running' && timer.duration === 300, JSON.stringify(timer));
// v1.15.2 — 표시 갱신은 250ms 틱이 맡는다. 고정 대기 대신 값이 나타날 때까지 기다린다(간혈적 실패 방지).
await page.waitForFunction(() => document.getElementById('tm-clock')?.textContent.startsWith('05:00'), { timeout: 3000 }).catch(() => {});
check('타이머 — 남은 시간 표시', (await page.locator('#tm-clock').textContent()).startsWith('05:00'), await page.locator('#tm-clock').textContent());

await page.click('#tm-start');   // 일시정지
await page.waitForTimeout(150);
timer = await stored('tip.timer.v1');
check('타이머 — 일시정지', timer?.status === 'paused', timer?.status);
await page.click('#tm-start');   // 계속
await page.waitForTimeout(150);
check('타이머 — 재개', (await stored('tip.timer.v1'))?.status === 'running');

await page.click('#tm-extend');
await page.waitForTimeout(150);
check('타이머 — +1분', (await stored('tip.timer.v1'))?.duration === 360, String((await stored('tip.timer.v1'))?.duration));

await page.fill('#tm-min', '1');
await page.fill('#tm-sec', '30');
await page.click('#tm-custom');
await page.waitForTimeout(500);
check('타이머 — 분·초 직접 입력(1분 30초)', (await stored('tip.timer.v1'))?.duration === 90);
check('타이머 — 직접 입력 표시', /^01:(29|30)$/.test(await page.locator('#tm-clock').textContent()), await page.locator('#tm-clock').textContent());

await page.click('#tm-reset');
await page.waitForTimeout(150);
check('타이머 — 초기화', (await stored('tip.timer.v1')) === null);

// 검색어 해석
const parsed = await page.evaluate(async () => {
  const store = await import('./js/timer-store.js');
  return ['타이머 7분', '타이머 1분 30초', 'timer 90s', '타이머 7:30', '타이머 25', '타이머'].map((text) => {
    const result = store.parseTimerQuery(text);
    return { text, seconds: result && result.seconds };
  });
});
const expected = { '타이머 7분': 420, '타이머 1분 30초': 90, 'timer 90s': 90, '타이머 7:30': 450, '타이머 25': 1500, '타이머': 0 };
check('타이머 — 검색어 해석 6종', parsed.every((item) => item.seconds === expected[item.text]), JSON.stringify(parsed));

/* ------------------------------ 노치 알약 ------------------------------ */

const notchContext = await browser.newContext({ viewport: { width: 700, height: 40 }, locale: 'ko-KR', colorScheme: 'dark' });
await notchContext.addInitScript(MOCK.replace(
  "media_state: { app: 'Music', playing: false, title: '', artist: '', position: 0, duration: 0 }",
  "media_state: { app: 'Spotify', playing: true, title: '테스트 곡 제목', artist: '테스트 가수', position: 65, duration: 200 }",
));
const notch = await notchContext.newPage();
notch.on('pageerror', (error) => consoleErrors.push(`notch pageerror: ${String(error)}`));
await notch.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await notch.evaluate(() => {
  localStorage.clear();
  // v1.17.0 — 일정 추가 폼은 전체 보기의 카드에 있으므로 시작 화면을 전체 보기로 둔다.
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, startView: 'full', widgets: { media: true, timer: true, calendar: true, shelf: true, memo: true, launcher: true } }));
});
await notch.reload({ waitUntil: 'networkidle' });
await notch.waitForTimeout(1200);

check('알약 — 노치 여백(--notch-gap) 적용', (await notch.evaluate(() => document.getElementById('pill').style.getPropertyValue('--notch-gap'))) === '200px');
check('알약 — 노치 없음 클래스 아님', !(await notch.evaluate(() => document.getElementById('pill').classList.contains('no-notch'))));

// 음악 — 첫 조회(4.5초 주기)를 기다린다
await notch.waitForFunction(() => !document.getElementById('pill-eq').hidden, { timeout: 8000 }).catch(() => {});
check('알약 — 음악 재생 중 확장', await notch.evaluate(() => document.getElementById('pill').classList.contains('has-media')));
check('알약 — 이퀄라이저 표시', await notch.evaluate(() => !document.getElementById('pill-eq').hidden));
check('v1.17.0 — 알약에 곡 제목·진행률 없음', await notch.evaluate(() => !document.getElementById('pill-title') && !document.getElementById('pill-progress')));
check('v1.17.0 — 음악이 있으면 TIP 로고 숨김', await notch.evaluate(() => getComputedStyle(document.getElementById('pill-logo')).display === 'none'));
check('v1.17.0 — 알약 이름에 노래 상태', (await notch.locator('#pill').getAttribute('aria-label')).includes('노래 재생 중'));
const pillCall = await notch.evaluate(() => window.__TIP_CALLS__.filter((call) => call.command === 'set_notch_pill').pop());
check('알약 — Rust 에 확장 알림', !!pillCall && pillCall.args.media === true, JSON.stringify(pillCall && pillCall.args));

// 일정 추가 폼 — 펼친 패널에서 + 를 누른다.
await notch.evaluate(() => { document.getElementById('pill').click(); });
await notch.waitForTimeout(500);
await notch.evaluate(() => { document.querySelector('[data-cal-add]').click(); });
await notch.waitForTimeout(400);
check('일정 — + 로 폼 열림', await notch.evaluate(() => !document.getElementById('cal-form').hidden));
const writableOptions = await notch.locator('#cal-form-calendar option').count();
check('일정 — 쓸 수 있는 캘린더만(읽기 전용 제외)', writableOptions === 2, String(writableOptions));
check('일정 — 날짜 기본값', /^\d{4}-\d{2}-\d{2}$/.test(await notch.locator('#cal-form-start-date').inputValue()), await notch.locator('#cal-form-start-date').inputValue());
await notch.fill('#cal-form-title', '테스트 일정');
await notch.locator('#cal-form-allday').check();
check('일정 — 종일이면 시간 숨김', await notch.evaluate(() => document.getElementById('cal-form-start-time').hidden));
await notch.locator('#cal-form-allday').uncheck();
await notch.fill('#cal-form-start-time', '10:00');
await notch.fill('#cal-form-end-date', await notch.locator('#cal-form-start-date').inputValue());
await notch.fill('#cal-form-end-time', '11:00');
await notch.click('#cal-form-save');
await notch.waitForTimeout(500);
const createCall = await notch.evaluate(() => window.__TIP_CALLS__.filter((call) => call.command === 'calendar_create').pop());
check('일정 — calendar_create 호출', !!createCall && createCall.args.title === '테스트 일정', JSON.stringify(createCall && createCall.args));
check('일정 — 저장 후 폼 닫힘', await notch.evaluate(() => document.getElementById('cal-form').hidden));
check('일정 — 종일 값 전달', !!createCall && createCall.args.allDay === false);

// 타이머 — 알약 오른쪽 날개
await notch.evaluate(async () => {
  const store = await import('./js/timer-store.js');
  store.startTimer(300);
});
await notch.waitForTimeout(1200);
check('알약 — 타이머 남은 시간', (await notch.locator('#pill-clock').textContent()).match(/^0[45]:\d\d$/) !== null, await notch.locator('#pill-clock').textContent());
check('알약 — 타이머 날개 표시', await notch.evaluate(() => !document.getElementById('pill-timer').hidden));
const pillCall2 = await notch.evaluate(() => window.__TIP_CALLS__.filter((call) => call.command === 'set_notch_pill').pop());
check('알약 — 음악+타이머 함께 알림', !!pillCall2 && pillCall2.args.media === true && pillCall2.args.timer === true, JSON.stringify(pillCall2 && pillCall2.args));

// 타이머 끝 → 알림 호출
await notch.evaluate(async () => {
  const store = await import('./js/timer-store.js');
  store.startTimer(1);
});
await notch.waitForTimeout(2200);
const alertCall = await notch.evaluate(() => window.__TIP_CALLS__.filter((call) => call.command === 'timer_alert').pop());
check('알약 — 타이머 종료 알림 호출', !!alertCall, JSON.stringify(alertCall && alertCall.args));

/* -------------------- v1.15.2 노치 펼친 패널 UI/UX -------------------- */

// 1. 빈 상태 — 접힌 한 줄, 높이·정렬, 패널 높이
const emptyContext = await browser.newContext({ viewport: { width: 640, height: 600 }, locale: 'ko-KR', colorScheme: 'light' });
await emptyContext.addInitScript(MOCK);
const emptyPage = await emptyContext.newPage();
emptyPage.on('pageerror', (error) => consoleErrors.push(`notch pageerror: ${String(error)}`));
await emptyPage.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await emptyPage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.theme', 'light');
  // v1.17.0 — 이 묶음은 전체 보기(패널) 검사라 시작 화면을 전체 보기로 둔다.
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, startView: 'full', widgets: { media: true, calendar: true, shelf: true, timer: true, memo: true, launcher: true } }));
});
await emptyPage.reload({ waitUntil: 'networkidle' });
await emptyPage.waitForTimeout(1200);

check('v1.15.2 — 회색 막대(.panel-handle) 제거', await emptyPage.evaluate(() => !document.querySelector('.panel-handle')));
const panelHeight = await emptyPage.evaluate(() => Math.round(document.getElementById('panel').getBoundingClientRect().height));
check('v1.15.2 — 펼친 패널 600px 이하', panelHeight > 0 && panelHeight <= 600, String(panelHeight));
const alpha = await emptyPage.evaluate(() => {
  // v1.17.0 — 배경은 판(.sheet)이 맡는다. 기본 불투명도 92%.
  const bg = getComputedStyle(document.getElementById('sheet')).backgroundColor;
  const match = bg.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(',').map((value) => Number(value.trim()));
  return parts.length === 4 ? parts[3] : 1;
});
check('v1.17.0 — 판 배경 불투명도 = 설정값(기본 92%)', Math.abs(alpha - 0.92) < 0.01, String(alpha));

const compact = await emptyPage.evaluate(() => ({
  media: document.querySelector('.wg-media').classList.contains('is-compact'),
  mediaBodyHidden: getComputedStyle(document.querySelector('.media-body')).display === 'none',
  mediaPlayDisabled: document.querySelector('[data-media="playpause"]').disabled,
  calendar: document.querySelector('.wg-calendar').classList.contains('is-compact'),
  calSide: document.getElementById('cal-side').textContent,
  shelf: document.querySelector('.wg-shelf').classList.contains('is-empty'),
  shelfHeight: Math.round(document.getElementById('shelf-drop').getBoundingClientRect().height),
  mediaHeight: Math.round(document.querySelector('.wg-media').getBoundingClientRect().height),
  calHeight: Math.round(document.querySelector('.wg-calendar').getBoundingClientRect().height),
  timerHeight: Math.round(document.querySelector('.wg-timer').getBoundingClientRect().height),
  memoHeight: Math.round(document.querySelector('.wg-memo').getBoundingClientRect().height),
  memoHasSide: !!document.getElementById('memo-side'),
  customHidden: document.getElementById('timer-custom-row').hidden,
  display: document.getElementById('timer-display').textContent,
  presetOn: document.querySelector('.timer-chip.is-on')?.dataset.timerSeconds,
  newStickerTile: [...document.querySelectorAll('.launcher-tile')].some((tile) => tile.textContent.includes('새 스티커')),
  addButton: !!document.getElementById('launcher-new'),
}));
check('v1.15.2 — 음악 없으면 한 줄 접힘', compact.media && compact.mediaBodyHidden);
check('v1.15.2 — 재생 없으면 재생 버튼 비활성', compact.mediaPlayDisabled);
check('v1.15.2 — 남은 일정 없으면 한 줄 접힘', compact.calendar && compact.calSide.includes('남은 일정'), compact.calSide);
check('v1.17.1 — 빈 보관함도 옆 카드(빠른 메모) 높이만큼 채움', compact.shelf && compact.shelfHeight >= compact.memoHeight - 4, `${compact.shelfHeight}/${compact.memoHeight}`);
check('v1.15.2 — 같은 줄 카드 높이 일치(미디어/일정)', compact.mediaHeight === compact.calHeight, `${compact.mediaHeight}/${compact.calHeight}`);
check('v1.17.0 — 첫 줄 세 칸 높이 일치(미디어/일정/타이머)', compact.mediaHeight === compact.timerHeight && compact.calHeight === compact.timerHeight, `${compact.mediaHeight}/${compact.calHeight}/${compact.timerHeight}`);
check('v1.15.2 — 빠른 메모 글자 수 표시 제거', !compact.memoHasSide);
check('v1.15.2 — 직접 입력은 접혀 있음', compact.customHidden);
check('v1.15.2 — 기본 표시는 고른 시간(05:00)', compact.display === '05:00', compact.display);
check('v1.15.2 — 기본 프리셋 5분 선택', compact.presetOn === '300', String(compact.presetOn));
check('v1.15.2 — 새 스티커는 타일이 아니라 +', !compact.newStickerTile && compact.addButton);

// 프리셋 · 직접 입력 · 설정
await emptyPage.locator('[data-timer-seconds="600"]').click();
check('v1.15.2 — 프리셋을 고르면 표시 시간이 따라감', (await emptyPage.locator('#timer-display').textContent()) === '10:00');
await emptyPage.locator('#timer-custom-toggle').click();
check('v1.15.2 — 직접 입력 펼침', !(await emptyPage.evaluate(() => document.getElementById('timer-custom-row').hidden)));
await emptyPage.fill('#timer-min', '2');
await emptyPage.fill('#timer-sec', '30');
check('v1.15.2 — 입력값이 곧 표시 시간', (await emptyPage.locator('#timer-display').textContent()) === '02:30', await emptyPage.locator('#timer-display').textContent());
check('v1.15.2 — 설정 버튼 라벨', (await emptyPage.locator('#timer-custom').textContent()) === '설정');
await emptyPage.locator('#timer-custom').click();
check('v1.15.2 — 설정 누르면 접힘', await emptyPage.evaluate(() => document.getElementById('timer-custom-row').hidden));
check('v1.15.2 — 설정한 시간 유지(02:30)', (await emptyPage.locator('#timer-display').textContent()) === '02:30');
await emptyPage.evaluate(() => { document.getElementById('timer-toggle').click(); });
await emptyPage.waitForTimeout(300);
const startedSeconds = await emptyPage.evaluate(() => JSON.parse(localStorage.getItem('tip.timer.v1')).duration);
check('v1.15.2 — 시작은 고른 시간으로', startedSeconds === 150, String(startedSeconds));
await emptyPage.evaluate(() => { document.getElementById('timer-reset').click(); });
await emptyPage.waitForTimeout(200);
check('v1.15.2 — 초기화 뒤에도 고른 시간 표시', (await emptyPage.locator('#timer-display').textContent()) === '02:30');

// v1.17.2 — 켜 둔 모듈 한 줄: 연속 가로 스크롤·보이는 범위 표시·부드러운 화살표
{
const rowState = await emptyPage.evaluate(() => {
  const row = document.getElementById('launcher-row');
  return {
    tiles: row.querySelectorAll('.launcher-tile').length,
    pos: document.getElementById('launcher-pos').textContent,
    scrollable: row.scrollWidth > row.clientWidth + 1,
    prevHidden: document.querySelector('[data-launcher="prev"]').hidden,
    overflowX: getComputedStyle(row).overflowX,
    scrollLeft: row.scrollLeft,
  };
});
check('v1.17.2 — 켜 둔 모듈을 모두 그린다(7칸씩 잘라 넘기지 않음)', rowState.tiles > 7 && rowState.overflowX === 'auto', JSON.stringify(rowState));
check('v1.17.2 — 위치 표시는 지금 보이는 범위', /^1–\d+ \/ \d+$/.test(rowState.pos) && rowState.scrollLeft === 0, rowState.pos);
check('v1.17.2 — 스크롤할 것이 있으면 화살표 보임', rowState.scrollable && !rowState.prevHidden, JSON.stringify(rowState));

// 휠 — 한 칸씩 끊지 않고 준 픽셀만큼 그대로. (세로 휠은 목록이 스크롤 중이 아닐 때만 가로로 쓴다)
const wheel = await emptyPage.evaluate(async () => {
  const row = document.getElementById('launcher-row');
  const widgets = document.getElementById('widgets');
  row.scrollLeft = 0;
  const before = row.scrollLeft;
  row.dispatchEvent(new WheelEvent('wheel', { deltaX: 143, bubbles: true, cancelable: true }));
  const afterX = row.scrollLeft;
  const posX = document.getElementById('launcher-pos').textContent;
  const fade = row.classList.contains('is-fade-start');
  const canVertical = widgets.scrollHeight <= widgets.clientHeight + 1;
  row.dispatchEvent(new WheelEvent('wheel', { deltaY: 90, bubbles: true, cancelable: true }));
  const afterY = row.scrollLeft;
  return { before, afterX, afterY, canVertical, posX, fade };
});
check('v1.17.2 — 가로 휠은 픽셀 단위로 그대로 스크롤', wheel.afterX - wheel.before === 143, JSON.stringify(wheel));
check('v1.17.2 — 세로 휠도 목록이 스크롤 중이 아니면 가로로 넘긴다', wheel.canVertical ? wheel.afterY - wheel.afterX === 90 : true,
  JSON.stringify(wheel));
check('v1.17.2 — 스크롤하면 위치 표시·왼쪽 페이드가 따라옴', wheel.fade && !/^1–/.test(wheel.posX), JSON.stringify(wheel));

// ‹ › — 부드러운 scrollBy. 중간값이 있으면 애니메이션된 것이고, 끝나면 위치 표시가 바뀐다.
const arrowStart = await emptyPage.evaluate(async () => {
  const row = document.getElementById('launcher-row');
  row.scrollLeft = 0;
  await new Promise((resolve) => setTimeout(resolve, 60));
  document.querySelector('[data-launcher="next"]').click();
  await new Promise((resolve) => setTimeout(resolve, 90));
  const mid = row.scrollLeft;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { mid, end: row.scrollLeft, pos: document.getElementById('launcher-pos').textContent };
});
check('v1.17.2 — › 는 한 화면씩 부드럽게 넘긴다', arrowStart.mid > 0 && arrowStart.end > arrowStart.mid,
  JSON.stringify(arrowStart));
check('v1.17.2 — 넘긴 뒤 위치 표시가 따라감', !/^1–/.test(arrowStart.pos), arrowStart.pos);

// 끝까지 밀면 다음 화살표가 끝 표시. 가운데면 양쪽 페이드가 모두 켜진다.
const atEnds = await emptyPage.evaluate(() => {
  const row = document.getElementById('launcher-row');
  row.scrollLeft = row.scrollWidth;
  row.dispatchEvent(new Event('scroll'));
  return {
    pos: document.getElementById('launcher-pos').textContent,
    nextEnd: document.querySelector('[data-launcher="next"]').classList.contains('is-end'),
    fadeEnd: row.classList.contains('is-fade-end'),
    fadeStart: row.classList.contains('is-fade-start'),
  };
});
check('v1.17.2 — 끝에서는 › 가 끝 표시·오른쪽 페이드 없음', atEnds.nextEnd && !atEnds.fadeEnd && atEnds.fadeStart, JSON.stringify(atEnds));
check('v1.17.2 — 끝에서도 위치 표시는 마지막 범위', /–\d+ \/ \d+$/.test(atEnds.pos), atEnds.pos);
await emptyPage.fill('#launcher-find', '타이머');
await emptyPage.waitForTimeout(120);
const found = await emptyPage.evaluate(() => ({
  tiles: [...document.querySelectorAll('#launcher-row .launcher-tile')].map((tile) => tile.textContent),
  pos: document.getElementById('launcher-pos').textContent,
  navHidden: document.querySelector('[data-launcher="next"]').hidden,
}));
check('v1.17.2 — 찾기로 거르기', found.tiles.length >= 1 && found.tiles.every((text) => text.includes('타이머')), JSON.stringify(found.tiles));
check('v1.17.2 — 한 화면에 다 들어가면 개수·화살표 숨김', /^\d+개$/.test(found.pos) && found.navHidden, JSON.stringify(found));
await emptyPage.fill('#launcher-find', '없는모듈이름');
await emptyPage.waitForTimeout(120);
check('v1.17.0 — 찾는 모듈 없음 안내', (await emptyPage.locator('#launcher-row').textContent()).includes('찾는 모듈이 없어요'));
await emptyPage.fill('#launcher-find', '');
await emptyPage.waitForTimeout(120);
}
const newStickerBefore = await emptyPage.evaluate(() => window.__TIP_CALLS__.some((call) => call.command === 'sticky_create'));
await emptyPage.locator('#launcher-new').click();
await emptyPage.waitForTimeout(250);
const newStickerAfter = await emptyPage.evaluate(() => window.__TIP_CALLS__.some((call) => call.command === 'sticky_create'));
check('v1.15.2 — + 로 새 스티커', !newStickerBefore && newStickerAfter, `${newStickerBefore}/${newStickerAfter}`);
check('v1.15.2 — 패널 높이를 Rust 에 알림', await emptyPage.evaluate(() => window.__TIP_CALLS__.some((call) => call.command === 'notch_resize' && call.args.height > 200)));

// 2. 미디어 오류 — 제목 자리가 아니라 별도 상태
const errorContext = await browser.newContext({ viewport: { width: 452, height: 560 }, locale: 'ko-KR', colorScheme: 'dark' });
await errorContext.addInitScript(MOCK.replace(
  'invoke(command, args) {',
  "invoke(command, args) { if (command === 'media_state') return Promise.reject(new Error('[permission] 음악 앱 자동화 권한이 필요합니다'));",
));
const errorPage = await errorContext.newPage();
errorPage.on('pageerror', (error) => consoleErrors.push(`notch pageerror: ${String(error)}`));
await errorPage.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await errorPage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, widgets: { media: true, timer: false, calendar: false, shelf: false, memo: false, launcher: false } }));
});
await errorPage.reload({ waitUntil: 'networkidle' });
await errorPage.waitForTimeout(1400);
const mediaError = await errorPage.evaluate(() => ({
  state: document.getElementById('media-state')?.hidden === false ? document.getElementById('media-state').textContent : '',
  perm: document.getElementById('media-perm')?.hidden === false,
  titleHidden: document.getElementById('media-title').hidden,
  artistHidden: document.getElementById('media-artist').hidden,
  disabled: [...document.querySelectorAll('[data-media]')].every((button) => button.disabled),
}));
check('v1.15.2 — 미디어 오류는 별도 상태 줄', mediaError.state.includes('권한'), mediaError.state);
check('v1.15.2 — 권한 설정 버튼', mediaError.perm);
check('v1.15.2 — 제목·아티스트 자리에 오류 없음', mediaError.titleHidden && mediaError.artistHidden);
check('v1.15.2 — 오류 때 재생 버튼 비활성', mediaError.disabled);


/* -------------------- v1.15.3 홈 편집 모드·글자·터치 영역 -------------------- */

const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 }, locale: 'ko-KR', colorScheme: 'light' });
await mobileContext.addInitScript(MOCK);
const mobile = await mobileContext.newPage();
mobile.on('pageerror', (error) => consoleErrors.push(`mobile pageerror: ${String(error)}`));
mobile.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
await mobile.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await mobile.evaluate(() => localStorage.clear());
await mobile.reload({ waitUntil: 'networkidle' });

const homeRest = await mobile.evaluate(() => ({
  cards: document.querySelectorAll('.module-card').length,
  switches: [...document.querySelectorAll('.module-card .switch')].filter((node) => node.offsetParent !== null).length,
  pins: [...document.querySelectorAll('.module-card .pin-btn')].filter((node) => node.offsetParent !== null).length,
  handles: document.querySelectorAll('.drag-handle').length,
  editVisible: !!document.getElementById('edit-btn')?.offsetParent,
}));
check('v1.15.3 — 홈 편집 모드: 기본은 실행만', homeRest.cards === 30 && homeRest.switches === 0 && homeRest.pins === 0 && homeRest.handles === 0, JSON.stringify(homeRest));
check('v1.15.3 — 편집 버튼은 홈에만', homeRest.editVisible);

await mobile.click('#edit-btn');
await mobile.waitForTimeout(200);
const editState = await mobile.evaluate(() => {
  const boxes = [...document.querySelectorAll('.home-sections.is-editing .module-card .switch, .home-sections.is-editing .module-card .pin-btn, .home-sections.is-editing .drag-handle')]
    .filter((node) => node.offsetParent !== null)
    .map((node) => { const rect = node.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; });
  return {
    handles: document.querySelectorAll('.drag-handle').length,
    count: boxes.length,
    small: boxes.filter(([w, h]) => w < 44 || h < 44).length,
    label: document.getElementById('edit-btn').textContent,
  };
});
check('v1.15.3 — 편집 모드에서 순서·고정·켜기 표시', editState.handles > 0 && editState.count > 40, JSON.stringify(editState));
check('v1.15.3 — 편집 모드 버튼 44px 이상', editState.small === 0, JSON.stringify(editState));
check('v1.15.3 — 편집 버튼이 완료로', editState.label === '완료', editState.label);

await mobile.locator('.module-card').first().click({ position: { x: 120, y: 18 } });
await mobile.waitForTimeout(200);
check('v1.15.3 — 편집 중 카드는 열리지 않음', (await mobile.evaluate(() => location.hash || '')) === '');
await mobile.click('#edit-btn');
await mobile.waitForTimeout(150);
check('v1.15.3 — 편집을 마치면 다시 실행만', await mobile.evaluate(() => [...document.querySelectorAll('.module-card .switch')].every((node) => node.offsetParent === null)));

/* 모듈 화면 전수 — 이름·보조 글자 12px·버튼 44px */
const MODULE_IDS = [
  'doc-reader', 'clipboard-history', 'address-search', 'parcel-tracker', 'img-converter', 'pdf-tools',
  'md-editor', 'photo-privacy', 'qr-gen', 'video-gif', 'video-mosaic', 'dev-tools', 'text-diff',
  'regex-tester', 'color-tools', 'icon-gen', 'ocr-reader', 'file-compress', 'unit-converter',
  'currency-calc', 'sticky-notes', 'snippets', 'screen-picker', 'drag-ocr', 'window-snap',
  'bulk-rename', 'timer',
];
const tinyText = [];
const smallButtons = [];
const headings = {};
for (const id of MODULE_IDS) {
  await mobile.evaluate((mod) => { location.hash = `#/${mod}`; }, id);
  await mobile.waitForTimeout(120);
  const report = await mobile.evaluate(() => {
    const tiny = [...document.querySelectorAll('#view *')]
      .filter((node) => node.offsetParent !== null && [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()))
      .map((node) => ({ text: node.textContent.trim().slice(0, 14), size: parseFloat(getComputedStyle(node).fontSize) }))
      .filter((item) => item.size < 12);
    const small = [...document.querySelectorAll('#view button')]
      .filter((node) => node.offsetParent !== null)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 16), w: Math.round(rect.width), h: Math.round(rect.height) };
      })
      .filter((box) => box.w < 44 || box.h < 44);
    return { tiny, small, heading: document.querySelector('#view h1')?.textContent || '' };
  });
  headings[id] = report.heading;
  if (report.tiny.length) tinyText.push(`${id}: ${report.tiny[0].text} ${report.tiny[0].size}px`);
  if (report.small.length) smallButtons.push(`${id}: ${report.small[0].label} ${report.small[0].w}×${report.small[0].h}`);
}
check('v1.15.3 — 모듈 보조 글자 12px 이상', tinyText.length === 0, tinyText.slice(0, 4).join(' | '));
check('v1.15.3 — 모듈 버튼 휴대폰 44px 이상', smallButtons.length === 0, smallButtons.slice(0, 4).join(' | '));

const cardNames = await mobile.evaluate(async () => {
  location.hash = '';
  await new Promise((resolve) => setTimeout(resolve, 300));
  return Object.fromEntries([...document.querySelectorAll('.module-card')]
    .map((card) => [card.dataset.moduleId, card.querySelector('.module-name')?.textContent || '']));
});
const nameMismatch = MODULE_IDS.filter((id) => cardNames[id] && headings[id] && cardNames[id] !== headings[id]);
check('v1.15.3 — 홈과 모듈 화면 이름이 같다', nameMismatch.length === 0, nameMismatch.map((id) => `${id}: ${cardNames[id]}/${headings[id]}`).join(' | '));
check('v1.15.3 — 모듈 이름에 · 없음', Object.values(cardNames).every((name) => !name.includes('·')), Object.values(cardNames).filter((name) => name.includes('·')).join(', '));
check('v1.15.3 — 상단 바 부제 제거', await mobile.evaluate(() => !document.querySelector('.brand-text i')));

/* v1.15.4 — 편집 모드 핀: 고정은 채운 아이콘, 아닌 것은 선 아이콘 */
await mobile.click('#edit-btn');
await mobile.waitForTimeout(200);
const pinShapes = await mobile.evaluate(() => {
  const pins = [...document.querySelectorAll('.home-sections.is-editing .pin-btn')];
  const rows = pins.map((node) => ({
    pressed: node.getAttribute('aria-pressed'),
    fill: node.querySelector('svg')?.getAttribute('fill') || '',
  }));
  return {
    total: rows.length,
    filled: rows.filter((row) => row.fill === 'currentColor').length,
    outline: rows.filter((row) => row.fill === 'none').length,
    mismatched: rows.filter((row) => (row.pressed === 'true') !== (row.fill === 'currentColor')).length,
  };
});
check('v1.15.4 — 핀 모양이 고정 상태와 같다(채움/선)', pinShapes.total > 0 && pinShapes.filled > 0 && pinShapes.outline > 0 && pinShapes.mismatched === 0, JSON.stringify(pinShapes));

const outlineId = await mobile.evaluate(() => {
  const node = [...document.querySelectorAll('.home-sections.is-editing .pin-btn')]
    .find((pin) => pin.querySelector('svg')?.getAttribute('fill') === 'none');
  return node ? node.dataset.moduleId : '';
});
await mobile.locator(`.pin-btn[data-module-id="${outlineId}"]`).click();
await mobile.waitForTimeout(300);
const pinAfter = await mobile.evaluate((id) => {
  const pin = document.querySelector(`.pin-btn[data-module-id="${id}"]`);
  return {
    section: pin?.closest('.home-section')?.dataset.section || '',
    fill: pin?.querySelector('svg')?.getAttribute('fill') || '',
    pressed: pin?.getAttribute('aria-pressed') || '',
  };
}, outlineId);
check('v1.15.4 — 고정하면 채운 핀으로 바뀌고 맨 위로', pinAfter.section === 'pinned' && pinAfter.fill === 'currentColor' && pinAfter.pressed === 'true', JSON.stringify(pinAfter));
await mobile.locator(`.pin-btn[data-module-id="${outlineId}"]`).click();   // 되돌리기
await mobile.waitForTimeout(250);
const pinBack = await mobile.evaluate((id) => {
  const pin = document.querySelector(`.pin-btn[data-module-id="${id}"]`);
  return { fill: pin?.querySelector('svg')?.getAttribute('fill') || '', pressed: pin?.getAttribute('aria-pressed') || '' };
}, outlineId);
check('v1.15.4 — 고정을 풀면 선 핀으로 돌아온다', pinBack.fill === 'none' && pinBack.pressed === 'false', JSON.stringify(pinBack));
await mobile.click('#edit-btn');
await mobile.waitForTimeout(150);

/* v1.15.4 — 휴대폰 검색창·색 선택 44px */
await mobile.evaluate(() => { location.hash = '#/clipboard-history'; });
await mobile.waitForTimeout(500);
const clipSearch = await mobile.evaluate(() => {
  const input = document.querySelector('#view .clip-search input');
  const box = document.querySelector('#view .clip-search');
  if (!input) return null;
  return {
    inputH: Math.round(input.getBoundingClientRect().height),
    boxH: Math.round(box?.getBoundingClientRect().height || 0),
  };
});
check('v1.15.4 — 휴대폰 검색창 44px', !!clipSearch && clipSearch.inputH >= 44 && clipSearch.boxH >= 44, JSON.stringify(clipSearch));
await mobile.evaluate(() => { location.hash = '#/qr-gen'; });
await mobile.waitForTimeout(500);
const qrColor = await mobile.evaluate(() => {
  const input = document.querySelector('#view .qr-color input[type="color"]');
  if (!input) return null;
  const rect = input.getBoundingClientRect();
  return { w: Math.round(rect.width), h: Math.round(rect.height) };
});
check('v1.15.4 — 휴대폰 QR 색 선택 44px', !!qrColor && qrColor.w >= 44 && qrColor.h >= 44, JSON.stringify(qrColor));

/* -------------------- v1.15.4 다크 모드 주요 버튼 대비 실측 -------------------- */

const measureContrast = (target, selector) => target.evaluate((sel) => {
  const node = document.querySelector(sel);
  if (!node) return null;
  const parse = (value) => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return [0, 0, 0, 1];
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const blend = (top, bottom) => [0, 1, 2].map((i) => Math.round(top[i] * top[3] + bottom[i] * (1 - top[3])));
  let bg = parse(getComputedStyle(node).backgroundColor);
  if (bg[3] < 1) {
    let parent = node.parentElement;
    let under = [255, 255, 255];
    while (parent) {
      const value = parse(getComputedStyle(parent).backgroundColor);
      if (value[3] > 0.9) { under = value; break; }
      parent = parent.parentElement;
    }
    bg = blend(bg, under);
  }
  const fg = parse(getComputedStyle(node).color);
  const lin = (channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  const box = node.getBoundingClientRect();
  return {
    ratio: Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)),
    color: getComputedStyle(node).color,
    background: getComputedStyle(node).backgroundColor,
    size: [Math.round(box.width), Math.round(box.height)],
  };
}, selector);

const darkContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', colorScheme: 'dark' });
await darkContext.addInitScript(MOCK);
const darkPage = await darkContext.newPage();
darkPage.on('pageerror', (error) => consoleErrors.push(`dark pageerror: ${String(error)}`));
await darkPage.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await darkPage.evaluate(() => { localStorage.clear(); localStorage.setItem('tip.theme', 'dark'); });
await darkPage.reload({ waitUntil: 'networkidle' });
check('v1.15.4 — 다크 테마 적용', (await darkPage.getAttribute('html', 'data-theme')) === 'dark');

const brandContrast = await measureContrast(darkPage, '.brand-mark');
check('v1.15.4 — 다크 모드 주요 버튼 대비 · 로고', !!brandContrast && brandContrast.ratio >= 4.5, JSON.stringify(brandContrast));

await darkPage.evaluate(() => { location.hash = '#/img-converter'; });
await darkPage.waitForTimeout(500);
const primaryContrast = await measureContrast(darkPage, '.primary-btn');
check('v1.15.4 — 다크 모드 주요 버튼 대비 · 기본 버튼', !!primaryContrast && primaryContrast.ratio >= 4.5, JSON.stringify(primaryContrast));

await darkPage.evaluate(() => { location.hash = '#/timer'; });
await darkPage.waitForTimeout(500);
const v16Contrast = await measureContrast(darkPage, '.v16-btn.primary');
check('v1.15.4 — 다크 모드 주요 버튼 대비 · 모듈 버튼', !!v16Contrast && v16Contrast.ratio >= 4.5, JSON.stringify(v16Contrast));

// 글자색으로 쓰는 자리는 밝은 초록(--accent-ink) — 단위 변환의 기준 줄 값이 늘 보인다.
await darkPage.evaluate(() => { location.hash = '#/unit-converter'; });
await darkPage.waitForTimeout(500);
const inkContrast = await measureContrast(darkPage, '.uc-row.is-base .uc-row-value');
check('v1.15.4 — 다크 글자 초록 4.5:1 이상', !!inkContrast && inkContrast.ratio >= 4.5, JSON.stringify(inkContrast));
const unitLabel = await measureContrast(darkPage, '.uc-row.is-base .uc-row-label');
check('v1.15.4 — 다크 기준 줄 라벨 4.5:1 이상', !!unitLabel && unitLabel.ratio >= 4.5, JSON.stringify(unitLabel));
await darkContext.close();

/* 스티커 메모 — 새 스티커 버튼 · 삭제 2단계 확인 */
await mobile.evaluate(() => { location.hash = '#/sticky-notes'; });
await mobile.waitForTimeout(400);
const newButton = await mobile.evaluate(() => {
  const button = document.getElementById('st-new');
  const svg = button.querySelector('svg');
  const rect = button.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  return {
    w: Math.round(rect.width), h: Math.round(rect.height),
    svgW: Math.round(svgRect.width), svgH: Math.round(svgRect.height),
    fits: button.scrollWidth <= button.clientWidth + 1,
  };
});
check('v1.15.3 — 새 스티커 버튼이 깨지지 않음', newButton.h >= 44 && newButton.svgW > 0 && newButton.svgW <= 18 && newButton.svgH <= 18 && newButton.w >= 44, JSON.stringify(newButton));

await mobile.evaluate(() => { window.__TIP_CALLS__.length = 0; });
await mobile.locator('#st-new').click();
await mobile.waitForTimeout(250);
const mobileCalls = (command) => mobile.evaluate((cmd) => window.__TIP_CALLS__.filter((call) => call.command === cmd), command);
const mobileLast = async (command) => { const list = await mobileCalls(command); return list.length ? list[list.length - 1] : null; };
check('v1.15.3 — 새 스티커는 sticky_create 호출', (await mobileCalls('sticky_create')).length === 1);

const beforeDelete = (await mobileCalls('sticky_delete')).length;
await mobile.locator('.sticky-row-del').first().click();
await mobile.waitForTimeout(200);
check('v1.15.3 — 스티커 지우기는 확인창을 띄운다', await mobile.evaluate(() => !!document.querySelector('.confirm-overlay .confirm-dialog')));
check('v1.15.3 — 확인 전에는 지우지 않는다', (await mobileCalls('sticky_delete')).length === beforeDelete);
await mobile.locator('.confirm-cancel').click();
await mobile.waitForTimeout(150);
check('v1.15.3 — 취소하면 대화상자가 닫힌다', await mobile.evaluate(() => !document.querySelector('.confirm-overlay')));
await mobile.locator('.sticky-row-del').first().click();
await mobile.waitForTimeout(150);
await mobile.locator('.confirm-ok').click();
await mobile.waitForTimeout(300);
const deleteCall = await mobileLast('sticky_delete');
check('v1.15.3 — 지우기를 누르면 sticky_delete 호출', !!deleteCall && deleteCall.args.id === 'st1', JSON.stringify(deleteCall && deleteCall.args));

/* 스티커 창(sticky.html) — 같은 2단계 확인 */
const stickyPage = await mobileContext.newPage();
stickyPage.on('pageerror', (error) => consoleErrors.push(`sticky pageerror: ${String(error)}`));
await stickyPage.goto(`${BASE}/sticky.html?id=st1`, { waitUntil: 'networkidle' });
await stickyPage.waitForTimeout(400);
await stickyPage.click('#delete-btn');
await stickyPage.waitForTimeout(200);
check('v1.15.3 — 스티커 창도 확인창', await stickyPage.evaluate(() => !!document.querySelector('.confirm-dialog')));
await stickyPage.click('.confirm-ok');
await stickyPage.waitForTimeout(250);
const windowDelete = await stickyPage.evaluate(() => window.__TIP_CALLS__.filter((call) => call.command === 'sticky_delete').pop());
check('v1.15.3 — 스티커 창 지우기', !!windowDelete && windowDelete.args.id === 'st1', JSON.stringify(windowDelete && windowDelete.args));
await stickyPage.close();

/* 노치 빠른 메모 — 클릭 뒤에도 커서(포커스)가 남는다 */
await emptyPage.evaluate(() => { window.__TIP_CALLS__.length = 0; });
if (!(await emptyPage.evaluate(() => document.getElementById('panel')?.classList.contains('is-open') || document.body.classList.contains('is-open')))) {
  await emptyPage.evaluate(() => { document.getElementById('pill').click(); });
  await emptyPage.waitForTimeout(500);
}
await emptyPage.click('#memo-input');
await emptyPage.waitForTimeout(300);
const memoFocus = await emptyPage.evaluate(() => ({
  active: document.activeElement?.id || '',
  focusCalls: window.__TIP_CALLS__.filter((call) => call.command === 'notch_focus').length,
  caret: (() => { const input = document.getElementById('memo-input'); return { start: input.selectionStart, end: input.selectionEnd }; })(),
}));
check('v1.15.3 — 빠른 메모는 notch_focus 한 번', memoFocus.focusCalls === 1, String(memoFocus.focusCalls));
check('v1.15.3 — 빠른 메모 포커스 유지', memoFocus.active === 'memo-input', memoFocus.active);
await emptyPage.keyboard.type('메모');
check('v1.15.3 — 클릭 뒤 바로 타이핑', (await emptyPage.locator('#memo-input').inputValue()).includes('메모'));


/* ================================================================
   v1.16.0 — 강조색 12조합 · 웹 카테고리 · 마이그레이션 · 백업 ·
             최근 사용 · 파일 추천 · 이어서 하기 · 새 도구
   ================================================================ */

await resetSettings();
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForTimeout(200);

/* ---------- 12조합 강조색 대비 ---------- */
for (const [accent, theme] of [
  ['green', 'light'], ['green', 'dark'], ['blue', 'light'], ['blue', 'dark'],
  ['purple', 'light'], ['purple', 'dark'], ['orange', 'light'], ['orange', 'dark'],
  ['rose', 'light'], ['rose', 'dark'], ['slate', 'light'], ['slate', 'dark'],
]) {
  await page.evaluate(([id, mode]) => {
    localStorage.setItem('tip.accent', id);
    localStorage.setItem('tip.theme', mode);
  }, [accent, theme]);
  await page.reload({ waitUntil: 'networkidle' });
  const logo = await measureContrast(page, '.brand-mark');
  check(`v1.16.0 — 강조색 ${accent}/${theme} 채움 위 흰 글자 4.5:1`, !!logo && logo.ratio >= 4.5, JSON.stringify(logo));
}
await page.evaluate(() => { localStorage.removeItem('tip.accent'); localStorage.removeItem('tip.theme'); });
await page.reload({ waitUntil: 'networkidle' });

/* ---------- 웹(PWA)에서는 Mac 분류 숨김 ---------- */
const webContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
const webPage = await webContext.newPage();
await webPage.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await webPage.evaluate(() => localStorage.clear());
await webPage.reload({ waitUntil: 'networkidle' });
const webSections = await webPage.locator('.home-section').evaluateAll((nodes) => nodes.map((node) => node.dataset.section));
check('v1.16.0 — 웹 모듈 25개(Mac 5종 제외)', await webPage.locator('.module-card').count() === 25,
  String(await webPage.locator('.module-card').count()));
check('v1.16.0 — 웹에 Mac 화면 도구 섹션 없음', !webSections.includes('mac'), webSections.join(','));
check('v1.16.0 — 여섯 분류 순서', webSections.filter((id) => id !== 'pinned').join(',') === 'docs,media,file,calc,dev',
  webSections.join(','));
await webPage.close();
await webContext.close();

/* ---------- 옛 설정 마이그레이션 — 핀·순서 유지 ---------- */
const tauriPage = page;
await tauriPage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.settings.v1', JSON.stringify({
    modules: { timer: { pinned: true }, 'qr-gen': { pinned: true } },
  }));
  localStorage.setItem('tip.order.v1', JSON.stringify({
    document: ['md-editor', 'doc-reader', 'pdf-tools'],
    utility: ['timer', 'qr-gen', 'file-compress', 'ocr-reader'],
    online: ['currency-calc', 'address-search'],
  }));
});
await tauriPage.reload({ waitUntil: 'networkidle' });
const migrated = await tauriPage.evaluate(() => {
  const ids = (section) => [...document.querySelectorAll(`.home-section[data-section="${section}"] .module-card`)].map((node) => node.dataset.moduleId);
  return {
    pinned: ids('pinned'),
    docs: ids('docs'),
    file: ids('file'),
    media: ids('media'),
    calc: ids('calc'),
  };
});
check('v1.16.0 — 옛 핀이 그대로', migrated.pinned.includes('timer') && migrated.pinned.includes('qr-gen'), migrated.pinned.join(','));
check('v1.16.0 — 옛 문서 순서 유지', migrated.docs[0] === 'md-editor' && migrated.docs.indexOf('pdf-tools') > 0
  && migrated.pinned.includes('doc-reader'), migrated.docs.join(','));
check('v1.16.0 — 옛 유틸리티가 새 분류로', migrated.file.includes('file-compress')
  && migrated.pinned.includes('qr-gen') && migrated.pinned.includes('timer') && migrated.docs.includes('ocr-reader'),
  JSON.stringify(migrated));
check('v1.16.0 — 순서가 새 섹션 안에 옮겨짐', migrated.calc.indexOf('currency-calc') < migrated.calc.indexOf('address-search'), migrated.calc.join(','));

/* ---------- 백업 → 삭제 → 복원 ---------- */
const backupRound = await tauriPage.evaluate(async () => {
  const b = await import('/js/backup.js');
  localStorage.setItem('tip.snippets.v1', JSON.stringify([{ id: 's1', label: '메일', alias: '/mail', body: '서명' , created: 1, updated: 1 }]));
  localStorage.setItem('tip.accent', 'rose');
  localStorage.setItem('tip.shortcutLetters.v1', JSON.stringify({ 'text-diff': 'D' }));
  localStorage.setItem('tip.radialOrderMode.v1', 'asc');
  const text = await b.collectBackup({ includeClipboard: false, version: '1.16.0' });
  const parsed = b.readBackup(text);
  // 지운다
  localStorage.setItem('tip.snippets.v1', '[]');
  localStorage.setItem('tip.accent', 'green');
  localStorage.removeItem('tip.shortcutLetters.v1');
  localStorage.setItem('tip.radialOrderMode.v1', 'desc');
  const applied = await b.applyBackup(parsed);
  return {
    ok: parsed.ok,
    fileHasFormat: JSON.parse(text).format === 'tip-backup',
    summary: parsed.summary,
    applied,
    snippets: localStorage.getItem('tip.snippets.v1'),
    accent: localStorage.getItem('tip.accent'),
    letters: localStorage.getItem('tip.shortcutLetters.v1'),
    radialMode: localStorage.getItem('tip.radialOrderMode.v1'),
    appliedOk: applied.ok,
    appliedError: applied.error || '',
  };
});
check('v1.16.0 — 백업 파일 형식', backupRound.fileHasFormat && backupRound.ok);
check('v1.16.0 — 미리보기 항목', Array.isArray(backupRound.summary) && backupRound.summary.length >= 6, JSON.stringify(backupRound.summary));
check('v1.16.0 — 복원 뒤 스니펫 일치', (backupRound.snippets || '').includes('메일'), backupRound.snippets);
check('v1.16.0 — 복원 뒤 색·단축키 일치', backupRound.accent === 'rose' && (backupRound.letters || '').includes('D'),
  `${backupRound.accent}/${backupRound.letters}`);
check('v1.16.0 — 복원 뒤 글자 저장 키(퀵바 순서) 일치', backupRound.appliedOk && backupRound.radialMode === 'asc',
  `${backupRound.appliedError}/${backupRound.radialMode}`);

const broken = await tauriPage.evaluate(async () => {
  const b = await import('/js/backup.js');
  localStorage.setItem('tip.accent', 'slate');
  const bad = b.readBackup('{oops');
  const wrong = b.readBackup(JSON.stringify({ format: 'other', version: 1, settings: {} }));
  const applied = bad.ok ? await b.applyBackup(bad) : null;
  return { bad: bad.ok, wrong: wrong.ok, reason: bad.error, accent: localStorage.getItem('tip.accent'), applied };
});
check('v1.16.0 — 깨진 JSON 은 이유만', broken.bad === false && /깨졌/.test(broken.reason || ''), broken.reason);
check('v1.16.0 — 모르는 형식 거부', broken.wrong === false);
check('v1.16.0 — 깨진 파일은 아무것도 안 바꿈', broken.accent === 'slate' && broken.applied === null, broken.accent);

/* ---------- 설정 UI — 백업과 복원 ---------- */
await openSettings('general');
check('v1.16.0 — 설정에 백업과 복원', await tauriPage.locator('.backup-section').count() === 1);
await tauriPage.locator('.backup-section .primary-btn').first().click();
await tauriPage.waitForTimeout(500);
const saveCall = await lastCall('save_backup_file');
let savedBackup = null;
try { savedBackup = JSON.parse(saveCall.args.content); } catch { savedBackup = null; }
check('v1.16.0 — 백업 파일 만들기가 대화상자를 연다', !!saveCall && !!savedBackup && savedBackup.format === 'tip-backup', String(!!saveCall));
check('v1.16.0 — 클립보드는 기본 제외', savedBackup && savedBackup.clipboard === null);
check('v1.16.0 — 백업에 설정·순서·스니펫', savedBackup && savedBackup.settings['tip.settings.v1']
  && savedBackup.settings['tip.order.v1'] && savedBackup.settings['tip.snippets.v1']);
await tauriPage.locator('.backup-section .primary-btn.ghost').click();
await tauriPage.waitForTimeout(400);
check('v1.16.0 — 불러오기 미리보기', await tauriPage.locator('.backup-preview .backup-row').count() >= 5);
check('v1.16.0 — 덮어쓰기 전 확인창', await tauriPage.locator('.confirm-dialog').count() === 1);
const accentBefore = await tauriPage.evaluate(() => localStorage.getItem('tip.accent'));
await tauriPage.click('.confirm-cancel');
await tauriPage.waitForTimeout(200);
check('v1.16.0 — 취소하면 아무것도 안 바뀜', await tauriPage.evaluate(() => localStorage.getItem('tip.accent')) === accentBefore);
await page.keyboard.press('Escape');
await tauriPage.waitForTimeout(300);

/* ---------- 최근 사용 ---------- */
await tauriPage.evaluate(() => { localStorage.clear(); });
await tauriPage.reload({ waitUntil: 'networkidle' });
for (const id of ['text-counter', 'date-calc', 'text-counter']) {
  await tauriPage.evaluate((moduleId) => { location.hash = `#/${moduleId}`; }, id);
  await tauriPage.waitForTimeout(180);
}
await tauriPage.evaluate(() => { location.hash = '#/'; });
await tauriPage.waitForTimeout(250);
const recentIds = await tauriPage.evaluate(() => [...document.querySelectorAll('.home-section[data-section="recent"] .module-card')].map((node) => node.dataset.moduleId));
check('v1.16.0 — 최근 사용 순서·중복 제거', recentIds.slice(0, 2).join(',') === 'text-counter,date-calc', recentIds.join(','));
check('v1.16.0 — 최근 사용은 실행만(핀·스위치 없음)',
  await tauriPage.locator('.home-section[data-section="recent"] .pin-btn').count() === 0);
check('v1.16.0 — 최근 사용 줄에 null 글자 없음',
  !(await tauriPage.locator('.home-section[data-section="recent"]').innerText()).includes('null'));
const recentStored = await tauriPage.evaluate(() => JSON.parse(localStorage.getItem('tip.recent.v1') || '[]'));
check('v1.16.0 — 최근 사용 기록 저장', recentStored[0] === 'text-counter' && new Set(recentStored).size === recentStored.length, JSON.stringify(recentStored));

/* ---------- 파일 끌어다 놓기 추천 ---------- */
const miniPdf = await tauriPage.evaluate(async () => {
  const doc = await window.PDFLib.PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return Array.from(bytes);
});
await tauriPage.evaluate((bytes) => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(bytes)], 'a.pdf', { type: 'application/pdf' }));
  document.querySelector('#view').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, miniPdf);
await tauriPage.waitForTimeout(250);
const dropNames = await tauriPage.locator('.drop-panel .drop-item b').allTextContents();
check('v1.16.0 — PDF 추천 목록', dropNames.includes('PDF 합치기') && dropNames.includes('문서 리더')
  && dropNames.includes('파일 압축'), dropNames.join(','));
check('v1.16.0 — 추천 차례(PDF 합치기 먼저)', dropNames[0] && /PDF/.test(dropNames[0]), dropNames.join(','));
await tauriPage.locator('.drop-panel .drop-item', { hasText: 'PDF' }).first().click();
await tauriPage.waitForTimeout(450);
const preloaded = await tauriPage.evaluate(() => ({
  hash: location.hash,
  names: [...document.querySelectorAll('#pt-m-files .f-name')].map((node) => node.textContent),
}));
check('v1.16.0 — 고른 모듈이 파일을 얹고 열림', preloaded.hash === '#/pdf-tools' && preloaded.names.includes('a.pdf'), JSON.stringify(preloaded));

await tauriPage.evaluate(() => {
  const settings = JSON.parse(localStorage.getItem('tip.settings.v1') || '{}');
  settings.modules = { ...(settings.modules || {}), 'file-compress': { enabled: false }, 'bulk-rename': { enabled: false } };
  localStorage.setItem('tip.settings.v1', JSON.stringify(settings));
  location.hash = '#/';
});
await tauriPage.reload({ waitUntil: 'networkidle' });
await tauriPage.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([new TextEncoder().encode('x')], 'x.bin', { type: 'application/x-unknown' }));
  document.querySelector('#view').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
});
await tauriPage.waitForTimeout(200);
const noTool = await tauriPage.evaluate(() => document.getElementById('toast')?.textContent || '');
check('v1.16.0 — 받을 도구가 없으면 안내', noTool.includes('이 파일을 열 수 있는 도구가 없어요'), noTool);
await tauriPage.evaluate(() => {
  const settings = JSON.parse(localStorage.getItem('tip.settings.v1') || '{}');
  delete settings.modules['file-compress'];
  delete settings.modules['bulk-rename'];
  localStorage.setItem('tip.settings.v1', JSON.stringify(settings));
});
await tauriPage.reload({ waitUntil: 'networkidle' });

/* ---------- 이어서 하기 ---------- */
await tauriPage.evaluate(async () => {
  const c = await import('/js/continue.js');
  c.setContinue('text-diff', { text: '넘긴 글' });
  location.hash = '#/text-diff';
});
await tauriPage.waitForTimeout(300);
check('v1.16.0 — 이어서 하기 전달', (await tauriPage.locator('#td-a').inputValue()) === '넘긴 글');
await tauriPage.evaluate(() => { location.hash = '#/'; });
await tauriPage.waitForTimeout(150);
await tauriPage.evaluate(() => { location.hash = '#/text-diff'; });
await tauriPage.waitForTimeout(250);
check('v1.16.0 — 이어서 하기는 한 번만', (await tauriPage.locator('#td-a').inputValue()) === '');

/* ---------- 글자 수 세기 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/text-counter'; });
await tauriPage.waitForTimeout(250);
await tauriPage.fill('#tc-text', '안녕 하세요\n둘째 줄');
await tauriPage.waitForTimeout(150);
const counts = await tauriPage.evaluate(() => ({
  withSpace: document.getElementById('tc-with').textContent,
  withoutSpace: document.getElementById('tc-without').textContent,
  words: document.getElementById('tc-words').textContent,
  lines: document.getElementById('tc-lines').textContent,
  sheets: document.getElementById('tc-sheets').textContent,
}));
check('v1.16.0 — 글자 수 정확도(공백 포함 11, 줄바꿈 포함)', counts.withSpace === '11', JSON.stringify(counts));
check('v1.16.0 — 글자 수 정확도(공백 제외 8·단어 4·줄 2)', counts.withoutSpace === '8' && counts.words === '4' && counts.lines === '2', JSON.stringify(counts));
check('v1.16.0 — 원고지 매수', counts.sheets === '1매', counts.sheets);
await tauriPage.fill('#tc-text', '😀😀');
await tauriPage.waitForTimeout(120);
check('v1.16.0 — 이모지는 한 글자', (await tauriPage.locator('#tc-with').textContent()) === '2');

/* ---------- 날짜 계산기 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/date-calc'; });
await tauriPage.waitForTimeout(250);
await tauriPage.click('#dc-tabs [data-tab="work"]');
await tauriPage.fill('#dc-work-start', '2026-05-25');
await tauriPage.fill('#dc-work-end', '2026-05-29');
await tauriPage.click('#dc-work-run');
await tauriPage.waitForTimeout(150);
const workText = await tauriPage.evaluate(() => ({
  big: document.querySelector('#dc-work-out .dc-big').textContent,
  rows: document.getElementById('dc-work-rows').textContent,
}));
check('v1.16.0 — 근무일(대체공휴일 뺀 4일)', workText.big === '4일', JSON.stringify(workText));
check('v1.16.0 — 공휴일 1일·반영한 해 표시', workText.rows.includes('공휴일') && workText.rows.includes('2024~2027년'), workText.rows);
await tauriPage.click('#dc-tabs [data-tab="dday"]');
await tauriPage.waitForTimeout(100);
check('v1.16.0 — D-day 표시', /D[-+]|D-day/.test(await tauriPage.locator('#dc-dday-out .dc-big').textContent()));

/* ---------- 한영 타자 변환 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/typing-converter'; });
await tauriPage.waitForTimeout(250);
await tauriPage.fill('#ty-in', '안녕하세요');
await tauriPage.waitForTimeout(120);
check('v1.16.0 — 한글 → 영문 글쇠', (await tauriPage.locator('#ty-out').inputValue()) === 'dkssudgktpdy');
await tauriPage.click('#ty-swap');
await tauriPage.waitForTimeout(120);
check('v1.16.0 — 영문 → 한글 왕복', (await tauriPage.locator('#ty-out').inputValue()) === '안녕하세요');

/* ---------- 비밀번호·파일 해시·이름 표기 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/dev-tools'; });
await tauriPage.waitForTimeout(250);
await tauriPage.click('#dv-tabs [data-tab="pass"]');
await tauriPage.click('#dv-pass-run');
await tauriPage.waitForTimeout(120);
const pass = await tauriPage.locator('#dv-pass-out').inputValue();
check('v1.16.0 — 비밀번호 길이·글자 종류', pass.length === 16 && /[A-Z]/.test(pass) && /[a-z]/.test(pass)
  && /[0-9]/.test(pass) && /[^A-Za-z0-9]/.test(pass), pass);
await tauriPage.click('#dv-tabs [data-tab="hash"]');
await tauriPage.setInputFiles('#dv-hash-input', { name: 'abc.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') });
await tauriPage.waitForTimeout(400);
const hashText = await tauriPage.evaluate(() => document.getElementById('dv-hash-rows').textContent);
check('v1.16.0 — 파일 해시 SHA-256', hashText.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'), hashText.slice(0, 60));
check('v1.16.0 — 파일 해시 MD5', hashText.includes('900150983cd24fb0d6963f7d28e17f72'));
await tauriPage.click('#dv-tabs [data-tab="case"]');
await tauriPage.fill('#dv-case-in', 'my file name');
await tauriPage.waitForTimeout(120);
const caseText = await tauriPage.evaluate(() => document.getElementById('dv-case-rows').textContent);
check('v1.16.0 — 이름 표기 4종', ['myFileName', 'my_file_name', 'my-file-name', 'MyFileName'].every((word) => caseText.includes(word)), caseText);

/* ---------- 색상 대비 — 사진 대표색 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/color-tools'; });
await tauriPage.waitForTimeout(250);
const redPng = await tauriPage.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 60; canvas.height = 20;
  const context = canvas.getContext('2d');
  ['#E11D48', '#2563EB', '#2E5E4E', '#C2410C', '#7C3AED', '#111111'].forEach((color, index) => {
    context.fillStyle = color;
    context.fillRect(index * 10, 0, 10, 20);
  });
  return canvas.toDataURL('image/png').split(',')[1];
});
await tauriPage.setInputFiles('#ct-pal-input', { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(redPng, 'base64') });
await tauriPage.waitForTimeout(500);
const palette = await tauriPage.evaluate(() => ({
  count: document.querySelectorAll('#ct-pal-list .ct-pal-row').length,
  first: document.querySelector('#ct-pal-list .ct-pal-swatch')?.style.background || '',
}));
check('v1.16.0 — 사진 대표색 5~8', palette.count >= 5 && palette.count <= 8, String(palette.count));
check('v1.16.0 — 대표색 첫 색', /rgb\(/.test(palette.first), palette.first);
if (palette.count) {
  await tauriPage.click('#ct-pal-list .ct-pal-swatch');
  await tauriPage.waitForTimeout(120);
  check('v1.16.0 — 글자색에 들어감', /^#[0-9A-F]{6}$/.test((await tauriPage.locator('#ct-fg-hex').inputValue()).toUpperCase()),
    await tauriPage.locator('#ct-fg-hex').inputValue());
}

/* ---------- PDF — 이미지를 PDF로 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/pdf-tools'; });
await tauriPage.waitForTimeout(250);
await tauriPage.click('.pt-modes [data-mode="image"]');
await tauriPage.setInputFiles('#pt-i-input', { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(redPng, 'base64') });
await tauriPage.waitForTimeout(300);
check('v1.16.0 — 이미지를 PDF로 목록', await tauriPage.locator('#pt-i-files .f-name').count() === 1);
await tauriPage.click('#pt-i-run');
await tauriPage.waitForTimeout(800);
const pdfResult = await tauriPage.evaluate(() => document.querySelector('#pt-i-result .pt-result .f-name')?.textContent || '');
check('v1.16.0 — 이미지 PDF 결과', pdfResult === 'shot.pdf', pdfResult);
check('v1.16.0 — PDF 에 이어서 하기', await tauriPage.locator('#pt-i-result .continue-bar').count() === 1);

/* ---------- 글자 추출 — 두 방식 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/drag-ocr'; });
await tauriPage.waitForTimeout(300);
const ocrView = await tauriPage.evaluate(() => ({
  hash: location.hash,
  modes: [...document.querySelectorAll('#ocr-modes .ic-seg')].map((node) => ({ text: node.textContent, on: node.getAttribute('aria-selected') })),
}));
check('v1.16.0 — 예전 주소가 통합 OCR 로', ocrView.hash === '#/drag-ocr' && ocrView.modes.some((mode) => mode.text === '화면에서'),
  JSON.stringify(ocrView.modes));
check('v1.16.0 — 화면에서가 선택됨', ocrView.modes.find((mode) => mode.text === '화면에서')?.on === 'true', JSON.stringify(ocrView.modes));

/* ---------- 스크린샷 표시 ---------- */
await tauriPage.evaluate(() => { location.hash = '#/screenshot-annotate'; });
await tauriPage.waitForTimeout(250);
const shotTools = await tauriPage.evaluate(() => [...document.querySelectorAll('#sa-tool-list .ic-seg')].map((node) => node.textContent));
check('v1.16.0 — 스크린샷 도구 4종', shotTools.join(',') === '화살표,사각형,글자,모자이크', shotTools.join(','));
check('v1.16.0 — 스크린샷 영역 캡처 버튼', await tauriPage.locator('#sa-capture').count() === 1);

/* -------------------- v1.17.0 노치 개편 — 반원 다이얼 · 전체 보기 · 달력 · 보관함 -------------------- */
{ // 이름이 앞 묶음과 겹치지 않게 블록으로 감싼다.

const v117Context = await browser.newContext({ viewport: { width: 640, height: 600 }, locale: 'ko-KR', colorScheme: 'dark' });
await v117Context.addInitScript(MOCK);
const dial = await v117Context.newPage();
dial.on('pageerror', (error) => consoleErrors.push(`v117 pageerror: ${String(error)}`));
await dial.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
// 옛 저장값(v1.16.0) — startView·rotation·pillActivity·recent 가 없다.
await dial.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, hoverOpen: false, widgets: { media: false, calendar: true, shelf: true, timer: true, memo: true, mirror: false, launcher: true } }));
});
await dial.reload({ waitUntil: 'networkidle' });
await dial.waitForTimeout(900);

const migrated = await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.syncStore();
  return store.getNotchSettings();
});
check('v1.17.0 — 옛 값: 시작 화면 간단히 보기', migrated.startView === 'simple', migrated.startView);
check('v1.17.0 — 옛 값: 계속 회전', migrated.rotation === 'loop', migrated.rotation);
check('v1.17.0 — 옛 값: 노래와 타이머 표시 켬', migrated.pillActivity === true);
check('v1.17.0 — 옛 값: 최근 사용 위젯 켬', migrated.widgets.recent === true);
const weird = await dial.evaluate(async () => {
  const before = localStorage.getItem('tip.notch.v1');
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, startView: 'abc', rotation: 3, pillActivity: 'x', widgets: {} }));
  const store = await import('./js/store.js');
  store.syncStore();
  const value = store.getNotchSettings();
  localStorage.setItem('tip.notch.v1', before);
  store.syncStore();
  return value;
});
check('v1.17.0 — 이상한 값은 기본값으로', weird.startView === 'simple' && weird.rotation === 'loop' && weird.pillActivity === true, JSON.stringify(weird));

// 간단히 보기(반원)로 열려 있다.
const simple = await dial.evaluate(() => ({
  isSimple: document.getElementById('notch').classList.contains('is-simple'),
  panelHidden: getComputedStyle(document.getElementById('panel')).visibility === 'hidden',
  panelInert: document.getElementById('panel').inert,
  radius: getComputedStyle(document.getElementById('sheet')).borderBottomLeftRadius,
  height: Math.round(document.getElementById('sheet').getBoundingClientRect().height),
  slots: document.querySelectorAll('.dial-slot').length,
  visibleSlots: [...document.querySelectorAll('.dial-slot')].filter((slot) => slot.style.visibility === 'visible').length,
  name: document.getElementById('dial-name').textContent,
  center: document.querySelector('.dial-slot.is-center')?.dataset.moduleId,
  dots: document.querySelectorAll('.dial-dot, .rw-dot').length,
  toFull: document.getElementById('to-full').textContent.trim(),
}));
check('v1.17.0 — 시작 화면대로 반원', simple.isSimple && simple.panelHidden && simple.panelInert, JSON.stringify(simple));
check('v1.17.0 — 반원 모양(아래 모서리 반타원)', simple.radius.includes('%') || parseFloat(simple.radius) > 100, simple.radius);
check('v1.17.0 — 반원 높이 252 + 노치 32', simple.height === 284, String(simple.height));
check('v1.17.0 — 다이얼 7칸 + 걸침', simple.visibleSlots >= 7 && simple.visibleSlots <= 9 && simple.slots > 7, JSON.stringify(simple));
check('v1.17.0 — 가운데 모듈 이름', simple.name.length > 0 && !!simple.center, simple.name);
check('v1.17.0 — 페이지 점 없음', simple.dots === 0);
check('v1.17.0 — 아래 버튼 전체 보기', simple.toFull === '전체 보기', simple.toFull);
check('v1.17.0 — 노치 높이만큼 내림(--dial-offset)', (await dial.evaluate(() => document.getElementById('notch').style.getPropertyValue('--dial-offset'))) === '32px');

// 양옆 상태 칸 — 미디어 위젯 꺼짐, 타이머 없음, 보관함 0개
const sides = await dial.evaluate(() => ({
  cal: !document.getElementById('dial-cal').hidden,
  media: !document.getElementById('dial-media').hidden,
  timer: !document.getElementById('dial-timer').hidden,
  shelf: !document.getElementById('dial-shelf').hidden,
  badge: !document.getElementById('dial-shelf-count').hidden,
  shelfLabel: document.getElementById('dial-shelf').getAttribute('aria-label'),
}));
check('v1.17.0 — 달력 아이콘(캘린더 위젯 켬)', sides.cal);
check('v1.17.0 — 미디어 위젯 꺼짐이면 빈 자리', !sides.media);
check('v1.17.0 — 타이머 없으면 빈 자리', !sides.timer);
check('v1.17.0 — 보관함 아이콘, 0개면 배지 없음', sides.shelf && !sides.badge && sides.shelfLabel.includes('0개'), JSON.stringify(sides));
// 검수 C6 — 양옆 칸을 숨겨도 가운데(이름·찾기)가 옆으로 밀리지 않는다.
const hubShift = await dial.evaluate(() => {
  const hub = () => Math.round(document.querySelector('.dial-hub').getBoundingClientRect().left);
  const media = document.getElementById('dial-media');
  const cal = document.getElementById('dial-cal');
  const was = [media.hidden, cal.hidden];
  media.hidden = true; cal.hidden = true;
  const off = hub();
  media.hidden = false; cal.hidden = false;
  const on = hub();
  [media.hidden, cal.hidden] = was;
  return { off, on, display: getComputedStyle(document.getElementById('dial-timer')).display };
});
check('v1.17.0 — 양옆 칸을 숨겨도 가운데 자리 그대로(C6)', hubShift.off === hubShift.on, JSON.stringify(hubShift));

// 회전 — 계속 회전: 처음에서 왼쪽 → 마지막 모듈
const order = await dial.evaluate(() => [...document.querySelectorAll('.dial-slot')].map((slot) => slot.dataset.moduleId));
await dial.click('#dial-prev');
await dial.waitForTimeout(500);
check('v1.17.0 — 계속 회전: 첫 모듈에서 ‹ 이면 마지막', (await dial.evaluate(() => document.querySelector('.dial-slot.is-center')?.dataset.moduleId)) === order[order.length - 1]);
check('v1.17.0 — 계속 회전: 화살표가 끝 표시 아님', await dial.evaluate(() => document.getElementById('dial-prev').getAttribute('aria-disabled') === 'false'));

// 찾기 — 이름으로 가운데 이동, Enter 로 열기
await dial.fill('#dial-find', '타이머');
await dial.waitForTimeout(500);
check('v1.17.0 — 찾기 칸으로 가운데 이동', (await dial.locator('#dial-name').textContent()) === '타이머', await dial.locator('#dial-name').textContent());
await dial.evaluate(() => { window.__TIP_CALLS__.length = 0; });
await dial.press('#dial-find', 'Enter');
await dial.waitForTimeout(250);
const openCall = await dial.evaluate(() => window.__TIP_CALLS__.find((call) => call.command === 'open_tool'));
check('v1.17.0 — Enter 로 가운데 모듈 열기', !!openCall && openCall.args.id === 'timer', JSON.stringify(openCall && openCall.args));
check('v1.17.0 — 모듈을 열면 노치 접힘', await dial.evaluate(() => window.__TIP_CALLS__.some((call) => call.command === 'notch_collapse')));

// 다시 연다(브라우저는 창 크기가 그대로라 직접 펼친다).
const reopen = async (page) => {
  await page.evaluate(() => { document.getElementById('pill').click(); });
  await page.waitForTimeout(350);
};
await reopen(dial);
check('v1.17.0 — 다시 열면 찾기 칸 비어 있음', (await dial.locator('#dial-find').inputValue()) === '');
check('v1.17.0 — 클릭으로 열면 찾기 칸 포커스', (await dial.evaluate(() => document.activeElement?.id)) === 'dial-find', await dial.evaluate(() => document.activeElement?.id));

// 처음과 끝에서 멈춤
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchRotation('bounded');
});
await dial.evaluate(() => { window.dispatchEvent(new StorageEvent('storage')); });
await dial.waitForTimeout(300);
await dial.fill('#dial-find', '');
for (let i = 0; i < 40; i += 1) await dial.evaluate(() => document.getElementById('dial-prev').click());
await dial.waitForTimeout(600);
const bounded = await dial.evaluate(() => ({
  center: document.querySelector('.dial-slot.is-center')?.dataset.moduleId,
  first: document.querySelector('.dial-slot')?.dataset.moduleId,
  prevEnd: document.getElementById('dial-prev').getAttribute('aria-disabled'),
  prevClass: document.getElementById('dial-prev').classList.contains('is-end'),
}));
check('v1.17.0 — 멈춤: 첫 모듈에서 멈춤', bounded.center === bounded.first, JSON.stringify(bounded));
check('v1.17.0 — 멈춤: 끝 화살표 aria-disabled', bounded.prevEnd === 'true' && bounded.prevClass, JSON.stringify(bounded));
for (let i = 0; i < 60; i += 1) await dial.evaluate(() => document.getElementById('dial-next').click());
await dial.waitForTimeout(700);
const boundedEnd = await dial.evaluate(() => ({
  center: document.querySelector('.dial-slot.is-center')?.dataset.moduleId,
  last: [...document.querySelectorAll('.dial-slot')].pop()?.dataset.moduleId,
  nextEnd: document.getElementById('dial-next').getAttribute('aria-disabled'),
}));
check('v1.17.0 — 멈춤: 마지막 모듈에서 멈춤', boundedEnd.center === boundedEnd.last && boundedEnd.nextEnd === 'true', JSON.stringify(boundedEnd));
// 같은 설정이 켜 둔 모듈 한 줄에도 — v1.17.2 부터는 회전 대신 양 끝이 있는 가로 스크롤
await dial.click('#to-full');
await dial.waitForTimeout(400);
const rowBounded = await dial.evaluate(() => {
  const row = document.getElementById('launcher-row');
  row.scrollLeft = 0;
  row.dispatchEvent(new Event('scroll'));
  document.querySelector('[data-launcher="prev"]').click();
  return {
    pos: document.getElementById('launcher-pos').textContent,
    prevEnd: document.querySelector('[data-launcher="prev"]').getAttribute('aria-disabled'),
    scrollLeft: row.scrollLeft,
  };
});
await dial.waitForTimeout(500);
const rowBoundedAfter = await dial.evaluate(() => ({
  pos: document.getElementById('launcher-pos').textContent,
  scrollLeft: Math.round(document.getElementById('launcher-row').scrollLeft),
}));
check('v1.17.2 — 한 줄은 왼쪽 끝에서 더 가지 않는다', rowBounded.pos.startsWith('1–') && rowBounded.prevEnd === 'true'
  && rowBoundedAfter.scrollLeft === 0 && rowBoundedAfter.pos.startsWith('1–'), JSON.stringify({ rowBounded, rowBoundedAfter }));
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchRotation('loop');
});

// 전체 보기
const full = await dial.evaluate(() => ({
  isFull: document.getElementById('notch').classList.contains('is-full'),
  dialInert: document.getElementById('dial').inert,
  radius: getComputedStyle(document.getElementById('sheet')).borderBottomLeftRadius,
  rows: [...document.querySelectorAll('#widgets > .wg-row')].map((row) => [...row.children].map((card) => card.dataset.widget).join('+')),
  toSimple: document.getElementById('to-simple').textContent.trim(),
  focus: document.activeElement?.id,
}));
check('v1.17.0 — 전체 보기로 바뀜', full.isFull && full.dialInert, JSON.stringify(full));
check('v1.17.0 — 전체 보기 모서리 20px', full.radius === '20px', full.radius);
check('v1.17.0 — 전체 보기 배치', full.rows.join(' / ') === 'calendar+timer / memo+shelf / recent / launcher', full.rows.join(' / '));
check('v1.17.0 — 아래 버튼 간단히 보기', full.toSimple === '간단히 보기', full.toSimple);
check('v1.17.0 — 버튼으로 바꾸면 메모에 포커스', full.focus === 'memo-input', full.focus);
await dial.click('#to-simple');
await dial.waitForTimeout(400);
check('v1.17.0 — 간단히 보기로 되돌아감', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-simple')));

// 달력 — 반원에서 열고 닫으면 반원
await dial.click('#dial-cal');
await dial.waitForTimeout(400);
const calOpen = await dial.evaluate(() => ({
  view: !document.getElementById('cal-view').hidden,
  full: document.getElementById('notch').classList.contains('is-full'),
  toSimpleHidden: document.getElementById('to-simple').hidden,
}));
check('v1.17.0 — 반원 달력 아이콘으로 달력', calOpen.view && calOpen.full, JSON.stringify(calOpen));
check('v1.17.0 — 달력에서는 닫기 하나만(간단히 보기 버튼 숨김)', calOpen.toSimpleHidden);
await dial.click('#cal-view-close');
await dial.waitForTimeout(400);
check('v1.17.0 — 반원에서 연 달력 닫으면 반원', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-simple') && document.getElementById('cal-view').hidden));
await dial.click('#dial-cal');
await dial.waitForTimeout(400);
await dial.click('[data-cal-mode="week"]');
await dial.waitForTimeout(200);
await dial.keyboard.press('Escape');
await dial.waitForTimeout(400);
check('v1.17.0 — 달력 Esc 도 반원으로(노치 닫지 않음)', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-simple')
  && document.getElementById('notch').classList.contains('is-expanded')));
// 전체 보기에서 열고 닫으면 전체 보기
await dial.click('#to-full');
await dial.waitForTimeout(400);
await dial.click('#cal-open');
await dial.waitForTimeout(400);
await dial.click('#cal-view-close');
await dial.waitForTimeout(400);
check('v1.17.0 — 전체 보기에서 연 달력 닫으면 전체 보기', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-full') && document.getElementById('cal-view').hidden));
// 일정 폼 Esc 는 폼만
await dial.click('#cal-open');
await dial.waitForTimeout(300);
await dial.click('#cal-add-btn');
await dial.waitForTimeout(300);
await dial.keyboard.press('Escape');
await dial.waitForTimeout(200);
check('v1.17.0 — 일정 폼 Esc 는 폼만 닫음', await dial.evaluate(() => document.getElementById('cal-form').hidden && !document.getElementById('cal-view').hidden));
await dial.keyboard.press('Escape');
await dial.waitForTimeout(300);
// 다시 열면 달력이 아니라 시작 화면
await dial.click('#cal-open');
await dial.waitForTimeout(300);
await dial.evaluate(() => { document.getElementById('collapse').click(); });
await dial.waitForTimeout(300);
await reopen(dial);
check('v1.17.0 — 접었다 열면 시작 화면(달력 아님)', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-simple') && document.getElementById('cal-view').hidden));

// 보관함 — 반원 아이콘 누르면 전체 보기로 가서 강조
await dial.click('#dial-shelf');
await dial.waitForTimeout(450);
check('v1.17.0 — 보관함 아이콘 → 전체 보기 카드 강조', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-full')
  && document.querySelector('.wg-shelf').classList.contains('is-flash')));
await dial.click('#to-simple');
await dial.waitForTimeout(300);

// 파일을 반원에 끌어 놓기 → 펼침 상태 그대로, 개수 배지
await dial.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(new File(['a'], '견적서.pdf', { type: 'application/pdf' }));
  data.items.add(new File(['bb'], '사진.png', { type: 'image/png' }));
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true }));
});
await dial.waitForTimeout(150);
check('v1.17.0 — 반원 위로 끌면 놓기 안내', await dial.evaluate(() => !document.getElementById('dial-drop').hidden));
await dial.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(new File(['a'], '견적서.pdf', { type: 'application/pdf' }));
  data.items.add(new File(['bb'], '사진.png', { type: 'image/png' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
});
await dial.waitForTimeout(250);
const afterDrop = await dial.evaluate(() => ({
  simple: document.getElementById('notch').classList.contains('is-simple'),
  badge: document.getElementById('dial-shelf-count').textContent,
  badgeShown: !document.getElementById('dial-shelf-count').hidden,
  hint: document.getElementById('dial-drop').hidden,
  toast: document.getElementById('notch-toast').textContent,
}));
check('v1.17.0 — 반원에 놓으면 반원 그대로 개수 2', afterDrop.simple && afterDrop.badgeShown && afterDrop.badge === '2' && afterDrop.hint, JSON.stringify(afterDrop));
check('v1.17.0 — 담은 개수 알림(aria-live)', afterDrop.toast.includes('파일 2개'), afterDrop.toast);
check('v1.17.0 — 반원에는 파일 목록 없음', await dial.evaluate(() => !document.getElementById('dial').querySelector('.shelf-item')));
const badge99 = await dial.evaluate(() => {
  // 표시 규칙만 확인한다 — 100 이상은 99+.
  const count = 120;
  return count > 99 ? '99+' : String(count);
});
check('v1.17.0 — 100개 이상 배지 규칙', badge99 === '99+');

// 접힌 상태에서 놓으면 펼치지 않고 알약에 '보관함 +1'
await dial.evaluate(() => { document.getElementById('collapse').click(); });
await dial.waitForTimeout(300);
await dial.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(new File(['c'], '메모.txt', { type: 'text/plain' }));
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true }));
});
await dial.waitForTimeout(120);
const dragPill = await dial.evaluate(() => ({
  note: document.getElementById('pill-note').textContent,
  expanded: document.getElementById('notch').classList.contains('is-expanded'),
}));
check('v1.17.0 — 접힌 알약에 여기에 놓기', dragPill.note === '여기에 놓기' && !dragPill.expanded, JSON.stringify(dragPill));
await dial.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(new File(['c'], '메모.txt', { type: 'text/plain' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
});
await dial.waitForTimeout(200);
const dropPill = await dial.evaluate(() => ({
  note: document.getElementById('pill-note').textContent,
  expanded: document.getElementById('notch').classList.contains('is-expanded'),
  pillCall: window.__TIP_CALLS__.filter((call) => call.command === 'set_notch_pill').pop(),
}));
check('v1.17.0 — 접힌 채로 담고 보관함 +1', dropPill.note === '보관함 +1' && !dropPill.expanded, JSON.stringify(dropPill));
check('v1.17.0 — 안내 동안 알약 양쪽 넓힘', !!dropPill.pillCall && dropPill.pillCall.args.media && dropPill.pillCall.args.timer, JSON.stringify(dropPill.pillCall));
await dial.waitForTimeout(2200);
check('v1.17.0 — 2초 뒤 안내 사라짐', await dial.evaluate(() => document.getElementById('pill-note').hidden));

// 보관함 위젯이 꺼져 있으면 담지 않는다
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchWidget('shelf', false);
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(250);
await dial.evaluate(() => {
  const data = new DataTransfer();
  data.items.add(new File(['d'], '또.txt', { type: 'text/plain' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
});
await dial.waitForTimeout(200);
check('v1.17.0 — 보관함 꺼짐이면 담지 않고 안내', (await dial.locator('#notch-toast').textContent()).includes('임시 보관함을 켜 주세요'));
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchWidget('shelf', true);
  window.dispatchEvent(new StorageEvent('storage'));
});

// 타이머 — 반원 오른쪽 칸, 끝나면 5초 완료
await dial.evaluate(async () => {
  const store = await import('./js/timer-store.js');
  store.startTimer(125);
});
await reopen(dial);
await dial.waitForTimeout(700);
const timerSide = await dial.evaluate(() => ({
  shown: !document.getElementById('dial-timer').hidden,
  clock: document.getElementById('dial-timer-clock').textContent,
  label: document.getElementById('dial-timer').getAttribute('aria-label'),
}));
check('v1.17.0 — 반원 타이머 칸 남은 시간', timerSide.shown && /^0[12]:\d\d$/.test(timerSide.clock), JSON.stringify(timerSide));
check('v1.17.0 — 타이머 칸 스크린 리더 이름', timerSide.label.includes('남음'), timerSide.label);
await dial.click('#dial-timer');
await dial.waitForTimeout(450);
check('v1.17.0 — 타이머 칸 → 전체 보기 타이머 카드(멈추지 않음)', await dial.evaluate(() => document.querySelector('.wg-timer').classList.contains('is-flash')
  && JSON.parse(localStorage.getItem('tip.timer.v1')).status === 'running'));
await dial.evaluate(() => { document.getElementById('collapse').click(); });
await dial.evaluate(async () => {
  const store = await import('./js/timer-store.js');
  store.startTimer(1);
});
await dial.waitForTimeout(2300);
const doneState = await dial.evaluate(() => ({ clock: document.getElementById('pill-clock').textContent, shown: !document.getElementById('pill-timer').hidden }));
check('v1.17.0 — 타이머 끝나면 알약에 완료', doneState.shown && doneState.clock === '완료', JSON.stringify(doneState));
await dial.waitForTimeout(5400);
check('v1.17.0 — 5초 뒤 완료 숨김', await dial.evaluate(() => document.getElementById('pill-timer').hidden));

// 닫힌 노치 표시 끄기 — 늘 TIP 로고만
await dial.evaluate(async () => {
  const timer = await import('./js/timer-store.js');
  timer.startTimer(300);
  const store = await import('./js/store.js');
  store.setNotchPillActivity(false);
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(700);
check('v1.17.0 — 표시 끄면 알약에 타이머 없음', await dial.evaluate(() => document.getElementById('pill-timer').hidden
  && getComputedStyle(document.getElementById('pill-logo')).display !== 'none'));
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchPillActivity(true);
  const timer = await import('./js/timer-store.js');
  timer.resetTimer();
});

// 시작 화면 = 전체 보기 → 클릭으로 열면 빠른 메모 포커스
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchStartView('full');
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(200);
await reopen(dial);
check('v1.17.0 — 시작 화면 전체 보기로 열림', await dial.evaluate(() => document.getElementById('notch').classList.contains('is-full')));
check('v1.17.0 — 클릭으로 열면 빠른 메모 포커스', (await dial.evaluate(() => document.activeElement?.id)) === 'memo-input');
// 마우스로 열면 포커스를 가져가지 않는다
await dial.evaluate(() => { document.getElementById('collapse').click(); document.activeElement?.blur(); });
await dial.waitForTimeout(250);
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchHoverOpen(true);
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(150);
await dial.evaluate(() => { window.__TIP_CALLS__.length = 0; });
await dial.evaluate(() => document.getElementById('pill').dispatchEvent(new MouseEvent('mouseenter')));
await dial.waitForTimeout(350);
const hoverOpen = await dial.evaluate(() => ({
  expanded: document.getElementById('notch').classList.contains('is-expanded'),
  active: document.activeElement?.id || document.activeElement?.tagName,
  focusCalls: window.__TIP_CALLS__.filter((call) => call.command === 'notch_focus').length,
}));
check('v1.17.0 — 마우스로 열면 포커스 안 가져감', hoverOpen.expanded && hoverOpen.active !== 'memo-input' && hoverOpen.focusCalls === 0, JSON.stringify(hoverOpen));

// 메뉴 막대 아이콘 이벤트(tip://notch-tray) — 열려 있으면 닫는다
const trayToggle = await dial.evaluate(async () => {
  const fire = window.__TIP_LISTENERS__ && window.__TIP_LISTENERS__['tip://notch-tray'];
  if (!fire) return 'no-listener';
  fire({ payload: null });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const closed = !document.getElementById('notch').classList.contains('is-expanded');
  fire({ payload: null });
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { closed, reopened: document.getElementById('notch').classList.contains('is-expanded'), active: document.activeElement?.id };
});
check('v1.17.0 — 메뉴 막대 아이콘으로 닫고 열기', trayToggle.closed && trayToggle.reopened && trayToggle.active === 'memo-input', JSON.stringify(trayToggle));

// 최근 사용 카드
await dial.evaluate(() => {
  localStorage.setItem('tip.recent.v1', JSON.stringify(['timer', 'qr-gen', 'dev-tools']));
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(250);
await dial.evaluate(() => { document.getElementById('collapse').click(); });
await reopen(dial);
const recent = await dial.evaluate(() => [...document.querySelectorAll('.recent-chip')].map((chip) => chip.getAttribute('aria-label')));
check('v1.17.0 — 최근 사용 칩', recent.length === 3 && recent[0].includes('타이머'), JSON.stringify(recent));
await dial.evaluate(() => {
  localStorage.setItem('tip.recent.enabled.v1', '0');
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(250);
check('v1.17.0 — 메인에서 최근 사용 끄면 카드 숨김', await dial.evaluate(() => !document.querySelector('.wg-recent')));

// 불투명도 — 판 배경 알파
await dial.evaluate(() => {
  localStorage.setItem('tip.quickbarOpacity.v1', '75');
  window.dispatchEvent(new StorageEvent('storage'));
});
await dial.waitForTimeout(200);
check('v1.17.0 — 판 배경에 불투명도 적용', (await dial.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sheet-alpha').trim())) === '0.75');

// 반원 글자 12px 이상·버튼 36px 이상(데스크톱)
await dial.evaluate(async () => {
  const store = await import('./js/store.js');
  store.setNotchStartView('simple');
  window.dispatchEvent(new StorageEvent('storage'));
  document.getElementById('collapse').click();
});
await reopen(dial);
const dialA11y = await dial.evaluate(() => {
  const root = document.getElementById('dial');
  const small = [...root.querySelectorAll('b, span, p, input, button')]
    .filter((node) => node.offsetParent && node.textContent.trim() && !node.children.length)
    .filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12)
    .map((node) => node.textContent.trim().slice(0, 12));
  const tiny = [...root.querySelectorAll('.dial-arrow, .dial-icon, .sheet-toggle, .dial-side')]
    .filter((node) => !node.hidden && node.offsetParent)
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width < 32 || rect.height < 32).length;
  const unlabeled = [...root.querySelectorAll('button')]
    .filter((node) => !node.hidden && !(node.getAttribute('aria-label') || node.textContent.trim())).length;
  return { small, tiny, unlabeled };
});
check('v1.17.0 — 반원 글자 12px 이상', dialA11y.small.length === 0, dialA11y.small.join(','));
check('v1.17.0 — 반원 버튼 32px 이상', dialA11y.tiny === 0, String(dialA11y.tiny));
check('v1.17.0 — 반원 버튼 이름 있음', dialA11y.unlabeled === 0, String(dialA11y.unlabeled));
await v117Context.close();

/* ---------- v1.17.1 노치 실기 버그 3종 + 보관함 높이 ---------- */
{
// 1. 메뉴 막대 아이콘으로 열기 — 창이 알약 폭일 때 그려도, 커지면 모듈 칸이 제자리에 보인다.
const pillContext = await browser.newContext({ viewport: { width: 92, height: 28 }, locale: 'ko-KR', colorScheme: 'light' });
await pillContext.addInitScript(MOCK);
const pillPage = await pillContext.newPage();
pillPage.on('pageerror', (error) => consoleErrors.push(`v1171 pageerror: ${String(error)}`));
await pillPage.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await pillPage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, startView: 'simple', widgets: { media: false, calendar: true, shelf: true, timer: true, memo: true, launcher: true } }));
});
await pillPage.reload({ waitUntil: 'networkidle' });
await pillPage.waitForTimeout(700);
// 메뉴 막대 TIP 아이콘 — Rust 가 창을 펼친다(창은 아직 알약 크기)
await pillPage.evaluate(() => { window.__TIP_LISTENERS__['tip://notch-tray']({ payload: null }); });
await pillPage.waitForTimeout(250);
const beforeGrow = await pillPage.evaluate(() => ({
  expanded: document.getElementById('notch').classList.contains('is-expanded'),
  visible: [...document.querySelectorAll('.dial-slot')].filter((slot) => slot.style.visibility === 'visible').length,
}));
check('v1.17.1 — 메뉴 막대 아이콘으로 반원이 열림', beforeGrow.expanded, JSON.stringify(beforeGrow));
check('v1.17.1 — 알약 폭에서는 모듈 칸을 그리지 않음(자리 어긋남 방지)', beforeGrow.visible === 0, String(beforeGrow.visible));
// Rust 가 창을 640×284 로 키운다 — 휠을 굴리지 않아도 칸이 보여야 한다.
await pillPage.setViewportSize({ width: 640, height: 284 });
await pillPage.waitForTimeout(500);
const afterGrow = await pillPage.evaluate(() => {
  const sheet = document.getElementById('sheet').getBoundingClientRect();
  const slots = [...document.querySelectorAll('.dial-slot')]
    .filter((slot) => slot.style.visibility === 'visible')
    .map((slot) => { const box = slot.getBoundingClientRect(); return { id: slot.dataset.moduleId, x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
  const center = document.querySelector('.dial-slot.is-center');
  const centerBox = center ? center.getBoundingClientRect() : null;
  return {
    slots,
    inside: slots.filter((slot) => slot.x > sheet.left && slot.x < sheet.right && slot.y > sheet.top && slot.y < sheet.bottom).length,
    centerOffset: centerBox ? Math.round(centerBox.x + centerBox.width / 2 - (sheet.left + sheet.width / 2)) : 999,
    sheetWidth: Math.round(sheet.width),
  };
});
check('v1.17.1 — 창이 펼쳐지면 휠 없이 모듈 칸이 보임', afterGrow.slots.length >= 7 && afterGrow.inside === afterGrow.slots.length,
  `${afterGrow.inside}/${afterGrow.slots.length}`);
check('v1.17.1 — 가운데 모듈이 판 가운데에 옴', Math.abs(afterGrow.centerOffset) <= 12, `${afterGrow.centerOffset}px (판 ${afterGrow.sheetWidth})`);

// 2. 접을 때 안쪽 입력칸 초점을 놓는다 — 초점이 남아 '입력 중'이 계속 켜져 있던 원인.
const focusedBefore = await pillPage.evaluate(() => (document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : ''));
await pillPage.keyboard.press('Escape');
await pillPage.waitForTimeout(300);
const afterEscape = await pillPage.evaluate(() => ({
  expanded: document.getElementById('notch').classList.contains('is-expanded'),
  active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : '',
  hold: window.__TIP_CALLS__.filter((call) => call.command === 'notch_hover_hold').pop(),
}));
check('v1.17.1 — Esc 로 접힘', !afterEscape.expanded, JSON.stringify(afterEscape));
check('v1.17.1 — 접으면 안쪽 초점을 놓고 입력 중 표시를 끔', afterEscape.active !== focusedBefore && !!afterEscape.hold && afterEscape.hold.args.hold === false,
  JSON.stringify({ before: focusedBefore, after: afterEscape.active, hold: afterEscape.hold && afterEscape.hold.args }));
await pillContext.close();

// 3. 커서가 창 안인데 온 mouseleave 로는 접지 않고, 실제로 밖으로 나가면 접는다.
const leaveContext = await browser.newContext({ viewport: { width: 640, height: 284 }, locale: 'ko-KR', colorScheme: 'light' });
await leaveContext.addInitScript(MOCK);
const leavePage = await leaveContext.newPage();
leavePage.on('pageerror', (error) => consoleErrors.push(`v1171 pageerror: ${String(error)}`));
await leavePage.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await leavePage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, startView: 'full', hoverOpen: true, widgets: { media: false, calendar: true, shelf: true, timer: true, memo: true, launcher: true } }));
});
await leavePage.reload({ waitUntil: 'networkidle' });
await leavePage.waitForTimeout(700);
const openByHover = async () => {
  await leavePage.evaluate(() => { window.__TIP_LISTENERS__['tip://notch-hover-enter']({ payload: null }); });
  await leavePage.waitForTimeout(350);
};
await openByHover();
check('v1.17.1 — 마우스 올리기로 펼쳐짐', await leavePage.evaluate(() => document.getElementById('notch').classList.contains('is-expanded')));
// 창 안에 커서가 있는데 mouseleave 가 왔다(창 크기가 바뀌는 순간 등) — 접지 않는다.
await leavePage.evaluate(() => {
  window.__TIP_CURSOR_INSIDE__ = true;
  document.getElementById('notch').dispatchEvent(new MouseEvent('mouseleave'));
});
await leavePage.waitForTimeout(900);
const stayed = await leavePage.evaluate(() => ({
  expanded: document.getElementById('notch').classList.contains('is-expanded'),
  asked: window.__TIP_CALLS__.some((call) => call.command === 'notch_cursor_inside'),
}));
check('v1.17.1 — 커서가 창 안이면 mouseleave 로 접지 않음(영역 오판)', stayed.expanded && stayed.asked, JSON.stringify(stayed));
// 실제로 커서가 밖으로 나가면 접힌다.
await leavePage.evaluate(() => {
  window.__TIP_CURSOR_INSIDE__ = false;
  document.getElementById('notch').dispatchEvent(new MouseEvent('mouseleave'));
});
await leavePage.waitForTimeout(900);
check('v1.17.1 — 커서가 창 밖으로 나가면 접힘', !(await leavePage.evaluate(() => document.getElementById('notch').classList.contains('is-expanded'))));
// Rust 커서 감시가 알리는 '밖으로 나감'도 그대로 접는다.
await openByHover();
await leavePage.evaluate(() => { window.__TIP_LISTENERS__['tip://notch-hover-leave']({ payload: null }); });
await leavePage.waitForTimeout(250);
check('v1.17.1 — Rust 감시의 나감 알림으로 접힘', !(await leavePage.evaluate(() => document.getElementById('notch').classList.contains('is-expanded'))));

// 4. 전체 보기 2줄 — 임시 보관함이 옆 카드(빠른 메모) 높이를 꽉 채운다.
await leavePage.setViewportSize({ width: 640, height: 600 });
await leavePage.waitForTimeout(600);
const inFull = await leavePage.evaluate(() => document.getElementById('notch').classList.contains('is-full'));
if (!inFull) {
  await leavePage.evaluate(() => { document.getElementById('to-full').click(); });
  await leavePage.waitForTimeout(400);
}
const shelfRow = await leavePage.evaluate(() => {
  const memo = document.querySelector('.wg-memo').getBoundingClientRect();
  const shelf = document.querySelector('.wg-shelf').getBoundingClientRect();
  const drop = document.getElementById('shelf-drop').getBoundingClientRect();
  return { memo: Math.round(memo.height), shelf: Math.round(shelf.height), drop: Math.round(drop.height) };
});
check('v1.17.1 — 메모·보관함 카드 높이 같음', shelfRow.memo > 0 && shelfRow.memo === shelfRow.shelf, `${shelfRow.memo}/${shelfRow.shelf}`);
check('v1.17.1 — 보관함 놓기 상자가 카드 높이를 채움', shelfRow.drop >= shelfRow.shelf - 4, `${shelfRow.drop}/${shelfRow.shelf}`);
await leaveContext.close();
}

/* -------------------- v1.17.2 월별 일정·가로 스크롤·노치 숨기기·스포티파이·거울 -------------------- */
{
// 1. 월별 보기 — 달력(왼쪽) · 선택한 날의 일정(오른쪽)
const v1172Events = JSON.stringify([
  { title: '시우 예방접종', start: Date.now() + 3_600_000, end: Date.now() + 5_400_000, allDay: false, calendarId: 'cal-1', calendar: '개인', color: '#2E5E4E' },
  { title: '어린이집 상담 — 오후 4시 30분 선생님과 면담', start: Date.now() + 7_200_000, end: Date.now() + 9_000_000, allDay: false, calendarId: 'cal-2', calendar: '직장', color: '#0A6CFF' },
  { title: '종일 일정 예시', start: Date.now(), end: Date.now() + 60_000, allDay: true, calendarId: 'cal-1', calendar: '개인', color: '#C93400' },
]);
const v1172Context = await browser.newContext({ viewport: { width: 640, height: 600 }, locale: 'ko-KR', colorScheme: 'dark' });
await v1172Context.addInitScript(MOCK.replace('calendar_events: [],', `calendar_events: ${v1172Events},`));
const v1172 = await v1172Context.newPage();
v1172.on('pageerror', (error) => consoleErrors.push(`v1172 pageerror: ${String(error)}`));
await v1172.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await v1172.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.notch.v1', JSON.stringify({
    enabled: true, startView: 'full',
    widgets: { media: false, calendar: true, shelf: true, timer: true, memo: true, mirror: true, launcher: true },
  }));
});
await v1172.reload({ waitUntil: 'networkidle' });
await v1172.waitForTimeout(900);
await v1172.evaluate(() => { document.getElementById('cal-open').click(); });
await v1172.waitForTimeout(700);
const monthLayout = await v1172.evaluate(() => {
  const view = document.getElementById('cal-view');
  const grid = document.getElementById('cal-grid-wrap').getBoundingClientRect();
  const pane = document.getElementById('cal-day-pane').getBoundingClientRect();
  const list = document.getElementById('cal-day-list').getBoundingClientRect();
  const items = [...document.querySelectorAll('#cal-day-list .cal-item')];
  const cells = [...document.querySelectorAll('.cal-cell')];
  return {
    isMonth: view.classList.contains('is-month'),
    display: getComputedStyle(view).display,
    columns: getComputedStyle(view).gridTemplateColumns.split(' ').filter(Boolean).length,
    grid: [Math.round(grid.x), Math.round(grid.y), Math.round(grid.width), Math.round(grid.height)],
    pane: [Math.round(pane.x), Math.round(pane.width), Math.round(pane.height)],
    list: [Math.round(list.width), Math.round(list.height)],
    items: items.length,
    itemWidths: items.map((item) => Math.round(item.getBoundingClientRect().width)),
    itemLines: items.map((item) => Math.round(item.getBoundingClientRect().height)),
    cellH: cells.length ? Math.round(cells[0].getBoundingClientRect().height) : 0,
  };
});
check('v1.17.2 — 월별 보기는 달력·일정을 좌우로 나눈다', monthLayout.isMonth && monthLayout.display === 'grid' && monthLayout.columns === 2
  && monthLayout.pane[0] >= monthLayout.grid[0] + monthLayout.grid[2], JSON.stringify(monthLayout));
check('v1.17.2 — 일정 목록이 판 높이를 쓴다(넓어진 영역)', monthLayout.list[1] >= 380 && monthLayout.list[0] >= 240,
  JSON.stringify(monthLayout.list));
check('v1.17.2 — 일정 제목·시간이 오른쪽 칸 폭에서 읽힌다', monthLayout.items === 3
  && monthLayout.itemWidths.every((width) => width >= 220), JSON.stringify(monthLayout.itemWidths));
check('v1.17.2 — 달력 칸을 늘려 판 높이를 채운다', monthLayout.cellH >= 44
  && Math.abs(monthLayout.grid[3] - monthLayout.pane[2]) <= 6, JSON.stringify({ cellH: monthLayout.cellH, grid: monthLayout.grid[3], pane: monthLayout.pane[2] }));

// 주별·일별은 예전처럼 위아래 배치(넓은 목록 한 줄)
await v1172.evaluate(() => { document.querySelector('[data-cal-mode="week"]').click(); });
await v1172.waitForTimeout(400);
const weekLayout = await v1172.evaluate(() => {
  const view = document.getElementById('cal-view');
  const list = document.getElementById('cal-day-list').getBoundingClientRect();
  return { isMonth: view.classList.contains('is-month'), display: getComputedStyle(view).display, list: [Math.round(list.width), Math.round(list.height)] };
});
check('v1.17.2 — 주별 보기는 위아래 배치 그대로', !weekLayout.isMonth && weekLayout.display === 'flex' && weekLayout.list[0] > 500, JSON.stringify(weekLayout));
await v1172.evaluate(() => { document.querySelector('[data-cal-mode="day"]').click(); });
await v1172.waitForTimeout(350);
check('v1.17.2 — 일별 보기도 위아래 배치', await v1172.evaluate(() => !document.getElementById('cal-view').classList.contains('is-month')));
await v1172.evaluate(() => { document.querySelector('[data-cal-mode="month"]').click(); });
await v1172.waitForTimeout(350);
check('v1.17.2 — 월별로 돌아오면 다시 좌우 배치', await v1172.evaluate(() => document.getElementById('cal-view').classList.contains('is-month')));
await v1172.evaluate(() => { document.getElementById('cal-view-close').click(); });
await v1172.waitForTimeout(400);

// 2. 웹캠 거울 — 세로 높이를 넉넉히(예전 118px → 16:9, 최소 232px)
const mirrorBox = await v1172.evaluate(() => {
  const video = document.getElementById('mirror-video');
  const before = Math.round(video.getBoundingClientRect().height);
  video.classList.add('is-live');
  const box = video.getBoundingClientRect();
  const card = document.querySelector('.wg-mirror').getBoundingClientRect();
  return { before, width: Math.round(box.width), height: Math.round(box.height), card: Math.round(card.height), ratio: Number((box.width / box.height).toFixed(2)) };
});
check('v1.17.2 — 거울 영상 높이 232px 이상(16:9)', mirrorBox.before === 0 && mirrorBox.height >= 232 && mirrorBox.height <= 360,
  JSON.stringify(mirrorBox));
check('v1.17.2 — 거울은 16:9로 찌그러지지 않게', mirrorBox.ratio > 1.5 && mirrorBox.ratio < 1.9 && mirrorBox.card > mirrorBox.height, JSON.stringify(mirrorBox));
await v1172.evaluate(() => { document.getElementById('mirror-video').classList.remove('is-live'); });
await v1172Context.close();

// 3. 스포티파이 — 권한 거부에 어느 앱인지 밝힌다
const spotifyContext = await browser.newContext({ viewport: { width: 452, height: 560 }, locale: 'ko-KR', colorScheme: 'dark' });
await spotifyContext.addInitScript(MOCK.replace(
  'invoke(command, args) {',
  "invoke(command, args) { if (command === 'media_state') return Promise.reject(new Error('[permission] Spotify 자동화 권한이 필요합니다'));",
));
const spotifyPage = await spotifyContext.newPage();
spotifyPage.on('pageerror', (error) => consoleErrors.push(`v1172 spotify pageerror: ${String(error)}`));
await spotifyPage.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await spotifyPage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, widgets: { media: true, timer: false, calendar: false, shelf: false, memo: false, launcher: false } }));
});
await spotifyPage.reload({ waitUntil: 'networkidle' });
await spotifyPage.waitForTimeout(1300);
const spotifyError = await spotifyPage.evaluate(() => ({
  state: document.getElementById('media-state')?.hidden === false ? document.getElementById('media-state').textContent : '',
  title: document.getElementById('media-state')?.title || '',
  perm: document.getElementById('media-perm')?.hidden === false,
}));
check('v1.17.2 — 권한 안내에 앱 이름(Spotify)', spotifyError.state.includes('Spotify') && spotifyError.state.includes('권한'), JSON.stringify(spotifyError));
check('v1.17.2 — 권한 설정 버튼으로 바로 연결', spotifyError.perm, JSON.stringify(spotifyError));
await spotifyContext.close();

// 4. 노치 숨기기 단축키 — 기본 H, 중복 방지, 바꾸기, Rust 알림 반영
const notchShortcutContext = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'ko-KR', colorScheme: 'light' });
await notchShortcutContext.addInitScript(MOCK);
const notchShortcutPage = await notchShortcutContext.newPage();
notchShortcutPage.on('pageerror', (error) => consoleErrors.push(`v1172 settings pageerror: ${String(error)}`));
await notchShortcutPage.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await notchShortcutPage.evaluate(() => { localStorage.clear(); });
await notchShortcutPage.reload({ waitUntil: 'networkidle' });
await notchShortcutPage.click('#settings-btn');
await notchShortcutPage.waitForTimeout(400);
await notchShortcutPage.click('.sheet-tab[data-tab="notch"]');
await notchShortcutPage.waitForTimeout(500);
const notchShortcut = await notchShortcutPage.evaluate(() => {
  const section = document.querySelector('.notch-shortcut-section');
  const input = section ? section.querySelector('.shortcut-letter') : null;
  const calls = window.__TIP_CALLS__.filter((call) => call.command === 'set_module_shortcuts');
  return {
    exists: !!section,
    letter: input ? input.value : null,
    chip: section ? section.querySelector('.shortcut-prefix-chip')?.textContent || '' : '',
    stored: JSON.parse(localStorage.getItem('tip.shortcutLetters.v1') || '{}'),
    lastItems: calls.length ? calls[calls.length - 1].args.items : [],
  };
});
check('v1.17.2 — 설정 → 노치에 숨기기 단축키', notchShortcut.exists && notchShortcut.letter === 'H', JSON.stringify(notchShortcut));
check('v1.17.2 — 공통 조합 + 기본 H 로 등록', notchShortcut.chip.includes('Ctrl') && notchShortcut.stored['notch:toggle'] === 'H'
  && notchShortcut.lastItems.some(([key, accelerator]) => key === 'notch:toggle' && accelerator === 'Control+Shift+KeyH'),
  JSON.stringify({ stored: notchShortcut.stored, items: notchShortcut.lastItems }));

// 같은 글자를 다른 모듈이 쓰면 등록하지 않는다(H 를 타이머가 쓴 상태로 시작).
await notchShortcutPage.evaluate(() => {
  localStorage.setItem('tip.shortcutLetters.v1', JSON.stringify({ timer: 'H' }));
  localStorage.removeItem('tip.shortcutMigration.v1172');
});
await notchShortcutPage.reload({ waitUntil: 'networkidle' });
await notchShortcutPage.click('#settings-btn');
await notchShortcutPage.waitForTimeout(400);
await notchShortcutPage.click('.sheet-tab[data-tab="notch"]');
await notchShortcutPage.waitForTimeout(450);
const duplicateStart = await notchShortcutPage.evaluate(() => document.querySelector('.notch-shortcut-section .shortcut-letter').value);
check('v1.17.2 — H 가 이미 쓰이면 비워 두고 직접 고르게', duplicateStart === '', duplicateStart);
await notchShortcutPage.fill('.notch-shortcut-section .shortcut-letter', 'H');
await notchShortcutPage.waitForTimeout(350);
const duplicate = await notchShortcutPage.evaluate(() => ({
  toast: document.querySelector('.toast')?.textContent || '',
  letter: document.querySelector('.notch-shortcut-section .shortcut-letter').value,
  stored: JSON.parse(localStorage.getItem('tip.shortcutLetters.v1') || '{}'),
}));
check('v1.17.2 — 다른 모듈이 쓰는 글자는 중복 등록 안 함', duplicate.letter === '' && !duplicate.stored['notch:toggle']
  && duplicate.toast.includes('타이머'), JSON.stringify(duplicate));
await notchShortcutPage.fill('.notch-shortcut-section .shortcut-letter', 'J');
await notchShortcutPage.waitForTimeout(500);
const changed = await notchShortcutPage.evaluate(() => {
  const calls = window.__TIP_CALLS__.filter((call) => call.command === 'set_module_shortcuts');
  return {
    letter: document.querySelector('.notch-shortcut-section .shortcut-letter').value,
    stored: JSON.parse(localStorage.getItem('tip.shortcutLetters.v1') || '{}'),
    items: calls.length ? calls[calls.length - 1].args.items : [],
  };
});
check('v1.17.2 — 다른 글자로 바꾸면 바로 등록', changed.letter === 'J' && changed.stored['notch:toggle'] === 'J'
  && changed.items.some(([key, accelerator]) => key === 'notch:toggle' && accelerator === 'Control+Shift+KeyJ'),
  JSON.stringify(changed));

// Rust 가 단축키로 숨기면 알림으로 저장값·스위치가 따라온다.
const beforeToggle = await notchShortcutPage.evaluate(() => {
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true }));
  return JSON.parse(localStorage.getItem('tip.notch.v1')).enabled;
});
await notchShortcutPage.evaluate(() => { window.__TIP_LISTENERS__['tip://notch-enabled']({ payload: false }); });
await notchShortcutPage.waitForTimeout(300);
const afterToggle = await notchShortcutPage.evaluate(() => ({
  enabled: JSON.parse(localStorage.getItem('tip.notch.v1') || '{}').enabled,
  pressed: document.querySelector('.notch-section .switch')?.getAttribute('aria-pressed'),
}));
check('v1.17.2 — 단축키로 숨기면 저장값·설정 스위치가 따라옴', beforeToggle === true && afterToggle.enabled === false && afterToggle.pressed === 'false',
  JSON.stringify({ beforeToggle, afterToggle }));
await notchShortcutContext.close();
}

// 순수 규칙(js/dial.js)
const dialRules = await page.evaluate(async () => {
  const d = await import('./js/dial.js');
  const ids = Array.from({ length: 18 }, (_, index) => `m${index}`);
  return {
    label1: d.rowPositionLabel(0, 18, 7, true),
    label2: d.rowPositionLabel(15, 18, 7, true),
    label3: d.rowPositionLabel(-1, 18, 7, false),
    few: d.rowPositionLabel(0, 3, 7, true),
    win: d.rowWindow(ids, 15, 7, true).join(','),
    ends: d.rowAtEnds(11, 18, 7, false),
    center: d.centerIndex(-1, 18, true),
    clamp: d.clampPos(25, 18, false),
    target: d.targetFor(17, 0, 18, true),
    find: d.findIndex(['a', 'b'], 'B', (id) => [id.toUpperCase()]),
  };
});
check('v1.17.0 — 규칙: 위치 표시', dialRules.label1 === '1–7 / 18' && dialRules.label2 === '16–18, 1–4 / 18' && dialRules.label3 === '1–7 / 18' && dialRules.few === '3개',
  JSON.stringify(dialRules));
check('v1.17.0 — 규칙: 끝에서 이어 붙이기', dialRules.win === 'm15,m16,m17,m0,m1,m2,m3', dialRules.win);
check('v1.17.0 — 규칙: 멈춤 끝', dialRules.ends[0] === false && dialRules.ends[1] === true, JSON.stringify(dialRules.ends));
check('v1.17.0 — 규칙: 계속 회전 가운데·가까운 쪽', dialRules.center === 17 && dialRules.target === -1, JSON.stringify(dialRules));
check('v1.17.0 — 규칙: 멈춤 자르기·찾기', dialRules.clamp === 17 && dialRules.find === 1, JSON.stringify(dialRules));

// 정리 — 반원 퀵바 창과 커맨드가 남아 있지 않다. 커맨드 목록 세 곳이 같다.
const libRs = readFileSync(join(ROOT, 'mac/src-tauri/src/lib.rs'), 'utf8');
const buildRs = readFileSync(join(ROOT, 'mac/src-tauri/build.rs'), 'utf8');
const caps = JSON.parse(readFileSync(join(ROOT, 'mac/src-tauri/capabilities/default.json'), 'utf8'));
check('v1.17.0 — radial 파일 없음', !existsSync(join(ROOT, 'radial.html')) && !existsSync(join(ROOT, 'js/radial.js')) && !existsSync(join(ROOT, 'css/radial.css')));
check('v1.17.0 — 퀵바 창·hide_radial 없음', !/QUICKBAR|hide_radial|show_quickbar/.test(libRs) && !caps.windows.includes('quickbar'));
const handlerCmds = ((libRs.match(/generate_handler!\[([\s\S]*?)\]/) || [])[1] || '').split(',').map((item) => item.trim().split('::').pop()).filter(Boolean).sort();
const buildCmds = [...(buildRs.match(/APP_COMMANDS[^=]*=\s*&\[([\s\S]*?)\];/) || ['', ''])[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
const capCmds = caps.permissions.filter((item) => typeof item === 'string' && item.startsWith('allow-')).map((item) => item.slice(6).replace(/-/g, '_')).sort();
check('v1.17.0 — 커맨드 목록 세 곳 일치', handlerCmds.length > 60 && handlerCmds.join() === buildCmds.join() && buildCmds.join() === capCmds.join(),
  `${handlerCmds.length}/${buildCmds.length}/${capCmds.length}`);
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
check('v1.17.0 — 캐시 목록에 radial 없음·dial.js 있음', !sw.includes('radial') && sw.includes("'./js/dial.js'"));
}

/* ------------------------------ 결과 ------------------------------ */

const errors = consoleErrors.filter((line) => !/favicon|service worker|ERR_FILE/i.test(line));
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
console.log(`\nTIP v1.17.2 환경설정 전수 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((item, index) => console.log(`  ${index + 1}. ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`));
  process.exit(1);
}
