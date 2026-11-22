/* TIP app shell — hash routing, home hub, theme, PWA install/SW plumbing. */

import { listModules, getModule } from '../modules/registry.js';
import { moduleState, setModuleState, getTheme, setTheme, applyTheme } from './store.js';
import { el, toast, icons } from './ui.js';

const view = document.getElementById('view');

/* ------------------------------ home hub ------------------------------ */

function renderHome() {
  view.innerHTML = '';

  const list = el('div', { class: 'module-list' });
  const mods = listModules().map((mod) => ({ mod, state: moduleState(mod) }));

  const pinned = mods.filter(({ state }) => state.pinned);
  const rest = mods.filter(({ state }) => !state.pinned);

  [...pinned, ...rest].forEach(({ mod, state }) => {
    list.append(moduleRow(mod, state));
  });

  view.append(list);
}

function moduleRow(mod, state) {
  const row = el('article', {
    class: `module-card${state.enabled ? '' : ' is-off'}`,
    role: 'button',
    tabindex: '0',
    'aria-label': `${mod.name} 열기`,
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
  }, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = !moduleState(mod).enabled;
    setModuleState(mod.id, { enabled: next });
    rerenderHome();
    toast(next ? `${mod.name} 사용 시작` : `${mod.name} 사용 중지`);
  });

  const pinBtn = el('button', {
    class: 'pin-btn',
    type: 'button',
    'aria-pressed': String(state.pinned),
    'aria-label': `${mod.name} 상단 고정`,
    html: icons.pin,
  });
  pinBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = !moduleState(mod).pinned;
    setModuleState(mod.id, { pinned: next });
    rerenderHome();
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

  row.append(
    el('div', { class: 'module-icon', html: mod.icon }),
    el('div', { class: 'module-title' }, [
      el('h2', { text: mod.name }),
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

function rerenderHome() {
  const hash = (location.hash || '#/').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!hash) renderHome();
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

const themeBtn = document.getElementById('theme-btn');
applyTheme(getTheme());

themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  setTheme(dark ? 'light' : 'dark');
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
