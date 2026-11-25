/**
 * TIP · 색상 · 대비 체크 (color-tools)
 * HEX·RGB·HSL 양방향 변환 + WCAG 명도 대비율 검사. 화면에 보이는 색만 다루고 아무것도 전송하지 않는다.
 */

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2.2-1 2.2-2.2 0-.7-.3-1.3-.7-1.8-.3-.4-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7Z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1.1" fill="currentColor" stroke="none"/></svg>`;

const clamp255 = (value) => Math.max(0, Math.min(255, Math.round(value)));

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((part) => clamp255(part).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function hexToRgb(input) {
  const value = String(input).trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(value)) return null;
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
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

function hslToRgb({ h, s, l }) {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  if (ss === 0) {
    const v = clamp255(ll * 255);
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: clamp255(channel(hh + 1 / 3) * 255),
    g: clamp255(channel(hh) * 255),
    b: clamp255(channel(hh - 1 / 3) * 255),
  };
}

function parseRgbInput(value) {
  const numbers = String(value).match(/-?\d+(\.\d+)?/g);
  if (!numbers || numbers.length < 3) return null;
  return { r: clamp255(Number(numbers[0])), g: clamp255(Number(numbers[1])), b: clamp255(Number(numbers[2])) };
}

function parseHslInput(value) {
  const numbers = (String(value).match(/-?\d+(\.\d+)?/g) || []).map(Number);
  if (numbers.length < 3) return null;
  return hslToRgb({ h: numbers[0], s: numbers[1], l: numbers[2] });
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const module = {
  id: 'color-tools',
  accepts: ['image/*'],
  name: '색상 대비 체크',
  kind: 'tool',
  category: 'dev',
  version: '1.0.0',
  subtitle: '색 코드 변환과 대비 검사',
  description: '색을 HEX, RGB, HSL 로 서로 바꾸고 글자색과 배경색이 충분히 구분되는지 대비율로 검사합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    root.innerHTML = `
      <div class="v16 ct">
        <div class="ct-grid">
          <section class="v16-card ct-panel">
            <div class="ct-head">
              <span class="ct-role">글자색</span>
              <button class="v16-mini" type="button" id="ct-fg-eye" hidden>스포이드</button>
            </div>
            <div class="ct-pick-row">
              <input class="ct-pick" type="color" id="ct-fg-pick" aria-label="글자색 고르기">
              <div class="ct-fields">
                <div class="ct-field">
                  <span class="ct-k">HEX</span>
                  <input class="pt-input ct-input" id="ct-fg-hex" spellcheck="false" autocomplete="off" aria-label="글자색 HEX">
                  <button class="v16-mini" type="button" data-copy="fg-hex" aria-label="글자색 HEX 복사">복사</button>
                </div>
                <div class="ct-field">
                  <span class="ct-k">RGB</span>
                  <input class="pt-input ct-input" id="ct-fg-rgb" spellcheck="false" autocomplete="off" aria-label="글자색 RGB">
                  <button class="v16-mini" type="button" data-copy="fg-rgb" aria-label="글자색 RGB 복사">복사</button>
                </div>
                <div class="ct-field">
                  <span class="ct-k">HSL</span>
                  <input class="pt-input ct-input" id="ct-fg-hsl" spellcheck="false" autocomplete="off" aria-label="글자색 HSL">
                  <button class="v16-mini" type="button" data-copy="fg-hsl" aria-label="글자색 HSL 복사">복사</button>
                </div>
              </div>
            </div>
          </section>

          <section class="v16-card ct-panel">
            <div class="ct-head">
              <span class="ct-role">배경색</span>
              <button class="v16-mini" type="button" id="ct-bg-eye" hidden>스포이드</button>
            </div>
            <div class="ct-pick-row">
              <input class="ct-pick" type="color" id="ct-bg-pick" aria-label="배경색 고르기">
              <div class="ct-fields">
                <div class="ct-field">
                  <span class="ct-k">HEX</span>
                  <input class="pt-input ct-input" id="ct-bg-hex" spellcheck="false" autocomplete="off" aria-label="배경색 HEX">
                  <button class="v16-mini" type="button" data-copy="bg-hex" aria-label="배경색 HEX 복사">복사</button>
                </div>
                <div class="ct-field">
                  <span class="ct-k">RGB</span>
                  <input class="pt-input ct-input" id="ct-bg-rgb" spellcheck="false" autocomplete="off" aria-label="배경색 RGB">
                  <button class="v16-mini" type="button" data-copy="bg-rgb" aria-label="배경색 RGB 복사">복사</button>
                </div>
                <div class="ct-field">
                  <span class="ct-k">HSL</span>
                  <input class="pt-input ct-input" id="ct-bg-hsl" spellcheck="false" autocomplete="off" aria-label="배경색 HSL">
                  <button class="v16-mini" type="button" data-copy="bg-hsl" aria-label="배경색 HSL 복사">복사</button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section class="v16-card ct-contrast">
          <div class="ct-ratio-row">
            <div>
              <div class="ct-ratio" id="ct-ratio">21.00 : 1</div>
              <div class="ct-ratio-label" id="ct-ratio-label">일반 텍스트 AAA 통과</div>
            </div>
            <button class="v16-btn" type="button" id="ct-swap">글자 ↔ 배경</button>
          </div>
          <div class="ct-badges" id="ct-badges"></div>
          <div class="ct-preview" id="ct-preview">
            <div class="ct-prev-big">큰 텍스트 24px</div>
            <div class="ct-prev-small">본문 텍스트 14px. 이 배경에서 이 글자가 읽히는지 확인하세요.</div>
          </div>
        </section>

        <section class="v16-card ct-palette">
          <div class="ct-head">
            <span class="ct-role">사진에서 대표색</span>
            <span class="ct-pal-hint" id="ct-pal-hint">사진을 고르면 5~8가지 대표색을 뽑습니다</span>
          </div>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="ct-pal-browse">사진 선택</button>
          </div>
          <input type="file" id="ct-pal-input" class="sr-only" accept="image/*">
          <div class="ct-pal-list" id="ct-pal-list"></div>
          <p class="v16-note">대표색을 누르면 글자색, 옆의 [배경]을 누르면 배경색에 넣고 바로 대비를 잽니다. 사진은 기기 밖으로 나가지 않습니다.</p>
        </section>
      </div>`;

    const state = {
      fg: { r: 46, g: 94, b: 78 },
      bg: { r: 255, g: 255, b: 255 },
    };

    const els = {
      fg: {
        pick: root.querySelector('#ct-fg-pick'),
        hex: root.querySelector('#ct-fg-hex'),
        rgb: root.querySelector('#ct-fg-rgb'),
        hsl: root.querySelector('#ct-fg-hsl'),
      },
      bg: {
        pick: root.querySelector('#ct-bg-pick'),
        hex: root.querySelector('#ct-bg-hex'),
        rgb: root.querySelector('#ct-bg-rgb'),
        hsl: root.querySelector('#ct-bg-hsl'),
      },
    };

    const ratioEl = root.querySelector('#ct-ratio');
    const ratioLabel = root.querySelector('#ct-ratio-label');
    const badgesEl = root.querySelector('#ct-badges');
    const preview = root.querySelector('#ct-preview');

    function renderColor(key, skip) {
      const color = state[key];
      const hex = rgbToHex(color);
      if (skip !== 'hex') els[key].hex.value = hex;
      if (skip !== 'rgb') els[key].rgb.value = `${color.r}, ${color.g}, ${color.b}`;
      if (skip !== 'hsl') {
        const hsl = rgbToHsl(color);
        els[key].hsl.value = `${hsl.h}, ${hsl.s}%, ${hsl.l}%`;
      }
      if (skip !== 'pick') els[key].pick.value = hex.toLowerCase();
    }

    function renderContrast() {
      const fgHex = rgbToHex(state.fg);
      const bgHex = rgbToHex(state.bg);
      const ratio = contrastRatio(state.fg, state.bg);
      ratioEl.textContent = `${ratio.toFixed(2)} : 1`;

      const checks = [
        { label: '일반 텍스트 AA', need: 4.5 },
        { label: '일반 텍스트 AAA', need: 7 },
        { label: '큰 텍스트 AA', need: 3 },
      ];
      badgesEl.innerHTML = checks.map((check) => {
        const pass = ratio >= check.need;
        return `<span class="ct-badge ${pass ? 'pass' : 'fail'}">
          <b>${pass ? '통과' : '미달'}</b>${check.label} ${check.need}:1</span>`;
      }).join('');

      if (ratio >= 7) ratioLabel.textContent = '일반 텍스트까지 충분합니다 (AAA)';
      else if (ratio >= 4.5) ratioLabel.textContent = '일반 텍스트 AA를 통과합니다';
      else if (ratio >= 3) ratioLabel.textContent = '큰 텍스트만 AA를 통과합니다';
      else ratioLabel.textContent = '대비가 부족합니다 (3:1 미만)';

      preview.style.color = fgHex;
      preview.style.background = bgHex;
      preview.style.borderColor = bgHex === '#FFFFFF' ? '' : bgHex;
    }

    function update(key, skip) {
      renderColor(key, skip);
      renderContrast();
    }

    /* ------------------------------ 입력 처리 ------------------------------ */

    [['fg', 'hex'], ['fg', 'rgb'], ['fg', 'hsl'], ['bg', 'hex'], ['bg', 'rgb'], ['bg', 'hsl']]
      .forEach(([key, kind]) => {
        const input = els[key][kind];
        input.addEventListener('input', () => {
          const parsed = kind === 'hex' ? hexToRgb(input.value)
            : kind === 'rgb' ? parseRgbInput(input.value)
              : parseHslInput(input.value);
          if (!parsed) return;
          state[key] = parsed;
          update(key, kind);
        }, { signal });
        input.addEventListener('blur', () => update(key), { signal });
      });

    ['fg', 'bg'].forEach((key) => {
      els[key].pick.addEventListener('input', () => {
        const parsed = hexToRgb(els[key].pick.value);
        if (!parsed) return;
        state[key] = parsed;
        update(key);
      }, { signal });
    });

    root.querySelector('#ct-swap').addEventListener('click', () => {
      const fg = state.fg;
      state.fg = state.bg;
      state.bg = fg;
      update('fg');
      update('bg');
      toast('글자색과 배경색을 바꿨습니다');
    }, { signal });

    root.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        const [key, kind] = button.dataset.copy.split('-');
        toast(await copyText(els[key][kind].value) ? '복사했습니다' : '복사하지 못했습니다');
      }, { signal });
    });

    /* ------------------------------- 스포이드 ------------------------------- */

    if ('EyeDropper' in window) {
      [['fg', '#ct-fg-eye'], ['bg', '#ct-bg-eye']].forEach(([key, selector]) => {
        const button = root.querySelector(selector);
        button.hidden = false;
        button.addEventListener('click', async () => {
          try {
            const result = await new window.EyeDropper().open();
            const parsed = hexToRgb(result.sRGBHex);
            if (!parsed) return;
            state[key] = parsed;
            update(key);
          } catch {
            /* 사용자가 취소함 */
          }
        }, { signal });
      });
    }

    /* --------------------------- 사진 대표색 (v1.16.0) --------------------------- */

    const palInput = root.querySelector('#ct-pal-input');
    const palList = root.querySelector('#ct-pal-list');
    const palHint = root.querySelector('#ct-pal-hint');

    /** 큰 덩어리의 색을 세어 대표색을 고른다 — 4비트씩(16단계) 칸으로 나눠 가장 많은 칸부터. */
    function dominantColors(imageData, max = 8) {
      const { data } = imageData;
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i] >> 4;
        const g = data[i + 1] >> 4;
        const b = data[i + 2] >> 4;
        const key = (r << 8) | (g << 4) | b;
        const found = buckets.get(key);
        if (found) {
          found.count += 1;
          found.r += data[i];
          found.g += data[i + 1];
          found.b += data[i + 2];
        } else {
          buckets.set(key, { count: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
        }
      }
      const sorted = [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .map((bucket) => ({
          r: Math.round(bucket.r / bucket.count),
          g: Math.round(bucket.g / bucket.count),
          b: Math.round(bucket.b / bucket.count),
          count: bucket.count,
        }));
      const picked = [];
      for (const color of sorted) {
        if (picked.length >= max) break;
        const near = picked.some((other) => Math.abs(other.r - color.r) + Math.abs(other.g - color.g) + Math.abs(other.b - color.b) < 48);
        if (!near) picked.push(color);
      }
      return picked.slice(0, Math.max(5, Math.min(max, picked.length)));
    }

    function renderPalette(colors) {
      palList.innerHTML = '';
      colors.forEach((color) => {
        const hex = rgbToHex(color);
        const row = document.createElement('div');
        row.className = 'ct-pal-row';
        row.innerHTML = `
          <button class="ct-pal-swatch" type="button" aria-label="${hex} 를 글자색으로"></button>
          <span class="ct-pal-hex mono">${hex}</span>
          <button class="v16-mini" type="button" data-role="bg" aria-label="${hex} 를 배경색으로">배경</button>`;
        row.querySelector('.ct-pal-swatch').style.background = hex;
        row.querySelector('.ct-pal-swatch').addEventListener('click', () => {
          state.fg = { r: color.r, g: color.g, b: color.b };
          update('fg');
          toast(`${hex} 를 글자색으로 넣었습니다`);
        }, { signal });
        row.querySelector('[data-role="bg"]').addEventListener('click', () => {
          state.bg = { r: color.r, g: color.g, b: color.b };
          update('bg');
          toast(`${hex} 를 배경색으로 넣었습니다`);
        }, { signal });
        palList.append(row);
      });
    }

    async function readPalette(file) {
      if (!file) return;
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) {
        palHint.textContent = '이미지 파일만 넣을 수 있습니다';
        return;
      }
      palHint.textContent = '대표색을 뽑는 중…';
      const url = URL.createObjectURL(file);
      try {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('그림을 읽지 못했습니다'));
        });
        image.src = url;
        await loaded;
        const scale = Math.min(1, 320 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const colors = dominantColors(context.getImageData(0, 0, canvas.width, canvas.height));
        renderPalette(colors);
        palHint.textContent = `${colors.length}가지 대표색`;
      } catch (error) {
        console.error('[TIP color-tools]', error);
        palHint.textContent = '대표색을 뽑지 못했습니다 (HEIC 사진은 이미지 컨버터로 먼저 바꿔 주세요)';
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    root.querySelector('#ct-pal-browse').addEventListener('click', () => palInput.click(), { signal });
    palInput.addEventListener('change', () => {
      const file = palInput.files && palInput.files[0];
      palInput.value = '';
      readPalette(file);
    }, { signal });
    root.addEventListener('dragover', (event) => {
      if (!event.dataTransfer) return;
      event.preventDefault();
    }, { signal });
    root.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      readPalette(file);
    }, { signal });

    update('fg');
    update('bg');

    return () => controller.abort();
  },
};

export default module;
