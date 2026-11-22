/* Persisted shell settings (module enabled / pinned flags). */

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
