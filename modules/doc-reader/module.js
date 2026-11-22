/**
 * TIP · 문서 리더 (doc-reader)
 * PDF · HWP · HWPX를 100% 브라우저에서 열어 읽는 첫 번째 TIP 모듈.
 * 파일 바이트는 어디로도 전송되지 않는다 — 모든 파서가 이 앱 안에서 돈다.
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

const ACCEPT = '.pdf,.hwp,.hwpx';

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
  name: '문서 리더',
  kind: 'reader',
  category: 'docs',
  version: '1.0.0',
  subtitle: 'PDF · HWP · HWPX',
  description: 'PDF, 한글(HWP·HWPX) 문서를 기기 안에서 바로 읽습니다. 업로드 없음, 외부 전송 없음.',
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
          <p>PDF · HWP · HWPX — 이 기기 안에서만 처리됩니다</p>
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

    // drag & drop on the whole module area (no dashed box needed)
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

    async function openFile(file) {
      const ext = extLabel(file.name).toLowerCase();
      if (!['pdf', 'hwp', 'hwpx'].includes(ext)) {
        result.innerHTML = '';
        result.append(noticeBox('bad', '열 수 없는 형식', `".${ext}" 파일은 지원하지 않습니다. PDF · HWP · HWPX 파일을 넣어 주세요.`));
        return;
      }
      try {
        if (ext === 'pdf') await openPdf(file);
        else if (ext === 'hwpx') await openHwpx(file);
        else await openHwp(file);
      } catch (error) {
        console.error('[TIP doc-reader]', error);
        const hint = ext === 'pdf' ? pdfErrorHint(error) : ext === 'hwpx' ? hwpxErrorHint(error) : hwpErrorHint(error);
        result.innerHTML = '';
        result.append(noticeBox('bad', '문서를 열지 못했습니다', hint));
        resetSessionOnly();
      }
    }

    function buildChrome(file, extraHTML = '') {
      resetSessionOnly();
      empty.hidden = true;
      result.innerHTML = `
        ${filebarTemplate()}
        ${extraHTML}
        <div class="doc-stage" id="${STAGE_ID}"></div>
        <div id="dr-msg"></div>`;
      result.querySelector('#dr-f-name').textContent = file.name;
      result.querySelector('#dr-f-meta').textContent = formatBytes(file.size);
      result.querySelector('#dr-f-icon').textContent = extLabel(file.name);
      result.querySelector('#dr-reopen').addEventListener('click', () => input.click(), { signal });
      result.querySelector('#dr-close').addEventListener('click', reset, { signal });
      return {
        stage: result.querySelector(`#${STAGE_ID}`),
        msg: result.querySelector('#dr-msg'),
      };
    }

    function resetSessionOnly() {
      if (session) {
        session.destroy();
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

    /* -------------------------------- PDF ------------------------------- */

    async function openPdf(file) {
      const { stage } = buildChrome(file, pdfToolbarHTML());
      stage.innerHTML = loadingEl('PDF를 준비하는 중…').outerHTML;

      session = createPdfSession(file);
      session.onChange = (page, total, zoomPercent) => {
        const pageLabel = result.querySelector('#dr-page');
        if (pageLabel) pageLabel.textContent = `${page} / ${total}`;
        const prev = result.querySelector('#dr-prev');
        const next = result.querySelector('#dr-next');
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= total;
        const zoomLabel = result.querySelector('#dr-zoom-label');
        if (zoomLabel) zoomLabel.textContent = `${zoomPercent}%`;
      };

      result.querySelector('#dr-prev').addEventListener('click', () => session.gotoPage(session.page - 1), { signal });
      result.querySelector('#dr-next').addEventListener('click', () => session.gotoPage(session.page + 1), { signal });
      result.querySelector('#dr-zoom-in').addEventListener('click', () => session.zoomBy(1.25), { signal });
      result.querySelector('#dr-zoom-out').addEventListener('click', () => session.zoomBy(0.8), { signal });
      result.querySelector('#dr-fit').addEventListener('click', () => session.fitToWidth(), { signal });
      const rotateBtn = result.querySelector('#dr-rotate');
      let rotation = 0;
      rotateBtn.addEventListener('click', () => {
        rotation = (rotation + 90) % 360;
        rotateBtn.textContent = `↻ ${rotation}°`;
        session.rotate();
      }, { signal });

      try {
        await session.open();
      } catch (error) {
        session.destroy();
        session = null;
        throw error;
      }
    }

    /* -------------------------------- HWP -------------------------------- */

    async function openHwp(file) {
      const { stage } = buildChrome(file);
      stage.innerHTML = paperShell();
      const paper = stage.querySelector('#dr-paper');
      paper.innerHTML = loadingEl('한글 문서를 해석하는 중…').outerHTML;

      const { parse } = await import('../../vendor/hwpjs/hwp.esm.js');
      const data = await file.arrayBuffer();
      const doc = parse(new Uint8Array(data));
      if (document.fonts?.ready) await document.fonts.ready;
      paper.innerHTML = renderHwp(doc);
    }

    /* ------------------------------- HWPX -------------------------------- */

    async function openHwpx(file) {
      const { stage } = buildChrome(file);
      stage.innerHTML = paperShell();
      const paper = stage.querySelector('#dr-paper');
      paper.innerHTML = loadingEl('HWPX 압축을 푸는 중…').outerHTML;

      const zip = await window.JSZip.loadAsync(file);
      const sectionNames = Object.keys(zip.files)
        .filter((name) => /^contents\/section\d+\.xml$/i.test(name))
        .sort((a, b) => sectionNumber(a) - sectionNumber(b));
      if (!sectionNames.length) throw new Error('올바른 HWPX 구조가 아닙니다(Contents/section*.xml 없음).');

      paper.innerHTML = loadingEl('문서 내용을 해석하는 중…').outerHTML;
      const xmlList = await Promise.all(sectionNames.map((name) => zip.files[name].async('string')));

      // embedded images → blob URLs
      const binUrls = {};
      const binNames = Object.keys(zip.files).filter((n) => /bin[a-z]*\//i.test(n) && /\.(png|jpe?g|gif|bmp)$/i.test(n));
      await Promise.all(binNames.map(async (name) => {
        try {
          const data = await zip.files[name].async('arraybuffer');
          const type = /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.gif$/i.test(name) ? 'image/gif' : 'image/bmp';
          const url = URL.createObjectURL(new Blob([data], { type }));
          binUrls[name.split('/').pop().toLowerCase()] = url;
          objectUrls.push(url);
        } catch { /* skip broken entry */ }
      }));

      paper.innerHTML = renderHwpxSections(xmlList);
      paper.querySelectorAll('img[data-binref]').forEach((img) => {
        const ref = (img.getAttribute('data-binref') || '').toLowerCase();
        const match = Object.keys(binUrls).find((name) => name.includes(ref) || ref.includes(name.replace(/\.[a-z]+$/, '')));
        if (match) img.src = binUrls[match];
        else img.remove();
      });
    }

    function sectionNumber(name) {
      const match = /section(\d+)\.xml$/i.exec(name);
      return match ? Number(match[1]) : 0;
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
