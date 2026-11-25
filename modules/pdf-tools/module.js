/**
 * TIP · PDF 합치기 · 페이지 추출 (pdf-tools)
 * PDF 여러 개를 순서대로 합치거나, 한 PDF에서 원하는 페이지만 뽑아 새 PDF로 저장한다.
 * 100% 클라이언트 사이드 — pdf-lib(vendor/pdf-lib)로 기기 안에서만 처리한다.
 */

import { formatBytes, icons } from '../../js/ui.js';
import { appendContinueBar } from '../../js/continue.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z"/><path d="M14 3v4h4"/><path d="M9.5 12.5h5M9.5 16h3"/><path d="M3 8v8"/><path d="M21 8v8"/></svg>`;

const ACCEPT = 'application/pdf,.pdf';

const UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10l6 6 6-6"/></svg>';

/* -------------------------------- helpers ------------------------------- */

function pdfLib() {
  const lib = window.PDFLib;
  if (!lib || !lib.PDFDocument) {
    throw new Error('PDF 엔진(pdf-lib)을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
  }
  return lib;
}

function baseName(name) {
  return (name || 'document').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'document';
}

function isPdf(file) {
  return /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
}

function uniqueName(name, used) {
  let out = name;
  let n = 2;
  while (used.has(out)) {
    out = name.replace(/(\.[^.]+)$/, `-${n}$1`);
    n += 1;
  }
  used.add(out);
  return out;
}

async function openDoc(file) {
  const { PDFDocument } = pdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes);
    return { doc, encrypted: false };
  } catch (error) {
    const message = String((error && error.message) || error);
    if (/encrypt|password/i.test(message)) {
      // 열기만 암호화된 PDF는 페이지 복사가 가능한 경우가 많다.
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      return { doc, encrypted: true };
    }
    throw error;
  }
}

/** "1, 3-5" → [1,3,4,5] (1-based, 문서 범위 밖은 bad로 모은다) */
function parseRange(text, total) {
  const tokens = String(text || '').split(/[,\s·]+/).map((t) => t.trim()).filter(Boolean);
  const picked = new Set();
  const bad = [];
  for (const token of tokens) {
    const span = /^(\d+)\s*[-~]\s*(\d+)$/.exec(token);
    if (span) {
      let a = Number(span[1]);
      let b = Number(span[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > total) { bad.push(token); continue; }
      for (let i = a; i <= b; i += 1) picked.add(i);
      continue;
    }
    const single = /^(\d+)$/.exec(token);
    if (single) {
      const value = Number(single[1]);
      if (value >= 1 && value <= total) picked.add(value);
      else bad.push(token);
      continue;
    }
    bad.push(token);
  }
  return { pages: [...picked].sort((a, b) => a - b), bad };
}

/** [1,2,3,5,7,8] → "1-3, 5, 7-8" */
function formatRanges(pages) {
  if (!pages.length) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const value = sorted[i];
    if (value === prev + 1) { prev = value; continue; }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = value;
    prev = value;
  }
  parts.push(start === prev ? String(start) : `${start}-${prev}`);
  return parts.join(', ');
}

function noticeBox(kind, title, body) {
  const glyph = { warn: '⚠', bad: '✕', info: 'ℹ' }[kind] || 'ℹ';
  const box = document.createElement('div');
  box.className = `notice${kind === 'info' ? '' : ` ${kind}`}`;
  box.innerHTML = `<span class="n-icon">${glyph}</span>
    <div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
  box.querySelector('.n-title').textContent = title;
  box.querySelector('.n-text').textContent = body;
  return box;
}

function download(bytes, name) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function pdfErrorHint(error) {
  const message = String((error && error.message) || error);
  if (/encrypt|password/i.test(message)) {
    return '암호가 걸린 PDF입니다. 암호를 푼 뒤 다시 시도해 주세요.';
  }
  if (/Invalid PDF|No PDF header|Failed to parse/i.test(message)) {
    return 'PDF 구조를 읽지 못했습니다. 파일이 손상되었거나 PDF가 아닐 수 있습니다.';
  }
  return message || 'PDF를 처리하지 못했습니다.';
}

/* -------------------------------- module ------------------------------- */

const module = {
  id: 'pdf-tools',
  accepts: ['application/pdf', '.pdf'],
  name: 'PDF 합치기',
  shortName: 'PDF 합치기',
  kind: 'tool',
  category: 'docs',
  version: '1.0.0',
  subtitle: '병합과 페이지 추출',
  description: '여러 PDF 를 순서대로 합치거나 한 PDF 에서 원하는 페이지만 새 파일로 뽑습니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;

    /** @type {{id:number,file:File,pages:number|null,error:string|null}[]} */
    let mergeFiles = [];
    let mergeSeq = 0;
    let mode = 'merge';

    /* extract state */
    let xFile = null;
    let xTotal = 0;
    let xPages = new Set();

    /* image → pdf state (v1.16.0) */
    /** @type {{id:number,file:File}[]} */
    let imageFiles = [];
    let imageSeq = 0;
    let imageFit = 'a4';

    root.innerHTML = `
      <div class="pt">
        <div class="ic-segment pt-modes" role="tablist" aria-label="모드">
          <button class="ic-seg" type="button" role="tab" data-mode="merge" aria-checked="true">합치기</button>
          <button class="ic-seg" type="button" role="tab" data-mode="extract" aria-checked="false">페이지 추출</button>
          <button class="ic-seg" type="button" role="tab" data-mode="image" aria-checked="false">이미지를 PDF로</button>
        </div>

        <!-- 합치기 -->
        <section class="pt-pane" id="pt-merge" aria-label="PDF 합치기">
          <div class="dr-empty" id="pt-m-empty">
            <div class="dz-icon">${ICON}</div>
            <button class="primary-btn" type="button" id="pt-m-browse">${icons.upload} PDF 선택</button>
            <p>PDF 2개 이상, 파일을 끌어다 놓아도 됩니다</p>
          </div>
          <input type="file" id="pt-m-input" class="sr-only" accept="${ACCEPT}" multiple>
          <div id="pt-m-body" hidden>
            <div class="pt-files" id="pt-m-files"></div>
            <div class="ic-actions pt-actions">
              <button class="primary-btn ghost" type="button" id="pt-m-add">${icons.plus} PDF 추가</button>
              <button class="primary-btn" type="button" id="pt-m-run">합치기</button>
              <button class="primary-btn ghost" type="button" id="pt-m-clear">비우기</button>
            </div>
            <div id="pt-m-result"></div>
          </div>
        </section>

        <!-- 페이지 추출 -->
        <section class="pt-pane" id="pt-x" aria-label="페이지 추출" hidden>
          <div class="dr-empty" id="pt-x-empty">
            <div class="dz-icon">${ICON}</div>
            <button class="primary-btn" type="button" id="pt-x-browse">${icons.upload} PDF 선택</button>
            <p>PDF 1개, 총 페이지를 읽고 원하는 페이지만 뽑습니다</p>
          </div>
          <input type="file" id="pt-x-input" class="sr-only" accept="${ACCEPT}">
          <div id="pt-x-body" hidden>
            <div class="filebar">
              <span class="f-icon">PDF</span>
              <div class="f-info">
                <div class="f-name" id="pt-x-name"></div>
                <div class="f-meta" id="pt-x-meta"></div>
              </div>
              <button class="icon-btn" type="button" id="pt-x-remove" aria-label="파일 제거">${icons.close}</button>
            </div>
            <div class="ic-options">
              <div class="ic-row">
                <span class="ic-label">범위</span>
                <input type="text" id="pt-x-range" class="pt-input" inputmode="text"
                       placeholder="예: 1, 3-5" aria-label="페이지 범위">
                <span class="ic-hint" id="pt-x-count">0페이지 선택</span>
              </div>
              <div class="pt-chips" id="pt-x-chips" role="group" aria-label="페이지 선택"></div>
            </div>
            <div class="ic-actions pt-actions">
              <button class="primary-btn" type="button" id="pt-x-run">선택 페이지 추출</button>
              <button class="primary-btn ghost" type="button" id="pt-x-all">전체 선택</button>
            </div>
            <div id="pt-x-result"></div>
          </div>
        </section>

        <!-- 이미지를 PDF로 -->
        <section class="pt-pane" id="pt-i" aria-label="이미지를 PDF로" hidden>
          <div class="dr-empty" id="pt-i-empty">
            <div class="dz-icon">${ICON}</div>
            <button class="primary-btn" type="button" id="pt-i-browse">${icons.upload} 이미지 선택</button>
            <p>JPG·PNG·WebP 사진을 순서대로 한 PDF 로 묶습니다</p>
          </div>
          <input type="file" id="pt-i-input" class="sr-only" accept="image/*" multiple>
          <div id="pt-i-body" hidden>
            <div class="pt-files" id="pt-i-files"></div>
            <div class="ic-options">
              <div class="ic-row">
                <span class="ic-label">쪽 크기</span>
                <div class="ic-segment" id="pt-i-fit" role="radiogroup" aria-label="쪽 크기">
                  <button class="ic-seg" type="button" role="radio" data-fit="a4" aria-checked="true">A4 맞춤</button>
                  <button class="ic-seg" type="button" role="radio" data-fit="original" aria-checked="false">원본 크기</button>
                </div>
              </div>
            </div>
            <div class="ic-actions pt-actions">
              <button class="primary-btn ghost" type="button" id="pt-i-add">${icons.plus} 이미지 추가</button>
              <button class="primary-btn" type="button" id="pt-i-run">PDF 만들기</button>
              <button class="primary-btn ghost" type="button" id="pt-i-clear">비우기</button>
            </div>
            <div id="pt-i-result"></div>
          </div>
        </section>

        <div id="pt-msg"></div>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const msgEl = $('#pt-msg');
    const modesEl = $('.pt-modes');

    const mEmpty = $('#pt-m-empty');
    const mBody = $('#pt-m-body');
    const mInput = $('#pt-m-input');
    const mFilesEl = $('#pt-m-files');
    const mResultEl = $('#pt-m-result');
    const mRunBtn = $('#pt-m-run');

    const xEmpty = $('#pt-x-empty');
    const xBody = $('#pt-x-body');
    const xInput = $('#pt-x-input');
    const xName = $('#pt-x-name');
    const xMeta = $('#pt-x-meta');
    const xRange = $('#pt-x-range');
    const xCount = $('#pt-x-count');
    const xChips = $('#pt-x-chips');
    const xResultEl = $('#pt-x-result');
    const xRunBtn = $('#pt-x-run');

    const iEmpty = $('#pt-i-empty');
    const iBody = $('#pt-i-body');
    const iInput = $('#pt-i-input');
    const iFilesEl = $('#pt-i-files');
    const iResultEl = $('#pt-i-result');
    const iRunBtn = $('#pt-i-run');

    function setMode(next) {
      mode = next;
      modesEl.querySelectorAll('.ic-seg').forEach((btn) => {
        btn.setAttribute('aria-checked', String(btn.dataset.mode === next));
      });
      $('#pt-merge').hidden = next !== 'merge';
      $('#pt-x').hidden = next !== 'extract';
      $('#pt-i').hidden = next !== 'image';
    }

    modesEl.addEventListener('click', (event) => {
      const btn = event.target.closest('.ic-seg');
      if (btn && btn.dataset.mode) setMode(btn.dataset.mode);
    }, { signal });

    /* ------------------------------ 합치기 ------------------------------ */

    $('#pt-m-browse').addEventListener('click', () => mInput.click(), { signal });
    $('#pt-m-add').addEventListener('click', () => mInput.click(), { signal });
    mInput.addEventListener('change', () => {
      addMergeFiles(mInput.files);
      mInput.value = '';
    }, { signal });

    $('#pt-m-clear').addEventListener('click', () => {
      mergeFiles = [];
      mResultEl.innerHTML = '';
      renderMerge();
    }, { signal });

    mRunBtn.addEventListener('click', runMerge, { signal });

    function addMergeFiles(list) {
      const incoming = Array.from(list || []);
      if (!incoming.length) return;
      const rejected = [];
      for (const file of incoming) {
        if (!isPdf(file)) { rejected.push(file.name); continue; }
        mergeFiles.push({ id: (mergeSeq += 1), file, pages: null, error: null });
      }
      if (rejected.length) {
        msgEl.innerHTML = '';
        msgEl.append(noticeBox('warn', 'PDF만 넣을 수 있습니다', `${rejected.length}개 파일은 건너뛰었습니다.`));
      }
      mResultEl.innerHTML = '';
      renderMerge();
      mergeFiles.filter((entry) => entry.pages === null && !entry.error).forEach(probePages);
    }

    async function probePages(entry) {
      try {
        const { doc } = await openDoc(entry.file);
        entry.pages = doc.getPageCount();
      } catch (error) {
        entry.error = pdfErrorHint(error);
        console.error('[TIP pdf-tools]', error);
      }
      if (root.isConnected) renderMerge();
    }

    function renderMerge() {
      mEmpty.hidden = mergeFiles.length > 0;
      mBody.hidden = mergeFiles.length === 0;
      mFilesEl.innerHTML = '';

      mergeFiles.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = `pt-row${entry.error ? ' is-bad' : ''}`;

        const meta = entry.error
          ? entry.error
          : `${entry.pages === null ? '페이지 확인 중…' : `${entry.pages}페이지`}, ${formatBytes(entry.file.size)}`;

        row.innerHTML = `
          <span class="pt-order">${index + 1}</span>
          <div class="f-info">
            <div class="f-name"></div>
            <div class="f-meta"></div>
          </div>
          <div class="pt-row-btns">
            <button class="tool-btn" type="button" data-act="up" aria-label="위로" ${index === 0 ? 'disabled' : ''}>${UP}</button>
            <button class="tool-btn" type="button" data-act="down" aria-label="아래로" ${index === mergeFiles.length - 1 ? 'disabled' : ''}>${DOWN}</button>
            <button class="tool-btn" type="button" data-act="del" aria-label="목록에서 제거">${icons.close}</button>
          </div>`;
        row.querySelector('.f-name').textContent = entry.file.name;
        row.querySelector('.f-name').title = entry.file.name;
        row.querySelector('.f-meta').textContent = meta;

        row.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-act]');
          if (!btn || btn.disabled) return;
          const act = btn.dataset.act;
          if (act === 'del') mergeFiles.splice(index, 1);
          if (act === 'up' && index > 0) [mergeFiles[index - 1], mergeFiles[index]] = [mergeFiles[index], mergeFiles[index - 1]];
          if (act === 'down' && index < mergeFiles.length - 1) [mergeFiles[index + 1], mergeFiles[index]] = [mergeFiles[index], mergeFiles[index + 1]];
          mResultEl.innerHTML = '';
          renderMerge();
        }, { signal });

        mFilesEl.append(row);
      });

      const ready = mergeFiles.filter((entry) => !entry.error);
      mRunBtn.disabled = ready.length < 2;
      mRunBtn.title = ready.length < 2 ? 'PDF 2개 이상 필요합니다' : '';
    }

    async function runMerge() {
      const ready = mergeFiles.filter((entry) => !entry.error);
      if (ready.length < 2) {
        msgEl.innerHTML = '';
        msgEl.append(noticeBox('warn', 'PDF가 부족합니다', '합치려면 사용 가능한 PDF가 2개 이상 필요합니다.'));
        return;
      }
      mRunBtn.disabled = true;
      mRunBtn.textContent = '합치는 중…';
      mResultEl.innerHTML = '';
      msgEl.innerHTML = '';
      const usedNames = new Set();

      try {
        const { PDFDocument } = pdfLib();
        const out = await PDFDocument.create();
        let encrypted = 0;
        for (const entry of ready) {
          const { doc, encrypted: enc } = await openDoc(entry.file);
          if (enc) encrypted += 1;
          const pages = await out.copyPages(doc, doc.getPageIndices());
          pages.forEach((page) => out.addPage(page));
        }
        const bytes = await out.save();
        const totalPages = out.getPageCount();
        const name = uniqueName(`${baseName(ready[0].file.name)}_merged.pdf`, usedNames);

        renderResult(mResultEl, { name, bytes, pages: totalPages, note: `${ready.length}개 PDF 병합` });
        if (encrypted) {
          msgEl.append(noticeBox('warn', '암호가 걸린 PDF 포함', `${encrypted}개 파일은 암호화된 상태로 열었습니다. 결과에 빈 페이지가 있으면 암호를 푼 PDF로 다시 시도해 주세요.`));
        }
      } catch (error) {
        console.error('[TIP pdf-tools]', error);
        mResultEl.append(noticeBox('bad', '합치지 못했습니다', pdfErrorHint(error)));
      } finally {
        mRunBtn.disabled = mergeFiles.filter((entry) => !entry.error).length < 2;
        mRunBtn.textContent = '합치기';
      }
    }

    function renderResult(container, { name, bytes, pages, note }) {
      const card = document.createElement('div');
      card.className = 'pt-result';
      card.innerHTML = `
        <div class="pt-result-icon">PDF</div>
        <div class="f-info">
          <div class="f-name"></div>
          <div class="f-meta"></div>
        </div>
        <button class="primary-btn" type="button">저장</button>`;
      card.querySelector('.f-name').textContent = name;
      card.querySelector('.f-meta').textContent =
        `${pages}페이지, ${formatBytes(bytes.length)}${note ? `, ${note}` : ''}`;
      card.querySelector('button').addEventListener('click', () => download(bytes, name), { signal });
      container.innerHTML = '';
      container.append(card);
      // v1.16.0 — 만든 PDF 를 파일 압축으로 이어 보낸다.
      appendContinueBar(container, ctx, [
        { id: 'file-compress', label: '파일 압축으로', payload: { files: [new File([bytes], name, { type: 'application/pdf' })] } },
      ]);
      return card;
    }

    /* --------------------------- 이미지를 PDF로 --------------------------- */

    $('#pt-i-browse').addEventListener('click', () => iInput.click(), { signal });
    $('#pt-i-add').addEventListener('click', () => iInput.click(), { signal });
    iInput.addEventListener('change', () => {
      addImages(iInput.files);
      iInput.value = '';
    }, { signal });

    $('#pt-i-clear').addEventListener('click', () => {
      imageFiles = [];
      iResultEl.innerHTML = '';
      renderImages();
    }, { signal });

    $('#pt-i-fit').addEventListener('click', (event) => {
      const btn = event.target.closest('.ic-seg');
      if (!btn || !btn.dataset.fit) return;
      imageFit = btn.dataset.fit;
      $('#pt-i-fit').querySelectorAll('.ic-seg').forEach((seg) => {
        seg.setAttribute('aria-checked', String(seg.dataset.fit === imageFit));
      });
    }, { signal });

    iRunBtn.addEventListener('click', runImages, { signal });

    function addImages(list) {
      const incoming = Array.from(list || []);
      if (!incoming.length) return;
      const bad = [];
      incoming.forEach((file) => {
        if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name)) {
          bad.push(file.name);
          return;
        }
        imageFiles.push({ id: (imageSeq += 1), file });
      });
      msgEl.innerHTML = '';
      if (bad.length) msgEl.append(noticeBox('warn', '이미지만 넣을 수 있습니다', `${bad.length}개 파일은 건너뛰었습니다.`));
      iResultEl.innerHTML = '';
      renderImages();
    }

    function moveImage(id, delta) {
      const index = imageFiles.findIndex((entry) => entry.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= imageFiles.length) return;
      const [entry] = imageFiles.splice(index, 1);
      imageFiles.splice(target, 0, entry);
      iResultEl.innerHTML = '';
      renderImages();
    }

    function renderImages() {
      iFilesEl.innerHTML = '';
      const has = imageFiles.length > 0;
      iEmpty.hidden = has;
      iBody.hidden = !has;
      iRunBtn.disabled = !has;
      imageFiles.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'pt-file';
        row.innerHTML = `
          <span class="pt-num">${index + 1}</span>
          <div class="f-info">
            <div class="f-name"></div>
            <div class="f-meta"></div>
          </div>
          <button class="icon-btn" type="button" data-move="up" aria-label="앞으로">${UP}</button>
          <button class="icon-btn" type="button" data-move="down" aria-label="뒤로">${DOWN}</button>
          <button class="icon-btn" type="button" data-remove aria-label="빼기">${icons.close}</button>`;
        row.querySelector('.f-name').textContent = entry.file.name;
        row.querySelector('.f-meta').textContent = formatBytes(entry.file.size);
        row.querySelector('[data-move="up"]').addEventListener('click', () => moveImage(entry.id, -1), { signal });
        row.querySelector('[data-move="down"]').addEventListener('click', () => moveImage(entry.id, 1), { signal });
        row.querySelector('[data-remove]').addEventListener('click', () => {
          imageFiles = imageFiles.filter((item) => item.id !== entry.id);
          iResultEl.innerHTML = '';
          renderImages();
        }, { signal });
        iFilesEl.append(row);
      });
    }

    /** 사진을 PDF 에 넣을 수 있는 JPEG/PNG 바이트로 만든다 — 나머지는 캔버스로 JPEG 변환. */
    async function imageBytes(file) {
      const isPng = /png$/i.test(file.type) || /\.png$/i.test(file.name);
      const isJpg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
      if (isPng || isJpg) {
        return { kind: isPng ? 'png' : 'jpg', bytes: new Uint8Array(await file.arrayBuffer()) };
      }
      const url = URL.createObjectURL(file);
      try {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('그림을 읽지 못했습니다'));
        });
        image.src = url;
        await loaded;
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        canvas.getContext('2d').drawImage(image, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!blob) throw new Error('그림을 변환하지 못했습니다');
        return { kind: 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()) };
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function runImages() {
      if (!imageFiles.length) return;
      iRunBtn.disabled = true;
      iRunBtn.textContent = '만드는 중…';
      iResultEl.innerHTML = '';
      try {
        const { PDFDocument } = pdfLib();
        const doc = await PDFDocument.create();
        const A4 = [595.28, 841.89];
        const margin = 24;
        for (const entry of imageFiles) {
          const prepared = await imageBytes(entry.file);
          const image = prepared.kind === 'png' ? await doc.embedPng(prepared.bytes) : await doc.embedJpg(prepared.bytes);
          if (imageFit === 'a4') {
            const page = doc.addPage(A4);
            const maxW = A4[0] - margin * 2;
            const maxH = A4[1] - margin * 2;
            const scale = Math.min(maxW / image.width, maxH / image.height);
            const width = image.width * scale;
            const height = image.height * scale;
            page.drawImage(image, {
              x: (A4[0] - width) / 2,
              y: (A4[1] - height) / 2,
              width,
              height,
            });
          } else {
            const page = doc.addPage([image.width, image.height]);
            page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
          }
        }
        const bytes = await doc.save();
        const name = imageFiles.length === 1
          ? `${baseName(imageFiles[0].file.name)}.pdf`
          : `images-${imageFiles.length}.pdf`;
        const card = document.createElement('div');
        card.className = 'pt-result';
        card.innerHTML = `
          <div class="pt-result-icon">PDF</div>
          <div class="f-info">
            <div class="f-name"></div>
            <div class="f-meta"></div>
          </div>
          <button class="primary-btn" type="button">저장</button>`;
        card.querySelector('.f-name').textContent = name;
        card.querySelector('.f-meta').textContent =
          `${imageFiles.length}장, ${imageFit === 'a4' ? 'A4 맞춤' : '원본 크기'}, ${formatBytes(bytes.length)}`;
        card.querySelector('button').addEventListener('click', () => download(bytes, name), { signal });
        iResultEl.append(card);
        appendContinueBar(iResultEl, ctx, [
          { id: 'file-compress', label: '파일 압축으로', payload: { files: [new File([bytes], name, { type: 'application/pdf' })] } },
        ]);
      } catch (error) {
        console.error('[TIP pdf-tools]', error);
        iResultEl.append(noticeBox('bad', 'PDF 를 만들지 못했습니다', pdfErrorHint(error)));
      } finally {
        iRunBtn.disabled = imageFiles.length === 0;
        iRunBtn.textContent = 'PDF 만들기';
      }
    }

    /* ---------------------------- 페이지 추출 --------------------------- */

    $('#pt-x-browse').addEventListener('click', () => xInput.click(), { signal });
    xInput.addEventListener('change', () => {
      const file = xInput.files && xInput.files[0];
      if (file) openExtract(file);
      xInput.value = '';
    }, { signal });

    $('#pt-x-remove').addEventListener('click', () => {
      xFile = null;
      xTotal = 0;
      xPages = new Set();
      xRange.value = '';
      xResultEl.innerHTML = '';
      msgEl.innerHTML = '';
      xEmpty.hidden = false;
      xBody.hidden = true;
    }, { signal });

    xRange.addEventListener('input', () => {
      if (!xTotal) return;
      const { pages } = parseRange(xRange.value, xTotal);
      xPages = new Set(pages);
      syncChips();
      updateCount();
      xResultEl.innerHTML = '';
    }, { signal });

    $('#pt-x-all').addEventListener('click', () => {
      if (!xTotal) return;
      xPages = xPages.size === xTotal ? new Set() : new Set(Array.from({ length: xTotal }, (_, i) => i + 1));
      xRange.value = xPages.size === xTotal ? (xTotal ? `1-${xTotal}` : '') : formatRanges([...xPages]);
      syncChips();
      updateCount();
      xResultEl.innerHTML = '';
    }, { signal });

    xRunBtn.addEventListener('click', runExtract, { signal });

    async function openExtract(file) {
      msgEl.innerHTML = '';
      xResultEl.innerHTML = '';
      if (!isPdf(file)) {
        msgEl.append(noticeBox('warn', 'PDF가 아닙니다', '페이지 추출은 PDF 파일 하나로 진행합니다.'));
        return;
      }
      xFile = null;
      xTotal = 0;
      xPages = new Set();
      xRange.value = '';
      xName.textContent = file.name;
      xName.title = file.name;
      xMeta.textContent = `${formatBytes(file.size)}, 페이지 확인 중…`;
      xEmpty.hidden = true;
      xBody.hidden = false;
      xChips.innerHTML = '';
      xRunBtn.disabled = true;
      xCount.textContent = '불러오는 중…';

      try {
        const { doc } = await openDoc(file);
        xFile = file;
        xTotal = doc.getPageCount();
        xMeta.textContent = `${xTotal}페이지, ${formatBytes(file.size)}`;
        if (!xTotal) throw new Error('페이지가 없는 PDF입니다.');
        xRange.value = `1-${xTotal}`;
        xPages = new Set(Array.from({ length: xTotal }, (_, i) => i + 1));
        buildChips();
        updateCount();
        xRunBtn.disabled = false;
      } catch (error) {
        console.error('[TIP pdf-tools]', error);
        xMeta.textContent = `${formatBytes(file.size)}, 읽지 못함`;
        xRunBtn.disabled = true;
        xCount.textContent = '0페이지 선택';
        msgEl.append(noticeBox('bad', 'PDF를 열지 못했습니다', pdfErrorHint(error)));
      }
    }

    function buildChips() {
      xChips.innerHTML = '';
      const frag = document.createDocumentFragment();
      for (let i = 1; i <= xTotal; i += 1) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pt-chip';
        chip.textContent = String(i);
        chip.dataset.page = String(i);
        chip.setAttribute('aria-pressed', 'true');
        chip.addEventListener('click', () => {
          const page = Number(chip.dataset.page);
          if (xPages.has(page)) xPages.delete(page);
          else xPages.add(page);
          xRange.value = formatRanges([...xPages]);
          syncChips();
          updateCount();
          xResultEl.innerHTML = '';
        }, { signal });
        frag.append(chip);
      }
      xChips.append(frag);
    }

    function syncChips() {
      xChips.querySelectorAll('.pt-chip').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(xPages.has(Number(chip.dataset.page))));
      });
    }

    function updateCount() {
      xCount.textContent = `${xPages.size}페이지 선택`;
      xRunBtn.disabled = xPages.size === 0;
    }

    async function runExtract() {
      if (!xFile || !xPages.size) return;
      const pages = [...xPages].sort((a, b) => a - b);
      xRunBtn.disabled = true;
      xRunBtn.textContent = '추출 중…';
      xResultEl.innerHTML = '';
      msgEl.innerHTML = '';
      try {
        const { PDFDocument } = pdfLib();
        const { doc, encrypted } = await openDoc(xFile);
        const out = await PDFDocument.create();
        const copied = await out.copyPages(doc, pages.map((page) => page - 1));
        copied.forEach((page) => out.addPage(page));
        const bytes = await out.save();
        const name = `${baseName(xFile.name)}_extract${pages.length}p.pdf`;
        renderResult(xResultEl, {
          name,
          bytes,
          pages: out.getPageCount(),
          note: `원본 ${xTotal}페이지 중 ${formatRanges(pages)}`,
        });
        if (encrypted) {
          msgEl.append(noticeBox('warn', '암호가 걸린 PDF', '암호화된 PDF로 열었습니다. 빈 페이지가 나오면 암호를 푼 파일로 다시 시도해 주세요.'));
        }
      } catch (error) {
        console.error('[TIP pdf-tools]', error);
        xResultEl.innerHTML = '';
        xResultEl.append(noticeBox('bad', '추출하지 못했습니다', pdfErrorHint(error)));
      } finally {
        xRunBtn.textContent = '선택 페이지 추출';
        xRunBtn.disabled = xPages.size === 0;
      }
    }

    /* ---------------------------- drag & drop --------------------------- */

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
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) return;
      if (mode === 'image') {
        addImages(files);
        return;
      }
      if (mode === 'merge') {
        addMergeFiles(files);
        return;
      }
      const first = files.find(isPdf);
      if (first) openExtract(first);
      else {
        msgEl.innerHTML = '';
        msgEl.append(noticeBox('warn', 'PDF가 아닙니다', 'PDF 파일을 끌어다 놓아 주세요.'));
      }
    }, { signal });

    // v1.16.0 — '이어서 하기'로 넘어온 파일을 알맞은 모드에 넣는다(PDF 는 합치기, 사진은 이미지를 PDF로).
    const continued = ctx?.takeContinue ? ctx.takeContinue() : null;
    const continuedFiles = continued && Array.isArray(continued.files) ? continued.files : [];
    const continuedPdfs = continuedFiles.filter((file) => isPdf(file));
    const continuedImages = continuedFiles.filter((file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name || ''));
    if (continuedPdfs.length) {
      setMode('merge');
      addMergeFiles(continuedPdfs);
    } else if (continuedImages.length) {
      setMode('image');
      addImages(continuedImages);
    }

    return () => controller.abort();
  },
};

export default module;
