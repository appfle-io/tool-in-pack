/**
 * TIP · 배송 조회 (parcel-tracker) — v1.12.0
 *
 * 택배사 + 송장번호 + 별명(예: `시우 기저귀`)을 기기에만 저장해 두고, 누르면 바로 조회한다.
 * 조회는 **네이버 배송조회** 화면을 연다(API 키·서버 없음).
 * - Mac 앱: Rust 명령 `open_parcel_webview` 로 480×720 컴팩트 창 안에서 네이버 배송조회를 연다.
 * - 웹(PWA): 브라우저 새 탭으로 같은 주소를 연다.
 *
 * 저장 위치: localStorage 'tip.parcels.v1' — 서버로 보내지 않는다(TIP 에는 서버가 없다).
 * 항목: { id, carrierId, carrier, invoice, nickname, created, opened }
 */

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const STORE_KEY = 'tip.parcels.v1';
const LIMIT = 100;

const PARCEL_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.6 12 3l8.5 4.6v8.8L12 21l-8.5-4.6z"/><path d="M3.5 7.6 12 12.2l8.5-4.6M12 12.2V21"/><path d="m7.8 5.3 8.5 4.6"/></svg>';
const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"/></svg>';
const TRASH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.5 7l.8 11.3A1.7 1.7 0 0 0 9 20h6a1.7 1.7 0 0 0 1.7-1.7L17.5 7"/><path d="M10.4 11v5M13.6 11v5"/></svg>';
const OPEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 5H19v5.5"/><path d="M19 5l-7.5 7.5"/><path d="M17 14.2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3.8"/></svg>';

/** 택배사 — 네이버 배송조회가 알아듣는 이름 그대로. `직접 입력` 은 이름을 따로 받는다. */
const CARRIERS = [
  { id: 'cj', name: 'CJ대한통운' },
  { id: 'epost', name: '우체국택배' },
  { id: 'hanjin', name: '한진택배' },
  { id: 'lotte', name: '롯데택배' },
  { id: 'logen', name: '로젠택배' },
  { id: 'coupang', name: '쿠팡로켓배송' },
  { id: 'gs25', name: 'GS25편의점택배' },
  { id: 'cu', name: 'CU편의점택배' },
  { id: 'etc', name: '직접 입력' },
];

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** 송장번호 — 공백·하이픈을 빼고 숫자·영문만 남긴다(대부분 숫자, 일부는 영문 포함). */
function normalizeInvoice(value) {
  return String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
}

/** 네이버 배송조회 주소 — `택배사 송장번호` 한 줄로 검색한다. */
function naverUrl(carrier, invoice) {
  const query = [carrier, invoice].filter(Boolean).join(' ');
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
}

let nextId = Date.now();

function newId() {
  nextId += 1;
  return `${nextId}-${Math.random().toString(36).slice(2, 7)}`;
}

function readItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === 'object' && item.invoice);
  } catch {
    return [];
  }
}

function writeItems(items) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, LIMIT)));
    return true;
  } catch (error) {
    console.warn('[TIP parcel-tracker] 저장하지 못했습니다', error);
    return false;
  }
}

function invoke(command, args) {
  return window.__TAURI__.core.invoke(command, args || {});
}

function mount(root, ctx) {
  const controller = new AbortController();
  const { signal } = controller;

  let items = readItems();
  let submitting = false;

  root.innerHTML = `
    <section class="par">
      <p class="par-note">
        택배사와 송장번호를 저장해 두면 <b>한 번에 조회</b>합니다. 조회는 <b>네이버 배송조회</b>로 열리며,
        저장한 목록은 이 기기 안에만 남습니다.
        ${TAURI
          ? 'Mac 앱에서는 <b>앱 안 창</b>에서 바로 열립니다.'
          : '브라우저에서는 <b>새 탭</b>에서 열립니다.'}
      </p>

      <form class="par-form" id="par-form" autocomplete="off">
        <div class="par-fields">
          <label class="par-field">
            <span>택배사</span>
            <select id="par-carrier" aria-label="택배사">
              ${CARRIERS.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </label>
          <label class="par-field" id="par-carrier-custom-field" hidden>
            <span>택배사 이름</span>
            <input id="par-carrier-custom" type="text" placeholder="예: 경동택배" maxlength="24">
          </label>
          <label class="par-field">
            <span>송장번호</span>
            <input id="par-invoice" type="text" inputmode="numeric" placeholder="숫자만 입력" maxlength="30">
          </label>
          <label class="par-field">
            <span>별명 <em>선택</em></span>
            <input id="par-nickname" type="text" placeholder="예: 시우 기저귀" maxlength="30">
          </label>
        </div>
        <div class="par-actions">
          <button class="primary-btn" type="submit" id="par-add">${OPEN_ICON}저장하고 조회</button>
          <span class="par-hint" id="par-hint"></span>
        </div>
        <p class="par-error" id="par-error" hidden></p>
      </form>

      <div class="par-list-head">
        <b>보관한 송장</b>
        <span id="par-count">0개</span>
      </div>
      <div class="par-list" id="par-list"></div>
    </section>
  `;

  const form = root.querySelector('#par-form');
  const carrierSelect = root.querySelector('#par-carrier');
  const customField = root.querySelector('#par-carrier-custom-field');
  const customInput = root.querySelector('#par-carrier-custom');
  const invoiceInput = root.querySelector('#par-invoice');
  const nicknameInput = root.querySelector('#par-nickname');
  const hint = root.querySelector('#par-hint');
  const errorLine = root.querySelector('#par-error');
  const list = root.querySelector('#par-list');
  const count = root.querySelector('#par-count');

  /* ------------------------------ 그리기 ------------------------------ */

  function carrierLabel(item) {
    return item.carrier || '택배사 미지정';
  }

  function render() {
    count.textContent = `${items.length}개`;
    if (!items.length) {
      list.innerHTML = `
        <div class="par-empty">
          <span class="par-empty-icon">${PARCEL_ICON}</span>
          <p><b>아직 보관한 송장이 없습니다.</b> 위에 택배사와 송장번호를 넣고 <b>저장하고 조회</b>를 누르면<br>여기에 쌓이고, 다음부터는 한 번에 다시 열 수 있습니다.</p>
        </div>`;
      return;
    }

    list.innerHTML = items.map((item) => `
      <article class="par-item" data-id="${escapeHtml(item.id)}">
        <div class="par-item-head">
          <b class="par-name">${escapeHtml(item.nickname || item.invoice)}</b>
          <span class="par-carrier">${escapeHtml(carrierLabel(item))}</span>
        </div>
        ${item.nickname ? `<p class="par-invoice">${escapeHtml(item.invoice)}</p>` : ''}
        <div class="par-item-actions">
          <button class="par-btn is-primary" type="button" data-act="open">${OPEN_ICON}조회</button>
          <button class="par-btn" type="button" data-act="copy" aria-label="송장번호 복사">${COPY_ICON}복사</button>
          <button class="par-btn is-quiet" type="button" data-act="delete" aria-label="삭제">${TRASH_ICON}삭제</button>
        </div>
      </article>`).join('');
  }

  function showError(message) {
    errorLine.hidden = !message;
    errorLine.textContent = message || '';
  }

  /* ------------------------------ 조회 ------------------------------ */

  function windowTitle(item) {
    const name = item.nickname ? `${item.nickname} · ` : '';
    return `배송 조회 · ${name}${item.invoice}`;
  }

  function openTracking(item) {
    const url = naverUrl(carrierLabel(item), item.invoice);
    item.opened = Date.now();
    // 최근 조회를 위로 — 목록을 다시 그린다.
    items = [item, ...items.filter((other) => other.id !== item.id)];
    writeItems(items);
    render();

    if (TAURI) {
      invoke('open_parcel_webview', { url, title: windowTitle(item) }).catch((error) => {
        console.error('[TIP parcel-tracker] 앱 창을 열지 못했습니다', error);
        ctx.toast('앱 창을 열지 못해 새 탭에서 엽니다');
        window.open(url, '_blank', 'noopener');
      });
      return true;
    }

    const opened = window.open(url, '_blank', 'noopener');
    if (!opened) ctx.toast('팝업이 차단되었습니다. 브라우저 설정에서 이 사이트의 팝업을 허용해 주세요');
    return true;
  }

  /* ------------------------------ 저장 ------------------------------ */

  function selectedCarrierName() {
    if (carrierSelect.value === 'etc') return customInput.value.trim();
    const found = CARRIERS.find((c) => c.id === carrierSelect.value);
    return found ? found.name : '';
  }

  function addItem(event) {
    event.preventDefault();
    if (submitting) return;

    const invoice = normalizeInvoice(invoiceInput.value);
    const carrier = selectedCarrierName();
    const nickname = nicknameInput.value.trim();

    if (!invoice) {
      showError('송장번호를 입력해 주세요.');
      invoiceInput.focus();
      return;
    }
    if (invoice.length < 6) {
      showError('송장번호가 너무 짧습니다. 택배사 앱·문자에 있는 번호를 그대로 넣어 주세요.');
      invoiceInput.focus();
      return;
    }
    if (carrierSelect.value === 'etc' && !carrier) {
      showError('택배사를 직접 입력했으면 이름을 적어 주세요. 예: 경동택배');
      customInput.focus();
      return;
    }
    showError('');

    const same = items.find((item) => item.invoice === invoice && carrierLabel(item) === (carrier || '택배사 미지정'));
    if (same) {
      same.nickname = nickname || same.nickname;
      same.opened = Date.now();
      items = [same, ...items.filter((item) => item.id !== same.id)];
      writeItems(items);
      render();
      ctx.toast('이미 보관한 송장입니다. 다시 조회합니다');
      openTracking(same);
      return;
    }

    submitting = true;
    const item = {
      id: newId(),
      carrierId: carrierSelect.value,
      carrier: carrier || '',
      invoice,
      nickname,
      created: Date.now(),
      opened: Date.now(),
    };
    items = [item, ...items];
    if (!writeItems(items)) {
      ctx.toast('저장 공간이 부족해 보관하지 못했습니다');
    }
    render();

    invoiceInput.value = '';
    nicknameInput.value = '';
    hint.textContent = '';
    submitting = false;
    openTracking(item);
  }

  /* ------------------------------ 목록 조작 ------------------------------ */

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const card = button.closest('.par-item');
    const item = items.find((entry) => entry.id === card?.dataset.id);
    if (!item) return;

    if (button.dataset.act === 'open') {
      openTracking(item);
      return;
    }

    if (button.dataset.act === 'copy') {
      try {
        await navigator.clipboard.writeText(item.invoice);
        ctx.toast('송장번호를 복사했습니다');
      } catch (error) {
        console.error('[TIP parcel-tracker] 복사하지 못했습니다', error);
        ctx.toast('복사하지 못했습니다');
      }
      return;
    }

    if (button.dataset.act === 'delete') {
      if (button.dataset.confirm !== '1') {
        button.dataset.confirm = '1';
        button.classList.add('is-confirm');
        button.lastChild.textContent = '한 번 더';
        setTimeout(() => {
          if (!button.isConnected) return;
          button.dataset.confirm = '0';
          button.classList.remove('is-confirm');
          button.lastChild.textContent = '삭제';
        }, 3000);
        return;
      }
      items = items.filter((entry) => entry.id !== item.id);
      writeItems(items);
      render();
      ctx.toast('삭제했습니다');
    }
  }, { signal });

  carrierSelect.addEventListener('change', () => {
    const custom = carrierSelect.value === 'etc';
    customField.hidden = !custom;
    if (custom) customInput.focus();
    showError('');
  }, { signal });

  invoiceInput.addEventListener('input', () => {
    hint.textContent = normalizeInvoice(invoiceInput.value) ? `조회: ${selectedCarrierName()} ${normalizeInvoice(invoiceInput.value)}`.trim() : '';
    showError('');
  }, { signal });

  form.addEventListener('submit', addItem, { signal });

  // 다른 창(컴팩트 창·메인 창)에서 목록을 바꾸면 따라간다.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY) return;
    items = readItems();
    render();
  }, { signal });

  render();

  return () => {
    controller.abort();
  };
}

const module = {
  id: 'parcel-tracker',
  name: '배송 조회',
  subtitle: '송장번호 보관 · 네이버 배송조회 바로 열기',
  description: '택배사·송장번호·별명을 저장해 두고 네이버 배송조회를 한 번에 엽니다(Mac 앱은 앱 안 창).',
  icon: PARCEL_ICON,
  version: '1.12.0',
  category: 'online',
  defaultEnabled: true,
  defaultPinned: false,
  mount,
};

export default module;
