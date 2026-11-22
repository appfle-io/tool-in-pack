/**
 * TIP · 단위 변환기 (unit-converter)
 * 길이·무게·속도·온도·넓이(평)·부피·데이터 용량을 한 화면에서 즉시 변환한다.
 * 100% 오프라인 — 표를 코드에 두고 계산만 한다. 네트워크를 쓰지 않는다.
 */

import { icons } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h18M3 16h18"/><path d="M7 5v6M12 5v6M17 5v6M9 13v6M15 13v6"/></svg>`;

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15"/></svg>`;

const linear = (k) => ({ toBase: (v) => v * k, fromBase: (v) => v / k });

/** 카테고리 정의 — 기준 단위로 모은 뒤 각 단위로 되돌린다. */
const CATEGORIES = [
  {
    id: 'length',
    label: '길이',
    base: 'm',
    units: [
      { id: 'mm', label: '밀리미터', sym: 'mm', ...linear(0.001) },
      { id: 'cm', label: '센티미터', sym: 'cm', ...linear(0.01) },
      { id: 'm', label: '미터', sym: 'm', ...linear(1) },
      { id: 'km', label: '킬로미터', sym: 'km', ...linear(1000) },
      { id: 'in', label: '인치', sym: 'in', ...linear(0.0254) },
      { id: 'ft', label: '피트', sym: 'ft', ...linear(0.3048) },
      { id: 'yd', label: '야드', sym: 'yd', ...linear(0.9144) },
      { id: 'mi', label: '마일', sym: 'mi', ...linear(1609.344) },
      { id: 'nmi', label: '해리', sym: 'nmi', ...linear(1852) },
    ],
  },
  {
    id: 'mass',
    label: '무게',
    base: 'kg',
    units: [
      { id: 'mg', label: '밀리그램', sym: 'mg', ...linear(1e-6) },
      { id: 'g', label: '그램', sym: 'g', ...linear(0.001) },
      { id: 'kg', label: '킬로그램', sym: 'kg', ...linear(1) },
      { id: 't', label: '톤', sym: 't', ...linear(1000) },
      { id: 'oz', label: '온스', sym: 'oz', ...linear(0.028349523125) },
      { id: 'lb', label: '파운드', sym: 'lb', ...linear(0.45359237) },
      { id: 'don', label: '돈', sym: '돈', ...linear(0.00375) },
      { id: 'geun', label: '근', sym: '근', ...linear(0.6) },
    ],
  },
  {
    id: 'speed',
    label: '속도',
    base: 'mps',
    units: [
      { id: 'mps', label: '미터/초', sym: 'm/s', ...linear(1) },
      { id: 'kmh', label: '킬로미터/시', sym: 'km/h', ...linear(1 / 3.6) },
      { id: 'mph', label: '마일/시', sym: 'mph', ...linear(0.44704) },
      { id: 'kn', label: '노트', sym: 'kn', ...linear(0.5144444444444445) },
      { id: 'ftps', label: '피트/초', sym: 'ft/s', ...linear(0.3048) },
    ],
  },
  {
    id: 'temp',
    label: '온도',
    base: 'c',
    units: [
      { id: 'c', label: '섭씨', sym: '°C', toBase: (v) => v, fromBase: (v) => v },
      { id: 'f', label: '화씨', sym: '°F', toBase: (v) => (v - 32) * (5 / 9), fromBase: (v) => v * (9 / 5) + 32 },
      { id: 'k', label: '켈빈', sym: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
    ],
  },
  {
    id: 'area',
    label: '넓이',
    base: 'm2',
    units: [
      { id: 'mm2', label: '제곱밀리미터', sym: 'mm²', ...linear(1e-6) },
      { id: 'cm2', label: '제곱센티미터', sym: 'cm²', ...linear(1e-4) },
      { id: 'm2', label: '제곱미터', sym: 'm²', ...linear(1) },
      { id: 'km2', label: '제곱킬로미터', sym: 'km²', ...linear(1e6) },
      { id: 'pyeong', label: '평', sym: '평', ...linear(400 / 121) },
      { id: 'ha', label: '헥타르', sym: 'ha', ...linear(10000) },
      { id: 'acre', label: '에이커', sym: 'acre', ...linear(4046.8564224) },
      { id: 'ft2', label: '제곱피트', sym: 'ft²', ...linear(0.09290304) },
      { id: 'yd2', label: '제곱야드', sym: 'yd²', ...linear(0.83612736) },
    ],
  },
  {
    id: 'volume',
    label: '부피',
    base: 'l',
    units: [
      { id: 'ml', label: '밀리리터', sym: 'mL', ...linear(0.001) },
      { id: 'l', label: '리터', sym: 'L', ...linear(1) },
      { id: 'm3', label: '세제곱미터', sym: 'm³', ...linear(1000) },
      { id: 'hop', label: '홉', sym: '홉', ...linear(0.18) },
      { id: 'cup', label: '컵', sym: 'cup', ...linear(0.24) },
      { id: 'tbsp', label: '큰술', sym: 'tbsp', ...linear(0.01478676478125) },
      { id: 'tsp', label: '작은술', sym: 'tsp', ...linear(0.00492892159375) },
      { id: 'floz', label: '액량온스(US)', sym: 'fl oz', ...linear(0.0295735295625) },
      { id: 'gal', label: '갤런(US)', sym: 'gal', ...linear(3.785411784) },
    ],
  },
  {
    id: 'data',
    label: '데이터',
    base: 'b',
    units: [
      { id: 'bit', label: '비트', sym: 'bit', ...linear(0.125) },
      { id: 'b', label: '바이트', sym: 'B', ...linear(1) },
      { id: 'kb', label: '킬로바이트(SI)', sym: 'KB', ...linear(1e3) },
      { id: 'mb', label: '메가바이트(SI)', sym: 'MB', ...linear(1e6) },
      { id: 'gb', label: '기가바이트(SI)', sym: 'GB', ...linear(1e9) },
      { id: 'tb', label: '테라바이트(SI)', sym: 'TB', ...linear(1e12) },
      { id: 'kib', label: '키비바이트(IEC)', sym: 'KiB', ...linear(1024) },
      { id: 'mib', label: '메비바이트(IEC)', sym: 'MiB', ...linear(1024 ** 2) },
      { id: 'gib', label: '기비바이트(IEC)', sym: 'GiB', ...linear(1024 ** 3) },
      { id: 'tib', label: '테비바이트(IEC)', sym: 'TiB', ...linear(1024 ** 4) },
    ],
  },
];

const state = {
  category: 'length',
  base: 'm',
  amount: '1',
};

function categoryOf(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}

function unitOf(category, id) {
  return category.units.find((u) => u.id === id) || category.units[0];
}

/** 읽기 좋게: 아주 크거나 작으면 지수, 그 밖에는 자릿수 맞춘 소수. */
function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e15 || abs < 1e-9) return value.toExponential(4).replace('e+', 'e');
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  let text = value.toFixed(Math.min(digits, 12));
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  return Number(text).toLocaleString('ko-KR', { maximumFractionDigits: 12 });
}

function plainNumber(value) {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1e15 || (Math.abs(value) < 1e-9 && value !== 0)) return value.toExponential(6);
  return String(Number(value.toPrecision(12)));
}

async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

const module = {
  id: 'unit-converter',
  name: '단위 변환기',
  shortName: '단위 변환',
  kind: 'tool',
  category: 'utility',
  version: '1.0.0',
  subtitle: '길이·무게·평·온도 즉시 변환',
  description: '숫자 하나를 넣으면 같은 종류의 모든 단위로 동시에 바꿔 보여 줍니다. 100% 기기 안에서 계산합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx.toast || (() => {});
    const category = categoryOf(state.category);
    if (!category.units.some((u) => u.id === state.base)) state.base = category.base;

    root.innerHTML = `
      <div class="uc">
        <div class="uc-cats" id="uc-cats" role="tablist" aria-label="단위 종류"></div>

        <section class="uc-input-card">
          <label class="uc-amount-wrap">
            <span class="sr-only">변환할 값</span>
            <input class="uc-amount" id="uc-amount" type="number" inputmode="decimal" step="any"
                   autocomplete="off" value="${state.amount}">
          </label>
          <select class="uc-unit" id="uc-unit" aria-label="기준 단위"></select>
          <button class="icon-btn uc-clear" type="button" id="uc-clear" aria-label="입력 지우기" hidden>${icons.close}</button>
        </section>

        <p class="uc-hint" id="uc-hint"></p>

        <section class="uc-results" id="uc-results" aria-live="polite"></section>

        <p class="uc-note">값이나 단위를 눌러 복사합니다. 기기 안에서만 계산하며 네트워크를 쓰지 않습니다.</p>
      </div>`;

    const catsEl = root.querySelector('#uc-cats');
    const amountEl = root.querySelector('#uc-amount');
    const unitEl = root.querySelector('#uc-unit');
    const clearEl = root.querySelector('#uc-clear');
    const hintEl = root.querySelector('#uc-hint');
    const resultsEl = root.querySelector('#uc-results');

    function renderCats() {
      catsEl.innerHTML = '';
      CATEGORIES.forEach((cat) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'uc-cat';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-checked', String(cat.id === state.category));
        btn.setAttribute('aria-selected', String(cat.id === state.category));
        btn.textContent = cat.label;
        btn.addEventListener('click', () => {
          if (state.category === cat.id) return;
          state.category = cat.id;
          state.base = cat.base;
          state.amount = state.amount || '1';
          renderCats();
          renderUnits();
          renderResults();
        }, { signal });
        catsEl.append(btn);
      });
    }

    function renderUnits() {
      const cat = categoryOf(state.category);
      unitEl.innerHTML = '';
      cat.units.forEach((unit) => {
        const opt = document.createElement('option');
        opt.value = unit.id;
        opt.textContent = `${unit.label} (${unit.sym})`;
        opt.selected = unit.id === state.base;
        unitEl.append(opt);
      });
      unitEl.value = state.base;
    }

    function renderResults() {
      const cat = categoryOf(state.category);
      const baseUnit = unitOf(cat, state.base);
      const raw = amountEl.value.trim();
      const value = raw === '' ? NaN : Number(raw);
      clearEl.hidden = raw === '';

      resultsEl.innerHTML = '';

      if (!Number.isFinite(value)) {
        hintEl.textContent = '값을 입력하면 모든 단위로 바꿔 보여 줍니다.';
        const empty = document.createElement('p');
        empty.className = 'uc-empty';
        empty.textContent = '예: 1, 100, 3.5';
        resultsEl.append(empty);
        return;
      }

      hintEl.textContent = `${formatNumber(value)} ${baseUnit.sym} 기준`;
      const baseValue = baseUnit.toBase(value);

      cat.units.forEach((unit) => {
        const out = unit.fromBase(baseValue);
        const row = document.createElement('div');
        row.className = `uc-row${unit.id === cat.base ? ' is-base' : ''}`;
        row.innerHTML = `
          <div class="uc-row-main">
            <span class="uc-row-label">${unit.label} <em>${unit.sym}</em></span>
            <span class="uc-row-value" data-value="${plainNumber(out)}">${formatNumber(out)}</span>
          </div>
          <div class="uc-row-actions">
            <button class="uc-mini" type="button" data-set="${unit.id}"${unit.id === state.base ? ' hidden' : ''}>기준</button>
            <button class="icon-btn uc-copy" type="button" data-copy="${plainNumber(out)}" aria-label="${unit.label} 값 복사">${COPY_ICON}</button>
          </div>`;
        resultsEl.append(row);
      });
    }

    amountEl.addEventListener('input', () => {
      state.amount = amountEl.value;
      renderResults();
    }, { signal });

    unitEl.addEventListener('change', () => {
      const cat = categoryOf(state.category);
      const next = unitOf(cat, unitEl.value);
      const value = Number(amountEl.value);
      // 기준 단위를 바꿔도 같은 물리량이 유지되도록 값을 환산한다.
      if (Number.isFinite(value) && amountEl.value.trim() !== '') {
        const inBase = unitOf(cat, state.base).toBase(value);
        const shown = Number(next.fromBase(inBase).toPrecision(10));
        amountEl.value = String(shown);
        state.amount = amountEl.value;
      }
      state.base = next.id;
      renderResults();
    }, { signal });

    clearEl.addEventListener('click', () => {
      amountEl.value = '';
      state.amount = '';
      renderResults();
      amountEl.focus();
    }, { signal });

    resultsEl.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-copy], [data-set], [data-value]');
      if (!target) return;
      if (target.matches('[data-set]')) {
        const cat = categoryOf(state.category);
        const value = Number(amountEl.value);
        const currentBase = unitOf(cat, state.base);
        const next = unitOf(cat, target.getAttribute('data-set'));
        if (Number.isFinite(value) && amountEl.value.trim() !== '') {
          const inBase = currentBase.toBase(value);
          amountEl.value = String(Number(next.fromBase(inBase).toPrecision(10)));
          state.amount = amountEl.value;
        }
        state.base = next.id;
        renderUnits();
        renderResults();
        return;
      }
      const text = target.getAttribute('data-copy') || target.getAttribute('data-value');
      if (!text) return;
      const ok = await copyText(text);
      toast(ok ? `${text} 복사했습니다` : '복사하지 못했습니다');
    }, { signal });

    renderCats();
    renderUnits();
    renderResults();

    return () => controller.abort();
  },
};

export default module;
