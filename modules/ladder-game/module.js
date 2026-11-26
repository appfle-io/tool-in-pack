/*
 * TIP · 사다리타기 (ladder-game, v1.21.0)
 *
 * 사람 수(2~30)와 꽝 개수를 정하면 겹치지 않는 사다리를 새로 긋는다.
 * v1.21.0
 *   · 시작 전에는 가운데 가로대를 가림막으로 완전히 가린다(미리 길을 따라가 보지 못하게).
 *   · 준비 화면에 들어올 때 순서를 한 번 섞고, [셔플] 을 누를 때마다 다시 섞는다.
 *     [시작] 을 누르면 더 섞지 않고 그 자리에서 가림막이 열리며 모두 내려간다.
 *   · 22~30명이면 기둥 간격을 28px 아래로 줄이지 않고 가로로 스크롤한다.
 *
 * 위쪽 이름을 누르면 그 사람의 캐릭터가 다시 사다리를 타고 내려오고,
 * 지나간 길은 색 궤적으로 남는다. 결과는 가리거나 다시 공개할 수 있다.
 *
 * 가로대는 모든 이웃한 기둥 사이에 2개 이상 들어가고, 어느 칸도 가로대 없이
 * 곧장 내려가지 않게 만든다(공정한 난수, crypto).
 * 격자·경로·캐릭터는 HiDPI 캔버스에 그리고, 글자는 화면 배율과 상관없이 선명하게 얹는다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, loserSlots, escapeText, shuffle,
  soundButton, bindSound, sfx, createConfetti, drawBadge, drawCharacter,
  paintAvatars, characterColor,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18M17 3v18"/><path d="M7 7h10M7 12h10M7 17h10"/></svg>`;

const MIN_RUNGS_PER_PAIR = 2;
const BAND = 40;          // 위쪽 캐릭터 배지 띠
const FOOT = 14;          // 아래 여백
const REVEAL_MS = 460;    // 가림막이 열린 뒤 캐릭터가 내려가기까지

/* ------------------------------ 사다리 만들기 ------------------------------ */

/** 한 줄에 놓을 수 있는 자리인지 — 이웃한 가로대와 붙으면 안 된다. */
function rungFree(row, column, people) {
  if (column < 0 || column >= people - 1) return false;
  return !(row.includes(column) || row.includes(column - 1) || row.includes(column + 1));
}

function addRung(row, column) {
  row.push(column);
  row.sort((a, b) => a - b);
}

/** 위 칸에서 시작해 줄을 따라 내려간 끝 칸. */
function walk(start, rungs) {
  let column = start;
  const steps = [];
  for (let row = 0; row < rungs.length; row += 1) {
    if (rungs[row].includes(column)) {
      steps.push({ from: column, to: column + 1, row });
      column += 1;
    } else if (column > 0 && rungs[row].includes(column - 1)) {
      steps.push({ from: column, to: column - 1, row });
      column -= 1;
    }
  }
  return { end: column, steps };
}

/**
 * 균형 가로대.
 * 1) 줄마다 이웃과 붙지 않게 난수로 놓고
 * 2) 이웃한 기둥 쌍마다 최소 2개를 채우고
 * 3) 어느 칸도 가로대를 한 번도 만나지 않고 곧장 내려가지 않게 고친다.
 * 조건이 안 맞으면 처음부터 다시 그린다(무작위라 매번 성공하지는 않는다).
 */
function attemptRungs(people, rows) {
  const grid = Array.from({ length: rows }, () => []);

  for (let row = 0; row < rows; row += 1) {
    let column = 0;
    while (column < people - 1) {
      if (Math.random() < 0.5 && rungFree(grid[row], column, people)) {
        addRung(grid[row], column);
        column += 2;
      } else {
        column += 1;
      }
    }
  }

  const countPair = (pair) => grid.reduce((sum, row) => sum + (row.includes(pair) ? 1 : 0), 0);

  // 2) 이웃한 쌍마다 2개 이상
  for (let pair = 0; pair < people - 1; pair += 1) {
    let guard = 0;
    while (countPair(pair) < MIN_RUNGS_PER_PAIR && guard < rows * 4) {
      guard += 1;
      const open = [];
      for (let row = 0; row < rows; row += 1) {
        if (rungFree(grid[row], pair, people)) open.push(row);
      }
      if (!open.length) {
        // 이 쌍을 놓을 줄이 없으면, 이웃한 가로대가 겹치는 줄에서 하나를 비켜 준다.
        const donor = grid
          .map((line, row) => ({ line, row }))
          .find(({ line }) => (line.includes(pair - 1) && countPair(pair - 1) > MIN_RUNGS_PER_PAIR)
            || (line.includes(pair + 1) && countPair(pair + 1) > MIN_RUNGS_PER_PAIR));
        if (!donor) break;
        const target = donor.line.includes(pair - 1) ? pair - 1 : pair + 1;
        donor.line.splice(donor.line.indexOf(target), 1);
        continue;
      }
      addRung(grid[open[Math.floor(Math.random() * open.length)]], pair);
    }
  }

  // 3) 곧장 내려가는 칸을 없앤다.
  for (let guard = 0; guard < 30; guard += 1) {
    const straight = [];
    for (let start = 0; start < people; start += 1) {
      if (walk(start, grid).steps.length === 0) straight.push(start);
    }
    if (!straight.length) break;
    const start = straight[0];
    const options = [];
    for (const column of [start, start - 1]) {
      if (column < 0 || column >= people - 1) continue;
      for (let row = 0; row < rows; row += 1) {
        if (rungFree(grid[row], column, people)) options.push({ row, column });
      }
    }
    if (!options.length) break;
    const middle = options.filter((item) => item.row > rows * 0.25 && item.row < rows * 0.75);
    const pool = middle.length ? middle : options;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    addRung(grid[pick.row], pick.column);
  }

  return grid;
}

function rungStats(grid, people) {
  let minPair = Infinity;
  for (let pair = 0; pair < people - 1; pair += 1) {
    const count = grid.reduce((sum, row) => sum + (row.includes(pair) ? 1 : 0), 0);
    minPair = Math.min(minPair, count);
  }
  let straight = 0;
  for (let start = 0; start < people; start += 1) {
    if (walk(start, grid).steps.length === 0) straight += 1;
  }
  return { minPair, straight };
}

function makeRungs(people, rows) {
  let best = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const grid = attemptRungs(people, rows);
    const stats = rungStats(grid, people);
    const score = stats.minPair * 10 - stats.straight * 6;
    if (!best || score > best.score) best = { rungs: grid, score };
    if (stats.minPair >= MIN_RUNGS_PER_PAIR && stats.straight === 0) return grid;
  }
  return best.rungs;
}

function mixPaths(people, rows) {
  let best = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rungs = makeRungs(people, rows);
    const ends = Array.from({ length: people }, (_, index) => walk(index, rungs).end);
    const spread = new Set(ends).size;
    const distinct = ends.every((end, index) => end !== index);
    const score = spread * 2 + (distinct ? 1 : 0);
    if (!best || score > best.score) best = { rungs, ends, score };
    if (distinct && spread >= Math.min(people, 4)) break;
  }
  return { rungs: best.rungs, ends: best.ends };
}

/** 캔버스 글자·선 색을 지금 테마에서 읽는다. */
function readInk() {
  const style = getComputedStyle(document.documentElement);
  const value = (name, fallback) => (style.getPropertyValue(name) || '').trim() || fallback;
  const paths = [];
  for (let index = 1; index <= 8; index += 1) paths.push(value(`--gm-path-${index}`, '#2E5E4E'));
  return {
    paths,
    rail: value('--gm-rail', '#C9A783'),
    railEdge: value('--gm-rail-edge', '#A9855F'),
    railHi: value('--gm-rail-hi', '#E7D2B5'),
    rung: value('--gm-rung', '#BF9B76'),
    rungHi: value('--gm-rung-hi', '#EBD8C0'),
    ink: value('--text', '#1C1C1E'),
    muted: value('--muted', '#6C6C70'),
    accent: value('--accent', '#2E5E4E'),
    card: value('--card', '#FFFFFF'),
    card2: value('--card-2', '#F7F7FA'),
    warn: value('--warn', '#C93400'),
    dark: document.documentElement.getAttribute('data-theme') === 'dark',
  };
}

const module = {
  id: 'ladder-game',
  name: '사다리타기',
  shortName: '사다리',
  kind: 'tool',
  category: 'game',
  version: '1.21.0',
  subtitle: '길을 따라 내려가기',
  description: '사람 수와 꽝 개수를 정해 사다리를 긋습니다. 시작 전에는 가로대를 가려 두고, 셔플로 출발 자리를 바꾼 뒤 시작하면 가림막이 열리며 캐릭터들이 내려갑니다. 결과는 가렸다가 다시 공개할 수 있습니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx && typeof ctx.toast === 'function' ? ctx.toast : () => {};
    const host = document.createElement('div');
    host.className = 'gm-root';
    root.append(host);
    bindSound(host, signal);

    let setup = null;
    let seats = [];            // [{ name, who }] — who 는 처음 입력 순번(캐릭터·색)
    let ladder = null;         // { rows, rungs, ends, outcomes }
    let shuffles = 0;
    let revealed = false;
    let canvas = null;
    let ctx2d = null;
    let metrics = null;
    let ink = readInk();
    let traced = new Map();    // 자리 -> { progress, points, lengths, total, colorIndex, done, t }
    let resultVisible = false;
    let summaryShown = false;
    let raf = 0;
    let lastTime = 0;
    let revealTimer = 0;
    let observer = null;
    let themeObserver = null;
    let live = true;
    const confetti = createConfetti();

    function stopFrame() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastTime = 0;
    }

    /* ------------------------------ 설정 ------------------------------ */

    function showSetup() {
      stopFrame();
      clearTimeout(revealTimer);
      ladder = null;
      seats = [];
      traced = new Map();
      revealed = false;
      resultVisible = false;
      summaryShown = false;
      confetti.clear();
      setupScreen(host, {
        gameId: 'ladder-game',
        hint: '셔플로 순서를 바꾸고 시작을 누르세요.',
        signal,
        onStart: (next) => start(next),
      });
    }

    function start(next) {
      setup = next;
      seats = next.names.slice(0, next.people).map((name, who) => ({ name, who }));
      shuffles = 1;             // 준비 화면에서 이미 한 번 섞인 상태
      deal();
      renderPlay();
    }

    /** 꽝 칸을 새로 뽑고 사다리를 새로 긋는다. 자리 순서는 그대로 둔다. */
    function deal() {
      const people = setup.people;
      const losers = loserSlots(people, setup.losers);
      const rows = Math.max(9, Math.min(13, people + 4));
      const mix = mixPaths(people, rows);
      ladder = {
        rows,
        rungs: mix.rungs,
        ends: mix.ends,
        outcomes: Array.from({ length: people }, (_, slot) => losers.has(slot)),
      };
      traced = new Map();
      revealed = false;
      resultVisible = false;
      summaryShown = false;
      confetti.clear();
    }

    /** 다시하기 — 새 판을 준비하면서 자리도 한 번 섞어 둔다. */
    function retry() {
      if (!setup) return;
      stopFrame();
      clearTimeout(revealTimer);
      seats = shuffle(seats);
      shuffles += 1;
      deal();
      renderPlay();
    }

    /** 자리 섞기(수동 셔플) — 시작 전에만. 가로대는 그대로 두고 사람만 옮긴다. */
    function shuffleSeats() {
      if (!ladder || revealed) return;
      seats = shuffle(seats);
      shuffles += 1;
      paintNames();
      measure();
      draw(performance.now());
      syncRoot();
      sfx.flip();
      announce(`${shuffles}번째로 순서를 섞었습니다.`);
    }

    /* ------------------------------ 화면 ------------------------------ */

    function syncRoot() {
      const rootEl = host.querySelector('.ld');
      if (!rootEl) return;
      rootEl.dataset.people = String(setup ? setup.people : 0);
      rootEl.dataset.shuffles = String(shuffles);
      rootEl.dataset.order = seats.map((seat) => seat.name).join('|');
      rootEl.dataset.revealed = revealed ? '1' : '0';
      rootEl.dataset.curtain = revealed ? 'open' : 'closed';
    }

    function renderPlay() {
      stopFrame();
      host.innerHTML = `
        <div class="gm ld">
          <div class="gm-hud" id="ld-hud">
            ${hudStat('사람', String(setup.people), 'left')}
            ${hudStat('당첨', String(setup.people - setup.losers), 'win')}
            ${hudStat('꽝', String(setup.losers), 'lose')}
            ${soundButton()}
          </div>
          <div class="ld-frame" id="ld-frame">
            <div class="ld-stage" id="ld-stage">
              <div class="ld-inner" id="ld-inner">
                <div class="ld-names" id="ld-names"></div>
                <div class="ld-board" id="ld-board"><canvas class="ld-canvas" id="ld-canvas"></canvas></div>
                <div class="ld-outs" id="ld-outs"></div>
                <div class="ld-curtain" id="ld-curtain"></div>
              </div>
            </div>
            <div class="ld-veil" id="ld-veil">
              <div class="ld-veil-card">
                <span class="ld-curtain-marks" aria-hidden="true">? ? ? ? ?</span>
                <p class="ld-curtain-text">시작하면 사다리가 공개됩니다</p>
                <button class="v16-btn primary ld-start" type="button" id="ld-start">시작</button>
              </div>
            </div>
          </div>
          <p class="gm-lead" id="ld-lead">셔플로 자리를 바꾼 뒤 시작을 누르면 가림막이 열리고 모두 내려갑니다.</p>
          <div class="gm-actions">
            <button class="v16-btn" type="button" id="ld-shuffle">셔플</button>
            <button class="v16-btn" type="button" id="ld-toggle" disabled>결과 공개</button>
            <button class="v16-btn" type="button" data-act="setup">설정 바꾸기</button>
          </div>
          <div id="ld-result"></div>
          <p class="gm-live sr-only" id="ld-live" role="status" aria-live="polite"></p>
        </div>`;

      canvas = host.querySelector('#ld-canvas');
      ctx2d = canvas ? canvas.getContext('2d') : null;
      ink = readInk();
      paintNames();
      measure();
      draw();
      watchResize();
      syncRoot();
    }

    function paintNames() {
      const namesEl = host.querySelector('#ld-names');
      const outsEl = host.querySelector('#ld-outs');
      if (!namesEl || !outsEl) return;
      namesEl.innerHTML = seats.map((seat, index) => `
        <button class="ld-name" type="button" data-index="${index}" data-who="${seat.who}"
                aria-label="${escapeText(seat.name)} ${revealed ? '다시 따라가기' : '길 따라가기'}"
                ${revealed ? '' : 'disabled'}
                style="--who: ${characterColor(seat.who)}">
          <span class="ld-name-text">${escapeText(seat.name)}</span>
        </button>`).join('');
      outsEl.innerHTML = seats.map((seat, index) => {
        const lose = ladder.outcomes[index];
        return `<span class="ld-out${lose ? ' is-lose' : ' is-win'}" data-slot="${index}"
                      aria-label="이 자리는 ${lose ? '꽝' : '당첨'}">?</span>`;
      }).join('');
    }

    function measure() {
      const stage = host.querySelector('#ld-stage');
      const inner = host.querySelector('#ld-inner');
      const board = host.querySelector('#ld-board');
      const namesEl = host.querySelector('#ld-names');
      const outsEl = host.querySelector('#ld-outs');
      const curtain = host.querySelector('#ld-curtain');
      const veil = host.querySelector('#ld-veil');
      if (!stage || !inner || !ladder) return;
      const people = setup.people;
      const rows = ladder.rungs.length;
      const avail = Math.max(200, stage.clientWidth - 2);
      // 기둥 간격은 28px 아래로 줄이지 않는다 — 좁아지면 이름과 배지가 겹친다.
      const minStep = people > 24 ? 28 : people > 16 ? 30 : 34;
      const basePad = Math.max(14, Math.min(30, avail * 0.05));
      const fitStep = (avail - basePad * 2) / Math.max(1, people - 1);
      const step = fitStep >= minStep ? Math.min(64, fitStep) : minStep;
      const width = fitStep >= minStep ? avail : basePad * 2 + minStep * (people - 1);
      const padX = fitStep >= minStep ? (width - step * (people - 1)) / 2 : basePad;
      const rowStep = Math.max(22, Math.min(40, 340 / rows));
      const avatarR = Math.max(8.5, Math.min(17, step * 0.42, rowStep * 0.6));
      const height = Math.round(BAND + rows * rowStep + Math.max(avatarR * 2.6, 26) + FOOT);
      const stacked = step < 46 && people > 8;
      const headerH = stacked ? 46 : 34;
      const footerH = 32;
      metrics = {
        width, rows, padX, rowStep, height, step, avatarR, stacked, headerH,
        top: BAND,
        bottom: BAND + rows * rowStep,
        x: (column) => padX + column * step,
        y: (row) => BAND + (row + 0.5) * rowStep,
        badgeY: BAND * 0.52,
      };

      inner.style.width = `${width}px`;
      if (board) board.style.paddingTop = `${headerH}px`;
      if (namesEl) namesEl.style.height = `${headerH}px`;
      if (outsEl) outsEl.style.height = `${footerH - 6}px`;
      if (curtain) {
        curtain.style.top = `${headerH}px`;
        curtain.style.height = `${height}px`;
      }
      if (veil) {
        veil.style.top = `${headerH}px`;
        veil.style.bottom = `${footerH}px`;
      }

      if (canvas) {
        const ratio = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        if (ctx2d) ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      stage.classList.toggle('is-stacked', stacked);
      if (namesEl) {
        namesEl.querySelectorAll('.ld-name').forEach((button, index) => {
          button.style.left = `${metrics.x(index)}px`;
          button.style.maxWidth = `${Math.max(26, (stacked ? step * 1.75 : step) - 2)}px`;
          button.style.top = stacked && index % 2 ? '20px' : '0px';
          button.classList.toggle('is-narrow', stacked);
          button.title = seats[index].name;
        });
      }
      if (outsEl) {
        outsEl.querySelectorAll('.ld-out').forEach((chip, index) => {
          chip.style.left = `${metrics.x(index)}px`;
          chip.style.maxWidth = `${Math.max(22, step - 2)}px`;
        });
      }
      host.querySelectorAll('.ld-name-text').forEach((node) => {
        node.classList.toggle('is-short', step < 44);
      });
    }

    /* ------------------------------ 그리기 ------------------------------ */

    function pathPoints(index) {
      const points = [{ x: metrics.x(index), y: metrics.top }];
      let column = index;
      ladder.rungs.forEach((line, row) => {
        if (line.includes(column)) {
          points.push({ x: metrics.x(column), y: metrics.y(row) });
          column += 1;
          points.push({ x: metrics.x(column), y: metrics.y(row) });
        } else if (column > 0 && line.includes(column - 1)) {
          points.push({ x: metrics.x(column), y: metrics.y(row) });
          column -= 1;
          points.push({ x: metrics.x(column), y: metrics.y(row) });
        }
      });
      points.push({ x: metrics.x(column), y: metrics.bottom });
      return points;
    }

    function measurePath(points) {
      const lengths = [];
      let total = 0;
      for (let index = 1; index < points.length; index += 1) {
        const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
        lengths.push(length);
        total += length;
      }
      return { lengths, total };
    }

    /** 경로 위 progress 지점 — 좌우로 갈 때는 몸을 기울인다. */
    function pointOnPath(state) {
      const { points, lengths, progress } = state;
      let left = state.total * Math.max(0, Math.min(1, progress));
      for (let index = 1; index < points.length; index += 1) {
        const length = lengths[index - 1];
        if (left <= length || index === points.length - 1) {
          const ratio = length ? Math.min(1, left / length) : 1;
          const from = points[index - 1];
          const to = points[index];
          return {
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio,
            tilt: Math.abs(to.x - from.x) > 0.5 ? Math.sign(to.x - from.x) * 0.55 : 0,
            moving: progress < 1,
          };
        }
        left -= length;
      }
      return { x: points[0].x, y: points[0].y, tilt: 0, moving: false };
    }

    function strokePath(points, progress, color, options = {}) {
      if (!ctx2d || points.length < 2) return;
      const { lengths, total } = options.measured || measurePath(points);
      let left = total * Math.max(0, Math.min(1, progress));
      ctx2d.save();
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.strokeStyle = color;
      if (options.glow) {
        ctx2d.globalAlpha = options.alpha == null ? 0.32 : options.alpha;
        ctx2d.lineWidth = options.width ? options.width + 3.4 : 6.4;
        ctx2d.shadowColor = color;
        ctx2d.shadowBlur = 9;
      } else {
        ctx2d.globalAlpha = options.alpha == null ? 1 : options.alpha;
        ctx2d.lineWidth = options.width || 3.2;
      }
      ctx2d.beginPath();
      ctx2d.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length && left > 0; index += 1) {
        const length = lengths[index - 1];
        const from = points[index - 1];
        const to = points[index];
        const ratio = length ? Math.min(1, left / length) : 1;
        ctx2d.lineTo(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
        left -= length;
      }
      ctx2d.stroke();
      ctx2d.restore();
    }

    function drawLadder() {
      const { top, bottom, rowStep } = metrics;
      const railWidth = Math.max(4.5, Math.min(9, rowStep * 0.28, metrics.step * 0.36));
      ctx2d.save();
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';

      // 바닥 그림자
      ctx2d.strokeStyle = ink.dark ? 'rgba(0,0,0,0.35)' : 'rgba(80,60,40,0.10)';
      ctx2d.lineWidth = railWidth + 2;
      ctx2d.beginPath();
      for (let column = 0; column < setup.people; column += 1) {
        ctx2d.moveTo(metrics.x(column), top + 1.5);
        ctx2d.lineTo(metrics.x(column), bottom + 1.5);
      }
      ladder.rungs.forEach((line, row) => {
        line.forEach((start) => {
          ctx2d.moveTo(metrics.x(start), metrics.y(row) + 1.5);
          ctx2d.lineTo(metrics.x(start + 1), metrics.y(row) + 1.5);
        });
      });
      ctx2d.stroke();

      // 나무 레일 — 바탕 · 테두리 · 하이라이트
      const railGradient = ctx2d.createLinearGradient(0, top, 0, bottom);
      railGradient.addColorStop(0, ink.rail);
      railGradient.addColorStop(1, ink.railEdge);

      ctx2d.strokeStyle = ink.railEdge;
      ctx2d.lineWidth = railWidth + 1.6;
      ctx2d.beginPath();
      for (let column = 0; column < setup.people; column += 1) {
        ctx2d.moveTo(metrics.x(column), top);
        ctx2d.lineTo(metrics.x(column), bottom);
      }
      ladder.rungs.forEach((line, row) => {
        line.forEach((start) => {
          ctx2d.moveTo(metrics.x(start) - railWidth * 0.28, metrics.y(row));
          ctx2d.lineTo(metrics.x(start + 1) + railWidth * 0.28, metrics.y(row));
        });
      });
      ctx2d.stroke();

      ctx2d.strokeStyle = railGradient;
      ctx2d.lineWidth = railWidth;
      ctx2d.beginPath();
      for (let column = 0; column < setup.people; column += 1) {
        ctx2d.moveTo(metrics.x(column), top);
        ctx2d.lineTo(metrics.x(column), bottom);
      }
      ctx2d.stroke();

      ctx2d.strokeStyle = ink.rung;
      ctx2d.lineWidth = railWidth * 0.92;
      ctx2d.beginPath();
      ladder.rungs.forEach((line, row) => {
        line.forEach((start) => {
          ctx2d.moveTo(metrics.x(start), metrics.y(row));
          ctx2d.lineTo(metrics.x(start + 1), metrics.y(row));
        });
      });
      ctx2d.stroke();

      // 반사광 — 위쪽 가장자리를 밝게
      ctx2d.strokeStyle = ink.railHi;
      ctx2d.globalAlpha = ink.dark ? 0.4 : 0.75;
      ctx2d.lineWidth = Math.max(1.6, railWidth * 0.3);
      ctx2d.beginPath();
      for (let column = 0; column < setup.people; column += 1) {
        ctx2d.moveTo(metrics.x(column) - railWidth * 0.24, top + 2);
        ctx2d.lineTo(metrics.x(column) - railWidth * 0.24, bottom - 2);
      }
      ladder.rungs.forEach((line, row) => {
        line.forEach((start) => {
          ctx2d.moveTo(metrics.x(start) + railWidth * 0.3, metrics.y(row) - railWidth * 0.26);
          ctx2d.lineTo(metrics.x(start + 1) - railWidth * 0.3, metrics.y(row) - railWidth * 0.26);
        });
      });
      ctx2d.stroke();
      ctx2d.restore();

      // 위·아래 끈 — 사다리가 매달린 느낌
      ctx2d.save();
      ctx2d.strokeStyle = ink.railEdge;
      ctx2d.globalAlpha = 0.5;
      ctx2d.lineWidth = 1.6;
      ctx2d.beginPath();
      for (let column = 0; column < setup.people; column += 1) {
        ctx2d.moveTo(metrics.x(column), top - metrics.avatarR * 0.4);
        ctx2d.lineTo(metrics.x(column), top);
        ctx2d.moveTo(metrics.x(column), bottom);
        ctx2d.lineTo(metrics.x(column), bottom + 4);
      }
      ctx2d.stroke();
      ctx2d.restore();
    }

    function draw(time) {
      if (!ctx2d || !metrics) return;
      const { width, height } = metrics;
      ctx2d.clearRect(0, 0, width, height);

      drawLadder();

      // 따라간 길 — 이름을 누른 순서대로 색을 나눠 겹쳐도 구분된다.
      traced.forEach((state) => {
        const color = ink.paths[state.colorIndex % ink.paths.length];
        if (state.done) strokePath(state.points, 1, color, { glow: true, alpha: 0.2, measured: state });
        strokePath(state.points, state.progress, color, { glow: true, alpha: 0.4, measured: state });
        strokePath(state.points, state.progress, color, { width: 3.2, measured: state });
      });

      // 위쪽 캐릭터 배지 — 내려간 사람은 흐리게
      for (let index = 0; index < setup.people; index += 1) {
        const state = traced.get(index);
        const alpha = state ? 0.28 : 1;
        drawBadge(ctx2d, seats[index].who, metrics.x(index), metrics.badgeY, metrics.avatarR, {
          mood: 'idle',
          bg: ink.card,
          alpha,
          t: time,
        });
      }

      // 내려가는 캐릭터
      traced.forEach((state, index) => {
        const spot = pointOnPath(state);
        const mood = state.done ? (ladder.outcomes[ladder.ends[index]] ? 'lose' : 'win') : 'run';
        const bob = state.done ? 0 : Math.sin(time / 130 + index) * 1.2;
        drawCharacter(ctx2d, seats[index].who, spot.x, spot.y + bob, metrics.avatarR * 1.62, {
          mood,
          tilt: (spot.tilt || 0) + (state.done ? 0 : Math.sin(time / 240 + index) * 0.05),
          t: time,
          sparkle: mood === 'win',
        });
      });

      confetti.draw(ctx2d);
    }

    /* ------------------------------ 따라가기 ------------------------------ */

    function colorIndexFor(index) {
      const used = new Set([...traced.values()].map((state) => state.colorIndex));
      for (let step = 0; step < ink.paths.length; step += 1) {
        const candidate = (index + step) % ink.paths.length;
        if (!used.has(candidate)) return candidate;
      }
      return index % ink.paths.length;
    }

    function beginTrace(index, colorIndex, delay = 0) {
      if (!ladder || traced.has(index)) return;
      const points = pathPoints(index);
      const { lengths, total } = measurePath(points);
      traced.set(index, {
        progress: 0,
        points,
        lengths,
        total,
        delay,
        colorIndex: colorIndex == null ? colorIndexFor(index) : colorIndex,
        duration: 0.95 + ladder.rungs.length * 0.055,
        done: false,
      });
    }

    /** 이름을 누르면 그 자리 사람이 다시 내려온다(이미 본 길을 다시 보여 줄 뿐이다). */
    function trace(index) {
      if (!ladder) return;
      if (!revealed) {
        toast('시작을 누르면 사다리가 열립니다');
        return;
      }
      const state = traced.get(index);
      if (state) {
        state.progress = 0;
        state.done = false;
        state.delay = 0;
      } else {
        beginTrace(index);
      }
      sfx.click();
      startFrame();
    }

    function traceAll() {
      if (!ladder) return;
      const order = Array.from({ length: setup.people }, (_, index) => index);
      order.forEach((index, slot) => beginTrace(index, (index + slot) % ink.paths.length, slot * 0.08));
      sfx.whoosh();
      startFrame();
    }

    function startFrame() {
      if (raf) return;
      lastTime = 0;
      raf = requestAnimationFrame(frame);
    }

    function frame(now) {
      raf = 0;
      if (!ladder || !metrics) return;
      const delta = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0.016;
      lastTime = now;
      let moving = false;
      const finishedNow = [];
      traced.forEach((state, index) => {
        if (state.done) return;
        if (state.delay > 0) {
          state.delay = Math.max(0, state.delay - delta);
          moving = true;
          return;
        }
        state.progress = Math.min(1, state.progress + delta / state.duration);
        if (state.progress >= 1) {
          state.done = true;
          finishedNow.push(index);
        } else {
          moving = true;
        }
      });
      if (confetti.step(delta)) moving = true;
      draw(now);
      finishedNow.forEach((index) => onTraced(index));
      if (moving) raf = requestAnimationFrame(frame);
    }

    function onTraced(index) {
      const end = ladder.ends[index];
      const lose = ladder.outcomes[end];
      const name = seats[index].name;
      revealSlot(end);
      announce(`${name} ${lose ? '꽝' : '당첨'}`);
      if (lose) sfx.lose();
      else sfx.win();
      if (metrics) {
        const x = metrics.x(end);
        const y = metrics.bottom - metrics.avatarR;
        if (lose) confetti.burst(x, y, { count: 8, speed: 110, spread: Math.PI, gravity: 320 });
        else confetti.burst(x, y, { count: 26, speed: 210, spread: Math.PI });
      }
      if (traced.size === setup.people && [...traced.values()].every((state) => state.done)) {
        setTimeout(() => finish(), 260);
      }
    }

    function paintToggle() {
      const toggle = host.querySelector('#ld-toggle');
      if (toggle) {
        toggle.textContent = resultVisible ? '결과 가리기' : '결과 공개';
        toggle.disabled = !revealed;
      }
    }

    /** 칸 하나의 결과만 연다. 모두 열리면 단추도 '결과 가리기'가 된다. */
    function revealSlot(slot) {
      const chip = host.querySelector(`.ld-out[data-slot="${slot}"]`);
      if (!chip || chip.classList.contains('is-open')) return;
      const lose = ladder.outcomes[slot];
      const wide = metrics && metrics.step >= 46;
      chip.textContent = wide ? (lose ? '꽝' : '당첨') : (lose ? 'X' : 'O');
      chip.classList.add('is-open');
      chip.setAttribute('aria-label', `이 자리는 ${lose ? '꽝' : '당첨'}`);
      if (!host.querySelector('.ld-out:not(.is-open)')) {
        resultVisible = true;
        paintToggle();
      }
    }

    /** 칸 전부를 연다(결과 공개). */
    function revealResults() {
      resultVisible = true;
      for (let slot = 0; slot < setup.people; slot += 1) revealSlot(slot);
      paintToggle();
    }

    /** 칸 전부를 다시 가리고 요약도 감춘다. */
    function hideResults() {
      resultVisible = false;
      host.querySelectorAll('.ld-out').forEach((chip) => {
        const slot = Number(chip.dataset.slot);
        const lose = ladder.outcomes[slot];
        chip.textContent = '?';
        chip.classList.remove('is-open');
        chip.setAttribute('aria-label', `이 자리는 ${lose ? '꽝' : '당첨'}`);
      });
      const box = host.querySelector('#ld-result');
      if (box) box.innerHTML = '';
      summaryShown = false;
      paintToggle();
    }

    function finish() {
      if (summaryShown) return;
      summaryShown = true;
      const box = host.querySelector('#ld-result');
      if (!box) return;
      const entries = seats.map((seat, index) => ({
        name: seat.name,
        lose: ladder.outcomes[ladder.ends[index]],
        index: seat.who,
      }));
      const wins = entries.filter((entry) => !entry.lose).length;
      box.innerHTML = resultPanel({
        id: 'ld-summary',
        entries,
        note: `${wins}명 당첨, ${entries.length - wins}명 꽝`,
      });
      paintAvatars(box);
      sfx.fanfare();
    }

    function announce(text) {
      const liveEl = host.querySelector('#ld-live');
      if (liveEl) liveEl.textContent = text;
    }

    /* ------------------------------ 가림막 ------------------------------ */

    /** 시작 — 더 섞지 않는다. 가림막을 열고 그 자리 그대로 모두 내려가게 한다. */
    function revealStart() {
      if (!ladder || revealed) return;
      revealed = true;
      const curtain = host.querySelector('#ld-curtain');
      if (curtain) curtain.classList.add('is-open');
      const veil = host.querySelector('#ld-veil');
      if (veil) veil.classList.add('is-open');
      const lead = host.querySelector('#ld-lead');
      if (lead) lead.textContent = '이름을 누르면 그 사람이 다시 내려갑니다.';
      const shuffleButton = host.querySelector('#ld-shuffle');
      if (shuffleButton) shuffleButton.disabled = true;
      host.querySelectorAll('.ld-name').forEach((button) => {
        button.disabled = false;
      });
      paintToggle();
      syncRoot();
      sfx.whoosh();
      announce('사다리가 열렸습니다. 모두 내려갑니다.');
      clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        if (!live) return;
        traceAll();
      }, REVEAL_MS);
    }

    /* ------------------------------ 크기·테마 ------------------------------ */

    function watchResize() {
      if (observer) observer.disconnect();
      if (themeObserver) themeObserver.disconnect();
      themeObserver = new MutationObserver(() => {
        ink = readInk();
        draw(performance.now());
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
      if (typeof ResizeObserver === 'undefined') return;
      const stage = host.querySelector('#ld-stage');
      if (!stage) return;
      observer = new ResizeObserver(() => {
        if (!ladder) return;
        measure();
        draw(performance.now());
      });
      observer.observe(stage);
    }

    /* ------------------------------ 연결 ------------------------------ */

    host.addEventListener('click', (event) => {
      const nameButton = event.target.closest('.ld-name');
      if (nameButton) {
        event.preventDefault();
        trace(Number(nameButton.dataset.index));
        return;
      }
      if (event.target.closest('#ld-start')) {
        event.preventDefault();
        revealStart();
        return;
      }
      if (event.target.closest('#ld-shuffle')) {
        event.preventDefault();
        shuffleSeats();
        return;
      }
      if (event.target.closest('#ld-toggle')) {
        event.preventDefault();
        if (!revealed) return;
        if (resultVisible) {
          hideResults();
        } else {
          revealResults();
          finish();
        }
        return;
      }
    }, { signal });

    bindActions(host, {
      onRetry: () => retry(),
      onSetup: () => showSetup(),
    }, signal);

    showSetup();
    return () => {
      live = false;
      clearTimeout(revealTimer);
      stopFrame();
      if (observer) observer.disconnect();
      if (themeObserver) themeObserver.disconnect();
      controller.abort();
    };
  },
};

export { makeRungs, walk, mixPaths };

export default module;
