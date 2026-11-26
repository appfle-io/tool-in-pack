/* TIP app shell — hash routing, home hub, theme, PWA install/SW plumbing. */

import { listModules, getModule, visibleCategories, categoryOf } from '../modules/registry.js';
import {
  moduleState, setModuleState, getTheme, setTheme, applyTheme, getAccent, setAccent, ACCENTS,
  getSectionOrder, setSectionOrder, hasSectionOrder, resetSectionOrder, resetRadialOrder,
  getMenuBarVisible, setMenuBarVisible, getRadialOrderMode, setRadialOrderMode,
  getQuickbarOpacity, setQuickbarOpacity, QUICKBAR_OPACITY_MIN, QUICKBAR_OPACITY_MAX,
  QUICKBAR_OPACITY_DEFAULT, getNotchSettings, setNotchEnabled, setNotchWidget, NOTCH_WIDGETS,
  setNotchHoverOpen, setNotchStartView, setNotchRotation, setNotchPillActivity,
  getSearchShortcut, setSearchShortcut, SEARCH_SHORTCUT_DEFAULT,
} from './store.js';
import { quickOrderIds, customQuickOrderIds, saveQuickOrder } from './quickbar.js';
import {
  SEARCH_SCOPE_ITEMS, getSearchScope, setSearchScope, getShortcut, setShortcut, clearShortcut,
  syncShortcuts, actionsFor, valuesFor, getFeatureValue, setFeatureValue,
  getSystemCommandEnabled, setSystemCommandEnabled, syncSystemCommands,
  getShortcutPrefix, setShortcutPrefix, SHORTCUT_PREFIXES, DEFAULT_PREFIX,
  setShortcutLetter, validShortcutLetter, letterForCode, getShortcutLetters, getShortcutExtras,
  applyModuleValues, filesNoticePending, markFilesNoticeShown, NOTCH_TOGGLE_KEY, NOTCH_TOGGLE_LETTER,
} from './feature-settings.js';
import { listSnippets } from './snippets.js';
import { tickTimer, alertTimerDone, timerState } from './timer-store.js';
import { recordRecent, recentIds, getRecentEnabled, setRecentEnabled, clearRecent } from './recent.js';
import { takeContinue } from './continue.js';
import {
  collectBackup, backupFileName, readBackup, describeBackup, applyBackup,
} from './backup.js';
// v1.22.0 — 설정 → 권한 탭의 마이크 상태·권한 요청
import { voiceMicStatus, voiceMicRequest } from './voice.js';
import { el, toast, icons, confirmDialog } from './ui.js';

/* Mac 앱(Tauri) 안에서 실행 중인지 — 메뉴 막대 퀵바와 창을 주고받는 데 쓴다. */
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

const view = document.getElementById('view');

/* ------------------------------ home hub ------------------------------ */

/* v1.15.3 — 홈 편집 모드.
 * 카드는 기본적으로 '누르면 실행' 하나만 남기고, 순서 핸들·고정·켜기/끄기는
 * 상단 [편집] 을 눌렀을 때만 보인다. 모드를 나가면 다시 실행만 남는다. */
let homeEditing = false;

function renderHome() {
  view.innerHTML = '';

  const mods = listModules().map((mod) => ({ mod, state: moduleState(mod) }));

  // 꺼진 모듈은 원래 묶음에서 빼고 맨 아래 '꺼진 모듈' 한 곳에 모은다.
  const enabled = mods.filter(({ state }) => state.enabled);
  const off = mods.filter(({ state }) => !state.enabled);

  const pinned = ordered(enabled.filter(({ state }) => state.pinned), 'pinned');
  const rest = enabled.filter(({ state }) => !state.pinned);

  const sections = el('div', { class: `home-sections${homeEditing ? ' is-editing' : ''}` });

  // 고정된 모듈이 있을 때만 맨 위에 '고정됨' 섹션을 만든다.
  if (pinned.length) sections.append(homeSection('pinned', '고정됨', pinned, true));

  // v1.16.0 — '고정됨' 아래 '최근 사용' 줄. 이미 고정된 모듈은 빼고 최대 6개.
  // 설정에서 끄거나 [기록 지우기]를 누르면 이 줄이 사라진다.
  if (getRecentEnabled()) {
    const recent = recentIds(6)
      .map((id) => enabled.find(({ mod }) => mod.id === id))
      .filter((entry) => entry && !entry.state.pinned);
    if (recent.length) sections.append(homeSection('recent', '최근 사용', recent, false, false));
  }

  // 나머지는 registry 의 CATEGORIES 순서(문서·글 → 사진·영상 → 파일 → 계산·조회 → 개발·디자인 → Mac 화면 도구)대로 묶는다.
  // 웹(PWA)에는 'Mac 화면 도구' 섹션이 아예 나오지 않는다(visibleCategories).
  visibleCategories().forEach(({ id, label }) => {
    const entries = ordered(rest.filter(({ mod }) => categoryOf(mod) === id), id);
    if (entries.length) sections.append(homeSection(id, label, entries, true));
  });

  // 꺼진 모듈이 1개 이상일 때만 맨 아래에 모은다. 스위치를 켜면 원래 묶음으로 돌아간다.
  if (off.length) sections.append(homeSection('off', '꺼진 모듈', off));

  view.append(homeToolbar(), sections);
  syncEditButton();
}

/* ------------------- 홈 파일로 시작하기 · 끌어다 놓기 (v1.16.0) ------------------- */

/** 파일 종류별로 먼저 보여 줄 모듈 차례 — 레지스트리 순서와 별개로 추천 순서를 정한다. */
const DROP_PRIORITY = [
  'pdf-tools', 'doc-reader', 'img-converter', 'photo-privacy', 'ocr-reader', 'icon-gen',
  'video-gif', 'video-mosaic', 'text-diff', 'md-editor', 'text-counter', 'typing-converter',
  'bulk-rename', 'file-compress', 'color-tools', 'screenshot-annotate',
];

const EXT_TYPES = {
  pdf: 'application/pdf',
  hwp: 'application/x-hwp',
  hwpx: 'application/vnd.hancom.hwpx',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', avi: 'video/x-msvideo',
  zip: 'application/zip',
};

function fileTypeOf(file) {
  if (file.type) return file.type;
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  return EXT_TYPES[ext] || '';
}

function acceptsFile(mod, file) {
  const accepts = Array.isArray(mod.accepts) ? mod.accepts : [];
  if (!accepts.length) return false;
  const type = fileTypeOf(file);
  const ext = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
  return accepts.some((pattern) => {
    if (pattern === '*/*') return true;
    if (pattern.startsWith('.')) return ext === pattern;
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/** 이 파일들을 받을 수 있는 모듈 — 모든 파일을 받을 수 있어야 후보가 된다. */
function dropCandidates(files) {
  if (!files.length) return [];
  const enabled = listModules().filter((mod) => moduleState(mod).enabled);
  return enabled
    .filter((mod) => mod.accepts && mod.accepts.length)
    .filter((mod) => (mod.acceptsMultiOnly ? files.length > 1 : true))
    .filter((mod) => files.every((file) => acceptsFile(mod, file)))
    .sort((a, b) => {
      const ai = DROP_PRIORITY.indexOf(a.id);
      const bi = DROP_PRIORITY.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
}

function homeToolbar() {
  const input = el('input', { type: 'file', id: 'home-file-input', class: 'sr-only', multiple: true });
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.value = '';
    showDropChooser(files);
  });
  const button = el('button', {
    class: 'v16-btn home-file-start',
    type: 'button',
    text: '파일로 시작하기',
    'aria-label': '파일로 시작하기. 파일을 골라 맞는 도구를 찾습니다',
  });
  button.addEventListener('click', () => input.click());
  return el('div', { class: 'home-toolbar' }, [button, input]);
}

/** 끌어다 놓은 파일을 잠시 들고 있는 곳 — 어느 모듈을 고를 때까지. */
let droppedFiles = [];

function announceDrop(text) {
  const live = document.getElementById('drop-live');
  if (live) live.textContent = text;
}

function closeDropChooser() {
  document.querySelector('.drop-overlay')?.remove();
  droppedFiles = [];
}

/** 파일을 놓으면 받을 수 있는 모듈을 골라 준다. 없으면 이유를 알린다. */
function showDropChooser(files) {
  const list = (files || []).filter((file) => file && file.name);
  closeDropChooser();
  if (!list.length) return;
  droppedFiles = list;

  const candidates = dropCandidates(list);
  if (!candidates.length) {
    const message = '이 파일을 열 수 있는 도구가 없어요';
    toast(message, 3200);
    announceDrop(message);
    droppedFiles = [];
    return;
  }

  const panel = el('div', {
    class: 'drop-panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '파일로 무엇을 할까요',
  });
  const title = el('h2', { class: 'drop-title', text: '이 파일로 무엇을 할까요?' });
  const names = el('p', {
    class: 'drop-files',
    text: list.length > 1 ? `${list.length}개 파일: ${list.slice(0, 3).map((file) => file.name).join(', ')}${list.length > 3 ? ' 외' : ''}` : list[0].name,
  });
  const buttons = el('div', { class: 'drop-list' });

  candidates.forEach((mod) => {
    const button = el('button', { class: 'drop-item', type: 'button' }, [
      el('span', { class: 'drop-icon', html: mod.icon || '', 'aria-hidden': 'true' }),
      el('span', { class: 'drop-text' }, [
        el('b', { text: mod.name }),
        el('span', { text: mod.subtitle || '' }),
      ]),
      el('span', { class: 'sheet-menu-arrow', text: '›', 'aria-hidden': 'true' }),
    ]);
    button.addEventListener('click', () => {
      handoffFiles(mod.id, droppedFiles);
      closeDropChooser();
    });
    buttons.append(button);
  });

  const close = el('button', { class: 'v16-btn drop-close', type: 'button', text: '닫기' });
  close.addEventListener('click', closeDropChooser);
  panel.append(title, names, buttons, close);
  document.body.append(panel);
  announceDrop(`${list.length}개 파일을 받을 도구 ${candidates.length}개를 찾았습니다`);
  requestAnimationFrame(() => buttons.querySelector('button')?.focus({ preventScroll: true }));

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropChooser();
    }
  };
  document.addEventListener('keydown', onKey, true);
  const observer = new MutationObserver(() => {
    if (!document.body.contains(panel)) {
      document.removeEventListener('keydown', onKey, true);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

/** 고른 파일을 그 모듈로 넘기고 화면을 옮긴다 — 기기 안 localStorage 를 잠깐 거친다. */
async function handoffFiles(moduleId, files) {
  const MAX_TOTAL = 40 * 1024 * 1024;
  let total = 0;
  const entries = [];
  try {
    for (const file of files) {
      total += file.size;
      if (total > MAX_TOTAL) throw new Error('파일이 너무 큽니다');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('읽지 못함'));
        reader.readAsDataURL(file);
      });
      entries.push({ name: file.name, type: file.type || fileTypeOf(file), dataUrl });
    }
    localStorage.setItem('tip.handoff.v1', JSON.stringify({
      moduleId,
      files: entries,
      created: Date.now(),
    }));
  } catch (error) {
    console.error('[TIP drop]', error);
    toast(files.length > 1 ? '파일이 너무 커서 한 번에 넘기지 못했습니다' : '파일을 읽지 못했습니다');
    return;
  }
  location.hash = `#/${moduleId}`;
}

/* 홈에서 파일을 끌어다 놓으면 추천을 띄운다. 다른 화면에서는 모듈이 직접 받는다. */
function homeDropReady() {
  const hash = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/+$/, '');
  return !hash;
}

let dropDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (!homeDropReady() || !event.dataTransfer) return;
  if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
  event.preventDefault();
  dropDepth += 1;
  document.body.classList.add('is-file-drag');
});
document.addEventListener('dragover', (event) => {
  if (!homeDropReady() || !event.dataTransfer) return;
  if (!Array.from(event.dataTransfer.types || []).includes('Files')) return;
  event.preventDefault();
});
document.addEventListener('dragleave', () => {
  dropDepth = Math.max(0, dropDepth - 1);
  if (!dropDepth) document.body.classList.remove('is-file-drag');
});
document.addEventListener('drop', (event) => {
  document.body.classList.remove('is-file-drag');
  dropDepth = 0;
  if (!homeDropReady()) return;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  showDropChooser(files);
});

/** 저장된 순서(tip.order.v1)대로 정렬한다. 목록에 없는 모듈은 원래 순서대로 뒤에 붙는다(안정 정렬). */
function ordered(entries, sectionId) {
  const saved = getSectionOrder(sectionId);
  if (!saved.length) return entries;
  const rank = new Map(saved.map((id, index) => [id, index]));
  const place = ({ mod }) => (rank.has(mod.id) ? rank.get(mod.id) : Number.MAX_SAFE_INTEGER);
  return entries.slice().sort((a, b) => place(a) - place(b));
}

function homeSection(id, label, entries, sortable = false, showControls = true) {
  const list = el('div', { class: 'module-list' });
  entries.forEach(({ mod, state }) => list.append(moduleRow(mod, state, { sectionId: id, sortable, showControls })));
  return el('section', { class: 'home-section', 'data-section': id, 'aria-label': label }, [
    el('h2', { class: 'home-section-title' }, [
      el('span', { text: label }),
      el('span', { class: 'home-section-count', text: String(entries.length), 'aria-hidden': 'true' }),
    ]),
    list,
  ]);
}

function moduleRow(mod, state, { sectionId = null, sortable = false, showControls = true } = {}) {
  const row = el('article', {
    class: `module-card${state.enabled ? '' : ' is-off'}`,
    role: 'button',
    tabindex: '0',
    'aria-label': `${mod.name} 열기`,
    'data-module-id': mod.id,
  });

  // 카드 자체는 '누르면 실행'. 편집 중에는 실행하지 않는다(오른쪽 > 로 실행).
  const launch = () => {
    if (moduleState(mod).enabled) location.hash = `#/${mod.id}`;
    else toast(`${mod.name}이(가) 사용 중지되어 있습니다. 편집에서 스위치를 켠 뒤 실행하세요.`);
  };
  const open = () => {
    if (homeEditing) return;
    launch();
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
    'aria-label': `${mod.name} ${state.pinned ? '상단 고정 해제' : '상단 고정'}`,
    'data-module-id': mod.id,
    'data-control': 'pin',
    // v1.15.4 — 고정된 것(채운 핀)과 아닌 것(선 핀)은 모양부터 다르게.
    html: state.pinned ? icons.pin : icons.pinOutline,
  });
  pinBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = !moduleState(mod).pinned;
    setModuleState(mod.id, { pinned: next });
    rerenderHome({ id: mod.id, control: 'pin' });
    toast(next ? '상단에 고정했습니다' : '고정을 해제했습니다');
  });

  const openBtn = el('button', {
    class: 'open-btn module-open',
    type: 'button',
    // v1.12.4 — '실행' 글자 버튼 대신 > 아이콘. 읽어 주는 이름은 그대로 둔다.
    'aria-label': state.enabled ? `${mod.name} 실행` : `${mod.name} 사용 중지됨`,
    title: state.enabled ? `${mod.name} 실행` : '사용 중지된 모듈입니다',
    'aria-disabled': String(!state.enabled),
    html: icons.right,
  });
  openBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    launch();
  });

  if (sortable && homeEditing) {
    row.classList.add('has-drag');
    row.append(dragHandle(row, mod, sectionId));
  }

  row.append(
    el('div', { class: 'module-icon', html: mod.icon }),
    el('div', { class: 'module-title' }, [
      el('h2', {}, [
        el('span', { class: 'module-name', text: mod.name }),
        mod.badge ? el('span', { class: 'mac-badge', text: mod.badge, title: 'Mac 앱 전용 기능' }) : null,
      ]),
      el('p', { text: mod.subtitle }),
    ]),
  );
  // v1.16.0 — '최근 사용' 줄은 실행만 한다(같은 모듈의 핀·켜기가 두 번 보이지 않게).
  // append 에 null 을 넘기면 'null' 글자가 붙으므로 조건이 참일 때만 붙인다.
  // 최근 사용 줄에도 오른쪽 화살표는 둔다(카드를 눌러도 열리지만 모양을 맞춘다).
  row.append(el('div', { class: 'module-controls' }, showControls ? [pinBtn, toggle, openBtn] : [openBtn]));

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

/* ------------------------- 홈 편집 버튼 (v1.15.3) ------------------------- */

const editBtn = document.getElementById('edit-btn');

/** 홈에서만 [편집] 을 보인다. 모듈 화면에서는 숨기고, 편집 상태면 '완료' 로 바뀐다. */
function syncEditButton() {
  if (!editBtn) return;
  const hash = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/+$/, '');
  editBtn.hidden = !!hash;
  editBtn.textContent = homeEditing ? '완료' : '편집';
  editBtn.setAttribute('aria-pressed', String(homeEditing));
  editBtn.setAttribute('aria-label', homeEditing ? '편집 마치기' : '홈 카드 편집');
}

if (editBtn) {
  editBtn.addEventListener('click', () => {
    homeEditing = !homeEditing;
    renderHome();
    if (!homeEditing) {
      toast('편집을 마쳤습니다');
      return;
    }
    toast('편집 모드입니다. 카드를 끌어 순서를 바꾸고, 고정과 켜기를 정하세요', 3200);
    view.querySelector('.module-card .drag-handle')?.focus({ preventScroll: true });
  });
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
    title: '끌거나 화살표 키로 순서 바꾸기',
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

function renderModule(mod, intent = null) {
  if (activeCleanup) {
    try { activeCleanup(); } catch { /* keep going */ }
    activeCleanup = null;
  }
  view.innerHTML = '';
  // v1.16.0 — 최근 사용에 남긴다(홈 '최근 사용' 줄).
  recordRecent(mod.id);

  const back = el('button', { class: 'back-btn', type: 'button', 'aria-label': '뒤로', html: icons.back });
  back.addEventListener('click', () => { location.hash = '#/'; });

  const bar = el('div', { class: 'screen-bar' }, [
    back,
    el('div', { class: 'screen-title' }, [
      el('h1', { text: mod.name }),
      el('p', { text: mod.subtitle }),
    ]),
  ]);

  // v1.14.0 — 이 모듈만의 설정(전역 단축키·세부 옵션)으로 바로 가는 ⚙.
  if (TAURI) {
    const gear = el('button', {
      class: 'icon-ghost-btn screen-gear',
      type: 'button',
      'aria-label': `${mod.name} 설정`,
      title: '이 모듈의 단축키와 세부 옵션 설정',
      html: icons.gear || '',
    });
    gear.addEventListener('click', () => openSheet('modules', mod.id));
    bar.append(gear);
  }

  const root = el('section', { class: 'module-screen', 'aria-label': mod.name });
  view.append(bar, root);
  view.focus({ preventScroll: false });
  window.scrollTo(0, 0);

  activeCleanup = mod.mount(root, {
    goHome: () => { location.hash = '#/'; },
    goModule: (id) => { location.hash = `#/${id}`; },
    openSettings: (moduleId) => openSheet('modules', moduleId || mod.id),
    // v1.16.0 — 주소(#/drag-ocr)나 홈 빠른 실행이 알려 주는 시작 방식.
    intent,
    // v1.16.0 — 앞 모듈의 결과를 한 번 꺼낸다(저장소에 남기지 않음).
    takeContinue: () => takeContinue(mod.id),
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
  if (!handoff || handoff.moduleId !== mod.id) return;
  // v1.16.0 — 여러 파일(파일 이름 변경·압축)도 한 번에 넘긴다.
  const entries = Array.isArray(handoff.files)
    ? handoff.files
    : (handoff.dataUrl ? [{ name: handoff.name, type: handoff.type, dataUrl: handoff.dataUrl }] : []);
  if (!entries.length) return;
  const age = Date.now() - Number(handoff.created || 0);
  try { localStorage.removeItem(HANDOFF_KEY); } catch { /* 지우지 못해도 한 번은 넘긴다 */ }
  if (age > 5 * 60 * 1000) return;

  Promise.all(entries.map((entry) => fetch(entry.dataUrl)
    .then((response) => response.blob())
    .then((blob) => new File([blob], entry.name || 'file', { type: entry.type || blob.type }))))
    .then((files) => {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      root.dispatchEvent(new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: transfer,
      }));
      toast(files.length > 1 ? `${files.length}개 파일을 불러왔습니다` : `${files[0].name}을(를) 불러왔습니다`);
    })
    .catch((error) => {
      console.error('[TIP handoff]', error);
      toast('보낸 파일을 불러오지 못했습니다');
    });
}

/* -------------------------------- router ------------------------------- */

function route() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!raw) {
    renderHome();
    return;
  }
  // 모듈 화면으로 가면 편집 모드를 끝낸다.
  homeEditing = false;
  // v1.16.0 — 예전 드래그 OCR 주소는 통합 OCR 의 '화면에서'로 보낸다(단축키·북마크 호환).
  const hash = raw === 'drag-ocr' ? 'ocr-reader' : raw;
  const intent = raw === 'drag-ocr' ? { mode: 'screen' } : null;
  const mod = getModule(hash);
  if (mod && moduleState(mod).enabled) {
    renderModule(mod, intent);
  } else {
    renderHome();
    if (mod) toast(`${mod.name}이(가) 사용 중지되어 있습니다. 편집에서 스위치를 켠 뒤 실행하세요.`);
  }
  syncEditButton();
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

/* v1.15.5 — 미리보기 색은 css/app.css 의 실제 --accent 값과 같아야 한다(초록 다크 포함).
   12조합(6색 × 라이트/다크) 모두 채움 위 흰 글자가 4.5:1 이상이다. */
const SWATCH_COLORS = {
  green: ['#2E5E4E', '#3F7D68'],
  blue: ['#0A6CFF', '#2563EB'],
  purple: ['#7C3AED', '#7C3AED'],
  orange: ['#C2410C', '#C2410C'],
  rose: ['#E11D48', '#E11D48'],
  slate: ['#475569', '#64748B'],
};

/* ------------------- 반원 퀵바 순서 — 하위 메뉴 (v1.10.0) ------------------- */

// v1.14.0 — 설정을 네 탭으로 나눈다. 일반 / 노치 / 검색(Spotlight) / 모듈.
// 'quickbar' 는 노치 탭에서 들어가는 하위 화면(반원 퀵바 순서).
let sheetTab = 'general';      // 'general' | 'notch' | 'search' | 'modules' | 'quickbar'
let sheetModule = null;        // 모듈 탭에서 고른 모듈 id
let sheetRender = null;        // openSheet() 가 만든 render — 하위 화면에서 다시 그릴 때 쓴다
let moduleQuery = '';          // 모듈 탭 검색어(v1.15.1)
let moduleFilterShortcuts = false; // 모듈 탭 '단축키 있음만' 필터(v1.15.1)

const RADIAL_MODE_LABELS = { asc: '오름차순', desc: '내림차순', custom: '사용자 지정' };

const RADIAL_MODE_OPTIONS = [
  { id: 'asc', label: '오름차순', hint: '모듈 이름을 가나다순이나 알파벳순으로' },
  { id: 'desc', label: '내림차순', hint: '이름 역순' },
  { id: 'custom', label: '사용자 지정', hint: '직접 끌어서 정한 순서' },
];

/** 하위 메뉴 — 방식 선택 + (사용자 지정일 때만) 순서 편집 목록. */
function quickbarScreen(rerenderSheet) {
  const mode = getRadialOrderMode();

  const back = el('button', { class: 'sheet-back', type: 'button', 'aria-label': '설정으로 돌아가기' }, [
    el('span', { class: 'sheet-back-icon', html: icons.back, 'aria-hidden': 'true' }),
    el('span', { text: '설정' }),
  ]);
  back.addEventListener('click', () => {
    sheetTab = 'notch';
    rerenderSheet();
  });

  const head = el('div', { class: 'sheet-head sheet-head-sub' }, [
    back,
    el('h2', { text: '모듈 순서' }),
    el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': '닫기',
      html: icons.close,
      onclick: closeSheet,
    }),
  ]);
  const options = el('div', { class: 'mode-list', role: 'radiogroup', 'aria-label': '모듈 순서 방식' });
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

  const parts = [el('div', { class: 'sheet-section' }, options)];

  if (mode === 'custom') {
    parts.push(quickbarList(rerenderSheet));
  } else {
    parts.push(el('p', {
      class: 'qb-note mode-note',
      text: '지금은 이름순으로 보입니다. 직접 정해 둔 순서는 그대로 남아 있고, 사용자 지정을 고르면 다시 적용됩니다.',
    }));
  }

  return { head, parts };
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
    toast('모듈 순서를 저장했습니다');
  };

  mods.forEach((mod) => list.append(quickbarRow(mod, save)));
  refreshQuickbarButtons(list);

  return el('div', { class: 'sheet-section qb-section' }, [
    el('p', { class: 'qb-note', text: '위에서부터 반원과 켜 둔 모듈 줄의 왼쪽에서 오른쪽 순서입니다. 끌어서 바꾸세요.' }),
    list,
    el('button', {
      class: 'sheet-reset',
      type: 'button',
      text: '메인 순서 따르기',
      onclick: () => {
        resetRadialOrder();
        rerenderSheet();
        toast('모듈 순서를 메인 화면 순서로 되돌렸습니다');
      },
    }),
  ]);
}

function quickbarRow(mod, save) {
  const row = el('div', { class: 'qb-row', role: 'listitem', 'data-module-id': mod.id });

  const handle = el('button', {
    class: 'qb-handle',
    type: 'button',
    'aria-label': `${mod.name} 순서 바꾸기`,
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
    el('span', { class: 'qb-name', text: mod.name }),
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
const APP_VERSION = '1.22.0';

let updateBusy = false;

function invokeTauri(command, args) {
  return window.__TAURI__.core.invoke(command, args || {});
}

/** Mac 앱 — 상단 메뉴 막대 아이콘과 반원 배경(v1.15.1 → v1.17.0).
 *  v1.17.0 — 반원 퀵바 창이 노치 안으로 들어가면서 '모듈 순서'는 노치 묶음(모듈 회전 방식 아래)으로
 *  옮겼다. 여기에는 메뉴 막대 아이콘과 판 배경 불투명도만 남는다. */
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
      text: '메뉴 막대 TIP 아이콘을 누르면 노치가 열립니다. 끄면 Dock 아이콘으로만 열 수 있습니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label', text: '메뉴 막대에 표시' }),
      toggle,
    ]),
    quickbarOpacityRow(),
  ]);
}

/** 반원 배경 불투명도 — 70~100%, 기본 92%. (v1.11.0 → v1.17.0)
 *  값은 tip.quickbarOpacity.v1 에 저장한다(키 이름은 그대로). 노치의 반원과 전체 보기가 같은 판이라
 *  둘 다 이 값을 쓰고, 저장하면 열려 있는 노치에도 바로 알린다(store.js notifyWindows). */
function quickbarOpacityRow() {
  const readout = el('span', { class: 'op-value', text: `${getQuickbarOpacity()}%` });
  const range = el('input', {
    class: 'op-range',
    type: 'range',
    min: String(QUICKBAR_OPACITY_MIN),
    max: String(QUICKBAR_OPACITY_MAX),
    step: '1',
    value: String(getQuickbarOpacity()),
    'aria-label': '반원 배경 불투명도',
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
      el('span', { class: 'op-label', text: '반원 배경 불투명도' }),
      readout,
    ]),
    range,
    el('p', { class: 'op-note', text: '노치 반원과 전체 보기 배경에 함께 적용됩니다. 70%보다 낮추면 바탕화면이 비쳐 글자가 흐려져서 70%까지만 내려갑니다.' }),
  ]);
}

/* ------------------- 노치 아일랜드 설정 (v1.12.0) ------------------- */

/** Mac 앱 — 노치 아일랜드 자체(사용·마우스로 열기). (v1.12.0 → v1.17.0)
 *  v1.17.0 — 시작 화면·회전 방식·모듈 순서·닫힌 노치 표시·위젯은 아래 묶음으로 나눴다.
 *  노치 아일랜드를 꺼도 메뉴 막대 아이콘으로 노치를 열 수 있으므로 나머지 설정은 늘 바꿀 수 있다. */
function notchSection(rerenderSheet) {
  const notch = getNotchSettings();

  const master = el('button', {
    class: 'switch',
    type: 'button',
    'aria-pressed': String(notch.enabled),
    'aria-label': '노치 아일랜드 사용',
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

  const hover = notch.hoverOpen === true;
  const hoverToggle = el('button', {
    class: 'switch',
    type: 'button',
    'aria-pressed': String(hover),
    'aria-label': '마우스를 올려서 열기',
    disabled: !notch.enabled,
  }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));

  hoverToggle.addEventListener('click', () => {
    const next = !getNotchSettings().hoverOpen;
    setNotchHoverOpen(next);
    hoverToggle.setAttribute('aria-pressed', String(next));
    // v1.12.4 — Rust 의 커서 감시를 같이 켜고 끈다(WKWebView 는 다른 앱 사용 중 hover 를 못 받는다).
    invokeTauri('set_notch_hover', { enabled: next })
      .catch((error) => console.warn('[TIP] notch hover:', error));
    toast(next ? '마우스를 올리면 노치가 펼쳐집니다' : '노치를 클릭할 때만 펼쳐집니다');
  });

  return el('div', { class: 'sheet-section mb-section notch-section' }, [
    el('h3', { text: '노치 아일랜드' }),
    el('p', {
      class: 'mb-note',
      text: '켜면 화면 위 가운데에 TIP 알약이 늘 붙어 있습니다. 꺼도 메뉴 막대 아이콘으로 열 수 있습니다. 미디어, 캘린더, 웹캠 거울은 켤 때만 접근 권한을 묻습니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label', text: '노치 아일랜드 사용' }),
      master,
    ]),
    el('div', { class: `mb-row notch-row${notch.enabled ? '' : ' is-off'}` }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '마우스를 올려서 열기' }),
        el('i', { class: 'notch-hint', text: '끄면(기본) 알약을 클릭할 때만 펼쳐집니다. 마우스로 열었을 때는 키보드 입력을 가져가지 않습니다.' }),
      ]),
      hoverToggle,
    ]),
  ]);
}

/** ② 노치 숨기기/보이기 단축키 — 모듈 단축키와 같은 공통 조합 + 한 글자, 기본 H(v1.17.2).
 *  단축키 표의 주인은 저장소(feature-settings.js)이고, Rust 는 등록만 한다. 누르면 Rust 가
 *  노치를 숨기고/보이고, 바뀐 값을 tip://notch-enabled 로 이 창에 알린다(아래 시작부 리스너). */
function notchShortcutSection(render) {
  const letter = getShortcutLetters()[NOTCH_TOGGLE_KEY] || '';
  return el('div', { class: 'sheet-section mb-section notch-shortcut-section' }, [
    el('h3', { text: '노치 숨기기 단축키' }),
    el('p', {
      class: 'mb-note',
      text: `모듈 단축키와 같은 공통 조합(${prettyShortcut(getShortcutPrefix())}) + 한 글자입니다. 누를 때마다 노치가 숨고 다시 나타납니다. 기본은 ${NOTCH_TOGGLE_LETTER} 입니다.`,
    }),
    shortcutRow({
      key: NOTCH_TOGGLE_KEY,
      label: '노치 숨기기/보이기',
      hint: letter
        ? '숨기면 알약과 판이 사라지고, 다시 누르면 숨기기 전 상태로 돌아옵니다.'
        : '아직 글자가 없습니다. 한 글자를 정해 주세요. 전역 검색 단축키(⌥Space)는 [검색] 탭에서 따로 정합니다.',
    }, render),
  ]);
}

/** 라디오 묶음 — 모듈 순서 화면의 .mode-row 모양을 그대로 쓴다(v1.17.0). */
function notchChoiceGroup({ label, options, value, onPick }) {
  const group = el('div', { class: 'mode-list', role: 'radiogroup', 'aria-label': label });
  options.forEach(({ id, label: text, hint }) => {
    const on = value === id;
    const row = el('button', {
      class: `mode-row${on ? ' is-on' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(on),
      'data-choice': id,
    }, [
      el('span', { class: 'mode-text' }, [
        el('b', { text }),
        el('span', { class: 'mode-hint', text: hint }),
      ]),
      el('span', { class: 'mode-mark', 'aria-hidden': 'true' }),
    ]);
    row.addEventListener('click', () => onPick(id));
    group.append(row);
  });
  return group;
}

/** ② 노치 시작 화면 — 열 때 처음 보이는 화면(v1.17.0). */
function notchStartViewSection(rerenderSheet) {
  return el('div', { class: 'sheet-section mb-section notch-start-section' }, [
    el('h3', { text: '시작 화면' }),
    el('p', { class: 'mb-note', text: '노치를 열 때 처음 보이는 화면입니다. 열린 뒤에는 아래 버튼으로 언제든 바꿀 수 있습니다.' }),
    notchChoiceGroup({
      label: '노치 시작 화면',
      value: getNotchSettings().startView,
      options: [
        { id: 'simple', label: '간단히 보기', hint: '반원에서 모듈을 돌려 고릅니다' },
        { id: 'full', label: '전체 보기', hint: '음악, 일정, 타이머, 메모, 보관함을 한 번에 봅니다' },
      ],
      onPick: (id) => {
        if (getNotchSettings().startView === id) return;
        setNotchStartView(id);
        toast(id === 'simple' ? '노치를 간단히 보기로 엽니다' : '노치를 전체 보기로 엽니다');
        rerenderSheet();
      },
    }),
  ]);
}

/** ③ 모듈 회전 방식 + ④ 모듈 순서 — 반원과 전체 보기의 '켜 둔 모듈'에 똑같이(v1.17.0). */
function notchRotationSection(rerenderSheet) {
  const mode = getRadialOrderMode();
  const orderRow = el('button', {
    class: 'sheet-menu',
    type: 'button',
    'aria-label': `모듈 순서 (지금: ${RADIAL_MODE_LABELS[mode]}) 설정 열기`,
  }, [
    el('span', { class: 'sheet-menu-label', text: '모듈 순서' }),
    el('span', { class: 'sheet-menu-value', text: RADIAL_MODE_LABELS[mode] }),
    el('span', { class: 'sheet-menu-arrow', text: '›', 'aria-hidden': 'true' }),
  ]);
  orderRow.addEventListener('click', () => {
    sheetTab = 'quickbar';
    if (sheetRender) sheetRender();
  });

  return el('div', { class: 'sheet-section mb-section notch-rotation-section' }, [
    el('h3', { text: '모듈 회전 방식' }),
    // v1.17.2 — 전체 보기의 '켜 둔 모듈' 한 줄은 양 끝이 있는 가로 스크롤이라 회전이 적용되지 않는다.
    el('p', { class: 'mb-note', text: '간단히 보기(반원) 다이얼에 적용됩니다. 전체 보기의 켜 둔 모듈 한 줄은 옆으로 이어 스크롤합니다.' }),
    notchChoiceGroup({
      label: '모듈 회전 방식',
      value: getNotchSettings().rotation,
      options: [
        { id: 'loop', label: '계속 회전', hint: '마지막 다음에 처음이 이어집니다' },
        { id: 'bounded', label: '처음과 끝에서 멈춤', hint: '양 끝에서 멈춥니다' },
      ],
      onPick: (id) => {
        if (getNotchSettings().rotation === id) return;
        setNotchRotation(id);
        toast(id === 'loop' ? '모듈을 계속 회전합니다' : '처음과 끝에서 멈춥니다');
        rerenderSheet();
      },
    }),
    orderRow,
  ]);
}

/** ⑤ 닫힌 노치 표시 — 알약에 이퀄라이저·남은 시간(v1.17.0). */
function notchPillSection() {
  return el('div', { class: 'sheet-section mb-section notch-pill-section' }, [
    el('h3', { text: '닫힌 노치 표시' }),
    el('div', { class: 'mb-row notch-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '노래와 타이머 표시' }),
        el('i', { class: 'notch-hint', text: '노치가 닫혀 있어도 노래가 나오면 이퀄라이저, 타이머가 돌면 남은 시간을 보여 줍니다.' }),
      ]),
      sheetSwitch(getNotchSettings().pillActivity, '노래와 타이머 표시', (next) => {
        setNotchPillActivity(next);
        toast(next ? '닫힌 노치에 노래와 타이머를 표시합니다' : '닫힌 노치에는 TIP만 표시합니다');
      }),
    ]),
  ]);
}

/** ⑥ 위젯 — 켜고 끄기. hint 에 반원/전체 보기 중 어디에 나오는지 적는다(store.js NOTCH_WIDGETS).
 *  v1.17.0 — 노치 아일랜드를 꺼도 메뉴 막대로 여는 노치에 적용되므로 잠그지 않는다. */
function notchWidgetSection(rerenderSheet) {
  const notch = getNotchSettings();
  const rows = NOTCH_WIDGETS.map(({ id, label, hint }) => {
    const toggle = sheetSwitch(notch.widgets[id], label, (next) => {
      setNotchWidget(id, next);
      toast(next ? `${label} 위젯을 표시합니다` : `${label} 위젯을 숨깁니다`);
      // v1.15.1 — 캘린더 위젯을 켜고 끄면 아래 '캘린더 표시 필터'의 쓸 수 있음이 바뀐다.
      if (rerenderSheet) rerenderSheet();
    });
    return el('div', { class: 'mb-row notch-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: label }),
        el('i', { class: 'notch-hint', text: hint }),
      ]),
      toggle,
    ]);
  });
  return el('div', { class: 'sheet-section mb-section notch-widget-section' }, [
    el('h3', { text: '위젯' }),
    el('p', { class: 'mb-note', text: '반원의 다이얼은 위젯과 상관없이 늘 보입니다.' }),
    ...rows,
  ]);
}

/* ------------------- macOS 권한 설정 (v1.12.3) ------------------- */

/** 개인정보 보호 항목 — Rust 커맨드 open_privacy_settings 가 이 세 가지만 연다. */
const PRIVACY_ITEMS = [
  {
    kind: 'automation',
    label: '자동화 (음악)',
    hint: 'Apple Music 이나 Spotify 의 재생 정보를 읽고 재생을 바꿀 때 필요합니다. 캘린더는 아래 캘린더 권한만 씁니다.',
  },
  {
    kind: 'calendars',
    label: '캘린더',
    hint: '노치의 오늘 일정을 읽을 때 필요합니다(EventKit). 처음 물을 때 거부했다면 여기서 직접 켜야 합니다.',
  },
  {
    kind: 'camera',
    label: '카메라',
    hint: '노치의 웹캠 거울이 카메라를 쓸 때 필요합니다.',
  },
];

/** Mac 앱 — macOS 시스템 설정의 개인정보 보호 항목을 바로 여는 그룹. */
function permissionSection() {
  const rows = PRIVACY_ITEMS.map(({ kind, label, hint }) => {
    const btn = el('button', {
      class: 'primary-btn ghost perm-open',
      type: 'button',
      text: '시스템 설정 열기',
    });
    btn.addEventListener('click', async () => {
      try {
        await invokeTauri('open_privacy_settings', { kind });
        toast(`시스템 설정의 '${label}' 항목을 열었습니다`);
      } catch (error) {
        console.error('[TIP permission]', error);
        toast('시스템 설정을 열지 못했습니다');
      }
    });

    return el('div', { class: 'mb-row perm-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: label }),
        el('i', { class: 'notch-hint', text: hint }),
      ]),
      btn,
    ]);
  });

  return el('div', { class: 'sheet-section mb-section perm-section' }, [
    el('h3', { text: 'macOS 권한 설정' }),
    el('p', {
      class: 'mb-note',
      text: 'macOS 가 개인정보 보호로 막는 기능이 있습니다. 버튼을 누르면 시스템 설정의 해당 항목이 바로 열립니다. 음악이나 캘린더가 동작하지 않으면 먼저 자동화를 확인하세요.',
    }),
    ...rows,
  ]);
}

/* v1.22.0 — 마이크 권한 — 녹음 모듈은 공증된 앱에서 Entitlements(audio-input)와
 * Info.plist(NSMicrophoneUsageDescription)가 있어야 권한 팝업이 뜬다. 상태는 Rust(AVCaptureDevice)가 알려 준다. */
function microphoneSection() {
  const stateEl = el('i', { class: 'notch-hint', text: '확인 중…' });
  const statusChip = el('kbd', { class: 'shortcut-chip perm-mic-chip', text: '확인 중' });

  const refresh = async () => {
    const status = await voiceMicStatus();
    const map = {
      authorized: ['허용됨', true],
      denied: ['거부됨', false],
      restricted: ['막혀 있음', false],
      notDetermined: ['아직 묻지 않음', false],
      unknown: ['확인하지 못함', false],
    };
    const [label, ok] = map[status.status] || map.unknown;
    statusChip.textContent = label;
    statusChip.classList.toggle('is-ok', !!ok);
    stateEl.textContent = status.label || '';
  };

  const ask = el('button', {
    class: 'primary-btn ghost perm-mic-ask',
    type: 'button',
    text: '권한 요청',
  });
  ask.addEventListener('click', async () => {
    ask.disabled = true;
    ask.textContent = '묻는 중…';
    await voiceMicRequest();
    setTimeout(async () => {
      await refresh();
      ask.disabled = false;
      ask.textContent = '권한 요청';
    }, 900);
  });

  const open = el('button', {
    class: 'primary-btn ghost perm-open',
    type: 'button',
    text: '시스템 설정 열기',
  });
  open.addEventListener('click', async () => {
    try {
      await invokeTauri('open_privacy_settings', { kind: 'microphone' });
      toast("시스템 설정의 '마이크' 항목을 열었습니다");
    } catch (error) {
      console.error('[TIP permission]', error);
      toast('시스템 설정을 열지 못했습니다');
    }
  });

  refresh();

  return el('div', { class: 'sheet-section mb-section perm-section perm-mic' }, [
    el('h3', { text: '마이크 (녹음)' }),
    el('p', {
      class: 'mb-note',
      text: '녹음 모듈이 소리를 담으려면 마이크 권한이 필요합니다. 처음 녹음할 때 macOS 가 묻고, 거부했다면 아래에서 다시 요청하거나 시스템 설정에서 TIP 을 켜 주세요.',
    }),
    el('div', { class: 'mb-row perm-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '마이크' }),
        stateEl,
      ]),
      el('span', { class: 'perm-actions' }, [statusChip, ask, open]),
    ]),
  ]);
}

/** 설정 → 권한 탭 — 마이크 상태와 macOS 개인정보 보호 항목을 한곳에. */
function permissionsTab() {
  return [
    el('p', {
      class: 'sheet-tab-note',
      text: 'macOS 가 개인정보 보호로 막는 기능의 상태를 보고, 필요한 권한을 바로 열거나 요청합니다.',
    }),
    microphoneSection(),
    permissionSection(),
  ];
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
  let onKey = null;

  const chip = el('kbd', { class: 'shortcut-chip', text: prettyShortcut(current) });
  const changeBtn = el('button', { class: 'primary-btn ghost shortcut-change', type: 'button', text: '변경' });
  const openBtn = el('button', { class: 'icon-btn shortcut-open', type: 'button', text: '열기' });

  // stop 은 클릭 핸들러 밖에서 만든다 — 핸들러 안에서 const 로 두면 '취소'로 다시 눌렀을 때
  // 첫 줄에서 stop 을 먼저 만져 TDZ 오류가 나고, 그 오류로 취소가 듣지 않는다.
  const stop = () => {
    capturing = false;
    if (onKey) document.removeEventListener('keydown', onKey, true);
    onKey = null;
    chip.textContent = prettyShortcut(getSearchShortcut());
    chip.classList.remove('is-capturing');
    changeBtn.textContent = '변경';
  };

  changeBtn.addEventListener('click', () => {
    // v1.15.0 — 예전에는 `if (capturing) return;` 이 먼저 있어, 버튼이 '취소'로 바뀠 뒤
    // 다시 누른 클릭을 그대로 무시했다(취소가 죽어 있었다). 캐처 중이면 취소로 동작한다.
    if (capturing) {
      stop();
      return;
    }
    capturing = true;
    chip.textContent = '새 단축키를 누르세요';
    chip.classList.add('is-capturing');
    changeBtn.textContent = '취소';
    onKey = async (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // window 의 "Esc 면 시트 닫기"까지 번지지 않게 여기서 멈춘다.
        event.stopPropagation();
        stop();
        return;
      }
      const accelerator = acceleratorOf(event);
      if (!accelerator) return;
      event.preventDefault();
      event.stopPropagation();
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
    CmdOrCtrl: mac ? '⌘' : 'Ctrl', Command: mac ? '⌘' : 'Ctrl', Control: mac ? '⌃' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt', Shift: mac ? '⇧' : 'Shift',
  };
  const keys = {
    Space: 'Space', Enter: 'Return', Backslash: '\\', Slash: '/', Comma: ',', Period: '.',
    Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
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
  verify: '해시를 확인하는 중',
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
    // v1.12.4 — 주소는 넘기지 않는다. Rust 가 check_app_update 에서 확인한 릴리스 자산만 설치한다.
    await invokeTauri('install_app_update_and_restart');
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

/* ------------------------- 설정 — 네 탭 (v1.14.0) ------------------------- */
//
// 유동규 님 지시: 설정이 어디를 바꾸는지 헷갈리지 않게 네 곳으로 나눈다.
//   일반  — 앱 공통(테마·색·시작·업데이트)
//   노치  — 화면 최상단 노치 아일랜드 + 메뉴 막대·반원 퀵바
//   검색  — 전역 검색(⌥Space) 전용(단축키·검색 대상·시스템 명령)
//   모듈  — 개별 도구(모듈별 전역 단축키 + 세부 옵션)
//
// v1.15.1 — 탭 줄은 시트 위쪽에 고정(sticky)하고, 탭·하위 화면을 바꿔도 시트 높이가 튀지 않게
//   Mac 앱에서는 시트 높이를 한 값으로 고정한다(안쪽 .sheet-body 만 스크롤).

const SHEET_TABS = [
  { id: 'general', label: '일반' },
  { id: 'notch', label: '노치', mac: true },
  { id: 'search', label: '검색', mac: true },
  { id: 'permissions', label: '권한', mac: true },
  { id: 'modules', label: '모듈' },
];

const TAB_NOTES = {
  general: '테마와 기본 색, 시작, 앱 업데이트를 정합니다.',
  generalWeb: '테마와 기본 색, 앱 업데이트, 문의입니다.',
  notch: '노치의 반원과 전체 보기, 메뉴 막대 아이콘을 정합니다.',
  search: '전역 검색(⌥Space)의 단축키와 검색 대상, 시스템 명령을 정합니다.',
  permissions: '마이크 상태와 macOS 개인정보 보호 권한을 확인하고 엽니다.',
  modules: '모듈별 전역 단축키와 세부 옵션입니다.',
  quickbar: "노치 반원과 전체 보기 '켜 둔 모듈'에 모듈이 놓이는 순서입니다.",
};

function sheetNote(tab) {
  const key = tab === 'general' && !TAURI ? 'generalWeb' : tab;
  return el('p', { class: 'sheet-tab-note', text: TAB_NOTES[key] || '' });
}

function sheetSwitch(on, label, onChange, { disabled = false } = {}) {
  const button = el('button', {
    class: 'switch',
    type: 'button',
    'aria-pressed': String(!!on),
    'aria-label': label,
    disabled: disabled ? 'true' : null,
  }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    onChange(next);
  });
  return button;
}

/** 탭 막대 — Mac 앱에서만 보인다(웹은 지금처럼 한 화면). */
function sheetTabs(render) {
  const bar = el('div', { class: 'sheet-tabs', role: 'tablist', 'aria-label': '설정 영역' });
  SHEET_TABS.forEach(({ id, label }) => {
    const active = sheetTab === id || (sheetTab === 'quickbar' && id === 'notch');
    const button = el('button', {
      class: `sheet-tab${active ? ' is-on' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(active),
      text: label,
      'data-tab': id,
    });
    button.addEventListener('click', () => {
      sheetTab = id;
      sheetModule = null;
      render();
    });
    bar.append(button);
  });
  return bar;
}

/* ------------------------------ 일반 탭 ------------------------------ */

function generalTab(render) {
  const parts = [sheetNote('general')];
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const accent = getAccent();

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
  parts.push(el('div', { class: 'sheet-section' }, el('h3', { text: '화면 모드' }), seg));

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
  parts.push(el('div', { class: 'sheet-section' }, el('h3', { text: '기본 색상' }), swatches));

  if (TAURI) {
    parts.push(autostartSection());
  }

  parts.push(updateSection());
  parts.push(recentSection());
  parts.push(backupSection());
  parts.push(dataSection());

  if (hasSectionOrder()) {
    parts.push(el('div', { class: 'sheet-section' }, [
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

  return parts;
}

/** 로그인 시 자동 실행 — LaunchAgent(io.appfle.tip.plist) 하나만 쓴다. */
function autostartSection() {
  const readout = el('i', { class: 'notch-hint', text: '확인 중…' });
  const toggle = sheetSwitch(false, '로그인 시 자동 실행', async (next) => {
    try {
      await invokeTauri('set_autostart', { enabled: next });
      readout.textContent = next ? '켜짐' : '꺼짐';
      toast(next ? '로그인할 때 TIP 이 자동으로 켜집니다' : '로그인 자동 실행을 껐습니다');
    } catch (error) {
      console.error('[TIP autostart]', error);
      toggle.setAttribute('aria-pressed', String(!next));
      readout.textContent = !next ? '켜짐' : '꺼짐';
      toast(typeof error === 'string' ? error : '자동 실행 설정을 바꾸지 못했습니다');
    }
  });

  invokeTauri('get_autostart').then((on) => {
    toggle.setAttribute('aria-pressed', String(!!on));
    readout.textContent = on ? '켜짐' : '꺼짐';
  }).catch(() => { readout.textContent = '꺼짐'; });

  return el('div', { class: 'sheet-section mb-section' }, [
    el('h3', { text: '시작' }),
    el('p', {
      class: 'mb-note',
      text: 'Mac 에 로그인할 때 TIP 을 자동으로 켭니다. ~/Library/LaunchAgents 에 TIP 자신의 실행 파일만 등록합니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '로그인 시 자동 실행' }),
        readout,
      ]),
      toggle,
    ]),
  ]);
}

/* ------------------------------ 노치 탭 ------------------------------ */

function notchTab(render) {
  // v1.17.0 — ① 노치 아일랜드 ② 시작 화면 ③ 회전 방식·④ 모듈 순서 ⑤ 닫힌 노치 표시 ⑥ 위젯
  //           ⑦ 표시할 캘린더 ⑧ 메뉴 막대(반원 배경 불투명도)
  // v1.17.2 — ①-2 노치 숨기기 단축키
  const parts = [sheetNote('notch')];
  parts.push(notchSection(render));
  parts.push(notchShortcutSection(render));
  parts.push(notchStartViewSection(render));
  parts.push(notchRotationSection(render));
  parts.push(notchPillSection());
  parts.push(notchWidgetSection(render));
  parts.push(calendarFilterSection());
  parts.push(menuBarSection());
  return parts;
}

/** 노치 캘린더에 어떤 캘린더를 보일지 — 노치 화면과 같은 저장 키를 쓴다.
 *  v1.15.1 — 노치 아일랜드나 캘린더 위젯이 꺼져 있으면 이 필터는 쓸 수 없다(비활성). */
const CAL_FILTER_KEY = 'tip.calendar.selectedIds.v1';

function calendarFilterAvailable() {
  const notch = getNotchSettings();
  return !!(notch.enabled && notch.widgets && notch.widgets.calendar);
}

function calendarFilterSection() {
  const available = calendarFilterAvailable();
  const offNote = el('p', {
    class: 'mb-note',
    text: '노치 아일랜드를 켜고 캘린더 위젯을 표시하면 쓸 수 있습니다.',
  });
  const holder = el('div', {
    class: `sheet-section mb-section cal-filter-section${available ? '' : ' is-off'}`,
  }, [
    el('h3', { text: '캘린더 표시 필터' }),
    offNote,
  ]);

  if (!TAURI || !available) return holder;

  invokeTauri('calendar_list').then((list) => {
    holder.innerHTML = '';
    holder.append(
      el('h3', { text: '캘린더 표시 필터' }),
      el('p', { class: 'mb-note', text: '노치의 오늘 일정에 보일 캘린더만 고릅니다. 고른 값은 이 기기에만 저장됩니다.' }),
    );
    const calendars = Array.isArray(list) ? list : [];
    if (!calendars.length) {
      holder.append(el('p', { class: 'mb-note', text: '읽을 수 있는 캘린더가 없습니다. 권한을 확인해 주세요.' }));
      return;
    }
    let selected = null;
    try {
      const stored = JSON.parse(localStorage.getItem(CAL_FILTER_KEY) || 'null');
      if (Array.isArray(stored)) selected = stored;
    } catch { selected = null; }

    const save = () => {
      const on = [...holder.querySelectorAll('input[data-cal]')].filter((input) => input.checked).map((input) => input.dataset.cal);
      try {
        if (on.length === calendars.length) localStorage.removeItem(CAL_FILTER_KEY);
        else localStorage.setItem(CAL_FILTER_KEY, JSON.stringify(on));
      } catch { /* 저장하지 못하면 이번에만 */ }
      if (window.__TAURI__?.event?.emitTo) {
        window.__TAURI__.event.emitTo('notch', 'tip://notch-refresh', null).catch(() => {});
      }
    };

    calendars.forEach((calendar) => {
      const checked = selected === null || selected.includes(calendar.id);
      const input = el('input', { type: 'checkbox', 'data-cal': calendar.id });
      input.checked = checked;
      input.addEventListener('change', save);
      const dot = el('span', { class: 'cal-filter-dot' });
      dot.style.background = calendar.color || '#2E5E4E';
      const row = el('label', { class: 'cal-filter-row' }, [input, dot, el('span', { text: calendar.title || calendar.id })]);
      holder.append(row);
    });
  }).catch(() => {
    holder.append(el('p', { class: 'mb-note', text: '캘린더 목록을 불러오지 못했습니다(권한 확인).' }));
  });

  return holder;
}

/* ------------------------------ 검색 탭 ------------------------------ */

function searchTab(render) {
  const parts = [sheetNote('search')];
  parts.push(searchSection(render));
  parts.push(searchScopeSection());
  parts.push(systemCommandSection(render));
  return parts;
}

function searchScopeSection() {
  const scope = getSearchScope();
  const rows = SEARCH_SCOPE_ITEMS.filter((item) => !item.mac || TAURI).map((item) => {
    const toggle = sheetSwitch(scope[item.id], item.label, (next) => {
      setSearchScope(item.id, next);
      toast(next ? `'${item.label}'을(를) 검색에 포함합니다` : `'${item.label}'을(를) 검색에서 뺐습니다`);
      // v1.15.1 — 로컬 파일 검색을 처음 켠 사람에게 무엇을 검색하는지 한 번만 알린다.
      if (item.id === 'files' && next && filesNoticePending()) {
        markFilesNoticeShown();
        toast('홈 폴더 파일 이름을 검색합니다. 찾은 경로만 열 수 있습니다', 3600);
      }
    });
    return el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: item.label }),
        el('i', { class: 'notch-hint', text: item.hint }),
      ]),
      toggle,
    ]);
  });

  return el('div', { class: 'sheet-section mb-section' }, [
    el('h3', { text: '검색 대상' }),
    el('p', { class: 'mb-note', text: '끄면 그 종류는 검색 결과에 아예 나오지 않습니다.' }),
    ...rows,
  ]);
}

/** 시스템 명령 9종 — 켜고 끄고, 위험한 명령은 한 번 더 묻는다. */
const SYSTEM_COMMAND_ROWS = [
  { id: 'lock', label: '화면 잠금', risky: false },
  { id: 'sleep', label: '잠자기', risky: false },
  { id: 'screensaver', label: '화면 보호기', risky: false },
  { id: 'darkmode', label: '다크 모드와 라이트 모드 전환', risky: false },
  { id: 'hiddenfiles', label: '숨김 파일 표시 전환', risky: false },
  { id: 'emptytrash', label: '휴지통 비우기', risky: true },
  { id: 'restart', label: '재시동', risky: true },
  { id: 'shutdown', label: '시스템 종료', risky: true },
  { id: 'logout', label: '로그아웃', risky: true },
];

function systemCommandSection(render) {
  if (!TAURI) return el('div', { class: 'sheet-section mb-section' });
  const enabled = getSystemCommandEnabled();
  const rows = SYSTEM_COMMAND_ROWS.map((command) => {
    const toggle = sheetSwitch(enabled[command.id], command.label, (next) => {
      setSystemCommandEnabled(command.id, next);
      toast(`${command.label} 명령을 ${next ? '켜' : '껐'}습니다`);
    });
    return el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: command.label }),
        el('i', {
          class: 'notch-hint',
          text: command.risky
            ? (enabled[command.id] ? '실행할 때 macOS 확인창이 뜹니다' : '기본은 꺼짐. 켜야 쓸 수 있습니다')
            : '검색에서 바로 실행',
        }),
      ]),
      toggle,
    ]);
  });

  return el('div', { class: 'sheet-section mb-section' }, [
    el('h3', { text: '시스템 명령' }),
    el('p', {
      class: 'mb-note',
      text: '검색창에서 화면 잠금이나 잠자기, 다크 모드 같은 macOS 명령을 실행합니다. 휴지통 비우기와 재시동, 종료, 로그아웃은 기본으로 꺼 두었고, 켜도 실행할 때 macOS 확인창을 한 번 더 보여 줍니다.',
    }),
    ...rows,
  ]);
}

/* ------------------------------ 모듈 탭 ------------------------------ */

function modulesTab(render) {
  if (sheetModule) return moduleTab(sheetModule, render);

  const parts = [sheetNote('modules'), shortcutPrefixSection(render)];
  const search = el('input', {
    class: 'pt-input sheet-module-search',
    type: 'search',
    placeholder: '모듈 이름이나 기능으로 찾기',
    autocomplete: 'off',
    'aria-label': '모듈 찾기',
  });
  search.value = moduleQuery;

  const filterBtn = el('button', {
    class: `sheet-chip${moduleFilterShortcuts ? ' is-on' : ''}`,
    type: 'button',
    'aria-pressed': String(moduleFilterShortcuts),
    text: '단축키 있음만',
  });

  const list = el('div', { class: 'sheet-module-list' });

  const paint = () => {
    const query = moduleQuery.trim().toLowerCase();
    const items = listModules()
      .map((mod) => ({ mod, keys: moduleShortcutKeys(mod.id) }))
      .filter(({ mod, keys }) => {
        if (moduleFilterShortcuts && !keys.length) return false;
        if (!query) return true;
        const hay = `${mod.name} ${mod.shortName || ''} ${mod.subtitle || ''} ${mod.description || ''} ${mod.id}`.toLowerCase();
        return query.split(/\s+/).every((part) => hay.includes(part));
      })
      // 단축키가 있는 모듈을 위로 — 같은 무리 안에서는 이름 순서.
      .sort((a, b) => {
        if (!!a.keys.length !== !!b.keys.length) return a.keys.length ? -1 : 1;
        return String(a.mod.name).localeCompare(String(b.mod.name), 'ko');
      });

    list.replaceChildren();
    if (!items.length) {
      list.append(el('p', { class: 'mb-note', text: '찾는 모듈이 없습니다.' }));
      return;
    }

    items.forEach(({ mod, keys }) => {
      const badge = keys.length
        ? el('kbd', {
          class: 'shortcut-chip module-shortcut',
          text: `${prettyShortcut(keys[0])}${keys.length > 1 ? ` +${keys.length - 1}` : ''}`,
          title: keys.map((key) => prettyShortcut(key)).join(', '),
        })
        : null;
      // v1.16.0 — 어느 묶음(문서·글 등)에 있는 모듈인지도 함께 보여 준다.
      const categoryLabel = visibleCategories().find((category) => category.id === categoryOf(mod))?.label || '';
      const row = el('button', { class: 'sheet-module-row', type: 'button' }, [
        el('span', { class: 'sheet-module-icon', html: mod.icon || '' }),
        el('span', { class: 'sheet-module-text' }, [
          el('span', { class: 'sheet-module-head' }, [
            el('b', { text: mod.name }),
            categoryLabel ? el('span', { class: 'sheet-module-cat', text: categoryLabel }) : null,
          ]),
          el('span', { text: mod.subtitle || '' }),
        ]),
        badge,
        el('span', { class: 'sheet-menu-arrow', text: '›', 'aria-hidden': 'true' }),
      ]);
      row.addEventListener('click', () => {
        sheetModule = mod.id;
        render();
      });
      list.append(row);
    });
  };

  search.addEventListener('input', () => {
    moduleQuery = search.value;
    paint();
  });
  filterBtn.addEventListener('click', () => {
    moduleFilterShortcuts = !moduleFilterShortcuts;
    filterBtn.classList.toggle('is-on', moduleFilterShortcuts);
    filterBtn.setAttribute('aria-pressed', String(moduleFilterShortcuts));
    paint();
  });

  parts.push(el('div', { class: 'sheet-section' }, [
    search,
    el('div', { class: 'sheet-chips' }, filterBtn),
    list,
  ]));
  paint();
  return parts;
}

/** 모듈이 지금 쓰는 단축키들( accelerator ) — 목록의 오른쪽 표시와 정렬에 쓴다. */
function moduleShortcutKeys(moduleId) {
  return actionsFor(moduleId)
    .map((action) => getShortcut(action.key))
    .filter(Boolean);
}

/** 모듈 탭 맨 위 — 모든 모듈 단축키의 공통 조합 하나(v1.15.0). */
function shortcutPrefixSection(render) {
  const prefix = getShortcutPrefix();
  const select = el('select', {
    class: 'pt-input sheet-select shortcut-prefix-select',
    'aria-label': '모듈 단축키 공통 조합',
  });
  SHORTCUT_PREFIXES.forEach(({ id, label, short }) => {
    const option = el('option', { value: id, text: `${short}  ${label}` });
    if (id === prefix) option.selected = true;
    select.append(option);
  });

  let busy = false;
  select.addEventListener('change', async () => {
    if (busy) return;
    busy = true;
    const next = select.value;
    setShortcutPrefix(next);
    const failures = await syncShortcuts();
    busy = false;
    render();
    if (failures.length) {
      toast(`${prettyShortcut(next)} 로 바꿨지만 ${failures.length}개는 등록하지 못했습니다. 다른 조합도 써 보세요`);
    } else {
      toast(`모듈 단축키 조합을 ${prettyShortcut(next)} 로 바꿨습니다`);
    }
  });

  const example = getShortcutLetters();
  const sample = Object.values(example)[0];
  return el('div', { class: 'sheet-section mb-section shortcut-prefix-section' }, [
    el('h3', { text: '공통 단축키 조합' }),
    el('p', {
      class: 'mb-note',
      text: '아래 모듈 단축키는 모두 이 조합 + 알파벳(또는 숫자) 한 글자입니다. 전역 검색 단축키(⌥Space)는 [검색] 탭에서 따로 정합니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '조합' }),
        el('i', { class: 'notch-hint', text: sample ? `지금 예: ${prettyShortcut(prefix)}+${sample}` : '기본값은 Control + Shift 입니다' }),
      ]),
      select,
    ]),
  ]);
}

/** 단축키 키(action key) → 사람이 읽을 이름 — 중복 안내에 쓴다. */
function actionLabel(actionKey) {
  // v1.17.2 — 노치 숨기기 단축키는 모듈이 아니라 중복 안내에 이름을 직접 준다.
  if (actionKey === NOTCH_TOGGLE_KEY) return '노치 숨기기';
  for (const mod of listModules()) {
    const found = actionsFor(mod.id).find((action) => action.key === actionKey);
    if (found) return `${mod.name} ${found.label}`;
  }
  return actionKey;
}

function moduleTab(moduleId, render) {
  const mod = getModule(moduleId);
  if (!mod) {
    sheetModule = null;
    return modulesTab(render);
  }

  const back = el('button', { class: 'sheet-back', type: 'button', 'aria-label': '모듈 목록으로' }, [
    el('span', { class: 'sheet-back-icon', html: icons.back, 'aria-hidden': 'true' }),
    el('span', { text: '모듈' }),
  ]);
  back.addEventListener('click', () => {
    sheetModule = null;
    render();
  });

  const parts = [
    el('p', { class: 'sheet-tab-note', text: `이 화면의 설정은 ${mod.name} 하나에만 적용됩니다.` }),
  ];

  const actions = actionsFor(moduleId);
  const shortcutRows = actions.map((action) => shortcutRow(action, render));
  parts.push(el('div', { class: 'sheet-section mb-section' }, [
    el('h3', { text: '전역 단축키' }),
    el('p', {
      class: 'mb-note',
      text: `공통 조합(${prettyShortcut(getShortcutPrefix())}) + 한 글자입니다. 글자를 바꾸면 바로 등록되고, 다른 모듈이 쓰는 글자는 등록되지 않습니다.`,
    }),
    ...shortcutRows,
  ]));

  if (moduleId === 'window-snap') {
    parts.push(el('div', { class: 'sheet-section' }, el('button', {
      class: 'sheet-reset',
      type: 'button',
      text: '권장 단축키 채우기 (⌃⌥ + 방향키)',
      onclick: async () => {
        const table = {
          'snap:left': 'Control+Alt+ArrowLeft',
          'snap:right': 'Control+Alt+ArrowRight',
          'snap:top': 'Control+Alt+ArrowUp',
          'snap:bottom': 'Control+Alt+ArrowDown',
          'snap:max': 'Control+Alt+Enter',
          'snap:center': 'Control+Alt+KeyC',
        };
        Object.entries(table).forEach(([key, accelerator]) => setShortcut(key, accelerator));
        const failures = await syncShortcuts();
        render();
        toast(failures.length ? `일부 단축키를 등록하지 못했습니다: ${failures[0].accelerator}` : '권장 단축키를 채웠습니다');
      },
    })));
  }

  const options = valuesFor(moduleId);
  if (options.length) {
    const rows = options.map((option) => featureValueRow(option, render));
    parts.push(el('div', { class: 'sheet-section mb-section' }, [
      el('h3', { text: '세부 옵션' }),
      ...rows,
    ]));
  }

  if (moduleId === 'snippets') {
    const count = listSnippets().length;
    parts.push(el('div', { class: 'sheet-section' }, [
      el('p', { class: 'mb-note', text: `지금 스니펫 ${count}개. 내용은 모듈 화면에서 고칩니다.` }),
    ]));
  }

  return {
    head: el('div', { class: 'sheet-head sheet-head-sub' }, [
      back,
      el('h2', { text: mod.name }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '닫기',
        html: icons.close,
        onclick: closeSheet,
      }),
    ]),
    parts,
  };
}

/** 단축키 하나 — 공통 조합 칩 + 한 글자 입력 + (있으면) 직접 정한 조합 + 해제.
 *  v1.15.0 — 변경→취소 캐처 상태를 없었다(글자를 바로 넣고 바로 등록).
 *  v1.14.0 에서 "변경을 누른 뒤 바로 취소"가 먹지 않던 원인은 그 두 가지다.
 *    ① 버튼 리스너 첫 줄이 `if (capturing) return;` 이라, 같은 버튼이 '취소'로 바뀠 뒤에도
 *       다시 누른 클릭을 그대로 무시했다(취소 버튼이 죽어 있었다).
 *    ② 키 캐처 리스너가 document capture 에서 preventDefault 만 하고 stopPropagation 을 하지
 *       않아, Esc 를 누르면 캐처는 풀리지만 window 의 "Esc 면 시트 닫기"까지 같이 돌았다.
 */
function shortcutRow(action, render) {
  const prefix = getShortcutPrefix();
  const letters = getShortcutLetters();
  const extra = getShortcutExtras()[action.key] || '';
  const letter = letters[action.key] || '';

  const prefixChip = el('kbd', { class: 'shortcut-chip shortcut-prefix-chip', text: prettyShortcut(prefix) });
  const input = el('input', {
    class: 'shortcut-letter',
    type: 'text',
    maxlength: '1',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '–',
    'aria-label': `${action.label} 단축키 글자`,
  });
  input.value = letter;

  const extraChip = extra
    ? el('kbd', { class: 'shortcut-chip shortcut-extra-chip', text: prettyShortcut(extra), title: '직접 정한 조합' })
    : null;
  const drop = el('button', { class: 'icon-btn shortcut-open shortcut-clear', type: 'button', text: '해제' });
  drop.disabled = !letter && !extra;

  let busy = false;
  const commit = async () => {
    if (busy) return;
    const value = input.value.trim().toUpperCase();
    if (!value) {
      input.value = letter;
      return;
    }
    if (!validShortcutLetter(value)) {
      toast('알파벳 한 글자 또는 숫자 하나만 쓸 수 있습니다');
      input.value = letter;
      return;
    }
    if (value === letter && !extra) {
      input.value = letter;
      return;
    }
    const result = setShortcutLetter(action.key, value);
    if (!result.ok) {
      if (result.reason === 'duplicate') {
        toast(`${result.accelerator.replace(/^.*\+/, '')} 는 ${actionLabel(result.owner)} 이(가) 이미 씁니다`);
      } else {
        toast('알파벳 한 글자 또는 숫자 하나만 쓸 수 있습니다');
      }
      input.value = letter;
      return;
    }
    busy = true;
    const failures = await syncShortcuts();
    busy = false;
    const failure = failures.find((item) => item.key === action.key);
    if (failure) {
      clearShortcut(action.key);
      await syncShortcuts();
      toast(`${prettyShortcut(result.accelerator)} 를 등록하지 못했습니다. 다른 글자를 써 주세요`);
      render();
      return;
    }
    toast(`${action.label}: ${prettyShortcut(result.accelerator)}`);
    render();
  };

  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 1);
    if (input.value) commit();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  });

  drop.addEventListener('click', async () => {
    clearShortcut(action.key);
    await syncShortcuts();
    render();
    toast(`${action.label} 단축키를 해제했습니다`);
  });

  return el('div', { class: 'mb-row shortcut-feature-row' }, [
    el('span', { class: 'mb-label' }, [
      el('b', { text: action.label }),
      action.hint ? el('i', { class: 'notch-hint', text: action.hint }) : null,
    ]),
    el('div', { class: 'shortcut-keys shortcut-letter-group' }, [
      prefixChip,
      el('span', { class: 'shortcut-plus', text: '+', 'aria-hidden': 'true' }),
      input,
      extraChip,
    ]),
    el('div', { class: 'shortcut-actions' }, [drop]),
  ]);
}

/** 모듈 세부 옵션 한 줄 — 고르기 / 스위치 / 색. */
function featureValueRow(option, render) {
  const value = getFeatureValue(option.key, option.fallback);
  const label = el('span', { class: 'mb-label' }, [
    el('b', { text: option.label }),
    option.hint ? el('i', { class: 'notch-hint', text: option.hint }) : null,
  ]);

  if (option.type === 'switch') {
    const toggle = sheetSwitch(value !== false, option.label, (next) => {
      setFeatureValue(option.key, next);
      // v1.15.1 — Rust 가 따로 들어야 하는 값(비밀번호 제외 등)은 option.apply 로 바로 밀어 준다.
      if (typeof option.apply === 'function') option.apply(next);
      toast(`${option.label} ${next ? '켬' : '끔'}`);
    });
    return el('div', { class: 'mb-row' }, [label, toggle]);
  }

  if (option.type === 'select' || option.type === 'color') {
    const select = el('select', { class: 'pt-input sheet-select', 'aria-label': option.label });
    option.options.forEach(([id, text]) => {
      const item = el('option', { value: id, text });
      if (id === value) item.selected = true;
      select.append(item);
    });
    select.addEventListener('change', () => {
      setFeatureValue(option.key, select.value);
      toast(`${option.label}을(를) 바꿨습니다`);
      render();
    });
    return el('div', { class: 'mb-row feature-select-row' }, [label, select]);
  }

  return el('div', { class: 'mb-row' }, [label]);
}

function openSheet(tab = 'general', moduleId = null) {
  if (sheet) {
    sheetTab = tab || 'general';
    sheetModule = moduleId || sheetModule;
    if (sheetRender) sheetRender();
    return;
  }
  sheetTab = tab || 'general';
  sheetModule = moduleId || null;
  const backdrop = el('div', { class: 'sheet-backdrop' });
  backdrop.addEventListener('click', closeSheet);

  const panel = el('div', {
    class: `sheet${TAURI ? ' is-fixed' : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '환경설정',
  });

  const render = () => {
    panel.innerHTML = '';
    panel.append(el('div', { class: 'sheet-grab' }));

    // 머리(제목 또는 하위 화면 뒤로가기)와 탭 줄은 시트 위쪽에 고정된다.
    let head;
    let parts;
    if (sheetTab === 'quickbar') {
      ({ head, parts } = quickbarScreen(render));
    } else {
      head = el('div', { class: 'sheet-head' }, [
        el('h2', { text: '환경설정' }),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '닫기',
          html: icons.close,
          onclick: closeSheet,
        }),
      ]);
      if (!TAURI) {
        // 웹(PWA)은 지금처럼 한 화면 — Mac 전용 탭은 없다.
        parts = generalTab(render);
      } else if (sheetTab === 'general') {
        parts = generalTab(render);
      } else if (sheetTab === 'notch') {
        parts = notchTab(render);
      } else if (sheetTab === 'search') {
        parts = searchTab(render);
      } else if (sheetTab === 'permissions') {
        parts = permissionsTab();
      } else {
        const modsView = modulesTab(render);
        if (modsView.parts) {
          head = modsView.head;
          parts = modsView.parts;
        } else {
          parts = modsView;
        }
      }
    }

    panel.append(head);
    if (TAURI) panel.append(sheetTabs(render));
    const body = el('div', { class: 'sheet-body' });
    parts.forEach((node) => body.append(node));
    panel.append(body);
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

/* ------------------------------ 문의하기 (v1.14.0 → v1.15.3) ------------------------------ */
// 상단 바의 메일 버튼을 없애고 환경설정 안으로 옮겼다. 데이터 처리 안내도 여기 한 곳에만 적는다.

const MAIL_TO = 'appfle.io@gmail.com';

function inquiryUrl() {
  const subject = `[TIP 문의] v${APP_VERSION}`;
  return `mailto:${MAIL_TO}?subject=${encodeURIComponent(subject)}`;
}

/** 문의 메일 — Mac 앱은 Rust 가 기본 메일 앱을 확실히 띄운다. */
async function openInquiry() {
  if (TAURI) {
    try {
      await invokeTauri('open_external_url', { url: inquiryUrl() });
      return;
    } catch (error) {
      console.warn('[TIP inquiry]', error);
    }
  } else {
    location.href = inquiryUrl();
    return;
  }
  // 메일 앱이 없으면 주소를 복사해 준다.
  try {
    if (TAURI) await invokeTauri('copy_text', { text: MAIL_TO });
    else await navigator.clipboard.writeText(MAIL_TO);
    toast(`메일 앱을 열지 못해 주소를 복사했습니다. ${MAIL_TO}`, 3600);
  } catch {
    toast(`문의 주소: ${MAIL_TO}`, 4000);
  }
}

/** 일반 탭 — 최근 사용 (v1.16.0). */
function recentSection() {
  const toggle = sheetSwitch(getRecentEnabled(), '최근 사용한 모듈 보기', (next) => {
    setRecentEnabled(next);
    rerenderHome();
    toast(next ? '최근 사용한 모듈을 홈에 보여 줍니다' : '최근 사용한 모듈을 홈에서 감췄습니다');
  });

  return el('div', { class: 'sheet-section mb-section' }, [
    el('h3', { text: '최근 사용' }),
    el('p', {
      class: 'mb-note',
      text: '홈 위쪽에 최근에 연 모듈을 최대 6개 보여 줍니다. 이미 고정한 모듈은 빼고 보여 줍니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '최근 사용한 모듈 보기' }),
        el('i', { class: 'notch-hint', text: '기록은 이 기기에만 남습니다' }),
      ]),
      toggle,
    ]),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, el('i', { class: 'notch-hint', text: '지우면 다시 열 때부터 새로 쌓입니다' })),
      el('button', {
        class: 'sheet-reset',
        type: 'button',
        text: '기록 지우기',
        onclick: () => {
          clearRecent();
          rerenderHome();
          toast('최근 사용 기록을 지웠습니다');
        },
      }),
    ]),
  ]);
}

/** 백업 파일을 웹에서 내려받는다. (Mac 은 Rust 저장 대화상자를 쓴다) */
function downloadText(text, name) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 일반 탭 맨 아래 — 백업과 복원 (v1.16.0). */
function backupSection() {
  const includeClip = el('input', { type: 'checkbox', id: 'backup-include-clip' });
  const fileInput = el('input', { type: 'file', id: 'backup-file', accept: 'application/json,.json', class: 'sr-only' });
  const statusEl = el('div', { class: 'v16-status', hidden: true, 'aria-live': 'polite' });
  const previewEl = el('div', { class: 'backup-preview', hidden: true });
  const makeBtn = el('button', { class: 'primary-btn', type: 'button', text: '백업 파일 만들기' });
  const loadBtn = el('button', { class: 'primary-btn ghost', type: 'button', text: '백업 파일 불러오기' });

  function setStatus(text, kind = '') {
    statusEl.hidden = !text;
    statusEl.className = `v16-status${text ? ` ${kind}` : ''}`;
    statusEl.textContent = text || '';
  }

  async function makeBackup() {
    makeBtn.disabled = true;
    setStatus('백업 파일을 만드는 중…', 'warn');
    try {
      const text = await collectBackup({
        includeClipboard: TAURI && includeClip.checked,
        version: APP_VERSION,
      });
      const name = backupFileName();
      if (TAURI) {
        const result = await invokeTauri('save_backup_file', { name, content: text });
        if (result && result.path) {
          setStatus(`저장했습니다: ${result.path}`, 'ok');
          toast('백업 파일을 저장했습니다', 3200);
        } else {
          setStatus('');
          toast('백업 저장을 취소했습니다');
        }
      } else {
        downloadText(text, name);
        setStatus(`${name} 을(를) 내려받았습니다`, 'ok');
        toast('백업 파일을 내려받았습니다', 3200);
      }
    } catch (error) {
      console.error('[TIP backup]', error);
      setStatus(typeof error === 'string' ? error : '백업 파일을 만들지 못했습니다', 'bad');
    } finally {
      makeBtn.disabled = false;
    }
  }

  async function handleText(text, name = '') {
    const parsed = readBackup(text);
    if (!parsed.ok) {
      previewEl.hidden = true;
      setStatus(`이 파일은 열지 않았습니다. ${parsed.error}`, 'bad');
      return;
    }
    previewEl.replaceChildren();
    previewEl.append(el('p', { class: 'backup-title', text: name ? `${name} 안에 있는 것` : '이 파일 안에 있는 것' }));
    parsed.summary.forEach(({ label, value }) => {
      previewEl.append(el('div', { class: 'backup-row' }, [
        el('span', { class: 'backup-key', text: label }),
        el('span', { class: 'backup-value', text: value }),
      ]));
    });
    if (parsed.ignored) {
      previewEl.append(el('p', { class: 'backup-note', text: `이 앱이 모르는 항목 ${parsed.ignored}개는 건너뜁니다.` }));
    }
    previewEl.hidden = false;
    setStatus('', '');

    const summary = parsed.summary.map((item) => `${item.label} ${item.value}`).join(', ');
    const ok = await confirmDialog({
      title: '백업 파일 불러오기',
      message: `${describeBackup(parsed)}. ${summary}. 지금 설정을 덮어씁니다. 되돌릴 수 없습니다.`,
      okText: '덮어쓰기',
    });
    if (!ok) {
      setStatus('불러오기를 취소했습니다. 아무것도 바뀌지 않았습니다.', 'warn');
      return;
    }
    const result = await applyBackup(parsed);
    if (!result.ok) {
      setStatus(result.error, 'bad');
      return;
    }
    setStatus(result.warning || '되돌렸습니다. 화면을 새로 고칩니다…', result.warning ? 'warn' : 'ok');
    toast(result.warning || '백업을 되돌렸습니다. 화면을 새로 고칩니다', 3200);
    setTimeout(() => location.reload(), 800);
  }

  makeBtn.addEventListener('click', makeBackup);
  loadBtn.addEventListener('click', async () => {
    setStatus('', '');
    if (!TAURI) {
      fileInput.click();
      return;
    }
    try {
      const result = await invokeTauri('open_backup_file');
      if (!result || !result.content) return;
      await handleText(result.content, result.name || '');
    } catch (error) {
      console.error('[TIP backup]', error);
      setStatus(typeof error === 'string' ? error : '백업 파일을 열지 못했습니다', 'bad');
    }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await handleText(await file.text(), file.name);
    } catch (error) {
      console.error('[TIP backup]', error);
      setStatus('파일을 읽지 못했습니다', 'bad');
    }
  });

  const parts = [
    el('h3', { text: '백업과 복원' }),
    el('p', {
      class: 'mb-note',
      text: '설정, 홈 카드 순서, 고정한 모듈, 스니펫, 단축키를 JSON 한 파일로 만듭니다. 만든 파일은 이 기기에만 두세요.',
    }),
  ];

  if (TAURI) {
    parts.push(el('label', { class: 'backup-check', for: 'backup-include-clip' }, [
      includeClip,
      el('span', { text: '클립보드 기록도 포함' }),
    ]));
    parts.push(el('p', {
      class: 'mb-note backup-warn',
      text: '클립보드 기록에는 비밀번호나 개인 정보가 들어 있을 수 있습니다. 넣으면 파일을 안전한 곳에 두세요.',
    }));
  }

  parts.push(el('div', { class: 'v16-actions backup-actions' }, [makeBtn, loadBtn]));
  parts.push(fileInput, statusEl, previewEl);

  return el('div', { class: 'sheet-section mb-section backup-section' }, parts);
}

/** 일반 탭 맨 아래 — 데이터 처리 안내(이 문장이 앱에서 유일한 '기기 안' 안내다)와 문의. */
function dataSection() {
  const btn = el('button', { class: 'primary-btn ghost inquiry-btn', type: 'button', text: '메일 보내기' });
  btn.addEventListener('click', () => { openInquiry(); });

  return el('div', { class: 'sheet-section mb-section data-section' }, [
    el('h3', { text: '데이터와 문의' }),
    el('p', {
      class: 'mb-note',
      text: '파일과 글자는 기기 안에서만 처리하고 어디로도 보내지 않습니다. 환율, 주소, 배송 조회만 인터넷을 씁니다.',
    }),
    el('div', { class: 'mb-row' }, [
      el('span', { class: 'mb-label' }, [
        el('b', { text: '문의하기' }),
        el('i', { class: 'notch-hint', text: MAIL_TO }),
      ]),
      btn,
    ]),
  ]);
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSheet();
});

/* ------------------------------ 타이머 감시 (v1.15.0) ------------------------------ */
// 노치 창이 꺼져 있어도 메인 창이 켜져 있으면 타이머 끝을 알린다.
// 같은 타이머로 두 번 울리지 않게, 끝냄(done)을 확정한 창만 알린다(tickTimer).
let timerAlertedAt = 0;
function watchTimer() {
  if (!tickTimer()) return;
  const state = timerState();
  if (state.finishedAt && state.finishedAt === timerAlertedAt) return;
  timerAlertedAt = state.finishedAt;
  alertTimerDone(state.duration);
  toast('타이머가 끝났습니다');
}
setInterval(watchTimer, 1000);

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

  // Rust 가 알리는 짧은 안내(단축키 실패·권한 등)를 화면 토스트로 띄운다(v1.14.0).
  window.__TAURI__.event.listen('tip://toast', (event) => {
    const text = typeof event.payload === 'string' ? event.payload : '';
    if (text) toast(text.replace('[permission]', '').trim(), 3200);
  });

  // v1.17.2 — 전역 단축키(공통 조합 + H)로 노치를 숨기고 보이면 Rust 가 결과를 알린다.
  // 값의 주인은 이 창(localStorage)이므로 여기서 저장값을 맞추고, 설정 시트가 열려 있으면 다시
  // 그려 토글도 바로 바뀌게 한다. Rust 는 창을 이미 숨기거나 보인 뒤다(화면이 늦어도 동작은 즉시).
  window.__TAURI__.event.listen('tip://notch-enabled', (event) => {
    const enabled = !!(event && event.payload);
    const before = getNotchSettings().enabled;
    // v1.17.2 — 창을 숨기거나 보인 것은 Rust 가 먼저 끝냈다. 여기서는 저장값을 그대로 맞추고
    // 설정 시트가 열려 있으면 다시 그린다(캐시가 늦어도 값이 어긋나지 않게 늘 쓴다).
    setNotchEnabled(enabled);
    if (sheetRender && document.querySelector('.sheet')) sheetRender();
    if (before !== enabled) {
      toast(enabled ? '노치를 다시 표시합니다' : '노치를 숨겼습니다. 단축키를 다시 누르면 돌아옵니다');
    }
  });

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

    // 노치 아일랜드 사용 여부·마우스 오버·빠른 실행 단축키도 저장값을 Rust 에 밀어 준다(v1.12.0).
    if (getNotchSettings().enabled) {
      window.__TAURI__.core.invoke('set_notch_enabled', { enabled: true })
        .catch((error) => console.warn('[TIP] notch:', error));
    }
    window.__TAURI__.core.invoke('set_notch_hover', { enabled: getNotchSettings().hoverOpen })
      .catch((error) => console.warn('[TIP] notch hover:', error));
    window.__TAURI__.core.invoke('set_search_shortcut', { accelerator: getSearchShortcut() })
      .catch((error) => console.warn('[TIP] search shortcut:', error));

    // v1.14.0 — 기능별 전역 단축키도 저장값 그대로 등록한다. 실패한 조합은 조용히 알린다.
    syncShortcuts().then((failures) => {
      if (failures.length) {
        toast(`${failures.length}개 단축키를 등록하지 못했습니다. 설정 → 모듈·노치에서 확인해 주세요`, 3600);
      }
    });

    // v1.15.1 — 위험한 시스템 명령은 Rust 도 같은 설정을 들어야 꺼 둔 명령을 거부한다.
    syncSystemCommands();
    // 클립보드 '비밀번호 앱에서 복사한 항목 제외' 같은 값도 Rust 에 밀어 준다(기본 ON).
    applyModuleValues();
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
