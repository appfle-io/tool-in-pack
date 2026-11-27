#!/usr/bin/env node
/**
 * TIP v1.27.0 · 택시 미터기 전수 E2E — 실제로 눌러 보고, 위치를 흉내 내 확인한다.
 *
 *   node tools/taxi-meter-e2e.mjs
 *   TIP_CHROME=/path/to/chrome node tools/taxi-meter-e2e.mjs
 *   TIP_PLAYWRIGHT=/path/to/node_modules/playwright node tools/taxi-meter-e2e.mjs
 *
 * 하는 일
 *   · 홈 게임 묶음에 택시 미터기가 서는지, 390px 에서 가로로 넘치지 않는지 본다.
 *   · 시뮬레이션 주행으로 거리·시간·요금이 쌓이고 도트 말이 움직이는지 본다.
 *   · 할증 튜너(야간 자동/0/20/30/40, 시계 외, 통행료, 추가 요금)가 요금에 바로 반영되는지 본다.
 *   · 요금 결제(1/N) 영수증과 1인당 금액, 인원 조절, 영수증 복사를 본다.
 *   · 실제 GPS 주행은 브라우저 위치와 역지오코딩 응답을 흉내 내(playwright route) 확인한다.
 *     출발지(용인시)를 벗어나면 시계 외 할증이 자동으로 켜지고, 사용자가 직접 끄면 다시 켜지지 않아야 한다.
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

const consoleErrors = [];
const NOISE = /test: no sw|ERR_INTERNET_DISCONNECTED|nominatim/i;
const MOCK = `
(() => {
  window.__TIP_CALLS__ = [];
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

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', colorScheme: 'dark' });
await context.addInitScript(MOCK);

/* 역지오코딩 흉내 — 출발점에서 400m 넘게 북쪽으로 가면 수원시로 답한다. */
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

const page = await context.newPage();
page.on('console', (message) => { if (message.type() === 'error' && !NOISE.test(message.text())) consoleErrors.push(message.text()); });
page.on('pageerror', (error) => { if (!NOISE.test(String(error))) consoleErrors.push(`pageerror: ${String(error)}`); });

async function openModule() {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.txm', { timeout: 8000 });
  await page.waitForTimeout(250);
}

const text = (selector) => page.locator(selector).first().innerText();
const digitsLabel = () => page.locator('#txm-digits').getAttribute('aria-label');
const fareTotal = async () => Number((await digitsLabel()).replace(/[^0-9]/g, ''));
const metric = (name) => page.evaluate((label) => {
  const item = [...document.querySelectorAll('.txm-metric')].find((node) => node.textContent.includes(label));
  return item ? item.querySelector('b').textContent.trim() : '';
}, name);

/* ------------------------------ 1. 홈 노출 ------------------------------ */

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const homeCards = await page.locator('.home-section[data-section="game"] .module-card').count();
check('v1.27.0 — 게임 묶음에 택시 미터기가 섰다(4개)', homeCards === 4, String(homeCards));
const allCards = await page.locator('.module-card').count();
check('v1.27.0 — 웹(PWA) 홈 모듈 31개(Mac 5종 제외)', allCards === 31, String(allCards));
const cardTitles = await page.locator('.home-section[data-section="game"] .module-card h2').allTextContents();
check('v1.27.0 — 게임 카드 이름', cardTitles.join(',').includes('택시 미터기'), cardTitles.join(','));

/* ------------------------------ 2. 첫 화면 ------------------------------ */

await openModule();
const expectedBase = await page.evaluate(async () => {
  const fare = await import('/modules/taxi-meter/fare.js');
  const region = fare.regionById('yongin');
  return fare.computeFare(region, { distanceM: 0, slowSeconds: 0, nightRate: fare.resolveNightRate(region, 'auto', new Date()) }).total;
});
check('v1.27.0 — 첫 요금은 지역 기본요금(자동 심야 반영)', (await fareTotal()) === expectedBase, `${await fareTotal()}/${expectedBase}`);
check('v1.27.0 — 빈 차 표시', (await text('.txm-live')).includes('빈 차'));
check('v1.27.0 — 요금판 7세그먼트 캔버스', await page.evaluate(() => {
  const canvas = document.getElementById('txm-digits');
  return !!canvas && canvas.width > 100 && canvas.height > 40;
}));
check('v1.27.0 — 도트 말 캔버스', await page.evaluate(() => {
  const canvas = document.getElementById('txm-horse');
  if (!canvas) return false;
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let lit = 0;
  for (let index = 3; index < data.length; index += 4) if (data[index] > 20) lit += 1;
  return lit > 400;
}));
check('v1.27.0 — 화면 꺼짐 방지 배지', (await text('.txm-wake')).includes('화면 꺼짐 방지'));
check('v1.27.0 — 안내 문구', (await text('.txm-note')).includes('재미·참고용 시뮬레이터'));

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
check('v1.27.0 — 서울 주간 5.42km 요금(4,800+2,900+400)', rules.seoulDayTotal === 8100, String(rules.seoulDayTotal));
check('v1.27.0 — 서울 심야 40% + 시계외 20%는 60% 상한', rules.seoulNightRate === 0.6, String(rules.seoulNightRate));
check('v1.27.0 — 경기 야간 30% + 시계외 20%는 50% 상한', rules.gyeonggiRate === 0.5, String(rules.gyeonggiRate));
check('v1.27.0 — 경기 가형 기본 1.8km 4,800원', rules.yonginBase === 4800, String(rules.yonginBase));
check('v1.27.0 — 경기 가형 104m당 100원', rules.yonginStep === 104 && rules.yonginOver === 4900, `${rules.yonginStep}/${rules.yonginOver}`);
check('v1.27.0 — 심야 자동(가형 23시 30%, 낮 0%)', rules.yonginNight === 0.3 && rules.yonginDay === 0, `${rules.yonginNight}/${rules.yonginDay}`);
check('v1.27.0 — 서울 심야 구간 20/40/20/20/0', rules.seoulWindows.join(',') === '0.2,0.4,0.4,0.2,0', rules.seoulWindows.join(','));
check('v1.27.0 — 1/N 정산은 10원 올림', rules.perPerson === 4140, String(rules.perPerson));
check('v1.27.0 — 시간 표기(8분 24초)', rules.clock === '08:24', rules.clock);
check('v1.27.0 — 지역 5곳', rules.regionCount === 5, String(rules.regionCount));
check('v1.27.0 — 부산 심야40+시계외30은 50% 상한에서 잘림', rules.overCapCapped && rules.overCapRate === 0.5, `${rules.overCapRate}/${rules.overCapCapped}`);

/* ------------------------------ 4. 지역 · 할증 튜너 ------------------------------ */

await page.selectOption('#txm-region', 'seoul');
await page.waitForTimeout(120);
check('v1.27.0 — 지역을 서울로 바꾸면 기본요금 유지·심야 규칙 표시', (await text('.txm-night-rule')).includes('23~02시 +40%'), await text('.txm-night-rule'));

await page.click('.txm-night button[data-night="40"]');
await page.waitForTimeout(120);
check('v1.27.0 — 야간 40% 직접', (await text('.txm-surcharge')).includes('+40%'), await text('.txm-surcharge'));
const nightOnly = await fareTotal();
check('v1.27.0 — 40% 할증이 요금에 붙음', nightOnly === 6700, String(nightOnly));

await page.click('#txm-out');
await page.waitForTimeout(120);
const combined = await fareTotal();
check('v1.27.0 — 시계 외 +20% 로 복합 할증', (await text('.txm-surcharge')).includes('복합'), await text('.txm-surcharge'));
check('v1.27.0 — 복합 할증 요금', combined === 7700, String(combined));

await page.click('#txm-toll');
await page.waitForTimeout(120);
const withToll = await fareTotal();
check('v1.27.0 — 통행료 1,000원이 더해짐', withToll === combined + 1000, `${combined} → ${withToll}`);
await page.click('#txm-toll-box .txm-plus');
await page.waitForTimeout(120);
check('v1.27.0 — +1,000원 단추', (await fareTotal()) === combined + 2000, String(await fareTotal()));
await page.fill('#txm-toll-box input', '3500');
await page.waitForTimeout(120);
check('v1.27.0 — 통행료 직접 입력', (await fareTotal()) === combined + 3500, String(await fareTotal()));

await page.click('#txm-extra');
await page.waitForTimeout(120);
check('v1.27.0 — 추가 요금 2,000원', (await fareTotal()) === combined + 3500 + 2000, String(await fareTotal()));

await page.click('.txm-night button[data-night="0"]');
await page.click('#txm-out');
await page.click('#txm-toll');
await page.click('#txm-extra');
await page.waitForTimeout(150);
check('v1.27.0 — 할증을 모두 끄면 기본요금', (await fareTotal()) === 4800, String(await fareTotal()));

/* ------------------------------ 5. 시뮬레이션 주행 ------------------------------ */

await page.selectOption('#txm-region', 'yongin');
await page.click('#txm-go');
await page.waitForTimeout(200);
check('v1.27.0 — 주행 시작 표시', (await text('.txm-live')).includes('LIVE'), await text('.txm-live'));
await page.fill('#txm-range', '120');
await page.dispatchEvent('#txm-range', 'input');
await page.waitForTimeout(2500);
const distance = Number((await metric('거리')).replace(/[^0-9.]/g, ''));
const speed = Number((await metric('속도')).replace(/[^0-9]/g, ''));
check('v1.27.0 — 시뮬레이션 거리 증가', distance > 0.05, String(distance));
check('v1.27.0 — 속도 120km/h 반영', speed === 120, String(speed));

const frameA = await page.evaluate(() => document.getElementById('txm-horse').toDataURL().length);
const hashA = await page.evaluate(() => document.getElementById('txm-horse').toDataURL().slice(-160));
await page.waitForTimeout(320);
const hashB = await page.evaluate(() => document.getElementById('txm-horse').toDataURL().slice(-160));
check('v1.27.0 — 도트 말이 달린다(프레임 변화)', frameA > 2000 && hashA !== hashB, `${frameA}/${hashA === hashB ? '같음' : '다름'}`);

await page.click('#txm-hold');
await page.waitForTimeout(150);
check('v1.27.0 — 일시 정지', (await text('.txm-live')).includes('일시 정지'), await text('.txm-live'));
const pausedDistance = await metric('거리');
await page.waitForTimeout(600);
check('v1.27.0 — 멈추면 거리가 늘지 않음', (await metric('거리')) === pausedDistance, pausedDistance);

await page.click('#txm-go');
await page.fill('#txm-range', '0');
await page.dispatchEvent('#txm-range', 'input');
const beforeIdle = await fareTotal();
await page.waitForTimeout(27000);
const afterIdle = await fareTotal();
check('v1.27.0 — 정체(0km/h)에서 시간요금이 쌓인다', afterIdle > beforeIdle, `${beforeIdle} → ${afterIdle}`);

/* ------------------------------ 6. 1/N 정산 ------------------------------ */

await page.click('#txm-pay');
await page.waitForTimeout(250);
check('v1.27.0 — 영수증이 열린다', await page.locator('.txm-receipt').isVisible());
const slipText = await text('.txm-receipt');
check('v1.27.0 — 영수증 항목(기본·거리·시간·할증·합계)', ['기본요금', '거리요금', '시간요금', '할증', '합계'].every((word) => slipText.includes(word)), slipText.slice(0, 80));
const total = await fareTotal();
const perDefault = Number((await text('.txm-per-value')).replace(/[^0-9]/g, ''));
check('v1.27.0 — 1인당 기본 2명', perDefault === Math.ceil(total / 2 / 10) * 10, `${total}/${perDefault}`);

await page.click('.txm-stepper [data-people="1"]');
await page.waitForTimeout(150);
const perThree = Number((await text('.txm-per-value')).replace(/[^0-9]/g, ''));
check('v1.27.0 — 3명으로 나누면 1인당 금액', perThree === Math.ceil(total / 3 / 10) * 10, `${total}/${perThree}`);
for (let index = 0; index < 20; index += 1) {
  if (await page.locator('.txm-stepper [data-people="1"]').isDisabled()) break;
  await page.click('.txm-stepper [data-people="1"]');
}
check('v1.27.0 — 인원 상한 20명', (await text('.txm-people')) === '20', await text('.txm-people'));

await context.grantPermissions(['clipboard-read', 'clipboard-write']);
await page.click('#txm-copy');
await page.waitForTimeout(200);
const copied = await page.evaluate(() => navigator.clipboard.readText());
check('v1.27.0 — 영수증 복사', copied.includes('합계') && copied.includes('1인당'), copied.split('\n')[0]);

/* ------------------------------ 7. 라이트/다크 ------------------------------ */

for (const theme of ['light', 'dark']) {
  await page.evaluate((next) => document.documentElement.setAttribute('data-theme', next), theme);
  await page.waitForTimeout(200);
  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    board: getComputedStyle(document.querySelector('.txm-board')).backgroundColor,
    note: getComputedStyle(document.querySelector('.txm-note')).color,
  }));
  check(`v1.27.0 — ${theme} 테마에서 전광판 유지`, colors.board === 'rgb(15, 17, 20)', colors.board);
  if (theme === 'light') check('v1.27.0 — 라이트 본문 배경', colors.body === 'rgb(242, 242, 247)', colors.body);
  else check('v1.27.0 — 다크 본문 배경', colors.body === 'rgb(13, 13, 16)', colors.body);
}

/* ------------------------------ 8. 390px 가로 넘침 ------------------------------ */

const overflow = await page.evaluate(() => {
  const wide = [];
  document.querySelectorAll('.txm *').forEach((node) => {
    if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX === 'visible' && node.clientWidth > 0) {
      wide.push(`${node.className || node.tagName}:${node.scrollWidth}/${node.clientWidth}`);
    }
  });
  return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: wide.slice(0, 4) };
});
check('v1.27.0 — 390px 가로 넘침 없음', overflow.page <= 0 && overflow.wide.length === 0, JSON.stringify(overflow));

/* ------------------------------ 9. GPS 주행 · 시계외 자동 ------------------------------ */

await context.grantPermissions(['geolocation'], { origin: BASE });
await page.evaluate((point) => window.__tipStart = point, {});
await page.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
await page.waitForSelector('.txm');
await page.click('.txm-mode[data-mode="gps"]');
await page.click('#txm-go');
await page.waitForTimeout(300);

let lat = 37.2411;
await context.setGeolocation({ latitude: lat, longitude: 127.1776, accuracy: 8 });
await page.waitForTimeout(1600);
check('v1.27.0 — GPS 출발지 확인(용인시)', (await text('.txm-detect')).includes('용인시'), await text('.txm-detect'));
check('v1.27.0 — 위치 정확도 표시', (await text('.txm-gps')).includes('정확도'), await text('.txm-gps'));

for (let step = 0; step < 8; step += 1) {
  lat += 0.000072;  // 약 8m
  await context.setGeolocation({ latitude: lat, longitude: 127.1776, accuracy: 8 });
  await page.waitForTimeout(320);
}
await page.waitForTimeout(600);
check('v1.27.0 — GPS 거리 누적', Number((await metric('거리')).replace(/[^0-9.]/g, '')) > 0.02, await metric('거리'));
check('v1.27.0 — 시 경계를 넘으면 자동 감지 문구', (await text('.txm-detect')).includes('수원시'), await text('.txm-detect'));
check('v1.27.0 — 시계 외 할증 자동 ON', (await page.getAttribute('#txm-out', 'aria-pressed')) === 'true');
check('v1.27.0 — 역지오코딩 호출됨', geocodeCalls >= 2, String(geocodeCalls));

/* 사용자가 직접 끄면 자동 감지가 다시 켜지 않는다 */
await page.click('#txm-out');
await page.waitForTimeout(150);
check('v1.27.0 — 수동으로 끄면 꺼짐', (await page.getAttribute('#txm-out', 'aria-pressed')) === 'false');
for (let step = 0; step < 9; step += 1) {
  lat += 0.000072;
  await context.setGeolocation({ latitude: lat, longitude: 127.1776, accuracy: 8 });
  await page.waitForTimeout(320);
}
await page.waitForTimeout(500);
check('v1.27.0 — 수동 설정을 자동 감지가 덮지 않는다', (await page.getAttribute('#txm-out', 'aria-pressed')) === 'false');
check('v1.27.0 — 수동 표시', (await text('.txm-detect')).includes('수동'), await text('.txm-detect'));

/* ------------------------------ 10. 오프라인(역지오코딩 실패) ------------------------------ */

const offlineErrors = [];
const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', colorScheme: 'dark' });
await offlineContext.addInitScript(MOCK);
await offlineContext.grantPermissions(['geolocation'], { origin: BASE });
await offlineContext.route('**/nominatim.openstreetmap.org/**', (route) => route.abort('internetdisconnected'));
const offline = await offlineContext.newPage();
offline.on('console', (message) => { if (message.type() === 'error' && !NOISE.test(message.text())) offlineErrors.push(message.text()); });
offline.on('pageerror', (error) => { if (!NOISE.test(String(error))) offlineErrors.push(`pageerror: ${String(error)}`); });
await offline.goto(`${BASE}/index.html#/taxi-meter`, { waitUntil: 'networkidle' });
await offline.waitForSelector('.txm');
await offline.click('.txm-mode[data-mode="gps"]');
await offline.click('#txm-go');
let offLat = 37.2411;
await offlineContext.setGeolocation({ latitude: offLat, longitude: 127.1776, accuracy: 8 });
await offline.waitForTimeout(1200);
for (let step = 0; step < 9; step += 1) {
  offLat += 0.000072;
  await offlineContext.setGeolocation({ latitude: offLat, longitude: 127.1776, accuracy: 8 });
  await offline.waitForTimeout(260);
}
await offline.waitForTimeout(700);
const offlineDistance = await offline.evaluate(() => {
  const item = [...document.querySelectorAll('.txm-metric')].find((node) => node.textContent.includes('거리'));
  return item ? item.querySelector('b').textContent.trim() : '';
});
check('v1.27.0 — 오프라인에서도 미터기는 돈다', Number(offlineDistance.replace(/[^0-9.]/g, '')) > 0.02, offlineDistance);
check('v1.27.0 — 오프라인 안내(직접 켜기)', (await offline.locator('.txm-detect').innerText()).includes('직접'), await offline.locator('.txm-detect').innerText());
check('v1.27.0 — 오프라인 콘솔 오류 0', offlineErrors.length === 0, offlineErrors.slice(0, 2).join(' | '));
await offlineContext.close();

/* ------------------------------ 결과 ------------------------------ */

check('v1.27.0 — 콘솔 오류 0', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((entry) => !entry.ok);
console.log(`\n택시 미터기 E2E — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((entry, index) => console.log(`  ${index + 1}. ✗ ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`));
}
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
