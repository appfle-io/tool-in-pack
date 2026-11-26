/*
 * TIP · 선착순 골인 (race-game, v1.20.0)
 *
 * 사람 수(2~12)와 꽝 개수를 정하고 맵을 고르면, 모두 함께 출발해 먼저 골인한 사람이 당첨이다.
 * 판정은 선착순(뒤 N명 꽝) · 꼴찌가 당첨(마지막 N명) · 1등만 당첨 중에서 고른다.
 *
 * 맵 4종 — 모두 긴 코스를 카메라가 따라가며, 12~22초 동안 순위가 뒤집힌다.
 *   · 질주 트랙     부스터 패드 · 진흙/바나나 · 순풍/역풍 게이트 · 돌풍 이벤트
 *   · 장애물 서킷   굽이진 레인 · 허들(점프/감속) · 가속 레인 · 여닫는 게이트
 *   · 핀볼 드롭     범퍼 · 회전 풍차 · 깔때기 병목 · 여닫는 문 · 가속/감속 존
 *   · 지그재그 레일 좌우로 감기는 레일 · 왕복 발판 · 가속 슈트 · 감속 존
 *
 * v1.20.0
 *   · 양옆 끼임 제거 — 벽에 닿으면 반드시 되튀기고(vx = -vx * 0.78), 가이드·깔때기는
 *     벽(x=0, x=BOARD_W)에 틈 없이 붙였으며, 회전 풍차는 양 끝 점이 아니라 선분 전체로
 *     부딪힌다. 참가자끼리도 원형 탄성 충돌로 서로 밀쳐 낸다. 그래도 0.45초 넘게
 *     거의 멈춰 있으면 탈출 임펄스를 주고, 여러 번 막히면 아래로 확실히 빼 준다.
 *   · 긴 코스 — 핀볼 드롭·지그재그 레일은 1,900~2,000px, 질주 트랙·장애물 서킷은
 *     가상 거리 2,600px. 화면은 선두를 부드럽게 따라가는 카메라로 따라가고,
 *     위쪽 막대에 진행 게이지가 붙는다.
 *   · 결승선 슬로우 모션 — 당첨과 꽝을 가르는 마지막 구간에서 0.35배로 느려지며
 *     두 선두에 강조 링이 맥동한다.
 *
 * 움직임은 requestAnimationFrame 으로 그리고, 1x/2x 속도를 바꿀 수 있다.
 */

import {
  setupScreen, resultPanel, bindActions, hudStat, randomUnit, escapeText,
  soundButton, bindSound, sfx, createConfetti, drawCharacter, drawNameTag,
  paintAvatars, podiumHtml, characterColor, VERDICT_MODES,
} from '../../js/game-kit.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9M4 9l7-4v11"/><path d="M3 6h9"/><circle cx="17" cy="8.5" r="2.2"/><circle cx="17" cy="15.5" r="2.2"/></svg>`;

const BOARD_W = 360;
const PINBALL_H = 2000;
const RAIL_H = 1980;
const TRACK_START = 46;
const TRACK_LEN = 2600;
const STEP = 1 / 120;
const LANE_MIN = 40;
const DROP_VIEW_MAX = 460;
const SPEEDS = [1, 2];
const TAPE_P = 0.94;

const SLOW_RATE = 0.35;
const SLOW_BUDGET = 2.8;
const SLOW_FROM = 0.86;
const STUCK_SPEED = 44;
const STUCK_TIME = 0.45;

const ART = {
  sprint: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7h22M3 13h16M3 19h24"/><path d="M20 5l4 2-4 2M14 11l4 2-4 2M22 17l4 2-4 2" stroke-linejoin="round"/></svg>`,
  circuit: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 7c6-4 10 4 16 0s10 4 18 0M3 15c6-4 10 4 16 0s10 4 18 0M3 23c6-4 10 4 16 0s10 4 18 0"/></svg>`,
  pinball: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="7" r="2.2"/><circle cx="20" cy="9" r="2.2"/><circle cx="32" cy="7" r="2.2"/><circle cx="14" cy="17" r="2.2"/><circle cx="26" cy="17" r="2.2"/><path d="M4 22h32"/></svg>`,
  rail: `<svg viewBox="0 0 40 26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h10l-8 8h12l-8 8h12"/><circle cx="9" cy="5" r="2" fill="currentColor" stroke="none"/></svg>`,
};

const MAPS = [
  { id: 'sprint', name: '질주 트랙', sub: '부스터·진흙·순풍', kind: 'track', art: ART.sprint },
  { id: 'circuit', name: '장애물 서킷', sub: '허들과 여닫는 게이트', kind: 'track', art: ART.circuit },
  { id: 'pinball', name: '핀볼 드롭', sub: '깔때기·풍차·부스터', kind: 'drop', art: ART.pinball },
  { id: 'rail', name: '지그재그 레일', sub: '왕복 발판·가속 슈트', kind: 'drop', art: ART.rail },
];

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

/** 판정 방식별 당첨 인원 — 사람 수·꽝 개수와 자연스럽게 맞춘다. */
function modeWins(setupLike) {
  const people = Math.max(2, Number(setupLike && setupLike.people) || 2);
  const losers = clamp(Math.floor(Number(setupLike && setupLike.losers) || 0), 0, people - 1);
  if (setupLike && setupLike.mode === 'last') return clamp(losers, 1, people - 1);
  if (setupLike && setupLike.mode === 'solo') return 1;
  return people - losers;
}

const module = {
  id: 'race-game',
  name: '선착순 골인',
  shortName: '골인',
  kind: 'tool',
  category: 'game',
  version: '1.20.0',
  subtitle: '먼저 들어오면 당첨',
  description: '사람 수와 꽝 개수, 판정 방식을 정하고 맵을 고르면 모두 함께 출발합니다. 질주 트랙, 장애물 서킷, 핀볼 드롭, 지그재그 레일 네 맵의 긴 코스를 캐릭터들이 달리고 튕기며, 결승선 앞에서 느려지듯 순위가 갈립니다.',
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

    function boardHeight() {
      return map.id === 'rail' ? RAIL_H : PINBALL_H;
    }

    /* ------------------------------ 설정 ------------------------------ */

    function showSetup() {
      stopFrame();
      race = null;
      confetti.clear();
      setupScreen(host, {
        gameId: 'race-game',
        maps: MAPS,
        modes: VERDICT_MODES,
        hint: '맵과 판정 방식을 고르고 시작하면 셋을 세고 출발합니다.',
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
      // 레인마다 부스터와 방해물이 두 번씩 — 누구나 한 번은 밟는다.
      const lanes = Array.from({ length: n }, (_, lane) => {
        const first = 0.13 + randomUnit() * 0.1;
        const second = 0.56 + randomUnit() * 0.14;
        return {
          lane,
          boostAt: first,
          secondBoostAt: second,
          hazardAt: Math.min(0.94, first + 0.14 + randomUnit() * 0.12),
          secondHazardAt: Math.min(0.96, second + 0.12 + randomUnit() * 0.1),
          hazard: randomUnit() < 0.5 ? 'mud' : 'banana',
          hazard2: randomUnit() < 0.5 ? 'mud' : 'banana',
          speedLane: randomUnit() < 0.45,
          gate: randomUnit(),
        };
      });
      return {
        lanes,
        windAt: 0.46 + randomUnit() * 0.06,
        hurdles: [0.14, 0.3, 0.46, 0.62, 0.78].map((p) => ({ p, open: randomUnit() > 0.42 })),
        gateAt: 0.56,
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
        skill: 0.93 + randomUnit() * 0.14,
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
        delay: 0,
        idle: 0,
        rescues: 0,
        bounceCool: 0,
        markY: 0,
        markT: 0,
        flowT: 0,
        stallMax: 0,
      }));
    }

    function startRace() {
      ink = readInk();
      const wins = modeWins(setup);
      race = {
        n: setup.people,
        losers: setup.losers,
        mode: setup.mode || 'first',
        wins,
        racers: createRacers(setup.people),
        props: buildProps(setup.people),
        t: 0,
        arrived: 0,
        countdown: 1.8,
        countStep: 3,
        done: false,
        summaryShown: false,
        lastRank: 0,
        lastGauge: 0,
        tape: 0,
        sparks: [],
        pegs: map.id === 'pinball' ? buildPinball() : [],
        rails: map.id === 'rail' ? buildRail(setup.people) : null,
        cam: { x: 0, y: 0 },
        slow: 0,
        slowBudget: SLOW_BUDGET,
        slowShown: false,
        twistAt: 2.2,
        width: 0,
        height: 0,
        scale: 1,
        viewW: 0,
        viewH: 0,
        stats: { stuck: 0, nudges: 0, flow: 0, stall: 0, forced: 0 },
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
          racer.y = -6 - racer.i * 3;
          racer.vx = (randomUnit() - 0.5) * 70;
          racer.vy = 60 + randomUnit() * 30;
          racer.delay = 0.12 + racer.i * 0.04;
          racer.markY = racer.y;
          racer.markT = 0;
        } else {
          racer.y = -8 - racer.i * 4;
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
            ${hudStat('꽝', String(setup.people - race.wins), 'lose')}
            ${hudStat('도착', '0', 'win')}
            ${soundButton()}
          </div>
          <div class="rc-bar">
            <span class="rc-mapname">${escapeText(map.name)}</span>
            <div class="rc-progress" id="rc-progress" aria-hidden="true">
              <span class="rc-progress-track"></span>
              <span class="rc-progress-window" id="rc-progress-window"></span>
              <span class="rc-progress-dots" id="rc-progress-dots"></span>
            </div>
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
      paintGauge(true);
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
        height = Math.round(clamp(width * 1.2, 320, DROP_VIEW_MAX));
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
      race.scale = map.kind === 'track' ? 1 : width / BOARD_W;
      race.viewW = width;
      race.viewH = map.kind === 'track' ? height : height / race.scale;
      if (map.kind !== 'track') race.cam.y = clamp(race.cam.y, 0, Math.max(0, boardHeight() - race.viewH));
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

      // 결승선 앞 결정 구간이면 느리게 — 남은 예산만큼만(약 2.8초).
      updatePhoto(delta);
      const slowK = race.slow > 0 ? SLOW_RATE : 1;
      const scaled = delta * speed * slowK;
      const steps = Math.max(1, Math.ceil(scaled / STEP));
      const stepSize = scaled / steps;
      for (let index = 0; index < steps; index += 1) simulate(stepSize);

      followCamera(scaled);
      if (confetti.step(scaled)) { /* 계속 그린다 */ }
      draw();
      if (now - race.lastRank > 110) {
        race.lastRank = now;
        paintRanking();
      }
      if (now - race.lastGauge > 90) {
        race.lastGauge = now;
        paintGauge();
      }
      syncStats();
      if (race.done) finish();
      else raf = requestAnimationFrame(frame);
    }

    /* ------------------------------ 슬로우 모션 ------------------------------ */

    /** 아직 판정 경계가 정해지지 않았는가. */
    function decisivePending() {
      if (race.mode === 'last') return race.arrived < race.n - race.wins;
      return race.arrived < race.wins;
    }

    function photoOpen() {
      if (race.done || race.slowBudget <= 0) return false;
      const live = race.racers.filter((racer) => racer.fin == null);
      if (live.length < 2) return false;
      if (!decisivePending()) return false;
      let front = 0;
      live.forEach((racer) => { front = Math.max(front, progressOf(racer)); });
      return front >= SLOW_FROM;
    }

    function updatePhoto(delta) {
      if (!race) return;
      if (photoOpen()) {
        race.slow = 0.3;
        race.slowShown = true;
        race.slowBudget = Math.max(0, race.slowBudget - delta);
      } else {
        race.slow = Math.max(0, race.slow - delta);
      }
    }

    /** 테스트·진단이 읽는 상태 — 끼임·강제 종료·카메라·슬로우 모션. */
    function syncStats() {
      const root = host.querySelector('.rc');
      if (!root || !race) return;
      root.dataset.stuck = String(race.stats.stuck);
      root.dataset.nudges = String(race.stats.nudges);
      root.dataset.stalls = `${race.stats.stall.toFixed(1)}@${race.stats.stallY || 0},${race.stats.stallX || 0}`;
      root.dataset.forced = race.stats.forced ? '1' : '0';
      root.dataset.arrived = String(race.arrived);
      root.dataset.phase = race.done ? 'done' : (race.slow > 0 ? 'photo' : 'run');
      root.dataset.cam = (map.kind === 'track' ? race.cam.x : race.cam.y).toFixed(1);
      root.dataset.slow = race.slowShown ? '1' : '0';
      root.dataset.mode = race.mode;
      root.dataset.duration = race.t.toFixed(2);
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
      applyTwists(dt);
      if (race.t > 40) forceFinish();
    }

    /** 판을 뒤집는 돌풍·스퍼트 — 짧고 잦게 일어나 순위가 계속 흔들린다. */
    function applyTwists(dt) {
      if (map.id === 'pinball') return;
      if (race.arrived >= race.n) return;
      race.twistAt -= dt;
      if (race.twistAt > 0) return;
      race.twistAt = 1.5 + randomUnit() * 1.5;
      const live = race.racers.filter((racer) => racer.fin == null);
      if (live.length < 2) return;
      const racer = live[Math.floor(randomUnit() * live.length) % live.length];
      const boost = randomUnit() < 0.5;
      if (boost) {
        racer.boost = Math.max(racer.boost, 0.9);
        racer.windTag = '스퍼트';
      } else {
        racer.slow = Math.max(racer.slow, 0.85);
        racer.windTag = '돌풍';
      }
      racer.wind = 1;
      const spot = racerSpot(racer);
      addSpark(spot.x, spot.y, { color: boost ? ink.boost : ink.tape, size: 9, kind: 'burst' });
      if (boost) sfx.boost();
      else sfx.whoosh();
    }

    function tickTimers(racer, dt) {
      racer.boost = Math.max(0, racer.boost - dt);
      racer.slow = Math.max(0, racer.slow - dt);
      racer.hit = Math.max(0, racer.hit - dt);
      racer.wind = Math.max(0, racer.wind - dt);
      if (racer.wind <= 0) racer.windTag = '';
      if (racer.hit <= 0 && racer.mood === 'hit') racer.mood = 'run';
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
      return Math.sin(p * Math.PI * 2 * 3.2) * laneHeight() * 0.16;
    }

    function trackSpot(racer) {
      const h = laneHeight();
      const x = TRACK_START + (TRACK_LEN - TRACK_START) * racer.p;
      let y = racer.i * h + h / 2 + trackCurve(racer.p);
      if (racer.jump > 0) y -= Math.sin(racer.jump * Math.PI) * h * 0.7;
      return { x, y, laneH: h };
    }

    /** 화면 위의 자리 — 컨페티·링을 화면 좌표로 터뜨릴 때. */
    function racerSpot(racer) {
      if (map.kind === 'track') {
        const spot = trackSpot(racer);
        return { x: spot.x - race.cam.x, y: spot.y, laneH: spot.laneH };
      }
      return {
        x: racer.x * race.scale,
        y: (racer.y - race.cam.y) * race.scale,
        laneH: laneHeight(),
      };
    }

    function progressOf(racer) {
      if (map.kind === 'track') return clamp(racer.p, 0, 1);
      return clamp(racer.y / boardHeight(), 0, 1);
    }

    function useBurst(racer, message) {
      racer.boost = Math.max(racer.boost, 0.85);
      racer.mood = 'run';
      const spot = trackSpot(racer);
      addSpark(spot.x - race.cam.x, spot.y, { life: 0.3, color: ink.boost, size: 13, kind: 'burst' });
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
      addSpark(spot.x - race.cam.x, spot.y, { color: kind === 'mud' ? ink.mud : ink.warn, size: 10 });
      if (kind === 'mud') sfx.splash();
      else sfx.bump();
    }

    function crossed(before, now, at) {
      return before < at && now >= at;
    }

    function simulateSprint(dt) {
      const base = 1 / 15.4;
      const { props } = race;
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        tickTimers(racer, dt);
        const before = racer.p;
        const lane = props.lanes[racer.i];
        let rate = base * racer.skill;
        if (racer.boost > 0) rate *= 1.75;
        if (racer.slow > 0) rate *= 0.45;
        racer.p = Math.min(1, racer.p + rate * dt);

        if (crossed(before, racer.p, lane.boostAt)) useBurst(racer, '부스터');
        if (crossed(before, racer.p, lane.secondBoostAt)) useBurst(racer, '스퍼트');
        if (crossed(before, racer.p, lane.hazardAt)) takeHit(racer, lane.hazard);
        if (crossed(before, racer.p, lane.secondHazardAt)) takeHit(racer, lane.hazard2);
        if (crossed(before, racer.p, props.windAt)) {
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
        if (racer.trail.length > 16) racer.trail.shift();
        racer.todo -= dt;
        if (racer.todo <= 0) {
          racer.todo = 0.05;
          pushDust(racer, spot.x - 6, spot.y + 4, characterColor(racer.color));
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
      const base = 1 / 15.8;
      const { props } = race;
      const gateOpen = Math.sin(race.t * 2.2 + props.gatePhase) > -0.1;
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        tickTimers(racer, dt);
        racer.jump = Math.max(0, racer.jump - dt * 3.2);
        const before = racer.p;
        let rate = base * racer.skill;
        if (racer.boost > 0) rate *= 1.65;
        if (racer.slow > 0) rate *= 0.45;
        if (props.lanes[racer.i].speedLane && racer.p > 0.28 && racer.p < 0.42) rate *= 1.35;
        racer.p = Math.min(1, racer.p + rate * dt);

        props.hurdles.forEach((hurdle) => {
          if (!crossed(before, racer.p, hurdle.p)) return;
          racer.jump = 1;
          if (!hurdle.open && randomUnit() < 0.7) takeHit(racer, 'hurdle');
          else {
            sfx.tick();
            const spot = trackSpot(racer);
            addSpark(spot.x - race.cam.x, spot.y, { color: ink.accent, size: 7 });
          }
        });
        if (crossed(before, racer.p, props.gateAt) && !gateOpen) takeHit(racer, 'gate');

        const spot = trackSpot(racer);
        racer.trail.push({ x: spot.x, y: spot.y, life: 0.5 });
        if (racer.trail.length > 14) racer.trail.shift();
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
      const guides = [];
      const zones = [];
      const doors = [];

      const row = (y, count, r, spin) => {
        for (let index = 0; index < count; index += 1) {
          pegs.push({
            x: (BOARD_W * (index + 1)) / (count + 1),
            y,
            r,
            kind: spin ? 'spinner' : 'bumper',
            angle: randomUnit() * Math.PI,
            omega: (randomUnit() < 0.5 ? -1 : 1) * (1.5 + randomUnit() * 1.1),
            hit: 0,
            len: spin ? 30 : 0,
          });
        }
      };

      row(110, 4, 11, false);
      row(180, 3, 12, true);
      row(248, 5, 10, false);

      // 깔때기 1 — 벽(x=0)에 붙어 시작해 가운데 목으로 좁아진다.
      guides.push({ x1: 0, y1: 330, x2: 122, y2: 472, thick: 3.5 });
      guides.push({ x1: BOARD_W, y1: 330, x2: BOARD_W - 122, y2: 472, thick: 3.5 });

      row(540, 4, 12, true);
      row(610, 3, 13, false);
      zones.push({ y1: 690, y2: 762, kind: 'boost' });
      row(830, 4, 11, false);
      row(898, 3, 12, true);

      // 여닫는 문 — 벽에 붙은 체로 늘 아래쪽을 향해 흔들려, 공이 문 위에 걸터앉지 못한다.
      doors.push({ x: 0, y: 978, len: 68, base: 0.55, amp: 0.32, omega: 1.9, phase: 0 });
      doors.push({ x: BOARD_W, y: 1052, len: 68, base: Math.PI - 0.55, amp: 0.32, omega: 2.2, phase: 1.2 });

      row(1118, 5, 10, false);
      row(1184, 3, 12, true);

      // 깔때기 2
      guides.push({ x1: 0, y1: 1246, x2: 132, y2: 1382, thick: 3.5 });
      guides.push({ x1: BOARD_W, y1: 1246, x2: BOARD_W - 132, y2: 1382, thick: 3.5 });

      row(1444, 4, 11, false);
      zones.push({ y1: 1502, y2: 1570, kind: 'mud' });
      row(1624, 4, 12, true);
      row(1692, 5, 10, false);
      zones.push({ y1: 1752, y2: 1804, kind: 'bounce' });

      // 마지막 깔때기 — 양 끝이 벽에 닿아 틈이 없다.
      guides.push({ x1: 0, y1: 1846, x2: 118, y2: 1930, thick: 3.5 });
      guides.push({ x1: BOARD_W, y1: 1846, x2: BOARD_W - 118, y2: 1930, thick: 3.5 });
      guides.push({ x1: 118, y1: 1930, x2: 140, y2: PINBALL_H - 14, thick: 3.5 });
      guides.push({ x1: BOARD_W - 118, y1: 1930, x2: BOARD_W - 140, y2: PINBALL_H - 14, thick: 3.5 });

      return { pegs, guides, zones, doors };
    }

    function zoneAt(y) {
      const zones = race.pegs.zones;
      for (let index = 0; index < zones.length; index += 1) {
        const zone = zones[index];
        if (y >= zone.y1 && y <= zone.y2) return zone.kind;
      }
      return '';
    }

    /** 원과 선분의 충돌 — 풍차·문은 양 끝이 아니라 선분 전체로 부딪힌다. */
    function collideSegment(racer, seg, rest, onHit) {
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      const lengthSq = dx * dx + dy * dy || 1;
      const t = clamp(((racer.x - seg.x1) * dx + (racer.y - seg.y1) * dy) / lengthSq, 0, 1);
      const px = seg.x1 + dx * t;
      const py = seg.y1 + dy * t;
      const ox = racer.x - px;
      const oy = racer.y - py;
      const distance = Math.hypot(ox, oy);
      const min = racer.rad + (seg.thick || 3);
      if (distance > min) return false;
      let nx;
      let ny;
      if (distance < 0.001) {
        nx = 0;
        ny = -1;
      } else {
        nx = ox / distance;
        ny = oy / distance;
      }
      racer.x = px + nx * min;
      racer.y = py + ny * min;
      const dot = racer.vx * nx + racer.vy * ny;
      if (dot < 0) {
        racer.vx -= (1 + rest) * dot * nx;
        racer.vy -= (1 + rest) * dot * ny;
      } else {
        racer.vx += nx * 14;
        racer.vy += ny * 14;
      }
      if (onHit) onHit(px, py, nx, ny);
      return true;
    }

    function collidePeg(racer, peg) {
      if (peg.kind === 'spinner') {
        const cos = Math.cos(peg.angle);
        const sin = Math.sin(peg.angle);
        const spin = { x1: peg.x - cos * peg.len, y1: peg.y - sin * peg.len, x2: peg.x + cos * peg.len, y2: peg.y + sin * peg.len, thick: 4 };
        const hit = collideSegment(racer, spin, 0.55);
        if (!hit) return;
        // 돌고 있는 막대가 옆으로 밀어 준다
        racer.vx += -sin * peg.omega * 24;
        racer.vy += cos * peg.omega * 24;
        peg.hit = 0.22;
        addSpark(racer.x, racer.y, { color: ink.accent, size: 7, kind: 'spark' });
        sfx.tick();
        return;
      }
      const dx = racer.x - peg.x;
      const dy = racer.y - peg.y;
      const distance = Math.hypot(dx, dy);
      const min = racer.rad + peg.r;
      if (distance > min) return;
      const nx = distance < 0.001 ? 0 : dx / distance;
      const ny = distance < 0.001 ? -1 : dy / distance;
      racer.x = peg.x + nx * min;
      racer.y = peg.y + ny * min;
      const dot = racer.vx * nx + racer.vy * ny;
      racer.vx = (racer.vx - 2 * dot * nx) * 0.72 + (randomUnit() - 0.5) * 130;
      racer.vy = (racer.vy - 2 * dot * ny) * 0.72 - 40;
      peg.hit = 0.28;
      addSpark(peg.x + nx * peg.r, peg.y + ny * peg.r, { color: ink.boost, size: peg.r * 0.7, life: 0.32 });
      sfx.bump();
    }

    function collideDoor(racer, door) {
      const angle = door.base + Math.sin(race.t * door.omega + door.phase) * door.amp;
      const seg = {
        x1: door.x,
        y1: door.y,
        x2: door.x + Math.cos(angle) * door.len,
        y2: door.y + Math.sin(angle) * door.len,
        thick: 4,
      };
      if (collideSegment(racer, seg, 0.7)) {
        // 문은 옆으로 밀면서 아래로도 내려보낸다 — 문 끝에 걸터앉지 않게.
        racer.vy = Math.max(racer.vy, 150);
        racer.vx += Math.cos(angle + Math.PI / 2) * Math.cos(race.t * door.omega) * 60;
        addSpark(racer.x, racer.y, { color: ink.accentSoft, size: 6, kind: 'spark' });
      }
    }

    /** 참가자끼리 원형 탄성 충돌 — 길목에서 서로 밀쳐 내며 역전이 생긴다. */
    function collideRacers() {
      const live = race.racers.filter((racer) => racer.fin == null && racer.delay <= 0);
      for (let a = 0; a < live.length; a += 1) {
        for (let b = a + 1; b < live.length; b += 1) {
          const one = live[a];
          const two = live[b];
          const dx = two.x - one.x;
          const dy = two.y - one.y;
          const distance = Math.hypot(dx, dy);
          const min = one.rad + two.rad + 1;
          if (distance >= min) continue;
          let nx;
          let ny;
          if (distance < 0.001) {
            nx = randomUnit() - 0.5 || 0.4;
            ny = -0.6;
          } else {
            nx = dx / distance;
            ny = dy / distance;
          }
          const push = (min - distance) / 2;
          one.x -= nx * push;
          one.y -= ny * push;
          two.x += nx * push;
          two.y += ny * push;
          const rvx = two.vx - one.vx;
          const rvy = two.vy - one.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const impulse = (-(1 + 0.82) * vn) / 2;
            one.vx -= impulse * nx;
            one.vy -= impulse * ny;
            two.vx += impulse * nx;
            two.vy += impulse * ny;
            if (-vn > 90) {
              addSpark((one.x + two.x) / 2, (one.y + two.y) / 2, { color: ink.accent, size: 6, kind: 'spark' });
              one.hit = Math.max(one.hit, 0.16);
              two.hit = Math.max(two.hit, 0.16);
            }
          }
        }
      }
    }

    /** 정체 탈출 — 0.45초 넘게 거의 멈춰 있으면 확실히 아래로 빼 준다. */
    function rescue(racer, dt) {
      const speed = Math.hypot(racer.vx, racer.vy);
      racer.idle = speed < STUCK_SPEED ? racer.idle + dt : Math.max(0, racer.idle - dt * 1.6);
      // 진행 정체 감시 — 6px 도 못 내려간 가장 긴 시간을 잔다(끼임 판정에 쓴다).
      if (racer.y > racer.markY + 6) {
        racer.markY = racer.y;
        racer.markT = race.t;
      } else if (racer.markT) {
        racer.stallMax = Math.max(racer.stallMax, race.t - racer.markT);
        if (race.t - racer.markT >= race.stats.stall) {
          race.stats.stall = race.t - racer.markT;
          race.stats.stallY = Math.round(racer.markY);
          race.stats.stallX = Math.round(racer.x);
        }
      }
      // 1.3초 넘게 제자리면 아래로 흘려보낸다 — 화면에 '끼어 멈춘' 모습이 남지 않게.
      if (racer.markT && race.t - racer.markT > 1.3 && race.t - (racer.flowT || 0) > 0.4) {
        racer.flowT = race.t;
        racer.vy = Math.max(racer.vy, 180);
        racer.vx *= 0.35;
        race.stats.flow += 1;
      }
      if (racer.idle < STUCK_TIME) return;
      racer.idle = 0;
      racer.rescues += 1;
      race.stats.stuck += 1;
      racer.vx = (randomUnit() - 0.5) * 320;
      racer.vy = Math.max(0, racer.vy) + 250;
      racer.hit = Math.max(racer.hit, 0.3);
      addSpark(racer.x, racer.y, { color: ink.warn, size: 11 });
      if (racer.rescues >= 4) {
        racer.rescues = 0;
        racer.y = Math.min(PINBALL_H - 20, racer.y + 10);
        racer.vy = 330;
        racer.vx = 0;
        race.stats.nudges += 1;
      }
    }

    function simulatePinball(dt) {
      const { pegs, guides } = race.pegs;
      const H = PINBALL_H;
      const gravity = 700;

      pegs.forEach((peg) => {
        peg.hit = Math.max(0, peg.hit - dt);
        if (peg.kind === 'spinner') peg.angle += peg.omega * dt;
      });

      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        if (racer.delay > 0) {
          racer.delay -= dt;
          return;
        }
        tickTimers(racer, dt);
        racer.mood = racer.hit > 0 ? 'hit' : 'run';
        racer.bounceCool = Math.max(0, racer.bounceCool - dt);

        racer.vy = Math.min(820, racer.vy + gravity * dt);
        racer.vx *= 1 - 0.55 * dt;

        const zone = zoneAt(racer.y);
        if (zone === 'boost') racer.vy = Math.min(980, racer.vy + 1500 * dt);
        else if (zone === 'mud') {
          racer.vy *= 1 - 2.4 * dt;
          racer.vx *= 1 - 1.8 * dt;
        } else if (zone === 'bounce' && racer.bounceCool <= 0) {
          racer.bounceCool = 0.55;
          racer.vx += (randomUnit() - 0.5) * 420;
          racer.vy = Math.max(90, racer.vy * 0.6);
          addSpark(racer.x, racer.y, { color: ink.warn, size: 8 });
        }

        racer.x += racer.vx * dt;
        racer.y += racer.vy * dt;

        // 벽 — 명시적으로 되튕긴다(옆 벽에 붙어 못 내려오는 일 자체를 막는다)
        if (racer.x < racer.rad) {
          racer.x = racer.rad;
          racer.vx = Math.abs(racer.vx) * 0.78;
        } else if (racer.x > BOARD_W - racer.rad) {
          racer.x = BOARD_W - racer.rad;
          racer.vx = -Math.abs(racer.vx) * 0.78;
        }
        if (racer.y < racer.rad) {
          racer.y = racer.rad;
          racer.vy = Math.abs(racer.vy) * 0.6;
        }

        // 두 바퀴 돌며 부딪힘을 풀어 좁은 목에서도 새지 않게 한다
        for (let pass = 0; pass < 2; pass += 1) {
          pegs.forEach((peg) => collidePeg(racer, peg));
          guides.forEach((guide) => collideSegment(racer, guide, 0.7));
          race.pegs.doors.forEach((door) => collideDoor(racer, door));
          racer.x = clamp(racer.x, racer.rad, BOARD_W - racer.rad);
        }

        racer.trail.push({ x: racer.x, y: racer.y, life: 0.5 });
        if (racer.trail.length > 12) racer.trail.shift();

        rescue(racer, dt);
        if (racer.y >= H - 16) {
          racer.y = H - 16;
          arrive(racer);
          // 골인한 사람은 결승 띠 위에 두 줄로 나린히 — 서로 겹쳐 보이지 않게 한다.
          const slot = Math.max(0, racer.rank - 1);
          const row = Math.floor(slot / 6);
          racer.x = clamp(30 + (slot % 6) * 60 + row * 30, racer.rad, BOARD_W - racer.rad);
          racer.y = H - 16 - row * 46;
          racer.vx = 0;
        }
      });

      collideRacers();
    }

    /* ------------------------------ 지그재그 레일 ------------------------------ */

    function buildRail(n) {
      const lanes = Array.from({ length: n }, (_, index) => ({
        waves: 3.4 + (index % 3) * 0.5,
        phase: ((index * Math.PI * 2) / Math.max(1, n)) * 0.7,
        amp: Math.min(28, (BOARD_W / Math.max(2, n)) * 0.34),
      }));
      const platforms = [
        { y: RAIL_H * 0.2, x: BOARD_W * 0.34, dir: 1, speed: 62, width: 88, height: 13 },
        { y: RAIL_H * 0.44, x: BOARD_W * 0.66, dir: -1, speed: 70, width: 84, height: 13 },
        { y: RAIL_H * 0.7, x: BOARD_W * 0.4, dir: 1, speed: 66, width: 80, height: 13 },
      ];
      return {
        lanes,
        platforms,
        chutes: [{ from: 0.1, to: 0.16 }, { from: 0.34, to: 0.4 }, { from: 0.58, to: 0.64 }, { from: 0.82, to: 0.88 }],
        slows: [{ from: 0.26, to: 0.31 }, { from: 0.51, to: 0.56 }, { from: 0.74, to: 0.79 }],
      };
    }

    function railX(racer) {
      const lane = race.rails.lanes[racer.i];
      const laneWidth = BOARD_W / race.n;
      const center = laneWidth * (racer.i + 0.5);
      return center + Math.sin((racer.y / RAIL_H) * Math.PI * 2 * lane.waves + lane.phase) * lane.amp;
    }

    function simulateRail(dt) {
      const { platforms, chutes, slows } = race.rails;
      platforms.forEach((platform) => {
        platform.x += platform.dir * platform.speed * dt;
        if (platform.x > BOARD_W * 0.74) { platform.x = BOARD_W * 0.74; platform.dir = -1; }
        if (platform.x < BOARD_W * 0.26) { platform.x = BOARD_W * 0.26; platform.dir = 1; }
      });
      race.racers.forEach((racer) => {
        if (racer.fin != null) return;
        tickTimers(racer, dt);
        const ratio = racer.y / RAIL_H;
        let speedFactor = 0.94 + 0.16 * Math.cos(ratio * Math.PI * 2 * 2);
        if (chutes.some((chute) => ratio >= chute.from && ratio <= chute.to)) speedFactor *= 1.55;
        if (slows.some((slow) => ratio >= slow.from && ratio <= slow.to)) speedFactor *= 0.62;
        if (racer.boost > 0) speedFactor *= 1.45;
        if (racer.slow > 0) speedFactor *= 0.55;
        racer.vy = (128 + 20 * (racer.i % 3)) * racer.skill * speedFactor;
        racer.y += racer.vy * dt;
        let x = railX(racer);

        platforms.forEach((platform) => {
          if (racer.y > platform.y - 8 && racer.y < platform.y + platform.height + 6) {
            const half = platform.width / 2;
            if (x > platform.x - half - 10 && x < platform.x + half + 10) {
              x += platform.dir * platform.speed * dt * 1.6;
              racer.todo = Math.max(0, (racer.todo || 0) - dt);
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
        if (racer.y >= RAIL_H - 16) {
          racer.y = RAIL_H - 16;
          arrive(racer);
        }
      });
    }

    function forceFinish() {
      const rest = race.racers.filter((racer) => racer.fin == null);
      rest.sort((a, b) => (progressOf(b) - progressOf(a)));
      rest.forEach((racer) => arrive(racer));
      race.stats.forced = 1;
      race.done = true;
    }

    /* ------------------------------ 카메라 ------------------------------ */

    function followCamera(dt) {
      const k = Math.min(1, dt * 4.5);
      if (map.kind === 'track') {
        let lead = TRACK_START;
        race.racers.forEach((racer) => { lead = Math.max(lead, trackSpot(racer).x); });
        const maxCam = Math.max(0, TRACK_LEN + 70 - race.width);
        const target = clamp(lead - race.width * 0.6, 0, maxCam);
        race.cam.x += (target - race.cam.x) * k;
        return;
      }
      const height = boardHeight();
      let lead = 0;
      race.racers.forEach((racer) => { lead = Math.max(lead, racer.y); });
      // 모두 골인했으면 결승선에 머묿러 준다.
      const live = race.racers.some((racer) => racer.fin == null);
      if (!live) lead = height;
      const maxCam = Math.max(0, height - race.viewH);
      const target = clamp(lead - race.viewH * 0.58, 0, maxCam);
      race.cam.y += (target - race.cam.y) * k;
    }

    /* ------------------------------ 그리기 ------------------------------ */

    function draw() {
      if (!ctx2d || !race) return;
      const { width, height } = race;
      ctx2d.clearRect(0, 0, width, height);
      if (!width || !height) return;
      if (map.kind === 'track') {
        drawTrack();
      } else {
        ctx2d.save();
        ctx2d.scale(race.scale, race.scale);
        ctx2d.translate(0, -race.cam.y);
        if (map.id === 'pinball') drawPinball();
        else drawRailBoard();
        race.racers.forEach(drawDropRacer);
        ctx2d.restore();
      }
      drawSparks();
      drawPhoto();
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

    /** 결승선 앞 두 선수에 강조 링을 맥동시킨다. */
    function drawPhoto() {
      if (!(race.slow > 0) || race.done) return;
      const live = race.racers
        .filter((racer) => racer.fin == null)
        .sort((a, b) => progressOf(b) - progressOf(a))
        .slice(0, 2);
      const pulse = 0.5 + 0.5 * Math.sin(race.t * 9);
      ctx2d.save();
      live.forEach((racer, index) => {
        const spot = racerSpot(racer);
        const base = index === 0 ? 26 : 21;
        ctx2d.globalAlpha = index === 0 ? 0.85 : 0.5;
        ctx2d.strokeStyle = index === 0 ? ink.accent : ink.tape;
        ctx2d.lineWidth = 2.4;
        ctx2d.beginPath();
        ctx2d.arc(spot.x, spot.y, base * (0.88 + pulse * 0.22), 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.globalAlpha *= 0.4;
        ctx2d.beginPath();
        ctx2d.arc(spot.x, spot.y, (base + 10) * (0.88 + pulse * 0.16), 0, Math.PI * 2);
        ctx2d.stroke();
      });
      ctx2d.globalAlpha = 1;
      const label = '마지막 승부';
      ctx2d.font = '750 11px Pretendard, system-ui, sans-serif';
      const badgeW = ctx2d.measureText(label).width + 22;
      const bx = race.width / 2 - badgeW / 2;
      const by = map.kind === 'track' ? race.height - 34 : 10;
      ctx2d.fillStyle = ink.dark ? 'rgba(22,24,28,0.86)' : 'rgba(255,255,255,0.95)';
      roundRect(ctx2d, bx, by, badgeW, 22, 11);
      ctx2d.fill();
      ctx2d.strokeStyle = ink.accent;
      ctx2d.lineWidth = 1.4;
      ctx2d.stroke();
      ctx2d.fillStyle = ink.accent;
      ctx2d.textAlign = 'center';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(label, race.width / 2, by + 11.5);
      ctx2d.restore();
    }

    /* ---------- 트랙 배경 ---------- */

    function drawTrack() {
      const { width, height } = race;
      const laneH = laneHeight();
      const left = TRACK_START;
      const right = TRACK_LEN;
      const viewLeft = race.cam.x - 40;
      const viewRight = race.cam.x + width + 40;

      ctx2d.save();
      ctx2d.fillStyle = ink.turf;
      ctx2d.fillRect(0, 0, width, height);
      if (map.id === 'sprint') {
        ctx2d.fillStyle = ink.turf2;
        const offset = -(((race.cam.x % 96) + 96) % 96);
        for (let x = offset; x < width; x += 96) ctx2d.fillRect(x, 0, 48, height);
      }
      ctx2d.restore();

      ctx2d.save();
      ctx2d.translate(-race.cam.x, 0);
      if (map.id === 'circuit') drawCircuitLanes(left, right, laneH, viewLeft, viewRight);
      else drawSprintLanes(left, right, laneH, viewLeft, viewRight);
      if (map.id === 'sprint') drawSprintProps(left, right, laneH, viewLeft, viewRight);
      else drawCircuitProps(left, right, laneH, viewLeft, viewRight);
      drawStartFinish(left, right, laneH, viewLeft, viewRight);
      race.racers.forEach(drawTrackRacer);
      ctx2d.restore();
    }

    function drawSprintLanes(startX, finishX, laneH, viewLeft, viewRight) {
      for (let lane = 0; lane < race.n; lane += 1) {
        const top = lane * laneH;
        ctx2d.save();
        ctx2d.fillStyle = lane % 2 ? ink.lane2 : ink.lane;
        ctx2d.globalAlpha = 0.92;
        ctx2d.fillRect(Math.max(startX - 12, viewLeft), top + 2, Math.min(finishX + 16, viewRight) - Math.max(startX - 12, viewLeft), laneH - 4);
        ctx2d.globalAlpha = 0.4;
        ctx2d.strokeStyle = ink.lineStrong;
        ctx2d.lineWidth = 1;
        ctx2d.setLineDash([7, 8]);
        segment(ctx2d, Math.max(startX - 12, viewLeft), top + laneH, Math.min(finishX + 4, viewRight), top + laneH);
        ctx2d.stroke();
        ctx2d.restore();
      }
    }

    /** 서킷은 트랙 전체가 하나의 굽이진 길이다. 길 하나를 깔고 차선만 점선으로 나눈다. */
    function drawCircuitLanes(startX, finishX, laneH, viewLeft, viewRight) {
      const left = startX - 14;
      const right = finishX + 8;
      const from = Math.max(left, viewLeft);
      const to = Math.min(right, viewRight);
      const top = laneH * 0.05;
      const bottom = race.n * laneH - laneH * 0.05;
      const yAt = (edge, x) => edge + trackCurve((x - left) / (right - left));

      ctx2d.save();
      ctx2d.beginPath();
      for (let x = from; x <= to; x += 4) {
        const y = yAt(top, x);
        if (x === from) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      for (let x = to; x >= from; x -= 4) {
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

      ctx2d.strokeStyle = ink.lineStrong;
      ctx2d.globalAlpha = 0.38;
      ctx2d.lineWidth = 1;
      ctx2d.setLineDash([8, 9]);
      for (let lane = 1; lane < race.n; lane += 1) {
        ctx2d.beginPath();
        for (let x = from + 6; x <= to - 6; x += 4) {
          const y = yAt(lane * laneH, x);
          if (x === from + 6) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
      }
      ctx2d.restore();
    }

    function drawSprintProps(startX, finishX, laneH, viewLeft, viewRight) {
      const { props } = race;
      const span = finishX - startX;
      props.lanes.forEach((lane, index) => {
        const y = index * laneH + laneH / 2;
        const pads = [
          { at: lane.boostAt, kind: 'boost' },
          { at: lane.secondBoostAt, kind: 'boost' },
          { at: lane.hazardAt, kind: lane.hazard },
          { at: lane.secondHazardAt, kind: lane.hazard2 },
        ];
        pads.forEach((pad) => {
          const x = startX + span * pad.at;
          if (x < viewLeft - 30 || x > viewRight + 30) return;
          if (pad.kind === 'boost') {
            ctx2d.save();
            ctx2d.fillStyle = ink.boost;
            ctx2d.globalAlpha = 0.9;
            roundRect(ctx2d, x - 13, y - 9, 26, 18, 5);
            ctx2d.fill();
            ctx2d.globalAlpha = 1;
            ctx2d.strokeStyle = '#FFFFFF';
            ctx2d.lineWidth = 2;
            ctx2d.lineCap = 'round';
            for (let arrow = 0; arrow < 2; arrow += 1) {
              const ax = x - 5 + arrow * 8;
              ctx2d.beginPath();
              ctx2d.moveTo(ax - 2, y - 4);
              ctx2d.lineTo(ax + 3, y);
              ctx2d.lineTo(ax - 2, y + 4);
              ctx2d.stroke();
            }
            ctx2d.restore();
            return;
          }
          ctx2d.save();
          if (pad.kind === 'mud') {
            ctx2d.fillStyle = ink.mud;
            ctx2d.globalAlpha = 0.85;
            ctx2d.beginPath();
            ctx2d.ellipse(x, y + 2, 13, 6.5, 0, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.beginPath();
            ctx2d.ellipse(x - 5, y - 2, 5, 3, -0.3, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.globalAlpha = 1;
          } else {
            ctx2d.fillStyle = '#F2C230';
            ctx2d.strokeStyle = '#B08A10';
            ctx2d.lineWidth = 1.2;
            ctx2d.beginPath();
            ctx2d.moveTo(x - 8, y + 4);
            ctx2d.quadraticCurveTo(x - 2, y - 9, x + 8, y - 4);
            ctx2d.quadraticCurveTo(x + 2, y - 1, x - 3, y + 6);
            ctx2d.closePath();
            ctx2d.fill();
            ctx2d.stroke();
          }
          ctx2d.restore();
        });
      });

      // 순풍·역풍 게이트
      const gx = startX + span * props.windAt;
      if (gx > viewLeft - 40 && gx < viewRight + 40) {
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
    }

    function drawCircuitProps(startX, finishX, laneH, viewLeft, viewRight) {
      const { props } = race;
      const span = finishX - startX;
      const laneY = (index, p) => index * laneH + laneH / 2 + trackCurve(p);

      props.lanes.forEach((lane, index) => {
        if (!lane.speedLane) return;
        const fromX = startX + span * 0.28;
        const toX = startX + span * 0.42;
        if (toX < viewLeft || fromX > viewRight) return;
        ctx2d.save();
        ctx2d.strokeStyle = ink.accent;
        ctx2d.globalAlpha = 0.1;
        ctx2d.lineWidth = laneH - 12;
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        for (let x = fromX; x <= toX; x += 4) {
          const y = laneY(index, (x - startX) / span);
          if (x === fromX) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        ctx2d.globalAlpha = 0.62;
        ctx2d.lineWidth = 1.8;
        for (let x = fromX + 10; x < toX - 6; x += 18) {
          const y = laneY(index, (x - startX) / span);
          ctx2d.beginPath();
          ctx2d.moveTo(x, y - laneH * 0.16);
          ctx2d.lineTo(x + 5, y);
          ctx2d.lineTo(x, y + laneH * 0.16);
          ctx2d.stroke();
        }
        ctx2d.restore();
      });

      props.hurdles.forEach((hurdle) => {
        const x = startX + span * hurdle.p;
        if (x < viewLeft - 20 || x > viewRight + 20) return;
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

      const gateOpen = Math.sin(race.t * 2.2 + props.gatePhase) > -0.1;
      const gx = startX + span * props.gateAt;
      if (gx > viewLeft - 40 && gx < viewRight + 40) {
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
    }

    function drawStartFinish(startX, finishX, laneH, viewLeft, viewRight) {
      const height = race.height;
      if (startX - 20 > viewLeft - 20 && startX - 10 < viewRight + 10) {
        ctx2d.save();
        for (let y = 0; y < height; y += 7) {
          ctx2d.fillStyle = Math.floor(y / 7) % 2 ? ink.text : ink.card;
          ctx2d.globalAlpha = 0.5;
          ctx2d.fillRect(startX - 16, y, 3, 7);
        }
        ctx2d.globalAlpha = 1;
        ctx2d.restore();
      }

      if (finishX > viewLeft - 40 && finishX < viewRight + 40) {
        ctx2d.save();
        const cell = Math.max(4, Math.min(7, laneH / 4.4));
        for (let y = 0; y < height; y += cell) {
          for (let column = 0; column < 3; column += 1) {
            ctx2d.fillStyle = ((y / cell) + column) % 2 ? ink.text : ink.card;
            ctx2d.globalAlpha = 0.72;
            ctx2d.fillRect(finishX + column * cell, y, cell, cell);
          }
        }
        ctx2d.globalAlpha = 1;

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
    }

    function drawTrackRacer(racer) {
      const spot = trackSpot(racer);
      const color = characterColor(racer.color);
      const laneH = spot.laneH;

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

      ctx2d.save();
      racer.dust.forEach((part) => {
        ctx2d.globalAlpha = Math.max(0, part.life);
        ctx2d.fillStyle = part.color;
        ctx2d.beginPath();
        ctx2d.arc(part.x, part.y, part.size, 0, Math.PI * 2);
        ctx2d.fill();
      });
      ctx2d.restore();

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
      const mood = racer.fin != null ? (isWinner(racer.rank) ? 'win' : 'lose') : racer.mood;
      drawCharacter(ctx2d, racer.color, spot.x, spot.y, size, {
        mood: mood === 'idle' ? 'run' : mood,
        t: race.t * 1000,
        tilt: racer.boost > 0 ? -0.14 : Math.sin(race.t * 12 + racer.i) * 0.05,
        sparkle: mood === 'win',
      });

      drawNameTag(ctx2d, racer.name, spot.x, spot.y - size * 0.85 - 2, {
        size: laneH > 44 ? 10 : 8.5,
        maxWidth: Math.max(44, 160 / Math.max(2, race.n)),
        bg: ink.dark ? 'rgba(30,32,38,0.86)' : 'rgba(255,255,255,0.9)',
        border: color,
        color: ink.text,
      });

      if (racer.wind > 0 && racer.windTag) {
        ctx2d.save();
        ctx2d.globalAlpha = Math.min(1, racer.wind * 2);
        ctx2d.fillStyle = racer.windTag === '역풍' || racer.windTag === '돌풍' ? ink.tape : ink.boost;
        ctx2d.font = '700 9px Pretendard, system-ui, sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(racer.windTag, spot.x + size * 0.78, spot.y + size * 0.62);
        ctx2d.restore();
      }
    }

    /* ---------- 떨어지는 맵 ---------- */

    function drawZone(zone) {
      const height = zone.y2 - zone.y1;
      ctx2d.save();
      if (zone.kind === 'boost') {
        ctx2d.fillStyle = ink.boost;
        ctx2d.globalAlpha = 0.1;
        ctx2d.fillRect(0, zone.y1, BOARD_W, height);
        ctx2d.globalAlpha = 0.55;
        ctx2d.strokeStyle = ink.boost;
        ctx2d.lineWidth = 2.2;
        ctx2d.lineCap = 'round';
        ctx2d.lineJoin = 'round';
        for (let x = 22; x < BOARD_W - 10; x += 42) {
          const y = (zone.y1 + zone.y2) / 2;
          ctx2d.beginPath();
          ctx2d.moveTo(x - 5, y - 6);
          ctx2d.lineTo(x + 3, y);
          ctx2d.lineTo(x - 5, y + 6);
          ctx2d.stroke();
        }
      } else if (zone.kind === 'mud') {
        ctx2d.fillStyle = ink.mud;
        ctx2d.globalAlpha = 0.14;
        ctx2d.fillRect(0, zone.y1, BOARD_W, height);
        ctx2d.globalAlpha = 0.5;
        ctx2d.strokeStyle = ink.mud;
        ctx2d.lineWidth = 2;
        ctx2d.beginPath();
        for (let x = 0; x <= BOARD_W; x += 8) {
          const y = zone.y1 + height * 0.5 + Math.sin(x / 18) * 4;
          if (x === 0) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
      } else {
        ctx2d.fillStyle = ink.warn;
        ctx2d.globalAlpha = 0.08;
        ctx2d.fillRect(0, zone.y1, BOARD_W, height);
        ctx2d.globalAlpha = 0.5;
        ctx2d.strokeStyle = ink.warn;
        ctx2d.lineWidth = 1.8;
        ctx2d.setLineDash([5, 7]);
        segment(ctx2d, 0, zone.y1 + height / 2, BOARD_W, zone.y1 + height / 2);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
      }
      ctx2d.globalAlpha = 1;
      ctx2d.restore();
    }

    function drawPinball() {
      const H = PINBALL_H;
      const { pegs, guides } = race.pegs;
      ctx2d.save();
      roundRect(ctx2d, 0, 0, BOARD_W, H, 14);
      ctx2d.fillStyle = ink.board;
      ctx2d.fill();
      ctx2d.clip();

      // 판 점 무늬 — 보이는 구간만
      ctx2d.fillStyle = ink.boardLine;
      ctx2d.globalAlpha = 0.55;
      const from = Math.max(0, Math.floor(race.cam.y / 22) * 22 - 22);
      const to = Math.min(H, race.cam.y + race.viewH + 22);
      for (let y = from; y < to; y += 22) {
        for (let x = 16 + ((y / 22) % 2) * 11; x < BOARD_W; x += 22) {
          ctx2d.beginPath();
          ctx2d.arc(x, y, 1.1, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }
      ctx2d.globalAlpha = 1;

      race.pegs.zones.forEach(drawZone);

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

      // 여닫는 문
      race.pegs.doors.forEach((door) => {
        const angle = door.base + Math.sin(race.t * door.omega + door.phase) * door.amp;
        const ex = door.x + Math.cos(angle) * door.len;
        const ey = door.y + Math.sin(angle) * door.len;
        ctx2d.save();
        ctx2d.lineCap = 'round';
        ctx2d.strokeStyle = ink.accent;
        ctx2d.globalAlpha = 0.85;
        ctx2d.lineWidth = 8;
        segment(ctx2d, door.x, door.y, ex, ey);
        ctx2d.stroke();
        ctx2d.strokeStyle = ink.card;
        ctx2d.globalAlpha = 0.55;
        ctx2d.lineWidth = 2.6;
        segment(ctx2d, door.x, door.y, ex, ey);
        ctx2d.stroke();
        ctx2d.fillStyle = ink.accent;
        ctx2d.beginPath();
        ctx2d.arc(door.x, door.y, 5, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
      });

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

      drawFinishBand(H);
      ctx2d.restore();
    }

    function drawFinishBand(height) {
      const cell = 8;
      for (let x = 0; x < BOARD_W; x += cell) {
        for (let row = 0; row < 2; row += 1) {
          ctx2d.fillStyle = ((x / cell) + row) % 2 ? ink.text : ink.card;
          ctx2d.globalAlpha = 0.55;
          ctx2d.fillRect(x, height - 14 + row * 7, cell, 7);
        }
      }
      ctx2d.globalAlpha = 1;
    }

    function drawRailBoard() {
      const { rails } = race;
      const H = RAIL_H;
      ctx2d.save();
      roundRect(ctx2d, 0, 0, BOARD_W, H, 14);
      ctx2d.fillStyle = ink.board;
      ctx2d.fill();
      ctx2d.clip();

      rails.chutes.forEach((chute) => {
        const y1 = H * chute.from;
        const y2 = H * chute.to;
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

      rails.slows.forEach((slow) => {
        const y1 = H * slow.from;
        const y2 = H * slow.to;
        ctx2d.fillStyle = ink.mud;
        ctx2d.globalAlpha = 0.12;
        ctx2d.fillRect(0, y1, BOARD_W, y2 - y1);
        ctx2d.globalAlpha = 0.45;
        ctx2d.strokeStyle = ink.mud;
        ctx2d.lineWidth = 1.6;
        ctx2d.setLineDash([6, 8]);
        segment(ctx2d, 0, (y1 + y2) / 2, BOARD_W, (y1 + y2) / 2);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
        ctx2d.globalAlpha = 1;
      });

      const laneWidth = BOARD_W / race.n;
      for (let index = 0; index < race.n; index += 1) {
        const lane = rails.lanes[index];
        const center = laneWidth * (index + 0.5);
        ctx2d.beginPath();
        for (let y = 0; y <= H - 12; y += 6) {
          const x = center + Math.sin((y / H) * Math.PI * 2 * lane.waves + lane.phase) * lane.amp;
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

      drawFinishBand(H);
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
      const mood = racer.fin != null ? (isWinner(racer.rank) ? 'win' : 'lose') : (racer.hit > 0 ? 'hit' : 'run');
      drawCharacter(ctx2d, racer.color, x, y, size, {
        mood,
        t: race.t * 1000,
        tilt: clamp(racer.vx / 420, -0.4, 0.4),
        sparkle: racer.fin != null && isWinner(racer.rank),
      });

      drawNameTag(ctx2d, racer.name, x, y - size * 0.72 - 5, {
        size: 9,
        maxWidth: Math.max(38, (BOARD_W / race.n) * 1.5),
        bg: ink.dark ? 'rgba(30,32,38,0.86)' : 'rgba(255,255,255,0.92)',
        border: color,
        color: ink.text,
      });

      if (racer.wind > 0 && racer.windTag) {
        ctx2d.save();
        ctx2d.globalAlpha = Math.min(1, racer.wind * 2);
        ctx2d.fillStyle = racer.windTag === '돌풍' ? ink.tape : ink.boost;
        ctx2d.font = '700 9px Pretendard, system-ui, sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(racer.windTag, x + size * 0.7, y + size * 0.5);
        ctx2d.restore();
      }
    }

    function drawSparks() {
      if (!race.sparks.length) return;
      ctx2d.save();
      if (map.kind === 'track') ctx2d.translate(-race.cam.x, 0);
      else {
        ctx2d.scale(race.scale, race.scale);
        ctx2d.translate(0, -race.cam.y);
      }
      race.sparks.forEach((spark) => {
        const ratio = spark.life / spark.max;
        ctx2d.globalAlpha = Math.max(0, ratio);
        ctx2d.strokeStyle = spark.color;
        ctx2d.lineWidth = 2;
        if (spark.kind === 'spark') {
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

    /* ------------------------------ 진행 게이지 ------------------------------ */

    function paintGauge(force = false) {
      if (!race) return;
      const bar = host.querySelector('#rc-progress');
      if (!bar) return;
      const dots = bar.querySelector('#rc-progress-dots');
      if (dots && (force || !dots.dataset.ready)) {
        dots.innerHTML = race.racers.map((racer) =>
          `<i style="background: ${characterColor(racer.color)}; left: 0%"></i>`).join('');
        dots.dataset.ready = 'true';
      }
      const items = bar.querySelectorAll('#rc-progress-dots i');
      race.racers.forEach((racer, index) => {
        const dot = items[index];
        if (dot) dot.style.left = `${(progressOf(racer) * 100).toFixed(2)}%`;
      });
      const win = bar.querySelector('#rc-progress-window');
      if (!win) return;
      let from = 0;
      let size = 1;
      if (map.kind === 'track') {
        from = race.cam.x / (TRACK_LEN + 70);
        size = race.width / (TRACK_LEN + 70);
      } else {
        const height = boardHeight();
        from = race.cam.y / height;
        size = race.viewH / height;
      }
      win.style.left = `${clamp(from * 100, 0, 100)}%`;
      win.style.width = `${clamp(size * 100, 2, 100)}%`;
    }

    /* ------------------------------ 순위 ------------------------------ */

    function orderedRacers() {
      return race.racers.slice().sort((a, b) => {
        if (a.fin != null && b.fin != null) return a.fin - b.fin;
        if (a.fin != null) return -1;
        if (b.fin != null) return 1;
        return progressOf(b) - progressOf(a);
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
          <span class="rc-rank-state">${racer.fin != null ? '골인' : `${Math.round(progressOf(racer) * 100)}%`}</span>
        </li>`).join('');
      const hud = host.querySelector('#rc-hud');
      if (hud) {
        const value = hud.querySelectorAll('.gm-stat-v')[2];
        if (value) value.textContent = String(race.arrived);
      }
      if (force) list.dataset.ready = 'true';
    }

    /* ------------------------------ 판정 ------------------------------ */

    function isWinner(rank) {
      if (race.mode === 'last') return rank > race.n - race.wins;
      return rank <= race.wins;
    }

    /* ------------------------------ 결과 ------------------------------ */

    function finish() {
      stopFrame();
      if (!race || race.summaryShown) return;
      race.summaryShown = true;
      race.slow = 0;
      race.racers.forEach((racer, index) => {
        if (racer.fin == null) racer.fin = race.t + index * 0.01;
        if (!racer.rank) racer.rank = race.n;
        racer.mood = isWinner(racer.rank) ? 'win' : 'lose';
      });
      const order = orderedRacers();
      const entries = order.map((racer, index) => ({
        name: racer.name,
        lose: !isWinner(index + 1),
        meta: `${index + 1}등`,
        index: racer.color,
      }));
      const podiumOrder = race.mode === 'last' ? order.slice().reverse().slice(0, 3) : order.slice(0, 3);
      const podium = podiumHtml(podiumOrder.map((racer) => ({
        name: racer.name,
        index: racer.color,
        lose: !isWinner(racer.rank),
      })));
      const board = `
        <div class="rc-board">
          ${order.map((racer, index) => `
            <div class="rc-board-row${isWinner(index + 1) ? '' : ' is-lose'}">
              <span class="rc-board-no">${index + 1}</span>
              <span class="rc-board-name">${escapeText(racer.name)}</span>
              <span class="rc-board-verdict">${isWinner(index + 1) ? '당첨' : '꽝'}</span>
            </div>`).join('')}
        </div>`;
      const note = race.mode === 'last'
        ? `${map.name} · 마지막 ${race.wins}명 당첨`
        : race.mode === 'solo'
          ? `${map.name} · 1등만 당첨`
          : `${map.name} · 먼저 들어온 ${race.wins}명 당첨`;
      const box = host.querySelector('#rc-result');
      if (!box) return;
      paintRanking(true);
      syncStats();
      const rankList = host.querySelector('#rc-rank');
      if (rankList) rankList.hidden = true;
      box.innerHTML = resultPanel({
        id: 'rc-summary',
        entries,
        groups: false,
        extraHtml: podium + board,
        note,
      });
      paintAvatars(box);
      const live = host.querySelector('#rc-live');
      if (live) live.textContent = '경주가 끝났습니다';
      playConfetti();
      sfx.fanfare();
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
