/**
 * TIP · 환율 계산기 (currency-calc)
 * 하이브리드: 온라인일 때만 공개 환율표(open.er-api.com → frankfurter.app 폴백)를
 * 한 번 받아 localStorage 에 기준 시각과 함께 캐시한다. 금액·입력값은 전송하지 않는다.
 * 오프라인·실패 시 마지막 캐시 → 내장 참고 환율 순으로 동작하고, 수동 환율도 지원한다.
 */

import { icons } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5h4.2a2.4 2.4 0 0 1 0 4.8H8.5m0 0h4.2a2.4 2.4 0 0 1 0 4.8H8.5"/><path d="M11 6.5v11"/><path d="M15.5 15.5h1.8M15.5 9.5h1.8"/></svg>`;

const CACHE_KEY = 'tip.fx.v1';
const MANUAL_KEY = 'tip.fx.manual.v1';
const CACHE_TTL = 12 * 60 * 60 * 1000;

const CURRENCIES = [
  { code: 'KRW', name: '대한민국 원', symbol: '₩' },
  { code: 'USD', name: '미국 달러', symbol: '$' },
  { code: 'JPY', name: '일본 엔', symbol: '¥' },
  { code: 'EUR', name: '유로', symbol: '€' },
  { code: 'CNY', name: '중국 위안', symbol: '¥' },
  { code: 'GBP', name: '영국 파운드', symbol: '£' },
  { code: 'VND', name: '베트남 동', symbol: '₫' },
  { code: 'THB', name: '태국 바트', symbol: '฿' },
  { code: 'TWD', name: '대만 달러', symbol: 'NT$' },
  { code: 'AUD', name: '호주 달러', symbol: 'A$' },
  { code: 'CAD', name: '캐나다 달러', symbol: 'C$' },
  { code: 'SGD', name: '싱가포르 달러', symbol: 'S$' },
];

/** 내장 참고 환율 — 1 KRW 기준(대략값). 네트워크를 한 번도 못 쓴 기기에서만 쓰인다. */
const BUILTIN = {
  KRW: 1,
  USD: 1 / 1470,
  JPY: 1 / 9.4,
  EUR: 1 / 1590,
  CNY: 1 / 203,
  GBP: 1 / 1860,
  VND: 1 / 0.0574,
  THB: 1 / 42.5,
  TWD: 1 / 45.6,
  AUD: 1 / 955,
  CAD: 1 / 1050,
  SGD: 1 / 1090,
};

const state = {
  from: 'KRW',
  to: 'USD',
  amount: '10000',
  cache: null,
  manual: {},
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 저장 공간이 없으면 캐시 없이 동작 */ }
}

function loadCache() {
  const cache = readJson(CACHE_KEY, null);
  if (!cache || !cache.rates || typeof cache.rates.KRW !== 'number') return null;
  cache.rates.KRW = 1;
  return cache;
}

function loadManual() {
  const manual = readJson(MANUAL_KEY, {});
  return manual && typeof manual === 'object' ? manual : {};
}

function currencyOf(code) {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
}

function formatMoney(value, code) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.01) return value.toPrecision(4).replace(/e\+?/, 'e');
  const maxDigits = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
  return value.toLocaleString('ko-KR', { maximumFractionDigits: maxDigits, minimumFractionDigits: 0 });
}

function formatKst(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const pick = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${pick('year')}.${pick('month')}.${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

function agoLabel(iso) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

async function fetchRates(signal) {
  const attempts = [
    {
      url: 'https://open.er-api.com/v6/latest/KRW',
      source: 'open.er-api.com',
      pick: (data) => (data && data.result === 'success' && data.rates ? data.rates : null),
      time: (data) => (data && data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toISOString() : null),
    },
    {
      url: 'https://api.frankfurter.app/latest?from=KRW',
      source: 'frankfurter.app',
      pick: (data) => (data && data.rates && typeof data.rates === 'object' ? data.rates : null),
      time: (data) => (data && data.date ? `${data.date}T12:00:00+09:00` : null),
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const rates = attempt.pick(data);
      if (!rates || typeof rates.KRW !== 'number') {
        if (attempt.source !== 'frankfurter.app') throw new Error('환율표 형식이 다릅니다');
        rates.KRW = 1;
      }
      return {
        base: 'KRW',
        rates: { ...rates, KRW: 1 },
        fetchedAt: new Date().toISOString(),
        rateDate: attempt.time(data),
        source: attempt.source,
      };
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      errors.push(`${attempt.source}: ${(error && error.message) || error}`);
    }
  }
  throw new Error(errors.join(' / '));
}

const module = {
  id: 'currency-calc',
  name: '환율 계산기',
  shortName: '환율 계산',
  kind: 'tool',
  category: 'online',
  version: '1.0.0',
  subtitle: '오프라인에서도 도는 환율 계산',
  description: '최신 환율표를 한 번 받아 캐시하고, 오프라인에서는 마지막 환율이나 직접 넣은 환율로 계산합니다. 입력한 금액은 어디로도 보내지 않습니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx.toast || (() => {});

    state.cache = loadCache();
    state.manual = loadManual();

    const rates = () => ({ ...BUILTIN, ...(state.cache ? state.cache.rates : {}) });

    const manualKey = () => `${state.from}_${state.to}`;

    function rateFromTo(codeFrom, codeTo) {
      if (codeFrom === codeTo) return 1;
      const direct = state.manual[`${codeFrom}_${codeTo}`];
      if (Number.isFinite(direct) && direct > 0) return direct;
      const inverse = state.manual[`${codeTo}_${codeFrom}`];
      if (Number.isFinite(inverse) && inverse > 0) return 1 / inverse;
      const table = rates();
      const fromRate = Number(table[codeFrom]);
      const toRate = Number(table[codeTo]);
      if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0) return NaN;
      return toRate / fromRate;
    }

    root.innerHTML = `
      <div class="fx">
        <div class="fx-status" id="fx-status"></div>

        <section class="fx-calc">
          <div class="fx-side">
            <label class="fx-label" for="fx-amount">금액</label>
            <div class="fx-field">
              <input class="fx-amount" id="fx-amount" type="text" inputmode="decimal" autocomplete="off"
                     value="${state.amount}" aria-label="변환할 금액">
              <select class="fx-select" id="fx-from" aria-label="기준 통화"></select>
            </div>
          </div>

          <button class="fx-swap" type="button" id="fx-swap" aria-label="통화 맞바꾸기">${icons.swap}</button>

          <div class="fx-side">
            <span class="fx-label">결과</span>
            <div class="fx-field fx-result-field">
              <output class="fx-result" id="fx-result" aria-live="polite">—</output>
              <select class="fx-select" id="fx-to" aria-label="바꿀 통화"></select>
            </div>
            <p class="fx-pair-rate" id="fx-pair-rate"></p>
          </div>
        </section>

        <section class="fx-manual" id="fx-manual">
          <div class="fx-manual-head">
            <h3 class="pp-card-title">수동 환율</h3>
            <button class="fx-reset" type="button" id="fx-manual-reset" hidden>자동 환율로</button>
          </div>
          <div class="ic-row">
            <span class="ic-label fx-manual-label" id="fx-manual-label">1</span>
            <input class="fx-manual-input" id="fx-manual-rate" type="number" inputmode="decimal" step="any"
                   min="0" placeholder="환율 직접 입력" aria-label="수동 환율">
            <button class="ic-seg" type="button" id="fx-manual-apply">적용</button>
          </div>
          <p class="fx-hint">네트워크 없이 정해 둔 환율로 계산합니다. 이 기기에만 저장됩니다.</p>
        </section>

        <section class="fx-table-wrap">
          <div class="fx-table-head">
            <h3 class="pp-card-title">한눈에 비교</h3>
            <span class="fx-table-base" id="fx-table-base"></span>
          </div>
          <div class="fx-table" id="fx-table"></div>
        </section>

        <div class="notice fx-privacy">
          <span class="n-icon">i</span>
          <div class="n-body">
            <div class="n-title">환율 갱신 시에만 접속합니다</div>
            <div class="n-text">공개 API(open.er-api.com, 실패 시 frankfurter.app)에서 환율표만 받습니다.
              <b>입력한 금액은 전송하지 않습니다.</b> 그 밖의 계산은 모두 기기 안에서 합니다.</div>
          </div>
        </div>
      </div>`;

    const statusEl = root.querySelector('#fx-status');
    const amountEl = root.querySelector('#fx-amount');
    const fromEl = root.querySelector('#fx-from');
    const toEl = root.querySelector('#fx-to');
    const resultEl = root.querySelector('#fx-result');
    const pairEl = root.querySelector('#fx-pair-rate');
    const tableEl = root.querySelector('#fx-table');
    const tableBaseEl = root.querySelector('#fx-table-base');
    const manualEl = root.querySelector('#fx-manual');
    const manualInput = root.querySelector('#fx-manual-rate');
    const manualLabel = root.querySelector('#fx-manual-label');
    const manualReset = root.querySelector('#fx-manual-reset');

    CURRENCIES.forEach((currency) => {
      const option = document.createElement('option');
      option.value = currency.code;
      option.textContent = `${currency.code} · ${currency.name}`;
      fromEl.append(option);
      toEl.append(option.cloneNode(true));
    });
    fromEl.value = state.from;
    toEl.value = state.to;

    function renderStatus(busy = false, error = '') {
      statusEl.innerHTML = '';
      if (busy) {
        statusEl.innerHTML = '<span class="spinner"></span><span>환율표를 받는 중…</span>';
        statusEl.className = 'fx-status is-busy';
        return;
      }
      if (error) {
        statusEl.className = 'fx-status is-warn';
      } else if (state.cache) {
        statusEl.className = 'fx-status';
      } else {
        statusEl.className = 'fx-status is-warn';
      }

      const text = document.createElement('div');
      text.className = 'fx-status-text';

      if (state.cache) {
        const when = formatKst(state.cache.rateDate || state.cache.fetchedAt);
        const stale = Date.now() - new Date(state.cache.fetchedAt).getTime() > CACHE_TTL;
        text.innerHTML = `<b>${when || '시각 미상'} 기준</b>
          <span>${state.cache.source} · ${agoLabel(state.cache.fetchedAt)} 저장${stale ? ' · 오래된 환율' : ''}</span>`;
      } else {
        text.innerHTML = '<b>내장 참고 환율</b><span>기준일 미갱신 — 네트워크가 되면 갱신하세요</span>';
      }
      if (error) {
        const detail = document.createElement('span');
        detail.className = 'fx-status-error';
        detail.textContent = error === '오프라인'
          ? '오프라인입니다. 마지막으로 받은 환율로 계산합니다.'
          : '환율 서버에 연결하지 못했습니다. 마지막으로 받은 환율로 계산합니다.';
        text.append(detail);
      }

      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'fx-refresh';
      refresh.id = 'fx-refresh';
      refresh.textContent = '환율 갱신';
      refresh.addEventListener('click', () => refreshRates(), { signal });

      statusEl.append(text, refresh);
    }

    function renderPair() {
      const rate = rateFromTo(state.from, state.to);
      const manual = Number.isFinite(state.manual[`${state.from}_${state.to}`])
        || Number.isFinite(state.manual[`${state.to}_${state.from}`]);
      if (!Number.isFinite(rate)) { pairEl.textContent = ''; return; }
      const unit = 1 / rate;
      pairEl.innerHTML = `1 ${state.to} = <b>${formatMoney(unit, state.from)}</b> ${state.from}${manual ? ' · 수동' : ''}`;
    }

    function renderResult() {
      const raw = amountEl.value.trim().replace(/,/g, '');
      const amount = raw === '' ? 0 : Number(raw);
      const rate = rateFromTo(state.from, state.to);
      if (!Number.isFinite(amount) || !Number.isFinite(rate)) {
        resultEl.textContent = '—';
        return;
      }
      state.amount = amountEl.value;
      const value = amount * rate;
      resultEl.textContent = `${formatMoney(value, state.to)} ${currencyOf(state.to).symbol}`;
      renderPair();
      renderTable(amount);
    }

    function renderTable(amount) {
      const from = state.from;
      tableBaseEl.textContent = `${formatMoney(amount, from)} ${from} →`;
      tableEl.innerHTML = '';
      CURRENCIES.forEach((currency) => {
        if (currency.code === from) return;
        const rate = rateFromTo(from, currency.code);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'fx-row';
        row.dataset.code = currency.code;
        row.innerHTML = `<span class="fx-row-code">${currency.code}</span>
          <span class="fx-row-name">${currency.name}</span>
          <span class="fx-row-value">${Number.isFinite(rate) ? formatMoney(amount * rate, currency.code) : '—'}</span>`;
        row.addEventListener('click', () => {
          state.to = currency.code;
          toEl.value = currency.code;
          renderAll();
        }, { signal });
        tableEl.append(row);
      });
    }

    function manualRateValue() {
      const direct = state.manual[`${state.from}_${state.to}`];
      if (Number.isFinite(direct) && direct > 0) return direct;
      const inverse = state.manual[`${state.to}_${state.from}`];
      if (Number.isFinite(inverse) && inverse > 0) return 1 / inverse;
      return null;
    }

    function renderManual() {
      const manual = manualRateValue();
      manualLabel.textContent = `1 ${state.from} =`;
      manualInput.value = manual ? String(Number(manual.toPrecision(10))) : '';
      manualInput.placeholder = Number.isFinite(rateFromTo(state.from, state.to))
        ? `현재 ${Number(rateFromTo(state.from, state.to).toPrecision(6))} ${state.to}`
        : '환율 직접 입력';
      manualReset.hidden = !manual;
      manualEl.classList.toggle('is-manual', Boolean(manual));
      const unit = document.createElement('span');
      unit.className = 'fx-manual-unit';
      unit.textContent = state.to;
      if (!manualEl.querySelector('.fx-manual-unit')) manualEl.querySelector('.ic-row').append(unit);
      else manualEl.querySelector('.fx-manual-unit').textContent = state.to;
    }

    function renderAll() {
      renderStatus();
      renderResult();
      renderManual();
    }

    async function refreshRates() {
      if (!navigator.onLine) {
        renderStatus(false, '오프라인');
        toast('오프라인입니다. 마지막 환율로 계산합니다');
        return;
      }
      const local = new AbortController();
      const timer = setTimeout(() => local.abort(), 12000);
      renderStatus(true);
      try {
        const fresh = await fetchRates(local.signal);
        state.cache = fresh;
        writeJson(CACHE_KEY, fresh);
        renderAll();
        toast('환율을 갱신했습니다');
      } catch (error) {
        if (error && error.name === 'AbortError') {
          renderStatus(false, '응답 없음');
        } else {
          renderStatus(false, (error && error.message) || '알 수 없음');
        }
        console.error('[TIP currency-calc]', error);
      } finally {
        clearTimeout(timer);
      }
    }

    amountEl.addEventListener('input', renderResult, { signal });
    fromEl.addEventListener('change', () => {
      state.from = fromEl.value;
      renderAll();
    }, { signal });
    toEl.addEventListener('change', () => {
      state.to = toEl.value;
      renderAll();
    }, { signal });

    root.querySelector('#fx-swap').addEventListener('click', () => {
      const from = state.from;
      state.from = state.to;
      state.to = from;
      fromEl.value = state.from;
      toEl.value = state.to;
      renderAll();
    }, { signal });

    root.querySelector('#fx-manual-apply').addEventListener('click', () => {
      const value = Number(manualInput.value);
      if (!Number.isFinite(value) || value <= 0) {
        toast('0보다 큰 환율을 입력하세요');
        return;
      }
      state.manual[`${state.from}_${state.to}`] = value;
      writeJson(MANUAL_KEY, state.manual);
      renderAll();
      toast('수동 환율을 적용했습니다');
    }, { signal });

    manualReset.addEventListener('click', () => {
      delete state.manual[`${state.from}_${state.to}`];
      delete state.manual[`${state.to}_${state.from}`];
      writeJson(MANUAL_KEY, state.manual);
      renderAll();
      toast('자동 환율로 돌아왔습니다');
    }, { signal });

    renderAll();

    // 캐시가 없을 때만 온라인 상태에서 한 번 자동으로 받는다(이후에는 버튼으로만).
    if (!state.cache && navigator.onLine) {
      refreshRates();
    }

    return () => {
      controller.abort();
    };
  },
};

export default module;
