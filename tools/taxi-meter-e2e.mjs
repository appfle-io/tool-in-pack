#!/usr/bin/env node
/**
 * TIP v1.27.1 · 택시 미터기 전수 E2E — 실제로 눌러 보고, 위치를 흉내 내 확인한다.
 *
 *   node tools/taxi-meter-e2e.mjs
 *   TIP_CHROME=/path/to/chrome node tools/taxi-meter-e2e.mjs
 *   TIP_PLAYWRIGHT=/path/to/node_modules/playwright node tools/taxi-meter-e2e.mjs
 *
 * 하는 일
 *   · 홈 게임 묶음에 택시 미터기가 서는지, 390px 에서 가로로 넘치지 않는지 본다.
 *   · 화면에 시뮬레이션 흔적(모드 탭·속도 슬라이더·프리셋·시 경계 통과)이 하나도 없는지 본다.
 *   · 전체화면: 전광판 오른쪽 [전체화면]을 누르면 화면을 꽉 채우고, Esc·[나가기]로 돌아온다.
 *     requestFullscreen 이 없는 환경(iOS 사파리·PW​A)도 흉내 내 CSS 오버레이만으로 덮는지 본다.
 *   · navigator.geolocation 을 mock 해 GPS 주행을 확인한다 — 거리 누적, 속도, 시간·거리 병산,
 *     도트 말 애니메이션, 할증, 출발지를 벗어나면 시계 외 자동 ON, 수동 설정 우선.
 *   · 요금 결제(1/N) 영수증과 1인당 금액, 인원 조절, 영수증 복사를 본다.
 *   · 전광판: 4,800 / 12,400 / 128,500 / 1,234,500 이 판을 넘지 않고 자릿수에 맞춰 커지는지 본다.
 *   · 인터넷이 끊겨 역지오코딩이 실패해도 콘솔 오류 없이 미터기가 도는지 본다.
 *   · 요금 규칙은 fare.js 를 직접 불러 숫자로 확인한다(서울 심야 40%, 복합 상한 60%/50%).
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
for (const candidate of ['playwright', process.env.TIP_PLAYWRIGHT || ''].filter(Boolean)) {
  try { ({ chromium } = require(candidate)); break; } catch { /* 다음 후보 */ }
}
if (!chromium) {
  console.error('playwright 를 찾지 못했습니다. `npm i -D playwright` 뒤 다시 실행하거나 TIP_PLAYWRIGHT 로 경로를 주세요.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.TIP_CHROME || '';
const LIB = process.env.TIP_LIBS || '';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let path = normalize(join(ROOT, url === '/' ? 'index.html' : url));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  ...(LIB ? { env: { ...process.env, LD_LIBRARY_PATH: LIB } } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    ...(process.env.TIP_CHROME_ARGS || '').split(' ').filter(Boolean)],
});

/* 위치 mock — 실제 기기 대신 window.__geo.push() 로 좌표를 밀어 넣는다. */
const GEO_MOCK = `
(() => {
  const watchers = new Map();
  let seq = 0;
  let last = null;
  const toPosition = (point) => ({
    coords: {
      latitude: point.latitude, longitude: point.longitude,
      accuracy: point.accuracy === undefined ? 8 : point.accuracy,
      altitude: null, altitudeAccuracy: null, heading: null,
      speed: point.speed === undefined ? null : point.speed,
    },
    timestamp: point.timestamp === undefined ? Date.now() + (seq += 1) : point.timestamp,
  });
  const geo = {
    watchPosition(ok) {
      const id = (seq += 1);
      watchers.set(id, ok);
      if (last) setTimeout(() => { if (watchers.has(id)) ok(toPosition({ ...last, timestamp: undefined })); }, 0);
      return id;
    },
    clearWatch(id) { watchers.delete(id); },
    getCurrentPosition(ok) {
      if (last) ok(toPosition({ ...last, timestamp: undefined }));
    },
  };
  try {
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  } catch { /* 브라우저가 막으면 진짜 위치를 쓴다 */ }
  window.__geo = {
    push(point) {
      last = point;
      const position = toPosition(point);
      for (const ok of [...watchers.values()]) ok(position);
    },
    watchers: () => watchers.size,
  };
})();
`;

const MOCK = `
(() => {
  try {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: () => Promise.reject(new Error('test: no sw')), ready: Promise.reject(new Error('test: no sw')), controller: null, addEventListener() {}, removeEventListener() {} },
      configurable: true,
    });
  } catch { /* 그대로 둔다 */ }
  // 시계 경계 시험용 기준점 — 용인시 인근
  window.__txmTest = { minMoveM: 60, minIntervalMs: 200 };
  window.__txmStart = { lat: 37.2411, lon: 127.1776 };
})();
`;

const consoleErrors = [];
const NOISE = /test: no sw|ERR_INTERNET_DISCONNECTED|nominatim/i;

function watch(page, bucket) {
  page.on('console', (message) => { if (message.type() === 'error' && !NOISE.test(message.text())) bucket.push(message.text()); });
  page.on('pageerror', (error) => { if (!NOISE.test(String(error))) bucket.push(`pageerror: ${String(error)}`); });
}

async function makeContext({ noFullscreenApi = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', colorScheme: 'dark' });
  await context.addInitScript(MOCK);
  await context.addInitScript(GEO_MOCK);
  if (noFullscreenApi) {
    // iOS 사파리·홈 화면 앱 흉내 — requestFullscreen 이 아예 없다.
    await context.addInitScript(`
      (() => {
        try { delete Element.prototype.requestFullscreen; } catch { /* 무시 */ }
        try { Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true }); } catch { /* 무시 */ }
      })();
    `);
  }
  let geocodeCalls = 0;
  await context.route('**/nominatim.openstreetmap.org/**', async (route) => {
    geocodeCalls += 1;
    const url = new URL(route.request().url());
    const lat = Number(url.searchParams.get('lat'));
    const crossed = lat > 37.2411 + 0.0004;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        place_id: 1,
        display_name: crossed ? '수원시, 경기도, 대한민국' : '용인시, 경기도, 대한민국',
        address: crossed
          ? { city: '수원시', county: '수원시', state: '경기도', country: '대한민국' }
          : { city: '용인시', county: '용인시', state: '경기도', country: '대한민국' },
      }),
    });
  });
  return { context, calls: () => geocodeCalls };
}

const first = await makeContext();
const context = first.context;
const page = await context.newPage();
watch(page, consoleErrors);

async function openModule(target = page) {
  await target.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await target.evaluate(() => localStorage.clear());
  await target.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
  await target.waitForSelector('.txm', { timeout: 8000 });
  await target.waitForTimeout(250);
}

const text = (selector, target = page) => target.locator(selector).first().innerText();
const digitsLabel = () => page.locator('#txm-digits').getAttribute('aria-label');
const fareTotal = async () => Number((await digitsLabel()).replace(/[^0-9]/g, ''));
const metric = (name) => page.evaluate((label) => {
  const item = [...document.querySelectorAll('.txm-metric')].find((node) => node.textContent.includes(label));
  return item ? item.querySelector('b').textContent.trim() : '';
}, name);
const push = (point) => page.evaluate((next) => window.__geo.push(next), point);

/* ------------------------------ 1. 홈 노출 ------------------------------ */

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const homeCards = await page.locator('.home-section[data-section="game"] .module-card').count();
check('v1.27.1 — 게임 묶음에 택시 미터기가 섰다(4개)', homeCards === 4, String(homeCards));
const allCards = await page.locator('.module-card').count();
check('v1.27.1 — 웹(PWA) 홈 모듈 31개(Mac 5종 제외)', allCards === 31, String(allCards));
const cardTitles = await page.locator('.home-section[data-section="game"] .module-card h2').allTextContents();
check('v1.27.1 — 게임 카드 이름', cardTitles.join(',').includes('택시 미터기'), cardTitles.join(','));

/* ------------------------------ 2. 첫 화면 · GPS 전용 ------------------------------ */

await openModule();
const expectedBase = await page.evaluate(async () => {
  const fare = await import('/modules/taxi-meter/fare.js');
  const region = fare.regionById('yongin');
  return fare.computeFare(region, { distanceM: 0, slowSeconds: 0, nightRate: fare.resolveNightRate(region, 'auto', new Date()) }).total;
});
check('v1.27.1 — 첫 요금은 지역 기본요금(자동 심야 반영)', (await fareTotal()) === expectedBase, `${await fareTotal()}/${expectedBase}`);
check('v1.27.1 — 빈 차 표시', (await text('.txm-live')).includes('빈 차'));
check('v1.27.1 — 요금판 7세그먼트 캔버스', await page.evaluate(() => {
  const canvas = document.getElementById('txm-digits');
  return !!canvas && canvas.width > 100 && canvas.height > 40;
}));
check('v1.27.1 — 도트 말 캔버스', await page.evaluate(() => {
  const canvas = document.getElementById('txm-horse');
  if (!canvas) return false;
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index] > 20) lit += 1;
  return lit > 400;
}));
check('v1.27.1 — 화면 꺼짐 방지 배지', (await text('.txm-wake')).includes('화면 꺼짐 방지'));
check('v1.27.1 — 안내 문구', (await text('.txm-note')).includes('재미·참고용 시뮬레이터'));

const simTrace = await page.evaluate(() => {
  const body = document.body.innerText;
  return {
    modes: document.querySelectorAll('.txm-mode').length,
    range: document.querySelectorAll('#txm-range').length,
    presets: document.querySelectorAll('.txm-presets button').length,
    cross: document.querySelectorAll('#txm-cross').length,
    words: ['시뮬레이션', '시 경계 통과', '실내 연습'].filter((word) => body.includes(word)),
  };
});
check('v1.27.1 — 시뮬레이션 모드 탭·속도 슬라이더·프리셋·시 경계 통과가 없다',
  simTrace.modes === 0 && simTrace.range === 0 && simTrace.presets === 0 && simTrace.cross === 0 && simTrace.words.length === 0,
  JSON.stringify(simTrace));
check('v1.27.1 — 전체화면 단추가 전광판 오른쪽에 있다', await page.evaluate(() => {
  const button = document.getElementById('txm-fs');
  if (!button) return false;
  const board = document.querySelector('.txm-board-head').getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  return rect.height >= 44 && rect.right <= board.right + 1 && rect.left > board.left + board.width / 2;
}), await page.evaluate(() => (document.querySelector('#txm-fs') || {}).textContent));

/* ------------------------------ 3. 요금 규칙 ------------------------------ */

const rules = await page.evaluate(async () => {
  const fare = await import('/modules/taxi-meter/fare.js');
  const pick = (id) => fare.regionById(id);
  const day = new Date(2026, 10, 27, 14, 0, 0);
  const night = new Date(2026, 10, 27, 23, 30, 0);
  const seoulDay = fare.computeFare(pick('seoul'), { distanceM: 5420, slowSeconds: 120, nightRate: fare.resolveNightRate(pick('seoul'), 'auto', day) });
  const seoulNight = fare.computeFare(pick('seoul'), { distanceM: 5420, slowSeconds: 120, nightRate: fare.resolveNightRate(pick('seoul'), 'auto', night), outOfArea: true });
  const gyeonggiNight = fare.computeFare(pick('gyeonggi'), { distanceM: 3000, slowSeconds: 0, nightRate: 0.3, outOfArea: true });
  const yongin = pick('yongin');
  const yonginBase = fare.computeFare(yongin, { distanceM: 1800, slowSeconds: 0, nightRate: 0 });
  const yonginOver = fare.computeFare(yongin, { distanceM: 1904, slowSeconds: 0, nightRate: 0 });
  const overCap = fare.computeFare(pick('busan'), { distanceM: 0, slowSeconds: 0, nightRate: 0.4, outOfArea: true });
  return {
    seoulDayTotal: seoulDay.total,
    seoulNightRate: seoulNight.rate,
    seoulNightCapped: seoulNight.capped,
    gyeonggiRate: gyeonggiNight.rate,
    gyeonggiCapped: gyeonggiNight.capped,
    yonginBase: yonginBase.total,
    yonginOver: yonginOver.total,
    yonginStep: yongin.stepMeters,
    yonginNight: fare.resolveNightRate(yongin, 'auto', night),
    yonginDay: fare.resolveNightRate(yongin, 'auto', day),
    seoulWindows: [22, 23, 1, 3, 5].map((hour) => fare.resolveNightRate(pick('seoul'), 'auto', new Date(2026, 10, 27, hour, 10, 0))),
    perPerson: fare.splitPerPerson(12400, 3),
    clock: fare.formatClock(504000),
    overCapRate: overCap.rate,
    overCapCapped: overCap.capped,
    regionCount: fare.REGIONS.length,
    lowSpeed: yongin.lowSpeedKmh,
  };
});
check('v1.27.1 — 서울 주간 5.42km 요금(4,800+2,900+400)', rules.seoulDayTotal === 8100, String(rules.seoulDayTotal));
check('v1.27.1 — 서울 심야 40% + 시계외 20%는 60% 상한', rules.seoulNightRate === 0.6, String(rules.seoulNightRate));
check('v1.27.1 — 경기 야간 30% + 시계외 20%는 50% 상한', rules.gyeonggiRate === 0.5, String(rules.gyeonggiRate));
check('v1.27.1 — 경기 가형 기본 1.8km 4,800원', rules.yonginBase === 4800, String(rules.yonginBase));
check('v1.27.1 — 경기 가형 104m당 100원', rules.yonginStep === 104 && rules.yonginOver === 4900, `${rules.yonginStep}/${rules.yonginOver}`);
check('v1.27.1 — 심야 자동(가형 23시 30%, 낮 0%)', rules.yonginNight === 0.3 && rules.yonginDay === 0, `${rules.yonginNight}/${rules.yonginDay}`);
check('v1.27.1 — 서울 심야 구간 20/40/20/20/0', rules.seoulWindows.join(',') === '0.2,0.4,0.4,0.2,0', rules.seoulWindows.join(','));
check('v1.27.1 — 1/N 정산은 10원 올림', rules.perPerson === 4140, String(rules.perPerson));
check('v1.27.1 — 시간 표기(8분 24초)', rules.clock === '08:24', rules.clock);
check('v1.27.1 — 지역 5곳', rules.regionCount === 5, String(rules.regionCount));
check('v1.27.1 — 부산 심야40+시계외30은 50% 상한에서 잘림', rules.overCapCapped && rules.overCapRate === 0.5, `${rules.overCapRate}/${rules.overCapCapped}`);

/* ------------------------------ 4. 지역 · 할증 튜너 ------------------------------ */

await page.selectOption('#txm-region', 'seoul');
await page.waitForTimeout(120);
check('v1.27.1 — 지역을 서울로 바꾸면 기본요금 유지·심야 규칙 표시', (await text('.txm-night-rule')).includes('23~02시 +40%'), await text('.txm-night-rule'));

await page.click('.txm-night button[data-night="40"]');
await page.waitForTimeout(120);
check('v1.27.1 — 야간 40% 직접', (await text('.txm-surcharge')).includes('+40%'), await text('.txm-surcharge'));
const nightOnly = await fareTotal();
check('v1.27.1 — 40% 할증이 요금에 붙음', nightOnly === 6700, String(nightOnly));

await page.click('#txm-out');
await page.waitForTimeout(120);
const combined = await fareTotal();
check('v1.27.1 — 시계 외 +20% 로 복합 할증', (await text('.txm-surcharge')).includes('복합'), await text('.txm-surcharge'));
check('v1.27.1 — 복합 할증 요금', combined === 7700, String(combined));

await page.click('#txm-toll');
await page.waitForTimeout(120);
const withToll = await fareTotal();
check('v1.27.1 — 통행료 1,000원이 더해짐', withToll === combined + 1000, `${combined} → ${withToll}`);
await page.click('#txm-toll-box .txm-plus');
await page.waitForTimeout(120);
check('v1.27.1 — +1,000원 단추', (await fareTotal()) === combined + 2000, String(await fareTotal()));
await page.fill('#txm-toll-box input', '3500');
await page.waitForTimeout(120);
check('v1.27.1 — 통행료 직접 입력', (await fareTotal()) === combined + 3500, String(await fareTotal()));

await page.click('#txm-extra');
await page.waitForTimeout(120);
check('v1.27.1 — 추가 요금 2,000원', (await fareTotal()) === combined + 3500 + 2000, String(await fareTotal()));

await page.click('.txm-night button[data-night="0"]');
await page.click('#txm-out');
await page.click('#txm-toll');
await page.click('#txm-extra');
await page.waitForTimeout(150);
check('v1.27.1 — 할증을 모두 끄면 기본요금', (await fareTotal()) === 4800, String(await fareTotal()));

/* ------------------------------ 5. 전체화면 ------------------------------ */

const normalDigitHeight = await page.evaluate(() => Math.round(document.querySelector('.txm-digits').getBoundingClientRect().height));
await page.click('#txm-fs');
await page.waitForTimeout(600);
const full = await page.evaluate(() => {
  const shell = document.querySelector('.txm');
  const rect = shell.getBoundingClientRect();
  const actions = document.querySelector('.txm-actions').getBoundingClientRect();
  return {
    cls: shell.classList.contains('txm-fs'),
    native: !!document.fullscreenElement,
    x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height),
    vw: innerWidth, vh: innerHeight,
    digits: Math.round(document.querySelector('.txm-digits').getBoundingClientRect().height),
    actionsTop: Math.round(actions.top), actionsBottom: Math.round(actions.bottom),
    btn: document.querySelector('#txm-fs').getAttribute('aria-pressed'),
    label: document.querySelector('#txm-fs span').textContent,
    locked: document.documentElement.classList.contains('txm-fs-open'),
  };
});
check('v1.27.1 — 전체화면이 화면을 꽉 채운다', full.cls && full.x === 0 && full.y === 0 && full.w === full.vw && full.h === full.vh, JSON.stringify(full));
check('v1.27.1 — 전체화면에서 전광판이 더 크다', full.digits > normalDigitHeight + 20, `${normalDigitHeight} → ${full.digits}`);
check('v1.27.1 — 전체화면에서 조작 단추가 화면 아래에 있다', full.actionsBottom <= full.vh && full.actionsTop > full.vh / 2, `${full.actionsTop}~${full.actionsBottom}/${full.vh}`);
check('v1.27.1 — 전체화면 단추가 [나가기]로 바뀐다', full.btn === 'true' && full.label.includes('나가기'), `${full.btn}/${full.label}`);
check('v1.27.1 — 전체화면에서 뒤 화면은 스크롤 잠금', full.locked);
check('v1.27.1 — 전체화면에서 할증 튜너·안내는 숨긴다', await page.evaluate(() => {
  const tuner = document.querySelector('.txm-tuner');
  const note = document.querySelector('.txm-note');
  return getComputedStyle(tuner).display === 'none' && getComputedStyle(note).display === 'none';
}));

await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const back = await page.evaluate(() => ({
  cls: document.querySelector('.txm').classList.contains('txm-fs'),
  native: !!document.fullscreenElement,
  locked: document.documentElement.classList.contains('txm-fs-open'),
  label: document.querySelector('#txm-fs span').textContent,
}));
check('v1.27.1 — Esc 로 전체화면에서 돌아온다', !back.cls && !back.native && !back.locked && back.label.includes('전체화면'), JSON.stringify(back));

await page.click('#txm-fs');
await page.waitForTimeout(400);
await page.click('#txm-fs');
await page.waitForTimeout(400);
check('v1.27.1 — [나가기] 단추로도 돌아온다', await page.evaluate(() => !document.querySelector('.txm').classList.contains('txm-fs')
  && !document.documentElement.classList.contains('txm-fs-open')));

/* requestFullscreen 이 없는 곳(iOS 사파리·홈 화면 앱) — CSS 오버레이만으로 덮는다 */
const ios = await makeContext({ noFullscreenApi: true });
const iosErrors = [];
const iosPage = await ios.context.newPage();
watch(iosPage, iosErrors);
await iosPage.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
await iosPage.waitForSelector('.txm');
await iosPage.click('#txm-fs');
await iosPage.waitForTimeout(400);
const iosFull = await iosPage.evaluate(() => {
  const shell = document.querySelector('.txm');
  const rect = shell.getBoundingClientRect();
  return {
    hasApi: typeof Element.prototype.requestFullscreen === 'function',
    native: !!document.fullscreenElement,
    cls: shell.classList.contains('txm-fs'),
    covers: Math.round(rect.x) === 0 && Math.round(rect.y) === 0 && Math.round(rect.width) === innerWidth && Math.round(rect.height) === innerHeight,
    z: getComputedStyle(shell).zIndex,
  };
});
check('v1.27.1 — requestFullscreen 이 없어도 CSS 오버레이로 꽉 찬다', !iosFull.hasApi && !iosFull.native && iosFull.cls && iosFull.covers, JSON.stringify(iosFull));
await iosPage.keyboard.press('Escape');
await iosPage.waitForTimeout(300);
check('v1.27.1 — 오버레이에서도 Esc 로 돌아온다', await iosPage.evaluate(() => !document.querySelector('.txm').classList.contains('txm-fs')));
await ios.context.close();

/* ------------------------------ 6. GPS 주행(mock) ------------------------------ */

await page.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
await page.waitForSelector('.txm');
await page.selectOption('#txm-region', 'yongin');
await page.waitForTimeout(150);
await page.click('#txm-go');
await page.waitForTimeout(200);
check('v1.27.1 — 주행 시작 표시', (await text('.txm-live')).includes('LIVE'), await text('.txm-live'));

let lat = 37.2411;
await push({ latitude: lat, longitude: 127.1776, accuracy: 8, speed: 0 });
await page.waitForTimeout(500);
check('v1.27.1 — GPS 출발지 확인(용인시)', (await text('.txm-detect')).includes('용인시'), await text('.txm-detect'));
check('v1.27.1 — 위치 정확도 표시', (await text('.txm-gps')).includes('정확도'), await text('.txm-gps'));

for (let step = 0; step < 10; step += 1) {
  lat += 0.000072; // 약 8m
  await push({ latitude: lat, longitude: 127.1776, accuracy: 8, speed: 11.1 });
  await page.waitForTimeout(300);
}
await page.waitForTimeout(400);
const gpsDistance = Number((await metric('거리')).replace(/[^0-9.]/g, ''));
const gpsSpeed = Number((await metric('속도')).replace(/[^0-9]/g, ''));
check('v1.27.1 — GPS 거리 누적', gpsDistance > 0.05, String(gpsDistance));
check('v1.27.1 — 좌표의 속도(40km/h)를 쓴다', gpsSpeed === 40, String(gpsSpeed));
check('v1.27.1 — 시 경계를 넘으면 자동 감지 문구', (await text('.txm-detect')).includes('수원시'), await text('.txm-detect'));
check('v1.27.1 — 시계 외 할증 자동 ON', (await page.getAttribute('#txm-out', 'aria-pressed')) === 'true');
check('v1.27.1 — 역지오코딩 호출됨', first.calls() >= 2, String(first.calls()));

const hashA = await page.evaluate(() => document.getElementById('txm-horse').toDataURL().slice(-160));
await page.waitForTimeout(320);
const hashB = await page.evaluate(() => document.getElementById('txm-horse').toDataURL().slice(-160));
check('v1.27.1 — 도트 말이 달린다(프레임 변화)', hashA !== hashB, hashA === hashB ? '같음' : '다름');

/* 정지하면 거리는 그대로, 시간요금은 쌓인다(25초당 100원) */
const beforeIdle = await fareTotal();
const beforeDistance = Number((await metric('거리')).replace(/[^0-9.]/g, ''));
await push({ latitude: lat, longitude: 127.1776, accuracy: 8, speed: 0 });
await page.waitForTimeout(27000);
const afterIdle = await fareTotal();
const afterDistance = Number((await metric('거리')).replace(/[^0-9.]/g, ''));
check('v1.27.1 — 정지 중에는 거리가 늘지 않는다', Math.abs(afterDistance - beforeDistance) < 0.01, `${beforeDistance} → ${afterDistance}`);
check('v1.27.1 — 정지(0km/h)에서 시간요금이 쌓인다', afterIdle > beforeIdle, `${beforeIdle} → ${afterIdle}`);
check('v1.27.1 — 시간 표시가 흐른다', (await text('.txm-time')) !== '00:00', await text('.txm-time'));

/* 사용자가 직접 끄면 자동 감지가 다시 켜지 않는다 */
await page.click('#txm-out');
await page.waitForTimeout(150);
check('v1.27.1 — 수동으로 끄면 꺼짐', (await page.getAttribute('#txm-out', 'aria-pressed')) === 'false');
for (let step = 0; step < 9; step += 1) {
  lat += 0.000072;
  await push({ latitude: lat, longitude: 127.1776, accuracy: 8, speed: 11.1 });
  await page.waitForTimeout(280);
}
await page.waitForTimeout(500);
check('v1.27.1 — 수동 설정을 자동 감지가 덮지 않는다', (await page.getAttribute('#txm-out', 'aria-pressed')) === 'false');
check('v1.27.1 — 수동 표시', (await text('.txm-detect')).includes('수동'), await text('.txm-detect'));

await page.click('#txm-hold');
await page.waitForTimeout(200);
check('v1.27.1 — 일시 정지', (await text('.txm-live')).includes('일시 정지'), await text('.txm-live'));
const pausedDistance = await metric('거리');
await page.waitForTimeout(700);
check('v1.27.1 — 멈추면 거리가 늘지 않음', (await metric('거리')) === pausedDistance, pausedDistance);

/* ------------------------------ 7. 1/N 정산 ------------------------------ */

await page.click('#txm-pay');
await page.waitForTimeout(300);
check('v1.27.1 — 영수증이 열린다', await page.locator('.txm-receipt').isVisible());
const slipText = await text('.txm-receipt');
check('v1.27.1 — 영수증 항목(기본·거리·시간·할증·합계)', ['기본요금', '거리요금', '시간요금', '할증', '합계'].every((word) => slipText.includes(word)), slipText.slice(0, 80));
const total = await fareTotal();
const perDefault = Number((await text('.txm-per-value')).replace(/[^0-9]/g, ''));
check('v1.27.1 — 1인당 기본 2명', perDefault === Math.ceil(total / 2 / 10) * 10, `${total}/${perDefault}`);

await page.click('.txm-stepper [data-people="1"]');
await page.waitForTimeout(150);
const perThree = Number((await text('.txm-per-value')).replace(/[^0-9]/g, ''));
check('v1.27.1 — 3명으로 나누면 1인당 금액', perThree === Math.ceil(total / 3 / 10) * 10, `${total}/${perThree}`);
for (let index = 0; index < 20; index += 1) {
  if (await page.locator('.txm-stepper [data-people="1"]').isDisabled()) break;
  await page.click('.txm-stepper [data-people="1"]');
}
check('v1.27.1 — 인원 상한 20명', (await text('.txm-people')) === '20', await text('.txm-people'));

await context.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#txm-copy');
await page.waitForTimeout(200);
const copied = await page.evaluate(() => navigator.clipboard.readText());
check('v1.27.1 — 영수증 복사', copied.includes('합계') && copied.includes('1인당'), copied.split('\n')[0]);

/* 전체화면에서 영수증이 조작 단추를 가리지 않는다 */
await page.click('#txm-fs');
await page.waitForTimeout(500);
const slipInFs = await page.evaluate(() => {
  const slip = document.querySelector('.txm-receipt');
  const actions = document.querySelector('.txm-actions').getBoundingClientRect();
  const rect = slip.getBoundingClientRect();
  return {
    visible: !slip.hidden && getComputedStyle(slip).position === 'absolute',
    aboveActions: Math.round(rect.bottom) <= Math.round(actions.top) + 2,
    inView: Math.round(rect.top) >= 0 && Math.round(rect.bottom) <= innerHeight,
  };
});
check('v1.27.1 — 전체화면 영수증이 화면 안에 뜨고 단추를 가리지 않는다', slipInFs.visible && slipInFs.aboveActions && slipInFs.inView, JSON.stringify(slipInFs));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/* ------------------------------ 8. 전광판 숫자판 ------------------------------ */

const panels = await page.evaluate(async () => {
  const { createLedPanel } = await import('/modules/taxi-meter/panel.js');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:340px;height:200px';
  document.body.append(host);
  const results = [];
  const amounts = ['4,800', '12,400', '128,500', '1,234,500'];
  for (const amount of amounts) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    host.append(canvas);
    const led = createLedPanel(canvas);
    led.resize();
    led.set(amount);
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = 1e9; let minY = 1e9; let maxX = -1; let maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 40) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const layout = led.layout;
    results.push({
      amount,
      canvas: { w: canvas.width, h: canvas.height },
      ink: { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
      layoutHeight: Math.round(layout.height),
      totalWidth: Math.round(layout.totalWidth),
    });
    canvas.remove();
  }
  host.remove();
  return results;
});
const fits = panels.every((panel) => panel.ink.minX >= 1 && panel.ink.minY >= 0
  && panel.ink.maxX <= panel.canvas.w - 1 && panel.ink.maxY <= panel.canvas.h
  && panel.totalWidth <= panel.canvas.w);
check('v1.27.1 — 4,800 / 12,400 / 128,500 / 1,234,500 이 판 안에 다 들어간다', fits,
  panels.map((panel) => `${panel.amount}:${panel.ink.w}x${panel.ink.h}/${panel.canvas.w}x${panel.canvas.h}`).join(' '));
const heights = panels.map((panel) => panel.ink.h);
check('v1.27.1 — 자릿수가 늘수록 글자가 작아져 폭에 맞춘다(가변 길이)',
  heights[0] > heights[1] && heights[1] > heights[2] && heights[2] > heights[3] && heights[3] >= 40,
  heights.join(' → '));
check('v1.27.1 — 긴 금액도 판 폭을 넓게 쓴다', panels[3].ink.w >= panels[3].canvas.w * 0.8,
  `${panels[3].ink.w}/${panels[3].canvas.w}`);
check('v1.27.1 — 쉼표가 획으로 그려진다(1,234,500 은 빈 칸이 없다)', panels[3].ink.w > 250, String(panels[3].ink.w));

/* 같은 금액이라도 판이 넓으면 더 크게 그린다 */
const scaled = await page.evaluate(async () => {
  const { createLedPanel } = await import('/modules/taxi-meter/panel.js');
  const measure = (width) => {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-9999px;top:0;width:${width}px;height:92px`;
    document.body.append(host);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    host.append(canvas);
    const led = createLedPanel(canvas);
    led.resize();
    led.set('1,234,500');
    const height = led.layout.height;
    const totalWidth = led.layout.totalWidth;
    host.remove();
    return { height: Math.round(height), totalWidth: Math.round(totalWidth) };
  };
  return [260, 340, 560].map((width) => ({ width, ...measure(width) }));
});
check('v1.27.1 — 판이 넓어지면 글자도 함께 커진다', scaled[0].height < scaled[1].height && scaled[1].height < scaled[2].height,
  scaled.map((item) => `${item.width}px→${item.height}`).join(' '));

/* ------------------------------ 9. 라이트/다크 ------------------------------ */

for (const theme of ['light', 'dark']) {
  await page.evaluate((next) => document.documentElement.setAttribute('data-theme', next), theme);
  await page.waitForTimeout(200);
  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    board: getComputedStyle(document.querySelector('.txm-board')).backgroundColor,
  }));
  check(`v1.27.1 — ${theme} 테마에서 전광판 유지`, colors.board === 'rgb(15, 17, 20)', colors.board);
  if (theme === 'light') check('v1.27.1 — 라이트 본문 배경', colors.body === 'rgb(242, 242, 247)', colors.body);
  else check('v1.27.1 — 다크 본문 배경', colors.body === 'rgb(13, 13, 16)', colors.body);
}

/* ------------------------------ 10. 390px 가로 넘침 ------------------------------ */

const overflow = await page.evaluate(() => {
  const wide = [];
  document.querySelectorAll('.txm *').forEach((node) => {
    if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX === 'visible' && node.clientWidth > 0) {
      wide.push(`${node.className || node.tagName}:${node.scrollWidth}/${node.clientWidth}`);
    }
  });
  return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: wide.slice(0, 4) };
});
check('v1.27.1 — 390px 가로 넘침 없음', overflow.page <= 0 && overflow.wide.length === 0, JSON.stringify(overflow));

/* ------------------------------ 11. 오프라인(역지오코딩 실패) ------------------------------ */

const offlineErrors = [];
const offlineSetup = await makeContext();
await offlineSetup.context.route('**/nominatim.openstreetmap.org/**', (route) => route.abort('internetdisconnected'));
const offline = await offlineSetup.context.newPage();
watch(offline, offlineErrors);
await offline.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
await offline.waitForSelector('.txm');
await offline.click('#txm-go');
let offLat = 37.2411;
await offline.evaluate((point) => window.__geo.push(point), { latitude: offLat, longitude: 127.1776, accuracy: 8, speed: 0 });
await offline.waitForTimeout(1200);
for (let step = 0; step < 9; step += 1) {
  offLat += 0.000072;
  await offline.evaluate((point) => window.__geo.push(point), { latitude: offLat, longitude: 127.1776, accuracy: 8, speed: 11.1 });
  await offline.waitForTimeout(260);
}
await offline.waitForTimeout(700);
const offlineDistance = await offline.evaluate(() => {
  const item = [...document.querySelectorAll('.txm-metric')].find((node) => node.textContent.includes('거리'));
  return item ? item.querySelector('b').textContent.trim() : '';
});
check('v1.27.1 — 오프라인에서도 미터기는 돈다', Number(offlineDistance.replace(/[^0-9.]/g, '')) > 0.02, offlineDistance);
check('v1.27.1 — 오프라인 안내(직접 켜기)', (await offline.locator('.txm-detect').innerText()).includes('직접'), await offline.locator('.txm-detect').innerText());
check('v1.27.1 — 오프라인 콘솔 오류 0', offlineErrors.length === 0, offlineErrors.slice(0, 2).join(' | '));
await offlineSetup.context.close();

/* ------------------------------ 결과 ------------------------------ */

check('v1.27.1 — 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((entry) => !entry.ok);
console.log(`\n택시 미터기 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((entry, index) => console.log(`  ${index + 1}. ✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`));
}
await context.close();
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
