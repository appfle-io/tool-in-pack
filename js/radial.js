/* TIP · 메뉴 막대 반원 퀵바 — v1.11.0
 *
 * 판은 위가 일직선(메뉴 막대에 붙는 선)·아래가 납작한 반타원(아치)이고,
 * 켜 둔 모듈만 그 안쪽에 바짝 붙은 얕은 호 위에 놓는다. 마우스 휠·트랙패드·좌우 화살표로 돌린다.
 * 순서는 js/quickbar.js 가 정한다(기본: 고정됨 → 문서 → 미디어 → 유틸리티, 사용자 지정: tip.radialOrder.v1).
 * 창을 띄우는 일은 Tauri(mac/src-tauri) 가 하고, 이 파일은 화면만 담당한다.
 */

import { getModule } from '../modules/registry.js';
import { quickOrderIds } from './quickbar.js';
import { getQuickbarOpacity, syncStore } from './store.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

/* 반타원(아치) 기하 — css/radial.css·fanPath() 와 짝을 이룬다. (v1.11.0)
 * 창(580×206)의 위쪽 일직선이 메뉴 막대에 붙고, 아래는 가로 284·세로 176 의 반타원이다.
 * 모듈은 반지름 400 의 얕은 호를 따라 놓여 위 버튼 바로 아래(22px)에 바짝 붙는다.
 * v1.10.0 의 정반원(272)에서는 그 사이가 150px 비어 있었다 — 그 여백을 없앤 것이 이 값들이다. */
const SLOTS = 7;                    // 한 화면에 보이는 칸 수
const SPILL = 0.55;                 // 가장자리에서 살짝 걸쳐 보이는 정도(칸)
const G = {
  a: 284,                           // 판의 가로 반지름(창 580 기준 좌우 6px 여백)
  b: 176,                           // 판의 세로 깊이(위쪽 일직선에서 가장 아래까지)
  arc: 400,                         // 타일 중심이 놓이는 호의 반지름 — 클수록 납작하다
  arcY: 92,                         // 가운데 타일 중심의 y
  x3: 204,                          // 3칸 옆(가장 바깥) 타일의 x 오프셋
  pad: 6,                           // 창 좌우 여백
};

const rootEl = document.getElementById('rw');
const slotsEl = document.getElementById('slots');
const emptyEl = document.getElementById('empty');
const glassEl = document.getElementById('fan-glass');
const edgeSvg = document.getElementById('fan-edge');
const fanPathEl = document.getElementById('fan-path');
const openBtn = document.getElementById('open-app');
const settingsBtn = document.getElementById('open-settings');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');

let order = [];       // 지금 그려진 모듈 id
let items = [];       // [{ id, el }]
let pos = 0;          // 연속 회전 위치 — pos 번째 모듈이 가운데 칸에 온다
let target = 0;
let animating = false;
let lastSig = '';

/* ------------------------------ 기하 ------------------------------ */

function geometry() {
  const w = window.innerWidth || 580;
  // 반타원은 설계 폭(580)을 넘지 않는다 — 넓게 연 미리보기에서도 같은 모양이 되게.
  const a = Math.min(G.a, w / 2 - G.pad);
  const x3 = Math.min(G.x3, a * 0.72);      // 좁은 창에서는 칸 간격도 같이 줄인다
  return {
    cx: Math.round(w / 2),
    a,
    b: G.b,
    R: G.arc,
    yc: G.arcY - G.arc,                     // 타일 호의 원 중심(화면 위쪽 바깥)
    step: Math.asin(x3 / G.arc) / 3,        // 칸 사이 각도(설계값 ≈10.2°)
  };
}

/** 판 — 위쪽 일직선 + 아래쪽 반타원 호. */
function fanPath(g) {
  const { cx, a, b } = g;
  return `M ${(cx - a).toFixed(1)} 0 L ${(cx + a).toFixed(1)} 0 A ${a.toFixed(1)} ${b.toFixed(1)} 0 0 1 ${(cx - a).toFixed(1)} 0 Z`;
}

/** 테두리는 호에만 긋는다 — 위쪽 일직선은 메뉴 막대에 붙어 있어 선이 보이지 않게. */
function fanEdge(g) {
  const { cx, a, b } = g;
  return `M ${(cx + a).toFixed(1)} 0 A ${a.toFixed(1)} ${b.toFixed(1)} 0 0 1 ${(cx - a).toFixed(1)} 0`;
}

function applyGeometry(g) {
  const d = fanPath(g);
  glassEl.style.clipPath = `path("${d}")`;
  glassEl.style.setProperty('-webkit-clip-path', `path("${d}")`);
  const w = window.innerWidth || 580;
  const h = window.innerHeight || 206;
  edgeSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  fanPathEl.setAttribute('d', fanEdge(g));
}

/* ------------------------------ 그리기 ------------------------------ */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function canScroll() {
  return items.length > SLOTS;
}

function dialDelta(index, p, n) {
  let d = ((index - p) % n + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

function render({ keepCenter = true } = {}) {
  syncStore();
  applyTheme();
  applyOpacity();

  const centerId = order.length
    ? order[((Math.round(pos) % order.length) + order.length) % order.length]
    : null;

  const ids = quickOrderIds();
  const g = geometry();
  rootEl.style.setProperty('--cx', `${g.cx}px`);
  applyGeometry(g);

  slotsEl.innerHTML = '';
  items = [];
  ids.forEach((id, index) => {
    const mod = getModule(id);
    if (!mod) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rw-slot';
    el.dataset.moduleId = id;
    el.title = mod.name;
    el.setAttribute('aria-label', `${mod.name} 열기`);
    el.innerHTML = `<span class="rw-tile">${mod.icon || ''}</span>`
      + `<span class="rw-label">${escapeHtml(mod.shortName || mod.name)}</span>`;
    el.addEventListener('click', () => onSlotClick(id));
    slotsEl.append(el);
    items.push({ id, el });
  });

  order = items.map((item) => item.id);
  emptyEl.hidden = items.length > 0;

  const scrollable = canScroll();
  prevBtn.disabled = !scrollable;
  nextBtn.disabled = !scrollable;

  if (keepCenter && centerId && order.includes(centerId)) {
    pos = order.indexOf(centerId);
  } else {
    pos = 0;
  }
  target = pos;
  layout();
}

function layout() {
  const n = items.length;
  if (!n) return;
  const g = geometry();
  const slots = Math.min(SLOTS, n);
  const maxIndex = (slots - 1) / 2;
  const inner = maxIndex * g.step;
  const limit = inner + SPILL * g.step;

  items.forEach((item, index) => {
    // 모듈이 화면 칸 수보다 적으면 가운데로 모아 놓는다.
    const d = n <= slots ? index - maxIndex : dialDelta(index, pos, n);
    const angle = d * g.step;
    const ad = Math.abs(angle);

    if (ad > limit + 0.001) {
      item.el.style.visibility = 'hidden';
      item.el.style.opacity = '0';
      item.el.style.pointerEvents = 'none';
      return;
    }

    const x = g.cx + g.R * Math.sin(angle);
    const y = g.yc + g.R * Math.cos(angle);
    const t = inner > 0 ? Math.min(1, ad / inner) : 0;
    const fade = ad <= inner ? 1 : 1 - (ad - inner) / (SPILL * g.step);

    item.el.style.visibility = 'visible';
    item.el.style.pointerEvents = 'auto';
    item.el.style.left = `${x.toFixed(2)}px`;
    item.el.style.top = `${y.toFixed(2)}px`;
    item.el.style.transform = `translate(-50%, -26px) scale(${(1 - 0.12 * t).toFixed(3)})`;
    item.el.style.opacity = Math.max(0, fade).toFixed(3);
    item.el.dataset.offset = d.toFixed(2);
  });
}

/* ------------------------------ 회전 ------------------------------ */

function animate() {
  if (animating) return;
  animating = true;
  const step = () => {
    const diff = target - pos;
    if (Math.abs(diff) < 0.002) {
      pos = target;
      layout();
      animating = false;
      normalize();
      return;
    }
    pos += diff * 0.3;
    layout();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 위치 값이 한없이 커지지 않게 모듈 수의 배수만큼 되돌린다. */
function normalize() {
  const n = items.length;
  if (!n || n <= SLOTS) return;
  while (target - pos > n / 2) { pos += n; target += n; }
  while (target - pos < -n / 2) { pos -= n; target -= n; }
}

function nudge(amount) {
  if (!canScroll()) return;
  target = Math.round(target) + amount;
  animate();
}

function onSlotClick(id) {
  const index = order.indexOf(id);
  if (index < 0) return;

  if (canScroll()) {
    const d = dialDelta(index, pos, order.length);
    const half = Math.min(SLOTS, order.length - 1) / 2;
    if (Math.abs(d) > half + 0.2) {
      // 가장자리에 걸쳐 있는 모듈은 먼저 가운데로 끌어온다.
      target = pos + Math.round(d);
      animate();
      return;
    }
  }
  openModule(id);
}

/* ------------------------------ 동작 ------------------------------ */

function invoke(command, args) {
  if (!TAURI) return Promise.resolve();
  return window.__TAURI__.core.invoke(command, args || {}).catch((error) => {
    console.error('[TIP quickbar]', command, error);
  });
}

function openModule(id) {
  const mod = getModule(id);
  if (TAURI) {
    invoke('open_tool', { id, title: mod ? mod.name : id });
    return;
  }
  location.href = `./index.html?module=${encodeURIComponent(id)}`;
}

function openApp() {
  if (TAURI) {
    invoke('open_main', { module: null, settings: false });
    return;
  }
  location.href = './index.html';
}

/** 환경설정 — 메인 창을 띄우고 설정 시트를 바로 연다(이미 열려 있어도 시트만 앞으로). */
function openSettings() {
  if (TAURI) {
    invoke('open_main', { module: null, settings: true });
    return;
  }
  location.href = './index.html?settings=1';
}

function closeSelf() {
  if (TAURI) {
    invoke('hide_radial');
    return;
  }
  rootEl.hidden = true;   // 브라우저 미리보기에서만 쓰는 닫기
}

openBtn.addEventListener('click', openApp);
settingsBtn.addEventListener('click', openSettings);
prevBtn.addEventListener('click', () => nudge(-1));
nextBtn.addEventListener('click', () => nudge(1));

window.addEventListener('wheel', (event) => {
  if (!canScroll()) return;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!delta) return;
  event.preventDefault();

  let amount = delta;
  if (event.deltaMode === 1) amount *= 16;        // 줄 단위
  else if (event.deltaMode === 2) amount *= 400;  // 페이지 단위
  target += amount * 0.005;
  animate();
}, { passive: false });

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSelf();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    nudge(-1);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    nudge(1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    if (event.target === document.body || event.target === rootEl) {
      event.preventDefault();
      openApp();
    }
  }
});

window.addEventListener('resize', () => {
  const g = geometry();
  rootEl.style.setProperty('--cx', `${g.cx}px`);
  applyGeometry(g);
  layout();
});

/* --------------------------- 테마 · 투명도 · 실시간 동기화 --------------------------- */

const ACCENTS = ['green', 'blue', 'purple', 'orange', 'rose', 'slate'];

/** 유리판 배경의 불투명도 — 환경설정의 '메뉴 도구 투명도'(tip.quickbarOpacity.v1). (v1.11.0)
 *  타일·글자는 불투명하게 두고 판 배경만 바꿔 가독성은 그대로 둔다. */
function applyOpacity() {
  const percent = getQuickbarOpacity();
  document.documentElement.style.setProperty('--fan-alpha', (percent / 100).toFixed(2));
}

function applyTheme() {
  let dark = false;
  let accent = 'green';
  try {
    const saved = localStorage.getItem('tip.theme');
    dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const value = localStorage.getItem('tip.accent');
    if (ACCENTS.includes(value)) accent = value;
  } catch {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-accent', accent);
}

function signature() {
  try {
    return [
      localStorage.getItem('tip.theme'),
      localStorage.getItem('tip.accent'),
      localStorage.getItem('tip.settings.v1'),
      localStorage.getItem('tip.order.v1'),
      localStorage.getItem('tip.radialOrder.v1'),
      localStorage.getItem('tip.radialOrderMode.v1'),
      localStorage.getItem('tip.quickbarOpacity.v1'),
    ].join('|');
  } catch {
    return 'unavailable';
  }
}

/** 메인 창에서 순서·켜기/끄기·테마를 바꾸면 이 창도 따라간다(같은 origin 의 localStorage). */
function refreshIfChanged() {
  const sig = signature();
  if (sig === lastSig) return;
  lastSig = sig;
  render();
}

window.addEventListener('storage', refreshIfChanged);
window.addEventListener('focus', refreshIfChanged);

if (TAURI && window.__TAURI__.event) {
  window.__TAURI__.event.listen('tip://quickbar-refresh', refreshIfChanged);
}

setInterval(refreshIfChanged, 700);

/* ------------------------------ 시작 ------------------------------ */

if (new URLSearchParams(location.search).has('bg')) {
  document.body.classList.add('has-preview-bg');
}

lastSig = signature();
render();
