/**
 * TIP · 이미지 컨버터 (img-converter)
 * 이미지 포맷 변환 — 100% 클라이언트 사이드. 파일은 기기 밖으로 나가지 않는다.
 *
 * 입력: JPG/JPEG · PNG · WebP · GIF · BMP · SVG · AVIF · ICO · HEIC/HEIF
 *   (HEIC은 브라우저 디코더 실패 시 self-hosted heic2any로 디코딩)
 * 출력: PNG · JPG · WebP · ICO · BMP · PDF
 *   (WebP 인코딩은 브라우저 의존 — 미지원 브라우저에서는 명확히 안내)
 */

import { formatBytes, icons } from '../../js/ui.js';
import { appendContinueBar } from '../../js/continue.js';
import { encodeBMP, encodeICO, encodePDF, canvasToBlob, browserEncodes } from './encoders.js';

const ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.bmp,.svg,.avif,.ico,.heic,.heif';
const FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png' },
  { id: 'jpg', label: 'JPG', mime: 'image/jpeg', ext: 'jpg' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp' },
  { id: 'ico', label: 'ICO', mime: 'image/x-icon', ext: 'ico' },
  { id: 'bmp', label: 'BMP', mime: 'image/bmp', ext: 'bmp' },
  { id: 'pdf', label: 'PDF', mime: 'application/pdf', ext: 'pdf' },
];
const HEIC_RE = /\.hei[cf]$/i;

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toUpperCase() : 'IMG';
}

function baseName(name) {
  return (name || 'image').replace(/\.[^.]+$/, '');
}

/* ------------------------------ decoding ------------------------------ */

async function decodeNative(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Image element fallback (SVG, older engines)
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('decode failed'));
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
      return await decodeNative(file); // Safari can decode HEIC natively on recent versions
    } catch {
      const pngBlob = await decodeHEIC(file);
      return decodeNative(pngBlob);
    }
  }
  return decodeNative(file);
}

/* ----------------------------- conversion ----------------------------- */

async function convertOne(file, format, quality, targetWidth) {
  const bitmap = await decodeFile(file);

  let w = bitmap.width;
  let h = bitmap.height;
  if (targetWidth && targetWidth > 0 && targetWidth !== w) {
    h = Math.max(1, Math.round(h * (targetWidth / w)));
    w = targetWidth;
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (format.id === 'jpg' || format.id === 'pdf') {
    ctx.fillStyle = '#FFFFFF'; // flatten alpha for JPEG/PDF
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  let blob;
  switch (format.id) {
    case 'bmp':
      blob = encodeBMP(canvas);
      break;
    case 'ico':
      blob = await encodeICO(canvas);
      break;
    case 'pdf':
      blob = await encodePDF(canvas, (quality || 90) / 100);
      break;
    default:
      blob = await canvasToBlob(canvas, format.mime, (quality || 90) / 100);
  }

  const name = `${baseName(file.name)}.${format.ext}`;
  const delta = file.size > 0 ? Math.round((1 - blob.size / file.size) * 100) : 0;
  return { name, blob, before: file.size, after: blob.size, delta, width: w, height: h };
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

function noticeBox(kind, title, body) {
  const glyph = { warn: '⚠', bad: '✕' }[kind] || 'ℹ';
  const box = document.createElement('div');
  box.className = `notice ${kind === 'info' ? '' : kind}`;
  box.innerHTML = `<span class="n-icon">${glyph}</span>
    <div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
  box.querySelector('.n-title').textContent = title;
  box.querySelector('.n-text').textContent = body;
  return box;
}

/* -------------------------------- module ------------------------------- */

const module = {
  id: 'img-converter',
  accepts: ['image/*'],
  name: '이미지 컨버터',
  kind: 'tool',
  category: 'media',
  version: '1.0.0',
  subtitle: '포맷 변환과 크기 조절',
  description: '이미지 포맷을 바로 바꾸고 크기를 조절합니다. 여러 장을 한 번에 할 수 있습니다.',
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-4.5-4.5L6 21"/></svg>`,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    let files = [];
    let format = FORMATS[0];
    let results = [];

    root.innerHTML = `
      <div class="ic">
        <div class="dr-empty" id="ic-empty">
          <div class="dz-icon">${module.icon}</div>
          <button class="primary-btn" type="button" id="ic-browse">${icons.upload} 이미지 선택</button>
          <p>JPG·PNG·WebP·GIF·BMP·SVG·AVIF·ICO·HEIC 이미지를 여러 장 고르거나 여기로 끌어다 놓으세요.</p>
        </div>
        <input type="file" id="ic-input" class="sr-only" accept="${ACCEPT}" multiple>
        <div id="ic-main" hidden>
          <div class="ic-files" id="ic-files"></div>
          <div class="ic-options">
            <div class="ic-row">
              <span class="ic-label">포맷</span>
              <div class="ic-segment" id="ic-formats" role="radiogroup" aria-label="출력 포맷"></div>
            </div>
            <div class="ic-row" id="ic-quality-row">
              <span class="ic-label">품질</span>
              <input type="range" id="ic-quality" min="10" max="100" step="5" value="90">
              <span class="ic-quality-value" id="ic-quality-value">90%</span>
            </div>
            <div class="ic-row">
              <span class="ic-label">너비</span>
              <input type="number" id="ic-width" inputmode="numeric" min="1" placeholder="원본 크기">
              <span class="ic-hint">px, 비율 유지</span>
            </div>
          </div>
          <div class="ic-actions">
            <button class="primary-btn" type="button" id="ic-run">변환</button>
            <button class="primary-btn ghost" type="button" id="ic-clear">비우기</button>
          </div>
          <div id="ic-results"></div>
        </div>
        <div id="ic-msg"></div>
      </div>`;

    const empty = root.querySelector('#ic-empty');
    const input = root.querySelector('#ic-input');
    const main = root.querySelector('#ic-main');
    const filesEl = root.querySelector('#ic-files');
    const formatEl = root.querySelector('#ic-formats');
    const qualityRow = root.querySelector('#ic-quality-row');
    const quality = root.querySelector('#ic-quality');
    const qualityValue = root.querySelector('#ic-quality-value');
    const widthInput = root.querySelector('#ic-width');
    const resultsEl = root.querySelector('#ic-results');
    const msgEl = root.querySelector('#ic-msg');

    /* format segment */
    FORMATS.forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-seg';
      btn.textContent = f.label;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(f.id === format.id));
      btn.addEventListener('click', () => {
        format = f;
        formatEl.querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', 'false'));
        btn.setAttribute('aria-checked', 'true');
        qualityRow.hidden = !(f.id === 'jpg' || f.id === 'webp');
      });
      formatEl.appendChild(btn);
    });

    quality.addEventListener('input', () => { qualityValue.textContent = `${quality.value}%`; }, { signal });
    root.querySelector('#ic-browse').addEventListener('click', () => input.click(), { signal });
    input.addEventListener('change', () => addFiles(input.files), { signal });
    root.querySelector('#ic-clear').addEventListener('click', () => {
      files = [];
      results = [];
      resultsEl.innerHTML = '';
      main.hidden = true;
      empty.hidden = false;
    }, { signal });
    root.querySelector('#ic-run').addEventListener('click', run, { signal });

    ['dragenter', 'dragover'].forEach((type) =>
      root.addEventListener(type, (event) => { event.preventDefault(); root.classList.add('dr-over'); }, { signal }));
    ['dragleave', 'drop'].forEach((type) =>
      root.addEventListener(type, (event) => { event.preventDefault(); root.classList.remove('dr-over'); }, { signal }));
    root.addEventListener('drop', (event) => {
      if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
    }, { signal });

    function addFiles(list) {
      const incoming = Array.from(list || []);
      if (!incoming.length) return;
      const ok = [];
      const bad = [];
      for (const file of incoming) {
        if (/\.(jpe?g|png|webp|gif|bmp|svg|avif|ico|heic|heif)$/i.test(file.name) ||
            /^image\//.test(file.type) || file.type === 'image/heic' || file.type === 'image/heif') ok.push(file);
        else bad.push(file.name);
      }
      files = files.concat(ok);
      if (bad.length) msgEl.innerHTML = '';
      if (bad.length) msgEl.append(noticeBox('warn', '건너뜀', `이미지 파일이 아닌 ${bad.length}개는 제외했습니다.`));
      render();
    }

    function render() {
      msgEl.innerHTML = '';
      resultsEl.innerHTML = '';
      results = [];
      empty.hidden = files.length > 0;
      main.hidden = files.length === 0;
      filesEl.innerHTML = '';
      files.forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'ic-file';
        row.innerHTML = `
          <img class="ic-thumb" alt="">
          <div class="f-info">
            <div class="f-name"></div>
            <div class="f-meta"></div>
          </div>
          <button class="icon-btn" type="button" aria-label="제거">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>`;
        row.querySelector('.f-name').textContent = file.name;
        row.querySelector('.f-meta').textContent = formatBytes(file.size);
        const thumb = row.querySelector('.ic-thumb');
        const url = URL.createObjectURL(file);
        thumb.src = url;
        thumb.onload = () => URL.revokeObjectURL(url);
        row.querySelector('.icon-btn').addEventListener('click', () => {
          files.splice(index, 1);
          render();
        }, { signal: controller.signal });
        filesEl.appendChild(row);
      });
    }

    async function run() {
      if (!files.length) return;
      const runBtn = root.querySelector('#ic-run');
      runBtn.disabled = true;
      runBtn.textContent = '변환 중…';
      resultsEl.innerHTML = '';
      msgEl.innerHTML = '';

      const warnings = [];
      if ((format.id === 'webp') && !browserEncodes('image/webp')) {
        warnings.push('이 브라우저는 WebP 인코딩을 지원하지 않습니다(기기의 Safari 제한). PNG로 저장됩니다.');
      }

      const width = parseInt(widthInput.value, 10);
      const targetWidth = Number.isFinite(width) && width > 0 ? width : null;
      results = [];
      const usedNames = new Set();

      for (const file of files) {
        try {
          const result = await convertOne(file, format, parseInt(quality.value, 10), targetWidth);
          // 같은 기본명이 여러 개면 이름이 겹치지 않게 번호를 붙인다
          if (usedNames.has(result.name)) {
            const m = /^(.*)(\.[^.]+)$/.exec(result.name);
            let n = 2;
            while (usedNames.has(`${m[1]}-${n}${m[2]}`)) n += 1;
            result.name = `${m[1]}-${n}${m[2]}`;
          }
          usedNames.add(result.name);
          results.push(result);
        } catch (error) {
          console.error('[TIP img-converter]', error);
          const heic = HEIC_RE.test(file.name);
          resultsEl.append(noticeBox('bad', `${file.name} 변환 실패`,
            heic ? 'HEIC 디코딩에 실패했습니다. 파일이 손상되었거나 지원하지 않는 HEIC일 수 있습니다.' : `이미지를 읽지 못했습니다: ${error.message}`));
        }
      }

      renderResults();
      if (warnings.length) resultsEl.prepend(noticeBox('warn', '참고', warnings.join(' ')));
      runBtn.disabled = false;
      runBtn.textContent = '변환';
    }

    function renderResults() {
      if (!results.length) return;
      const wrap = document.createElement('div');
      wrap.className = 'ic-results';

      const header = document.createElement('div');
      header.className = 'ic-results-head';
      const saveAll = document.createElement('button');
      saveAll.type = 'button';
      saveAll.className = 'primary-btn ghost';
      saveAll.textContent = `전체 저장 (${results.length})`;
      saveAll.addEventListener('click', () => {
        results.forEach((r, i) => setTimeout(() => download(r.blob, r.name), i * 350));
      }, { signal: controller.signal });
      header.append(saveAll);
      wrap.append(header);

      for (const r of results) {
        const row = document.createElement('div');
        row.className = 'ic-result';
        row.innerHTML = `
          <div class="f-info">
            <div class="f-name"></div>
            <div class="f-meta"><span class="ic-size"></span> <span class="ic-delta"></span></div>
          </div>
          <button class="open-btn" type="button">저장</button>`;
        row.querySelector('.f-name').textContent = r.name;
        row.querySelector('.f-name').title = `${r.width}×${r.height}px`;
        row.querySelector('.ic-size').textContent = `${formatBytes(r.before)} → ${formatBytes(r.after)}`;
        const delta = row.querySelector('.ic-delta');
        delta.textContent = r.delta > 0 ? `-${r.delta}%` : `+${Math.abs(r.delta)}%`;
        delta.style.color = r.delta > 0 ? 'var(--good)' : 'var(--muted-2)';
        row.querySelector('button').addEventListener('click', () => download(r.blob, r.name), { signal: controller.signal });
        wrap.append(row);
      }

      // v1.16.0 — 변환한 그림을 파일 압축·사진 모자이크로 이어 보낸다.
      const asFiles = () => results.map((r) => new File([r.blob], r.name, { type: r.blob.type || 'image/png' }));
      appendContinueBar(wrap, ctx, [
        { id: 'file-compress', label: '용량 줄이기', payload: { files: asFiles() } },
        { id: 'photo-privacy', label: '사진 모자이크', payload: { files: asFiles().slice(0, 1) } },
      ]);
      resultsEl.append(wrap);
    }

    return () => controller.abort();
  },
};

export default module;
