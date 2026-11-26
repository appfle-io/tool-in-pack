/*
 * TIP · 사다리타기 (ladder-game, v1.19.0)
 *
 * 사람 수(2~12)와 꽝 개수를 정하면 겹치지 않는 사다리를 새로 긋는다.
 * 위쪽 이름을 누르면 그 사람의 캐릭터가 사다리를 타고 좌우로 기울며 내려가고,
 * 지나간 길은 색 궤적으로 남는다. [전체 동시에 보기]로 모두 한 번에 내려갈 수 있다.
 * 결과는 가리거나 다시 공개할 수 있다.
 *
 * 가로대는 모든 이웃한 기둥 사이에 2개 이상 들어가고, 어느 칸도 가로대 없이
 * 곧장 내려가지 않게 만든다(공정한 난수, crypto).
 * 격자·경로·캐릭터는 HiDPI 캔버스에 그리고, 글자는 화면 배율과 상관없이 선명하게 얹는다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, loserSlots, escapeText,
  soundButton, bindSound, sfx, createConfetti, drawBadge, drawCharacter,
  paintAvatars, characterColor,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18M17 3v18"/><path d="M7 7h10M7 12h10M7 17h10"/></svg>`;

const MIN_RUNGS_PER_PAIR = 2;
const BAND = 40;          // 위쪽 캐릭터 배지 띠
const FOOT = 14;          // 아래 여백

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
  version: '1.19.0',
  subtitle: '길을 따라 내려가기',
  description: '사람 수와 꽝 개수를 정해 사다리를 긋고, 이름을 누르면 그 사람의 캐릭터가 길을 따라 내려가 결과를 보여 줍니다. 결과는 가렸다가 다시 공개할 수 있습니다.',
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
    let ladder = null;        // { rungs, ends, outcomes }
    let canvas = null;
    let ctx2d = null;
    let metrics = null;
    let ink = readInk();
    let traced = new Map();   // index -> { progress, points, lengths, total, colorIndex, done, t }
    let resultVisible = false;
    let summaryShown = false;
    let raf = 0;
    let lastTime = 0;
    let observer = null;
    let themeObserver = null;
    const confetti = createConfetti();

    function stopFrame() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastTime = 0;
    }

    /* ------------------------------ 설정 ------------------------------ */

    function showSetup() {
      stopFrame();
      ladder = null;
      traced = new Map();
      resultVisible = false;
      summaryShown = false;
      confetti.clear();
      setupScreen(host, {
        gameId: 'ladder-game',
        hint: '이름을 누르면 그 사람의 길만 따라갑니다.',
        signal,
        onStart: (next) => start(next),
      });
    }

    function start(next) {
      setup = next;
      deal();
      renderPlay();
    }

    /** 꽝 칸을 새로 뽑고 사다리를 새로 긋는다. */
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
      resultVisible = false;
      summaryShown = false;
      confetti.clear();
    }

    /* ------------------------------ 화면 ------------------------------ */

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
          <div class="ld-stage" id="ld-stage">
            <div class="ld-names" id="ld-names"></div>
            <div class="ld-board"><canvas class="ld-canvas" id="ld-canvas"></canvas></div>
            <div class="ld-outs" id="ld-outs"></div>
          </div>
          <p class="gm-lead" id="ld-lead">이름을 누르면 그 사람의 캐릭터가 사다리를 탑니다.</p>
          <div class="gm-actions">
            <button class="v16-btn" type="button" id="ld-all">전체 동시에 보기</button>
            <button class="v16-btn" type="button" id="ld-toggle">결과 공개</button>
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
    }

    function paintNames() {
      const namesEl = host.querySelector('#ld-names');
      const outsEl = host.querySelector('#ld-outs');
      if (!namesEl || !outsEl) return;
      const people = setup.people;
      namesEl.innerHTML = Array.from({ length: people }, (_, index) => `
        <button class="ld-name" type="button" data-index="${index}"
                aria-label="${escapeText(setup.names[index])} 길 따라가기" style="--who: ${characterColor(index)}">
          <span class="ld-name-text">${escapeText(setup.names[index])}</span>
        </button>`).join('');
      outsEl.innerHTML = Array.from({ length: people }, (_, index) => {
        const lose = ladder.outcomes[index];
        return `<span class="ld-out${lose ? ' is-lose' : ' is-win'}" data-slot="${index}"
                      aria-label="이 자리는 ${lose ? '꽝' : '당첨'}">?</span>`;
      }).join('');
    }

    function measure() {
      const stage = host.querySelector('#ld-stage');
      if (!stage) return;
      const width = Math.max(200, stage.clientWidth);
      const rows = ladder.rungs.length;
      const padX = Math.max(16, Math.min(34, width * 0.06));
      const rowStep = Math.max(23, Math.min(40, 340 / rows));
      const step = (width - padX * 2) / Math.max(1, setup.people - 1);
      const avatarR = Math.max(10, Math.min(17, step * 0.42, rowStep * 0.62));
      const height = Math.round(BAND + rows * rowStep + avatarR * 2.6 + FOOT);
      metrics = {
        width, rows, padX, rowStep, height, step, avatarR,
        top: BAND,
        bottom: BAND + rows * rowStep,
        x: (column) => padX + column * step,
        y: (row) => BAND + (row + 0.5) * rowStep,
        badgeY: BAND * 0.52,
      };

      if (canvas) {
        const ratio = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.height = `${height}px`;
        if (ctx2d) ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      // 이름이 촘촘하면(12명) 한 칸씩 엇갈려 두 줄로 놓아 글자가 겹치지 않게 한다.
      const stacked = step < 48;
      stage.classList.toggle('is-stacked', stacked);
      const namesEl = host.querySelector('#ld-names');
      if (namesEl) {
        namesEl.querySelectorAll('.ld-name').forEach((button, index) => {
          button.style.left = `${metrics.x(index)}px`;
          button.style.maxWidth = `${Math.max(26, (stacked ? step * 1.75 : step) - 2)}px`;
          button.style.top = stacked && index % 2 ? '16px' : '0px';
          button.classList.toggle('is-narrow', stacked);
          button.title = setup.names[index];
        });
      }
      const outsEl = host.querySelector('#ld-outs');
      if (outsEl) {
        outsEl.querySelectorAll('.ld-out').forEach((chip, index) => {
          chip.style.left = `${metrics.x(index)}px`;
          chip.style.maxWidth = `${Math.max(24, step - 2)}px`;
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
      const railWidth = Math.max(5, Math.min(9, rowStep * 0.28));
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
      traced.forEach((state, index) => {
        const color = ink.paths[state.colorIndex % ink.paths.length];
        if (state.done) strokePath(state.points, 1, color, { glow: true, alpha: 0.2, measured: state });
        strokePath(state.points, state.progress, color, { glow: true, alpha: 0.4, measured: state });
        strokePath(state.points, state.progress, color, { width: 3.2, measured: state });
      });

      // 위쪽 캐릭터 배지 — 내려간 사람은 흐리게
      for (let index = 0; index < setup.people; index += 1) {
        const state = traced.get(index);
        const alpha = state ? 0.28 : 1;
        drawBadge(ctx2d, index, metrics.x(index), metrics.badgeY, metrics.avatarR, {
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
        drawCharacter(ctx2d, index, spot.x, spot.y + bob, metrics.avatarR * 1.62, {
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

    function trace(index) {
      if (!ladder || traced.has(index)) return;
      beginTrace(index);
      sfx.click();
      startFrame();
    }

    function traceAll() {
      if (!ladder) return;
      const order = Array.from({ length: setup.people }, (_, index) => index)
        .filter((index) => !traced.has(index));
      order.forEach((index, slot) => beginTrace(index, (index + slot) % ink.paths.length, slot * 0.09));
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
      const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0.016;
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
      const name = setup.names[index];
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
      if (traced.size === setup.people) {
        setTimeout(() => finish(), 260);
      }
    }

    function paintToggle() {
      const toggle = host.querySelector('#ld-toggle');
      if (toggle) toggle.textContent = resultVisible ? '결과 가리기' : '결과 공개';
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
      const entries = setup.names.slice(0, setup.people).map((name, index) => ({
        name,
        lose: ladder.outcomes[ladder.ends[index]],
        index,
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
      const live = host.querySelector('#ld-live');
      if (live) live.textContent = text;
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
      if (event.target.closest('#ld-all')) {
        event.preventDefault();
        traceAll();
        return;
      }
      if (event.target.closest('#ld-toggle')) {
        event.preventDefault();
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
      onRetry: () => {
        if (!setup) return;
        stopFrame();
        deal();
        renderPlay();
      },
      onSetup: () => showSetup(),
    }, signal);

    showSetup();
    return () => {
      stopFrame();
      if (observer) observer.disconnect();
      if (themeObserver) themeObserver.disconnect();
      controller.abort();
    };
  },
};

export { makeRungs, walk, mixPaths };

export default module;
