#!/usr/bin/env node
/**
 * TIP v1.16.0 · 환경설정 4탭 전수 E2E — 실제로 클릭하며 확인한다.
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
  };
  window.__TAURI__ = {
    core: {
      invoke(command, args) {
        calls.push({ command, args: args || {} });
        const value = Object.prototype.hasOwnProperty.call(answers, command) ? answers[command] : null;
        return Promise.resolve(value);
      },
    },
    event: {
      listen: () => Promise.resolve(() => {}),
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
check('노치 — 메뉴 막대·퀵바 한 묶음(v1.15.1)', (await page.locator('.sheet-section h3', { hasText: '메뉴 막대와 퀵바' }).count()) === 1);
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

// 위젯 7종
const widgetRows = page.locator('.notch-section .notch-row');
const widgetCount = await widgetRows.count();
check('노치 — 위젯 7종', widgetCount === 8, String(widgetCount)); // 마우스 오버 1 + 위젯 7
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
await range.evaluate((node) => { node.value = '64'; node.dispatchEvent(new Event('input', { bubbles: true })); });
check('노치 — 퀵바 투명도 슬라이더', (await page.evaluate(() => Number(localStorage.getItem('tip.quickbarOpacity.v1')))) === 64, await page.evaluate(() => localStorage.getItem('tip.quickbarOpacity.v1')));
check('노치 — 투명도 숫자 표시', (await page.locator('.op-value').textContent()) === '64%');

// 반원 퀵바 순서 하위 화면
await page.click('.sheet-menu:has-text("반원 퀵바 순서")');
await page.waitForTimeout(120);
check('노치 — 퀵바 순서 화면', (await page.locator('.sheet-head h2').textContent()) === '반원 퀵바 순서');
const modeRows = await page.locator('.mode-row').count();
check('노치 — 퀵바 순서 방식 3종', modeRows === 3, String(modeRows));
await page.click('.mode-row[data-mode="asc"]');
await page.waitForTimeout(120);
check('노치 — 오름차순 저장', (await page.evaluate(() => localStorage.getItem('tip.radialOrderMode.v1'))) === 'asc');
await page.click('.sheet-head .sheet-back');
await page.waitForTimeout(120);
check('노치 — 퀵바 화면에서 돌아오기', await page.locator('.sheet-tab[data-tab="notch"]').count() === 1);

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
check('모듈 — 조합해 등록 호출', JSON.stringify(shortcutCall?.args.items) === JSON.stringify([['sticky:new', 'Control+Shift+KeyS']]), JSON.stringify(shortcutCall && shortcutCall.args.items));

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
check('모듈 — 바뀐 조합으로 다시 등록', JSON.stringify(recomposed?.args.items) === JSON.stringify([['sticky:new', 'Alt+Shift+KeyS']]), JSON.stringify(recomposed && recomposed.args.items));

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
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, widgets: { media: true, timer: true, calendar: true, shelf: true, memo: true, launcher: true } }));
});
await notch.reload({ waitUntil: 'networkidle' });
await notch.waitForTimeout(1200);

check('알약 — 노치 여백(--notch-gap) 적용', (await notch.evaluate(() => document.getElementById('pill').style.getPropertyValue('--notch-gap'))) === '200px');
check('알약 — 노치 없음 클래스 아님', !(await notch.evaluate(() => document.getElementById('pill').classList.contains('no-notch'))));

// 음악 — 첫 조회(4.5초 주기)를 기다린다
await notch.waitForFunction(() => !document.getElementById('pill-track').hidden, { timeout: 8000 }).catch(() => {});
check('알약 — 음악 재생 중 확장', await notch.evaluate(() => document.getElementById('pill').classList.contains('has-media')));
check('알약 — 곡 제목 표시', (await notch.locator('#pill-title').textContent()) === '테스트 곡 제목', await notch.locator('#pill-title').textContent());
check('알약 — 이퀄라이저 표시', await notch.evaluate(() => !document.getElementById('pill-eq').hidden));
const width = await notch.evaluate(() => Number(document.getElementById('pill-progress').style.width.replace('%', '')));
check('알약 — 진행률 32% 근처', width >= 30 && width <= 37, String(width));
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
const emptyContext = await browser.newContext({ viewport: { width: 452, height: 560 }, locale: 'ko-KR', colorScheme: 'light' });
await emptyContext.addInitScript(MOCK);
const emptyPage = await emptyContext.newPage();
emptyPage.on('pageerror', (error) => consoleErrors.push(`notch pageerror: ${String(error)}`));
await emptyPage.goto(`${BASE}/notch.html`, { waitUntil: 'networkidle' });
await emptyPage.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('tip.theme', 'light');
  localStorage.setItem('tip.notch.v1', JSON.stringify({ enabled: true, widgets: { media: true, calendar: true, shelf: true, timer: true, memo: true, launcher: true } }));
});
await emptyPage.reload({ waitUntil: 'networkidle' });
await emptyPage.waitForTimeout(1200);

check('v1.15.2 — 회색 막대(.panel-handle) 제거', await emptyPage.evaluate(() => !document.querySelector('.panel-handle')));
const panelHeight = await emptyPage.evaluate(() => Math.round(document.getElementById('panel').getBoundingClientRect().height));
check('v1.15.2 — 펼친 패널 600px 이하', panelHeight > 0 && panelHeight <= 600, String(panelHeight));
const alpha = await emptyPage.evaluate(() => {
  const bg = getComputedStyle(document.getElementById('panel')).backgroundColor;
  const match = bg.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(',').map((value) => Number(value.trim()));
  return parts.length === 4 ? parts[3] : 1;
});
check('v1.15.2 — 패널 배경 불투명도 0.96 이상', alpha >= 0.96, String(alpha));

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
check('v1.15.2 — 빈 보관함 얇은 한 줄(40~52px)', compact.shelf && compact.shelfHeight >= 40 && compact.shelfHeight <= 52, String(compact.shelfHeight));
check('v1.15.2 — 같은 줄 카드 높이 일치(미디어/일정)', compact.mediaHeight === compact.calHeight, `${compact.mediaHeight}/${compact.calHeight}`);
check('v1.15.2 — 같은 줄 카드 높이 일치(타이머/메모)', compact.timerHeight === compact.memoHeight, `${compact.timerHeight}/${compact.memoHeight}`);
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

// 모듈 실행 화살표
const navState = await emptyPage.evaluate(() => {
  const row = document.getElementById('launcher-row');
  const next = document.querySelector('[data-launcher="next"]');
  const before = row.scrollLeft;
  if (next && !next.hidden) next.click();
  return { before, overflow: row.scrollWidth > row.clientWidth + 4, nextHidden: next ? next.hidden : true };
});
await emptyPage.waitForTimeout(600);
const navAfter = await emptyPage.evaluate(() => {
  const row = document.getElementById('launcher-row');
  return { left: row.scrollLeft, fadeStart: row.classList.contains('is-fade-start'), prevShown: !document.querySelector('[data-launcher="prev"]').hidden };
});
check('v1.15.2 — 모듈 줄 다음 화살표', navState.overflow && !navState.nextHidden, JSON.stringify(navState));
check('v1.15.2 — 화살표로 스크롤·양끝 페이드', navAfter.left > navState.before && navAfter.fadeStart && navAfter.prevShown, JSON.stringify(navAfter));
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

/* ------------------------------ 결과 ------------------------------ */

const errors = consoleErrors.filter((line) => !/favicon|service worker|ERR_FILE/i.test(line));
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
console.log(`\nTIP v1.16.0 환경설정 전수 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((item, index) => console.log(`  ${index + 1}. ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`));
  process.exit(1);
}
