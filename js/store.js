/* Persisted shell settings (modules, theme, accent). */

const KEY = 'tip.settings.v1';

const defaults = { modules: {} };

let cache = null;

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

/* 홈 카드 순서 — 섹션별 module id 배열. (v1.8.0)
   { pinned: [...], docs: [...], media: [...], utility: [...] }
   배열에 없는 모듈(새로 추가된 모듈)은 원래(레지스트리) 순서대로 뒤에 붙는다. */

const ORDER_KEY = 'tip.order.v1';
export const ORDER_SECTIONS = ['pinned', 'docs', 'media', 'utility'];

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
}

function writeOrder(order) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* private mode / quota — 순서는 저장되지 않는다 */
  }
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
}

export function hasRadialOrder() {
  return getRadialOrder().length > 0;
}

export function resetRadialOrder() {
  try {
    localStorage.removeItem(RADIAL_ORDER_KEY);
  } catch { /* 저장소를 못 쓰면 지울 것도 없다 */ }
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
}

/** 다른 창(반원 퀵바)에서 바뀐 설정을 다시 읽도록 캐시를 비운다. */
export function syncStore() {
  cache = null;
  orderCache = null;
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

/* 다른 탭·창에서 설정을 바꾸면 이 창도 새 값을 읽는다. */
try {
  window.addEventListener('storage', (event) => {
    if (!event.key || event.key === KEY || event.key === ORDER_KEY || event.key === RADIAL_ORDER_KEY || event.key === MENUBAR_KEY || event.key === RADIAL_MODE_KEY) {
      cache = null;
      orderCache = null;
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
