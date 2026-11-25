/**
 * TIP · 화면 스포이드 (screen-picker, v1.14.0 — Mac 앱 전용)
 *
 * macOS 내장 NSColorSampler 로 화면 어디든 클릭해 색을 집는다. ESC 로 취소.
 * 고른 색은 설정한 형식(HEX/RGB/HSL)으로 복사되고 최근 색 12개를 기억한다.
 * 색을 읽는 일은 전부 이 기기 안에서 끝난다.
 */

import { getFeatureValue } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4l5 5"/><path d="M13.5 5.5l5 5-8.6 8.6a2 2 0 0 1-1 .5l-3.6.7.7-3.6a2 2 0 0 1 .5-1z"/><path d="M4 20l1.5-1.5"/></svg>`;

const HISTORY_KEY = 'tip.pickerHistory.v1';
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHsl({ r, g, b }) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else h = ((rr - gg) / d + 4) / 6;
  }
  return { h: Math.round(h * 360) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** 설정한 형식으로 색을 글로 쓴다. */
export function formatColor(hex, format) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  if (format === 'rgb') return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  if (format === 'hsl') {
    const hsl = rgbToHsl(rgb);
    return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  }
  return String(hex).toUpperCase();
}

function readHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 12)));
  } catch { /* 저장하지 못해도 이번 색은 보인다 */ }
}

const module = {
  id: 'screen-picker',
  name: '화면 스포이드',
  shortName: '스포이드',
  kind: 'tool',
  category: 'mac',
  version: '1.14.0',
  subtitle: '화면의 색을 클릭해 집기',
  description: '화면 어디든 클릭해 색을 집고 HEX, RGB, HSL 로 복사합니다. 최근 색 12개를 기억합니다.',
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
      <div class="v16 pick">
        <div class="pick-hero" id="pick-hero">
          <button class="pick-btn" type="button" id="pick-run">${ICON}<span>화면에서 색 고르기</span></button>
          <p class="v16-note">버튼을 누른 뒤 화면의 원하는 곳을 클릭하세요. ESC 로 취소합니다.</p>
        </div>
        <div class="pick-card" id="pick-card" hidden>
          <div class="pick-swatch-big" id="pick-swatch"></div>
          <div class="pick-values">
            <button class="pick-value" type="button" data-format="hex"><b id="pick-hex">#000000</b><span>HEX</span></button>
            <button class="pick-value" type="button" data-format="rgb"><b id="pick-rgb">rgb(0, 0, 0)</b><span>RGB</span></button>
            <button class="pick-value" type="button" data-format="hsl"><b id="pick-hsl">hsl(0, 0%, 0%)</b><span>HSL</span></button>
          </div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="pick-contrast">색상 대비 체크로 보내기</button>
          </div>
        </div>
        <div class="v16-block-head"><span>최근 색</span><button class="v16-mini" type="button" id="pick-clear">지우기</button></div>
        <div class="pick-history" id="pick-history"></div>
      </div>`;

    const card = root.querySelector('#pick-card');
    const swatch = root.querySelector('#pick-swatch');
    const hexEl = root.querySelector('#pick-hex');
    const rgbEl = root.querySelector('#pick-rgb');
    const hslEl = root.querySelector('#pick-hsl');
    const historyEl = root.querySelector('#pick-history');
    let current = '';

    function paint(hex) {
      current = hex;
      card.hidden = false;
      swatch.style.background = hex;
      hexEl.textContent = formatColor(hex, 'hex');
      rgbEl.textContent = formatColor(hex, 'rgb');
      hslEl.textContent = formatColor(hex, 'hsl');
    }

    function renderHistory() {
      const list = readHistory();
      historyEl.innerHTML = '';
      if (!list.length) {
        historyEl.append(Object.assign(document.createElement('p'), {
          className: 'v16-note', textContent: '아직 고른 색이 없습니다.',
        }));
        return;
      }
      list.forEach((hex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pick-history-dot';
        button.style.background = hex;
        button.title = hex.toUpperCase();
        button.setAttribute('aria-label', `${hex.toUpperCase()} 복사`);
        button.addEventListener('click', () => copy(hex), { signal });
        historyEl.append(button);
      });
    }

    async function copy(hex) {
      const text = formatColor(hex, getFeatureValue('picker.format', 'hex'));
      try {
        if (TAURI) await C.invoke('copy_text', { text });
        else await navigator.clipboard.writeText(text);
        toast(`${text} 를 복사했습니다`);
      } catch (error) {
        console.error('[TIP picker]', error);
        toast('색을 복사하지 못했습니다');
      }
    }

    async function pick() {
      if (!TAURI) {
        toast('화면 스포이드는 Mac 앱에서 쓸 수 있습니다');
        return;
      }
      try {
        await C.invoke('pick_screen_color');
      } catch (error) {
        console.error('[TIP picker]', error);
        toast(typeof error === 'string' ? error : '스포이드를 열지 못했습니다');
      }
    }

    root.querySelector('#pick-run').addEventListener('click', pick, { signal });

    if (TAURI && window.__TAURI__.event) {
      window.__TAURI__.event.listen('tip://color-picked', async (event) => {
        const pick = event.payload || {};
        if (pick.cancelled) {
          toast('색 고르기를 취소했습니다');
          return;
        }
        if (!pick.color) return;
        // 스포이드 모듈을 열어 두지 않았어도 색은 복사되고 기록에 남는다.
        paint(pick.color);
        const list = [pick.color, ...readHistory().filter((value) => value !== pick.color)];
        writeHistory(list);
        renderHistory();
        if (getFeatureValue('picker.autoCopy', true)) await copy(pick.color);
      });
    }

    root.querySelectorAll('.pick-value').forEach((button) => {
      button.addEventListener('click', () => {
        if (!current) return;
        const text = button.dataset.format === 'hex' ? current.toUpperCase()
          : button.dataset.format === 'rgb' ? formatColor(current, 'rgb')
            : formatColor(current, 'hsl');
        (async () => {
          try {
            if (TAURI) await C.invoke('copy_text', { text });
            else await navigator.clipboard.writeText(text);
            toast(`${text} 를 복사했습니다`);
          } catch {
            toast('복사하지 못했습니다');
          }
        })();
      }, { signal });
    });

    root.querySelector('#pick-contrast').addEventListener('click', () => {
      if (!current) return;
      try {
        localStorage.setItem('tip.colorHandoff.v1', JSON.stringify({ hex: current, target: 'fg', created: Date.now() }));
      } catch { /* 저장하지 못하면 그냥 이동 */ }
      if (ctx?.goModule) ctx.goModule('color-tools');
      else location.hash = '#/color-tools';
    }, { signal });

    root.querySelector('#pick-clear').addEventListener('click', () => {
      writeHistory([]);
      renderHistory();
      toast('최근 색을 지웠습니다');
    }, { signal });

    renderHistory();
    if (!TAURI) root.querySelector('#pick-run').textContent = 'Mac 앱에서 쓸 수 있습니다';

    return () => controller.abort();
  },
};

export default module;
