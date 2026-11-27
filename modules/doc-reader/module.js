/**
 * TIP · 문서 리더 (doc-reader)
 *
 * PDF · HWP · HWPX 에서 시작해 v1.26.0 에서 확장자를 크게 늘렸다.
 *   · 스프레드시트  .xlsx .xls .xlsm .csv .tsv .ods
 *   · 문서          .docx .odt .rtf (.doc 은 Mac 앱에서만)
 *   · 전자책        .epub
 *   · 프레젠테이션  .pptx
 *   · 텍스트        .txt .md .json .yaml .yml .xml .log
 * 파일 바이트는 어디로도 전송되지 않는다 — 모든 파서가 이 앱 안에서, 기기 안에서 돈다.
 */

import { formatBytes, icons } from '../../js/ui.js';
import {
  filebarTemplate,
  extLabel,
  pdfToolbarHTML,
  paperShell,
  STAGE_ID,
} from './renderers.js';
import { createPdfSession } from './pdf-viewer.js';
import { renderDocument as renderHwp, errorHint as hwpErrorHint } from './hwp.js';
import { renderSections as renderHwpxSections, errorHint as hwpxErrorHint } from './hwpx.js';
import { formatError } from './ooxml.js';
import { openSpreadsheet } from './spreadsheet.js';
import { openDocx } from './docx.js';
import { openOdt } from './odt.js';
import { openRtf } from './rtf.js';
import { openEpub } from './epub.js';
import { openPptx } from './pptx.js';
import { openText } from './textdoc.js';
import { openLegacyDoc, tauriCore } from './legacy-doc.js';

const SPREADSHEETS = ['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods'];
const TEXTS = ['txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'xml', 'log'];
const OFFICE = ['docx', 'doc', 'odt', 'rtf'];
const ALL = ['pdf', 'hwp', 'hwpx', ...SPREADSHEETS, ...OFFICE, 'epub', 'pptx', ...TEXTS];
const ACCEPT = ALL.map((extension) => `.${extension}`).join(',');

const LABELS = {
  pdf: 'PDF', hwp: 'HWP', hwpx: 'HWPX', xlsx: 'XLSX', xls: 'XLS', xlsm: 'XLSM', csv: 'CSV',
  tsv: 'TSV', ods: 'ODS', docx: 'DOCX', doc: 'DOC', odt: 'ODT', rtf: 'RTF', epub: 'EPUB',
  pptx: 'PPTX', txt: 'TXT', md: 'MD', markdown: 'MD', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  xml: 'XML', log: 'LOG',
};

function noticeBox(kind, title, body) {
  const glyph = { warn: '⚠', bad: '✕', info: 'ℹ' }[kind] || 'ℹ';
  const box = document.createElement('div');
  box.className = `notice ${kind === 'info' ? '' : kind}`;
  box.innerHTML = `<span class="n-icon">${glyph}</span>
    <div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
  box.querySelector('.n-title').textContent = title;
  box.querySelector('.n-text').textContent = body;
  return box;
}

function loadingEl(text) {
  const wrap = document.createElement('div');
  wrap.innerHTML = '<div class="loading"><span class="spinner"></span><span></span></div>';
  wrap.querySelector('.loading span:last-child').textContent = text;
  return wrap.firstElementChild;
}

const module = {
  id: 'doc-reader',
  accepts: [
    'application/pdf',
    'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwpx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv', 'text/tab-separated-values',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.oasis.opendocument.text',
    'application/rtf', 'text/rtf',
    'application/epub+zip',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/markdown', 'application/json', 'text/yaml', 'application/x-yaml',
    'application/xml', 'text/xml',
    ...ALL.map((extension) => `.${extension}`),
  ],
  name: '문서 리더',
  kind: 'reader',
  category: 'docs',
  version: '1.1.0',
  subtitle: 'PDF, HWP, Excel, Word, PPT, EPUB',
  description: 'PDF와 한글, 엑셀, 워드, 파워포인트, 전자책, 텍스트 문서를 바로 엽니다.',
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/></svg>`,
  defaultEnabled: true,
  defaultPinned: true,

  mount(root) {
    const controller = new AbortController();
    const { signal } = controller;
    let session = null;
    let objectUrls = [];

    root.innerHTML = `
      <div class="dr">
        <div class="dr-empty" id="dr-empty">
          <div class="dz-icon">${icons.doc}</div>
          <button class="primary-btn" type="button" id="dr-browse">${icons.upload} 파일 열기</button>
          <p>PDF, HWP, 엑셀·워드·파워포인트, EPUB, 텍스트 문서를 열 수 있습니다</p>
        </div>
        <input type="file" id="dr-input" class="sr-only" accept="${ACCEPT}">
        <div id="dr-result"></div>
      </div>`;

    const empty = root.querySelector('#dr-empty');
    const input = root.querySelector('#dr-input');
    const result = root.querySelector('#dr-result');

    /* ------------------------------ wiring ------------------------------ */

    root.querySelector('#dr-browse').addEventListener('click', () => input.click(), { signal });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) openFile(file);
      input.value = '';
    }, { signal });

    ['dragenter', 'dragover'].forEach((type) =>
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.add('dr-over');
      }, { signal }));

    ['dragleave', 'drop'].forEach((type) =>
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.remove('dr-over');
      }, { signal }));

    root.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (file) openFile(file);
    }, { signal });

    /* ----------------------------- open flow ---------------------------- */

    function unsupported(ext) {
      result.innerHTML = '';
      const label = LABELS[ext] ? `.${ext}` : ext ? `.${ext}` : '이';
      result.append(noticeBox('bad', '열 수 없는 형식',
        `${label} 파일은 지원하지 않습니다. PDF, HWP, 엑셀(xlsx·xls·csv), 워드(docx·doc), `
        + '파워포인트(pptx), EPUB, 텍스트 문서를 넣어 주세요.'));
    }

    async function openFile(file) {
      const ext = extLabel(file.name).toLowerCase();
      if (!ALL.includes(ext)) {
        unsupported(ext);
        return;
      }
      if (ext === 'doc' && !tauriCore()) {
        result.innerHTML = '';
        result.append(noticeBox('info', 'Mac 앱에서 .doc 열람 가능',
          '구형 Word(.doc)는 macOS 의 문서 변환 기능을 써야 해서 Mac 앱에서만 열립니다. '
          + '아이폰·웹에서는 .docx 로 저장한 뒤 열어 주세요.'));
        return;
      }
      try {
        await openByExt(file, ext);
      } catch (error) {
        console.error('[TIP doc-reader]', error);
        result.innerHTML = '';
        result.append(noticeBox('bad', '문서를 열지 못했습니다', hintFor(ext, error)));
        resetSessionOnly();
      }
    }

    function hintFor(ext, error) {
      if (ext === 'pdf') return pdfErrorHint(error);
      if (ext === 'hwp') return hwpErrorHint(error);
      if (ext === 'hwpx') return hwpxErrorHint(error);
      if (ext === 'doc') return String(error?.message || 'Mac 앱에서 .doc 파일을 열지 못했습니다.');
      const label = LABELS[ext] || ext.toUpperCase();
      return formatError(error, label);
    }

    function buildChrome(file) {
      resetSessionOnly();
      empty.hidden = true;
      result.innerHTML = `
        ${filebarTemplate()}
        <div id="dr-toolbar-slot"></div>
        <div class="doc-stage" id="${STAGE_ID}"></div>
        <div id="dr-msg"></div>`;
      result.querySelector('#dr-f-name').textContent = file.name;
      result.querySelector('#dr-f-meta').textContent = formatBytes(file.size);
      result.querySelector('#dr-f-icon').textContent = LABELS[extLabel(file.name).toLowerCase()] || extLabel(file.name);
      result.querySelector('#dr-reopen').addEventListener('click', () => input.click(), { signal });
      result.querySelector('#dr-close').addEventListener('click', reset, { signal });
      return {
        stage: result.querySelector(`#${STAGE_ID}`),
        msg: result.querySelector('#dr-msg'),
        toolbar: result.querySelector('#dr-toolbar-slot'),
      };
    }

    function resetSessionOnly() {
      if (session) {
        try { session.destroy?.(); } catch { /* 이미 정리됨 */ }
        session = null;
      }
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls = [];
    }

    function reset() {
      resetSessionOnly();
      result.innerHTML = '';
      empty.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function context(file, ext, chrome) {
      return {
        file,
        ext,
        signal,
        result,
        stage: chrome.stage,
        msg: chrome.msg,
        setToolbar(html) { chrome.toolbar.innerHTML = html; },
        addUrl(url) { if (url) objectUrls.push(url); return url; },
      };
    }

    function showLoading(chrome, text) {
      chrome.stage.innerHTML = '';
      chrome.stage.append(loadingEl(text));
    }

    async function openByExt(file, ext) {
      const chrome = buildChrome(file);
      const ctx = context(file, ext, chrome);
      if (ext === 'pdf') { session = await openPdf(file, ctx); return; }
      if (ext === 'hwp') { showLoading(chrome, '한글 문서를 해석하는 중…'); session = await openHwp(file, chrome); return; }
      if (ext === 'hwpx') { showLoading(chrome, 'HWPX 압축을 푸는 중…'); session = await openHwpx(file, chrome); return; }
      if (SPREADSHEETS.includes(ext)) { showLoading(chrome, '시트를 읽는 중…'); session = await openSpreadsheet(ctx); return; }
      if (ext === 'docx') { showLoading(chrome, 'Word 문서를 그리는 중…'); session = await openDocx(ctx); return; }
      if (ext === 'odt') { showLoading(chrome, '문서를 그리는 중…'); session = await openOdt(ctx); return; }
      if (ext === 'rtf') { showLoading(chrome, '서식을 해석하는 중…'); session = await openRtf(ctx); return; }
      if (ext === 'epub') { showLoading(chrome, '전자책을 여는 중…'); session = await openEpub(ctx); return; }
      if (ext === 'pptx') { showLoading(chrome, '슬라이드를 그리는 중…'); session = await openPptx(ctx); return; }
      if (ext === 'doc') { showLoading(chrome, 'Mac 문서 변환으로 여는 중…'); session = await openLegacyDoc(ctx); return; }
      if (TEXTS.includes(ext)) { showLoading(chrome, '문서를 읽는 중…'); session = await openText(ctx); return; }
      unsupported(ext);
    }

    /* -------------------------------- PDF ------------------------------- */

    async function openPdf(file, ctx) {
      ctx.setToolbar(pdfToolbarHTML());
      ctx.stage.innerHTML = loadingEl('PDF를 준비하는 중…').outerHTML;

      const pdfSession = createPdfSession(file);
      pdfSession.onChange = (page, total, zoomPercent) => {
        const pageLabel = result.querySelector('#dr-page');
        if (pageLabel) pageLabel.textContent = `${page} / ${total}`;
        const prev = result.querySelector('#dr-prev');
        const next = result.querySelector('#dr-next');
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= total;
        const zoomLabel = result.querySelector('#dr-zoom-label');
        if (zoomLabel) zoomLabel.textContent = `${zoomPercent}%`;
      };

      result.querySelector('#dr-prev').addEventListener('click', () => pdfSession.gotoPage(pdfSession.page - 1), { signal });
      result.querySelector('#dr-next').addEventListener('click', () => pdfSession.gotoPage(pdfSession.page + 1), { signal });
      result.querySelector('#dr-zoom-in').addEventListener('click', () => pdfSession.zoomBy(1.25), { signal });
      result.querySelector('#dr-zoom-out').addEventListener('click', () => pdfSession.zoomBy(0.8), { signal });
      result.querySelector('#dr-fit').addEventListener('click', () => pdfSession.fitToWidth(), { signal });
      const rotateBtn = result.querySelector('#dr-rotate');
      let rotation = 0;
      rotateBtn.addEventListener('click', () => {
        rotation = (rotation + 90) % 360;
        rotateBtn.textContent = `↻ ${rotation}°`;
        pdfSession.rotate();
      }, { signal });

      try {
        await pdfSession.open();
      } catch (error) {
        pdfSession.destroy();
        throw error;
      }
      return pdfSession;
    }

    /* -------------------------------- HWP -------------------------------- */

    async function openHwp(file, chrome) {
      chrome.stage.innerHTML = paperShell();
      const paper = chrome.stage.querySelector('#dr-paper');
      paper.innerHTML = loadingEl('한글 문서를 해석하는 중…').outerHTML;

      const { parse } = await import('../../vendor/hwpjs/hwp.esm.js');
      const data = await file.arrayBuffer();
      const doc = parse(new Uint8Array(data));
      if (document.fonts?.ready) await document.fonts.ready;
      paper.innerHTML = renderHwp(doc);
      return {};
    }

    /* ------------------------------- HWPX -------------------------------- */

    function sectionNumber(name) {
      const match = /section(\d+)\.xml$/i.exec(name);
      return match ? Number(match[1]) : 0;
    }

    async function openHwpx(file, chrome) {
      chrome.stage.innerHTML = paperShell();
      const paper = chrome.stage.querySelector('#dr-paper');
      paper.innerHTML = loadingEl('HWPX 압축을 푸는 중…').outerHTML;

      const zip = await window.JSZip.loadAsync(file);
      const sectionNames = Object.keys(zip.files)
        .filter((name) => /^contents\/section\d+\.xml$/i.test(name))
        .sort((a, b) => sectionNumber(a) - sectionNumber(b));
      if (!sectionNames.length) throw new Error('올바른 HWPX 구조가 아닙니다(Contents/section*.xml 없음).');

      paper.innerHTML = loadingEl('문서 내용을 해석하는 중…').outerHTML;
      const xmlList = await Promise.all(sectionNames.map((name) => zip.files[name].async('string')));

      // 내장 이미지 → blob URL
      const binUrls = {};
      const binNames = Object.keys(zip.files).filter((n) => /bin[a-z]*\//i.test(n) && /\.(png|jpe?g|gif|bmp)$/i.test(n));
      await Promise.all(binNames.map(async (name) => {
        try {
          const data = await zip.files[name].async('arraybuffer');
          const type = /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.gif$/i.test(name) ? 'image/gif' : 'image/bmp';
          const url = URL.createObjectURL(new Blob([data], { type }));
          binUrls[name.split('/').pop().toLowerCase()] = url;
          objectUrls.push(url);
        } catch { /* 깨진 항목은 건너뛴다 */ }
      }));

      paper.innerHTML = renderHwpxSections(xmlList);
      paper.querySelectorAll('img[data-binref]').forEach((img) => {
        const ref = (img.getAttribute('data-binref') || '').toLowerCase();
        const match = Object.keys(binUrls).find((name) => name.includes(ref) || ref.includes(name.replace(/\.[a-z]+$/, '')));
        if (match) img.src = binUrls[match];
        else img.remove();
      });
      return {};
    }

    /* ------------------------------- teardown ---------------------------- */

    return () => {
      controller.abort();
      resetSessionOnly();
    };
  },
};

function pdfErrorHint(error) {
  const message = String(error?.message || error || '');
  if (/password/i.test(message)) return '암호로 보호된 PDF입니다. 암호를 푼 뒤 다시 열어 주세요.';
  if (/Invalid PDF|structure/i.test(message)) return 'PDF 구조를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.';
  return `이 PDF 파일을 여는 데 실패했습니다: ${message}`;
}

export default module;
