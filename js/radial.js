/* TIP · 메뉴 막대 반원 퀵바 — v1.10.0
 *
 * 판은 위가 일직선(메뉴 막대에 붙는 지름)·아래가 매끈한 반원이고,
 * 켜 둔 모듈만 그 안쪽 호 위에 놓는다. 마우스 휠·트랙패드·좌우 화살표로 돌린다.
 * 순서는 js/quickbar.js 가 정한다(기본: 고정됨 → 문서 → 미디어 → 유틸리티, 사용자 지정: tip.radialOrder.v1).
 * 창을 띄우는 일은 Tauri(mac/src-tauri) 가 하고, 이 파일은 화면만 담당한다.
 */

import { getModule } from '../modules/registry.js';
import { quickOrderIds } from './quickbar.js';
import { syncStore } from './store.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

/* 반원 기하 — css/radial.css·fanPath() 와 짝을 이룬다.
 * 창(580×306)의 위쪽 가운데를 원의 중심으로 두고, 지름이 위쪽 일직선이 된다. */
const SLOTS = 7;                    // 한 화면에 보이는 칸 수
const STEP = 21 * (Math.PI / 180);  // 칸 사이 각도
const SPILL = 0.55;                 // 가장자리에서 살짝 걸쳐 보이는 정도(칸)
const G = {
  R: 272,                           // 반원 판의 반지름(= 창 위쪽에서 아래까지 높이)
  arc: 208,                         // 타일 중심이 놓이는 호의 반지름
  pad: 18,                          // 창 좌우 여백(반원이 창에 꽉 차지 않게)
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
  const scale = Math.min(1, (w - G.pad * 2) / (2 * G.R));
  return { cx: Math.round(w / 2), R: G.R * scale, arc: G.arc * scale };
}

/** 반원 판 — 위쪽 지름(일직선) + 아래쪽 반원 호. */
function fanPath(g) {
  const { cx, R } = g;
  const r = R.toFixed(1);
  return `M ${(cx - R).toFixed(1)} 0 L ${(cx + R).toFixed(1)} 0 A ${r} ${r} 0 0 1 ${(cx - R).toFixed(1)} 0 Z`;
}

/** 테두리는 호에만 긋는다 — 위쪽 일직선은 메뉴 막대에 붙어 있어 선이 보이지 않게. */
function fanEdge(g) {
  const { cx, R } = g;
  const r = R.toFixed(1);
  return `M ${(cx + R).toFixed(1)} 0 A ${r} ${r} 0 0 1 ${(cx - R).toFixed(1)} 0`;
}

function applyGeometry(g) {
  const d = fanPath(g);
  glassEl.style.clipPath = `path("${d}")`;
  glassEl.style.setProperty('-webkit-clip-path', `path("${d}")`);
  const w = window.innerWidth || 580;
  const h = window.innerHeight || 306;
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
  const inner = maxIndex * STEP;
  const limit = inner + SPILL * STEP;

  items.forEach((item, index) => {
    // 모듈이 화면 칸 수보다 적으면 가운데로 모아 놓는다.
    const d = n <= slots ? index - maxIndex : dialDelta(index, pos, n);
    const angle = d * STEP;
    const ad = Math.abs(angle);

    if (ad > limit + 0.001) {
      item.el.style.visibility = 'hidden';
      item.el.style.opacity = '0';
      item.el.style.pointerEvents = 'none';
      return;
    }

    const x = g.cx + g.arc * Math.sin(angle);
    const y = g.arc * Math.cos(angle);
    const t = inner > 0 ? Math.min(1, ad / inner) : 0;
    const fade = ad <= inner ? 1 : 1 - (ad - inner) / (SPILL * STEP);

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

/* --------------------------- 테마 · 실시간 동기화 --------------------------- */

const ACCENTS = ['green', 'blue', 'purple', 'orange', 'rose', 'slate'];

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
