/**
 * TIP · 스티커 메모 (sticky-notes, v1.14.0 — Mac 앱 전용)
 *
 * 바탕화면에 하나씩 뜨는 독립 메모 창을 만들고 관리한다.
 * 창 자체는 Rust(sticky.rs)가 띄우고, 이 화면은 목록·새 스티커·다시 열기만 맡는다.
 * 내용은 앱 데이터 폴더의 sticky-notes.json 에만 저장된다.
 */

import { getAccent } from '../../js/store.js';
import { getFeatureValue as getSetting } from '../../js/feature-settings.js';
import { confirmDialog } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>`;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

const ACCENT_COLORS = {
  green: 'green', blue: 'blue', purple: 'purple', orange: 'yellow', rose: 'pink', slate: 'dark',
};

const COLOR_LABEL = {
  yellow: '노랑', green: '딥그린', blue: '파랑', pink: '분홍', purple: '보라', dark: '다크그레이',
};

/** 설정의 기본 색이 'auto' 면 환경설정 기본 색(accent)을 따라간다. */
function defaultColor() {
  const saved = getSetting('sticky.color', 'auto');
  if (saved && saved !== 'auto') return saved;
  return ACCENT_COLORS[getAccent()] || 'green';
}

function when(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getMonth() + 1}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const module = {
  id: 'sticky-notes',
  name: '스티커 메모',
  shortName: '스티커 메모',
  kind: 'tool',
  category: 'utility',
  version: '1.14.0',
  subtitle: '바탕화면에 붙여 두는 메모',
  description: '여러 개를 동시에 띄워 두고 위치와 크기, 색을 그대로 기억합니다.',
  icon: ICON,
  badge: 'Mac',
  macOnly: true,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    root.innerHTML = `
      <div class="v16 sticky-mod">
        <div class="v16-actions">
          <button class="v16-btn primary" type="button" id="st-new"><span class="v16-btn-icon" aria-hidden="true">${ICON}</span>새 스티커</button>
          <button class="v16-btn" type="button" id="st-all">모두 열기</button>
        </div>
        <p class="v16-note" id="st-note">스티커는 바탕화면에 따로 떠 있습니다. 창을 닫아도 내용은 남고, 앱을 다시 켜면 열려 있던 스티커가 그대로 돌아옵니다.</p>
        <div class="v16-block-head"><span>스티커</span><span class="ocr-count" id="st-count"></span></div>
        <div class="sticky-list" id="st-list" role="list"></div>
      </div>`;

    const listEl = root.querySelector('#st-list');
    const countEl = root.querySelector('#st-count');
    const noteEl = root.querySelector('#st-note');

    if (!TAURI) {
      noteEl.textContent = '스티커 메모는 Mac 앱에서만 쓸 수 있습니다. (웹에서는 바탕화면 창을 띄울 수 없습니다)';
      root.querySelector('#st-new').disabled = true;
      root.querySelector('#st-all').disabled = true;
      listEl.innerHTML = '<p class="v16-note">Mac 앱을 열고 이 모듈을 다시 열어 주세요.</p>';
      return () => controller.abort();
    }

    function row(note) {
      const item = document.createElement('div');
      item.className = 'sticky-row';
      item.dataset.color = note.color;
      item.setAttribute('role', 'listitem');

      const dot = document.createElement('span');
      dot.className = 'sticky-row-dot';
      dot.title = COLOR_LABEL[note.color] || note.color;

      const text = document.createElement('button');
      text.type = 'button';
      text.className = 'sticky-row-text';
      const first = String(note.text || '').trim().split('\n')[0];
      const stamp = when(note.updated || note.created);
      text.innerHTML = `<b>${escapeHtml(first || '(빈 스티커)')}</b><span>${note.open ? '열려 있음' : '닫힘'}${stamp ? `, ${stamp}` : ''}</span>`;
      text.title = note.open ? '스티커 앞으로 가져오기' : '스티커 다시 열기';
      text.addEventListener('click', async () => {
        try {
          await C.invoke('sticky_open', { id: note.id });
          toast(note.open ? '스티커를 앞으로 가져왔습니다' : '스티커를 다시 열었습니다');
          refresh();
        } catch (error) {
          console.error('[TIP sticky]', error);
          toast('스티커를 열지 못했습니다');
        }
      }, { signal });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sticky-row-del';
      del.textContent = '×';
      del.setAttribute('aria-label', '스티커 지우기');
      del.addEventListener('click', async () => {
        // WKWebView 는 window.confirm 을 띄우지 않는다 — 인앱 2단계 확인(v1.15.3).
        const ok = await confirmDialog({
          title: '스티커 지우기',
          message: '이 스티커를 지울까요? 되돌릴 수 없습니다.',
          okText: '지우기',
        });
        if (!ok) return;
        try {
          await C.invoke('sticky_delete', { id: note.id });
          toast('스티커를 지웠습니다');
          refresh();
        } catch (error) {
          console.error('[TIP sticky]', error);
          toast('스티커를 지우지 못했습니다');
        }
      }, { signal });

      item.append(dot, text, del);
      return item;
    }

    async function refresh() {
      let notes = [];
      try {
        notes = await C.invoke('sticky_list');
      } catch (error) {
        console.error('[TIP sticky]', error);
        toast('스티커 목록을 읽지 못했습니다');
      }
      const list = Array.isArray(notes) ? notes : [];
      countEl.textContent = `${list.length}개`;
      listEl.innerHTML = '';
      if (!list.length) {
        listEl.append(el2('p', 'v16-note', '아직 스티커가 없습니다. [새 스티커]를 눌러 하나 띄워 보세요.'));
        return;
      }
      list.forEach((note) => listEl.append(row(note)));
    }

    root.querySelector('#st-new').addEventListener('click', async () => {
      try {
        await C.invoke('sticky_create', { color: defaultColor() });
        toast('새 스티커를 띄웠습니다');
        refresh();
      } catch (error) {
        console.error('[TIP sticky]', error);
        toast('스티커를 만들지 못했습니다');
      }
    }, { signal });

    root.querySelector('#st-all').addEventListener('click', async () => {
      let notes = [];
      try {
        notes = await C.invoke('sticky_list');
      } catch { notes = []; }
      const closed = (notes || []).filter((note) => !note.open);
      if (!closed.length) {
        toast('모든 스티커가 이미 열려 있습니다');
        return;
      }
      for (const note of closed) {
        try { await C.invoke('sticky_open', { id: note.id }); } catch { /* 하나 실패해도 나머지 */ }
      }
      toast(`스티커 ${closed.length}개를 열었습니다`);
      refresh();
    }, { signal });

    if (window.__TAURI__.event) {
      window.__TAURI__.event.listen('tip://stickies-changed', () => refresh());
    }

    refresh();
    return () => controller.abort();
  },
};

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function el2(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export default module;
