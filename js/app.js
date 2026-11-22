/* TIP app shell — hash routing, home hub, theme, PWA install/SW plumbing. */

import { listModules, getModule, CATEGORIES, categoryOf } from '../modules/registry.js';
import { moduleState, setModuleState, getTheme, setTheme, applyTheme, getAccent, setAccent, ACCENTS } from './store.js';
import { el, toast, icons } from './ui.js';

const view = document.getElementById('view');

/* ------------------------------ home hub ------------------------------ */

function renderHome() {
  view.innerHTML = '';

  const mods = listModules().map((mod) => ({ mod, state: moduleState(mod) }));

  const pinned = mods.filter(({ state }) => state.pinned);
  const rest = mods.filter(({ state }) => !state.pinned);

  const sections = el('div', { class: 'home-sections' });

  // 고정된 모듈이 있을 때만 맨 위에 '고정됨' 섹션을 만든다.
  if (pinned.length) sections.append(homeSection('pinned', '고정됨', pinned));

  // 나머지는 registry 의 CATEGORIES 순서(문서 → 미디어 → 유틸리티)대로 묶는다.
  CATEGORIES.forEach(({ id, label }) => {
    const entries = rest.filter(({ mod }) => categoryOf(mod) === id);
    if (entries.length) sections.append(homeSection(id, label, entries));
  });

  view.append(sections);
}

function homeSection(id, label, entries) {
  return el('section', { class: 'home-section', 'data-section': id, 'aria-label': label }, [
    el('h2', { class: 'home-section-title' }, [
      el('span', { text: label }),
      el('span', { class: 'home-section-count', text: String(entries.length), 'aria-hidden': 'true' }),
    ]),
    el('div', { class: 'module-list' }, entries.map(({ mod, state }) => moduleRow(mod, state))),
  ]);
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
