/*
 * TIP · 선착순 골인 (race-game, v1.18.0)
 *
 * 사람 수(2~12)와 꽝 개수를 정하고 맵을 고르면, 모두 함께 출발해 먼저 골인한 사람이 당첨이다.
 * 꽝 개수만큼 늦게 들어온 사람이 꽝이 된다.
 *
 * 맵 4종
 *   · 질주 트랙    옆으로 달리며 부스터가 터져 순위가 뒤집힌다
 *   · 장애물 서킷  허들에 걸리면 느려진다
 *   · 핀볼 드롭    핀에 튕기며 떨어지는 공 (2D 충돌 물리)
 *   · 지그재그 레일 갈지자 레일을 타고 내려간다
 *
 * 움직임은 requestAnimationFrame 으로 그리고, 1x/2x 속도를 바꿀 수 있다.
 * 순위와 도착 알림은 그때그때 갱신하고, 모두 들어오면 순위표와 결과를 보여 준다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, randomUnit, escapeText,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9M4 9l7-4v11"/><path d="M3 6h9"/><circle cx="17" cy="8.5" r="2.2"/><circle cx="17" cy="15.5" r="2.2"/></svg>`;

const TRACK_W = 360;
const DROP_W = 360;
const DROP_H = 420;
const GUTTER = 48;
const STEP = 1 / 120;

const ART = {
  sprint: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7h22M3 13h16M3 19h24"/><path d="M20 5l4 2-4 2M14 11l4 2-4 2M22 17l4 2-4 2" stroke-linejoin="round"/></svg>`,
  circuit: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7h34M3 13h34M3 19h34"/><path d="M12 4v6M24 10v6M18 16v6"/></svg>`,
  pinball: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="7" r="1.2"/><circle cx="18" cy="7" r="1.2"/><circle cx="28" cy="7" r="1.2"/><circle cx="13" cy="14" r="1.2"/><circle cx="23" cy="14" r="1.2"/><circle cx="33" cy="14" r="1.2"/><circle cx="20" cy="20.5" r="2.4" fill="currentColor" stroke="none"/></svg>`,
  rail: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h10l-8 9h12l-8 9h12"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/></svg>`,
};

const MAPS = [
  { id: 'sprint', name: '질주 트랙', sub: '부스터와 역전', kind: 'track', art: ART.sprint },
  { id: 'circuit', name: '장애물 서킷', sub: '허들에 걸리면 느려짐', kind: 'track', art: ART.circuit },
  { id: 'pinball', name: '핀볼 드롭', sub: '핀에 튕기며 떨어짐', kind: 'drop', art: ART.pinball },
  { id: 'rail', name: '지그재그 레일', sub: '갈지자 레일 타기', kind: 'drop', art: ART.rail },
];

const SPEEDS = [1, 2];

function readInk() {
  const style = getComputedStyle(document.documentElement);
  const value = (name, fallback) => (style.getPropertyValue(name) || '').trim() || fallback;
  const paths = [];
  for (let index = 1; index <= 8; index += 1) paths.push(value(`--gm-path-${index}`, '#2E5E4E'));
  return {
    paths,
    line: value('--line', 'rgba(60,60,67,0.12)'),
    lineStrong: value('--line-strong', 'rgba(60,60,67,0.3)'),
    card: value('--card-2', '#F7F7FA'),
    ink: value('--muted', '#6C6C70'),
    text: value('--text', '#1C1C1E'),
    accent: value('--accent', '#2E5E4E'),
    accentSoft: value('--accent-soft', '#E4EFEA'),
    warn: value('--warn', '#C93400'),
    mark: value('--text', '#1C1C1E'),
  };
}

function buildPegs() {
  const pegs = [];
  const rows = 6;
  for (let row = 0; row < rows; row += 1) {
    const y = 58 + row * 58;
    const offset = row % 2 ? 24 : 0;
    for (let x = 26 + offset; x < DROP_W - 10; x += 48) pegs.push({ x, y, r: 4.8 });
  }
  return pegs;
}

const module = {
  id: 'race-game',
  name: '선착순 골인',
  shortName: '골인',
  kind: 'tool',
  category: 'game',
  version: '1.18.0',
  subtitle: '먼저 들어오면 당첨',
  description: '사람 수와 꽝 개수를 정하고 맵을 고르면 모두 함께 출발합니다. 질주 트랙, 장애물 서킷, 핀볼 드롭, 지그재그 레일 네 맵에서 먼저 골인한 사람이 당첨입니다.',
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
    let map = MAPS[0];
    let race = null;
    let canvas = null;
    let ctx2d = null;
    let ink = readInk();
    let raf = 0;
    let lastTime = 0;
    let speed = 1;
    let rankTimer = 0;
    let bannerTimer = 0;
    let themeObserver = null;
    let resizeObserver = null;

    /* ------------------------------ 설정 ------------------------------ */

    function showSetup() {
      stopFrame();
      race = null;
      setupScreen(host, {
        gameId: 'race-game',
        maps: MAPS,
        hint: '맵을 고르고 시작하면 셋을 세고 출발합니다.',
        signal,
        onStart: (next) => {
          setup = next;
          map = MAPS.find((item) => item.id === next.map) || MAPS[0];
          startRace();
        },
      });
    }

    /* ------------------------------ 한 판 ------------------------------ */

    function createRacers(n) {
      return Array.from({ length: n }, (_, index) => ({
        i: index,
        name: setup.names[index],
        color: index % ink.paths.length,
        p: 0,
        skill: 0.9 + randomUnit() * 0.2,
        speed: 96 + randomUnit() * 26,
        phase: randomUnit() * Math.PI * 2,
        waves: 2.2 + randomUnit() * 0.9,
        x: DROP_W * (index + 0.5) / n,
        y: -14 - randomUnit() * 6,
        vx: (randomUnit() - 0.5) * 46,
        vy: 110 + randomUnit() * 40,
        rad: Math.max(4.6, Math.min(7, 34 / Math.sqrt(n))),
        boost: 0,
        slow: 0,
        flash: 0,
        fin: null,
        rank: 0,
        trail: [],
      }));
    }

    function startRace() {
      ink = readInk();
      race = {
        n: setup.people,
        losers: setup.losers,
        racers: createRacers(setup.people),
        t: 0,
        arrived: 0,
        countdown: 0.9,
        lastBoost: 0,
        done: false,
        pegs: map.id === 'pinball' ? buildPegs() : [],
        lastRank: 0,
      };
      renderStage();
      startFrame();
    }

    /* ------------------------------ 화면 ------------------------------ */

    function renderStage() {
      host.innerHTML = `
        <div class="gm rc">
          <div class="gm-hud" id="rc-hud">
            ${hudStat('사람', String(setup.people), 'left')}
            ${hudStat('꽝', String(setup.losers), 'lose')}
            ${hudStat('도착', '0', 'win')}
          </div>
          <div class="rc-bar">
            <span class="rc-mapname">${escapeText(map.name)}</span>
            <div class="rc-speed" role="group" aria-label="속도">
              ${SPEEDS.map((value) => `<button class="rc-speed-btn${value === speed ? ' is-on' : ''}" type="button"
                  data-speed="${value}" aria-pressed="${value === speed ? 'true' : 'false'}">${value}x</button>`).join('')}
            </div>
          </div>
          <div class="rc-stage">
            <canvas class="rc-canvas" id="rc-canvas" aria-label="${escapeText(map.name)} 경주"></canvas>
            <div class="rc-banner" id="rc-banner" role="status" aria-live="polite"></div>
          </div>
          <ol class="rc-rank" id="rc-rank"></ol>
          <div class="gm-actions">
            <button class="v16-btn" type="button" id="rc-again">다시하기</button>
            <button class="v16-btn" type="button" data-act="setup">새로 설정하기</button>
          </div>
          <div id="rc-result"></div>
          <p class="gm-live sr-only" id="rc-live" role="status" aria-live="polite"></p>
        </div>`;

      canvas = host.querySelector('#rc-canvas');
      ctx2d = canvas ? canvas.getContext('2d') : null;
      sizeCanvas();
      paintRanking(true);
      watch();

      host.querySelectorAll('.rc-speed-btn').forEach((button) => {
        button.addEventListener('click', () => {
          speed = Number(button.dataset.speed) || 1;
          host.querySelectorAll('.rc-speed-btn').forEach((node) => {
            const on = node === button;
            node.classList.toggle('is-on', on);
            node.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
        }, { signal });
      });
    }

    function sizeCanvas() {
      if (!canvas) return;
      const container = Math.max(220, host.clientWidth || 320);
      // 가로 경주는 넓게, 떨어지는 맵은 빈 자리가 생기지 않게 폭을 묶고 세로로 길게.
      const width = map.kind === 'track'
        ? Math.min(container, 760)
        : Math.min(container, 430);
      const height = map.kind === 'track'
        ? Math.max(180, setup.people * 28 + 16)
        : Math.round(Math.min(520, width * (DROP_H / DROP_W)));
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      if (ctx2d) ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
      race.width = width;
      race.height = height;
      race.scale = map.kind === 'track' ? 1 : Math.min(width / DROP_W, height / DROP_H);
      race.offsetX = map.kind === 'track' ? 0 : (width - DROP_W * race.scale) / 2;
      race.offsetY = map.kind === 'track' ? 0 : (height - DROP_H * race.scale) / 2;
    }

    function watch() {
      if (themeObserver) themeObserver.disconnect();
      themeObserver = new MutationObserver(() => {
        ink = readInk();
        draw();
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });

      if (resizeObserver) resizeObserver.disconnect();
      if (typeof ResizeObserver === 'undefined') return;
      const stage = host.querySelector('.rc-stage');
      if (!stage) return;
      resizeObserver = new ResizeObserver(() => {
        if (!race) return;
        sizeCanvas();
        draw();
      });
      resizeObserver.observe(host);
    }

    /* ------------------------------ 움직임 ------------------------------ */

    function startFrame() {
      stopFrame();
      lastTime = 0;
      raf = requestAnimationFrame(frame);
    }

    function stopFrame() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      lastTime = 0;
    }

    function frame(now) {
      raf = 0;
      if (!race) return;
      const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 1 / 60;
      lastTime = now;

      if (race.countdown > 0) {
        race.countdown = Math.max(0, race.countdown - delta * speed);
        draw();
        raf = requestAnimationFrame(frame);
        return;
      }

      const scaled = delta * speed;
      const steps = Math.max(1, Math.ceil(scaled / STEP));
      const step = scaled / steps;
      for (let index = 0; index < steps; index += 1) simulate(step);

      draw();
      if (now - race.lastRank > 110) {
        race.lastRank = now;
        paintRanking();
      }
      if (race.done) finish();
      else raf = requestAnimationFrame(frame);
    }

    function simulate(dt) {
      race.t += dt;
      if (map.kind === 'track') simulateTrack(dt);
      else if (map.id === 'pinball') simulatePinball(dt);
      else simulateRail(dt);
      if (race.t > 60) forceFinish();
    }

    function arrive(racer) {
      if (racer.fin != null) return;
      racer.fin = race.t;
      race.arrived += 1;
      racer.rank = race.arrived;
      const banner = host.querySelector('#rc-banner');
      if (banner) {
        banner.textContent = `${racer.rank}등 ${racer.name} 도착`;
        banner.classList.add('is-show');
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => banner && banner.classList.remove('is-show'), 1000);
      }
      const live = host.querySelector('#rc-live');
      if (live) live.textContent = `${racer.rank}등 ${racer.name} 도착`;
      if (race.arrived >= race.n) race.done = true;
    }

    function simulateTrack(dt) {
      const base = 1 / 5.2;
      const hurdleSpots = [0.22, 0.5, 0.78];
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        racer.boost = Math.max(0, racer.boost - dt);
        racer.slow = Math.max(0, racer.slow - dt);
        racer.flash = Math.max(0, racer.flash - dt);
        const now = base * racer.skill * (racer.boost > 0 ? 1.85 : 1) * (racer.slow > 0 ? 0.45 : 1);
        const before = racer.p;
        racer.p = Math.min(1, racer.p + now * dt);

        if (map.id === 'circuit') {
          hurdleSpots.forEach((spot) => {
            if (before < spot && racer.p >= spot && randomUnit() < 0.62) {
              racer.slow = 0.85;
              racer.flash = 0.9;
            }
          });
        }
        if (racer.p >= 1) arrive(racer);
      });

      if (map.id === 'sprint' && race.t - race.lastBoost > 0.75) {
        race.lastBoost = race.t;
        const pool = race.racers.filter((racer) => racer.fin == null);
        if (pool.length) {
          const pick = pool[Math.floor(randomUnit() * pool.length) % pool.length];
          pick.boost = 0.75;
        }
      }
    }

    function simulatePinball(dt) {
      const gravity = 660;
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        racer.vy += gravity * dt;
        racer.x += racer.vx * dt;
        racer.y += racer.vy * dt;

        if (racer.x < racer.rad) {
          racer.x = racer.rad;
          racer.vx = Math.abs(racer.vx) * 0.7;
        } else if (racer.x > DROP_W - racer.rad) {
          racer.x = DROP_W - racer.rad;
          racer.vx = -Math.abs(racer.vx) * 0.7;
        }

        race.pegs.forEach((peg) => {
          const dx = racer.x - peg.x;
          const dy = racer.y - peg.y;
          const distance = Math.hypot(dx, dy);
          const min = racer.rad + peg.r;
          if (distance > min || distance < 0.001) return;
          const nx = dx / distance;
          const ny = dy / distance;
          racer.x = peg.x + nx * min;
          racer.y = peg.y + ny * min;
          const dot = racer.vx * nx + racer.vy * ny;
          racer.vx = (racer.vx - 2 * dot * nx) * 0.6 + (randomUnit() - 0.5) * 80;
          racer.vy = (racer.vy - 2 * dot * ny) * 0.6 - 18;
          peg.hit = 0.2;
        });

        if (racer.y > DROP_H - 10) arrive(racer);
      });
      race.pegs.forEach((peg) => { if (peg.hit) peg.hit = Math.max(0, peg.hit - dt); });
    }

    function simulateRail(dt) {
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        const slope = 0.88 + 0.22 * Math.cos((racer.y / DROP_H) * Math.PI * 2 * racer.waves + racer.phase);
        racer.y += racer.speed * slope * dt;
        racer.x = railX(racer, racer.y);
        if (racer.y >= DROP_H - 8) {
          racer.y = DROP_H - 8;
          arrive(racer);
        }
      });
    }

    function railX(racer, y) {
      const lane = DROP_W * (racer.i + 0.5) / race.n;
      const amplitude = Math.min(9, Math.max(3, (DROP_W / race.n) * 0.28));
      return lane + amplitude * Math.sin((y / DROP_H) * Math.PI * 2 * racer.waves + racer.phase);
    }

    function forceFinish() {
      const rest = race.racers.filter((racer) => racer.fin == null).sort((a, b) => b.p - a.p || b.y - a.y);
      rest.forEach((racer) => arrive(racer));
      race.done = true;
    }

    /* ------------------------------ 그리기 ------------------------------ */

    function draw() {
      if (!ctx2d || !race) return;
      const width = race.width;
      const height = race.height;
      ctx2d.clearRect(0, 0, width, height);
      if (!width || !height) return;
      if (race.countdown > 0) {
        drawCountdown(width, height);
        return;
      }
      if (map.kind === 'track') drawTrack(width, height);
      else drawDrop(width, height);
    }

    function drawCountdown(width, height) {
      const step = Math.ceil(race.countdown / 0.3);
      const label = step > 0 ? String(Math.min(3, step)) : '출발';
      ctx2d.save();
      ctx2d.fillStyle = ink.accentSoft;
      ctx2d.fillRect(0, 0, width, height);
      ctx2d.fillStyle = ink.accent;
      ctx2d.font = `700 ${Math.min(52, width * 0.16)}px Pretendard, system-ui, sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(label, width / 2, height / 2);
      ctx2d.restore();
    }

    function drawTrack(width, height) {
      const n = race.n;
      const laneH = height / n;
      const finishX = width - 24;
      const startX = GUTTER;

      ctx2d.save();
      for (let lane = 0; lane < n; lane += 1) {
        const top = lane * laneH;
        if (lane % 2 === 0) {
          ctx2d.fillStyle = ink.card;
          ctx2d.fillRect(0, top + 1, width, laneH - 2);
        }
        ctx2d.strokeStyle = ink.line;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, top + laneH);
        ctx2d.lineTo(width, top + laneH);
        ctx2d.stroke();
      }

      // 골인선 — 체크 무늬
      const cell = Math.max(4, Math.min(7, laneH / 4));
      for (let y = 0; y < height; y += cell) {
        for (let row = 0; row < 3; row += 1) {
          ctx2d.fillStyle = ((y / cell) + row) % 2 ? ink.mark : ink.card;
          ctx2d.fillRect(finishX + row * cell, y, cell, cell);
        }
      }

      if (map.id === 'circuit') {
        [0.22, 0.5, 0.78].forEach((spot) => {
          const x = startX + (finishX - startX) * spot;
          for (let lane = 0; lane < n; lane += 1) {
            ctx2d.strokeStyle = ink.lineStrong;
            ctx2d.lineWidth = 2;
            ctx2d.beginPath();
            ctx2d.moveTo(x, lane * laneH + laneH * 0.25);
            ctx2d.lineTo(x, lane * laneH + laneH * 0.75);
            ctx2d.stroke();
          }
        });
      }

      race.racers.forEach((racer) => {
        const lane = racer.i;
        const y = lane * laneH + laneH / 2;
        const x = startX + (finishX - startX) * racer.p;
        const color = ink.paths[racer.color];

        // 이름 — 왼쪽 여백에 작게
        ctx2d.fillStyle = racer.fin != null ? ink.ink : ink.text;
        ctx2d.font = `600 ${Math.max(9, Math.min(11.5, laneH * 0.46))}px Pretendard, system-ui, sans-serif`;
        ctx2d.textAlign = 'left';
        ctx2d.textBaseline = 'middle';
        const label = racer.name.length > 4 ? `${racer.name.slice(0, 4)}…` : racer.name;
        ctx2d.fillText(label, 4, y);

        if (racer.boost > 0) {
          ctx2d.strokeStyle = color;
          ctx2d.lineWidth = 1.6;
          for (let index = 0; index < 3; index += 1) {
            const bx = x - 10 - index * 7;
            ctx2d.beginPath();
            ctx2d.moveTo(bx - 3, y - 3);
            ctx2d.lineTo(bx, y);
            ctx2d.lineTo(bx - 3, y + 3);
            ctx2d.stroke();
          }
        }
        if (racer.slow > 0 || racer.flash > 0) {
          ctx2d.fillStyle = ink.warn;
          ctx2d.globalAlpha = Math.min(1, racer.slow > 0 ? 0.9 : racer.flash);
          ctx2d.beginPath();
          ctx2d.arc(x - 2, y - laneH * 0.28, 1.6, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.globalAlpha = 1;
        }

        ctx2d.fillStyle = color;
        ctx2d.beginPath();
        ctx2d.arc(x, y, Math.max(4, Math.min(7.5, laneH * 0.3)), 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.strokeStyle = ink.card;
        ctx2d.lineWidth = 1.2;
        ctx2d.stroke();
      });
      ctx2d.restore();
    }

    function drawDrop(width, height) {
      const scale = race.scale || Math.min(width / DROP_W, height / DROP_H);
      const offsetX = race.offsetX || 0;
      const offsetY = race.offsetY || 0;

      ctx2d.save();
      ctx2d.translate(offsetX, offsetY);
      ctx2d.scale(scale, scale);

      // 바닥 골인 띠 — 공이 닿는 자리
      const cell = 6;
      for (let x = 0; x < DROP_W; x += cell) {
        for (let row = 0; row < 2; row += 1) {
          ctx2d.fillStyle = ((x / cell) + row) % 2 ? ink.lineStrong : ink.card;
          ctx2d.fillRect(x, DROP_H - 12 + row * cell, cell, cell);
        }
      }

      if (map.id === 'pinball') {
        race.pegs.forEach((peg) => {
          ctx2d.fillStyle = peg.hit ? ink.accent : ink.lineStrong;
          ctx2d.beginPath();
          ctx2d.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
          ctx2d.fill();
        });
      } else {
        race.racers.forEach((racer) => {
          ctx2d.strokeStyle = ink.lineStrong;
          ctx2d.lineWidth = 1.6;
          ctx2d.beginPath();
          for (let y = 0; y <= DROP_H - 8; y += 10) {
            const x = railX(racer, y);
            if (y === 0) ctx2d.moveTo(x, y);
            else ctx2d.lineTo(x, y);
          }
          ctx2d.stroke();
        });
      }

      race.racers.forEach((racer) => {
        const color = ink.paths[racer.color];
        ctx2d.fillStyle = color;
        ctx2d.beginPath();
        ctx2d.arc(racer.x, Math.min(DROP_H - 2, racer.y), racer.rad, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.strokeStyle = ink.card;
        ctx2d.lineWidth = 1.2;
        ctx2d.stroke();
      });
      ctx2d.restore();
    }

    /* ------------------------------ 순위 ------------------------------ */

    function orderedRacers() {
      return race.racers.slice().sort((a, b) => {
        if (a.fin != null && b.fin != null) return a.fin - b.fin;
        if (a.fin != null) return -1;
        if (b.fin != null) return 1;
        if (map.kind === 'track') return b.p - a.p;
        return b.y - a.y;
      });
    }

    function paintRanking(force = false) {
      if (!race) return;
      const list = host.querySelector('#rc-rank');
      if (!list) return;
      const order = orderedRacers();
      list.innerHTML = order.map((racer, index) => `
        <li class="rc-rank-row${racer.fin != null ? ' is-done' : ''}">
          <span class="rc-rank-no">${racer.fin != null ? racer.rank : index + 1}</span>
          <span class="rc-dot" style="background: ${ink.paths[racer.color]}"></span>
          <span class="rc-rank-name">${escapeText(racer.name)}</span>
          <span class="rc-rank-state">${racer.fin != null ? '골인' : '달리는 중'}</span>
        </li>`).join('');
      const hud = host.querySelector('#rc-hud');
      if (hud) {
        const value = hud.querySelectorAll('.gm-stat-v')[2];
        if (value) value.textContent = String(race.arrived);
      }
      if (force) list.dataset.ready = 'true';
    }

    /* ------------------------------ 결과 ------------------------------ */

    function finish() {
      stopFrame();
      if (!race || race.summaryShown) return;
      race.summaryShown = true;
      race.racers.forEach((racer, index) => {
        if (racer.fin == null) racer.rank = race.n;
        if (!racer.rank) racer.rank = index + 1;
      });
      const order = orderedRacers();
      const entries = order.map((racer, index) => ({
        name: racer.name,
        lose: index >= race.n - race.losers,
        meta: `${index + 1}등`,
      }));
      const board = `
        <div class="rc-board">
          ${order.map((racer, index) => `
            <div class="rc-board-row${index >= race.n - race.losers ? ' is-lose' : ''}">
              <span class="rc-board-no">${index + 1}</span>
              <span class="rc-board-name">${escapeText(racer.name)}</span>
              <span class="rc-board-verdict">${index >= race.n - race.losers ? '꽝' : '당첨'}</span>
            </div>`).join('')}
        </div>`;
      const box = host.querySelector('#rc-result');
      if (!box) return;
      paintRanking(true);
      box.innerHTML = resultPanel({
        id: 'rc-summary',
        entries,
        extraHtml: board,
        note: `${map.name} · 먼저 들어온 ${race.n - race.losers}명 당첨`,
      });
      const live = host.querySelector('#rc-live');
      if (live) live.textContent = '경주가 끝났습니다';
      toast('경주가 끝났습니다');
    }

    /* ------------------------------ 연결 ------------------------------ */

    host.addEventListener('click', (event) => {
      if (event.target.closest('#rc-again')) {
        event.preventDefault();
        if (!setup) return;
        startRace();
        return;
      }
    }, { signal });

    bindActions(host, {
      onRetry: () => {
        if (!setup) return;
        startRace();
      },
      onSetup: () => showSetup(),
    }, signal);

    showSetup();
    return () => {
      stopFrame();
      clearTimeout(bannerTimer);
      clearTimeout(rankTimer);
      if (themeObserver) themeObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      controller.abort();
    };
  },
};

export default module;
