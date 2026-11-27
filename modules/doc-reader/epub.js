/**
 * EPUB 렌더러 (v1.26.0) — 전자책(.epub).
 *
 * OPF(spine) 순서대로 한 장씩 읽고, 목차(EPUB3 nav / EPUB2 NCX)로 옮겨 다닌다.
 * 장 본문은 DOMPurify 로 지운 뒤(책이 준 script·onerror·style 전부 버림) 그림만 blob URL 로
 * 다시 붙인다. 책 안 링크는 이 리더 안에서 이동한다.
 */

import { escapeHtml } from '../../js/ui.js';
import { loadZip, xml, els, kids, kid, attr, nameOf, resolvePath, dirOf, blobUrl } from './ooxml.js';
import { sanitizeChapter } from './sanitize.js';
import { toolbarHTML } from './findbar.js';

const EMPTY_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function normalizeHref(path) {
  const decoded = decodeURIComponent(path || '');
  const [file, anchor] = decoded.split('#');
  return { file: file.replace(/^\.\//, ''), anchor: anchor || '' };
}

export async function openEpub(ctx) {
  const zip = await loadZip(ctx.file);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('EPUB 구조(META-INF/container.xml)를 찾지 못했습니다.');
  const container = xml(await containerEntry.async('string'));
  const rootfile = els(container, 'rootfile')[0];
  const opfPath = attr(rootfile, 'full-path');
  if (!opfPath) throw new Error('EPUB 패키지 파일 경로가 없습니다.');
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error('EPUB 패키지 파일을 찾지 못했습니다.');
  const opf = xml(await opfEntry.async('string'));
  const opfDir = dirOf(opfPath);

  const manifest = new Map();
  for (const item of els(opf, 'item')) {
    manifest.set(attr(item, 'id'), {
      href: resolvePath(opfDir, attr(item, 'href') || ''),
      type: attr(item, 'media-type') || '',
      properties: attr(item, 'properties') || '',
    });
  }

  const spineIds = els(opf, 'itemref').map((item) => attr(item, 'idref'));
  const chapters = spineIds
    .map((id) => manifest.get(id))
    .filter((item) => item && /x?html/i.test(item.type))
    .map((item) => ({ path: item.href, title: '' }));
  if (!chapters.length) throw new Error('EPUB 안에 읽을 장(章)이 없습니다.');

  const title = (els(opf, 'title')[0]?.textContent || ctx.file.name || '').trim();
  const author = (els(opf, 'creator')[0]?.textContent || '').trim();

  // 목차 — EPUB3 nav, 없으면 EPUB2 NCX
  const toc = [];
  const navItem = [...manifest.values()].find((item) => /\bnav\b/.test(item.properties));
  if (navItem) {
    const navEntry = zip.file(navItem.href);
    if (navEntry) {
      const navDoc = new DOMParser().parseFromString(await navEntry.async('string'), 'text/html');
      const nav = navDoc.querySelector('nav[epub\\:type="toc"], nav#toc, nav');
      const links = nav ? Array.from(nav.querySelectorAll('a[href]')) : [];
      for (const link of links) {
        const { file } = normalizeHref(link.getAttribute('href'));
        toc.push({ path: resolvePath(dirOf(navItem.href), file), title: (link.textContent || '').trim() });
      }
    }
  }
  if (!toc.length) {
    const ncx = [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml');
    if (ncx) {
      const ncxEntry = zip.file(ncx.href);
      if (ncxEntry) {
        const ncxDoc = xml(await ncxEntry.async('string'));
        for (const point of els(ncxDoc, 'navpoint')) {
          const label = els(point, 'text')[0]?.textContent || '';
          const content = els(point, 'content')[0];
          const src = attr(content, 'src') || '';
          const { file } = normalizeHref(src);
          toc.push({ path: resolvePath(dirOf(ncx.href), file), title: label.trim() });
        }
      }
    }
  }
  for (const entry of toc) {
    const chapter = chapters.find((item) => item.path === entry.path);
    if (chapter && !chapter.title) chapter.title = entry.title;
  }

  let index = 0;
  const cache = new Map();

  ctx.setToolbar(toolbarHTML({
    left: `<div class="tool-group">
        <button class="tool-btn" type="button" id="dr-epub-toc" aria-label="목차" title="목차">☰ 목차</button>
        <button class="tool-btn" type="button" id="dr-epub-prev" aria-label="이전 장" title="이전 장">←</button>
        <span class="zoom-label dr-chapter-count" id="dr-epub-count">1 / ${chapters.length}</span>
        <button class="tool-btn" type="button" id="dr-epub-next" aria-label="다음 장" title="다음 장">→</button>
      </div>`,
    right: `<button class="tool-btn text" type="button" id="dr-epub-first" title="첫 장">처음</button>`,
  }));

  const tocPanel = document.createElement('div');
  tocPanel.className = 'dr-epub-toc';
  tocPanel.hidden = true;
  tocPanel.setAttribute('role', 'dialog');
  tocPanel.setAttribute('aria-label', '목차');
  ctx.result.insertBefore(tocPanel, ctx.stage);

  const stage = ctx.stage;
  stage.classList.add('dr-paper', 'dr-epub');

  const countLabel = ctx.result.querySelector('#dr-epub-count');
  const prevButton = ctx.result.querySelector('#dr-epub-prev');
  const nextButton = ctx.result.querySelector('#dr-epub-next');
  const tocButton = ctx.result.querySelector('#dr-epub-toc');

  function drawToc() {
    const items = chapters.map((chapter, position) => `
      <button class="dr-toc-item${position === index ? ' is-current' : ''}" type="button" data-position="${position}">
        <span class="dr-toc-num">${position + 1}</span>
        <span class="dr-toc-title">${escapeHtml(chapter.title || chapter.path)}</span>
      </button>`).join('');
    tocPanel.innerHTML = `<div class="dr-toc-head"><b>${escapeHtml(title || '목차')}</b>
        <button class="icon-btn" type="button" id="dr-toc-close" aria-label="목차 닫기">✕</button></div>
      <div class="dr-toc-list">${items}
      ${toc.length > chapters.length ? `<p class="dr-toc-more">목차 항목 ${toc.length}개 중 ${chapters.length}장을 보여 줍니다.</p>` : ''}
      </div>`;
    tocPanel.querySelectorAll('.dr-toc-item').forEach((button) => {
      button.addEventListener('click', () => {
        tocPanel.hidden = true;
        load(Number(button.dataset.position));
      }, { signal: ctx.signal });
    });
    tocPanel.querySelector('#dr-toc-close')?.addEventListener('click', () => { tocPanel.hidden = true; }, { signal: ctx.signal });
  }

  function scrollToAnchor(anchor) {
    if (!anchor) { stage.scrollTop = 0; return; }
    const id = decodeURIComponent(anchor);
    const target = stage.querySelector(`#${CSS.escape(id)}`) || stage.querySelector(`[name="${CSS.escape(id)}"]`);
    if (target) {
      stage.scrollTop = target.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop - 12;
    } else {
      stage.scrollTop = 0;
    }
  }

  async function load(position, anchor = '') {
    index = Math.max(0, Math.min(chapters.length - 1, position));
    countLabel.textContent = `${index + 1} / ${chapters.length}`;
    prevButton.disabled = index === 0;
    nextButton.disabled = index === chapters.length - 1;
    stage.innerHTML = '<div class="loading"><span class="spinner"></span><span>장을 여는 중…</span></div>';

    const chapter = chapters[index];
    let entry = zip.file(chapter.path);
    if (!entry) {
      stage.innerHTML = `<div class="notice bad"><div class="n-body"><div class="n-title">장을 찾지 못했습니다</div>
        <div class="n-text">${escapeHtml(chapter.path)}</div></div></div>`;
      return;
    }
    const raw = await entry.async('string');
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body || doc.documentElement;
    if (!chapter.title) {
      chapter.title = (doc.querySelector('h1,h2,title')?.textContent || chapter.path).trim();
    }

    let html = sanitizeChapter(body.innerHTML || '');
    stage.innerHTML = html;

    // 그림 — 책 안 경로를 blob URL 로
    const images = Array.from(stage.querySelectorAll('img[src]'));
    for (const image of images) {
      const source = image.getAttribute('src') || '';
      if (/^(data|https?):/i.test(source)) { image.remove(); continue; }
      const { file } = normalizeHref(source);
      const path = resolvePath(dirOf(chapter.path), file);
      let url = cache.get(path);
      if (!url) {
        url = await blobUrl(zip, path);
        if (url) { cache.set(path, url); ctx.addUrl(url); }
      }
      if (url) image.setAttribute('src', url);
      else {
        const note = document.createElement('span');
        note.className = 'dr-img-note';
        note.textContent = `[그림] ${image.getAttribute('alt') || file}`;
        image.replaceWith(note);
      }
    }

    // 링크 — 책 안 이동은 이 리더에서, 바깥 링크만 새 창
    stage.querySelectorAll('a[href]').forEach((anchor) => {
      anchor.addEventListener('click', (event) => {
        const href = anchor.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) return;
        event.preventDefault();
        const { file, anchor: hash } = normalizeHref(href);
        if (!file) { scrollToAnchor(hash); return; }
        const targetPath = resolvePath(dirOf(chapter.path), file);
        const position = chapters.findIndex((item) => item.path === targetPath);
        if (position >= 0) load(position, hash);
        else scrollToAnchor(hash);
      }, { signal: ctx.signal });
    });

    // 본문에 남은 epub 표시(epub:type)는 지운다.
    stage.querySelectorAll('*').forEach((node) => {
      for (const attribute of Array.from(node.attributes || [])) {
        if (attribute.name.includes(':')) node.removeAttribute(attribute.name);
      }
    });

    scrollToAnchor(anchor);
    if (!anchor) stage.scrollTop = 0;
    drawToc();
  }

  tocButton.addEventListener('click', () => { tocPanel.hidden = !tocPanel.hidden; }, { signal: ctx.signal });
  prevButton.addEventListener('click', () => load(index - 1), { signal: ctx.signal });
  nextButton.addEventListener('click', () => load(index + 1), { signal: ctx.signal });
  ctx.result.querySelector('#dr-epub-first').addEventListener('click', () => load(0), { signal: ctx.signal });

  const sub = ctx.file.name ? `${author ? `${author} · ` : ''}${chapters.length}장` : '';
  if (sub) {
    const meta = ctx.result.querySelector('#dr-f-meta');
    if (meta) meta.textContent = sub;
  }

  await load(0);
  return {};
}
