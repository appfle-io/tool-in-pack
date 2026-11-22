/* TIP app shell — hash routing, home hub, theme, PWA install/SW plumbing. */

import { listModules, getModule, CATEGORIES, categoryOf } from '../modules/registry.js';
import {
  moduleState, setModuleState, getTheme, setTheme, applyTheme, getAccent, setAccent, ACCENTS,
  getSectionOrder, setSectionOrder, hasSectionOrder, resetSectionOrder,
} from './store.js';
import { el, toast, icons } from './ui.js';

const view = document.getElementById('view');

/* ------------------------------ home hub ------------------------------ */

function renderHome() {
  view.innerHTML = '';

  const mods = listModules().map((mod) => ({ mod, state: moduleState(mod) }));

  // 꺼진 모듈은 원래 묶음에서 빼고 맨 아래 '꺼진 모듈' 한 곳에 모은다.
  const enabled = mods.filter(({ state }) => state.enabled);
  const off = mods.filter(({ state }) => !state.enabled);

  const pinned = ordered(enabled.filter(({ state }) => state.pinned), 'pinned');
  const rest = enabled.filter(({ state }) => !state.pinned);

  const sections = el('div', { class: 'home-sections' });

  // 고정된 모듈이 있을 때만 맨 위에 '고정됨' 섹션을 만든다.
  if (pinned.length) sections.append(homeSection('pinned', '고정됨', pinned, true));

  // 나머지는 registry 의 CATEGORIES 순서(문서 → 미디어 → 유틸리티)대로 묶는다.
  CATEGORIES.forEach(({ id, label }) => {
    const entries = ordered(rest.filter(({ mod }) => categoryOf(mod) === id), id);
    if (entries.length) sections.append(homeSection(id, label, entries, true));
  });

  // 꺼진 모듈이 1개 이상일 때만 맨 아래에 모은다. 스위치를 켜면 원래 묶음으로 돌아간다.
  if (off.length) sections.append(homeSection('off', '꺼진 모듈', off));

  view.append(sections);
}

/** 저장된 순서(tip.order.v1)대로 정렬한다. 목록에 없는 모듈은 원래 순서대로 뒤에 붙는다(안정 정렬). */
function ordered(entries, sectionId) {
  const saved = getSectionOrder(sectionId);
  if (!saved.length) return entries;
  const rank = new Map(saved.map((id, index) => [id, index]));
  const place = ({ mod }) => (rank.has(mod.id) ? rank.get(mod.id) : Number.MAX_SAFE_INTEGER);
  return entries.slice().sort((a, b) => place(a) - place(b));
}

function homeSection(id, label, entries, sortable = false) {
  const list = el('div', { class: 'module-list' });
  entries.forEach(({ mod, state }) => list.append(moduleRow(mod, state, { sectionId: id, sortable })));
  return el('section', { class: 'home-section', 'data-section': id, 'aria-label': label }, [
    el('h2', { class: 'home-section-title' }, [
      el('span', { text: label }),
      el('span', { class: 'home-section-count', text: String(entries.length), 'aria-hidden': 'true' }),
    ]),
    list,
  ]);
}

function moduleRow(mod, state, { sectionId = null, sortable = false } = {}) {
  const row = el('article', {
    class: `module-card${state.enabled ? '' : ' is-off'}`,
    role: 'button',
    tabindex: '0',
    'aria-label': `${mod.name} 열기`,
    'data-module-id': mod.id,
  });

  const open = () => {
    if (moduleState(mod).enabled) location.hash = `#/${mod.id}`;
    else toast(`${mod.name}이(가) 사용 중지되어 있습니다. 스위치로 켠 뒤 실행하세요.`);
  };

  const toggle = el('button', {
    class: 'switch',
    type: 'button',
    'aria-pressed': String(state.enabled),
    'aria-label': `${mod.name} 사용 여부`,
    'data-module-id': mod.id,
    'data-control': 'switch',
  }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = !moduleState(mod).enabled;
    setModuleState(mod.id, { enabled: next });
    rerenderHome({ id: mod.id, control: 'switch' });
    toast(next ? `${mod.name} 사용 시작` : `${mod.name} 사용 중지`);
  });

  const pinBtn = el('button', {
    class: 'pin-btn',
    type: 'button',
    'aria-pressed': String(state.pinned),
    'aria-label': `${mod.name} 상단 고정`,
    'data-module-id': mod.id,
    'data-control': 'pin',
    html: icons.pin,
  });
  pinBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = !moduleState(mod).pinned;
    setModuleState(mod.id, { pinned: next });
    rerenderHome({ id: mod.id, control: 'pin' });
    toast(next ? '상단에 고정했습니다' : '고정을 해제했습니다');
  });

  const openBtn = el('button', {
    class: 'open-btn',
    type: 'button',
    text: state.enabled ? '실행' : '중지',
    'aria-label': `${mod.name} 실행`,
  });
  openBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    open();
  });

  if (sortable) {
    row.classList.add('has-drag');
    row.append(dragHandle(row, mod, sectionId));
  }

  row.append(
    el('div', { class: 'module-icon', html: mod.icon }),
    el('div', { class: 'module-title' }, [
      el('h2', { text: mod.shortName || mod.name }),
      el('p', { text: mod.subtitle }),
    ]),
    el('div', { class: 'module-controls' }, [pinBtn, toggle, openBtn]),
  );

  row.addEventListener('click', open);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  return row;
}

function rerenderHome(focus = null) {
  const hash = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (hash) return;
  renderHome();
  if (!focus) return;

  // 카드가 다른 섹션으로 옮겨졌으니, 방금 누른 컨트롤로 초점을 따라가게 한다.
  const node = view.querySelector(`[data-module-id="${focus.id}"][data-control="${focus.control}"]`);
  if (!node) return;
  node.focus({ preventScroll: true });
  const rect = node.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    node.scrollIntoView({ block: 'nearest' });
  }
}

/* ------------------------- drag to reorder (v1.8.0) ------------------------ */

let drag = null;

function columnCount(list) {
  const template = getComputedStyle(list).gridTemplateColumns;
  if (!template || template === 'none') return 1;
  const count = template.trim().split(/\s+/).filter(Boolean).length;
  return count > 0 ? count : 1;
}

function dragHandle(row, mod, sectionId) {
  const handle = el('button', {
    class: 'drag-handle',
    type: 'button',
    'aria-label': `${mod.name} 순서 바꾸기`,
    title: '끌어서 순서 바꾸기 · 키보드 화살표',
    'data-module-id': mod.id,
    'data-control': 'drag',
    html: icons.grip,
  });

  // 핸들은 잡기만 한다. 카드 열기(클릭)로 번지지 않게 막는다.
  handle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener('pointerdown', (event) => startDrag(event, row, handle, sectionId));
  handle.addEventListener('keydown', (event) => moveByKeyboard(event, row, handle, sectionId));
  return handle;
}

function startDrag(event, row, handle, sectionId) {
  if (drag) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const list = row.parentElement;
  if (!list) return;
  const cards = [...list.children].filter((node) => node.classList.contains('module-card'));
  if (cards.length < 2) return;

  event.preventDefault();
  event.stopPropagation();

  const rect = row.getBoundingClientRect();
  const placeholder = el('div', { class: 'drag-placeholder', 'aria-hidden': 'true' });
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;
  row.before(placeholder);

  // 카드는 뷰포트에 고정해 손가락·마우스를 따라오게 하고, 원래 자리에는 점선 자리표시를 둔다.
  row.classList.add('is-dragging');
  row.style.width = `${rect.width}px`;
  row.style.height = `${rect.height}px`;
  row.style.left = `${rect.left}px`;
  row.style.top = `${rect.top}px`;
  document.body.append(row);
  list.classList.add('is-drag-active');
  document.body.classList.add('is-dragging');

  drag = {
    row,
    list,
    handle,
    placeholder,
    sectionId,
    pointerId: event.pointerId,
    grabX: event.clientX - rect.left,
    grabY: event.clientY - rect.top,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    cols: columnCount(list),
    width: rect.width,
    moved: false,
    startIds: cards.map((card) => card.dataset.moduleId),
    raf: 0,
  };

  try { handle.setPointerCapture(event.pointerId); } catch { /* 캡처가 안 되어도 포인터 이벤트는 들어온다 */ }
  handle.addEventListener('pointermove', onDragMove);
  handle.addEventListener('pointerup', onDragEnd);
  handle.addEventListener('pointercancel', onDragCancel);
  drag.raf = requestAnimationFrame(autoScroll);
}

function onDragMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;

  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    drag.row.classList.add('is-lifted');
  }

  drag.row.style.left = `${Math.max(Math.min(event.clientX - drag.grabX, window.innerWidth - drag.width - 6), 6)}px`;
  drag.row.style.top = `${event.clientY - drag.grabY}px`;
  placePlaceholder(event.clientX, event.clientY);
}

/** 포인터와 가장 가까운 카드 자리에 점선 자리표시를 옮긴다. (한 줄·여러 줄 그리드 모두) */
function placePlaceholder(px, py) {
  if (!drag) return;
  const { list, placeholder, cols } = drag;
  const items = [...list.children].filter((node) => node !== placeholder);
  if (!items.length) return;

  const rects = items.map((node) => node.getBoundingClientRect());
  let bestIndex = 0;
  let bestDistance = Infinity;
  rects.forEach((rect, index) => {
    const dx = px - (rect.left + rect.width / 2);
    const dy = py - (rect.top + rect.height / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  });

  const rect = rects[bestIndex];
  const after = cols > 1
    ? (py < rect.top ? false : py > rect.bottom ? true : px > rect.left + rect.width / 2)
    : py > rect.top + rect.height / 2;
  const target = items[bestIndex + (after ? 1 : 0)];

  if (target) {
    if (placeholder.nextElementSibling !== target) target.before(placeholder);
  } else if (list.lastElementChild !== placeholder) {
    list.append(placeholder);
  }
}

/** 화면 위·아래 가장자리에 닿으면 목록을 따라 스크롤한다. */
function autoScroll() {
  if (!drag) return;
  const margin = 76;
  const y = drag.lastY;
  let delta = 0;
  if (y < margin) delta = -Math.min(16, Math.ceil((margin - y) / 5));
  else if (y > window.innerHeight - margin) delta = Math.min(16, Math.ceil((y - (window.innerHeight - margin)) / 5));
  if (delta) {
    window.scrollBy(0, delta);
    placePlaceholder(drag.lastX, drag.lastY);
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function finishDrag() {
  if (!drag) return null;
  const state = drag;
  drag = null;
  cancelAnimationFrame(state.raf);
  state.handle.removeEventListener('pointermove', onDragMove);
  state.handle.removeEventListener('pointerup', onDragEnd);
  state.handle.removeEventListener('pointercancel', onDragCancel);
  try { state.handle.releasePointerCapture(state.pointerId); } catch { /* 이미 풀렸다 */ }
  state.list.classList.remove('is-drag-active');
  document.body.classList.remove('is-dragging');
  state.placeholder.remove();
  state.row.classList.remove('is-dragging', 'is-lifted');
  state.row.removeAttribute('style');
  return state;
}

function onDragEnd(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { row, list, placeholder, sectionId, startIds, moved } = drag;
  const droppedOn = placeholder.previousElementSibling;
  const state = finishDrag();
  if (!state) return;

  // 점선 자리에 카드를 되돌려 놓고, 실제 DOM 순서를 그대로 저장한다.
  if (droppedOn) droppedOn.after(row);
  else list.prepend(row);

  if (!moved) return;

  const ids = [...list.children]
    .filter((node) => node.classList.contains('module-card'))
    .map((node) => node.dataset.moduleId);
  if (ids.join('\u0000') === startIds.join('\u0000')) return;

  setSectionOrder(sectionId, ids);
  toast('카드 순서를 저장했습니다');
  focusDragHandle(row.dataset.moduleId);
}

/** 드래그 도중 취소(포인터 캔슬·창 전환)면 저장된 순서 그대로 다시 그린다. */
function onDragCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  finishDrag();
  renderHome();
}

function focusDragHandle(moduleId) {
  const node = view.querySelector(`[data-module-id="${moduleId}"][data-control="drag"]`);
  if (!node) return;
  node.focus({ preventScroll: true });
  const rect = node.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) node.scrollIntoView({ block: 'nearest' });
}

/** 키보드: ↑↓(한 줄) 또는 ↑↓(줄 단위)·←→(칸 단위)로 카드를 옮긴다. */
function moveByKeyboard(event, row, handle, sectionId) {
  const list = row.parentElement;
  if (!list) return;
  const cols = columnCount(list);
  const cards = [...list.children].filter((node) => node.classList.contains('module-card'));
  const from = cards.indexOf(row);
  if (from < 0) return;

  let delta = 0;
  if (event.key === 'ArrowUp') delta = cols > 1 ? -cols : -1;
  else if (event.key === 'ArrowDown') delta = cols > 1 ? cols : 1;
  else if (event.key === 'ArrowLeft' && cols > 1) delta = -1;
  else if (event.key === 'ArrowRight' && cols > 1) delta = 1;
  else return;

  event.preventDefault();
  event.stopPropagation();

  const to = from + delta;
  if (to < 0 || to >= cards.length) {
    toast(delta < 0 ? '이미 맨 앞입니다' : '이미 맨 뒤입니다');
    return;
  }

  if (to < from) cards[to].before(row);
  else cards[to].after(row);

  const ids = [...list.children]
    .filter((node) => node.classList.contains('module-card'))
    .map((node) => node.dataset.moduleId);
  setSectionOrder(sectionId, ids);

  const name = row.querySelector('.module-title h2')?.textContent || '카드';
  toast(`${name}을(를) ${to + 1}번째로 옮겼습니다 (${to + 1}/${ids.length})`);
  handle.focus({ preventScroll: true });
  const rect = row.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) row.scrollIntoView({ block: 'nearest' });
}

/* ---------------------------- module screens --------------------------- */

let activeCleanup = null;

function renderModule(mod) {
  if (activeCleanup) {
    try { activeCleanup(); } catch { /* keep going */ }
    activeCleanup = null;
  }
  view.innerHTML = '';

  const back = el('button', { class: 'back-btn', type: 'button', 'aria-label': '뒤로', html: icons.back });
  back.addEventListener('click', () => { location.hash = '#/'; });

  const bar = el('div', { class: 'screen-bar' }, [
    back,
    el('div', { class: 'screen-title' }, [
      el('h1', { text: mod.name }),
      el('p', { text: mod.subtitle }),
    ]),
  ]);

  const root = el('section', { class: 'module-screen', 'aria-label': mod.name });
  view.append(bar, root);
  view.focus({ preventScroll: false });
  window.scrollTo(0, 0);

  activeCleanup = mod.mount(root, {
    goHome: () => { location.hash = '#/'; },
    toast,
    icons,
  }) || null;
}

/* -------------------------------- router ------------------------------- */

function route() {
  const hash = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!hash) {
    renderHome();
    return;
  }
  const mod = getModule(hash);
  if (mod && moduleState(mod).enabled) {
    renderModule(mod);
  } else {
    renderHome();
    if (mod) toast(`${mod.name}이(가) 사용 중지되어 있습니다. 스위치로 켠 뒤 실행하세요.`);
  }
}

window.addEventListener('hashchange', route);

/* ------------------------------ theme ------------------------------- */

applyTheme(getTheme());
setAccent(getAccent());

/* --------------------------- settings sheet ------------------------- */

const settingsBtn = document.getElementById('settings-btn');
let sheet = null;

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const SWATCH_COLORS = {
  green: ['#2E5E4E', '#4A8E77'],
  blue: ['#0A6CFF', '#3D8BFF'],
  purple: ['#7C3AED', '#8B5CF6'],
  orange: ['#EA580C', '#F97316'],
  rose: ['#E11D48', '#F43F5E'],
  slate: ['#475569', '#64748B'],
};

function closeSheet() {
  if (!sheet) return;
  const { backdrop, panel } = sheet;
  sheet = null;
  backdrop.classList.remove('show');
  panel.classList.remove('show');
  setTimeout(() => { backdrop.remove(); panel.remove(); }, 220);
}

function openSheet() {
  if (sheet) return;
  const backdrop = el('div', { class: 'sheet-backdrop' });
  backdrop.addEventListener('click', closeSheet);

  const panel = el('div', {
    class: 'sheet',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '환경설정',
  });

  const render = () => {
    panel.innerHTML = '';
    panel.append(el('div', { class: 'sheet-grab' }));

    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const accent = getAccent();

    panel.append(el('div', { class: 'sheet-head' }, [
      el('h2', { text: '환경설정' }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '닫기',
        html: icons.close,
        onclick: closeSheet,
      }),
    ]));

    // 화면 모드
    const seg = el('div', { class: 'sheet-segment', role: 'radiogroup', 'aria-label': '화면 모드' });
    [['light', '라이트'], ['dark', '다크']].forEach(([id, label]) => {
      const btn = el('button', {
        class: 'sheet-seg',
        type: 'button',
        role: 'radio',
        'aria-checked': String(dark === (id === 'dark')),
      });
      btn.innerHTML = `${id === 'dark' ? MOON : SUN}<span> ${label}</span>`;
      btn.addEventListener('click', () => {
        setTheme(id);
        render();
      });
      seg.append(btn);
    });
    panel.append(el('div', { class: 'sheet-section' }, el('h3', { text: '화면 모드' }), seg));

    // 기본 색상
    const swatches = el('div', { class: 'sheet-swatches', role: 'radiogroup', 'aria-label': '기본 색상' });
    ACCENTS.forEach(({ id, label }) => {
      const [lightColor, darkColor] = SWATCH_COLORS[id];
      const btn = el('button', {
        class: 'swatch',
        type: 'button',
        role: 'radio',
        'aria-checked': String(accent === id),
        'aria-label': label,
      });
      const dot = el('span', { class: 'swatch-dot' });
      dot.style.background = `linear-gradient(135deg, ${lightColor} 50%, ${darkColor} 50%)`;
      btn.append(dot, el('span', { text: label }));
      btn.addEventListener('click', () => {
        setAccent(id);
        render();
      });
      swatches.append(btn);
    });
    panel.append(el('div', { class: 'sheet-section' }, el('h3', { text: '기본 색상' }), swatches));

    // 홈 카드 순서를 바꾼 적이 있을 때만 되돌리기 버튼을 보여 준다.
    if (hasSectionOrder()) {
      panel.append(el('div', { class: 'sheet-section' }, [
        el('h3', { text: '홈 화면' }),
        el('button', {
          class: 'sheet-reset',
          type: 'button',
          text: '카드 순서 초기화',
          onclick: () => {
            resetSectionOrder();
            rerenderHome();
            closeSheet();
            toast('카드 순서를 처음 상태로 되돌렸습니다');
          },
        }),
      ]));
    }
  };

  render();
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    panel.classList.add('show');
  });
  sheet = { backdrop, panel };
}

settingsBtn.addEventListener('click', () => {
  if (sheet) closeSheet();
  else openSheet();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSheet();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!getTheme()) applyTheme(null);
});

/* ----------------------------- SW / install ---------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((error) => {
      console.warn('[TIP] service worker registration failed:', error);
    });
  });
}

let deferredPrompt = null;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  if (installBtn) installBtn.hidden = false;
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
}

window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.hidden = true;
  toast('홈 화면에 TIP이 추가되었습니다');
});

/* -------------------------------- boot --------------------------------- */

route();
