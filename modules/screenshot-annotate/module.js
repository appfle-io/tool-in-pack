/**
 * TIP · 스크린샷+표시 (screenshot-annotate, v1.16.0 — Mac 앱 전용)
 *
 * 화면의 한 영역을 찍고 바로 화살표·사각형·글자·모자이크를 그려 복사하거나 저장한다.
 * 찍기·그리기 모두 기기 안에서 하고, 찍은 그림은 임시 폴더에만 잠깐 남는다(macOS 화면 기록 권한).
 * 모자이크 계산은 사진 모자이크(photo-privacy)와 같은 js/mosaic.js 를 쓴다.
 */

import { pixelate } from '../../js/mosaic.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M14.5 9.5l4 4M18.5 9.5l-4 4"/></svg>`;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

const TOOLS = [
  { id: 'arrow', label: '화살표' },
  { id: 'rect', label: '사각형' },
  { id: 'text', label: '글자' },
  { id: 'mosaic', label: '모자이크' },
];

const COLORS = [
  { id: '#E11D48', label: '빨강' },
  { id: '#C2410C', label: '주황' },
  { id: '#2563EB', label: '파랑' },
  { id: '#2E5E4E', label: '초록' },
  { id: '#111111', label: '검정' },
  { id: '#FFFFFF', label: '흰색' },
];

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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
  id: 'screenshot-annotate',
  name: '스크린샷 표시',
  shortName: '스크린샷',
  kind: 'tool',
  category: 'mac',
  version: '1.16.0',
  subtitle: '찍고 바로 표시하기',
  description: '화면의 한 영역을 찍어 화살표, 사각형, 글자, 모자이크를 그리고 복사하거나 PNG 로 저장합니다.',
  icon: ICON,
  badge: 'Mac',
  macOnly: true,
  accepts: ['image/*'],
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    let tool = 'arrow';
    let color = COLORS[0].id;
    let stroke = 3;
    let text = '';
    let base = null;          // 찍은 그림(ImageBitmap)
    let ops = [];             // 그린 것들 — 되돌리기는 이 목록을 다시 그린다
    let drawing = null;
    let scale = 1;            // 캔버스 실제 크기 / 화면에 보이는 크기
    let permBtn = null;

    root.innerHTML = `
      <div class="v16 sa">
        <div class="dr-empty" id="sa-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="sa-capture">화면 영역 드래그해서 찍기</button>
          <p>찍은 뒤 화살표·사각형·글자·모자이크를 그리고 복사하거나 저장합니다. 처음 한 번은 화면 기록 권한을 물어봅니다.</p>
        </div>

        <div id="sa-main" hidden>
          <div class="sa-tools">
            <div class="ic-segment" id="sa-tool-list" role="radiogroup" aria-label="그리기 도구"></div>
            <div class="sa-colors" id="sa-color-list" role="radiogroup" aria-label="색"></div>
          </div>
          <div class="sa-thick">
            <label class="v16-label" for="sa-stroke">굵기</label>
            <input class="pt-input v16-input sa-stroke" id="sa-stroke" type="range" min="1" max="8" step="1" value="3">
            <span class="sa-thick-value" id="sa-stroke-value">3</span>
          </div>
          <div class="sa-text" id="sa-text-row">
            <label class="v16-label" for="sa-text">넣을 글자</label>
            <input class="pt-input v16-input" id="sa-text" placeholder="그림에 넣을 글자" autocomplete="off">
          </div>

          <div class="sa-stage" id="sa-stage">
            <canvas id="sa-canvas" aria-label="찍은 화면. 끌어서 그립니다"></canvas>
          </div>

          <div class="v16-actions">
            <button class="v16-btn" type="button" id="sa-undo">되돌리기</button>
            <button class="v16-btn" type="button" id="sa-reset">모두 지우기</button>
            <button class="v16-btn" type="button" id="sa-recapture">다시 찍기</button>
            <button class="v16-btn" type="button" id="sa-copy">복사</button>
            <button class="v16-btn primary" type="button" id="sa-save">저장</button>
          </div>
          <p class="v16-note">글자는 [글자] 도구를 고르고 그림을 누른 자리에 들어갑니다. 모자이크는 끌어서 칠합니다.</p>
        </div>

        <div class="v16-status" id="sa-status" hidden></div>
      </div>`;

    const empty = root.querySelector('#sa-empty');
    const main = root.querySelector('#sa-main');
    const statusEl = root.querySelector('#sa-status');
    const canvas = root.querySelector('#sa-canvas');
    const ctx2d = canvas.getContext('2d');
    const scratch = document.createElement('canvas');

    function setStatus(text, kind = 'bad') {
      statusEl.hidden = !text;
      statusEl.className = `v16-status${text ? ` ${kind}` : ''}`;
      statusEl.textContent = text || '';
    }

    /* ------------------------------ 도구 ------------------------------ */

    const toolList = root.querySelector('#sa-tool-list');
    TOOLS.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ic-seg';
      button.dataset.tool = item.id;
      button.textContent = item.label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(item.id === tool));
      button.addEventListener('click', () => {
        tool = item.id;
        toolList.querySelectorAll('.ic-seg').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.tool === tool)));
        root.querySelector('#sa-text-row').hidden = tool !== 'text';
        if (tool === 'text') root.querySelector('#sa-text').focus({ preventScroll: true });
      }, { signal });
      toolList.append(button);
    });
    root.querySelector('#sa-text-row').hidden = true;

    const colorList = root.querySelector('#sa-color-list');
    COLORS.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sa-color';
      button.dataset.color = item.id;
      button.style.background = item.id;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-label', item.label);
      button.setAttribute('aria-checked', String(item.id === color));
      button.addEventListener('click', () => {
        color = item.id;
        colorList.querySelectorAll('.sa-color').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.color === color)));
      }, { signal });
      colorList.append(button);
    });

    const strokeEl = root.querySelector('#sa-stroke');
    strokeEl.addEventListener('input', () => {
      stroke = Math.max(1, Math.min(8, Number(strokeEl.value) || 3));
      root.querySelector('#sa-stroke-value').textContent = String(stroke);
    }, { signal });
    root.querySelector('#sa-text').addEventListener('input', () => {
      text = root.querySelector('#sa-text').value;
    }, { signal });

    /* ------------------------------ 그리기 ------------------------------ */

    function canvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height),
      };
    }

    function drawArrow(context, from, to, width, tint) {
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.max(12, width * 4.2);
      context.strokeStyle = tint;
      context.fillStyle = tint;
      context.lineWidth = width;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.beginPath();
      context.moveTo(to.x, to.y);
      context.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
      context.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
      context.closePath();
      context.fill();
    }

    function drawOp(op) {
      ctx2d.save();
      if (op.tool === 'arrow') {
        drawArrow(ctx2d, op.from, op.to, op.width, op.color);
      } else if (op.tool === 'rect') {
        ctx2d.strokeStyle = op.color;
        ctx2d.lineWidth = op.width;
        ctx2d.strokeRect(op.from.x, op.from.y, op.to.x - op.from.x, op.to.y - op.from.y);
      } else if (op.tool === 'text') {
        const size = Math.max(14, op.width * 7);
        ctx2d.fillStyle = op.color;
        ctx2d.font = `600 ${size}px Pretendard, -apple-system, sans-serif`;
        ctx2d.textBaseline = 'top';
        String(op.text || '').split('\n').forEach((line, index) => {
          ctx2d.fillText(line, op.from.x, op.from.y + index * size * 1.25);
        });
      } else if (op.tool === 'mosaic') {
        const rect = {
          x: Math.min(op.from.x, op.to.x),
          y: Math.min(op.from.y, op.to.y),
          w: Math.abs(op.to.x - op.from.x),
          h: Math.abs(op.to.y - op.from.y),
        };
        pixelate(ctx2d, scratch, canvas, rect, Math.max(6, op.width * 4));
      }
      ctx2d.restore();
    }

    function redraw() {
      if (!base) return;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      ctx2d.drawImage(base, 0, 0, canvas.width, canvas.height);
      ops.forEach(drawOp);
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!base || event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      const point = canvasPoint(event);
      if (tool === 'text') {
        const value = root.querySelector('#sa-text').value;
        if (!value.trim()) {
          setStatus('넣을 글자를 먼저 적어 주세요', 'warn');
          return;
        }
        setStatus('');
        ops.push({ tool: 'text', from: point, to: point, color, width: stroke, text: value });
        redraw();
        return;
      }
      drawing = { tool, from: point, to: point, color, width: stroke };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* 캡처가 안 되어도 그려진다 */ }
    }, { signal });

    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      event.preventDefault();
      drawing.to = canvasPoint(event);
      redraw();
      drawOp(drawing);
    }, { signal });

    function finishStroke(event) {
      if (!drawing) return;
      if (event) drawing.to = canvasPoint(event);
      const from = drawing.from;
      const to = drawing.to;
      const moved = Math.abs(to.x - from.x) > 2 || Math.abs(to.y - from.y) > 2;
      if (moved) ops.push(drawing);
      drawing = null;
      redraw();
    }
    canvas.addEventListener('pointerup', finishStroke, { signal });
    canvas.addEventListener('pointercancel', () => { drawing = null; redraw(); }, { signal });
    canvas.addEventListener('pointerleave', () => { /* 캡처 중이면 pointerup 이 온다 */ }, { signal });

    root.querySelector('#sa-undo').addEventListener('click', () => {
      ops.pop();
      redraw();
    }, { signal });
    root.querySelector('#sa-reset').addEventListener('click', () => {
      ops = [];
      redraw();
    }, { signal });

    /* ------------------------------ 찍기 ------------------------------ */

    function place(canvasWidth, canvasHeight) {
      const maxWidth = Math.min(root.clientWidth - 4, 1100);
      const ratio = canvasWidth / Math.max(1, maxWidth);
      scale = ratio > 1 ? ratio : 1;
      canvas.style.width = `${Math.round(canvasWidth / scale)}px`;
      canvas.style.height = `${Math.round(canvasHeight / scale)}px`;
    }

    async function capture() {
      if (!TAURI) {
        setStatus('스크린샷 표시는 Mac 앱에서만 쓸 수 있습니다');
        return;
      }
      const button = root.querySelector('#sa-capture');
      button.disabled = true;
      setStatus('');
      try {
        const shot = await C.invoke('capture_region');
        if (!shot || !shot.png) throw new Error('찍은 화면이 없습니다');
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('찍은 그림을 읽지 못했습니다'));
        });
        image.src = `data:image/png;base64,${shot.png}`;
        await loaded;
        base = image;
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        ops = [];
        place(canvas.width, canvas.height);
        redraw();
        empty.hidden = true;
        main.hidden = false;
        if (permBtn) {
          permBtn.remove();
          permBtn = null;
        }
      } catch (error) {
        const message = typeof error === 'string' ? error : (error && error.message) || '';
        if (message === '취소' || /취소/.test(message)) {
          toast('화면 찍기를 취소했습니다');
        } else if (message.includes('[permission]')) {
          setStatus(message.replace('[permission]', '').trim());
          if (!permBtn) {
            permBtn = document.createElement('button');
            permBtn.className = 'v16-btn';
            permBtn.type = 'button';
            permBtn.textContent = '화면 기록 설정 열기';
            permBtn.addEventListener('click', () => {
              C.invoke('open_privacy_settings', { kind: 'screen-recording' }).catch(() => {});
            }, { signal });
            empty.append(permBtn);
          }
        } else {
          console.error('[TIP screenshot-annotate]', error);
          toast('화면을 찍지 못했습니다');
        }
      } finally {
        button.disabled = false;
      }
    }

    root.querySelector('#sa-capture').addEventListener('click', capture, { signal });
    root.querySelector('#sa-recapture').addEventListener('click', capture, { signal });

    /* ------------------------------ 내보내기 ------------------------------ */

    root.querySelector('#sa-save').addEventListener('click', () => {
      if (!base) return;
      canvas.toBlob((blob) => {
        if (!blob) return toast('그림을 만들지 못했습니다');
        download(blob, `screenshot-${stamp()}.png`);
        toast('PNG 로 저장했습니다');
      }, 'image/png');
    }, { signal });

    root.querySelector('#sa-copy').addEventListener('click', async () => {
      if (!base) return;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return toast('그림을 만들지 못했습니다');
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('그림을 복사했습니다');
      } catch {
        // 클립보드 그림을 못 넣으면 저장으로 안내한다.
        toast('이 환경에서는 그림을 바로 복사하지 못합니다. [저장]을 눌러 PNG 로 저장해 주세요', 3600);
      }
    }, { signal });

    return () => controller.abort();
  },
};

export default module;
