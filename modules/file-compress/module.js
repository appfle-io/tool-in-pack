/**
 * TIP · 파일 압축 · ZIP (file-compress)
 * 탭 1 이미지 압축 — canvas 재인코딩(품질·최대 가로폭), JPG/WebP/PNG, 여러 장은 ZIP 저장.
 * 탭 2 PDF 용량 줄이기 — pdf.js 로 페이지를 래스터라이즈하고 pdf-lib 로 다시 조립(용량 우선).
 * 탭 3 ZIP 묶기·풀기 — 기존 vendor/jszip 재사용.
 * 모든 처리는 기기 안에서만. 파일을 전송하지 않는다.
 */

import { formatBytes, icons } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7a2 2 0 0 1 2-2h3.2l1.6 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M12 11v6M9.6 14.6 12 17l2.4-2.4"/></svg>`;

const DROP_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>`;

const IMAGE_TYPES = /^image\//;
const WIDTH_OPTIONS = [
  { value: 0, label: '원본' },
  { value: 2560, label: '2560' },
  { value: 1920, label: '1920' },
  { value: 1280, label: '1280' },
  { value: 800, label: '800' },
];
const FORMAT_OPTIONS = [
  { value: 'auto', label: '원본 유지' },
  { value: 'image/jpeg', label: 'JPG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'image/png', label: 'PNG' },
];
const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

function baseName(name) {
  return (name || 'file').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'file';
}

function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n += 1;
  const out = `${stem}-${n}${ext}`;
  used.add(out);
  return out;
}

function reduction(before, after) {
  if (!before || !after) return null;
  return Math.round((1 - after / before) * 100);
}

function reductionText(percent) {
  if (percent === null) return '';
  if (percent > 0) return `${percent}% 감소`;
  if (percent === 0) return '용량 같음';
  return `${Math.abs(percent)}% 증가`;
}

function percentClass(percent) {
  if (percent === null) return '';
  return percent > 0 ? 'good' : percent < 0 ? 'warn' : '';
}

function downloadName(file, type, suffix) {
  return `${baseName(file.name)}${suffix || ''}.${EXT[type] || 'png'}`;
}

function noticeBox(kind, title, body) {
  const glyph = { warn: '!', bad: '×', info: 'i' }[kind] || 'i';
  const box = document.createElement('div');
  box.className = `notice${kind === 'info' ? '' : ` ${kind}`}`;
  box.innerHTML = `<span class="n-icon">${glyph}</span>
    <div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
  box.querySelector('.n-title').textContent = title;
  box.querySelector('.n-text').textContent = body;
  return box;
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch { /* Safari 등은 아래 경로로 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('이 형식으로 저장하지 못했습니다'));
    }, type, quality);
  });
}

const module = {
  id: 'file-compress',
  accepts: ['*/*'],
  name: '파일 압축',
  shortName: '파일 압축',
  kind: 'tool',
  category: 'file',
  version: '1.0.0',
  subtitle: '이미지와 PDF 용량 줄이기, ZIP 묶기',
  description: '이미지와 PDF 용량을 줄이고 여러 파일을 ZIP 으로 묶거나 풀어서 저장합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx.toast || (() => {});
    const objectUrls = [];

    let tab = 'image';
    let busy = false;

    /* ------------------------------ 이미지 상태 ------------------------------ */
    const imageItems = [];
    let imageQuality = 0.8;
    let imageWidth = 1920;
    let imageFormat = 'auto';

    /* -------------------------------- PDF 상태 ------------------------------- */
    let pdfFile = null;
    let pdfResult = null;
    let pdfDpi = 144;
    let pdfQuality = 0.72;

    /* -------------------------------- ZIP 상태 ------------------------------- */
    let zipMode = 'pack';
    let zipItems = [];
    let zipFile = null;
    let zipEntries = [];
    let zipName = 'archive';

    root.innerHTML = `
      <div class="fc">
        <div class="fc-tabs" role="tablist" aria-label="압축 종류">
          <button class="fc-tab" type="button" role="tab" data-tab="image" aria-selected="true">이미지</button>
          <button class="fc-tab" type="button" role="tab" data-tab="pdf" aria-selected="false">PDF</button>
          <button class="fc-tab" type="button" role="tab" data-tab="zip" aria-selected="false">ZIP</button>
        </div>

        <section class="fc-pane" data-pane="image">
          <div class="dr-empty fc-drop" id="fc-img-drop">
            <div class="dz-icon">${DROP_ICON}</div>
            <button class="primary-btn" type="button" id="fc-img-browse">${icons.upload} 이미지 선택</button>
            <p>JPG·PNG·WebP·GIF·HEIC 파일을 고르거나 끌어다 놓으세요.</p>
          </div>
          <input type="file" id="fc-img-input" class="sr-only" accept="image/*" multiple>

          <div class="fc-list" id="fc-img-list"></div>

          <div class="ic-options fc-options">
            <div class="ic-row">
              <span class="ic-label">품질</span>
              <input type="range" id="fc-img-quality" min="40" max="95" step="1" value="80" aria-label="이미지 품질">
              <span class="ic-quality-value" id="fc-img-quality-value">80</span>
            </div>
            <div class="ic-row">
              <span class="ic-label">가로</span>
              <div class="ic-segment" id="fc-img-width" role="radiogroup" aria-label="최대 가로폭(px)"></div>
            </div>
            <div class="ic-row">
              <span class="ic-label">형식</span>
              <div class="ic-segment" id="fc-img-format" role="radiogroup" aria-label="출력 형식"></div>
            </div>
            <p class="ic-hint">가로를 넘는 사진은 비율을 유지한 채 줄입니다. PNG는 품질 대신 크기 축소로 줄입니다.</p>
          </div>

          <div class="ic-actions fc-actions">
            <button class="primary-btn" type="button" id="fc-img-run" disabled>압축하기</button>
            <button class="primary-btn ghost" type="button" id="fc-img-all" hidden>전체 저장</button>
          </div>
          <div class="fc-summary" id="fc-img-summary"></div>
        </section>

        <section class="fc-pane" data-pane="pdf" hidden>
          <div class="dr-empty fc-drop" id="fc-pdf-drop">
            <div class="dz-icon">${DROP_ICON}</div>
            <button class="primary-btn" type="button" id="fc-pdf-browse">${icons.upload} PDF 선택</button>
            <p>스캔한 사진 PDF 는 크게 줄고 글자 PDF 는 덜 줄어듭니다</p>
          </div>
          <input type="file" id="fc-pdf-input" class="sr-only" accept="application/pdf,.pdf">

          <div class="filebar fc-pdffile" id="fc-pdf-file" hidden>
            <span class="f-icon">PDF</span>
            <div class="f-info">
              <div class="f-name" id="fc-pdf-name"></div>
              <div class="f-meta" id="fc-pdf-meta"></div>
            </div>
            <button class="icon-btn" type="button" id="fc-pdf-clear" aria-label="PDF 지우기">${icons.close}</button>
          </div>

          <div class="ic-options fc-options">
            <div class="ic-row">
              <span class="ic-label">화질</span>
              <div class="ic-segment" id="fc-pdf-dpi" role="radiogroup" aria-label="PDF 화질"></div>
            </div>
            <div class="ic-row">
              <span class="ic-label">품질</span>
              <input type="range" id="fc-pdf-quality" min="50" max="90" step="1" value="72" aria-label="PDF 이미지 품질">
              <span class="ic-quality-value" id="fc-pdf-quality-value">72</span>
            </div>
            <p class="ic-hint">페이지를 그림으로 다시 그려 합칩니다. 글자를 선택할 수 없게 되지만 용량은 크게 줄 수 있습니다.</p>
          </div>

          <div class="fc-progress" id="fc-pdf-progress" hidden>
            <div class="fc-bar"><span id="fc-pdf-bar"></span></div>
            <p class="fc-progress-text" id="fc-pdf-progress-text"></p>
          </div>

          <div class="ic-actions fc-actions">
            <button class="primary-btn" type="button" id="fc-pdf-run" disabled>PDF 줄이기</button>
            <button class="primary-btn ghost" type="button" id="fc-pdf-save" hidden>저장</button>
          </div>
          <div class="fc-summary" id="fc-pdf-summary"></div>
        </section>

        <section class="fc-pane" data-pane="zip" hidden>
          <div class="ic-segment fc-zipmode" id="fc-zip-mode" role="radiogroup" aria-label="ZIP 모드">
            <button class="ic-seg" type="button" data-zip-mode="pack" aria-checked="true">파일 묶기</button>
            <button class="ic-seg" type="button" data-zip-mode="unpack" aria-checked="false">ZIP 풀기</button>
          </div>

          <div data-zip-pane="pack">
            <div class="dr-empty fc-drop" id="fc-zip-drop">
              <div class="dz-icon">${DROP_ICON}</div>
              <button class="primary-btn" type="button" id="fc-zip-browse">${icons.upload} 파일 선택</button>
              <p>여러 파일을 하나의 .zip으로 묶습니다</p>
            </div>
            <input type="file" id="fc-zip-input" class="sr-only" multiple>

            <div class="fc-list" id="fc-zip-list"></div>

            <div class="ic-row fc-zipname">
              <span class="ic-label">이름</span>
              <input class="fc-text" type="text" id="fc-zip-name" value="archive" aria-label="ZIP 파일 이름">
              <span class="fc-ext">.zip</span>
            </div>

            <div class="ic-actions fc-actions">
              <button class="primary-btn" type="button" id="fc-zip-run" disabled>ZIP으로 묶기</button>
            </div>
            <div class="fc-summary" id="fc-zip-summary"></div>
          </div>

          <div data-zip-pane="unpack" hidden>
            <div class="dr-empty fc-drop" id="fc-unzip-drop">
              <div class="dz-icon">${DROP_ICON}</div>
              <button class="primary-btn" type="button" id="fc-unzip-browse">${icons.upload} ZIP 선택</button>
              <p>.zip 파일의 내용을 확인하고 꺼냅니다</p>
            </div>
            <input type="file" id="fc-unzip-input" class="sr-only" accept=".zip,application/zip,application/x-zip-compressed">

            <div class="filebar fc-pdffile" id="fc-unzip-file" hidden>
              <span class="f-icon">ZIP</span>
              <div class="f-info">
                <div class="f-name" id="fc-unzip-name"></div>
                <div class="f-meta" id="fc-unzip-meta"></div>
              </div>
              <button class="icon-btn" type="button" id="fc-unzip-clear" aria-label="ZIP 지우기">${icons.close}</button>
            </div>

            <div class="fc-ziplist" id="fc-unzip-list"></div>

            <div class="ic-actions fc-actions">
              <button class="primary-btn ghost" type="button" id="fc-unzip-all" hidden>전체 저장</button>
            </div>
          </div>
        </section>
      </div>`;

    const imgInput = root.querySelector('#fc-img-input');
    const imgList = root.querySelector('#fc-img-list');
    const imgRun = root.querySelector('#fc-img-run');
    const imgAll = root.querySelector('#fc-img-all');
    const imgSummary = root.querySelector('#fc-img-summary');
    const pdfInput = root.querySelector('#fc-pdf-input');
    const pdfFileBar = root.querySelector('#fc-pdf-file');
    const pdfRun = root.querySelector('#fc-pdf-run');
    const pdfSave = root.querySelector('#fc-pdf-save');
    const pdfSummary = root.querySelector('#fc-pdf-summary');
    const zipInput = root.querySelector('#fc-zip-input');
    const zipList = root.querySelector('#fc-zip-list');
    const zipRun = root.querySelector('#fc-zip-run');
    const zipSummary = root.querySelector('#fc-zip-summary');
    const unzipInput = root.querySelector('#fc-unzip-input');
    const unzipList = root.querySelector('#fc-unzip-list');
    const unzipAll = root.querySelector('#fc-unzip-all');

    /* --------------------------------- 탭 ---------------------------------- */

    function setTab(next) {
      tab = next;
      root.querySelectorAll('.fc-tab').forEach((btn) => {
        btn.setAttribute('aria-selected', String(btn.dataset.tab === next));
      });
      root.querySelectorAll('.fc-pane').forEach((pane) => {
        pane.hidden = pane.dataset.pane !== next;
      });
    }

    root.querySelectorAll('.fc-tab').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab), { signal });
    });

    function setBusy(value) {
      busy = value;
      root.querySelectorAll('button').forEach((btn) => {
        if (btn.classList.contains('fc-tab') || btn.matches('[data-zip-mode]')) return;
        btn.disabled = value;
      });
      if (!value) {
        imgRun.disabled = imageItems.length === 0;
        pdfRun.disabled = !pdfFile;
        zipRun.disabled = zipItems.length === 0;
        imgAll.hidden = !imageItems.some((item) => item.blob);
        pdfSave.hidden = !pdfResult;
        unzipAll.hidden = zipEntries.length === 0;
      }
    }

    /* ------------------------------- 이미지 탭 ------------------------------- */

    function renderImageOptions() {
      const widthEl = root.querySelector('#fc-img-width');
      widthEl.innerHTML = '';
      WIDTH_OPTIONS.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ic-seg';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(imageWidth === opt.value));
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          imageWidth = opt.value;
          renderImageOptions();
        }, { signal });
        widthEl.append(btn);
      });

      const formatEl = root.querySelector('#fc-img-format');
      formatEl.innerHTML = '';
      FORMAT_OPTIONS.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ic-seg';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(imageFormat === opt.value));
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          imageFormat = opt.value;
          renderImageOptions();
        }, { signal });
        formatEl.append(btn);
      });
    }

    function renderImageList() {
      imgList.innerHTML = '';
      imageItems.forEach((item, index) => {
        const thumb = URL.createObjectURL(item.file);
        objectUrls.push(thumb);
        const row = document.createElement('div');
        row.className = 'ic-file fc-file';
        const percent = item.blob ? reduction(item.file.size, item.blob.size) : null;
        row.innerHTML = `
          <img class="ic-thumb" src="${thumb}" alt="">
          <div class="f-info">
            <div class="f-name">${item.file.name}</div>
            <div class="f-meta">${formatBytes(item.file.size)}${
              item.blob
                ? item.keptOriginal
                  ? ' → <b>원본 유지</b> (재압축하면 더 커짐)'
                  : ` → ${formatBytes(item.blob.size)}, <b class="${percentClass(percent)}">${reductionText(percent)}</b>`
                : item.error ? ', 실패' : ''
            }</div>
          </div>
          ${item.blob ? `<button class="ic-seg" type="button" data-save="${index}">저장</button>` : ''}
          <button class="icon-btn" type="button" data-remove="${index}" aria-label="${item.file.name} 빼기">${icons.close}</button>`;
        imgList.append(row);
      });
      imgRun.disabled = imageItems.length === 0;
      imgAll.hidden = !imageItems.some((item) => item.blob);
      renderImageSummary();
    }

    function renderImageSummary() {
      imgSummary.innerHTML = '';
      const done = imageItems.filter((item) => item.blob);
      if (!done.length) return;
      const before = done.reduce((sum, item) => sum + item.file.size, 0);
      const after = done.reduce((sum, item) => sum + item.blob.size, 0);
      const percent = reduction(before, after);
      const box = document.createElement('div');
      box.className = 'fc-total';
      box.innerHTML = `<span>${done.length}장 합계</span>
        <b>${formatBytes(before)} → ${formatBytes(after)}</b>
        <em class="${percentClass(percent)}">${reductionText(percent)}</em>`;
      imgSummary.append(box);
      const kept = done.filter((item) => item.keptOriginal).length;
      if (kept) {
        imgSummary.append(noticeBox('info', '일부 파일은 원본 그대로',
          `${kept}장은 다시 압축하면 오히려 커져서 원본을 유지했습니다. 가로 폭을 줄이거나 다른 형식(WebP)으로 저장해 보세요.`));
      } else if (percent !== null && percent <= 0) {
        imgSummary.append(noticeBox('warn', '줄지 않은 파일이 있습니다',
          '이미 작은 이미지이거나 품질이 원본보다 높습니다. 품질을 낮추거나 가로 폭을 줄여 보세요.'));
      }
    }

    function addImages(files) {
      const list = [...files].filter((file) => IMAGE_TYPES.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(file.name));
      if (!list.length) {
        toast('이미지 파일이 아닙니다');
        return;
      }
      list.forEach((file) => {
        imageItems.push({ file, blob: null, error: false });
      });
      renderImageList();
    }

    async function compressImages() {
      if (busy) return;
      setBusy(true);
      const pending = imageItems.filter((item) => !item.blob);
      try {
        for (let i = 0; i < pending.length; i += 1) {
          const item = pending[i];
          const label = await compressOne(item, { quality: imageQuality, maxWidth: imageWidth, format: imageFormat });
          imgRun.textContent = `압축 중 ${i + 1}/${pending.length}`;
          if (label) item.blob = label;
          renderImageList();
        }
        toast(pending.length ? '압축을 마쳤습니다' : '이미 압축된 파일입니다');
      } catch (error) {
        console.error('[TIP file-compress]', error);
        toast('압축하지 못했습니다');
      } finally {
        imgRun.textContent = '압축하기';
        setBusy(false);
        renderImageList();
      }
    }

    async function compressOne(item, options) {
      try {
        const image = await loadImage(item.file);
        const sourceW = image.width || image.naturalWidth;
        const sourceH = image.height || image.naturalHeight;
        if (!sourceW || !sourceH) throw new Error('이미지 크기를 읽지 못했습니다');

        let type = options.format;
        if (type === 'auto') {
          if (/png$/i.test(item.file.type || item.file.name)) type = 'image/png';
          else if (/webp$/i.test(item.file.type || item.file.name)) type = 'image/webp';
          else type = 'image/jpeg';
        }

        let width = sourceW;
        let height = sourceH;
        if (options.maxWidth && sourceW > options.maxWidth) {
          width = options.maxWidth;
          height = Math.round(sourceH * (options.maxWidth / sourceW));
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const context = canvas.getContext('2d');
        if (type === 'image/jpeg') {
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (image.close) image.close();

        const blob = await canvasToBlob(canvas, type, options.quality);

        // 결과가 원본보다 크면 원본을 그대로 쓴다(압축이 용량을 늘리지 않게).
        const sameType = type === (item.file.type || '').split(';')[0];
        if (blob.size >= item.file.size && canvas.width === sourceW && canvas.height === sourceH && sameType) {
          item.keptOriginal = true;
          item.outName = item.file.name;
          item.error = false;
          return item.file;
        }

        item.keptOriginal = false;
        item.outName = downloadName(item.file, type, '');
        item.error = false;
        return blob;
      } catch (error) {
        item.error = true;
        console.error('[TIP file-compress]', item.file.name, error);
        return null;
      }
    }

    function saveImage(index) {
      const item = imageItems[index];
      if (!item || !item.blob) return;
      download(item.blob, item.outName || downloadName(item.file, 'image/jpeg', ''));
    }

    async function saveAllImages() {
      const done = imageItems.filter((item) => item.blob);
      if (!done.length) return;
      if (done.length === 1) {
        saveImage(imageItems.indexOf(done[0]));
        return;
      }
      const JSZip = window.JSZip;
      if (!JSZip) {
        toast('ZIP 엔진을 불러오지 못했습니다');
        return;
      }
      setBusy(true);
      try {
        const zip = new JSZip();
        const used = new Set();
        done.forEach((item) => {
          zip.file(uniqueName(item.outName || downloadName(item.file, 'image/jpeg', ''), used), item.blob);
        });
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        download(blob, 'compressed-images.zip');
        toast(`${done.length}장을 ZIP으로 저장`);
      } catch (error) {
        console.error('[TIP file-compress]', error);
        toast('ZIP을 만들지 못했습니다');
      } finally {
        setBusy(false);
      }
    }

    root.querySelector('#fc-img-browse').addEventListener('click', () => imgInput.click(), { signal });
    imgInput.addEventListener('change', () => {
      if (imgInput.files) addImages(imgInput.files);
      imgInput.value = '';
    }, { signal });
    imgRun.addEventListener('click', compressImages, { signal });
    imgAll.addEventListener('click', saveAllImages, { signal });

    root.querySelector('#fc-img-quality').addEventListener('input', (event) => {
      imageQuality = Number(event.target.value) / 100;
      root.querySelector('#fc-img-quality-value').textContent = event.target.value;
    }, { signal });

    imgList.addEventListener('click', (event) => {
      const saveBtn = event.target.closest('[data-save]');
      if (saveBtn) {
        saveImage(Number(saveBtn.dataset.save));
        return;
      }
      const removeBtn = event.target.closest('[data-remove]');
      if (removeBtn) {
        imageItems.splice(Number(removeBtn.dataset.remove), 1);
        renderImageList();
      }
    }, { signal });

    /* -------------------------------- PDF 탭 -------------------------------- */

    function renderPdfOptions() {
      const dpiEl = root.querySelector('#fc-pdf-dpi');
      dpiEl.innerHTML = '';
      [['낮음', 96], ['보통', 144], ['높음', 200]].forEach(([label, value]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ic-seg';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(pdfDpi === value));
        btn.textContent = label;
        btn.addEventListener('click', () => {
          pdfDpi = value;
          renderPdfOptions();
        }, { signal });
        dpiEl.append(btn);
      });
    }

    function setPdfFile(file) {
      pdfFile = file || null;
      pdfResult = null;
      pdfSave.hidden = true;
      pdfSummary.innerHTML = '';
      pdfFileBar.hidden = !file;
      pdfRun.disabled = !file;
      if (!file) return;
      root.querySelector('#fc-pdf-name').textContent = file.name;
      root.querySelector('#fc-pdf-meta').textContent = formatBytes(file.size);
    }

    async function shrinkPdf() {
      if (!pdfFile || busy) return;
      const pdfjsLib = window.pdfjsLib;
      const PDFLib = window.PDFLib;
      if (!pdfjsLib || !PDFLib) {
        pdfSummary.append(noticeBox('bad', 'PDF 엔진을 불러오지 못했습니다', '새로고침한 뒤 다시 시도하세요.'));
        return;
      }
      setBusy(true);
      pdfResult = null;
      pdfSave.hidden = true;
      pdfSummary.innerHTML = '';
      const progress = root.querySelector('#fc-pdf-progress');
      const bar = root.querySelector('#fc-pdf-bar');
      const progressText = root.querySelector('#fc-pdf-progress-text');
      progress.hidden = false;
      bar.style.width = '0%';
      progressText.textContent = 'PDF를 여는 중…';

      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';
        const data = new Uint8Array(await pdfFile.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
        const out = await PDFLib.PDFDocument.create();
        const scale = pdfDpi / 72;

        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
          const page = await doc.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          let renderScale = scale;
          const maxSide = 4096;
          if (Math.max(base.width, base.height) * renderScale > maxSide) {
            renderScale = maxSide / Math.max(base.width, base.height);
          }
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: context, viewport }).promise;

          const blob = await canvasToBlob(canvas, 'image/jpeg', pdfQuality);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          const embedded = await out.embedJpg(bytes);
          const width = base.width;
          const height = base.height;
          const outPage = out.addPage([width, height]);
          outPage.drawImage(embedded, { x: 0, y: 0, width, height });
          page.cleanup();
          canvas.width = 0;
          canvas.height = 0;

          const percent = Math.round((pageNumber / doc.numPages) * 100);
          bar.style.width = `${percent}%`;
          progressText.textContent = `${pageNumber} / ${doc.numPages} 페이지`;
        }

        const bytes = await out.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        pdfResult = {
          blob,
          name: `${baseName(pdfFile.name)}-compressed.pdf`,
          pages: doc.numPages,
          before: pdfFile.size,
          after: blob.size,
        };
        const ratio = reduction(pdfFile.size, blob.size);
        pdfSummary.innerHTML = '';
        const total = document.createElement('div');
        total.className = 'fc-total';
        total.innerHTML = `<span>${doc.numPages}페이지</span>
          <b>${formatBytes(pdfFile.size)} → ${formatBytes(blob.size)}</b>
          <em class="${percentClass(ratio)}">${reductionText(ratio)}</em>`;
        pdfSummary.append(total);
        if (ratio !== null && ratio <= 0) {
          pdfSummary.append(noticeBox('warn', '용량이 줄지 않았습니다',
            '이미 그림으로 된 PDF이거나 화질이 원본보다 높습니다. 화질을 낮춰 다시 시도하세요.'));
        } else {
          pdfSummary.append(noticeBox('info', '글자 선택은 안 됩니다',
            '페이지를 그림으로 다시 그려 합쳤기 때문에 글자를 복사하거나 검색할 수 없습니다. 용량을 우선한 방식입니다.'));
        }
        pdfSave.hidden = false;
        toast('PDF 용량을 줄였습니다');
      } catch (error) {
        console.error('[TIP file-compress]', error);
        const message = String((error && error.message) || error);
        pdfSummary.innerHTML = '';
        pdfSummary.append(noticeBox('bad', 'PDF를 처리하지 못했습니다',
          /password|encrypt/i.test(message) ? '암호가 걸린 PDF는 처리할 수 없습니다. 암호를 푼 파일로 다시 시도하세요.' : message));
      } finally {
        progress.hidden = true;
        setBusy(false);
        pdfRun.disabled = !pdfFile;
      }
    }

    root.querySelector('#fc-pdf-browse').addEventListener('click', () => pdfInput.click(), { signal });
    pdfInput.addEventListener('change', () => {
      const file = pdfInput.files && pdfInput.files[0];
      pdfInput.value = '';
      if (!file) return;
      if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        toast('PDF 파일이 아닙니다');
        return;
      }
      setPdfFile(file);
    }, { signal });
    root.querySelector('#fc-pdf-clear').addEventListener('click', () => setPdfFile(null), { signal });
    pdfRun.addEventListener('click', shrinkPdf, { signal });
    pdfSave.addEventListener('click', () => {
      if (pdfResult) download(pdfResult.blob, pdfResult.name);
    }, { signal });
    root.querySelector('#fc-pdf-quality').addEventListener('input', (event) => {
      pdfQuality = Number(event.target.value) / 100;
      root.querySelector('#fc-pdf-quality-value').textContent = event.target.value;
    }, { signal });

    /* -------------------------------- ZIP 탭 -------------------------------- */

    function renderZipMode() {
      root.querySelectorAll('[data-zip-mode]').forEach((btn) => {
        btn.setAttribute('aria-checked', String(btn.dataset.zipMode === zipMode));
      });
      root.querySelector('[data-zip-pane="pack"]').hidden = zipMode !== 'pack';
      root.querySelector('[data-zip-pane="unpack"]').hidden = zipMode !== 'unpack';
    }

    function renderZipList() {
      zipList.innerHTML = '';
      zipItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'filebar fc-file';
        row.innerHTML = `<span class="f-icon">${(item.file.name.split('.').pop() || '').slice(0, 4).toUpperCase()}</span>
          <div class="f-info"><div class="f-name">${item.file.name}</div>
          <div class="f-meta">${formatBytes(item.file.size)}</div></div>
          <button class="icon-btn" type="button" data-zip-remove="${index}" aria-label="${item.file.name} 빼기">${icons.close}</button>`;
        zipList.append(row);
      });
      zipRun.disabled = zipItems.length === 0;
      zipSummary.innerHTML = '';
      if (!zipItems.length) {
        zipSummary.append(noticeBox('info', '여러 파일을 하나로',
          '이름을 정하고 ZIP으로 묶으면 한 번에 내려받습니다. 파일은 기기 밖으로 나가지 않습니다.'));
      }
    }

    function addZipFiles(files) {
      [...files].forEach((file) => zipItems.push({ file }));
      renderZipList();
    }

    async function packZip() {
      if (!zipItems.length || busy) return;
      const JSZip = window.JSZip;
      if (!JSZip) { toast('ZIP 엔진을 불러오지 못했습니다'); return; }
      setBusy(true);
      try {
        const zip = new JSZip();
        const used = new Set();
        zipItems.forEach((item) => {
          zip.file(uniqueName(item.file.name, used), item.file);
        });
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const name = `${(root.querySelector('#fc-zip-name').value || 'archive').replace(/[\\/:*?"<>|]+/g, '_')}.zip`;
        download(blob, name);
        zipSummary.innerHTML = '';
        const total = document.createElement('div');
        total.className = 'fc-total';
        total.innerHTML = `<span>${zipItems.length}개 파일</span><b>${formatBytes(blob.size)}</b><em>${name}</em>`;
        zipSummary.append(total);
        toast(`${name} 저장`);
      } catch (error) {
        console.error('[TIP file-compress]', error);
        toast('ZIP을 만들지 못했습니다');
      } finally {
        setBusy(false);
      }
    }

    function renderZipEntries() {
      unzipList.innerHTML = '';
      zipEntries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'fc-ziprow';
        row.innerHTML = `<span class="fc-zipname">${entry.name}</span>
          <span class="fc-zipsize">${formatBytes(entry.size)}</span>
          <button class="ic-seg" type="button" data-entry="${index}">저장</button>`;
        unzipList.append(row);
      });
      unzipAll.hidden = zipEntries.length === 0;
    }

    async function readZip(file) {
      const JSZip = window.JSZip;
      if (!JSZip) { toast('ZIP 엔진을 불러오지 못했습니다'); return; }
      try {
        const zip = await JSZip.loadAsync(file);
        zipEntries = Object.values(zip.files)
          .filter((entry) => !entry.dir)
          .map((entry) => ({ name: entry.name, size: entry._data ? entry._data.uncompressedSize || 0 : 0, item: entry }));
        zipFile = file;
        root.querySelector('#fc-unzip-file').hidden = false;
        root.querySelector('#fc-unzip-name').textContent = file.name;
        root.querySelector('#fc-unzip-meta').textContent = `${zipEntries.length}개 파일, ${formatBytes(file.size)}`;
        renderZipEntries();
        if (!zipEntries.length) noticeBox('info', '빈 ZIP', '안에 저장된 파일이 없습니다.');
      } catch (error) {
        console.error('[TIP file-compress]', error);
        toast('ZIP을 읽지 못했습니다');
      }
    }

    async function saveEntry(index) {
      const entry = zipEntries[index];
      if (!entry) return;
      const blob = await entry.item.async('blob');
      download(blob, entry.name.split('/').pop() || entry.name);
    }

    async function saveAllEntries() {
      if (!zipEntries.length) return;
      toast(`${zipEntries.length}개 파일을 차례로 저장합니다`);
      for (let i = 0; i < zipEntries.length; i += 1) {
        await saveEntry(i);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }

    root.querySelectorAll('[data-zip-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        zipMode = btn.dataset.zipMode;
        renderZipMode();
      }, { signal });
    });
    root.querySelector('#fc-zip-browse').addEventListener('click', () => zipInput.click(), { signal });
    zipInput.addEventListener('change', () => {
      if (zipInput.files) addZipFiles(zipInput.files);
      zipInput.value = '';
    }, { signal });
    zipRun.addEventListener('click', packZip, { signal });
    zipList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-zip-remove]');
      if (!btn) return;
      zipItems.splice(Number(btn.dataset.zipRemove), 1);
      renderZipList();
    }, { signal });

    root.querySelector('#fc-unzip-browse').addEventListener('click', () => unzipInput.click(), { signal });
    unzipInput.addEventListener('change', () => {
      const file = unzipInput.files && unzipInput.files[0];
      unzipInput.value = '';
      if (file) readZip(file);
    }, { signal });
    root.querySelector('#fc-unzip-clear').addEventListener('click', () => {
      zipFile = null;
      zipEntries = [];
      root.querySelector('#fc-unzip-file').hidden = true;
      renderZipEntries();
    }, { signal });
    unzipList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-entry]');
      if (btn) saveEntry(Number(btn.dataset.entry));
    }, { signal });
    unzipAll.addEventListener('click', saveAllEntries, { signal });

    /* ------------------------- 끌어다 놓기 (현재 탭) ------------------------- */

    function routeFiles(files) {
      const list = [...files];
      if (!list.length) return;
      if (tab === 'image') {
        addImages(list);
        return;
      }
      if (tab === 'pdf') {
        const file = list.find((f) => /pdf$/i.test(f.name) || f.type === 'application/pdf');
        if (file) setPdfFile(file);
        else toast('PDF 파일이 아닙니다');
        return;
      }
      const zipped = list.find((f) => /\.zip$/i.test(f.name) || /zip/.test(f.type));
      if (zipMode === 'unpack') {
        if (zipped) readZip(zipped);
        else toast('.zip 파일을 넣어 주세요');
        return;
      }
      addZipFiles(list);
    }

    root.addEventListener('dragover', (event) => {
      event.preventDefault();
      root.classList.add('is-dragging');
    }, { signal });
    root.addEventListener('dragleave', (event) => {
      if (event.target !== root) return;
      root.classList.remove('is-dragging');
    }, { signal });
    root.addEventListener('drop', (event) => {
      event.preventDefault();
      root.classList.remove('is-dragging');
      if (event.dataTransfer && event.dataTransfer.files) routeFiles(event.dataTransfer.files);
    }, { signal });

    renderImageOptions();
    renderPdfOptions();
    renderZipMode();
    renderZipList();
    renderImageList();
    setTab('image');

    // v1.16.0 — '이어서 하기'로 넘어온 파일이 있으면 바로 목록에 넣는다.
    const continued = ctx?.takeContinue ? ctx.takeContinue() : null;
    if (continued && Array.isArray(continued.files) && continued.files.length) {
      routeFiles(continued.files);
    }

    return () => {
      controller.abort();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  },
};

export default module;
