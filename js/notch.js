/* TIP · 노치 아일랜드 — macOS 화면 최상단 중앙(노치 자리)에 붙는 작은 창. v1.12.2
 *
 * 평소에는 노치 자리에 작은 알약으로 붙어 있다가, 마우스를 올리거나 파일을 끌어다 놓으면 펼쳐진다.
 * 창 크기와 위치는 Rust(mac/src-tauri) 가 바꾸고, 이 파일은 안쪽 화면만 담당한다.
 * 접힘/펼침은 창 너비로 판단한다 — Rust 가 접힘 240×28(노치 화면은 노치 높이), 펼침 452×600 으로 맞춘다.
 *
 * v1.12.2 수정
 *   · 환경설정에서 테마·기본 색·위젯·퀵바 순서를 바꾸면 tip://notch-refresh 를 받아 즉시 다시 그린다.
 *     (다른 창이라 storage 이벤트가 늘 닿지 않았다. 메인 창 js/store.js 가 값을 저장할 때 알린다.)
 *   · 펼칠 때마다 설정을 다시 읽어, 꺼 둔 위젯이 남아 있는 일을 없앴다.
 *   · Finder 파일 드롭은 Tauri 네이티브 이벤트(tip://shelf-drop = 경로 목록)로 받는다.
 *     HTML5 dataTransfer 로는 파일이 오지 않았다. 보관함을 클릭하면 파일 선택창도 열린다.
 *   · 빠른 메모를 클릭하면 notch_focus 로 창을 key window 로 만들어 바로 타이핑된다.
 */

import { getModule } from '../modules/registry.js';
import { quickOrderIds } from './quickbar.js';
import { getNotchSettings, syncStore, applyTheme, getTheme } from './store.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

const notchEl = document.getElementById('notch');
const pillEl = document.getElementById('pill');
const panelEl = document.getElementById('panel');
const widgetsEl = document.getElementById('widgets');
const emptyEl = document.getElementById('panel-empty');
const toastEl = document.getElementById('notch-toast');

let expanded = false;
let collapseTimer = null;
let heldOpen = false;         // 입력 중이거나 파일을 끌고 있는 동안에는 접지 않는다
let mediaTimer = null;
let calendarTimer = null;
let widgetsDelay = null;      // 펼친 뒤 위젯 조회를 조금 미루는 타이머
let mediaBusy = false;        // 조회가 끝나기 전에 또 부르지 않는다
let calendarBusy = false;
let expandedAt = 0;
let mediaPlaying = false;
let settingsRev = 0;          // 설정이 바뀔 때마다 +1 — 화면에 그린 마지막 상태와 비교한다
let renderedSignature = '';   // 마지막으로 그린 설정(저장값) — 펼칠 때마다 달라졌는지 싼 값으로 본다
let dragHeld = false;         // Finder 파일을 끌고 노치 위에 있는 동안에는 접지 않는다

/** 지금 저장된 설정을 한 줄로 요약한다 — 이벤트를 놓쳤어도 펼칠 때 달라졌는지 알 수 있다. */
function settingsSignature() {
  try {
    return [
      localStorage.getItem('tip.notch.v1') || '',
      localStorage.getItem('tip.theme') || '',
      localStorage.getItem('tip.accent') || '',
      localStorage.getItem('tip.settings.v1') || '',
      localStorage.getItem('tip.radialOrder.v1') || '',
      localStorage.getItem('tip.radialOrderMode.v1') || '',
    ].join('|');
  } catch {
    return String(settingsRev);
  }
}

/* ------------------------------ 모양(테마·색) ------------------------------ */

/** 저장된 테마·기본 색을 이 창에도 적용한다. 메인 창 설정이 바뀌면 즉시 다시 부른다. */
function applyAppearance() {
  applyTheme(getTheme());   // data-theme + data-accent(기본 색)를 함께 맞춘다
}

/* ------------------------------ 공통 ------------------------------ */

function invoke(command, args) {
  if (!TAURI) return Promise.resolve(null);
  return window.__TAURI__.core.invoke(command, args || {}).catch((error) => {
    console.error('[TIP notch]', command, error);
    throw error;
  });
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/* ------------------------------ 펼침/접힘 ------------------------------ */

function setExpanded(next, { animate = true } = {}) {
  if (expanded === next) return;
  expanded = next;
  if (next) expandedAt = Date.now();
  if (!animate) notchEl.classList.add('no-anim');
  notchEl.classList.toggle('is-collapsed', !next);
  notchEl.classList.toggle('is-expanded', next);

  if (next) {
    // 화면 전환(패널 그리기)을 먼저 끝내고 다음 프레임에 창 크기를 바꾼다.
    // 창 리사이즈와 위젯 조회가 같은 순간에 몰려 멈추지 않도록 조회는 startWidgets 가 미룬다.
    if (renderedSignature !== settingsSignature()) renderWidgets();
    applyAppearance();
    requestAnimationFrame(() => { invoke('notch_expand').catch(() => {}); });
    startWidgets();
  } else {
    invoke('notch_collapse').catch(() => {});
    stopWidgets();
    heldOpen = false;
  }
  if (!animate) requestAnimationFrame(() => notchEl.classList.remove('no-anim'));
}

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (heldOpen) return;
    if (dragHeld) return;
    if (document.querySelector('.mirror-video.is-live')) return;
    if (notchEl.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    setExpanded(false);
  }, 650);
}

function cancelCollapse() {
  clearTimeout(collapseTimer);
}

/* ------------------------------ 위젯 그리기 ------------------------------ */

function widgetCard(id, inner, className = '') {
  const card = document.createElement('section');
  card.className = `wg-card wg-${id} ${className}`.trim();
  card.dataset.widget = id;
  card.innerHTML = inner;
  return card;
}

function renderWidgets() {
  syncStore();
  const { widgets } = getNotchSettings();
  widgetsEl.innerHTML = '';

  let count = 0;
  const add = (node) => { widgetsEl.append(node); count += 1; };

  if (widgets.media) add(mediaCard());
  if (widgets.calendar) add(calendarCard());
  if (widgets.shelf) add(shelfCard());
  if (widgets.timer) add(timerCard());
  if (widgets.memo) add(memoCard());
  if (widgets.mirror) add(mirrorCard());
  if (widgets.launcher) add(launcherCard());

  emptyEl.hidden = count > 0;
  widgetsEl.hidden = count === 0;
  renderedSignature = settingsSignature();
}

/* 미디어 */

function mediaCard() {
  return widgetCard('media', `
    <div class="wg-head">
      <span class="wg-label">지금 재생 중</span>
      <span class="wg-side" id="media-app">—</span>
    </div>
    <div class="media-body">
      <div class="media-art" id="media-art" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>
      </div>
      <div class="media-text">
        <b id="media-title">재생 중인 곡이 없습니다</b>
        <span id="media-artist">Apple Music 또는 Spotify</span>
      </div>
      <div class="media-controls">
        <button class="media-btn" type="button" data-media="previous" aria-label="이전 곡" title="이전">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v14H7zM19 5v14l-9-7z"/></svg>
        </button>
        <button class="media-btn media-play" type="button" data-media="playpause" aria-label="재생·일시정지" title="재생·일시정지">
          <svg id="media-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="media-btn" type="button" data-media="next" aria-label="다음 곡" title="다음">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5h2v14h-2zM5 5v14l9-7z"/></svg>
        </button>
      </div>
    </div>
  `);
}

async function refreshMedia() {
  if (!TAURI || !expanded || mediaBusy) return;
  if (!getNotchSettings().widgets.media) return;
  const titleEl = panelEl.querySelector('#media-title');
  if (!titleEl) return;
  mediaBusy = true;
  try {
    const state = await invoke('media_state');
    const playing = !!(state && state.playing);
    mediaPlaying = playing;
    panelEl.querySelector('#media-app').textContent = state && state.app ? state.app : '—';
    titleEl.textContent = state && state.title ? state.title : '재생 중인 곡이 없습니다';
    panelEl.querySelector('#media-artist').textContent = state && state.artist
      ? state.artist
      : 'Apple Music 또는 Spotify';
    panelEl.querySelector('#media-icon').innerHTML = playing
      ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    const dot = document.getElementById('pill-dot');
    if (dot) dot.classList.toggle('is-playing', playing);
  } catch (error) {
    titleEl.textContent = '미디어 정보를 읽지 못했습니다';
    panelEl.querySelector('#media-artist').textContent = '음악 앱 접근 권한을 확인하세요';
  } finally {
    mediaBusy = false;
  }
}

/* 캘린더 */

function calendarCard() {
  return widgetCard('calendar', `
    <div class="wg-head">
      <span class="wg-label">다가오는 일정</span>
      <span class="wg-side">오늘</span>
    </div>
    <ul class="cal-list" id="cal-list"><li class="cal-empty">일정을 불러오는 중…</li></ul>
  `);
}

function clock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function relativeUntil(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diff)) return '';
  if (diff <= 0) return '진행 중';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}분 뒤`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 뒤`;
  return '내일';
}

async function refreshCalendar() {
  if (!TAURI || !expanded || calendarBusy) return;
  if (!getNotchSettings().widgets.calendar) return;
  const list = panelEl.querySelector('#cal-list');
  if (!list) return;
  calendarBusy = true;
  try {
    const events = await invoke('calendar_today');
    const rows = (Array.isArray(events) ? events : [])
      .filter((event) => event && event.start)
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .slice(0, 4);
    if (!rows.length) {
      list.innerHTML = '<li class="cal-empty">오늘 남은 일정이 없습니다</li>';
      return;
    }
    list.innerHTML = rows.map((event) => `
      <li class="cal-row">
        <span class="cal-bar" aria-hidden="true"></span>
        <span class="cal-text">
          <b>${escapeHtml(event.title || '(제목 없음)')}</b>
          <span>${clock(event.start)} · ${relativeUntil(event.start)}</span>
        </span>
      </li>
    `).join('');
  } catch (error) {
    list.innerHTML = '<li class="cal-empty">캘린더를 읽지 못했습니다 — macOS 캘린더 접근을 허용해 주세요</li>';
  } finally {
    calendarBusy = false;
  }
}

/* 임시 보관함 */

const shelf = [];   // { id, file, url }

function shelfCard() {
  const card = widgetCard('shelf', `
    <div class="wg-head">
      <span class="wg-label">임시 보관함</span>
      <span class="wg-side" id="shelf-count">0개</span>
    </div>
    <div class="shelf-drop" id="shelf-drop" role="button" tabindex="0" title="클릭해서 파일 고르기">
      <span class="shelf-drop-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
      </span>
      <b>파일을 끌어다 놓거나 클릭하세요</b>
      <span>잠깐 보관했다가 바로 변환·압축·모자이크</span>
    </div>
    <!-- v1.12.2 — 드래그가 막히는 환경에서도 담을 수 있게 클릭 선택을 함께 둔다. -->
    <input class="shelf-file-input" id="shelf-file" type="file" multiple tabindex="-1" aria-hidden="true">
    <div class="shelf-list" id="shelf-list"></div>
  `);
  requestAnimationFrame(() => {
    renderShelf();
    const picker = card.querySelector('#shelf-file');
    if (!picker) return;
    picker.addEventListener('change', () => {
      if (picker.files && picker.files.length) addFiles(picker.files);
      picker.value = '';   // 같은 파일을 다시 골라도 change 가 오게 비운다
    });
  });
  return card;
}

const CONVERTERS = [
  { id: 'img-converter', label: '변환', test: (file) => /^image\//.test(file.type) },
  { id: 'file-compress', label: '압축', test: (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name) },
  { id: 'photo-privacy', label: '모자이크', test: (file) => /^image\//.test(file.type) },
  { id: 'pdf-tools', label: 'PDF', test: (file) => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) },
  { id: 'video-gif', label: 'GIF', test: (file) => /^video\//.test(file.type) },
];

function renderShelf() {
  const list = panelEl.querySelector('#shelf-list');
  const count = panelEl.querySelector('#shelf-count');
  if (!list) return;
  if (count) count.textContent = `${shelf.length}개`;
  if (!shelf.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = '';
  shelf.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'shelf-item';
    const isImage = /^image\//.test(item.file.type);
    row.innerHTML = `
      ${isImage ? `<img class="shelf-thumb" src="${item.url}" alt="">` : `<span class="shelf-file" aria-hidden="true">${(item.file.name.split('.').pop() || '파일').slice(0, 4).toUpperCase()}</span>`}
      <span class="shelf-name" title="${escapeHtml(item.file.name)}">
        <b>${escapeHtml(item.file.name)}</b>
        <span>${(item.file.size / 1024 < 1024 ? `${Math.max(1, Math.round(item.file.size / 1024))} KB` : `${(item.file.size / 1048576).toFixed(1)} MB`)}</span>
      </span>
      <span class="shelf-actions"></span>
      <button class="shelf-remove" type="button" aria-label="${escapeHtml(item.file.name)} 빼기" title="빼기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    `;
    const actions = row.querySelector('.shelf-actions');
    CONVERTERS.filter((tool) => tool.test(item.file)).slice(0, 3).forEach((tool) => {
      const btn = document.createElement('button');
      btn.className = 'shelf-action';
      btn.type = 'button';
      btn.textContent = tool.label;
      btn.addEventListener('click', () => sendToModule(tool.id, item));
      actions.append(btn);
    });
    row.querySelector('.shelf-remove').addEventListener('click', () => {
      const index = shelf.indexOf(item);
      if (index >= 0) shelf.splice(index, 1);
      URL.revokeObjectURL(item.url);
      renderShelf();
    });
    list.append(row);
  });
}

function addFiles(files) {
  const list = Array.from(files || []).filter((file) => file && file.name);
  if (!list.length) return;
  list.forEach((file) => {
    if (shelf.length >= 8) return;
    shelf.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, url: URL.createObjectURL(file) });
  });
  renderShelf();
  toast(`${list.length}개를 임시 보관함에 담았습니다`);
  openHeld();
}

/* Finder 에서 끌어다 놓은 파일 — Rust 가 보내 준 경로 목록을 읽어 File 로 만든다.
   (v1.12.2 — HTML5 dataTransfer 대신 네이티브 드롭 경로. 읽기는 Rust read_shelf_file 이
    일반 파일·50MB 이하만 허용한다.) */

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  svg: 'image/svg+xml', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain',
  md: 'text/markdown', json: 'application/json', csv: 'text/csv',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
};

function mimeOf(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function addShelfPaths(paths) {
  const list = Array.isArray(paths) ? paths.filter((path) => typeof path === 'string' && path.trim()) : [];
  if (!list.length) return;
  if (!expanded) setExpanded(true);
  if (!panelEl.querySelector('#shelf-list')) {
    toast('환경설정에서 임시 보관함 위젯을 켜 주세요');
    return;
  }

  let added = 0;
  let problem = '';
  for (const path of list) {
    if (shelf.length >= 8) { problem = problem || '임시 보관함은 8개까지 담을 수 있습니다'; break; }
    try {
      const raw = await invoke('read_shelf_file', { path });
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw || 0);
      if (!bytes.length) throw new Error('빈 파일입니다');
      const name = String(path).split('/').pop() || 'file';
      const file = new File([bytes], name, { type: mimeOf(name) });
      shelf.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, url: URL.createObjectURL(file) });
      added += 1;
    } catch (error) {
      const message = typeof error === 'string' ? error : (error && error.message) || '파일을 읽지 못했습니다';
      problem = problem || message;
      console.error('[TIP notch] 보관함 파일을 읽지 못했습니다', path, error);
    }
  }

  renderShelf();
  if (added) toast(`${added}개를 임시 보관함에 담았습니다`);
  else toast(String(problem).slice(0, 90) || '파일을 담지 못했습니다');
  openHeld();
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sendToModule(moduleId, item) {
  const mod = getModule(moduleId);
  if (item.file.size > 3 * 1024 * 1024) {
    toast('3MB가 넘는 파일은 TIP 창에 직접 끌어다 놓아 주세요');
  }
  try {
    const dataUrl = item.file.size <= 3 * 1024 * 1024 ? await readDataUrl(item.file) : null;
    if (dataUrl) {
      localStorage.setItem('tip.handoff.v1', JSON.stringify({
        moduleId, name: item.file.name, type: item.file.type, dataUrl, created: Date.now(),
      }));
    }
    if (TAURI) {
      await invoke('open_tool', { id: moduleId, title: mod ? mod.name : moduleId });
      setExpanded(false);
    } else {
      location.href = `./index.html?module=${encodeURIComponent(moduleId)}`;
    }
    if (dataUrl) toast(`${mod ? mod.shortName || mod.name : moduleId}로 보냈습니다`);
  } catch (error) {
    console.error('[TIP notch] 보관함 파일을 보내지 못했습니다', error);
    toast('파일을 보내지 못했습니다');
  }
}

/* 타이머 */

let timerLeft = 0;
let timerTick = null;

function timerCard() {
  return widgetCard('timer', `
    <div class="wg-head">
      <span class="wg-label">타이머</span>
      <span class="wg-side" id="timer-side">대기</span>
    </div>
    <div class="timer-body">
      <b class="timer-display" id="timer-display">00:00</b>
      <div class="timer-row">
        <button class="timer-chip" type="button" data-min="1">1분</button>
        <button class="timer-chip" type="button" data-min="5">5분</button>
        <button class="timer-chip" type="button" data-min="10">10분</button>
        <button class="timer-btn" type="button" id="timer-toggle">시작</button>
      </div>
    </div>
  `);
}

function paintTimer() {
  const display = panelEl.querySelector('#timer-display');
  if (!display) return;
  const seconds = Math.max(0, Math.ceil(timerLeft));
  display.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  display.classList.toggle('is-running', timerLeft > 0 && !!timerTick);
  const side = panelEl.querySelector('#timer-side');
  if (side) side.textContent = timerTick ? '진행 중' : (timerLeft > 0 ? '일시정지' : '대기');
  const toggle = panelEl.querySelector('#timer-toggle');
  if (toggle) toggle.textContent = timerTick ? '일시정지' : (timerLeft > 0 ? '계속' : '시작');
}

function startTimer() {
  clearInterval(timerTick);
  timerTick = setInterval(() => {
    timerLeft = Math.max(0, timerLeft - 0.25);
    paintTimer();
    if (timerLeft <= 0) {
      clearInterval(timerTick);
      timerTick = null;
      paintTimer();
      toast('타이머가 끝났습니다');
      try {
        new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=').play();
      } catch { /* 소리는 못 내도 알림은 남는다 */ }
    }
  }, 250);
}

/* 빠른 메모 */

function memoCard() {
  let saved = '';
  try { saved = localStorage.getItem('tip.quickMemo.v1') || ''; } catch { saved = ''; }
  const card = widgetCard('memo', `
    <div class="wg-head">
      <span class="wg-label">빠른 메모</span>
      <span class="wg-side" id="memo-side"></span>
    </div>
    <textarea class="memo-input" id="memo-input" rows="3" placeholder="한 줄 메모 — 바로 저장됩니다">${escapeHtml(saved)}</textarea>
  `);
  requestAnimationFrame(() => {
    const input = card.querySelector('#memo-input');
    const side = card.querySelector('#memo-side');
    if (!input) return;
    const paint = () => { if (side) side.textContent = `${input.value.length}자`; };
    paint();
    let saveTimer = null;
    input.addEventListener('input', () => {
      paint();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem('tip.quickMemo.v1', input.value); } catch { /* 저장 못하면 이번만 */ }
      }, 350);
    });
    input.addEventListener('focus', () => {
      openHeld();
      // v1.12.2 — borderless NSPanel 은 스스로 key window 가 되지 못한다. 클릭한 순간
      // 창을 key window 로 만들어야 키보드 입력이 들어간다.
      invoke('notch_focus').catch(() => {});
    });
    input.addEventListener('mousedown', () => { invoke('notch_focus').catch(() => {}); });
    input.addEventListener('blur', () => { heldOpen = false; scheduleCollapse(); });
  });
  return card;
}

/* 웹캠 거울 */

function mirrorCard() {
  return widgetCard('mirror', `
    <div class="wg-head">
      <span class="wg-label">거울</span>
      <span class="wg-side" id="mirror-side">꺼짐</span>
    </div>
    <div class="mirror-body">
      <video class="mirror-video" id="mirror-video" playsinline muted></video>
      <button class="mirror-toggle" type="button" id="mirror-toggle">카메라 켜기</button>
    </div>
  `);
}

let mirrorStream = null;

async function toggleMirror() {
  const video = panelEl.querySelector('#mirror-video');
  const btn = panelEl.querySelector('#mirror-toggle');
  const side = panelEl.querySelector('#mirror-side');
  if (!video || !btn) return;
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
    video.srcObject = null;
    video.classList.remove('is-live');
    btn.textContent = '카메라 켜기';
    if (side) side.textContent = '꺼짐';
    heldOpen = false;
    scheduleCollapse();
    return;
  }
  try {
    mirrorStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = mirrorStream;
    await video.play().catch(() => {});
    video.classList.add('is-live');
    btn.textContent = '끄기';
    if (side) side.textContent = '켜짐';
    openHeld();
  } catch (error) {
    console.error('[TIP notch] 카메라를 열지 못했습니다', error);
    toast('카메라를 열 수 없습니다 — 시스템 설정에서 카메라 접근을 허용해 주세요');
  }
}

/* 모듈 실행 */

function launcherCard() {
  const card = widgetCard('launcher', `
    <div class="wg-head">
      <span class="wg-label">모듈 실행</span>
      <span class="wg-side">켜 둔 모듈</span>
    </div>
    <div class="launcher-row" id="launcher-row"></div>
  `, 'wg-wide');
  requestAnimationFrame(() => {
    const row = card.querySelector('#launcher-row');
    if (!row) return;
    const ids = quickOrderIds();
    if (!ids.length) {
      row.innerHTML = '<p class="launcher-empty">켜 둔 모듈이 없습니다</p>';
      return;
    }
    ids.forEach((id) => {
      const mod = getModule(id);
      if (!mod) return;
      const btn = document.createElement('button');
      btn.className = 'launcher-tile';
      btn.type = 'button';
      btn.title = mod.name;
      btn.innerHTML = `<span class="launcher-icon">${mod.icon || ''}</span><span>${escapeHtml(mod.shortName || mod.name)}</span>`;
      btn.addEventListener('click', async () => {
        try {
          if (TAURI) await invoke('open_tool', { id, title: mod.name });
          else location.href = `./index.html?module=${encodeURIComponent(id)}`;
          setExpanded(false);
        } catch (error) {
          console.error('[TIP notch] 모듈을 열지 못했습니다', error);
          toast('모듈을 열지 못했습니다');
        }
      });
      row.append(btn);
    });
  });
  return card;
}

/* ------------------------------ 위젯 생명주기 ------------------------------ */

function startWidgets() {
  // 창 크기 변경(notch_expand)과 무거운 조회가 겹치지 않도록 첫 조회는 다음 프레임 뒤로 미룬다.
  clearTimeout(widgetsDelay);
  widgetsDelay = setTimeout(() => {
    if (!expanded) return;
    refreshMedia();
    refreshCalendar();
  }, 220);
  clearInterval(mediaTimer);
  clearInterval(calendarTimer);
  mediaTimer = setInterval(refreshMedia, 5000);
  calendarTimer = setInterval(refreshCalendar, 5 * 60 * 1000);
}

function stopWidgets() {
  clearTimeout(widgetsDelay);
  widgetsDelay = null;
  clearInterval(mediaTimer);
  clearInterval(calendarTimer);
  mediaTimer = null;
  calendarTimer = null;
  clearInterval(timerTick);
  if (timerLeft <= 0) timerTick = null;
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
    const video = panelEl.querySelector('#mirror-video');
    if (video) { video.srcObject = null; video.classList.remove('is-live'); }
  }
}

function openHeld() {
  heldOpen = true;
  cancelCollapse();
  setTimeout(() => { heldOpen = false; }, 1200);
}

/* ------------------------------ 이벤트 ------------------------------ */

pillEl.addEventListener('mouseenter', () => setExpanded(true));
pillEl.addEventListener('click', () => {
  // 마우스를 올리면 이미 펼쳐지므로, 방금 펼친 직후의 클릭은 접기로 해석하지 않는다.
  if (expanded && Date.now() - expandedAt > 400) setExpanded(false);
  else setExpanded(true);
});
notchEl.addEventListener('mouseenter', cancelCollapse);
notchEl.addEventListener('mouseleave', scheduleCollapse);
panelEl.addEventListener('mouseenter', cancelCollapse);

// 패널 안의 위젯 버튼 — 위임 처리
panelEl.addEventListener('click', (event) => {
  const mediaBtn = event.target.closest('[data-media]');
  if (mediaBtn) {
    const action = mediaBtn.dataset.media;
    invoke('media_control', { action })
      .then(() => setTimeout(refreshMedia, 350))
      .catch(() => toast('음악 앱을 조작하지 못했습니다'));
    return;
  }

  if (event.target.closest('#timer-toggle')) {
    if (timerTick) {
      clearInterval(timerTick);
      timerTick = null;
    } else {
      if (timerLeft <= 0) timerLeft = 5 * 60;
      startTimer();
    }
    paintTimer();
    return;
  }

  const minBtn = event.target.closest('[data-min]');
  if (minBtn) {
    clearInterval(timerTick);
    timerTick = null;
    timerLeft = Number(minBtn.dataset.min) * 60;
    paintTimer();
    openHeld();
    return;
  }

  if (event.target.closest('#shelf-drop')) {
    const picker = panelEl.querySelector('#shelf-file');
    if (picker) picker.click();
    return;
  }

  if (event.target.closest('#mirror-toggle')) toggleMirror();
  if (event.target.closest('#collapse')) setExpanded(false);
  if (event.target.closest('#open-home')) {
    invoke('open_main', { module: null, settings: false });
    setExpanded(false);
  }
  if (event.target.closest('#open-settings')) {
    invoke('open_main', { module: null, settings: true });
    setExpanded(false);
  }
});

/* 파일 끌어다 놓기 — 두 갈래를 모두 받는다. (v1.12.2)
   ① Tauri 네이티브: Rust 가 tip://shelf-drag / tip://shelf-drop(경로 목록)을 보낸다.
      NonactivatingPanel + WKWebView 에서는 HTML5 dataTransfer 로 파일이 오지 않았다.
   ② HTML5: 브라우저·미리보기처럼 dataTransfer 로 오는 경우의 대비. */

function setDragState(on) {
  dragHeld = !!on;
  const drop = panelEl.querySelector('#shelf-drop');
  if (drop) drop.classList.toggle('is-over', dragHeld);
  if (dragHeld) {
    cancelCollapse();
    if (!expanded) setExpanded(true);
  } else {
    scheduleCollapse();
  }
}

window.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  setDragState(true);
});

window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  setDragState(true);
});

window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget) return;   // 창 안에서 움직인 것은 무시
  setDragState(false);
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  setDragState(false);
  const files = event.dataTransfer && event.dataTransfer.files;
  if (!files || !files.length) return;
  if (!expanded) setExpanded(true);
  if (!panelEl.querySelector('#shelf-list')) {
    toast('환경설정에서 임시 보관함 위젯을 켜 주세요');
    return;
  }
  addFiles(files);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setExpanded(false);
  }
});

// 창 크기가 바뀌면 Rust 가 접거나 펼친 것 — 화면도 맞춘다.
function syncLayout() {
  const wide = window.innerWidth >= 320;
  if (wide && !expanded) {
    expanded = true;
    notchEl.classList.remove('is-collapsed');
    notchEl.classList.add('is-expanded');
    startWidgets();
  } else if (!wide && expanded) {
    expanded = false;
    notchEl.classList.remove('is-expanded');
    notchEl.classList.add('is-collapsed');
    stopWidgets();
  }
}
window.addEventListener('resize', syncLayout);

window.addEventListener('storage', refreshFromSettings);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!getTheme()) applyAppearance();   // 시스템 모드를 따르는 중이면 노치도 따라간다
});

if (TAURI && window.__TAURI__.event) {
  const listen = (name, handler) => {
    try {
      const result = window.__TAURI__.event.listen(name, handler);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* 이벤트를 못 듣게 되면 펼칠 때 다시 읽는 것으로 물러선다 */ }
  };

  // 환경설정(테마·기본 색·위젯·퀵바 순서)이 바뀌면 노치도 즉시 다시 그린다.
  listen('tip://notch-refresh', refreshFromSettings);

  // Finder 파일 드래그 — 들어오면 펼치고, 놓으면 경로를 읽어 보관함에 담는다.
  listen('tip://shelf-drag', (event) => setDragState(!!(event && event.payload)));
  listen('tip://shelf-drop', (event) => {
    setDragState(false);
    addShelfPaths(event && event.payload).catch(() => toast('파일을 담지 못했습니다'));
  });
}

/* ------------------------------ 설정 다시 읽기 ------------------------------ */

/** 저장된 설정을 새로 읽어 모양·위젯 목록을 다시 그린다. 펼쳐져 있으면 조회도 새로 한다. */
function refreshFromSettings() {
  syncStore();
  applyAppearance();
  settingsRev += 1;
  renderWidgets();
  if (expanded) {
    refreshMedia();
    refreshCalendar();
  }
}

/* ------------------------------ 시작 ------------------------------ */

if (new URLSearchParams(location.search).has('bg')) {
  document.body.classList.add('has-preview-bg');
}

applyAppearance();
renderWidgets();
syncLayout();
