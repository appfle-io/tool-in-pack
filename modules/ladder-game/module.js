/*
 * TIP · 사다리타기 (ladder-game, v1.18.0)
 *
 * 사람 수(2~12)와 꽝 개수를 정하면 겹치지 않는 사다리를 새로 긋는다.
 * 위쪽 이름을 누르면 그 사람의 길만 부드럽게 따라가며 밑의 결과를 열고,
 * [전체 동시에 보기]로 모두 한 번에 내려갈 수 있다. 결과는 가리거나 다시 공개할 수 있다.
 * 격자·경로는 HiDPI 캔버스에 그리고, 글자는 화면 배율과 상관없이 선명하게 얹는다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, loserSlots, escapeText,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18M17 3v18"/><path d="M7 7h10M7 12h10M7 17h10"/></svg>`;

/** 사다리 가로대 — 줄마다 서로 붙지 않게 왼쪽부터 놓는다. */
function makeRungs(people) {
  const rows = Math.max(6, Math.min(11, people + 2));
  let rungs = [];
  let best = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const next = [];
    for (let row = 0; row < rows; row += 1) {
      const line = [];
      let column = 0;
      while (column < people - 1) {
        if (Math.random() < 0.36) {
          line.push(column);
          column += 2;
        } else {
          column += 1;
        }
      }
      next.push(line);
    }
    const count = next.reduce((sum, line) => sum + line.length, 0);
    rungs = next;
    if (count > best) best = count;
    if (count >= Math.max(2, Math.round(rows / 3))) break;
  }
  return rungs;
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

function mixPaths(people) {
  const rungs = makeRungs(people);
  return { rungs, ends: Array.from({ length: people }, (_, index) => walk(index, rungs).end) };
}

/** 캔버스 글자·선 색을 지금 테마에서 읽는다. */
function readInk() {
  const style = getComputedStyle(document.documentElement);
  const value = (name, fallback) => (style.getPropertyValue(name) || '').trim() || fallback;
  const paths = [];
  for (let index = 1; index <= 8; index += 1) paths.push(value(`--gm-path-${index}`, '#2E5E4E'));
  return {
    paths,
    line: value('--line-strong', 'rgba(60,60,67,0.3)'),
    track: value('--card-2', '#F7F7FA'),
    ink: value('--text', '#1C1C1E'),
    accent: value('--accent', '#2E5E4E'),
  };
}

const module = {
  id: 'ladder-game',
  name: '사다리타기',
  shortName: '사다리',
  kind: 'tool',
  category: 'game',
  version: '1.18.0',
  subtitle: '길을 따라 내려가기',
  description: '사람 수와 꽝 개수를 정해 사다리를 긋고, 이름을 누르면 그 사람의 길만 따라가 결과를 보여 줍니다. 결과는 가렸다가 다시 공개할 수 있습니다.',
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

    let setup = null;
    let ladder = null;        // { rungs, ends, outcomes: boolean[] (칸별 꽝), byPerson: Map }
    let canvas = null;
    let ctx2d = null;
    let metrics = null;
    let ink = readInk();
    let traced = new Map();   // index -> { progress, colorIndex }
    let resultVisible = false;
    let summaryShown = false;
    let raf = 0;
    let lastTime = 0;
    let observer = null;
    let themeObserver = null;

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
      const mix = mixPaths(people);
      ladder = {
        rungs: mix.rungs,
        ends: mix.ends,
        outcomes: Array.from({ length: people }, (_, slot) => losers.has(slot)),
      };
      traced = new Map();
      resultVisible = false;
      summaryShown = false;
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
          </div>
          <div class="ld-stage" id="ld-stage">
            <div class="ld-names" id="ld-names"></div>
            <div class="ld-board"><canvas class="ld-canvas" id="ld-canvas"></canvas></div>
            <div class="ld-outs" id="ld-outs"></div>
          </div>
          <p class="gm-lead" id="ld-lead">이름을 누르면 그 사람의 길만 따라갑니다.</p>
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
        <button class="ld-name" type="button" data-index="${index}" aria-label="${escapeText(setup.names[index])} 길 따라가기">
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
      const padX = Math.max(12, Math.min(30, width * 0.05));
      const rowStep = Math.max(22, Math.min(38, 300 / Math.max(6, rows)));
      const height = Math.round(rows * rowStep + 18);
      const step = (width - padX * 2) / Math.max(1, setup.people - 1);
      metrics = {
        width, rows, padX, rowStep, height, step,
        x: (column) => padX + column * step,
        y: (row) => 9 + (row + 0.5) * rowStep,
      };

      if (canvas) {
        const ratio = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.height = `${height}px`;
        if (ctx2d) ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      // 이름이 촘촘하면(12명) 한 칸씩 엇갈려 두 줄로 놓아 글자가 겹치지 않게 한다.
      const stacked = step < 46;
      const stageEl = host.querySelector('#ld-stage');
      if (stageEl) stageEl.classList.toggle('is-stacked', stacked);
      const namesEl = host.querySelector('#ld-names');
      if (namesEl) {
        namesEl.querySelectorAll('.ld-name').forEach((button, index) => {
          button.style.left = `${metrics.x(index)}px`;
          button.style.maxWidth = `${Math.max(24, (stacked ? step * 1.7 : step) - 2)}px`;
          button.style.top = stacked && index % 2 ? '15px' : '0px';
          button.classList.toggle('is-narrow', stacked);
          button.title = setup.names[index];
        });
      }
      const outsEl = host.querySelector('#ld-outs');
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
      const points = [{ x: metrics.x(index), y: 0 }];
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
      points.push({ x: metrics.x(column), y: metrics.height });
      return points;
    }

    function strokePartial(points, progress, color, offset = 0) {
      if (!ctx2d || !points.length) return null;
      let total = 0;
      for (let index = 1; index < points.length; index += 1) {
        total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      }
      let left = total * Math.max(0, Math.min(1, progress));
      ctx2d.save();
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = 3;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      ctx2d.beginPath();
      ctx2d.moveTo(points[0].x + offset, points[0].y);
      let tip = { x: points[0].x + offset, y: points[0].y };
      for (let index = 1; index < points.length && left > 0; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const ratio = length ? Math.min(1, left / length) : 1;
        const x = from.x + (to.x - from.x) * ratio + offset;
        const y = from.y + (to.y - from.y) * ratio;
        ctx2d.lineTo(x, y);
        tip = { x, y };
        left -= length;
      }
      ctx2d.stroke();
      if (progress < 1) {
        ctx2d.fillStyle = color;
        ctx2d.beginPath();
        ctx2d.arc(tip.x, tip.y, 4.2, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();
      return tip;
    }

    function draw() {
      if (!ctx2d || !metrics) return;
      const { width, height, rowStep } = metrics;
      ctx2d.clearRect(0, 0, width, height);

      // 사다리 — 세로줄과 가로대. 겹치는 곳은 한 번만 그린다.
      ctx2d.save();
      ctx2d.strokeStyle = ink.line;
      ctx2d.lineWidth = 2;
      ctx2d.lineCap = 'round';
      ctx2d.beginPath();
      for (let column = 0; column < setup.people; column += 1) {
        ctx2d.moveTo(metrics.x(column), 0);
        ctx2d.lineTo(metrics.x(column), height);
      }
      ladder.rungs.forEach((line, row) => {
        line.forEach((start) => {
          ctx2d.moveTo(metrics.x(start), metrics.y(row));
          ctx2d.lineTo(metrics.x(start + 1), metrics.y(row));
        });
      });
      ctx2d.stroke();
      ctx2d.restore();

      // 따라간 길 — 이름을 누른 순서대로 색을 나눠 겹쳐도 구분된다.
      traced.forEach((state, index) => {
        const points = pathPoints(index);
        // 사람마다 살짝 옆으로 비켜 그려 길이 겹쳐도 둘 다 보이게 한다.
        const offset = (state.colorIndex - 3.5) * 0.8;
        strokePartial(points, state.progress, ink.paths[state.colorIndex % ink.paths.length], offset);
      });
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

    function trace(index, colorIndex = null) {
      if (!ladder || traced.has(index)) return;
      traced.set(index, {
        progress: 0,
        colorIndex: colorIndex == null ? colorIndexFor(index) : colorIndex,
        duration: 0.55 + ladder.rungs.length * 0.075,
      });
      startFrame();
    }

    function traceAll() {
      if (!ladder) return;
      Array.from({ length: setup.people }, (_, index) => index).forEach((index, order) => {
        if (traced.has(index)) return;
        traced.set(index, {
          progress: 0,
          colorIndex: order % ink.paths.length,
          duration: 0.55 + ladder.rungs.length * 0.075,
        });
      });
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
        state.progress = Math.min(1, state.progress + delta / state.duration);
        if (state.progress >= 1) {
          state.done = true;
          finishedNow.push(index);
        } else {
          moving = true;
        }
      });
      draw();
      finishedNow.forEach((index) => onTraced(index));
      if (moving) raf = requestAnimationFrame(frame);
    }

    function onTraced(index) {
      const end = ladder.ends[index];
      const lose = ladder.outcomes[end];
      const name = setup.names[index];
      revealSlot(end);
      announce(`${name} ${lose ? '꽝' : '당첨'}`);
      if (traced.size === setup.people) finish();
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
      }));
      box.innerHTML = resultPanel({
        id: 'ld-summary',
        entries,
        note: entries.filter((entry) => !entry.lose).length + '명 당첨, ' + entries.filter((entry) => entry.lose).length + '명 꽝',
      });
    }

    function announce(text) {
      const live = host.querySelector('#ld-live');
      if (live) live.textContent = text;
    }

    /* ------------------------------ 크기·테마 ------------------------------ */

    function watchResize() {
      if (observer) observer.disconnect();
      if (typeof ResizeObserver === 'undefined') return;
      const stage = host.querySelector('#ld-stage');
      if (!stage) return;
      observer = new ResizeObserver(() => {
        if (!ladder) return;
        measure();
        draw();
      });
      observer.observe(stage);

      if (themeObserver) themeObserver.disconnect();
      themeObserver = new MutationObserver(() => {
        ink = readInk();
        draw();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
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

export default module;
