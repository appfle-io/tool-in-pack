/**
 * TIP · QR 생성기 (qr-gen)
 * URL / 텍스트 / 와이파이 접속 정보를 QR로 만든다. qrcode-generator(vendor)를 셀프 호스팅.
 * 미리보기는 실시간, 저장은 PNG · SVG 두 가지. 전부 기기 안에서 처리.
 */

import qrcode from '../../vendor/qrcode/qrcode.mjs';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1"/></svg>`;

const TYPES = [
  { id: 'url', label: 'URL' },
  { id: 'text', label: '텍스트' },
  { id: 'wifi', label: '와이파이' },
];

const SIZES = [256, 512, 1024];
const LEVELS = ['L', 'M', 'Q', 'H'];

function escapeWifi(value) {
  return String(value || '').replace(/([\\;,:"])/g, '\\$1');
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const module = {
  id: 'qr-gen',
  name: 'QR 생성기',
  kind: 'tool',
  category: 'utility',
  version: '1.0.0',
  subtitle: 'URL · 텍스트 · 와이파이 QR',
  description: 'URL, 텍스트, 와이파이 접속 정보를 QR로 만들어 PNG·SVG로 저장합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root) {
    const controller = new AbortController();
    const { signal } = controller;

    let type = 'url';
    let size = 512;
    let margin = 4;
    let level = 'M';
    let fg = '#000000';
    let bg = '#FFFFFF';
    let lastQr = null;

    root.innerHTML = `
      <div class="qr">
        <div class="qr-grid">
          <div class="qr-head">
            <div class="ic-segment" id="qr-types" role="tablist" aria-label="QR 종류"></div>

            <div class="qr-fieldset" id="qr-field-url">
              <label class="qr-label" for="qr-url">주소</label>
              <input class="pt-input qr-input" id="qr-url" type="url" inputmode="url"
                     placeholder="https://example.com" autocomplete="off" spellcheck="false">
            </div>

            <div class="qr-fieldset" id="qr-field-text" hidden>
              <label class="qr-label" for="qr-text">내용</label>
              <textarea class="pt-input qr-input qr-textarea" id="qr-text" rows="3"
                        placeholder="QR에 담을 텍스트"></textarea>
            </div>

            <div class="qr-fieldset" id="qr-field-wifi" hidden>
              <div class="qr-wifi-row">
                <label class="qr-label" for="qr-ssid">SSID</label>
                <input class="pt-input qr-input" id="qr-ssid" placeholder="와이파이 이름" autocomplete="off" spellcheck="false">
              </div>
              <div class="qr-wifi-row">
                <label class="qr-label" for="qr-pass">비밀번호</label>
                <div class="qr-pass-wrap">
                  <input class="pt-input qr-input" id="qr-pass" type="password" placeholder="비밀번호" autocomplete="off">
                  <button class="tool-btn qr-eye" type="button" id="qr-eye" aria-label="비밀번호 보기" aria-pressed="false">보기</button>
                </div>
              </div>
              <div class="qr-wifi-row">
                <label class="qr-label" for="qr-enc">암호화</label>
                <select class="pt-input qr-input" id="qr-enc">
                  <option value="WPA">WPA / WPA2 / WPA3</option>
                  <option value="WEP">WEP</option>
                  <option value="nopass">없음 (개방)</option>
                </select>
              </div>
            </div>
          </div>

          <div class="qr-preview">
            <div class="qr-canvas-wrap">
              <canvas id="qr-canvas" width="512" height="512" aria-label="QR 미리보기"></canvas>
              <p class="qr-placeholder" id="qr-placeholder">내용을 입력하면 QR이 만들어집니다</p>
            </div>
            <div class="qr-payload" id="qr-payload" hidden>
              <span class="qr-payload-k">담기는 내용</span>
              <code id="qr-payload-text"></code>
            </div>
          </div>

          <div class="qr-controls">
            <div class="ic-options qr-options">
              <div class="ic-row">
                <span class="ic-label">크기</span>
                <div class="ic-segment" id="qr-sizes" role="radiogroup" aria-label="이미지 크기"></div>
                <span class="ic-hint">px</span>
              </div>
              <div class="ic-row">
                <span class="ic-label">여백</span>
                <input type="range" id="qr-margin" min="0" max="8" step="1" value="4" aria-label="여백(모듈 수)">
                <span class="pp-value" id="qr-margin-value">4</span>
              </div>
              <div class="ic-row">
                <span class="ic-label">오류</span>
                <div class="ic-segment" id="qr-levels" role="radiogroup" aria-label="오류 정정 수준"></div>
              </div>
              <div class="ic-row">
                <span class="ic-label">색</span>
                <label class="qr-color"><input type="color" id="qr-fg" value="#000000" aria-label="전경색"><span>전경</span></label>
                <label class="qr-color"><input type="color" id="qr-bg" value="#FFFFFF" aria-label="배경색"><span>배경</span></label>
                <button class="tool-btn" type="button" id="qr-swap">${'↔'} 바꾸기</button>
              </div>
            </div>

            <div class="ic-actions pp-actions">
              <button class="primary-btn" type="button" id="qr-png">PNG 저장</button>
              <button class="primary-btn ghost" type="button" id="qr-svg">SVG 저장</button>
            </div>
          </div>
        </div>
        <div id="qr-msg"></div>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const canvas = $('#qr-canvas');
    const ctx = canvas.getContext('2d');
    const placeholder = $('#qr-placeholder');
    const payloadEl = $('#qr-payload');
    const payloadText = $('#qr-payload-text');
    const msgEl = $('#qr-msg');
    const pngBtn = $('#qr-png');
    const svgBtn = $('#qr-svg');

    /* ------------------------------ controls ------------------------------ */

    const typesEl = $('#qr-types');
    TYPES.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-seg';
      btn.setAttribute('role', 'tab');
      btn.dataset.type = item.id;
      btn.setAttribute('aria-checked', String(item.id === type));
      btn.textContent = item.label;
      typesEl.append(btn);
    });
    typesEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-type]');
      if (!btn) return;
      type = btn.dataset.type;
      typesEl.querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      $('#qr-field-url').hidden = type !== 'url';
      $('#qr-field-text').hidden = type !== 'text';
      $('#qr-field-wifi').hidden = type !== 'wifi';
      render();
    }, { signal });

    const sizesEl = $('#qr-sizes');
    SIZES.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-seg';
      btn.setAttribute('role', 'radio');
      btn.dataset.size = String(value);
      btn.setAttribute('aria-checked', String(value === size));
      btn.textContent = String(value);
      sizesEl.append(btn);
    });
    sizesEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-size]');
      if (!btn) return;
      size = Number(btn.dataset.size);
      sizesEl.querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      render();
    }, { signal });

    const levelsEl = $('#qr-levels');
    LEVELS.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-seg';
      btn.setAttribute('role', 'radio');
      btn.dataset.level = value;
      btn.setAttribute('aria-checked', String(value === level));
      btn.textContent = value;
      levelsEl.append(btn);
    });
    levelsEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-level]');
      if (!btn) return;
      level = btn.dataset.level;
      levelsEl.querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      render();
    }, { signal });

    $('#qr-margin').addEventListener('input', (event) => {
      margin = Number(event.target.value);
      $('#qr-margin-value').textContent = String(margin);
      render();
    }, { signal });

    $('#qr-fg').addEventListener('input', (event) => { fg = event.target.value; render(); }, { signal });
    $('#qr-bg').addEventListener('input', (event) => { bg = event.target.value; render(); }, { signal });
    $('#qr-swap').addEventListener('click', () => {
      [fg, bg] = [bg, fg];
      $('#qr-fg').value = fg;
      $('#qr-bg').value = bg;
      render();
    }, { signal });

    $('#qr-eye').addEventListener('click', (event) => {
      const input = $('#qr-pass');
      const shown = input.type === 'password';
      input.type = shown ? 'text' : 'password';
      event.currentTarget.textContent = shown ? '숨기기' : '보기';
      event.currentTarget.setAttribute('aria-pressed', String(shown));
    }, { signal });

    ['#qr-url', '#qr-text', '#qr-ssid', '#qr-pass'].forEach((sel) => {
      $(sel).addEventListener('input', render, { signal });
    });
    $('#qr-enc').addEventListener('change', render, { signal });

    pngBtn.addEventListener('click', savePng, { signal });
    svgBtn.addEventListener('click', saveSvg, { signal });

    /* ------------------------------- payload ------------------------------ */

    function payloadFor() {
      if (type === 'url') {
        const value = $('#qr-url').value.trim();
        return value;
      }
      if (type === 'text') return $('#qr-text').value;
      const ssid = $('#qr-ssid').value;
      if (!ssid) return '';
      const enc = $('#qr-enc').value;
      if (enc === 'nopass') return `WIFI:T:nopass;S:${escapeWifi(ssid)};;`;
      const pass = $('#qr-pass').value;
      return `WIFI:T:${enc};S:${escapeWifi(ssid)};P:${escapeWifi(pass)};;`;
    }

    function prettyPayload(text) {
      if (type === 'wifi') return text.replace(/;;$/, ';');
      return text;
    }

    /* -------------------------------- render ------------------------------ */

    function render() {
      msgEl.innerHTML = '';
      const text = payloadFor();

      if (!text) {
        lastQr = null;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        canvas.width = 256;
        canvas.height = 256;
        ctx.clearRect(0, 0, 256, 256);
        canvas.classList.add('is-empty');
        placeholder.hidden = false;
        payloadEl.hidden = true;
        pngBtn.disabled = true;
        svgBtn.disabled = true;
        return;
      }

      canvas.classList.remove('is-empty');
      placeholder.hidden = true;
      payloadEl.hidden = false;
      payloadText.textContent = prettyPayload(text);

      let qr;
      try {
        qr = qrcode(0, level);
        qr.addData(text);
        qr.make();
      } catch (error) {
        console.warn('[TIP qr-gen]', error);
        lastQr = null;
        pngBtn.disabled = true;
        svgBtn.disabled = true;
        placeholder.hidden = false;
        placeholder.textContent = '내용이 너무 길어 QR로 만들 수 없습니다';
        return;
      }

      const count = qr.getModuleCount();
      const cells = count + margin * 2;
      const cell = Math.max(1, Math.floor(size / cells));
      const dim = cell * cells;

      canvas.width = dim;
      canvas.height = dim;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, dim, dim);
      ctx.fillStyle = fg;
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (!qr.isDark(row, col)) continue;
          ctx.fillRect((col + margin) * cell, (row + margin) * cell, cell, cell);
        }
      }

      lastQr = { qr, count, dim, cell };
      canvas.dataset.modules = String(count);
      pngBtn.disabled = false;
      svgBtn.disabled = false;
      payloadText.dataset.version = String(Math.floor((count - 17) / 4) + 1);
    }

    /* -------------------------------- saving ------------------------------ */

    function fileName(ext) {
      const stamp = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const label = type === 'wifi' ? 'wifi' : type === 'url' ? 'url' : 'text';
      return `qr-${label}-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.${ext}`;
    }

    async function savePng() {
      if (!lastQr) return;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) download(blob, fileName('png'));
    }

    function svgString() {
      const { qr, count } = lastQr;
      const cells = count + margin * 2;
      const parts = [`<rect width="${cells}" height="${cells}" fill="${bg}"/>`];
      let path = '';
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (!qr.isDark(row, col)) continue;
          path += `M${col + margin} ${row + margin}h1v1h-1z`;
        }
      }
      parts.push(`<path d="${path}" fill="${fg}"/>`);
      return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${cells} ${cells}" shape-rendering="crispEdges">
${parts.join('\n')}
</svg>
`;
    }

    function saveSvg() {
      if (!lastQr) return;
      download(new Blob([svgString()], { type: 'image/svg+xml' }), fileName('svg'));
    }

    render();

    return () => controller.abort();
  },
};

export default module;
