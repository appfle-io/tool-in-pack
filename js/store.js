/* Persisted shell settings (module enabled / pinned flags, theme). */

import { icons } from './ui.js';

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
  document.querySelectorAll('#theme-btn').forEach((btn) => {
    btn.innerHTML = dark ? icons.sun : icons.moon;
    btn.setAttribute('aria-label', dark ? '라이트 모드로 전환' : '다크 모드로 전환');
    btn.title = btn.getAttribute('aria-label');
  });
}
