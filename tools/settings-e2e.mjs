#!/usr/bin/env node
/**
 * TIP v1.15.1 · 환경설정 4탭 전수 E2E — 실제로 클릭하며 확인한다.
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

check('홈이 그려짐(모듈 27)', await page.locator('.module-card').count() === 27, String(await page.locator('.module-card').count()));
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
check('노치 — 메뉴 막대·퀵바 한 묶음(v1.15.1)', (await page.locator('.sheet-section h3', { hasText: '메뉴 막대 · 퀵바' }).count()) === 1);
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
check('모듈 — 모듈 목록 27개', moduleRows === 27, String(moduleRows));
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

/* ------------------------------ 결과 ------------------------------ */

const errors = consoleErrors.filter((line) => !/favicon|service worker|ERR_FILE/i.test(line));
check('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = results.filter((item) => !item.ok);
console.log(`\nTIP v1.15.1 환경설정 전수 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((item, index) => console.log(`  ${index + 1}. ✗ ${item.name}${item.detail ? ` — ${item.detail}` : ''}`));
  process.exit(1);
}
