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
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', dark ? '#0D0D10' : '#F2F2F7');
  document.documentElement.setAttribute('data-accent', getAccent());
}
