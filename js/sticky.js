/* TIP · 스티커 메모 창 (v1.14.0, Mac 앱 전용)
 *
 * 창 하나가 메모 하나다. 주소의 id 로 Rust 가 들고 있는 메모를 읽고, 글자를 고치면
 * 400ms 뒤 조용히 저장한다(창을 급히 닫아도 마지막 글자까지 — 닫기 전에 한 번 더 저장).
 * 위치·크기는 Rust 가 창 이벤트로 직접 적는다 — 여기서는 내용·색·핀만 다룬다.
 */

import { confirmDialog } from './ui.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

const params = new URLSearchParams(location.search);
const noteId = params.get('id') || '';

const root = document.getElementById('sticky');
const textarea = document.getElementById('sticky-text');
const stateEl = document.getElementById('sticky-state');
const palette = document.getElementById('palette');
const pinBtn = document.getElementById('pin-btn');
const colorBtn = document.getElementById('color-btn');

let currentColor = 'green';
let currentPinned = false;
let saveTimer = 0;
let saving = false;
let dirty = false;

function setState(text, kind) {
  stateEl.textContent = text;
  stateEl.classList.toggle('is-saving', kind === 'saving');
  stateEl.classList.toggle('is-error', kind === 'error');
}

function paintColor(color) {
  currentColor = color || 'green';
  root.dataset.color = currentColor;
  [...palette.querySelectorAll('.sticky-swatch')].forEach((swatch) => {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.color === currentColor));
  });
}

async function load() {
  if (!TAURI) {
    setState('Mac 앱에서 쓰는 기능입니다', 'error');
    textarea.disabled = true;
    return;
  }
  if (!noteId) {
    setState('스티커 번호가 없습니다', 'error');
    return;
  }
  try {
    const note = await C.invoke('sticky_get', { id: noteId });
    if (!note) {
      setState('스티커를 찾지 못했습니다', 'error');
      return;
    }
    textarea.value = note.text || '';
    paintColor(note.color);
    currentPinned = !!note.pinned;
    pinBtn.setAttribute('aria-pressed', String(currentPinned));
    pinBtn.title = currentPinned ? '항상 위 끄기' : '항상 위';
  } catch (error) {
    console.error('[TIP sticky]', error);
    setState('불러오지 못했습니다', 'error');
    return;
  }
  requestAnimationFrame(() => textarea.focus());
}

async function save(text, color) {
  if (!TAURI || !noteId) return;
  if (saving) { dirty = true; return; }
  saving = true;
  setState('저장 중…', 'saving');
  try {
    const payload = { id: noteId };
    if (text !== undefined) payload.text = text;
    if (color !== undefined) payload.color = color;
    await C.invoke('sticky_update', payload);
    setState('저장됨', 'ok');
  } catch (error) {
    console.error('[TIP sticky]', error);
    setState('저장하지 못했습니다', 'error');
  } finally {
    saving = false;
    if (dirty) {
      dirty = false;
      save(textarea.value);
    }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setState('입력 중…', 'saving');
  saveTimer = setTimeout(() => save(textarea.value), 400);
}

textarea.addEventListener('input', scheduleSave);
textarea.addEventListener('blur', () => {
  clearTimeout(saveTimer);
  save(textarea.value);
});

root.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    document.getElementById('new-btn').click();
  }
});

colorBtn.addEventListener('click', () => {
  palette.hidden = !palette.hidden;
});
palette.addEventListener('click', (event) => {
  const swatch = event.target.closest('.sticky-swatch');
  if (!swatch) return;
  paintColor(swatch.dataset.color);
  palette.hidden = true;
  save(undefined, currentColor);
  textarea.focus();
});

pinBtn.addEventListener('click', async () => {
  if (!TAURI || !noteId) return;
  currentPinned = !currentPinned;
  pinBtn.setAttribute('aria-pressed', String(currentPinned));
  pinBtn.title = currentPinned ? '항상 위 끄기' : '항상 위';
  try {
    await C.invoke('sticky_set_pin', { id: noteId, pinned: currentPinned });
  } catch (error) {
    console.error('[TIP sticky]', error);
    currentPinned = !currentPinned;
    pinBtn.setAttribute('aria-pressed', String(currentPinned));
  }
});

document.getElementById('new-btn').addEventListener('click', async () => {
  if (!TAURI) return;
  clearTimeout(saveTimer);
  await save(textarea.value);
  try {
    await C.invoke('sticky_create', { color: currentColor });
  } catch (error) {
    console.error('[TIP sticky]', error);
  }
});

document.getElementById('close-btn').addEventListener('click', async () => {
  clearTimeout(saveTimer);
  await save(textarea.value);
  if (TAURI) C.invoke('sticky_close', { id: noteId }).catch(() => {});
});

document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!TAURI) return;
  const firstLine = (textarea.value || '').trim().split('\n')[0].slice(0, 30);
  const label = firstLine ? `"${firstLine}"` : '이 스티커';
  // WKWebView 는 window.confirm 을 띄우지 않는다 — 인앱 2단계 확인(v1.15.3).
  const ok = await confirmDialog({
    title: '스티커 지우기',
    message: `${label}를 지울까요? 되돌릴 수 없습니다.`,
    okText: '지우기',
  });
  if (!ok) {
    textarea.focus({ preventScroll: true });
    return;
  }
  clearTimeout(saveTimer);
  C.invoke('sticky_delete', { id: noteId }).catch(() => {});
});

// 창을 그냥 닫아도 마지막 입력은 남긴다(닫기는 Rust 가 open=false 로 적는다).
window.addEventListener('beforeunload', () => {
  if (!TAURI || !noteId) return;
  clearTimeout(saveTimer);
  const payload = { id: noteId, text: textarea.value };
  C.invoke('sticky_update', payload).catch(() => {});
});

if ('serviceWorker' in navigator) {
  // 스티커 창은 앱 안 전용 — 서비스 워커는 등록하지 않는다.
}

paintColor('green');
load();
