/*
 * TIP · 선착순 골인 (race-game, v1.19.0)
 *
 * 사람 수(2~12)와 꽝 개수를 정하고 맵을 고르면, 모두 함께 출발해 먼저 골인한 사람이 당첨이다.
 * 꽝 개수만큼 늦게 들어온 사람이 꽝이 된다.
 *
 * 맵 4종
 *   · 질주 트랙     파란 부스터 패드 · 진흙/바나나 · 순풍/역풍 게이트 · 결승 테이프
 *   · 장애물 서킷   굽이진 레인 · 허들(점프/감속) · 가속 레인 · 여닫는 게이트
 *   · 핀볼 드롭     튕기는 범퍼 · 회전 풍차 · 깔때기 가이드가 있는 물리 보드
 *   · 지그재그 레일 좌우로 감기는 레일 · 왕복 발판 · 가속 슈트
 *
 * 모든 맵에서 동그라미 대신 캐릭터 아바타가 달리고, 머리 위 이름표·이동 궤적·먼지·
 * 충돌 스파크가 따라붙는다. 끝나면 1·2·3등 시상대와 컨페티.
 * 움직임은 requestAnimationFrame 으로 그리고, 1x/2x 속도를 바꿀 수 있다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, randomUnit, escapeText, shortName,
  soundButton, bindSound, sfx, createConfetti, drawCharacter, drawNameTag,
  paintAvatars, podiumHtml, characterColor,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9M4 9l7-4v11"/><path d="M3 6h9"/><circle cx="17" cy="8.5" r="2.2"/><circle cx="17" cy="15.5" r="2.2"/></svg>`;

const BOARD_W = 360;
const BOARD_H = 430;
const STEP = 1 / 120;
const LANE_MIN = 40;

const ART = {
  sprint: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7h22M3 13h16M3 19h24"/><path d="M20 5l4 2-4 2M14 11l4 2-4 2M22 17l4 2-4 2" stroke-linejoin="round"/></svg>`,
  circuit: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7c6-4 10 4 16 0s10 4 18 0M3 15c6-4 10 4 16 0s10 4 18 0M3 23c6-4 10 4 16 0s10 4 18 0"/></svg>`,
  pinball: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="7" r="2.2"/><circle cx="20" cy="9" r="2.2"/><circle cx="32" cy="7" r="2.2"/><circle cx="14" cy="17" r="2.2"/><circle cx="26" cy="17" r="2.2"/><path d="M4 22h32"/></svg>`,
  rail: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h10l-8 8h12l-8 8h12"/><circle cx="9" cy="5" r="2" fill="currentColor" stroke="none"/></svg>`,
};

const MAPS = [
  { id: 'sprint', name: '질주 트랙', sub: '부스터·진흙·순풍', kind: 'track', art: ART.sprint },
  { id: 'circuit', name: '장애물 서킷', sub: '허들과 여닫는 게이트', kind: 'track', art: ART.circuit },
  { id: 'pinball', name: '핀볼 드롭', sub: '범퍼와 회전 풍차', kind: 'drop', art: ART.pinball },
  { id: 'rail', name: '지그재그 레일', sub: '왕복 발판·가속 슈트', kind: 'drop', art: ART.rail },
];

const SPEEDS = [1, 2];
const TAPE_P = 0.94;

function readInk() {
  const style = getComputedStyle(document.documentElement);
  const value = (name, fallback) => (style.getPropertyValue(name) || '').trim() || fallback;
  const paths = [];
  for (let index = 1; index <= 8; index += 1) paths.push(value(`--gm-path-${index}`, '#2E5E4E'));
  return {
    paths,
    line: value('--line', 'rgba(60,60,67,0.12)'),
    lineStrong: value('--line-strong', 'rgba(60,60,67,0.3)'),
    card: value('--card', '#FFFFFF'),
    card2: value('--card-2', '#F7F7FA'),
    ink: value('--muted', '#6C6C70'),
    text: value('--text', '#1C1C1E'),
    accent: value('--accent', '#2E5E4E'),
    accentSoft: value('--accent-soft', '#E4EFEA'),
    warn: value('--warn', '#C93400'),
    turf: value('--gm-turf', '#DFEDD8'),
    turf2: value('--gm-turf-2', '#D1E4C8'),
    lane: value('--gm-lane', '#F3F1EC'),
    lane2: value('--gm-lane-2', '#E9E6DF'),
    board: value('--gm-board', '#F1EFEA'),
    boardLine: value('--gm-board-line', '#DCD7CE'),
    boost: value('--gm-boost', '#2F6FE0'),
    boostSoft: value('--gm-boost-soft', '#DCE7FB'),
    mud: value('--gm-mud', '#7A5A3C'),
    tape: value('--gm-tape', '#E8503F'),
    dark: document.documentElement.getAttribute('data-theme') === 'dark',
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** 두 점을 잇는 둥근 선. */
function segment(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

const module = {
  id: 'race-game',
  name: '선착순 골인',
  shortName: '골인',
  kind: 'tool',
  category: 'game',
  version: '1.19.0',
  subtitle: '먼저 들어오면 당첨',
  description: '사람 수와 꽝 개수를 정하고 맵을 고르면 모두 함께 출발합니다. 질주 트랙, 장애물 서킷, 핀볼 드롭, 지그재그 레일 네 맵에서 캐릭터들이 달리고 튕기며, 먼저 골인한 사람이 당첨입니다.',
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
    let map = MAPS[0];
    let race = null;
    let canvas = null;
    let ctx2d = null;
    let ink = readInk();
    let raf = 0;
    let lastTime = 0;
    let speed = 1;
    let bannerTimer = 0;
    let themeObserver = null;
    let resizeObserver = null;
    const confetti = createConfetti();

    /* ------------------------------ 설정 ------------------------------ */

    function showSetup() {
      stopFrame();
      race = null;
      confetti.clear();
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

    function buildProps(n) {
      // 레인마다 부스터 하나와 방해물 하나씩 — 누구나 한 번은 밟는다.
      const lanes = Array.from({ length: n }, (_, lane) => {
        const boostAt = 0.16 + randomUnit() * 0.3;
        const hazardAt = boostAt + 0.2 + randomUnit() * 0.28;
        return {
          lane,
          boostAt,
          hazardAt: Math.min(0.9, hazardAt),
          hazard: randomUnit() < 0.5 ? 'mud' : 'banana',
          speedLane: randomUnit() < 0.4,
          gate: randomUnit(),
        };
      });
      return {
        lanes,
        windAt: 0.46 + randomUnit() * 0.06,
        hurdles: [0.2, 0.42, 0.66].map((p) => ({ p, open: randomUnit() > 0.45 })),
        gateAt: 0.62,
        gatePhase: randomUnit() * Math.PI * 2,
      };
    }

    function createRacers(n) {
      return Array.from({ length: n }, (_, index) => ({
        i: index,
        name: setup.names[index],
        color: index,
        p: 0,
        x: 0,
        y: 0,
        vx: (randomUnit() - 0.5) * 60,
        vy: 90 + randomUnit() * 40,
        rad: Math.max(6, Math.min(9, 30 / Math.sqrt(n))),
        skill: 0.9 + randomUnit() * 0.22,
        boost: 0,
        slow: 0,
        hit: 0,
        jump: 0,
        wind: 0,
        windTag: '',
        fin: null,
        rank: 0,
        mood: 'idle',
        flash: 0,
        trail: [],
        dust: [],
        todo: 0,
        lane: index,
        phase: randomUnit() * Math.PI * 2,
        waves: 1.4 + randomUnit() * 0.7,
      }));
    }

    function startRace() {
      ink = readInk();
      race = {
        n: setup.people,
        losers: setup.losers,
        racers: createRacers(setup.people),
        props: buildProps(setup.people),
        t: 0,
        arrived: 0,
        countdown: 1.8,
        countStep: 3,
        done: false,
        summaryShown: false,
        lastRank: 0,
        tape: 0,
        sparks: [],
        pegs: map.id === 'pinball' ? buildPinball() : [],
        rails: map.id === 'rail' ? buildRail(setup.people) : null,
        width: 0,
        height: 0,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      };
      placeRacers();
      renderStage();
      startFrame();
    }

    /** 맵마다 출발 자리를 잡는다. */
    function placeRacers() {
      race.racers.forEach((racer) => {
        if (map.kind === 'track') {
          racer.p = 0;
          const spot = trackSpot(racer);
          racer.x = spot.x;
          racer.y = spot.y;
        } else if (map.id === 'pinball') {
          racer.x = (BOARD_W * (racer.i + 0.5)) / race.n;
          racer.y = -14 - randomUnit() * 12;
          racer.vx = (randomUnit() - 0.5) * 70;
          racer.vy = 60 + randomUnit() * 30;
          racer.delay = 0.15 + racer.i * 0.04;
        } else {
          racer.y = -12 - racer.i * 5;
          racer.x = railX(racer);
        }
      });
    }

    function renderStage() {
      stopFrame();
      host.innerHTML = `
        <div class="gm rc">
          <div class="gm-hud" id="rc-hud">
            ${hudStat('사람', String(setup.people), 'left')}
            ${hudStat('꽝', String(setup.losers), 'lose')}
            ${hudStat('도착', '0', 'win')}
            ${soundButton()}
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
          sfx.click();
        }, { signal });
      });
    }

    function sizeCanvas() {
      if (!canvas) return;
      const container = Math.max(240, host.clientWidth || 320);
      const n = setup ? setup.people : 4;
      let width;
      let height;
      if (map.kind === 'track') {
        width = Math.min(container, 780);
        height = Math.max(180, n * LANE_MIN + 26);
      } else {
        width = Math.min(container, 430);
        height = Math.round(Math.min(560, width * (BOARD_H / BOARD_W)));
      }
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      if (ctx2d) ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!race) return;
      race.width = width;
      race.height = height;
      race.scale = map.kind === 'track' ? 1 : Math.min(width / BOARD_W, height / BOARD_H);
      race.offsetX = map.kind === 'track' ? 0 : (width - BOARD_W * race.scale) / 2;
      race.offsetY = map.kind === 'track' ? 0 : (height - BOARD_H * race.scale) / 2;
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
      const delta = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 1 / 60;
      lastTime = now;

      if (race.countdown > 0) {
        const before = Math.ceil(race.countdown / 0.6);
        race.countdown = Math.max(0, race.countdown - delta * speed);
        const after = Math.ceil(race.countdown / 0.6);
        if (after !== before) sfx.beep(after === 0);
        draw();
        raf = requestAnimationFrame(frame);
        return;
      }

      const scaled = delta * speed;
      const steps = Math.max(1, Math.ceil(scaled / STEP));
      const step = scaled / steps;
      for (let index = 0; index < steps; index += 1) simulate(step);

      if (confetti.step(scaled)) { /* 계속 그린다 */ }
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
      race.tape = Math.max(0, race.tape - dt);
      race.sparks.forEach((spark) => { spark.life -= dt; });
      race.sparks = race.sparks.filter((spark) => spark.life > 0);
      if (map.kind === 'track') {
        if (map.id === 'circuit') simulateCircuit(dt);
        else simulateSprint(dt);
      } else if (map.id === 'pinball') simulatePinball(dt);
      else simulateRail(dt);
      if (race.t > 40) forceFinish();
    }

    function addSpark(x, y, options = {}) {
      race.sparks.push({
        x,
        y,
        life: options.life || 0.45,
        max: options.life || 0.45,
        color: options.color || ink.accent,
        size: options.size || 9,
        kind: options.kind || 'ring',
        angle: options.angle || 0,
      });
    }

    function pushDust(racer, x, y, color) {
      if (racer.dust.length > 26) racer.dust.shift();
      racer.dust.push({ x, y, vx: -30 - randomUnit() * 40, vy: (randomUnit() - 0.5) * 30, life: 0.5, size: 2 + randomUnit() * 2.4, color });
    }

    function arrive(racer) {
      if (racer.fin != null) return;
      racer.fin = race.t;
      race.arrived += 1;
      racer.rank = race.arrived;
      racer.mood = 'win';
      const banner = host.querySelector('#rc-banner');
      if (banner) {
        banner.textContent = `${racer.rank}등 ${racer.name} 도착`;
        banner.classList.add('is-show');
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(() => banner && banner.classList.remove('is-show'), 1100);
      }
      const live = host.querySelector('#rc-live');
      if (live) live.textContent = `${racer.rank}등 ${racer.name} 도착`;
      if (racer.rank === 1) {
        race.tape = 1;
        sfx.arrive();
        const spot = racerSpot(racer);
        confetti.burst(spot.x, spot.y, { count: 22, speed: 190, spread: Math.PI * 1.3 });
      } else {
        sfx.tick();
      }
      if (race.arrived >= race.n) race.done = true;
    }

    function laneHeight() {
      return race.height / race.n;
    }

    /** 서킷은 트랙 전체가 좌우로 굽이친다. 모든 레인이 같은 굽이를 따라 평행을 지킨다. */
    function trackCurve(p) {
      if (map.id !== 'circuit') return 0;
      return Math.sin(p * Math.PI * 2 * 1.15) * laneHeight() * 0.2;
    }

    function laneCurve(racer, p) {
      return trackCurve(p);
    }

    function trackSpot(racer) {
      const h = laneHeight();
      const startX = 34;
      const finishX = race.width - 24;
      const x = startX + (finishX - startX) * racer.p;
      let y = racer.i * h + h / 2 + laneCurve(racer, racer.p);
      if (racer.jump > 0) y -= Math.sin(racer.jump * Math.PI) * h * 0.7;
      return { x, y, laneH: h };
    }

    /** 맵과 상관없이 화면 위의 자리 — 컨페티 터뜨릴 때. */
    function racerSpot(racer) {
      if (map.kind === 'track') return trackSpot(racer);
      return {
        x: race.offsetX + racer.x * race.scale,
        y: race.offsetY + racer.y * race.scale,
        laneH: laneHeight(),
      };
    }

    function useBurst(racer, message) {
      racer.boost = 0.85;
      racer.mood = 'run';
      race.sparks.push({
        x: trackSpot(racer).x,
        y: trackSpot(racer).y,
        life: 0.3,
        max: 0.3,
        color: ink.boost,
        size: 13,
        kind: 'burst',
      });
      sfx.boost();
      if (message) {
        racer.windTag = message;
        racer.wind = 0.9;
      }
    }

    function takeHit(racer, kind) {
      racer.slow = kind === 'gate' ? 0.55 : 0.7;
      racer.hit = 0.5;
      racer.mood = 'hit';
      const spot = trackSpot(racer);
      addSpark(spot.x, spot.y, { color: kind === 'mud' ? ink.mud : ink.warn, size: 10 });
      if (kind === 'mud') sfx.splash();
      else sfx.bump();
    }

    function simulateSprint(dt) {
      const base = 1 / 6.4;
      const { props } = race;
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        racer.boost = Math.max(0, racer.boost - dt);
        racer.slow = Math.max(0, racer.slow - dt);
        racer.hit = Math.max(0, racer.hit - dt);
        racer.wind = Math.max(0, racer.wind - dt);
        if (racer.hit <= 0 && racer.mood === 'hit') racer.mood = 'run';
        const before = racer.p;
        const gate = props.lanes[racer.i];
        let rate = base * racer.skill;
        if (racer.boost > 0) rate *= 1.85;
        if (racer.slow > 0) rate *= 0.42;
        racer.p = Math.min(1, racer.p + rate * dt);

        if (before < gate.boostAt && racer.p >= gate.boostAt) {
          useBurst(racer, '부스터');
          racer.windTag = '';
          racer.wind = 0;
        }
        if (before < gate.hazardAt && racer.p >= gate.hazardAt) takeHit(racer, gate.hazard);
        if (before < props.windAt && racer.p >= props.windAt) {
          const tail = randomUnit() < 0.5;
          racer.wind = 1.1;
          racer.windTag = tail ? '순풍' : '역풍';
          if (tail) {
            racer.boost = Math.max(racer.boost, 0.9);
            sfx.boost();
          } else {
            racer.slow = Math.max(racer.slow, 0.8);
            sfx.whoosh();
          }
        }
        if (racer.p >= TAPE_P && race.tape <= 0) race.tape = 1;

        const spot = trackSpot(racer);
        racer.trail.push({ x: spot.x, y: spot.y, life: 0.55 });
        if (racer.trail.length > 14) racer.trail.shift();
        if (racer.boost > 0 || racer.p > 0.05) {
          racer.todo -= dt;
          if (racer.todo <= 0) {
            racer.todo = 0.05;
            pushDust(racer, spot.x - 6, spot.y + 4, characterColor(racer.color));
          }
        }
        racer.dust.forEach((part) => {
          part.life -= dt;
          part.x += part.vx * dt;
          part.y += part.vy * dt;
        });
        racer.dust = racer.dust.filter((part) => part.life > 0);
        if (racer.p >= 1) arrive(racer);
      });
    }

    function simulateCircuit(dt) {
      const base = 1 / 6.8;
      const { props } = race;
      const gateOpen = Math.sin(race.t * 2.2 + props.gatePhase) > -0.1;
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        racer.boost = Math.max(0, racer.boost - dt);
        racer.slow = Math.max(0, racer.slow - dt);
        racer.hit = Math.max(0, racer.hit - dt);
        racer.jump = Math.max(0, racer.jump - dt * 3.2);
        if (racer.hit <= 0 && racer.mood === 'hit') racer.mood = 'run';
        const before = racer.p;
        let rate = base * racer.skill * (racer.boost > 0 ? 1.7 : 1) * (racer.slow > 0 ? 0.45 : 1);
        if (props.lanes[racer.i].speedLane && racer.p > 0.3 && racer.p < 0.42) rate *= 1.4;
        racer.p = Math.min(1, racer.p + rate * dt);

        props.hurdles.forEach((hurdle) => {
          if (before < hurdle.p && racer.p >= hurdle.p) {
            racer.jump = 1;
            if (!hurdle.open && randomUnit() < 0.7) takeHit(racer, 'hurdle');
            else {
              sfx.tick();
              const spot = trackSpot(racer);
              addSpark(spot.x, spot.y, { color: ink.accent, size: 7 });
            }
          }
        });
        if (before < props.gateAt && racer.p >= props.gateAt && !gateOpen) takeHit(racer, 'gate');

        const spot = trackSpot(racer);
        racer.trail.push({ x: spot.x, y: spot.y, life: 0.5 });
        if (racer.trail.length > 12) racer.trail.shift();
        racer.dust.forEach((part) => {
          part.life -= dt;
          part.x += part.vx * dt;
          part.y += part.vy * dt;
        });
        racer.dust = racer.dust.filter((part) => part.life > 0);
        if (racer.p >= 1) arrive(racer);
      });
    }

    /* ------------------------------ 핀볼 ------------------------------ */

    function buildPinball() {
      const pegs = [];
      const rows = [
        { y: 96, count: 3, r: 13, spin: true },
        { y: 168, count: 4, r: 12, spin: false },
        { y: 244, count: 3, r: 14, spin: true },
        { y: 312, count: 4, r: 11, spin: false },
      ];
      rows.forEach((row, rowIndex) => {
        for (let index = 0; index < row.count; index += 1) {
          const x = (BOARD_W * (index + 1)) / (row.count + 1);
          pegs.push({
            x,
            y: row.y + (rowIndex % 2 ? 6 : 0),
            r: row.r,
            kind: row.spin ? 'spinner' : 'bumper',
            angle: randomUnit() * Math.PI,
            omega: (randomUnit() < 0.5 ? -1 : 1) * (1.3 + randomUnit() * 0.9),
            hit: 0,
            len: row.spin ? 31 : 0,
          });
        }
      });
      return {
        pegs,
        guides: [
          { x1: 8, y1: BOARD_H - 96, x2: 92, y2: BOARD_H - 24 },
          { x1: BOARD_W - 8, y1: BOARD_H - 96, x2: BOARD_W - 92, y2: BOARD_H - 24 },
          { x1: 46, y1: 44, x2: 12, y2: 96 },
          { x1: BOARD_W - 46, y1: 44, x2: BOARD_W - 12, y2: 96 },
        ],
      };
    }

    function simulatePinball(dt) {
      const gravity = 640;
      const { pegs, guides } = race.pegs;
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        if (racer.delay > 0) {
          racer.delay -= dt;
          return;
        }
        racer.mood = racer.hit > 0 ? 'hit' : 'run';
        racer.hit = Math.max(0, racer.hit - dt);
        racer.vy += gravity * dt;
        racer.vx *= 1 - 0.35 * dt;
        racer.x = clamp(racer.x + racer.vx * dt, racer.rad, BOARD_W - racer.rad);
        racer.y += racer.vy * dt;
        if (racer.y < racer.rad) {
          racer.y = racer.rad;
          racer.vy = Math.abs(racer.vy) * 0.6;
        }

        pegs.forEach((peg) => {
          peg.hit = Math.max(0, peg.hit - dt);
          if (peg.kind === 'spinner') {
            peg.angle += peg.omega * dt;
            // 회전 막대의 한 점(끝)과 공의 충돌
            for (const dir of [-1, 1]) {
              const ex = peg.x + Math.cos(peg.angle) * peg.len * dir;
              const ey = peg.y + Math.sin(peg.angle) * peg.len * dir;
              const dx = racer.x - ex;
              const dy = racer.y - ey;
              const distance = Math.hypot(dx, dy);
              const min = racer.rad + 3;
              if (distance > min || distance < 0.01) continue;
              const nx = dx / distance;
              const ny = dy / distance;
              racer.x = ex + nx * min;
              racer.y = ey + ny * min;
              const dot = racer.vx * nx + racer.vy * ny;
              racer.vx = (racer.vx - 2 * dot * nx) * 0.86 + Math.cos(peg.angle + Math.PI / 2) * peg.omega * 26;
              racer.vy = (racer.vy - 2 * dot * ny) * 0.86 + Math.sin(peg.angle + Math.PI / 2) * peg.omega * 26;
              peg.hit = 0.22;
              addSpark(ex, ey, { color: ink.accent, size: 7, kind: 'spark' });
              sfx.tick();
            }
            return;
          }
          const dx = racer.x - peg.x;
          const dy = racer.y - peg.y;
          const distance = Math.hypot(dx, dy);
          const min = racer.rad + peg.r;
          if (distance > min || distance < 0.01) return;
          const nx = dx / distance;
          const ny = dy / distance;
          racer.x = peg.x + nx * min;
          racer.y = peg.y + ny * min;
          const dot = racer.vx * nx + racer.vy * ny;
          racer.vx = (racer.vx - 2 * dot * nx) * 0.72 + (randomUnit() - 0.5) * 120;
          racer.vy = (racer.vy - 2 * dot * ny) * 0.72 - 40;
          peg.hit = 0.28;
          addSpark(peg.x + nx * peg.r, peg.y + ny * peg.r, { color: ink.boost, size: peg.r * 0.7, life: 0.32 });
          sfx.bump();
        });

        guides.forEach((guide) => {
          const dx = guide.x2 - guide.x1;
          const dy = guide.y2 - guide.y1;
          const lengthSq = dx * dx + dy * dy || 1;
          const t = clamp(((racer.x - guide.x1) * dx + (racer.y - guide.y1) * dy) / lengthSq, 0, 1);
          const px = guide.x1 + dx * t;
          const py = guide.y1 + dy * t;
          const ox = racer.x - px;
          const oy = racer.y - py;
          const distance = Math.hypot(ox, oy);
          const min = racer.rad + 3;
          if (distance > min || distance < 0.01) return;
          const nx = ox / distance;
          const ny = oy / distance;
          racer.x = px + nx * min;
          racer.y = py + ny * min;
          const dot = racer.vx * nx + racer.vy * ny;
          racer.vx = (racer.vx - 2 * dot * nx) * 0.82;
          racer.vy = (racer.vy - 2 * dot * ny) * 0.82;
        });

        racer.trail.push({ x: racer.x, y: racer.y, life: 0.5 });
        if (racer.trail.length > 12) racer.trail.shift();
        racer.dust.forEach((part) => {
          part.life -= dt;
          part.x += part.vx * dt;
          part.y += part.vy * dt;
        });
        racer.dust = racer.dust.filter((part) => part.life > 0);

        if (racer.y > BOARD_H - 14) {
          racer.y = BOARD_H - 14;
          arrive(racer);
        }
      });
    }

    /* ------------------------------ 지그재그 레일 ------------------------------ */

    function buildRail(n) {
      const lanes = Array.from({ length: n }, (_, index) => ({
        waves: 3.4 + (index % 3) * 0.5,
        phase: (index * Math.PI * 2) / Math.max(1, n) * 0.7,
        amp: Math.min(28, (BOARD_W / Math.max(2, n)) * 0.34),
      }));
      const platforms = [
        { y: BOARD_H * 0.3, x: BOARD_W * 0.34, dir: 1, speed: 52, width: 84, height: 13 },
        { y: BOARD_H * 0.58, x: BOARD_W * 0.66, dir: -1, speed: 60, width: 80, height: 13 },
      ];
      return { lanes, platforms, chutes: [{ from: 0.12, to: 0.2 }, { from: 0.44, to: 0.5 }, { from: 0.76, to: 0.82 }] };
    }

    function railX(racer) {
      const lane = race.rails.lanes[racer.i];
      const laneWidth = BOARD_W / race.n;
      const center = laneWidth * (racer.i + 0.5);
      return center + Math.sin((racer.y / BOARD_H) * Math.PI * 2 * lane.waves + lane.phase) * lane.amp;
    }

    function simulateRail(dt) {
      const { platforms, chutes } = race.rails;
      platforms.forEach((platform) => {
        platform.x += platform.dir * platform.speed * dt;
        if (platform.x > BOARD_W * 0.74) { platform.x = BOARD_W * 0.74; platform.dir = -1; }
        if (platform.x < BOARD_W * 0.26) { platform.x = BOARD_W * 0.26; platform.dir = 1; }
      });
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        racer.hit = Math.max(0, racer.hit - dt);
        racer.mood = racer.hit > 0 ? 'hit' : 'run';
        const ratio = racer.y / BOARD_H;
        let speedFactor = 0.92 + 0.2 * Math.cos(ratio * Math.PI * 2);
        let onChute = false;
        chutes.forEach((chute) => {
          if (ratio >= chute.from && ratio <= chute.to) onChute = true;
        });
        if (onChute) speedFactor *= 1.6;
        if (racer.boost > 0) {
          racer.boost = Math.max(0, racer.boost - dt);
          speedFactor *= 1.5;
        }
        racer.vy = (88 + 26 * (racer.i % 3)) * racer.skill * speedFactor;
        racer.y += racer.vy * dt;
        let x = railX(racer);

        platforms.forEach((platform) => {
          if (racer.y > platform.y - 8 && racer.y < platform.y + platform.height + 6) {
            const half = platform.width / 2;
            if (x > platform.x - half - 10 && x < platform.x + half + 10) {
              x += platform.dir * platform.speed * dt * 1.4;
              if (racer.todo <= 0) {
                racer.todo = 0.25;
                sfx.tick();
              }
            }
          }
        });
        racer.todo = Math.max(0, (racer.todo || 0) - dt);
        racer.x = clamp(x, racer.rad, BOARD_W - racer.rad);
        racer.trail.push({ x: racer.x, y: racer.y, life: 0.5 });
        if (racer.trail.length > 12) racer.trail.shift();
        racer.dust.forEach((part) => {
          part.life -= dt;
          part.x += part.vx * dt;
          part.y += part.vy * dt;
        });
        racer.dust = racer.dust.filter((part) => part.life > 0);
        if (racer.y >= BOARD_H - 16) {
          racer.y = BOARD_H - 16;
          arrive(racer);
        }
      });
    }

    function forceFinish() {
      const rest = race.racers.filter((racer) => racer.fin == null);
      rest.sort((a, b) => (b.p - a.p) || (b.y - a.y));
      rest.forEach((racer) => arrive(racer));
      race.done = true;
    }

    /* ------------------------------ 그리기 ------------------------------ */

    function draw() {
      if (!ctx2d || !race) return;
      const { width, height } = race;
      ctx2d.clearRect(0, 0, width, height);
      if (!width || !height) return;
      if (map.kind === 'track') {
        drawTrack();
        race.racers.forEach(drawTrackRacer);
        if (map.id === 'circuit') drawGates();
      } else {
        ctx2d.save();
        ctx2d.translate(race.offsetX, race.offsetY);
        ctx2d.scale(race.scale, race.scale);
        if (map.id === 'pinball') drawPinball();
        else drawRailBoard();
        race.racers.forEach(drawDropRacer);
        ctx2d.restore();
      }
      drawSparks();
      confetti.draw(ctx2d);
      if (race.countdown > 0) drawCountdown();
    }

    function drawCountdown() {
      const { width, height } = race;
      const step = Math.ceil(race.countdown / 0.6);
      const label = step > 0 ? String(Math.min(3, step)) : '출발';
      const pulse = 1 - (race.countdown % 0.6) / 0.6;
      const size = Math.min(96, width * 0.2);
      ctx2d.save();
      ctx2d.fillStyle = ink.dark ? '#16181C' : '#FFFFFF';
      ctx2d.globalAlpha = 0.62;
      ctx2d.fillRect(0, 0, width, height);
      ctx2d.globalAlpha = 0.9;
      ctx2d.strokeStyle = ink.accent;
      ctx2d.lineWidth = 3;
      ctx2d.beginPath();
      ctx2d.arc(width / 2, height / 2, size * (0.62 + pulse * 0.12), 0, Math.PI * 2);
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = ink.accent;
      ctx2d.font = `800 ${size}px Pretendard, system-ui, sans-serif`;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(label, width / 2, height / 2 + size * 0.03);
      ctx2d.globalAlpha = 0.75;
      ctx2d.fillStyle = ink.ink;
      ctx2d.font = '650 12px Pretendard, system-ui, sans-serif';
      ctx2d.fillText('출발 준비', width / 2, height / 2 + size * 0.78);
      ctx2d.restore();
    }

    /* ---------- 트랙 배경 ---------- */

    function drawTrack() {
      const { width, height } = race;
      const h = laneHeight();
      const startX = 34;
      const finishX = width - 24;

      ctx2d.save();
      ctx2d.fillStyle = ink.turf;
      ctx2d.fillRect(0, 0, width, height);

      // 잔디 결 (질주 트랙만)
      if (map.id === 'sprint') {
        ctx2d.fillStyle = ink.turf2;
        for (let x = 0; x < width; x += 48) {
          if ((x / 48) % 2 < 1) ctx2d.fillRect(x, 0, 24, height);
        }
      }
      ctx2d.restore();

      if (map.id === 'circuit') drawCircuitLanes(startX, finishX, h);
      else drawSprintLanes(startX, finishX, h);

      if (map.id === 'sprint') drawSprintProps(startX, finishX, h);
      else drawCircuitProps(startX, finishX, h);

      drawStartFinish(startX, finishX, h);
    }

    function drawSprintLanes(startX, finishX, laneH) {
      for (let lane = 0; lane < race.n; lane += 1) {
        const top = lane * laneH;
        ctx2d.save();
        ctx2d.fillStyle = lane % 2 ? ink.lane2 : ink.lane;
        ctx2d.globalAlpha = 0.92;
        ctx2d.fillRect(startX - 12, top + 2, finishX - startX + 16, laneH - 4);
        ctx2d.globalAlpha = 0.4;
        ctx2d.strokeStyle = ink.lineStrong;
        ctx2d.lineWidth = 1;
        ctx2d.setLineDash([7, 8]);
        segment(ctx2d, startX - 12, top + laneH, finishX + 4, top + laneH);
        ctx2d.stroke();
        ctx2d.restore();
      }
    }

    /** 서킷은 트랙 전체가 하나의 굽이진 길이다. 길 하나를 깔고 차선만 점선으로 나눈다. */
    function drawCircuitLanes(startX, finishX, laneH) {
      const left = startX - 14;
      const right = finishX + 8;
      const top = laneH * 0.05;
      const bottom = race.n * laneH - laneH * 0.05;
      const yAt = (edge, x) => edge + trackCurve((x - left) / (right - left));

      ctx2d.save();
      ctx2d.beginPath();
      for (let x = left; x <= right; x += 4) {
        const y = yAt(top, x);
        if (x === left) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      for (let x = right; x >= left; x -= 4) {
        ctx2d.lineTo(x, yAt(bottom, x));
      }
      ctx2d.closePath();
      ctx2d.fillStyle = ink.lane;
      ctx2d.fill();
      ctx2d.strokeStyle = ink.lineStrong;
      ctx2d.globalAlpha = 0.4;
      ctx2d.lineWidth = 1.5;
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;

      // 차선 점선
      ctx2d.strokeStyle = ink.lineStrong;
      ctx2d.globalAlpha = 0.38;
      ctx2d.lineWidth = 1;
      ctx2d.setLineDash([8, 9]);
      for (let lane = 1; lane < race.n; lane += 1) {
        ctx2d.beginPath();
        for (let x = left + 6; x <= right - 6; x += 4) {
          const y = yAt(lane * laneH, x);
          if (x === left + 6) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
      }
      ctx2d.restore();
    }

    function drawSprintProps(startX, finishX, laneH) {
      const { props } = race;
      const span = finishX - startX;
      props.lanes.forEach((lane, index) => {
        const y = index * laneH + laneH / 2;
        // 부스터 패드
        const bx = startX + span * lane.boostAt;
        ctx2d.save();
        ctx2d.fillStyle = ink.boost;
        ctx2d.globalAlpha = 0.9;
        roundRect(ctx2d, bx - 13, y - 9, 26, 18, 5);
        ctx2d.fill();
        ctx2d.globalAlpha = 1;
        ctx2d.strokeStyle = '#FFFFFF';
        ctx2d.lineWidth = 2;
        ctx2d.lineCap = 'round';
        for (let arrow = 0; arrow < 2; arrow += 1) {
          const ax = bx - 5 + arrow * 8;
          ctx2d.beginPath();
          ctx2d.moveTo(ax - 2, y - 4);
          ctx2d.lineTo(ax + 3, y);
          ctx2d.lineTo(ax - 2, y + 4);
          ctx2d.stroke();
        }
        ctx2d.restore();

        // 방해물
        const hx = startX + span * lane.hazardAt;
        ctx2d.save();
        if (lane.hazard === 'mud') {
          ctx2d.fillStyle = ink.mud;
          ctx2d.globalAlpha = 0.85;
          ctx2d.beginPath();
          ctx2d.ellipse(hx, y + 2, 13, 6.5, 0, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.beginPath();
          ctx2d.ellipse(hx - 5, y - 2, 5, 3, -0.3, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.globalAlpha = 1;
        } else {
          ctx2d.fillStyle = '#F2C230';
          ctx2d.strokeStyle = '#B08A10';
          ctx2d.lineWidth = 1.2;
          ctx2d.beginPath();
          ctx2d.moveTo(hx - 8, y + 4);
          ctx2d.quadraticCurveTo(hx - 2, y - 9, hx + 8, y - 4);
          ctx2d.quadraticCurveTo(hx + 2, y - 1, hx - 3, y + 6);
          ctx2d.closePath();
          ctx2d.fill();
          ctx2d.stroke();
        }
        ctx2d.restore();
      });

      // 순풍·역풍 게이트
      const gx = startX + span * props.windAt;
      ctx2d.save();
      ctx2d.strokeStyle = ink.accent;
      ctx2d.globalAlpha = 0.5;
      ctx2d.lineWidth = 2;
      ctx2d.setLineDash([6, 6]);
      segment(ctx2d, gx, 0, gx, laneH * race.n);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = ink.card;
      roundRect(ctx2d, gx - 22, 4, 44, 16, 8);
      ctx2d.fill();
      ctx2d.strokeStyle = ink.accent;
      ctx2d.globalAlpha = 0.5;
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = ink.accent;
      ctx2d.font = '650 9.5px Pretendard, system-ui, sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText('순풍 · 역풍', gx, 12);
      ctx2d.restore();
    }

    function drawCircuitProps(startX, finishX, laneH) {
      const { props } = race;
      const span = finishX - startX;
      const laneY = (index, p) => index * laneH + laneH / 2 + trackCurve(p);

      // 가속 레인
      props.lanes.forEach((lane, index) => {
        if (!lane.speedLane) return;
        ctx2d.save();
        ctx2d.strokeStyle = ink.accent;
        ctx2d.globalAlpha = 0.1;
        ctx2d.lineWidth = laneH - 12;
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        for (let x = startX + span * 0.3; x <= startX + span * 0.42; x += 4) {
          const p = (x - startX) / span;
          const y = laneY(index, p);
          if (x === startX + span * 0.3) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        ctx2d.globalAlpha = 0.62;
        ctx2d.lineWidth = 1.8;
        for (let x = startX + span * 0.3 + 10; x < startX + span * 0.42 - 6; x += 18) {
          const p = (x - startX) / span;
          const y = laneY(index, p);
          ctx2d.beginPath();
          ctx2d.moveTo(x, y - laneH * 0.16);
          ctx2d.lineTo(x + 5, y);
          ctx2d.lineTo(x, y + laneH * 0.16);
          ctx2d.stroke();
        }
        ctx2d.restore();
      });

      // 허들
      props.hurdles.forEach((hurdle) => {
        const x = startX + span * hurdle.p;
        for (let index = 0; index < race.n; index += 1) {
          const y = laneY(index, hurdle.p);
          const top = y - laneH * 0.3;
          const height = laneH * 0.6;
          ctx2d.save();
          roundRect(ctx2d, x - 12, y + laneH * 0.24, 24, 4, 2);
          ctx2d.fillStyle = hurdle.open ? ink.lineStrong : ink.tape;
          ctx2d.globalAlpha = 0.22;
          ctx2d.fill();
          ctx2d.globalAlpha = 1;
          roundRect(ctx2d, x - 3.5, top, 7, height, 2.6);
          ctx2d.fillStyle = hurdle.open ? ink.card : ink.tape;
          ctx2d.fill();
          ctx2d.save();
          roundRect(ctx2d, x - 3.5, top, 7, height, 2.6);
          ctx2d.clip();
          ctx2d.fillStyle = '#FFFFFF';
          ctx2d.globalAlpha = hurdle.open ? 0.55 : 0.85;
          for (let mark = top + 3; mark < top + height; mark += 7) {
            ctx2d.fillRect(x - 3.5, mark, 7, 3.4);
          }
          ctx2d.restore();
          roundRect(ctx2d, x - 3.5, top, 7, height, 2.6);
          ctx2d.strokeStyle = hurdle.open ? ink.lineStrong : ink.tape;
          ctx2d.globalAlpha = 0.55;
          ctx2d.lineWidth = 1;
          ctx2d.stroke();
          ctx2d.restore();
        }
      });

      // 여닫는 게이트
      const gateOpen = Math.sin(race.t * 2.2 + props.gatePhase) > -0.1;
      const gx = startX + span * props.gateAt;
      ctx2d.save();
      ctx2d.strokeStyle = ink.lineStrong;
      ctx2d.lineWidth = 1;
      ctx2d.globalAlpha = 0.7;
      ctx2d.setLineDash([4, 6]);
      segment(ctx2d, gx, 0, gx, laneH * race.n);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
      ctx2d.globalAlpha = 1;
      ctx2d.fillStyle = ink.card;
      ctx2d.strokeStyle = gateOpen ? ink.accent : ink.tape;
      ctx2d.lineWidth = 1.2;
      roundRect(ctx2d, gx - 24, 4, 48, 16, 8);
      ctx2d.fill();
      ctx2d.stroke();
      ctx2d.fillStyle = gateOpen ? ink.accent : ink.tape;
      ctx2d.font = '650 9.5px Pretendard, system-ui, sans-serif';
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(gateOpen ? '열림' : '닫힘', gx, 12);
      ctx2d.restore();
    }

    function drawStartFinish(startX, finishX, laneH) {
      const height = race.height;
      // 출발선
      ctx2d.save();
      for (let y = 0; y < height; y += 7) {
        ctx2d.fillStyle = Math.floor(y / 7) % 2 ? ink.text : ink.card;
        ctx2d.globalAlpha = 0.5;
        ctx2d.fillRect(startX - 16, y, 3, 7);
      }
      ctx2d.globalAlpha = 1;

      // 결승 체커
      const cell = Math.max(4, Math.min(7, laneH / 4.4));
      for (let y = 0; y < height; y += cell) {
        for (let column = 0; column < 3; column += 1) {
          ctx2d.fillStyle = ((y / cell) + column) % 2 ? ink.text : ink.card;
          ctx2d.globalAlpha = 0.72;
          ctx2d.fillRect(finishX + column * cell, y, cell, cell);
        }
      }
      ctx2d.globalAlpha = 1;

      // 결승 테이프 — 1등이 끊는다
      if (race.tape > 0) {
        const fall = 1 - race.tape;
        ctx2d.strokeStyle = ink.tape;
        ctx2d.lineWidth = 4;
        ctx2d.lineCap = 'round';
        ctx2d.globalAlpha = Math.max(0, race.tape);
        segment(ctx2d, finishX - 2, 6 + fall * 26, finishX - 26 - fall * 22, 10 + fall * 40);
        ctx2d.stroke();
        segment(ctx2d, finishX + 20, 10 + fall * 30, finishX + 44 + fall * 18, 6 + fall * 44);
        ctx2d.stroke();
        ctx2d.globalAlpha = 1;
      }
      ctx2d.restore();
    }

    function drawTrackRacer(racer) {
      const spot = trackSpot(racer);
      const color = characterColor(racer.color);
      const laneH = spot.laneH;

      // 궤적
      ctx2d.save();
      racer.trail.forEach((point, index) => {
        const alpha = ((index + 1) / racer.trail.length) * 0.35;
        ctx2d.globalAlpha = alpha;
        ctx2d.fillStyle = color;
        ctx2d.beginPath();
        ctx2d.arc(point.x, point.y, 2 + index * 0.16, 0, Math.PI * 2);
        ctx2d.fill();
      });
      ctx2d.restore();

      // 먼지
      ctx2d.save();
      racer.dust.forEach((part) => {
        ctx2d.globalAlpha = Math.max(0, part.life);
        ctx2d.fillStyle = part.color;
        ctx2d.beginPath();
        ctx2d.arc(part.x, part.y, part.size, 0, Math.PI * 2);
        ctx2d.fill();
      });
      ctx2d.restore();

      // 부스터 불꽃
      if (racer.boost > 0) {
        ctx2d.save();
        ctx2d.strokeStyle = ink.boost;
        ctx2d.lineWidth = 2;
        ctx2d.lineCap = 'round';
        ctx2d.globalAlpha = Math.min(1, racer.boost * 2);
        for (let index = 0; index < 3; index += 1) {
          const bx = spot.x - 12 - index * 6;
          ctx2d.beginPath();
          ctx2d.moveTo(bx - 4, spot.y - 4);
          ctx2d.lineTo(bx + 1, spot.y);
          ctx2d.lineTo(bx - 4, spot.y + 4);
          ctx2d.stroke();
        }
        ctx2d.restore();
      }

      const size = Math.max(15, Math.min(21, laneH * 0.52));
      const mood = racer.fin != null ? (racer.rank <= race.n - race.losers ? 'win' : 'lose') : racer.mood;
      drawCharacter(ctx2d, racer.color, spot.x, spot.y, size, {
        mood: mood === 'idle' ? 'run' : mood,
        t: race.t * 1000,
        tilt: racer.boost > 0 ? -0.14 : Math.sin(race.t * 12 + racer.i) * 0.05,
        sparkle: mood === 'win',
      });

      // 이름표
      {
        drawNameTag(ctx2d, racer.name, spot.x, spot.y - size * 0.85 - 2, {
          size: laneH > 44 ? 10 : 8.5,
          maxWidth: Math.max(44, (race.width - 60) / race.n),
          bg: ink.dark ? 'rgba(30,32,38,0.86)' : 'rgba(255,255,255,0.9)',
          border: color,
          color: ink.text,
        });
      }

      // 순풍·역풍 표시
      if (racer.wind > 0 && racer.windTag) {
        ctx2d.save();
        ctx2d.globalAlpha = Math.min(1, racer.wind * 2);
        ctx2d.fillStyle = racer.windTag === '순풍' ? ink.boost : ink.tape;
        ctx2d.font = '700 9px Pretendard, system-ui, sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(racer.windTag, spot.x + size * 0.78, spot.y + size * 0.62);
        ctx2d.restore();
      }
    }

    function drawGates() {
      // 여닫는 게이트의 움직이는 막대
      const { props } = race;
      const laneH = race.height / race.n;
      const startX = 34;
      const finishX = race.width - 24;
      const span = finishX - startX;
      const gx = startX + span * props.gateAt;
      const open = Math.sin(race.t * 2.2 + props.gatePhase) > -0.1;
      ctx2d.save();
      ctx2d.strokeStyle = open ? ink.accentSoft : ink.tape;
      ctx2d.lineWidth = 3;
      ctx2d.lineCap = 'round';
      for (let lane = 0; lane < race.n; lane += 1) {
        const top = lane * laneH;
        const travel = open ? laneH * 0.9 : laneH * 0.15;
        segment(ctx2d, gx, top + 4, gx, top + 4 + travel);
        ctx2d.stroke();
      }
      ctx2d.restore();
    }

    /* ---------- 떨어지는 맵 ---------- */

    function drawPinball() {
      ctx2d.save();
      roundRect(ctx2d, 0, 0, BOARD_W, BOARD_H, 14);
      ctx2d.fillStyle = ink.board;
      ctx2d.fill();
      ctx2d.clip();

      // 판 점 무늬
      ctx2d.fillStyle = ink.boardLine;
      ctx2d.globalAlpha = 0.55;
      for (let y = 16; y < BOARD_H; y += 22) {
        for (let x = 16 + ((y / 22) % 2) * 11; x < BOARD_W; x += 22) {
          ctx2d.beginPath();
          ctx2d.arc(x, y, 1.1, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }
      ctx2d.globalAlpha = 1;
      ctx2d.restore();

      const { pegs, guides } = race.pegs;

      // 가이드
      ctx2d.save();
      ctx2d.lineCap = 'round';
      ctx2d.strokeStyle = ink.ink;
      ctx2d.globalAlpha = 0.8;
      ctx2d.lineWidth = 7;
      guides.forEach((guide) => {
        segment(ctx2d, guide.x1, guide.y1, guide.x2, guide.y2);
        ctx2d.stroke();
      });
      ctx2d.strokeStyle = ink.card;
      ctx2d.globalAlpha = 0.5;
      ctx2d.lineWidth = 2.4;
      guides.forEach((guide) => {
        segment(ctx2d, guide.x1, guide.y1 - 1.6, guide.x2, guide.y2 - 1.6);
        ctx2d.stroke();
      });
      ctx2d.restore();

      // 바닥 골인 띠
      const cell = 8;
      for (let x = 0; x < BOARD_W; x += cell) {
        for (let row = 0; row < 2; row += 1) {
          ctx2d.fillStyle = ((x / cell) + row) % 2 ? ink.text : ink.card;
          ctx2d.globalAlpha = 0.55;
          ctx2d.fillRect(x, BOARD_H - 14 + row * 7, cell, 7);
        }
      }
      ctx2d.globalAlpha = 1;

      pegs.forEach((peg) => {
        if (peg.kind === 'spinner') {
          ctx2d.save();
          ctx2d.translate(peg.x, peg.y);
          ctx2d.rotate(peg.angle);
          ctx2d.lineCap = 'round';
          ctx2d.strokeStyle = peg.hit > 0 ? ink.boost : ink.accent;
          ctx2d.globalAlpha = peg.hit > 0 ? 1 : 0.85;
          ctx2d.lineWidth = 9;
          segment(ctx2d, -peg.len, 0, peg.len, 0);
          ctx2d.stroke();
          ctx2d.strokeStyle = '#FFFFFF';
          ctx2d.globalAlpha = peg.hit > 0 ? 0.95 : 0.55;
          ctx2d.lineWidth = 3;
          segment(ctx2d, -peg.len + 3, 0, peg.len - 3, 0);
          ctx2d.stroke();
          ctx2d.globalAlpha = 1;
          ctx2d.fillStyle = ink.accent;
          ctx2d.beginPath();
          ctx2d.arc(0, 0, 5, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.strokeStyle = ink.card;
          ctx2d.lineWidth = 1.6;
          ctx2d.stroke();
          ctx2d.fillStyle = '#FFFFFF';
          ctx2d.beginPath();
          ctx2d.arc(-1, -1, 1.4, 0, Math.PI * 2);
          ctx2d.fill();
          ctx2d.restore();
          return;
        }
        ctx2d.save();
        if (peg.hit > 0) {
          ctx2d.globalAlpha = Math.min(1, peg.hit * 2.4);
          ctx2d.strokeStyle = ink.boost;
          ctx2d.lineWidth = 2.4;
          ctx2d.beginPath();
          ctx2d.arc(peg.x, peg.y, peg.r + 8 * (1 - peg.hit), 0, Math.PI * 2);
          ctx2d.stroke();
          ctx2d.globalAlpha = 1;
        }
        ctx2d.fillStyle = peg.hit > 0 ? ink.boost : ink.boostSoft;
        ctx2d.strokeStyle = ink.boost;
        ctx2d.globalAlpha = 1;
        ctx2d.lineWidth = 2.8;
        ctx2d.beginPath();
        ctx2d.arc(peg.x, peg.y, peg.r, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.stroke();
        ctx2d.globalAlpha = peg.hit > 0 ? 0.85 : 0.55;
        ctx2d.fillStyle = peg.hit > 0 ? '#FFFFFF' : ink.boost;
        ctx2d.beginPath();
        ctx2d.arc(peg.x, peg.y, peg.r * 0.3, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.globalAlpha = 1;
        ctx2d.restore();
      });
    }

    function drawRailBoard() {
      const { rails } = race;
      ctx2d.save();
      roundRect(ctx2d, 0, 0, BOARD_W, BOARD_H, 14);
      ctx2d.fillStyle = ink.board;
      ctx2d.fill();
      ctx2d.clip();

      // 가속 슈트
      rails.chutes.forEach((chute) => {
        const y1 = BOARD_H * chute.from;
        const y2 = BOARD_H * chute.to;
        ctx2d.fillStyle = ink.boost;
        ctx2d.globalAlpha = 0.12;
        ctx2d.fillRect(0, y1, BOARD_W, y2 - y1);
        ctx2d.globalAlpha = 0.8;
        ctx2d.strokeStyle = ink.boost;
        ctx2d.lineWidth = 2.4;
        ctx2d.lineCap = 'round';
        ctx2d.lineJoin = 'round';
        for (let x = 14; x < BOARD_W - 10; x += 34) {
          const y = (y1 + y2) / 2;
          ctx2d.beginPath();
          ctx2d.moveTo(x, y - 6);
          ctx2d.lineTo(x + 9, y);
          ctx2d.lineTo(x, y + 6);
          ctx2d.stroke();
        }
        ctx2d.globalAlpha = 0.35;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, y1);
        ctx2d.lineTo(BOARD_W, y1);
        ctx2d.moveTo(0, y2);
        ctx2d.lineTo(BOARD_W, y2);
        ctx2d.stroke();
        ctx2d.globalAlpha = 1;
      });

      // 레일
      const laneWidth = BOARD_W / race.n;
      for (let index = 0; index < race.n; index += 1) {
        const lane = rails.lanes[index];
        const center = laneWidth * (index + 0.5);
        ctx2d.beginPath();
        for (let y = 0; y <= BOARD_H - 12; y += 5) {
          const x = center + Math.sin((y / BOARD_H) * Math.PI * 2 * lane.waves + lane.phase) * lane.amp;
          if (y === 0) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.strokeStyle = ink.lineStrong;
        ctx2d.globalAlpha = 0.5;
        ctx2d.lineWidth = 4;
        ctx2d.stroke();
        ctx2d.globalAlpha = 0.9;
        ctx2d.strokeStyle = characterColor(index);
        ctx2d.lineWidth = 1.4;
        ctx2d.stroke();
        ctx2d.globalAlpha = 1;
      }

      // 왕복 발판
      rails.platforms.forEach((platform) => {
        ctx2d.save();
        ctx2d.fillStyle = ink.card;
        ctx2d.strokeStyle = ink.accent;
        ctx2d.lineWidth = 2;
        roundRect(ctx2d, platform.x - platform.width / 2, platform.y, platform.width, platform.height, 6);
        ctx2d.fill();
        ctx2d.globalAlpha = 0.8;
        ctx2d.stroke();
        ctx2d.globalAlpha = 0.55;
        ctx2d.strokeStyle = ink.accent;
        ctx2d.lineWidth = 1.6;
        for (let x = platform.x - platform.width / 2 + 8; x < platform.x + platform.width / 2 - 5; x += 10) {
          segment(ctx2d, x, platform.y + 3, x, platform.y + platform.height - 3);
          ctx2d.stroke();
        }
        ctx2d.globalAlpha = 0.85;
        ctx2d.fillStyle = ink.accent;
        ctx2d.beginPath();
        ctx2d.moveTo(platform.x - 12, platform.y + platform.height / 2);
        ctx2d.lineTo(platform.x - 6, platform.y + 2);
        ctx2d.lineTo(platform.x - 6, platform.y + platform.height - 2);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.beginPath();
        ctx2d.moveTo(platform.x + 12, platform.y + platform.height / 2);
        ctx2d.lineTo(platform.x + 6, platform.y + 2);
        ctx2d.lineTo(platform.x + 6, platform.y + platform.height - 2);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.restore();
      });

      // 바닥 골인 띠
      const cell = 8;
      for (let x = 0; x < BOARD_W; x += cell) {
        for (let row = 0; row < 2; row += 1) {
          ctx2d.fillStyle = ((x / cell) + row) % 2 ? ink.text : ink.card;
          ctx2d.globalAlpha = 0.55;
          ctx2d.fillRect(x, BOARD_H - 14 + row * 7, cell, 7);
        }
      }
      ctx2d.globalAlpha = 1;
      // 위쪽 출발 띠
      ctx2d.fillStyle = ink.card;
      ctx2d.globalAlpha = 0.6;
      ctx2d.fillRect(0, 0, BOARD_W, 10);
      ctx2d.globalAlpha = 1;
      ctx2d.restore();
    }

    function drawDropRacer(racer) {
      const color = characterColor(racer.color);
      const x = racer.x;
      const y = racer.y;

      // 궤적
      ctx2d.save();
      racer.trail.forEach((point, index) => {
        ctx2d.globalAlpha = ((index + 1) / racer.trail.length) * 0.3;
        ctx2d.fillStyle = color;
        ctx2d.beginPath();
        ctx2d.arc(point.x, point.y, 1.6 + index * 0.18, 0, Math.PI * 2);
        ctx2d.fill();
      });
      ctx2d.restore();

      const size = racer.rad * 2.5;
      drawCharacter(ctx2d, racer.color, x, y, size, {
        mood: racer.fin != null ? (racer.rank <= race.n - race.losers ? 'win' : 'lose') : (racer.hit > 0 ? 'hit' : 'run'),
        t: race.t * 1000,
        tilt: clamp(racer.vx / 420, -0.4, 0.4),
        sparkle: racer.fin != null && racer.rank <= race.n - race.losers,
      });

      drawNameTag(ctx2d, racer.name, x, y - size * 0.72 - 5, {
        size: 9,
        maxWidth: Math.max(38, (BOARD_W / race.n) * 1.5),
        bg: ink.dark ? 'rgba(30,32,38,0.86)' : 'rgba(255,255,255,0.92)',
        border: color,
        color: ink.text,
      });
    }

    function drawSparks() {
      if (!race.sparks.length) return;
      const offsetX = map.kind === 'track' ? 0 : race.offsetX;
      const offsetY = map.kind === 'track' ? 0 : race.offsetY;
      const scale = map.kind === 'track' ? 1 : race.scale;
      ctx2d.save();
      ctx2d.translate(offsetX, offsetY);
      ctx2d.scale(scale, scale);
      race.sparks.forEach((spark) => {
        const ratio = spark.life / spark.max;
        ctx2d.globalAlpha = Math.max(0, ratio);
        ctx2d.strokeStyle = spark.color;
        ctx2d.lineWidth = 2;
        if (spark.kind === 'spark') {
          ctx2d.beginPath();
          for (let index = 0; index < 4; index += 1) {
            const angle = (Math.PI * 2 * index) / 4 + spark.angle;
            segment(
              ctx2d,
              spark.x + Math.cos(angle) * spark.size * 0.3,
              spark.y + Math.sin(angle) * spark.size * 0.3,
              spark.x + Math.cos(angle) * spark.size * (1.4 - ratio * 0.4),
              spark.y + Math.sin(angle) * spark.size * (1.4 - ratio * 0.4),
            );
            ctx2d.stroke();
          }
        } else {
          ctx2d.beginPath();
          ctx2d.arc(spark.x, spark.y, spark.size * (1.6 - ratio), 0, Math.PI * 2);
          ctx2d.stroke();
        }
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
          <span class="rc-dot" style="background: ${characterColor(racer.color)}"></span>
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
        if (racer.fin == null) racer.fin = race.t + index * 0.01;
        if (!racer.rank) racer.rank = race.n;
        racer.mood = racer.rank <= race.n - race.losers ? 'win' : 'lose';
      });
      const order = orderedRacers();
      const winCount = race.n - race.losers;
      const entries = order.map((racer, index) => ({
        name: racer.name,
        lose: index >= winCount,
        meta: `${index + 1}등`,
        index: racer.color,
      }));
      const podium = podiumHtml(order.map((racer, index) => ({
        name: racer.name,
        index: racer.color,
        lose: index >= winCount,
      })));
      const board = `
        <div class="rc-board">
          ${order.map((racer, index) => `
            <div class="rc-board-row${index >= winCount ? ' is-lose' : ''}">
              <span class="rc-board-no">${index + 1}</span>
              <span class="rc-board-name">${escapeText(racer.name)}</span>
              <span class="rc-board-verdict">${index >= winCount ? '꽝' : '당첨'}</span>
            </div>`).join('')}
        </div>`;
      const box = host.querySelector('#rc-result');
      if (!box) return;
      paintRanking(true);
      const rankList = host.querySelector('#rc-rank');
      if (rankList) rankList.hidden = true;
      box.innerHTML = resultPanel({
        id: 'rc-summary',
        entries,
        groups: false,
        extraHtml: podium + board,
        note: `${map.name} · 먼저 들어온 ${winCount}명 당첨`,
      });
      paintAvatars(box);
      const live = host.querySelector('#rc-live');
      if (live) live.textContent = '경주가 끝났습니다';
      playConfetti();
      sfx.fanfare();
      toast('경주가 끝났습니다');
    }

    /** 끝난 뒤 컨페티만 따로 굴린다. */
    function playConfetti() {
      confetti.burst(race.width / 2, race.height * 0.34, { count: 54, speed: 300, spread: Math.PI * 1.3 });
      confetti.burst(race.width * 0.24, race.height * 0.5, { count: 16, speed: 180 });
      confetti.burst(race.width * 0.76, race.height * 0.5, { count: 16, speed: 180 });
      let last = 0;
      const began = performance.now();
      const step = (now) => {
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
        last = now;
        const alive = confetti.step(dt);
        draw();
        if (alive && now - began < 3200) requestAnimationFrame(step);
        else {
          confetti.clear();
          draw();
        }
      };
      requestAnimationFrame(step);
    }

    /* ------------------------------ 연결 ------------------------------ */

    host.addEventListener('click', (event) => {
      if (event.target.closest('#rc-again')) {
        event.preventDefault();
        if (!setup) return;
        startRace();
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
      if (themeObserver) themeObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      controller.abort();
    };
  },
};

export default module;
