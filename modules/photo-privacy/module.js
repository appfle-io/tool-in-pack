/**
 * TIP · 모자이크 · EXIF 위치정보 제거 (photo-privacy)
 * 사진에서 EXIF(촬영 기기 · 일시 · GPS)를 먼저 보여주고, 캔버스에 모자이크/블러를 칠한 뒤
 * 캔버스 재인코딩으로 메타데이터를 완전히 지워 PNG/JPG로 저장한다. 전부 기기 안에서 처리.
 */

import { formatBytes, icons } from '../../js/ui.js';
import { parseMetadata, describeMetadata } from './exif.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="16" height="13" rx="2.5"/><circle cx="7.5" cy="8" r="1.5"/><path d="M18.5 12.5l3.2 1.2v3.6c0 2.2-2 3.9-3.2 4.3-1.2-.4-3.2-2.1-3.2-4.3v-3.6z"/></svg>`;

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
const HEIC_RE = /\.hei[cf]$/i;
const MAX_SIDE = 3200;

/* ------------------------------- decoding ------------------------------ */

async function decodeNative(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

async function decodeHEIC(file) {
  if (!window.heic2any) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './vendor/heic2any.min.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('HEIC 디코더를 불러오지 못했습니다.'));
      document.head.appendChild(script);
    });
  }
  const blob = await window.heic2any({ blob: file, toType: 'image/png' });
  return Array.isArray(blob) ? blob[0] : blob;
}

async function decodeFile(file) {
  if (HEIC_RE.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif') {
    try {
      return await decodeNative(file);
    } catch {
      return decodeNative(await decodeHEIC(file));
    }
  }
  return decodeNative(file);
}

/* --------------------------- pixel operations --------------------------- */

function clampRect(x, y, w, h, maxW, maxH) {
  const left = Math.max(0, Math.min(Math.floor(x), maxW - 1));
  const top = Math.max(0, Math.min(Math.floor(y), maxH - 1));
  const right = Math.max(left + 1, Math.min(Math.ceil(x + w), maxW));
  const bottom = Math.max(top + 1, Math.min(Math.ceil(y + h), maxH));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 모자이크(픽셀화) — 영역을 작게 줄였다가 확대해 픽셀 블록으로 만든다. */
function pixelate(ctx, scratch, canvas, rect, block) {
  const area = clampRect(rect.x, rect.y, rect.w, rect.h, canvas.width, canvas.height);
  const size = Math.max(2, Math.round(block));
  const bw = Math.max(1, Math.ceil(area.w / size));
  const bh = Math.max(1, Math.ceil(area.h / size));
  if (scratch.width !== bw || scratch.height !== bh) {
    scratch.width = bw;
    scratch.height = bh;
  }
  const sctx = scratch.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.clearRect(0, 0, bw, bh);
  sctx.drawImage(canvas, area.x, area.y, area.w, area.h, 0, 0, bw, bh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, bw, bh, area.x, area.y, bw * size, bh * size);
  ctx.imageSmoothingEnabled = true;
}

/** 박스 블러 (가로·세로 각 1회) — Safari에서도 동작하는 순수 JS 구현 */
function boxBlur(data, width, height, radius) {
  const r = Math.max(1, Math.round(radius));
  const channels = 4;
  const temp = new Uint8ClampedArray(data.length);
  const span = r * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * channels;
    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      for (let i = 0; i < span; i += 1) {
        const x = Math.min(width - 1, i - r < 0 ? 0 : i - r);
        sum += data[row + x * channels + c];
      }
      for (let x = 0; x < width; x += 1) {
        temp[row + x * channels + c] = sum / span;
        const outX = x - r < 0 ? 0 : x - r;
        const inX = x + r + 1 > width - 1 ? width - 1 : x + r + 1;
        sum += data[row + inX * channels + c] - data[row + outX * channels + c];
      }
    }
  }

  for (let x = 0; x < width; x += 1) {
    for (let c = 0; c < channels; c += 1) {
      let sum = 0;
      for (let i = 0; i < span; i += 1) {
        const y = Math.min(height - 1, i - r < 0 ? 0 : i - r);
        sum += temp[(y * width + x) * channels + c];
      }
      for (let y = 0; y < height; y += 1) {
        data[(y * width + x) * channels + c] = sum / span;
        const outY = y - r < 0 ? 0 : y - r;
        const inY = y + r + 1 > height - 1 ? height - 1 : y + r + 1;
        sum += temp[(inY * width + x) * channels + c] - temp[(outY * width + x) * channels + c];
      }
    }
  }
}

function blurArea(ctx, canvas, rect, radius) {
  const area = clampRect(rect.x, rect.y, rect.w, rect.h, canvas.width, canvas.height);
  const image = ctx.getImageData(area.x, area.y, area.w, area.h);
  boxBlur(image.data, area.w, area.h, radius);
  ctx.putImageData(image, area.x, area.y);
}

/* -------------------------------- module ------------------------------- */

const module = {
  id: 'photo-privacy',
  name: '사진 모자이크',
  shortName: '사진 모자이크',
  kind: 'tool',
  category: 'media',
  version: '1.0.0',
  subtitle: '사진 가리기와 촬영 정보 지우기',
  description: '사진에 남은 촬영 기기와 시간, 위치 정보를 살펴보고 모자이크나 흐리게 처리로 가린 뒤 그 정보까지 지워 저장합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root) {
    const controller = new AbortController();
    const { signal } = controller;

    let file = null;
    let meta = null;
    /** @type {{tool:'mosaic'|'blur', shape:'brush'|'rect', strength:number, size?:number, points?:{x:number,y:number}[], rect?:{x:number,y:number,w:number,h:number}}[]} */
    let ops = [];
    let tool = 'mosaic';
    let shape = 'brush';
    let strength = 5;
    let brush = 30;
    let format = 'png';
    let drawing = null;

    const scratch = document.createElement('canvas');
    const baseCanvas = document.createElement('canvas');
    const baseCtx = baseCanvas.getContext('2d');
    const previewCanvas = document.createElement('canvas');

    root.innerHTML = `
      <div class="pp">
        <div class="dr-empty" id="pp-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="pp-browse">${icons.upload} 사진 선택</button>
          <p>JPG, PNG, WebP, HEIC — 끌어다 놓아도 됩니다</p>
        </div>
        <input type="file" id="pp-input" class="sr-only" accept="${ACCEPT}">
        <div id="pp-main" hidden>
          <div class="pp-grid">
            <div class="pp-stage">
              <canvas id="pp-canvas" aria-label="편집할 사진"></canvas>
              <div class="pp-stage-hint" id="pp-stage-hint">드래그해서 가릴 곳을 칠하세요</div>
            </div>
            <aside class="pp-panel">
              <section class="pp-card" id="pp-exif-card">
                <h3 class="pp-card-title">사진 정보 <span class="pp-badge" id="pp-exif-badge"></span></h3>
                <div class="pp-exif" id="pp-exif"></div>
              </section>

              <section class="pp-card">
                <h3 class="pp-card-title">가리기 도구</h3>
                <div class="ic-row">
                  <span class="ic-label">방식</span>
                  <div class="ic-segment" id="pp-tools" role="radiogroup" aria-label="가리기 방식">
                    <button class="ic-seg" type="button" role="radio" data-tool="mosaic" aria-checked="true">모자이크</button>
                    <button class="ic-seg" type="button" role="radio" data-tool="blur" aria-checked="false">블러</button>
                  </div>
                </div>
                <div class="ic-row">
                  <span class="ic-label">모양</span>
                  <div class="ic-segment" id="pp-shapes" role="radiogroup" aria-label="선택 모양">
                    <button class="ic-seg" type="button" role="radio" data-shape="brush" aria-checked="true">붓</button>
                    <button class="ic-seg" type="button" role="radio" data-shape="rect" aria-checked="false">사각</button>
                  </div>
                </div>
                <div class="ic-row">
                  <span class="ic-label">강도</span>
                  <input type="range" id="pp-strength" min="1" max="10" step="1" value="5" aria-label="가리기 강도">
                  <span class="pp-value" id="pp-strength-value">5</span>
                </div>
                <div class="ic-row" id="pp-brush-row">
                  <span class="ic-label">붓 크기</span>
                  <input type="range" id="pp-brush" min="12" max="120" step="2" value="30" aria-label="붓 크기">
                  <span class="pp-value" id="pp-brush-value">30</span>
                </div>
                <div class="ic-actions pp-actions">
                  <button class="primary-btn ghost" type="button" id="pp-undo">실행 취소</button>
                  <button class="primary-btn ghost" type="button" id="pp-reset">초기화</button>
                  <button class="primary-btn ghost" type="button" id="pp-change">다른 사진</button>
                </div>
              </section>

              <section class="pp-card">
                <h3 class="pp-card-title">저장 <span class="pp-badge good">메타데이터 제거</span></h3>
                <div class="ic-row">
                  <span class="ic-label">형식</span>
                  <div class="ic-segment" id="pp-formats" role="radiogroup" aria-label="저장 형식">
                    <button class="ic-seg" type="button" role="radio" data-format="png" aria-checked="true">PNG</button>
                    <button class="ic-seg" type="button" role="radio" data-format="jpg" aria-checked="false">JPG</button>
                  </div>
                </div>
                <div class="ic-actions pp-actions">
                  <button class="primary-btn" type="button" id="pp-save">저장 (메타데이터 제거)</button>
                </div>
                <div class="pp-meta-status" id="pp-status"></div>
              </section>
            </aside>
          </div>
          <div id="pp-msg"></div>
        </div>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const empty = $('#pp-empty');
    const input = $('#pp-input');
    const main = $('#pp-main');
    const canvas = $('#pp-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const stageHint = $('#pp-stage-hint');
    const exifEl = $('#pp-exif');
    const exifBadge = $('#pp-exif-badge');
    const statusEl = $('#pp-status');
    const msgEl = $('#pp-msg');
    const saveBtn = $('#pp-save');
    const strengthInput = $('#pp-strength');
    const strengthValue = $('#pp-strength-value');
    const brushInput = $('#pp-brush');
    const brushValue = $('#pp-brush-value');

    function note(title, body) {
      const box = document.createElement('div');
      box.className = 'notice';
      box.innerHTML = `<span class="n-icon">ℹ</span><div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
      box.querySelector('.n-title').textContent = title;
      box.querySelector('.n-text').textContent = body;
      return box;
    }

    /* ------------------------------- loading ------------------------------ */

    $('#pp-browse').addEventListener('click', () => input.click(), { signal });
    $('#pp-change').addEventListener('click', () => input.click(), { signal });
    input.addEventListener('change', () => {
      const picked = input.files && input.files[0];
      if (picked) loadFile(picked);
      input.value = '';
    }, { signal });

    async function loadFile(picked) {
      msgEl.innerHTML = '';
      statusEl.innerHTML = '';
      try {
        const bytes = new Uint8Array(await picked.arrayBuffer());
        meta = parseMetadata(bytes);

        const bitmap = await decodeFile(picked);
        let w = bitmap.width;
        let h = bitmap.height;
        const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        canvas.width = w;
        canvas.height = h;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        if (typeof bitmap.close === 'function') bitmap.close();

        baseCanvas.width = w;
        baseCanvas.height = h;
        baseCtx.setTransform(1, 0, 0, 1, 0, 0);
        baseCtx.clearRect(0, 0, w, h);
        baseCtx.drawImage(canvas, 0, 0);

        file = picked;
        ops = [];
        empty.hidden = true;
        main.hidden = false;

        renderExif(w, h, scale < 1);
        updateHint();
        if (scale < 1) {
          msgEl.append(note('긴 변 3200px로 맞춰 편집합니다', '큰 사진은 편집 속도를 위해 자동으로 축소해 저장합니다.'));
        }
      } catch (error) {
        console.error('[TIP photo-privacy]', error);
        msgEl.innerHTML = '';
        msgEl.append(note('사진을 열지 못했습니다', String((error && error.message) || error)));
      }
    }

    /* -------------------------------- EXIF -------------------------------- */

    function renderExif(w, h, downscaled) {
      exifEl.innerHTML = '';
      const summary = describeMetadata(meta);
      exifBadge.textContent = meta.count ? `${meta.count}항목` : '없음';
      exifBadge.className = `pp-badge${meta.count ? ' warn' : ' good'}`;

      const rows = [
        { label: '크기', value: `${w}×${h}px${downscaled ? ' (축소됨)' : ''}` },
        { label: '용량', value: formatBytes(file.size) },
        ...meta.items,
      ];
      if (meta.formats && meta.formats.length) {
        rows.push({ label: '정보 형식', value: meta.formats.join(', ') });
      }

      const list = document.createElement('div');
      list.className = 'pp-exif-rows';
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = `pp-exif-row${row.label === 'GPS 위치' ? ' gps' : ''}`;
        line.innerHTML = '<span class="pp-exif-k"></span><span class="pp-exif-v"></span>';
        line.querySelector('.pp-exif-k').textContent = row.label;
        line.querySelector('.pp-exif-v').textContent = row.value;
        list.append(line);
      }
      exifEl.append(list);

      const foot = document.createElement('p');
      if (!meta.count) {
        foot.className = 'pp-exif-note';
        foot.textContent = '이 사진에는 촬영 정보나 위치 정보가 없습니다. 저장할 때 다시 한 번 인코딩하므로 결과물도 깨끗합니다.';
      } else if (meta.gps) {
        foot.className = 'pp-exif-note warn';
        foot.textContent = `위치 정보가 들어 있습니다 — 저장하면 완전히 지워집니다. (${summary.text})`;
      } else {
        foot.className = 'pp-exif-note';
        foot.textContent = `${summary.text} — 저장하면 모두 제거됩니다.`;
      }
      exifEl.append(foot);
    }

    /* ------------------------------ painting ------------------------------ */

    /** 강도(1~10) → 픽셀 크기. 사진 크기에 비례해 화면에서 비슷하게 보이도록. */
    function strengthPx() {
      const unit = Math.max(6, canvas.width / 60);
      if (tool === 'mosaic') return Math.max(3, Math.round(unit * (strength / 5)));
      return Math.max(2, Math.round(Math.max(3, canvas.width / 300) * (strength / 5)));
    }

    /** 붓 크기는 화면 픽셀 기준 → 사진 픽셀로 변환 */
    function brushPx() {
      const shown = canvas.getBoundingClientRect().width || canvas.width;
      const factor = Math.max(1, canvas.width / shown);
      return Math.max(4, Math.round(brush * factor));
    }

    function applyOp(op) {
      if (op.shape === 'rect') {
        if (op.tool === 'mosaic') pixelate(ctx, scratch, canvas, op.rect, op.strength);
        else blurArea(ctx, canvas, op.rect, op.strength);
        return;
      }
      const half = op.size / 2;
      for (const point of op.points) {
        const rect = { x: point.x - half, y: point.y - half, w: op.size, h: op.size };
        if (op.tool === 'mosaic') pixelate(ctx, scratch, canvas, rect, op.strength);
        else blurArea(ctx, canvas, rect, op.strength);
      }
    }

    function replay() {
      if (!file) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(baseCanvas, 0, 0);
      for (const op of ops) applyOp(op);
    }

    function canvasPoint(event) {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
      const y = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;
      return { x: Math.max(0, Math.min(canvas.width, x)), y: Math.max(0, Math.min(canvas.height, y)) };
    }

    function snapshotPreview() {
      previewCanvas.width = canvas.width;
      previewCanvas.height = canvas.height;
      const pctx = previewCanvas.getContext('2d');
      pctx.setTransform(1, 0, 0, 1, 0, 0);
      pctx.clearRect(0, 0, canvas.width, canvas.height);
      pctx.drawImage(canvas, 0, 0);
    }

    function drawRectPreview(rect) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(previewCanvas.width === canvas.width ? previewCanvas : baseCanvas, 0, 0);
      const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.lineWidth = Math.max(1.5, scale * 1.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.setLineDash([Math.max(4, scale * 5), Math.max(3, scale * 3)]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(1, scale * 0.8);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.restore();
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!file || event.button > 0) return;
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      const point = canvasPoint(event);
      stageHint.hidden = true;

      if (shape === 'rect') {
        snapshotPreview();
        drawing = {
          tool,
          shape: 'rect',
          strength: strengthPx(),
          start: point,
          rect: { x: point.x, y: point.y, w: 0, h: 0 },
        };
        drawRectPreview(drawing.rect);
      } else {
        drawing = { tool, shape: 'brush', strength: strengthPx(), size: brushPx(), points: [point] };
        applyOp({ ...drawing, points: [point] });
      }
    }, { signal });

    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      event.preventDefault();
      const point = canvasPoint(event);

      if (drawing.shape === 'rect') {
        drawing.rect = {
          x: Math.min(drawing.start.x, point.x),
          y: Math.min(drawing.start.y, point.y),
          w: Math.abs(point.x - drawing.start.x),
          h: Math.abs(point.y - drawing.start.y),
        };
        drawRectPreview(drawing.rect);
        return;
      }

      const last = drawing.points[drawing.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) < Math.max(2, drawing.size * 0.3)) return;
      drawing.points.push(point);
      applyOp({ ...drawing, points: [point] });
    }, { signal });

    function endStroke(event) {
      if (!drawing) return;
      if (event && event.cancelable) event.preventDefault();
      const op = drawing;
      drawing = null;
      if (op.shape === 'rect') {
        if (op.rect && op.rect.w > 2 && op.rect.h > 2) {
          ops.push({ tool: op.tool, shape: 'rect', strength: op.strength, rect: op.rect });
        }
        replay();
        updateHint();
        return;
      }
      ops.push({ tool: op.tool, shape: 'brush', strength: op.strength, size: op.size, points: op.points });
      replay();
      updateHint();
    }

    canvas.addEventListener('pointerup', endStroke, { signal });
    canvas.addEventListener('pointercancel', endStroke, { signal });
    canvas.addEventListener('lostpointercapture', (event) => { if (drawing) endStroke(event); }, { signal });

    function updateHint() {
      stageHint.hidden = ops.length > 0 || Boolean(drawing);
      stageHint.textContent = shape === 'rect'
        ? '드래그해서 가릴 사각형을 그리세요'
        : '드래그해서 가릴 곳을 칠하세요';
      if (!ops.length) stageHint.hidden = false;
    }

    /* ------------------------------- controls ----------------------------- */

    $('#pp-tools').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tool]');
      if (!btn) return;
      tool = btn.dataset.tool;
      $('#pp-tools').querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    }, { signal });

    $('#pp-shapes').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-shape]');
      if (!btn) return;
      shape = btn.dataset.shape;
      $('#pp-shapes').querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      updateHint();
    }, { signal });

    strengthInput.addEventListener('input', () => {
      strength = Number(strengthInput.value);
      strengthValue.textContent = String(strength);
    }, { signal });

    brushInput.addEventListener('input', () => {
      brush = Number(brushInput.value);
      brushValue.textContent = String(brush);
    }, { signal });

    $('#pp-undo').addEventListener('click', () => {
      if (!ops.length) return;
      ops.pop();
      replay();
      updateHint();
    }, { signal });

    $('#pp-reset').addEventListener('click', () => {
      if (!file) return;
      ops = [];
      replay();
      updateHint();
      statusEl.innerHTML = '';
    }, { signal });

    $('#pp-formats').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-format]');
      if (!btn) return;
      format = btn.dataset.format;
      $('#pp-formats').querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    }, { signal });

    saveBtn.addEventListener('click', save);

    /* -------------------------------- saving ------------------------------ */

    function outName() {
      const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
      return `${base}_masked.${format === 'png' ? 'png' : 'jpg'}`;
    }

    async function save() {
      if (!file) return;
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';
      statusEl.innerHTML = '';

      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((resolve) => {
        if (format === 'jpg') {
          const flat = document.createElement('canvas');
          flat.width = canvas.width;
          flat.height = canvas.height;
          const fctx = flat.getContext('2d');
          fctx.fillStyle = '#FFFFFF';
          fctx.fillRect(0, 0, flat.width, flat.height);
          fctx.drawImage(canvas, 0, 0);
          flat.toBlob(resolve, mime, 0.92);
        } else {
          canvas.toBlob(resolve, mime);
        }
      });

      try {
        const outBytes = new Uint8Array(await blob.arrayBuffer());
        const after = parseMetadata(outBytes);
        const before = meta || { count: 0, gps: null };
        const name = outName();

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        statusEl.innerHTML = '';
        const table = document.createElement('div');
        table.className = 'pp-meta-status-grid';
        table.innerHTML = `
          <div class="pp-meta-row"><span>저장 전</span><b>촬영 정보 ${before.count}개, ${before.gps ? '위치 정보 포함' : '위치 정보 없음'}</b></div>
          <div class="pp-meta-row after"><span>저장 후</span><b>촬영 정보 ${after.count}개, ${after.gps ? '위치 정보 포함' : '위치 정보 없음'}</b></div>
          <div class="pp-meta-row file"><span>파일</span><b></b></div>`;
        table.querySelector('.pp-meta-row.file b').textContent = `${name}, ${formatBytes(outBytes.length)}`;
        statusEl.append(table);

        const verdict = document.createElement('p');
        const clean = after.count === 0 && !after.gps;
        verdict.className = `pp-verdict${clean ? ' good' : ' bad'}`;
        verdict.textContent = clean
          ? '저장한 파일을 다시 검사했습니다. 촬영 정보와 위치 정보가 하나도 남지 않았습니다.'
          : '저장한 파일에 촬영 정보가 남아 있습니다. 다시 시도해 주세요.';
        statusEl.append(verdict);
      } catch (error) {
        console.error('[TIP photo-privacy]', error);
        statusEl.textContent = `저장하지 못했습니다: ${(error && error.message) || error}`;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장 (촬영 정보 지우기)';
      }
    }

    /* ---------------------------- drag & drop ----------------------------- */

    ['dragenter', 'dragover'].forEach((type) =>
      root.addEventListener(type, (event) => {
        if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        root.classList.add('dr-over');
      }, { signal }));

    ['dragleave', 'drop'].forEach((type) =>
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.remove('dr-over');
      }, { signal }));

    root.addEventListener('drop', (event) => {
      const picked = Array.from(event.dataTransfer?.files || [])[0];
      if (picked) {
        const asImage = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(picked.name) || /^image\//.test(picked.type);
        if (!asImage) {
          msgEl.innerHTML = '';
          msgEl.append(note('이미지가 아닙니다', 'JPG, PNG, WebP, HEIC 사진을 끌어다 놓아 주세요.'));
          return;
        }
        loadFile(picked);
      }
    }, { signal });

    return () => controller.abort();
  },
};

export default module;
