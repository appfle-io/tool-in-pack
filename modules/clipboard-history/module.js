/**
 * TIP · 클립보드 히스토리 (clipboard-history) — v1.12.0
 *
 * macOS 앱에서는 Rust 백그라운드가 0.9초마다 클립보드를 살펴 텍스트·이미지를 최대 100개까지
 * 기기에만 저장한다(연속 중복 제외). 브라우저(PWA)는 보안 정책상 백그라운드 감시가 안 되므로
 * 붙여넣기로 직접 보관하는 방식만 제공한다.
 *
 * 저장 위치
 * - Mac 앱: 앱 데이터 폴더의 clipboard.json (Rust 가 읽고 쓴다)
 * - 웹: localStorage 'tip.clipboard.v1'
 *
 * 항목: { id, kind: 'text'|'image', text, png(base64)|dataUrl, w, h, pinned, created }
 */

import { formatBytes, icons } from '../../js/ui.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const WEB_KEY = 'tip.clipboard.v1';
const LIMIT = 100;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CLIP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4.5" width="12" height="16.5" rx="2.2"/><path d="M9 4.5V3.6A1.6 1.6 0 0 1 10.6 2h2.8A1.6 1.6 0 0 1 15 3.6v.9"/><path d="M9.2 10.5h5.6M9.2 14h5.6M9.2 17.4h3.4"/></svg>';

const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'text', label: '텍스트' },
  { id: 'image', label: '이미지' },
  { id: 'pinned', label: '고정' },
];

/* ------------------------------ 저장소 ------------------------------ */

let nextId = Date.now();

function newId() {
  nextId += 1;
  return `${nextId}-${Math.random().toString(36).slice(2, 7)}`;
}

function readWeb() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WEB_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
}

function writeWeb(items) {
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn('[TIP clipboard-history] 저장 공간이 부족합니다', error);
  }
}

/** 고정 항목을 지키면서 최근 100개만 남긴다. */
function trim(items) {
  if (items.length <= LIMIT) return items;
  const pinned = items.filter((item) => item.pinned);
  const rest = items.filter((item) => !item.pinned);
  return pinned.concat(rest.slice(0, Math.max(0, LIMIT - pinned.length)));
}

function invoke(command, args) {
  return window.__TAURI__.core.invoke(command, args || {});
}

async function loadItems() {
  if (TAURI) {
    try {
      const items = await invoke('clipboard_list');
      return Array.isArray(items) ? items : [];
    } catch (error) {
      console.error('[TIP clipboard-history] 목록을 불러오지 못했습니다', error);
      return [];
    }
  }
  return readWeb();
}

/* ------------------------------ 화면 ------------------------------ */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function relativeTime(stamp) {
  const diff = Date.now() - Number(stamp || 0);
  if (!Number.isFinite(diff) || diff < 0) return '';
  if (diff < 60 * 1000) return '방금';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
  const date = new Date(Number(stamp));
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return time;
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === yesterday.toDateString()) return `어제 ${time}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${time}`;
}

function imageSrc(item) {
  if (item.dataUrl) return item.dataUrl;
  if (item.png) return `data:image/png;base64,${item.png}`;
  return '';
}

function byteSize(item) {
  if (item.kind === 'image') return item.bytes || 0;
  return new TextEncoder().encode(item.text || '').length;
}

function mount(root, ctx) {
  const controller = new AbortController();
  const { signal } = controller;

  let items = [];
  let filter = 'all';
  let query = '';
  let busy = false;
  let armedClear = false;
  let armedTimer = null;

  root.innerHTML = `
    <section class="clip">
      <header class="clip-head">
        <div class="clip-title">
          <span class="clip-title-icon" aria-hidden="true">${CLIP_ICON}</span>
          <p class="clip-lead">
            복사한 텍스트와 이미지를 최대 100개까지 보관합니다.
            <span class="mac-badge" title="Mac 앱 전용 자동 기록">Mac</span>
          </p>
        </div>
        <div class="clip-count"><b id="clip-total">0</b> / ${LIMIT}</div>
      </header>

      ${TAURI ? '' : `
      <p class="notice clip-web-note">
        브라우저에서는 백그라운드 자동 기록이 되지 않습니다. <b>Mac 앱</b>에서 복사할 때마다 자동으로 기록되며,
        여기에서는 아래에 붙여넣어 직접 보관할 수 있습니다.
      </p>`}

      <div class="clip-tools">
        <label class="clip-search">
          <span class="clip-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          </span>
          <input id="clip-query" type="search" placeholder="내용으로 검색" autocomplete="off" aria-label="클립보드 내용 검색">
        </label>
        <div class="clip-filters" role="group" aria-label="종류 필터">
          ${FILTERS.map(({ id, label }) => `
            <button class="clip-filter${id === 'all' ? ' is-on' : ''}" type="button" data-filter="${id}" aria-pressed="${id === 'all'}">${label}</button>
          `).join('')}
        </div>
      </div>

      <div class="clip-add">
        <textarea id="clip-input" rows="2" placeholder="${TAURI ? '직접 보관할 텍스트를 붙여넣으세요 (이미지도 붙여넣기 가능)' : '붙여넣기(Cmd/Ctrl+V)로 직접 보관하기. 텍스트나 이미지'}"></textarea>
        <div class="clip-add-actions">
          <button id="clip-save" class="primary-btn ghost" type="button">보관</button>
        </div>
      </div>

      <div id="clip-list" class="clip-list" role="list"></div>
      <p id="clip-empty" class="dr-empty" hidden>
        <span class="dr-empty-icon" aria-hidden="true">${CLIP_ICON}</span>
        <b>아직 보관한 항목이 없습니다</b>
        <span>${TAURI ? '무언가를 복사하면 자동으로 여기에 쌓입니다.' : 'Mac 앱에서 자동으로 기록되며, 여기에서는 붙여넣기로 보관합니다.'}</span>
      </p>

      <footer class="clip-foot">
        <span id="clip-hint" class="clip-hint">고정한 항목은 지우기 전까지 남습니다.</span>
        <button id="clip-clear" class="clip-clear" type="button">전체 삭제</button>
      </footer>
    </section>
  `;

  const listEl = root.querySelector('#clip-list');
  const emptyEl = root.querySelector('#clip-empty');
  const totalEl = root.querySelector('#clip-total');
  const queryEl = root.querySelector('#clip-query');
  const inputEl = root.querySelector('#clip-input');
  const clearBtn = root.querySelector('#clip-clear');
  const hintEl = root.querySelector('#clip-hint');
  const saveBtn = root.querySelector('#clip-save');

  /* ------------------------------ 그리기 ------------------------------ */

  function visibleItems() {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'text' && item.kind !== 'text') return false;
      if (filter === 'image' && item.kind !== 'image') return false;
      if (filter === 'pinned' && !item.pinned) return false;
      if (!q) return true;
      if (item.kind === 'text') return String(item.text || '').toLowerCase().includes(q);
      return 'image 이미지 사진'.includes(q) || String(item.name || '').toLowerCase().includes(q);
    });
  }

  function render() {
    // 고정 → 최신 순.
    const ordered = items.slice().sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.created - a.created));
    const shown = visibleItems().slice().sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.created - a.created));

    totalEl.textContent = String(items.length);
    emptyEl.hidden = shown.length > 0;
    emptyEl.querySelector('b').textContent = items.length
      ? '조건에 맞는 항목이 없습니다'
      : '아직 보관한 항목이 없습니다';
    emptyEl.querySelector('span:last-child').textContent = items.length
      ? '검색어나 필터를 바꿔 보세요.'
      : (TAURI ? '무언가를 복사하면 자동으로 여기에 쌓입니다.' : 'Mac 앱에서 자동으로 기록되며, 여기에서는 붙여넣기로 보관합니다.');

    listEl.innerHTML = ordered.length === shown.length ? '' : listEl.innerHTML;
    // 위 정렬과 같은 순서로 그린다 — 보이는 항목만.
    if (ordered.length === items.length) listEl.innerHTML = '';

    shown.forEach((item) => {
      const row = document.createElement('article');
      row.className = `clip-item${item.pinned ? ' is-pinned' : ''}`;
      row.setAttribute('role', 'listitem');
      row.dataset.id = item.id;

      const preview = item.kind === 'image'
        ? `<div class="clip-thumb"><img src="${imageSrc(item)}" alt="보관한 이미지" loading="lazy"></div>
           <div class="clip-body"><p class="clip-text clip-text-image">이미지 ${item.w && item.h ? `${item.w}×${item.h}` : ''} ${byteSize(item) ? `, ${formatBytes(byteSize(item))}` : ''}</p></div>`
        : `<div class="clip-body"><p class="clip-text">${escapeHtml(String(item.text || '').slice(0, 600))}</p></div>`;

      row.innerHTML = `
        ${preview}
        <div class="clip-meta">
          <span class="clip-time">${relativeTime(item.created)}</span>
          <div class="clip-actions">
            <button class="icon-btn clip-pin${item.pinned ? ' is-on' : ''}" type="button" data-act="pin"
              aria-pressed="${item.pinned}" aria-label="${item.pinned ? '고정 해제' : '고정'}" title="${item.pinned ? '고정 해제' : '고정'}">
              ${icons.pin}
            </button>
            <button class="icon-btn" type="button" data-act="copy" aria-label="클립보드로 복사" title="복사">${icons.copy || COPY_ICON}</button>
            <button class="icon-btn clip-del" type="button" data-act="delete" aria-label="삭제" title="삭제">${icons.trash || TRASH_ICON}</button>
          </div>
        </div>
      `;

      row.querySelector('[data-act="copy"]').addEventListener('click', (event) => {
        event.stopPropagation();
        copyItem(item);
      }, { signal });
      row.querySelector('[data-act="pin"]').addEventListener('click', (event) => {
        event.stopPropagation();
        togglePin(item);
      }, { signal });
      row.querySelector('[data-act="delete"]').addEventListener('click', (event) => {
        event.stopPropagation();
        removeItem(item);
      }, { signal });

      row.addEventListener('click', () => copyItem(item), { signal });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          copyItem(item);
        }
      }, { signal });
      row.tabIndex = 0;

      listEl.append(row);
    });
  }

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"/></svg>';
  const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M6.5 7 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/><path d="M10.5 11v5.5M13.5 11v5.5"/></svg>';

  /* ------------------------------ 동작 ------------------------------ */

  async function refresh() {
    items = await loadItems();
    render();
  }

  function commitWeb(next) {
    items = trim(next);
    writeWeb(items);
    render();
  }

  async function copyItem(item) {
    try {
      if (TAURI) {
        await invoke('clipboard_copy', { id: item.id });
      } else if (item.kind === 'image' && imageSrc(item)) {
        const blob = await (await fetch(imageSrc(item))).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      } else {
        await navigator.clipboard.writeText(String(item.text || ''));
      }
      ctx.toast('클립보드에 복사했습니다');
      items = items.map((entry) => (entry.id === item.id ? { ...entry, created: Date.now() } : entry));
      render();
    } catch (error) {
      console.error('[TIP clipboard-history] 복사하지 못했습니다', error);
      ctx.toast('클립보드에 복사하지 못했습니다');
    }
  }

  async function togglePin(item) {
    const next = !item.pinned;
    if (TAURI) {
      try {
        await invoke('clipboard_pin', { id: item.id, pinned: next });
        await refresh();
        ctx.toast(next ? '고정했습니다' : '고정을 해제했습니다');
      } catch (error) {
        console.error('[TIP clipboard-history] 고정하지 못했습니다', error);
        ctx.toast('고정 상태를 바꾸지 못했습니다');
      }
      return;
    }
    commitWeb(items.map((entry) => (entry.id === item.id ? { ...entry, pinned: next } : entry)));
    ctx.toast(next ? '고정했습니다' : '고정을 해제했습니다');
  }

  async function removeItem(item) {
    if (TAURI) {
      try {
        await invoke('clipboard_delete', { id: item.id });
        await refresh();
      } catch (error) {
        console.error('[TIP clipboard-history] 삭제하지 못했습니다', error);
        ctx.toast('삭제하지 못했습니다');
      }
      return;
    }
    commitWeb(items.filter((entry) => entry.id !== item.id));
  }

  async function clearAll() {
    if (!armedClear) {
      armedClear = true;
      clearBtn.textContent = '정말 삭제할까요?';
      hintEl.textContent = '고정한 항목도 함께 지워집니다. 한 번 더 누르면 삭제합니다.';
      clearTimeout(armedTimer);
      armedTimer = setTimeout(() => {
        armedClear = false;
        clearBtn.textContent = '전체 삭제';
        hintEl.textContent = '고정한 항목은 지우기 전까지 남습니다.';
      }, 4000);
      return;
    }
    clearTimeout(armedTimer);
    armedClear = false;
    clearBtn.textContent = '전체 삭제';
    hintEl.textContent = '고정한 항목은 지우기 전까지 남습니다.';
    if (TAURI) {
      try {
        await invoke('clipboard_clear');
        await refresh();
        ctx.toast('클립보드 기록을 비웠습니다');
      } catch (error) {
        console.error('[TIP clipboard-history] 비우지 못했습니다', error);
        ctx.toast('기록을 비우지 못했습니다');
      }
      return;
    }
    commitWeb([]);
    ctx.toast('클립보드 기록을 비웠습니다');
  }

  async function addText(text) {
    const value = String(text || '').trim();
    if (!value) return;
    if (TAURI) {
      try {
        await invoke('clipboard_add_text', { text: value });
        await refresh();
        ctx.toast('보관했습니다');
      } catch (error) {
        console.error('[TIP clipboard-history] 보관하지 못했습니다', error);
        ctx.toast('보관하지 못했습니다');
      }
      return;
    }
    if (items.some((item) => item.kind === 'text' && item.text === value)) {
      ctx.toast('이미 보관된 내용입니다');
      return;
    }
    commitWeb([{ id: newId(), kind: 'text', text: value, pinned: false, created: Date.now() }, ...items]);
    ctx.toast('보관했습니다');
  }

  async function addImageFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    if (file.size > MAX_IMAGE_BYTES) {
      ctx.toast('8MB가 넘는 이미지는 보관하지 않습니다');
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const size = await imageSize(dataUrl);
    if (TAURI) {
      const base64 = dataUrl.split(',')[1] || '';
      try {
        await invoke('clipboard_add_image', { png: base64, width: size.w, height: size.h });
        await refresh();
        ctx.toast('이미지를 보관했습니다');
      } catch (error) {
        console.error('[TIP clipboard-history] 이미지를 보관하지 못했습니다', error);
        ctx.toast('이미지를 보관하지 못했습니다');
      }
      return;
    }
    commitWeb([{
      id: newId(), kind: 'image', dataUrl, w: size.w, h: size.h, bytes: Math.round(file.size),
      pinned: false, created: Date.now(),
    }, ...items]);
    ctx.toast('이미지를 보관했습니다');
  }

  function imageSize(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = src;
    });
  }

  /* ------------------------------ 이벤트 ------------------------------ */

  queryEl.addEventListener('input', () => {
    query = queryEl.value;
    render();
  }, { signal });

  root.querySelectorAll('.clip-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      root.querySelectorAll('.clip-filter').forEach((other) => {
        const on = other === btn;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-pressed', String(on));
      });
      render();
    }, { signal });
  });

  saveBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const value = inputEl.value;
    inputEl.value = '';
    await addText(value);
    busy = false;
  }, { signal });

  inputEl.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) return;
    const files = Array.from(data.files || []).filter((file) => /^image\//.test(file.type));
    if (files.length) {
      event.preventDefault();
      addImageFile(files[0]);
    }
  }, { signal });

  clearBtn.addEventListener('click', clearAll, { signal });

  // 상대 시간은 1분마다 다시 그린다.
  const tick = setInterval(() => { if (!document.hidden) render(); }, 60000);

  if (TAURI && window.__TAURI__.event) {
    window.__TAURI__.event.listen('tip://clipboard-changed', () => { refresh(); });
  }

  const onStorage = (event) => {
    if (event.key === WEB_KEY) refresh();
  };
  window.addEventListener('storage', onStorage, { signal });

  refresh();

  return () => {
    controller.abort();
    clearInterval(tick);
    clearTimeout(armedTimer);
  };
}

export default {
  id: 'clipboard-history',
  name: '클립보드 히스토리',
  shortName: '클립보드',
  subtitle: '복사한 텍스트와 이미지 최대 100개',
  description: '복사할 때마다 자동으로 모아 두고 검색하고 고정하고 다시 복사하는 일을 한 곳에서 합니다. 자동 기록은 Mac 앱에서만 됩니다.',
  icon: CLIP_ICON,
  version: '1.12.0',
  category: 'utility',
  badge: 'Mac',
  defaultEnabled: true,
  defaultPinned: false,
  mount,
};
