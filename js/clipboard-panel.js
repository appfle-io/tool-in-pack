/* TIP · 클립보드 히스토리 패널 (v1.23.0)
 *
 * 단축키로 열리는 Spotlight형 패널의 화면. 빠른 실행 검색(search.js)과 같은 방식이다.
 *   · Mac 앱 — Rust 가 0.9초마다 살펴 둔 기록(clipboard_list)을 읽고, Enter 로 clipboard_copy.
 *   · 웹(PWA) — localStorage 'tip.clipboard.v1' 에 붙여넣기로 담아 둔 기록을 쓴다.
 *
 * 조작: ↑↓ 이동 · Enter 복사하고 닫기 · Esc 닫기 · P 고정 · ⌫ 지우기.
 * 창은 실제로 닫히지 않는다(Rust 가 hide 만 한다) — 다시 단축키를 누르면 그 자리에 다시 뜬다.
 */

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const CORE = TAURI ? window.__TAURI__.core : null;
const WEB_KEY = 'tip.clipboard.v1';

const searchEl = document.getElementById('clip-search');
const listEl = document.getElementById('clip-list');
const emptyEl = document.getElementById('clip-empty');
const statusEl = document.getElementById('clip-status');
const countEl = document.getElementById('clip-count');

const TEXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h12M4 18h8"/></svg>';
const IMAGE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 4.6-4.2a2 2 0 0 1 2.7 0L20 20"/></svg>';
const PIN_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.5 2.5a1 1 0 0 1 .9 1.5l-1.6 3.2 3 3a1 1 0 0 1-.4 1.7l-3.4.9-4.4 4.4.5 2.6a1 1 0 0 1-1.7.9l-4.8-4.8a1 1 0 0 1 .9-1.7l2.6.5 4.4-4.4.9-3.4a1 1 0 0 1 1.7-.4l3 3 3.2-1.6a1 1 0 0 1 1-.1z"/></svg>';
const PIN_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2.5a1 1 0 0 1 .9 1.5l-1.6 3.2 3 3a1 1 0 0 1-.4 1.7l-3.4.9-4.4 4.4.5 2.6a1 1 0 0 1-1.7.9l-4.8-4.8a1 1 0 0 1 .9-1.7l2.6.5 4.4-4.4.9-3.4a1 1 0 0 1 1.7-.4l3 3 3.2-1.6a1 1 0 0 1 1-.1z"/></svg>';

let items = [];
let filtered = [];
let active = 0;

/* ------------------------------ 저장소 ------------------------------ */

function readWeb() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WEB_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

async function loadItems() {
  if (TAURI) {
    try {
      items = await CORE.invoke('clipboard_list');
    } catch (error) {
      console.warn('[TIP clipboard panel]', error);
      items = [];
    }
  } else {
    items = readWeb();
  }
  if (!Array.isArray(items)) items = [];
  items = items.filter((item) => item && typeof item === 'object');
  // 고정한 항목이 먼저, 그 안에서는 최근 것부터(모듈 화면과 같은 순서).
  items.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (Number(b.created) || 0) - (Number(a.created) || 0);
  });
  applyFilter();
}

/* ------------------------------ 그리기 ------------------------------ */

function whenOf(ms) {
  const time = Number(ms) || 0;
  if (!time) return '';
  const date = new Date(time);
  const now = new Date();
  const diff = Date.now() - time;
  if (diff < 60 * 1000) return '방금';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
  const sameDay = date.toDateString() === now.toDateString();
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return clock;
  const yesterday = new Date(now.getTime() - 86400000);
  if (date.toDateString() === yesterday.toDateString()) return `어제 ${clock}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function previewText(item) {
  if (item.kind === 'image') return `이미지 ${item.w || ''}×${item.h || ''}`.trim();
  return String(item.text || '').replace(/\s+/g, ' ').trim() || '(빈 항목)';
}

function applyFilter() {
  const query = searchEl.value.trim().toLowerCase();
  filtered = query
    ? items.filter((item) => `${item.text || ''} ${item.kind || ''}`.toLowerCase().includes(query))
    : items.slice();
  if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
  render();
}

function render() {
  listEl.innerHTML = '';
  filtered.forEach((item, index) => {
    const isImage = item.kind === 'image';
    const row = document.createElement('li');
    row.className = `clip-row${index === active ? ' is-active' : ''}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', index === active ? 'true' : 'false');
    row.dataset.index = String(index);

    const kind = document.createElement('span');
    kind.className = 'clip-kind';
    kind.innerHTML = isImage ? IMAGE_ICON : TEXT_ICON;

    let thumb = null;
    if (isImage && item.png) {
      thumb = document.createElement('img');
      thumb.className = 'clip-thumb';
      thumb.alt = '';
      thumb.src = `data:image/png;base64,${item.png}`;
    }

    const main = document.createElement('div');
    main.className = 'clip-main';
    const text = document.createElement('div');
    text.className = 'clip-text';
    text.textContent = previewText(item);
    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    const pieces = [whenOf(item.created)];
    if (item.pinned) pieces.push('고정');
    if (isImage && item.bytes) pieces.push(`${Math.round(Number(item.bytes) / 1024)}KB`);
    meta.textContent = pieces.filter(Boolean).join(' · ');
    main.append(text, meta);

    const pin = document.createElement('button');
    pin.className = `clip-pin${item.pinned ? ' is-on' : ''}`;
    pin.type = 'button';
    pin.setAttribute('aria-label', item.pinned ? '고정 풀기' : '고정');
    pin.setAttribute('aria-pressed', item.pinned ? 'true' : 'false');
    pin.innerHTML = item.pinned ? PIN_ICON : PIN_OUTLINE;
    pin.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePin(item);
    });

    row.append(kind, ...(thumb ? [thumb] : []), main, pin);
    row.addEventListener('click', () => { active = index; copyItem(item); });
    row.addEventListener('mousemove', () => {
      if (active === index) return;
      active = index;
      markActive();
    });
    listEl.append(row);
  });

  emptyEl.hidden = filtered.length > 0;
  countEl.textContent = items.length ? `${filtered.length} / ${items.length}개` : '';
  const current = filtered[active];
  statusEl.textContent = current && searchEl.value.trim() ? '' : '';
  markActive();
}

function markActive() {
  for (const row of listEl.children) {
    const on = Number(row.dataset.index) === active;
    row.classList.toggle('is-active', on);
    row.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }
}

/* ------------------------------ 동작 ------------------------------ */

async function hide() {
  if (TAURI) {
    try { await CORE.invoke('hide_clipboard'); } catch { /* 창이 없으면 그만 */ }
    return;
  }
  window.close();
}

async function copyItem(item) {
  if (!item) return;
  try {
    if (TAURI) {
      await CORE.invoke('clipboard_copy', { id: item.id });
    } else if (item.kind === 'image') {
      statusEl.textContent = '이미지는 TIP Mac 앱에서 다시 복사할 수 있습니다';
      return;
    } else {
      await navigator.clipboard.writeText(String(item.text || ''));
    }
    const preview = previewText(item);
    statusEl.textContent = `${preview.length > 24 ? `${preview.slice(0, 24)}…` : preview} 복사함`;
    await hide();
  } catch (error) {
    console.warn('[TIP clipboard panel] 복사 실패', error);
    statusEl.textContent = '복사하지 못했습니다';
  }
}

async function togglePin(item) {
  const next = !item.pinned;
  item.pinned = next;
  try {
    if (TAURI) await CORE.invoke('clipboard_pin', { id: item.id, pinned: next });
    else {
      const saved = readWeb().map((entry) => (entry.id === item.id ? { ...entry, pinned: next } : entry));
      localStorage.setItem(WEB_KEY, JSON.stringify(saved));
    }
  } catch (error) {
    item.pinned = !next;
    console.warn('[TIP clipboard panel] 고정 실패', error);
    statusEl.textContent = '고정하지 못했습니다';
    return;
  }
  sortItems();
  render();
  statusEl.textContent = next ? '고정했습니다' : '고정을 풀었습니다';
}

async function removeItem(item) {
  if (!item) return;
  try {
    if (TAURI) await CORE.invoke('clipboard_delete', { id: item.id });
    else {
      const saved = readWeb().filter((entry) => entry.id !== item.id);
      localStorage.setItem(WEB_KEY, JSON.stringify(saved));
    }
  } catch (error) {
    console.warn('[TIP clipboard panel] 삭제 실패', error);
    statusEl.textContent = '지우지 못했습니다';
    return;
  }
  await loadItems();
  statusEl.textContent = '지웠습니다';
}

function sortItems() {
  items.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (Number(b.created) || 0) - (Number(a.created) || 0);
  });
}

/* ------------------------------ 입력 ------------------------------ */

searchEl.addEventListener('input', () => {
  active = 0;
  applyFilter();
});

document.addEventListener('keydown', (event) => {
  const key = event.key;
  if (key === 'Escape') {
    event.preventDefault();
    if (searchEl.value) {
      searchEl.value = '';
      active = 0;
      applyFilter();
      return;
    }
    hide();
    return;
  }
  if (key === 'ArrowDown') {
    event.preventDefault();
    if (!filtered.length) return;
    active = (active + 1) % filtered.length;
    markActive();
    return;
  }
  if (key === 'ArrowUp') {
    event.preventDefault();
    if (!filtered.length) return;
    active = (active - 1 + filtered.length) % filtered.length;
    markActive();
    return;
  }
  if (key === 'Enter') {
    event.preventDefault();
    copyItem(filtered[active]);
    return;
  }
  if (key === 'Backspace' || key === 'Delete') {
    if (document.activeElement === searchEl && searchEl.value) return;
    event.preventDefault();
    removeItem(filtered[active]);
    return;
  }
  if (key === 'p' || key === 'P') {
    if (document.activeElement === searchEl && searchEl.value) return;
    event.preventDefault();
    togglePin(filtered[active]);
  }
});

/* ------------------------------ 시작 ------------------------------ */

if (TAURI && window.__TAURI__.event) {
  window.__TAURI__.event.listen('tip://clipboard-refresh', () => {
    searchEl.value = '';
    active = 0;
    loadItems().then(() => searchEl.focus());
  });
}

loadItems().then(() => searchEl.focus());
searchEl.focus();
