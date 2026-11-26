#!/usr/bin/env node
/**
 * TIP v1.20.0 · 선착순 골인 스트레스 테스트 — 실제 브라우저에서 여러 판을 돌린다.
 *
 *   node tools/race-stress.mjs
 *   TIP_CHROME=/path/to/chrome node tools/race-stress.mjs
 *   TIP_PLAYWRIGHT=/path/to/node_modules/playwright node tools/race-stress.mjs
 *   RACE_REPEAT=5 node tools/race-stress.mjs        # 판마다 반복 횟수(기본 3)
 *
 * 확인하는 것
 *   · 4개 맵 × 4명·12명을 여러 번 — 양옆에 끼어 못 내려오는 일(stuck)과 시간 초과로
 *     강제 종료하는 일(forced)이 0건인지, 전원이 골인하는지
 *   · 카메라가 따라 내려가는지(진행률·카메라 값이 늘어나는지)
 *   · 결승선 앞 슬로우 모션이 실제로 걸리는지(phase=photo)
 *   · 판정 방식 3가지(선착순·꼴찌 당첨·1등만)가 당첨 인원을 바르게 가르는지
 *   · 한 판 길이가 12~22초(게임 시간) 안에 드는지
 *   · 지도마다 진행 중·골인 화면을 screenshots/ 에 남겨 눈으로 확인할 수 있게 한다
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
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
const SHOTS = join(ROOT, 'screenshots');
const EXE = process.env.TIP_CHROME || '';
const LIB = process.env.TIP_LIBS || '';
const REPEAT = Math.max(1, Number(process.env.RACE_REPEAT) || 3);
const MAPS = [
  { id: 'sprint', name: '질주 트랙' },
  { id: 'circuit', name: '장애물 서킷' },
  { id: 'pinball', name: '핀볼 드롭' },
  { id: 'rail', name: '지그재그 레일' },
];

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

mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  ...(LIB ? { env: { ...process.env, LD_LIBRARY_PATH: LIB } } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

const consoleErrors = [];
const context = await browser.newContext({ viewport: { width: 720, height: 1000 }, locale: 'ko-KR', colorScheme: 'light' });
const page = await context.newPage();
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error)}`));
await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

/** 설정을 심고 한 판을 끝까지 돌린다. */
async function runRace({ map, people, mode = 'first', losers = 1, shot = '' }) {
  await page.evaluate(({ map, people, mode, losers }) => {
    const names = Array.from({ length: 12 }, (_, index) => `${index + 1}번`);
    localStorage.setItem('tip.games.race-game.v1', JSON.stringify({ people, losers, names, map, mode }));
    location.hash = '#/race-game';
  }, { map, people, mode, losers });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.gm-map', { timeout: 10000 });
  await page.click('#gm-start');
  await page.waitForTimeout(300);
  await page.click('.rc-speed-btn[data-speed="2"]');

  const started = Date.now();
  let maxCam = 0;
  let firstCam = 0;
  let sawPhoto = false;
  let peakStuck = 0;
  let peakStalls = 0;
  let stallSpot = '';
  let peakNudges = 0;
  let shotsTaken = 0;
  let done = false;
  while (Date.now() - started < 60000) {
    const state = await page.evaluate(() => {
      const root = document.querySelector('.rc');
      if (!root) return null;
      return {
        cam: Number(root.dataset.cam || 0),
        phase: root.dataset.phase || '',
        stuck: Number(root.dataset.stuck || 0),
        nudges: Number(root.dataset.nudges || 0),
        stalls: String(root.dataset.stalls || '0.0@0'),
        forced: root.dataset.forced || '0',
        arrived: Number(root.dataset.arrived || 0),
        duration: Number(root.dataset.duration || 0),
        summary: !!document.querySelector('#rc-summary'),
      };
    });
    if (!state) break;
    if (!firstCam) firstCam = state.cam;
    maxCam = Math.max(maxCam, state.cam);
    peakStuck = Math.max(peakStuck, state.stuck);
    peakStalls = Math.max(peakStalls, parseFloat(state.stalls) || 0);
    stallSpot = state.stalls;
    peakNudges = Math.max(peakNudges, state.nudges);
    if (state.phase === 'photo') sawPhoto = true;
    if (shot && !shotsTaken && state.duration > 6) {
      shotsTaken = 1;
      await page.screenshot({ path: join(SHOTS, `${shot}-run.png`) }).catch(() => {});
    }
    if (state.summary) {
      done = true;
      const rows = await page.evaluate(() => {
        const board = [...document.querySelectorAll('#rc-summary .rc-board-row')];
        return {
          total: board.length,
          win: board.filter((row) => !row.classList.contains('is-lose')).length,
          text: board.map((row) => row.textContent.replace(/\s+/g, ' ').trim()),
          note: document.querySelector('#rc-summary .gm-result-note')?.textContent || '',
          pods: document.querySelectorAll('#rc-summary .rc-pod').length,
        };
      });
      if (shot) await page.screenshot({ path: join(SHOTS, `${shot}-done.png`) }).catch(() => {});
      return { ...state, rows, real: Date.now() - started, maxCam, firstCam, sawPhoto, peakStuck, peakStalls, stallSpot, peakNudges, done };
    }
    await page.waitForTimeout(80);
  }
  return { done, maxCam, firstCam, sawPhoto, peakStuck, peakStalls, stallSpot, peakNudges, rows: null, real: Date.now() - started };
}

/* ------------------------------ 4맵 × 4·12명 반복 ------------------------------ */

const summary = [];
for (const map of MAPS) {
  for (const people of [4, 12]) {
    for (let round = 1; round <= REPEAT; round += 1) {
      const shot = round === 1 ? `race-${map.id}-${people}` : '';
      const run = await runRace({ map: map.id, people, shot });
      summary.push({ map: map.name, people, round, ...run });
      const label = `${map.name} ${people}명 #${round}`;
      const finished = run.done && run.rows && run.rows.total === people;
      check(`${label} — 전원 골인`, finished,
        run.rows ? `${run.rows.total}명 / ${run.real}ms / ${run.rows.note}` : `${run.real}ms 안에 결과 없음`);
      check(`${label} — 끼임·강제 종료 0건`, run.peakStalls < 3 && run.peakNudges === 0
        && (run.forced === undefined || run.forced === '0'),
        `가장 오래 멈칫 ${run.stallSpot}초 / 탈출 보정 ${run.peakStuck}회 / 강제 ${run.forced || '0'}`);
      check(`${label} — 카메라가 따라감`, run.maxCam > (map.id === 'sprint' || map.id === 'circuit' ? 300 : 400),
        `카메라 ${Math.round(run.maxCam)}`);
    }
  }
}

/* ------------------------------ 판정 방식 3가지 ------------------------------ */

const modes = [
  { mode: 'first', losers: 2, win: 2, label: '선착순(뒤 2명 꽝)' },
  { mode: 'last', losers: 2, win: 2, label: '꼴찌 당첨(마지막 2명)' },
  { mode: 'solo', losers: 1, win: 1, label: '1등만 당첨' },
];
for (const option of modes) {
  const run = await runRace({ map: 'pinball', people: 4, mode: option.mode, losers: option.losers, shot: `race-mode-${option.mode}` });
  check(`판정 ${option.label} — 당첨 ${option.win}명`, !!run.rows && run.rows.win === option.win && run.rows.total === 4,
    run.rows ? `당첨 ${run.rows.win}명 · ${run.rows.note}` : '결과 없음');
  check(`판정 ${option.label} — 슬로우 모션`, run.sawPhoto, `phase=photo ${run.sawPhoto ? '확인' : '못 봄'}`);
}

/* ------------------------------ 한 판 길이 ------------------------------ */

summary.forEach((run) => {
  const good = run.duration >= 11 && run.duration <= 24;
  check(`${run.map} ${run.people}명 #${run.round} — 12~22초`, good, `${run.duration.toFixed(1)}초`);
});

check('콘솔 오류 없음', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((item) => !item.ok);
console.log('');
const durations = summary.map((run) => run.duration);
console.log(`한 판 길이 — ${Math.min(...durations).toFixed(1)}~${Math.max(...durations).toFixed(1)}초 (게임 시간, 2x 로 실행)`);
console.log(`못 내려온 횟수 ${Math.max(...summary.map((run) => run.peakStalls))}회 · 탈출 보정 최다 ${Math.max(...summary.map((run) => run.peakStuck))}회 · 강제 종료 ${summary.filter((run) => run.forced === '1').length}판`);
console.log(`스크린샷 — ${SHOTS}`);
console.log(`TIP 선착순 골인 스트레스 — 통과 ${results.length - failed.length} / 실패 ${failed.length}`);
if (failed.length) {
  failed.forEach((item, index) => console.log(`  ${index + 1}. ✗ ${item.name}  — ${item.detail}`));
}

await context.close();
await browser.close();
server.close();
process.exit(failed.length ? 1 : 0);
