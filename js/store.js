/* Persisted shell settings (modules, theme, accent). */

const KEY = 'tip.settings.v1';

const defaults = { modules: {} };

let cache = null;

/* 다른 창(노치 아일랜드)에 설정이 바뀌었음을 알린다. (v1.12.2)
   Tauri 의 창은 localStorage 가 같아도 storage 이벤트가 늘 닿지 않는다. 그래서 값을 바꾼 쪽이
   직접 tip://notch-refresh 를 보내고, 노치 창은 그때 테마·색·위젯 목록을 다시 읽어 그린다.
   웹(PWA) 브라우저에서는 알릴 다른 창이 없으니 조용히 넘어간다. */
function notifyWindows() {
  try {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.event) return;
    const send = () => {
      if (typeof tauri.event.emitTo === 'function') return tauri.event.emitTo('notch', 'tip://notch-refresh', null);
      if (typeof tauri.event.emit === 'function') return tauri.event.emit('tip://notch-refresh');
      return null;
    };
    Promise.resolve().then(send).catch(() => { /* 못 알려도 값은 저장됐다 */ });
  } catch { /* Tauri 가 아니면 알릴 창도 없다 */ }
}

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = parsed && typeof parsed === 'object' ? { ...defaults, ...parsed } : { ...defaults };
    if (!cache.modules || typeof cache.modules !== 'object') cache.modules = {};
  } catch {
    cache = { ...defaults, modules: {} };
  }
  return cache;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota — settings simply do not persist */
  }
  notifyWindows();
}

export function moduleState(module) {
  const saved = read().modules[module.id] || {};
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : module.defaultEnabled !== false,
    pinned: typeof saved.pinned === 'boolean' ? saved.pinned : module.defaultPinned === true,
  };
}

export function setModuleState(id, patch) {
  const settings = read();
  const current = settings.modules[id] || {};
  settings.modules[id] = { ...current, ...patch };
  write();
  return settings.modules[id];
}

export function resetSettings() {
  cache = { ...defaults, modules: {} };
  write();
}

/* 홈 카드 순서 — 섹션별 module id 배열. (v1.8.0, v1.12.2 섹션 개편)
   { pinned: [...], document: [...], media: [...], dev: [...], utility: [...], online: [...] }
   배열에 없는 모듈(새로 추가된 모듈)은 원래(레지스트리) 순서대로 뒤에 붙는다. */

const ORDER_KEY = 'tip.order.v1';
/* 홈 섹션 id — modules/registry.js 의 CATEGORIES 순서와 같아야 한다.
   v1.12.2 — 'docs' 를 'document' 로 바꾸고 개발(dev)·조회(online) 두 묶음을 더했다.
   예전 저장값(tip.order.v1 = { docs: [...] })은 읽을 때 document 로 옮겨 준다. */
export const ORDER_SECTIONS = ['pinned', 'document', 'media', 'dev', 'utility', 'online'];

/* v1.12.2 이전 섹션 id → 지금 id. 저장된 순서를 잃지 않게 읽을 때 옮긴다. */
const ORDER_SECTION_ALIASES = { docs: 'document', utilities: 'utility' };

let orderCache = null;

function readOrder() {
  if (orderCache) return orderCache;
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
  } catch {
    parsed = null;
  }
  const next = {};
  ORDER_SECTIONS.forEach((section) => {
    const list = parsed && Array.isArray(parsed[section]) ? parsed[section] : [];
    next[section] = [...new Set(list.filter((id) => typeof id === 'string'))];
  });
  // 옛 이름으로 저장된 순서는 비어 있지 않을 때만 새 이름으로 가져온다.
  Object.entries(ORDER_SECTION_ALIASES).forEach(([oldId, newId]) => {
    const list = parsed && Array.isArray(parsed[oldId]) ? parsed[oldId] : [];
    if (!list.length) return;
    const merged = [...next[newId]];
    list.forEach((id) => {
      if (typeof id === 'string' && !merged.includes(id)) merged.push(id);
    });
    next[newId] = merged;
  });
  orderCache = next;
  return orderCache;
}

export function getSectionOrder(sectionId) {
  const list = readOrder()[sectionId];
  return list ? list.slice() : [];
}

export function setSectionOrder(sectionId, ids) {
  if (!ORDER_SECTIONS.includes(sectionId) || !Array.isArray(ids)) return;
  const order = readOrder();
  order[sectionId] = [...new Set(ids.filter((id) => typeof id === 'string'))];
  writeOrder(order);
}

export function hasSectionOrder() {
  return Object.values(readOrder()).some((list) => list.length > 0);
}

export function resetSectionOrder() {
  orderCache = {};
  ORDER_SECTIONS.forEach((section) => { orderCache[section] = []; });
  try {
    localStorage.removeItem(ORDER_KEY);
  } catch { /* 저장소를 못 쓰면 순서도 저장되지 않는다 */ }
  notifyWindows();
}

function writeOrder(order) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode / quota — 순서는 저장되지 않는다 */
  }
  notifyWindows();
}

/* 반원 퀵바(메뉴 막대) 순서 — 카테고리와 무관한 module id 배열. (v1.9.0)
   값이 없으면 메인 화면 순서(고정됨 → 문서 → 미디어 → 유틸리티)를 따른다.
   꺼 둔 모듈의 id 도 배열에 남겨 두어, 다시 켰을 때 원래 자리로 돌아온다. */

const RADIAL_ORDER_KEY = 'tip.radialOrder.v1';

export function getRadialOrder() {
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(RADIAL_ORDER_KEY) || 'null');
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((id) => typeof id === 'string'))];
}

export function setRadialOrder(ids) {
  if (!Array.isArray(ids)) return;
  const next = [...new Set(ids.filter((id) => typeof id === 'string'))];
  try {
    localStorage.setItem(RADIAL_ORDER_KEY, JSON.stringify(next));
  } catch {
    /* 저장소를 못 쓰면 순서도 저장되지 않는다 */
  }
  notifyWindows();
}

export function hasRadialOrder() {
  return getRadialOrder().length > 0;
}

export function resetRadialOrder() {
  try {
    localStorage.removeItem(RADIAL_ORDER_KEY);
  } catch { /* 저장소를 못 쓰면 지울 것도 없다 */ }
  notifyWindows();
}

/* 반원 퀵바 순서 모드 — 'custom'(직접 정한 순서) | 'asc'(이름 오름차순) | 'desc'(내림차순).
   기본값 'custom' = 지금까지의 동작(메인 순서 또는 사용자가 바꾼 순서). (v1.10.0) */

const RADIAL_MODE_KEY = 'tip.radialOrderMode.v1';
export const RADIAL_MODES = ['custom', 'asc', 'desc'];

export function getRadialOrderMode() {
  try {
    const value = localStorage.getItem(RADIAL_MODE_KEY);
    return RADIAL_MODES.includes(value) ? value : 'custom';
  } catch {
    return 'custom';
  }
}

export function setRadialOrderMode(mode) {
  if (!RADIAL_MODES.includes(mode)) return;
  try {
    localStorage.setItem(RADIAL_MODE_KEY, mode);
  } catch { /* 저장하지 못하면 이번에만 적용된다 */ }
  notifyWindows();
}

/** 다른 창(반원 퀵바)에서 바뀐 설정을 다시 읽도록 캐시를 비운다. */
export function syncStore() {
  cache = null;
  orderCache = null;
  // v1.12.2 — 노치 위젯 설정 캐시도 버린다. 이걸 빼먹어서 환경설정에서 위젯을 꺼도
  // 노치 창은 예전 목록을 그대로 그리고 있었다(모듈 실행이 사라지지 않던 원인).
  notchCache = null;
}

/* 메뉴 막대에 표시 — Mac 앱의 트레이 아이콘을 보일지. 기본값 ON. (v1.10.0) */

const MENUBAR_KEY = 'tip.menuBarVisible.v1';

export function getMenuBarVisible() {
  try {
    const saved = localStorage.getItem(MENUBAR_KEY);
    return saved === null ? true : saved === '1';
  } catch {
    return true;
  }
}

export function setMenuBarVisible(visible) {
  try {
    localStorage.setItem(MENUBAR_KEY, visible ? '1' : '0');
  } catch { /* 저장하지 못하면 이번 실행에만 적용된다 */ }
}

/* 메뉴 도구(반원 퀵바) 투명도 — 판 배경의 불투명도(%), 35~100. 기본 92. (v1.11.0) */

const QUICKBAR_OPACITY_KEY = 'tip.quickbarOpacity.v1';
export const QUICKBAR_OPACITY_MIN = 35;
export const QUICKBAR_OPACITY_MAX = 100;
export const QUICKBAR_OPACITY_DEFAULT = 92;

/** 저장된 값을 35~100 정수로 맞춰 돌려준다. 값이 없거나 이상하면 92. */
export function getQuickbarOpacity() {
  try {
    const saved = localStorage.getItem(QUICKBAR_OPACITY_KEY);
    if (saved === null) return QUICKBAR_OPACITY_DEFAULT;
    const value = Number(saved);
    if (!Number.isFinite(value)) return QUICKBAR_OPACITY_DEFAULT;
    return Math.round(Math.min(QUICKBAR_OPACITY_MAX, Math.max(QUICKBAR_OPACITY_MIN, value)));
  } catch {
    return QUICKBAR_OPACITY_DEFAULT;
  }
}

export function setQuickbarOpacity(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return;
  const clamped = Math.round(Math.min(QUICKBAR_OPACITY_MAX, Math.max(QUICKBAR_OPACITY_MIN, value)));
  try {
    localStorage.setItem(QUICKBAR_OPACITY_KEY, String(clamped));
  } catch { /* 저장하지 못하면 이번에만 적용된다 */ }
}

/* 노치 아일랜드 — macOS 앱 전용. 노치 자체와 위젯별 표시를 따로 켜고 끈다. (v1.12.1)
   값: { enabled: boolean, widgets: { media, calendar, shelf, timer, memo, mirror, launcher } }
   기본값: 노치 자체와 '미디어·캘린더·웹캠 거울' 위젯은 OFF. 미디어·캘린더는 osascript 와
   macOS 권한(TCC)을 부르고 거울은 카메라를 열기 때문에, 사용자가 환경설정에서 켰을 때만
   동작한다. 나머지(임시 보관함·타이머·빠른 메모·모듈 실행)는 권한 없이 가볍게 돌아 기본 ON. */

const NOTCH_KEY = 'tip.notch.v1';

export const NOTCH_WIDGETS = [
  { id: 'media', label: '미디어', hint: '지금 재생 중인 곡과 재생, 이전, 다음' },
  { id: 'calendar', label: '캘린더', hint: '오늘 다가오는 일정' },
  { id: 'shelf', label: '임시 보관함', hint: '끌어다 놓은 파일 보관과 바로 변환' },
  { id: 'timer', label: '타이머', hint: '한 번에 도는 미니 타이머' },
  { id: 'memo', label: '빠른 메모', hint: '한 줄 메모' },
  { id: 'mirror', label: '웹캠 거울', hint: '카메라 화면을 거울처럼' },
  { id: 'launcher', label: '모듈 실행', hint: '켜 둔 모듈을 노치에서 바로 실행' },
];

let notchCache = null;

/* 위젯 기본값 — 권한이 필요한 미디어·캘린더·거울만 OFF. (v1.12.1) */
const NOTCH_WIDGET_DEFAULTS = {
  media: false,
  calendar: false,
  shelf: true,
  timer: true,
  memo: true,
  mirror: false,
  launcher: true,
};

export function getNotchSettings() {
  if (notchCache) return notchCache;
  let parsed = null;
  try {
    parsed = JSON.parse(localStorage.getItem(NOTCH_KEY) || 'null');
  } catch {
    parsed = null;
  }
  const saved = parsed && typeof parsed === 'object' ? parsed : {};
  const widgets = {};
  NOTCH_WIDGETS.forEach(({ id }) => {
    const value = saved.widgets ? saved.widgets[id] : undefined;
    widgets[id] = typeof value === 'boolean' ? value : NOTCH_WIDGET_DEFAULTS[id] !== false;
  });
  notchCache = { enabled: saved.enabled === true, hoverOpen: saved.hoverOpen === true, widgets };
  return notchCache;
}

function writeNotch(next) {
  notchCache = next;
  try {
    localStorage.setItem(NOTCH_KEY, JSON.stringify(next));
  } catch { /* 저장하지 못하면 이번 실행에만 적용된다 */ }
  notifyWindows();
}

export function setNotchEnabled(enabled) {
  const current = getNotchSettings();
  writeNotch({ ...current, enabled: !!enabled });
}

export function setNotchWidget(id, on) {
  if (!NOTCH_WIDGETS.some((widget) => widget.id === id)) return;
  const current = getNotchSettings();
  writeNotch({ ...current, widgets: { ...current.widgets, [id]: !!on } });
}

/* 마우스를 올려서 열기 — 기본 OFF(v1.12.3). 다른 앱을 쓰다 지나가듯 올려도 화면을 가리지 않게
   펼침은 클릭으로만 두고, 원하는 사람만 켜서 쓴다. */
export function setNotchHoverOpen(on) {
  const current = getNotchSettings();
  writeNotch({ ...current, hoverOpen: !!on });
}

/* 전역 빠른 실행 검색 단축키 — macOS 앱이 이 값을 그대로 등록한다. (v1.12.0)
   표기: 'Alt+Space' · 'CmdOrCtrl+Shift+K' 같은 Tauri accelerator 문자열. */

const SEARCH_SHORTCUT_KEY = 'tip.searchShortcut.v1';
export const SEARCH_SHORTCUT_DEFAULT = 'Alt+Space';

export function getSearchShortcut() {
  try {
    const saved = localStorage.getItem(SEARCH_SHORTCUT_KEY);
    return saved && saved.trim() ? saved.trim() : SEARCH_SHORTCUT_DEFAULT;
  } catch {
    return SEARCH_SHORTCUT_DEFAULT;
  }
}

export function setSearchShortcut(accelerator) {
  const value = String(accelerator || '').trim();
  if (!value) return;
  try {
    localStorage.setItem(SEARCH_SHORTCUT_KEY, value);
  } catch { /* 저장하지 못하면 이번 실행에만 적용된다 */ }
}

/* 다른 탭·창에서 설정을 바꾸면 이 창도 새 값을 읽는다. */
try {
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key === KEY || event.key === ORDER_KEY || event.key === RADIAL_ORDER_KEY || event.key === MENUBAR_KEY || event.key === RADIAL_MODE_KEY || event.key === QUICKBAR_OPACITY_KEY || event.key === NOTCH_KEY) {
      cache = null;
      orderCache = null;
      notchCache = null;
    }
  });
} catch { /* window 가 없는 환경 */ }

/* theme: 'light' | 'dark' | null (= follow system) */

const THEME_KEY = 'tip.theme';
const ACCENT_KEY = 'tip.accent';

export const ACCENTS = [
  { id: 'green', label: '딥그린' },
  { id: 'blue', label: '블루' },
  { id: 'purple', label: '퍼플' },
  { id: 'orange', label: '오렌지' },
  { id: 'rose', label: '로즈' },
  { id: 'slate', label: '슬레이트' },
];

export function getAccent() {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.some((a) => a.id === saved) ? saved : 'green';
  } catch {
    return 'green';
  }
}

export function setAccent(id) {
  const value = ACCENTS.some((a) => a.id === id) ? id : 'green';
  try {
    localStorage.setItem(ACCENT_KEY, value);
  } catch { /* persistence is best-effort */ }
  document.documentElement.setAttribute('data-accent', value);
  notifyWindows();
}

export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

export function setTheme(value) {
  try {
    if (value === 'light' || value === 'dark') localStorage.setItem(THEME_KEY, value);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    /* storage unavailable — theme just won't persist */
  }
  applyTheme(value);
  notifyWindows();
}

export function currentDark() {
  const saved = getTheme();
  if (saved) return saved === 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(value) {
  const dark = value ? value === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  /* theme-color 는 브랜드 딥그린(#2E5E4E) 고정 — index.html 의 meta 값을 그대로 둔다 */
  document.documentElement.setAttribute('data-accent', getAccent());
}
