/* TIP app shell — hash routing, home hub, theme, PWA install/SW plumbing. */

import { listModules, getModule, CATEGORIES, categoryOf } from '../modules/registry.js';
import {
  moduleState, setModuleState, getTheme, setTheme, applyTheme, getAccent, setAccent, ACCENTS,
  getSectionOrder, setSectionOrder, hasSectionOrder, resetSectionOrder, resetRadialOrder,
  getMenuBarVisible, setMenuBarVisible, getRadialOrderMode, setRadialOrderMode,
  getQuickbarOpacity, setQuickbarOpacity, QUICKBAR_OPACITY_MIN, QUICKBAR_OPACITY_MAX,
  QUICKBAR_OPACITY_DEFAULT, getNotchSettings, setNotchEnabled, setNotchWidget, NOTCH_WIDGETS,
  getSearchShortcut, setSearchShortcut, SEARCH_SHORTCUT_DEFAULT,
} from './store.js';
import { quickOrderIds, customQuickOrderIds, saveQuickOrder } from './quickbar.js';
import { el, toast, icons } from './ui.js';

/* Mac 앱(Tauri) 안에서 실행 중인지 — 메뉴 막대 퀵바와 창을 주고받는 데 쓴다. */
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

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
      el('h2', {}, [
        el('span', { class: 'module-name', text: mod.shortName || mod.name }),
        mod.badge ? el('span', { class: 'mac-badge', text: mod.badge, title: 'Mac 앱 전용 기능' }) : null,
      ]),
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

  deliverHandoff(mod, root);
}

/* 노치 아일랜드 보관함에서 [변환] 등으로 보낸 파일을 그 모듈에 넘긴다. (v1.12.0)
 * 같은 origin 이라 localStorage 로 건네고, 모듈은 평소의 drop 핸들러로 받는다. */
const HANDOFF_KEY = 'tip.handoff.v1';

function deliverHandoff(mod, root) {
  let handoff = null;
  try {
    handoff = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null');
  } catch {
    handoff = null;
  }
  if (!handoff || handoff.moduleId !== mod.id || !handoff.dataUrl) return;
  const age = Date.now() - Number(handoff.created || 0);
  try { localStorage.removeItem(HANDOFF_KEY); } catch { /* 지우지 못해도 한 번은 넘긴다 */ }
  if (age > 5 * 60 * 1000) return;

  fetch(handoff.dataUrl)
    .then((response) => response.blob())
    .then((blob) => {
      const file = new File([blob], handoff.name || 'file', { type: handoff.type || blob.type });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      root.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: transfer,
      }));
      toast(`${file.name}을(를) 불러왔습니다`);
    })
    .catch((error) => {
      console.error('[TIP handoff]', error);
      toast('보낸 파일을 불러오지 못했습니다');
    });
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

/* ------------------- 반원 퀵바 순서 — 하위 메뉴 (v1.10.0) ------------------- */

let sheetView = 'main';        // 'main' | 'quickbar'
let sheetRender = null;        // openSheet() 가 만든 render — 하위 메뉴에서 다시 그릴 때 쓴다

const RADIAL_MODE_LABELS = { asc: '오름차순', desc: '내림차순', custom: '사용자 지정' };

const RADIAL_MODE_OPTIONS = [
  { id: 'asc', label: '오름차순', hint: '모듈 이름 가나다·알파벳 순' },
  { id: 'desc', label: '내림차순', hint: '이름 역순' },
  { id: 'custom', label: '사용자 지정', hint: '직접 끌어서 정한 순서' },
];

/** 메인 설정 화면의 한 줄 메뉴 — 지금 고른 방식이 오른쪽에 보인다. */
function quickbarMenuRow() {
  const mode = getRadialOrderMode();
  const row = el('button', {
    class: 'sheet-menu',
    type: 'button',
    'aria-label': `반원 퀵바 순서 (지금: ${RADIAL_MODE_LABELS[mode]}) — 열기`,
  }, [
    el('span', { class: 'sheet-menu-label', text: '반원 퀵바 순서' }),
    el('span', { class: 'sheet-menu-value', text: RADIAL_MODE_LABELS[mode] }),
    el('span', { class: 'sheet-menu-arrow', text: '›', 'aria-hidden': 'true' }),
  ]);
  row.addEventListener('click', () => {
    sheetView = 'quickbar';
    if (sheetRender) sheetRender();
  });
  return el('div', { class: 'sheet-section' }, row);
}

/** 하위 메뉴 — 방식 선택 + (사용자 지정일 때만) 순서 편집 목록. */
function quickbarScreen(rerenderSheet) {
  const mode = getRadialOrderMode();

  const back = el('button', { class: 'sheet-back', type: 'button', 'aria-label': '설정으로 돌아가기' }, [
    el('span', { class: 'sheet-back-icon', html: icons.back, 'aria-hidden': 'true' }),
    el('span', { text: '설정' }),
  ]);
  back.addEventListener('click', () => {
    sheetView = 'main';
    rerenderSheet();
  });

  const head = el('div', { class: 'sheet-head sheet-head-sub' }, [
    back,
    el('h2', { text: '반원 퀵바 순서' }),
    el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': '닫기',
      html: icons.close,
      onclick: closeSheet,
    }),
  ]);

  const options = el('div', { class: 'mode-list', role: 'radiogroup', 'aria-label': '반원 퀵바 순서 방식' });
  RADIAL_MODE_OPTIONS.forEach(({ id, label, hint }) => {
    const on = mode === id;
    const row = el('button', {
      class: `mode-row${on ? ' is-on' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(on),
      'data-mode': id,
    }, [
      el('span', { class: 'mode-text' }, [
        el('b', { text: label }),
        el('span', { class: 'mode-hint', text: hint }),
      ]),
      el('span', { class: 'mode-mark', 'aria-hidden': 'true' }),
    ]);
    row.addEventListener('click', () => {
      if (getRadialOrderMode() === id) return;
      setRadialOrderMode(id);
      toast(id === 'custom' ? '사용자 지정 순서로 표시합니다' : `모듈 이름 ${label}으로 표시합니다`);
      rerenderSheet();
    });
    options.append(row);
  });

  const parts = [head, el('div', { class: 'sheet-section' }, options)];

  if (mode === 'custom') {
    parts.push(quickbarList(rerenderSheet));
  } else {
    parts.push(el('p', {
      class: 'qb-note mode-note',
      text: '지금은 이름순으로 보입니다. 직접 정해 둔 순서는 그대로 남아 있고, 사용자 지정을 고르면 다시 적용됩니다.',
    }));
  }

  return parts;
}

/** 사용자 지정 목록 — 끌어서(⋮⋮) 또는 ↑↓ 로 순서를 바꾼다. */
function quickbarList(rerenderSheet) {
  const ids = customQuickOrderIds();
  const mods = ids.map((id) => getModule(id)).filter(Boolean);
  const list = el('div', { class: 'qb-list', role: 'list' });

  if (!mods.length) {
    list.append(el('p', { class: 'qb-empty', text: '켜 둔 모듈이 없습니다. 모듈을 켜면 여기에 나타납니다.' }));
  }

  const save = () => {
    const next = [...list.querySelectorAll('.qb-row')].map((row) => row.dataset.moduleId);
    if (!next.length) return;
    saveQuickOrder(next);
    toast('반원 퀵바 순서를 저장했습니다');
  };

  mods.forEach((mod) => list.append(quickbarRow(mod, save)));
  refreshQuickbarButtons(list);

  return el('div', { class: 'sheet-section qb-section' }, [
    el('p', { class: 'qb-note', text: '위에서부터 반원 왼쪽 → 오른쪽 순서입니다. 끌어서 바꾸세요.' }),
    list,
    el('button', {
      class: 'sheet-reset',
      type: 'button',
      text: '메인 순서 따르기',
      onclick: () => {
        resetRadialOrder();
        rerenderSheet();
        toast('퀵바 순서를 메인 화면 순서로 되돌렸습니다');
      },
    }),
  ]);
}

function quickbarRow(mod, save) {
  const row = el('div', { class: 'qb-row', role: 'listitem', 'data-module-id': mod.id });

  const handle = el('button', {
    class: 'qb-handle',
    type: 'button',
    'aria-label': `${mod.name} 퀵바 순서 바꾸기`,
    title: '끌어서 순서 바꾸기',
    html: icons.grip,
  });
  handle.addEventListener('pointerdown', (event) => startQuickbarDrag(event, row, handle, save));

  const up = el('button', { class: 'qb-move', type: 'button', 'data-dir': 'up', 'aria-label': `${mod.name} 위로`, text: '↑' });
  const down = el('button', { class: 'qb-move', type: 'button', 'data-dir': 'down', 'aria-label': `${mod.name} 아래로`, text: '↓' });
  const list = () => row.parentElement;
  up.addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (!prev) return;
    prev.before(row);
    save();
    refreshQuickbarButtons(list());
  });
  down.addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (!next) return;
    next.after(row);
    save();
    refreshQuickbarButtons(list());
  });

  row.append(
    handle,
    el('span', { class: 'qb-icon', html: mod.icon || '' }),
    el('span', { class: 'qb-name', text: mod.shortName || mod.name }),
    up,
    down,
  );
  return row;
}

/** 목록의 첫 줄·마지막 줄에서는 위/아래 버튼을 끈다. */
function refreshQuickbarButtons(list) {
  if (!list) return;
  const rows = [...list.querySelectorAll('.qb-row')];
  rows.forEach((row, index) => {
    const up = row.querySelector('.qb-move[data-dir="up"]');
    const down = row.querySelector('.qb-move[data-dir="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
}

/** 목록 안 드래그 — 잡은 줄을 포인터 위치에 따라 위아래로 옮긴다(시트 스크롤도 따라간다). */
function startQuickbarDrag(event, row, handle, save) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const list = row.parentElement;
  if (!list || list.querySelectorAll('.qb-row').length < 2) return;

  event.preventDefault();
  event.stopPropagation();
  const panel = row.closest('.sheet');
  row.classList.add('is-dragging');
  document.body.classList.add('is-dragging');

  const onMove = (moveEvent) => {
    moveEvent.preventDefault();
    const y = moveEvent.clientY;

    if (panel) {
      const box = panel.getBoundingClientRect();
      if (y < box.top + 48) panel.scrollTop -= 10;
      else if (y > box.bottom - 48) panel.scrollTop += 10;
    }

    const others = [...list.querySelectorAll('.qb-row')].filter((node) => node !== row);
    const target = others.find((node) => {
      const rect = node.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    if (target) {
      if (target.previousElementSibling !== row) target.before(row);
    } else if (list.lastElementChild !== row) {
      list.append(row);
    }
  };

  const onEnd = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    row.classList.remove('is-dragging');
    document.body.classList.remove('is-dragging');
    save();
    refreshQuickbarButtons(list);
  };

  // 줄을 DOM 안에서 옮기면 핸들의 포인터 캡처가 풀리므로, 창 전체에서 포인터를 받는다.
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}

/* --------------------------- 앱 업데이트 (v1.10.0) --------------------------- */

/** 현재 버전 — sw.js 의 CACHE_VERSION·mac/Cargo.toml 과 함께 올린다. */
const APP_VERSION = '1.12.0';

let updateBusy = false;

function invokeTauri(command, args) {
  return window.__TAURI__.core.invoke(command, args || {});
}

/** Mac 앱 — 상단 메뉴 막대 아이콘(트레이)과 반원 퀵바를 보일지 정한다(v1.10.0). */
function menuBarSection() {
  const visible = getMenuBarVisible();
  const toggle = el('button', {
    class: 'switch',
    type: 'button',
    'aria-pressed': String(visible),
    'aria-label': '메뉴 막대에 표시',
  }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));

  toggle.addEventListener('click', async () => {
    const next = !getMenuBarVisible();
    setMenuBarVisible(next);
    toggle.setAttribute('aria-pressed', String(next));
    try {
      await invokeTauri('set_tray_visible', { visible: next });
      toast(next ? '메뉴 막대에 TIP 아이콘을 표시합니다' : '메뉴 막대에서 TIP 아이콘을 숨겼습니다');
    } catch (error) {
      console.error('[TIP menubar]', error);
      setMenuBarVisible(!next);
      toggle.setAttribute('aria-pressed', String(!next));
      toast('메뉴 막대 설정을 바꾸지 못했습니다');
    }
  });

  return el('div', { class: 'sheet-section mb-section' }, [
    el('h3', { text: '메뉴 막대' }),
    el('p', {
      class: 'mb-note',
      text: '상단 메뉴 막대 아이콘과 반원 퀵바를 쓸지 정합니다. 끄면 Dock 아이콘으로만 열 수 있습니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label', text: '메뉴 막대에 표시' }),
      toggle,
    ]),
    quickbarOpacityRow(),
  ]);
}

/** 반원 퀵바 배경 투명도 — 35~100%, 기본 92%. (v1.11.0)
 *  값은 tip.quickbarOpacity.v1 에 저장하고, 열려 있는 퀵바도 같은 키를 700ms 안에 다시 읽어 따라온다. */
function quickbarOpacityRow() {
  const readout = el('span', { class: 'op-value', text: `${getQuickbarOpacity()}%` });
  const range = el('input', {
    class: 'op-range',
    type: 'range',
    min: String(QUICKBAR_OPACITY_MIN),
    max: String(QUICKBAR_OPACITY_MAX),
    step: '1',
    value: String(getQuickbarOpacity()),
    'aria-label': '메뉴 도구 투명도',
  });

  const paint = () => {
    const percent = getQuickbarOpacity();
    readout.textContent = `${percent}%`;
    range.style.setProperty('--op-fill',
      `${((percent - QUICKBAR_OPACITY_MIN) / (QUICKBAR_OPACITY_MAX - QUICKBAR_OPACITY_MIN)) * 100}%`);
  };
  paint();

  range.addEventListener('input', () => {
    setQuickbarOpacity(range.value);
    paint();
  });
  // 더블클릭하면 기본값(92%)으로 돌아간다.
  range.addEventListener('dblclick', () => {
    setQuickbarOpacity(QUICKBAR_OPACITY_DEFAULT);
    range.value = String(getQuickbarOpacity());
    paint();
  });

  return el('div', { class: 'op-row' }, [
    el('div', { class: 'op-head' }, [
      el('span', { class: 'op-label', text: '메뉴 도구 투명도' }),
      readout,
    ]),
    range,
    el('p', { class: 'op-note', text: '반원 퀵바 배경의 불투명도입니다. 아이콘과 글자는 그대로 선명합니다.' }),
  ]);
}

/* ------------------- 노치 아일랜드 설정 (v1.12.0) ------------------- */

/** Mac 앱 — 노치 아일랜드 자체와 위젯별 표시를 정한다. */
function notchSection(rerenderSheet) {
  const notch = getNotchSettings();

  const master = el('button', {
    class: 'switch',
    type: 'button',
    'aria-pressed': String(notch.enabled),
    'aria-label': '노치 아일랜드',
  }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));

  master.addEventListener('click', async () => {
    const next = !getNotchSettings().enabled;
    setNotchEnabled(next);
    master.setAttribute('aria-pressed', String(next));
    try {
      await invokeTauri('set_notch_enabled', { enabled: next });
      toast(next ? '노치 아일랜드를 켰습니다' : '노치 아일랜드를 껐습니다');
    } catch (error) {
      console.error('[TIP notch]', error);
      setNotchEnabled(!next);
      master.setAttribute('aria-pressed', String(!next));
      toast('노치 아일랜드 설정을 바꾸지 못했습니다');
    }
    if (rerenderSheet) rerenderSheet();
  });

  const rows = NOTCH_WIDGETS.map(({ id, label, hint }) => {
    const on = notch.widgets[id];
    const toggle = el('button', {
      class: 'switch',
      type: 'button',
      'aria-pressed': String(on),
      'aria-label': label,
      disabled: !notch.enabled,
    }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));

    toggle.addEventListener('click', () => {
      const next = !getNotchSettings().widgets[id];
      setNotchWidget(id, next);
      toggle.setAttribute('aria-pressed', String(next));
      toast(next ? `${label} 위젯을 표시합니다` : `${label} 위젯을 숨깁니다`);
    });

    return el('div', { class: `mb-row notch-row${notch.enabled ? '' : ' is-off'}` }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: label }),
        el('i', { class: 'notch-hint', text: hint }),
      ]),
      toggle,
    ]);
  });

  return el('div', { class: 'sheet-section mb-section notch-section' }, [
    el('h3', { text: '노치 아일랜드' }),
    el('p', {
      class: 'mb-note',
      text: '화면 최상단 노치에 마우스를 올리거나 파일을 끌어다 놓으면 펼쳐집니다. 반원 퀵바는 그대로 따로 쓸 수 있습니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label', text: '노치 아일랜드 사용' }),
      master,
    ]),
    ...rows,
  ]);
}

/* ------------------- 전역 빠른 실행 검색 (v1.12.0) ------------------- */

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn']);

/** 키 이벤트 → Tauri accelerator ('Alt+Space', 'CmdOrCtrl+Shift+KeyK'). */
function acceleratorOf(event) {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const code = event.code || '';
  const allowed = /^(Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|Space|Enter|Backslash|Slash|Comma|Period|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote)$/;
  if (!allowed.test(code)) return null;
  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push('CmdOrCtrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (!parts.length) return null;
  parts.push(code);
  return parts.join('+');
}

function searchSection(rerenderSheet) {
  const current = getSearchShortcut();
  let capturing = false;

  const chip = el('kbd', { class: 'shortcut-chip', text: prettyShortcut(current) });
  const changeBtn = el('button', { class: 'primary-btn ghost shortcut-change', type: 'button', text: '변경' });
  const openBtn = el('button', { class: 'icon-btn shortcut-open', type: 'button', text: '열기' });

  changeBtn.addEventListener('click', () => {
    if (capturing) return;
    capturing = true;
    chip.textContent = '새 단축키를 누르세요';
    chip.classList.add('is-capturing');
    changeBtn.textContent = '취소';
    const onKey = async (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        stop();
        return;
      }
      const accelerator = acceleratorOf(event);
      if (!accelerator) return;
      event.preventDefault();
      try {
        await invokeTauri('set_search_shortcut', { accelerator });
        setSearchShortcut(accelerator);
        toast(`빠른 실행 검색 단축키를 ${prettyShortcut(accelerator)} 로 바꿨습니다`);
      } catch (error) {
        console.error('[TIP search]', error);
        toast('단축키를 등록하지 못했습니다. 다른 조합을 써 보세요.');
      }
      stop();
      if (rerenderSheet) rerenderSheet();
    };
    const stop = () => {
      capturing = false;
      document.removeEventListener('keydown', onKey, true);
      chip.textContent = prettyShortcut(getSearchShortcut());
      chip.classList.remove('is-capturing');
      changeBtn.textContent = '변경';
    };
    document.addEventListener('keydown', onKey, true);
  });

  openBtn.addEventListener('click', () => {
    invokeTauri('open_search').catch((error) => {
      console.error('[TIP search]', error);
      toast('검색창을 열지 못했습니다');
    });
  });

  return el('div', { class: 'sheet-section mb-section search-section' }, [
    el('h3', { text: '빠른 실행 검색' }),
    el('p', {
      class: 'mb-note',
      text: '어디서든 단축키 한 번으로 모듈을 찾아 바로 실행합니다. 입력한 것도, 검색한 것도 기기 밖으로 나가지 않습니다.',
    }),
    el('div', { class: 'shortcut-row' }, [
      el('div', { class: 'shortcut-keys' }, [chip]),
      el('div', { class: 'shortcut-actions' }, [changeBtn, openBtn]),
    ]),
    el('p', { class: 'op-note', text: `기본값은 ${prettyShortcut(SEARCH_SHORTCUT_DEFAULT)} 입니다. 열린 검색창은 Esc 로 닫습니다.` }),
  ]);
}

/** 'CmdOrCtrl+Shift+KeyK' → '⌘⇧K' 처럼 보여 준다. */
function prettyShortcut(accelerator) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || '');
  const map = {
    CmdOrCtrl: mac ? '⌘' : 'Ctrl', Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift',
  };
  const keys = {
    Space: 'Space', Enter: 'Return', Backslash: '\\', Slash: '/', Comma: ',', Period: '.',
    Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  };
  return String(accelerator || '').split('+').map((part) => {
    if (map[part]) return map[part];
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit[0-9]$/.test(part)) return part.slice(5);
    return keys[part] || part;
  }).join(mac ? '' : '+');
}

/** 환경설정 시트의 '앱 업데이트' 섹션 — 현재 버전과 확인 버튼. */
function updateSection() {
  const btn = el('button', { class: 'primary-btn ghost upd-check', type: 'button', text: '업데이트 확인' });
  btn.addEventListener('click', () => checkAppUpdate(btn));

  return el('div', { class: 'sheet-section upd-section' }, [
    el('h3', { text: '앱 업데이트' }),
    el('p', {
      class: 'upd-note',
      text: TAURI
        ? '새 버전이 있으면 내려받아 설치하고 앱을 다시 시작합니다.'
        : '새 버전이 준비되었으면 지금 적용할지 물어봅니다.',
    }),
    el('div', { class: 'upd-row' }, [
      el('span', { class: 'upd-version', text: `현재 버전 v${APP_VERSION}` }),
      btn,
    ]),
  ]);
}

async function checkAppUpdate(btn) {
  if (updateBusy) return;
  updateBusy = true;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '확인 중…';
  try {
    if (TAURI) {
      const info = await invokeTauri('check_app_update');
      if (!info || !info.available) {
        toast((info && info.message) || `최신 버전입니다 (v${info && info.current ? info.current : APP_VERSION})`);
        return;
      }
      askUpdate({ version: info.version, notes: info.notes, url: info.url, web: false });
    } else {
      const info = await checkWebUpdate();
      if (info) askUpdate(info);
    }
  } catch (error) {
    console.error('[TIP update]', error);
    toast('업데이트를 확인하지 못했습니다');
  } finally {
    updateBusy = false;
    btn.disabled = false;
    btn.textContent = label;
  }
}

/** 웹(PWA) — 서비스 워커 update() 로 대기 중인 새 버전이 있는지 본다. */
async function checkWebUpdate() {
  if (!('serviceWorker' in navigator)) {
    toast('이 브라우저에서는 자동 업데이트를 지원하지 않습니다');
    return null;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    toast(`최신 버전입니다 (v${APP_VERSION})`);
    return null;
  }

  try { await reg.update(); } catch { /* 오프라인이면 그냥 최신으로 본다 */ }

  // 방금 설치가 시작됐으면 끝날 때까지(최대 4초) 기다린다.
  if (!reg.waiting && reg.installing) {
    await new Promise((resolve) => {
      const worker = reg.installing;
      const done = () => resolve();
      if (!worker) { done(); return; }
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'redundant') done();
      });
      setTimeout(done, 4000);
    });
  }

  const waiting = reg.waiting;
  if (!waiting) {
    toast(`최신 버전입니다 (v${APP_VERSION})`);
    return null;
  }
  return { web: true, version: await readRemoteVersion(), notes: '' };
}

/** 새 워커의 sw.js 에서 CACHE_VERSION 만 읽어 표시용 버전을 얻는다. */
async function readRemoteVersion() {
  try {
    const response = await fetch(`./sw.js?ts=${Date.now()}`, { cache: 'no-store' });
    const text = await response.text();
    const found = text.match(/CACHE_VERSION\s*=\s*'tip-v([\d.]+)'/);
    return found ? found[1] : '';
  } catch {
    return '';
  }
}

/** "새 버전이 있습니다. 지금 업데이트 후 재시작할까요?" */
function askUpdate(info) {
  const backdrop = el('div', { class: 'upd-backdrop' });
  const card = el('div', { class: 'upd-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '앱 업데이트' });
  const later = el('button', { class: 'primary-btn ghost', type: 'button', text: '나중에' });
  const go = el('button', { class: 'primary-btn', type: 'button', text: '지금 업데이트' });

  const close = () => {
    backdrop.classList.remove('show');
    card.classList.remove('show');
    setTimeout(() => { backdrop.remove(); card.remove(); }, 200);
  };
  later.addEventListener('click', close);
  backdrop.addEventListener('click', close);

  card.append(
    el('h2', { text: info.version ? `새 버전 v${info.version}` : '새 버전이 있습니다' }),
    el('p', { class: 'upd-msg', text: TAURI ? '지금 업데이트한 뒤 앱을 다시 시작할까요?' : '지금 업데이트한 뒤 새로고침할까요?' }),
  );
  if (info.notes) card.append(el('p', { class: 'upd-notes', text: info.notes }));
  card.append(el('div', { class: 'upd-actions' }, [later, go]));

  go.addEventListener('click', () => {
    close();
    runUpdate(info);
  });

  document.body.append(backdrop, card);
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    card.classList.add('show');
  });

  // Esc 로도 닫힌다(진행률 카드는 업데이트가 끝날 때까지 닫지 않는다).
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    window.removeEventListener('keydown', onKey, true);
    close();
  };
  window.addEventListener('keydown', onKey, true);
}

/** 진행률 카드 — 퍼센트 바 + 상태 문구. 실패하면 닫기 버튼이 나온다. */
function showProgressUi() {
  const backdrop = el('div', { class: 'upd-backdrop' });
  const fill = el('div', { class: 'upd-bar-fill' });
  const pct = el('span', { class: 'upd-pct', text: '0%' });
  const status = el('p', { class: 'upd-status', text: '준비 중…' });
  const close = el('button', { class: 'primary-btn ghost', type: 'button', text: '닫기' });
  close.hidden = true;

  const card = el('div', {
    class: 'upd-modal upd-progress',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '앱 업데이트 진행',
  }, [
    el('h2', { text: '업데이트 중' }),
    el('div', { class: 'upd-track', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill),
    el('div', { class: 'upd-meta' }, [status, pct]),
    close,
  ]);

  document.body.append(backdrop, card);
  requestAnimationFrame(() => {
    backdrop.classList.add('show');
    card.classList.add('show');
  });

  const track = card.querySelector('.upd-track');
  return {
    set(percent, text) {
      const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
      fill.style.width = `${value}%`;
      pct.textContent = `${value}%`;
      track.setAttribute('aria-valuenow', String(value));
      if (text) status.textContent = text;
    },
    fail(message) {
      fill.classList.add('is-error');
      status.textContent = message;
      close.hidden = false;
      close.addEventListener('click', () => {
        backdrop.classList.remove('show');
        card.classList.remove('show');
        setTimeout(() => { backdrop.remove(); card.remove(); }, 200);
      });
    },
  };
}

const UPDATE_STAGES = {
  download: '내려받는 중',
  extract: '압축을 푸는 중',
  install: '설치하는 중',
  restart: '앱을 다시 시작하는 중',
};

async function runUpdate(info) {
  const ui = showProgressUi();

  if (info.web) {
    ui.set(30, '새 버전을 적용하는 중…');
    const reg = await navigator.serviceWorker.getRegistration();
    const waiting = reg && reg.waiting;
    let reloading = false;
    const reload = () => {
      if (reloading) return;
      reloading = true;
      ui.set(100, '새 버전으로 다시 여는 중…');
      setTimeout(() => location.reload(), 300);
    };
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else reload();
    setTimeout(() => { if (!reloading) ui.set(70, '새 버전으로 바꾸는 중…'); }, 400);
    setTimeout(reload, 5000);   // controllerchange 가 오지 않아도 멈추지 않게
    return;
  }

  if (!window.__TAURI__.event) {
    ui.fail('이 환경에서는 자동 업데이트를 쓸 수 없습니다');
    return;
  }

  window.__TAURI__.event.listen('tip://update-progress', (event) => {
    const payload = event.payload || {};
    const stage = UPDATE_STAGES[payload.stage] || '업데이트 중';
    const percent = payload.percent;
    ui.set(percent == null ? 0 : percent, percent == null ? stage : `${stage} ${Math.round(percent)}%`);
  });

  try {
    ui.set(0, '내려받는 중 0%');
    await invokeTauri('install_app_update_and_restart', { url: info.url });
    ui.set(100, '앱을 다시 시작하는 중…');
  } catch (error) {
    console.error('[TIP update]', error);
    ui.fail(typeof error === 'string' ? error : '업데이트를 마치지 못했습니다');
  }
}

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
  sheetView = 'main';
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

    // 하위 메뉴 — 반원 퀵바 순서(방식 + 사용자 지정 목록).
    if (sheetView === 'quickbar') {
      quickbarScreen(render).forEach((node) => panel.append(node));
      return;
    }

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

    // Mac 앱 — 메뉴 막대 아이콘 표시 여부.
    if (TAURI) panel.append(menuBarSection());

    // Mac 앱 — 노치 아일랜드(자체 + 위젯별 ON/OFF)와 전역 빠른 실행 검색.
    if (TAURI) {
      panel.append(notchSection(render));
      panel.append(searchSection(render));
    }

    // 앱 업데이트 — 현재 버전과 확인 버튼(v1.10.0).
    panel.append(updateSection());

    // 반원 퀵바 순서 — 하위 메뉴로 들어가는 한 줄 메뉴(지금 방식이 오른쪽에 보인다).
    panel.append(quickbarMenuRow());

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

  sheetRender = render;
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

if ('serviceWorker' in navigator && !TAURI) {
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

/* ------------------------- Mac 앱(메뉴 막대) 연동 ------------------------- */

// 반원 퀵바에서 모듈을 고르면 이 창을 그 모듈로 바로 띄운다.
if (TAURI && window.__TAURI__.event) {
  window.__TAURI__.event.listen('tip://open-module', (event) => {
    const id = event.payload;
    const mod = getModule(id);
    if (!mod) return;
    if (moduleState(mod).enabled) location.hash = `#/${id}`;
    else toast(`${mod.name}이(가) 사용 중지되어 있습니다. 스위치로 켠 뒤 실행하세요.`);
  });
  window.__TAURI__.event.listen('tip://open-home', () => { location.hash = '#/'; });

  // 반원 퀵바의 ⚙ 버튼 — 창이 이미 떠 있어도 설정 시트를 앞으로 꺼낸다.
  window.__TAURI__.event.listen('tip://open-settings', () => openSheet());

  // 창이 뜨기 전에 누른 요청은 Rust 쪽에 남아 있다가 여기서 한 번 꺼낸다.
  // (컴팩트 도구 창은 주인공이 아니므로 꺼내지 않는다 — 메인 창이 가져간다.)
  const isToolWindow = new URLSearchParams(location.search).has('module');
  if (!isToolWindow && window.__TAURI__.core) {
    window.__TAURI__.core.invoke('take_pending_settings')
      .then((pending) => { if (pending) openSheet(); })
      .catch((error) => console.warn('[TIP] pending settings:', error));

    // 저장해 둔 '메뉴 막대에 표시' 값을 앱이 켜질 때 트레이에 반영한다.
    window.__TAURI__.core.invoke('set_tray_visible', { visible: getMenuBarVisible() })
      .catch((error) => console.warn('[TIP] tray visible:', error));

    // 노치 아일랜드 사용 여부와 빠른 실행 단축키도 저장값을 Rust 에 밀어 준다(v1.12.0).
    if (getNotchSettings().enabled) {
      window.__TAURI__.core.invoke('set_notch_enabled', { enabled: true })
        .catch((error) => console.warn('[TIP] notch:', error));
    }
    window.__TAURI__.core.invoke('set_search_shortcut', { accelerator: getSearchShortcut() })
      .catch((error) => console.warn('[TIP] search shortcut:', error));
  }
}

/* -------------------------------- boot --------------------------------- */

// 퀵바의 ⚙ 버튼이 브라우저에서 연 창은 index.html?settings=1 — 설정 시트부터 연다.
// (Mac 앱은 Tauri 이벤트로 열어 화면 상태를 그대로 둔다. 주소에 남은 파라미터는 지운다.)
const bootParams = new URLSearchParams(location.search);
const wantsSettings = bootParams.get('settings') === '1';
if (wantsSettings) {
  bootParams.delete('settings');
  const rest = bootParams.toString();
  try {
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  } catch { /* 주소만 못 바꿔도 시트는 연다 */ }
}

// 컴팩트 창은 index.html?module=<id> 로 열린다 — 그 모듈 화면에서 시작한다.
const deepId = bootParams.get('module');
const deepMod = deepId ? getModule(deepId) : null;
if (deepMod && moduleState(deepMod).enabled) {
  try { history.replaceState(null, '', `#/${deepMod.id}`); } catch { /* 해시만 못 바꿔도 동작에는 지장이 없다 */ }
}

route();
if (wantsSettings) openSheet();
