/**
 * TIP · 스니펫 (snippets, v1.14.0)
 *
 * 자주 쓰는 문구(이메일 서명·계좌·주소·코드)를 별칭과 함께 저장한다.
 * 전역 검색(Option+Space)에서 `/별칭` 이나 낱말로 찾아 Enter 한 번에 복사한다.
 * 값은 이 기기의 localStorage(tip.snippets.v1)에만 있다.
 */

import { listSnippets, saveSnippet, deleteSnippet, snippetPreview, normalizeAlias } from '../../js/snippets.js';
import { confirmDialog } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M13 4v5h5"/><path d="M9 13h6M9 17h4"/></svg>`;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

const module = {
  id: 'snippets',
  name: '스니펫',
  shortName: '스니펫',
  kind: 'tool',
  category: 'utility',
  version: '1.14.0',
  subtitle: '자주 쓰는 문구 한 번에 복사',
  description: '이메일이나 계좌, 주소 같은 문구를 별칭과 함께 저장하고 전역 검색에서 바로 복사합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    let editingId = null;

    root.innerHTML = `
      <div class="v16 snip">
        <div class="v16-block-head"><span>스니펫</span><span class="ocr-count" id="sn-count"></span></div>
        <input class="pt-input snip-search" id="sn-search" placeholder="이름, 별칭, 내용으로 찾기" spellcheck="false" autocomplete="off">
        <div class="snip-list" id="sn-list" role="list"></div>

        <div class="v16-block-head"><span id="sn-form-title">새 스니펫</span></div>
        <div class="snip-form">
          <label class="rn-row"><span>이름</span><input class="pt-input" id="sn-label" placeholder="예: 집 주소" spellcheck="false"></label>
          <label class="rn-row"><span>별칭</span><input class="pt-input" id="sn-alias" placeholder="예: /home" spellcheck="false"></label>
          <label class="rn-row snip-body"><span>내용</span><textarea class="v16-ta" id="sn-body" rows="5" placeholder="붙여넣을 문구" spellcheck="false"></textarea></label>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="sn-save">저장</button>
            <button class="v16-btn" type="button" id="sn-cancel" hidden>취소</button>
          </div>
          <p class="v16-note">별칭은 '/' 로 시작합니다. 전역 검색에서 /주소 처럼 치면 바로 찾힙니다.</p>
        </div>
      </div>`;

    const listEl = root.querySelector('#sn-list');
    const countEl = root.querySelector('#sn-count');
    const searchEl = root.querySelector('#sn-search');
    const labelEl = root.querySelector('#sn-label');
    const aliasEl = root.querySelector('#sn-alias');
    const bodyEl = root.querySelector('#sn-body');
    const titleEl = root.querySelector('#sn-form-title');
    const cancelBtn = root.querySelector('#sn-cancel');

    async function copy(text) {
      try {
        if (TAURI) await C.invoke('copy_text', { text });
        else await navigator.clipboard.writeText(text);
        toast('복사했습니다');
      } catch (error) {
        console.error('[TIP snippets]', error);
        toast('복사하지 못했습니다');
      }
    }

    function resetForm() {
      editingId = null;
      titleEl.textContent = '새 스니펫';
      labelEl.value = '';
      aliasEl.value = '';
      bodyEl.value = '';
      cancelBtn.hidden = true;
    }

    function render() {
      const query = searchEl.value.trim().toLowerCase();
      const all = listSnippets();
      const list = query
        ? all.filter((item) => `${item.label} ${item.alias} ${item.body}`.toLowerCase().includes(query))
        : all;
      countEl.textContent = `${all.length}개`;
      listEl.innerHTML = '';
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'v16-note';
        empty.textContent = query ? '찾는 스니펫이 없습니다.' : '아직 스니펫이 없습니다. 아래에서 하나 만들어 보세요.';
        listEl.append(empty);
        return;
      }
      list.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'snip-row';
        row.setAttribute('role', 'listitem');

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'snip-main';
        main.innerHTML = `<b>${escapeHtml(item.label || item.alias || '스니펫')}</b>${
          item.alias ? `<code>${escapeHtml(normalizeAlias(item.alias))}</code>` : ''
        }<span>${escapeHtml(snippetPreview(item))}</span>`;
        main.addEventListener('click', () => copy(item.body), { signal });

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'snip-act';
        edit.textContent = '고치기';
        edit.addEventListener('click', () => {
          editingId = item.id;
          titleEl.textContent = '스니펫 고치기';
          labelEl.value = item.label || '';
          aliasEl.value = normalizeAlias(item.alias);
          bodyEl.value = item.body;
          cancelBtn.hidden = false;
          labelEl.focus();
        }, { signal });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'snip-act is-danger';
        del.textContent = '지우기';
        del.addEventListener('click', async () => {
          // WKWebView 는 window.confirm 을 띄우지 않는다 — 인앱 2단계 확인(v1.15.3).
          const ok = await confirmDialog({
            title: '스니펫 지우기',
            message: `"${item.label || item.alias}" 스니펫을 지울까요?`,
            okText: '지우기',
          });
          if (!ok) return;
          deleteSnippet(item.id);
          if (editingId === item.id) resetForm();
          render();
          toast('스니펫을 지웠습니다');
        }, { signal });

        row.append(main, edit, del);
        listEl.append(row);
      });
    }

    root.querySelector('#sn-save').addEventListener('click', () => {
      const result = saveSnippet({
        id: editingId,
        label: labelEl.value,
        alias: aliasEl.value,
        body: bodyEl.value,
      });
      if (!result.ok) {
        toast(result.message);
        return;
      }
      toast(editingId ? '스니펫을 고쳤습니다' : '스니펫을 저장했습니다');
      resetForm();
      render();
    }, { signal });

    cancelBtn.addEventListener('click', resetForm, { signal });
    searchEl.addEventListener('input', render, { signal });

    render();
    return () => controller.abort();
  },
};

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export default module;
