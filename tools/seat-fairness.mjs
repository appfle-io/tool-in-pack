#!/usr/bin/env node
/**
 * TIP v1.21.0 · 선착순 골인 자리 공정성 측정 — 실제 브라우저에서 여러 판을 돌린다.
 *
 *   node tools/seat-fairness.mjs
 *   RACE_ROUNDS=30 RACE_MAP=pinball node tools/seat-fairness.mjs
 *   TIP_CHROME=/path/to/chrome node tools/seat-fairness.mjs
 *   RACE_PEOPLE=4 node tools/seat-fairness.mjs
 *
 * 보는 것
 *   · 원래 입력 순번(1번~N번)별 우승 횟수 — 자리가 섞이므로 고르게 나와야 한다
 *   · 자리(왼쪽→오른쪽)별 우승 횟수 — 지형 탓에 자리 자체가 유리한지 보여 준다
 *   · 4명일 때 카이제곱 근사 p값(자유도 3) — 0.05보다 작으면 치우쳤다는 신호
 *   · 순수 난수 섞기(shuffle)가 자리를 고르게 뽑는지도 따로 확인한다(2만 번)
 *
 * 판은 페이지를 다시 열지 않고 [다시하기] 로 이어 달린다(한 판 약 8~10초, 2x).
 * 맵·사람 수·판 수를 바꿔 가며 여러 번 돌리면 결과가 .fairness.json 에 쌓인다.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
for (const candidate of ['playwright', process.env.TIP_PLAYWRIGHT || ''].filter(Boolean)) {
  try {
    ({ chromium } = require(candidate));
    break;
  } catch { /* 다음 후보 */ }
}
if (!chromium) {
  console.error('playwright 를 찾지 못했습니다 — `npm i -D playwright` 뒤 다시 실행하거나 TIP_PLAYWRIGHT=/path/to/playwright 로 경로를 주세요.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.fairness.json');
const EXE = process.env.TIP_CHROME || '';
const LIB = process.env.TIP_LIBS || '';
const ROUNDS = Math.max(1, Number(process.env.RACE_ROUNDS) || 30);
const PEOPLE = Math.max(2, Math.min(30, Number(process.env.RACE_PEOPLE) || 4));
const MAP = process.env.RACE_MAP || 'pinball';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
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

/* ------------------------------ 통계 도우미 ------------------------------ */

function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418
    + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587
    + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** 자유도 3 카이제곱 생존함수(근사) — 4명 승률이 고른지 볼 때 쓴다. */
function chiSquare3Survival(x) {
  if (x <= 0) return 1;
  return erfc(Math.sqrt(x / 2)) + Math.sqrt((2 * x) / Math.PI) * Math.exp(-x / 2);
}

function chiSquare(counts, expected) {
  return counts.reduce((sum, count) => sum + ((count - expected) ** 2) / expected, 0);
}

/* ------------------------------ 순수 난수 확인 ------------------------------ */

const shuffleTrials = 20000;
const seatCounts = Array.from({ length: PEOPLE }, () => 0);
const identitySeat = Array.from({ length: PEOPLE }, () => 0);
{
  const buffer = new Uint32Array(1);
  const rand = (max) => {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(buffer);
      return buffer[0] % max;
    }
    return Math.floor(Math.random() * max);
  };
  const shuffle = (list) => {
    const out = list.slice();
    for (let index = out.length - 1; index > 0; index -= 1) {
      const pick = rand(index + 1);
      const swap = out[index];
      out[index] = out[pick];
      out[pick] = swap;
    }
    return out;
  };
  for (let trial = 0; trial < shuffleTrials; trial += 1) {
    const order = shuffle(Array.from({ length: PEOPLE }, (_, index) => index));
    order.forEach((person, seat) => {
      seatCounts[seat] += 1;
      if (seat === 0) identitySeat[person] += 1;
    });
  }
}
const shuffleExpected = shuffleTrials / PEOPLE;
const shuffleChi = chiSquare(identitySeat, shuffleExpected);
console.log(`섞기 ${shuffleTrials.toLocaleString()}번 — 맨 왼쪽 자리에 앉은 사람별 횟수 ${identitySeat.join(' / ')}`);
console.log(`  자리 합계 ${seatCounts.join(' / ')} (각 ${shuffleTrials}) · 기대 ${Math.round(shuffleExpected)} · 카이제곱 ${shuffleChi.toFixed(2)} · p≈${chiSquare3Survival(shuffleChi).toFixed(3)}`);

/* ------------------------------ 실제 경주 ------------------------------ */

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  ...(LIB ? { env: { ...process.env, LD_LIBRARY_PATH: LIB } } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    ...(process.env.TIP_CHROME_ARGS || '').split(' ').filter(Boolean)],
});
const context = await browser.newContext({ viewport: { width: 720, height: 1000 }, locale: 'ko-KR', colorScheme: 'light' });
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(`pageerror ${String(error)}`));

const names = Array.from({ length: PEOPLE }, (_, index) => `${index + 1}번`);
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate((setup) => {
  localStorage.clear();
  localStorage.setItem('tip.games.race-game.v1', JSON.stringify(setup));
}, { people: PEOPLE, losers: 1, names, map: MAP, mode: 'first' });
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => { location.hash = '#/race-game'; });
await page.waitForSelector('.gm-map', { timeout: 10000 });

const personWins = Object.fromEntries(names.map((name) => [name, 0]));
const seatWins = Array.from({ length: PEOPLE }, () => 0);
const durations = [];
let rounds = 0;
let forced = 0;
let firstRun = true;

while (rounds < ROUNDS) {
  if (firstRun) {
    await page.click('#gm-start');
    firstRun = false;
  } else {
    await page.click('#rc-summary .gm-retry');
  }
  await page.waitForTimeout(320);
  if (await page.locator('.rc-speed-btn[data-speed="2"]').count()) {
    await page.click('.rc-speed-btn[data-speed="2"]');
  }
  const started = Date.now();
  let state = null;
  while (Date.now() - started < 60000) {
    state = await page.evaluate(() => {
      const root = document.querySelector('.rc');
      return {
        order: (root && root.dataset.order) || '',
        forced: (root && root.dataset.forced) || '0',
        duration: Number((root && root.dataset.duration) || 0),
        summary: !!document.querySelector('#rc-summary'),
      };
    });
    if (state.summary) break;
    await page.waitForTimeout(120);
  }
  if (!state || !state.summary) {
    console.log(`  ${rounds + 1}판 — 결과가 나오지 않았습니다`);
    break;
  }
  const winner = (await page.locator('#rc-summary .rc-board-row').first().textContent()).replace(/\s+/g, ' ').trim();
  const seatOrder = state.order.split('|');
  const seat = seatOrder.indexOf(String(names.find((name) => winner.includes(name)) || ''));
  const name = names.find((item) => winner.includes(item)) || '';
  if (name) personWins[name] += 1;
  if (seat >= 0) seatWins[seat] += 1;
  durations.push(state.duration);
  if (state.forced === '1') forced += 1;
  rounds += 1;
  console.log(`  ${rounds}판 — 우승 ${name || '?'} (자리 ${seat + 1}) · ${state.duration.toFixed(1)}초 · 출발 ${seatOrder.join(',')}`);
}

await context.close();
await browser.close();
server.close();

/* ------------------------------ 집계 ------------------------------ */

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : { runs: [], person: {}, seat: {}, rounds: 0 };
cache.runs.push({ map: MAP, people: PEOPLE, rounds, forced, durations });
cache.rounds += rounds;
cache.person[MAP] ||= {};
cache.seat[MAP] ||= {};
for (const name of names) {
  cache.person[MAP][name] = (cache.person[MAP][name] || 0) + personWins[name];
}
seatWins.forEach((count, index) => {
  const key = `seat${index + 1}`;
  cache.seat[MAP][key] = (cache.seat[MAP][key] || 0) + count;
});
writeFileSync(CACHE, JSON.stringify(cache, null, 2));

const total = Object.values(cache.person[MAP]).reduce((sum, count) => sum + count, 0);
const expected = total / PEOPLE;
console.log('');
console.log(`[${MAP} · ${PEOPLE}명] 지금까지 ${total}판`);
const personCounts = names.map((name) => cache.person[MAP][name] || 0);
const seatList = Array.from({ length: PEOPLE }, (_, index) => cache.seat[MAP][`seat${index + 1}`] || 0);
const personChi = chiSquare(personCounts, expected);
const seatChi = chiSquare(seatList, expected);
console.log(`  원래 순번별 우승 — ${names.map((name, index) => `${name} ${personCounts[index]}회`).join(' · ')}`);
console.log(`  기대 ${expected.toFixed(1)}회 · 카이제곱 ${personChi.toFixed(2)} · p≈${chiSquare3Survival(personChi).toFixed(3)}`);
console.log(`  자리별 우승 — ${seatList.map((count, index) => `${index + 1}번자리 ${count}회`).join(' · ')} (카이제곱 ${seatChi.toFixed(2)}, p≈${chiSquare3Survival(seatChi).toFixed(3)})`);
console.log(`  강제 종료 ${cache.runs.filter((run) => run.map === MAP).reduce((sum, run) => sum + run.forced, 0)}판 · 한 판 평균 ${(cache.runs.filter((run) => run.map === MAP).flatMap((run) => run.durations).reduce((sum, value) => sum + value, 0) / Math.max(1, total)).toFixed(1)}초`);
console.log(`  콘솔 오류 ${errors.length}`);
