/**
 * PPTX 렌더러 (v1.26.0) — 프레젠테이션(.pptx).
 *
 * 슬라이드를 1280×720(또는 발표 파일이 정한 크기) 캔버스에 절대 위치로 그리고, 화면 폭에 맞춰
 * 줄인다. 텍스트·표·내장 그림·발표자 노트를 보여 주고, 이전/다음·슬라이드 목록으로 옮겨 다닌다.
 */

import { escapeHtml } from '../../js/ui.js';
import { loadZip, xml, els, kids, kid, attr, relAttr, nameOf, readRels, blobUrl } from './ooxml.js';
import { sanitizeBody, stripBadLinks } from './sanitize.js';
import { toolbarHTML } from './findbar.js';

const EMU = 9525;
const PT = 1.3333;

function px(emu) {
  const value = Number(emu || 0);
  return Number.isFinite(value) ? value / EMU : 0;
}

function colorOf(node) {
  const solid = kid(node, 'solidfill');
  if (!solid) return '';
  const srgb = kid(solid, 'srgbclr');
  if (srgb) {
    const value = attr(srgb, 'val') || '';
    return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : '';
  }
  return '';
}

function transformOf(node) {
  const xfrm = els(node, 'xfrm')[0];
  if (!xfrm) return null;
  const off = kid(xfrm, 'off');
  const ext = kid(xfrm, 'ext');
  if (!off || !ext) return null;
  return {
    x: px(attr(off, 'x')),
    y: px(attr(off, 'y')),
    w: px(attr(ext, 'cx')),
    h: px(attr(ext, 'cy')),
  };
}

/** 레이아웃/마스터의 자리표시자 위치 — 슬라이드에 xfrm 이 없을 때 쓴다. */
function placeholderMap(document, fallback = new Map()) {
  const map = new Map();
  for (const shape of els(document, 'sp')) {
    const spPr = kid(shape, 'sppr');
    const place = els(shape, 'ph')[0];
    const key = place ? (attr(place, 'idx') || attr(place, 'type') || 'body') : null;
    if (!key) continue;
    const type = place ? attr(place, 'type') || '' : '';
    const inherited = fallback.get(key) || (type ? fallback.get(type) : null);
    const box = transformOf(spPr || shape) || inherited;
    if (!box) continue;
    const body = kid(shape, 'txbody');
    const bodyPr = body ? kid(body, 'bodypr') : null;
    map.set(key, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      anchor: (bodyPr ? attr(bodyPr, 'anchor') : '') || inherited?.anchor || 't',
      type,
    });
  }
  return map;
}

function runHTML(run, defaults) {
  const rPr = kid(run, 'rpr');
  const style = [];
  let text = '';
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    const name = nameOf(child);
    if (name === 't') text += child.textContent || '';
    else if (name === 'br') text += '\n';
  }
  if (!text) return '';
  const size = Number(attr(kid(rPr || run, 'sz'), 'val') || 0) / 100;
  const bold = rPr && kid(rPr, 'b') ? !/^(0|false)$/.test(attr(kid(rPr, 'b'), 'val') || '1') : false;
  const italic = rPr && kid(rPr, 'i') ? !/^(0|false)$/.test(attr(kid(rPr, 'i'), 'val') || '1') : false;
  const color = colorOf(rPr || run);
  if (size) style.push(`font-size:${(size * PT).toFixed(1)}px`);
  else if (defaults.size) style.push(`font-size:${(defaults.size * PT).toFixed(1)}px`);
  if (bold || defaults.bold) style.push('font-weight:700');
  if (italic) style.push('font-style:italic');
  if (color) style.push(`color:${color}`);
  return `<span style="${style.join(';')}">${escapeHtml(text).replace(/\n/g, '<br>')}</span>`;
}

function textBodyHTML(body, defaults) {
  const paragraphs = kids(body, 'p').map((paragraph) => {
    const pPr = kid(paragraph, 'ppr');
    const align = pPr ? attr(pPr, 'algn') : '';
    const level = pPr ? Number(attr(pPr, 'lvl') || 0) : 0;
    const bullet = pPr ? kid(pPr, 'buchar') || kid(pPr, 'buautonum') : null;
    const runs = kids(paragraph, 'r').map((run) => runHTML(run, defaults)).join('')
      || kids(paragraph, 'fld').map((field) => runHTML(field, defaults)).join('');
    const prefix = bullet ? '• ' : '';
    const indent = level ? `margin-left:${level * 22}px;` : '';
    const size = pPr ? Number(attr(kid(pPr, 'defrpr'), 'sz') || 0) / 100 : 0;
    const sizeStyle = size ? `font-size:${(size * PT).toFixed(1)}px;` : '';
    return `<p style="text-align:${align === 'ctr' ? 'center' : align === 'r' ? 'right' : 'left'};${indent}${sizeStyle}">${prefix}${runs || '&nbsp;'}</p>`;
  }).join('');
  return paragraphs;
}

function tableHTML(frame) {
  const table = els(frame, 'tbl')[0];
  if (!table) return '';
  const rows = kids(table, 'tr').map((row) => {
    const cells = kids(row, 'tc').map((cell) => {
      const body = kid(cell, 'txbody');
      const html = body ? textBodyHTML(body, { size: 14 }) : '';
      const fill = colorOf(kid(cell, 'tcpr') || cell);
      return `<td${fill ? ` style="background:${fill}"` : ''}>${html.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '') || '&nbsp;'}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table class="dr-pptx-table"><tbody>${rows}</tbody></table>`;
}

function shapeHTML(shape, state) {
  const spPr = kid(shape, 'sppr');
  let box = transformOf(spPr || shape);
  const place = els(shape, 'ph')[0];
  const key = place ? (attr(place, 'idx') || attr(place, 'type') || 'body') : null;
  const inherited = key ? state.placeholders.get(key) : null;
  if (!box && inherited) box = inherited;
  if (!box) box = { x: 40, y: 40 + state.stack * 90, w: state.width - 80, h: 80 };
  state.stack += 1;

  const type = place ? (attr(place, 'type') || inherited?.type || '') : '';
  const body = kid(shape, 'txbody');
  const defaults = {
    size: /title|ctrtitle/.test(type) || /title/i.test(attr(shape, 'name') || '') ? 32 : 18,
    bold: /title|ctrtitle/.test(type),
  };
  const html = body ? textBodyHTML(body, defaults) : '';
  const bodyPr = body ? kid(body, 'bodypr') : null;
  const anchor = (bodyPr ? attr(bodyPr, 'anchor') : '') || inherited?.anchor || 't';
  const justify = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  const fill = colorOf(spPr || shape);
  const style = [
    `left:${box.x}px`, `top:${box.y}px`, `width:${box.w}px`, `height:${box.h}px`,
    fill ? `background:${fill}` : '',
  ].filter(Boolean).join(';');
  return `<div class="dr-shape" style="${style}"><div class="dr-shape-in" style="justify-content:${justify}">${html}</div></div>`;
}

function pictureHTML(pic, state) {
  const spPr = kid(pic, 'sppr');
  let box = transformOf(spPr || pic);
  const place = els(pic, 'ph')[0];
  if (!box && place) box = state.placeholders.get(attr(place, 'idx') || attr(place, 'type'));
  if (!box) box = { x: 40, y: 60, w: state.width - 80, h: 300 };
  const blip = els(pic, 'blip')[0];
  const url = blip ? state.images.get(attr(blip, 'embed')) : '';
  if (!url) return '';
  const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
  return `<div class="dr-pic" style="${style}"><img src="${url}" alt=""></div>`;
}

function groupHTML(group, state) {
  return kids(group, 'sp').map((shape) => shapeHTML(shape, state)).join('')
    + kids(group, 'pic').map((pic) => pictureHTML(pic, state)).join('')
    + kids(group, 'graphicframe').map((frame) => graphicFrameHTML(frame, state)).join('')
    + kids(group, 'grpsp').map((nested) => groupHTML(nested, state)).join('');
}

function graphicFrameHTML(frame, state) {
  const box = transformOf(frame) || { x: 60, y: 120, w: state.width - 120, h: 320 };
  const inner = tableHTML(frame);
  if (!inner) return '';
  const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;`;
  return `<div class="dr-frame" style="${style}">${inner}</div>`;
}

async function readNotes(zip, slidePath, rels) {
  const notesRel = [...rels.values()].find((rel) => /notesSlide$/i.test(rel.type));
  if (!notesRel) return '';
  const entry = zip.file(notesRel.target);
  if (!entry) return '';
  const doc = xml(await entry.async('string'));
  const texts = [];
  for (const shape of els(doc, 'sp')) {
    const place = els(shape, 'ph')[0];
    const type = place ? attr(place, 'type') : '';
    if (type === 'sldnum') continue;
    const body = kid(shape, 'txbody');
    if (!body) continue;
    const value = kids(body, 'p').map((paragraph) => (paragraph.textContent || '').trim())
      .filter(Boolean).join('\n');
    if (value) texts.push(value);
  }
  return texts.join('\n').trim();
}

export async function openPptx(ctx) {
  const zip = await loadZip(ctx.file);
  const entry = zip.file('ppt/presentation.xml');
  if (!entry) throw new Error('PowerPoint 본문(ppt/presentation.xml)을 찾지 못했습니다.');
  const presentation = xml(await entry.async('string'));
  const sizeNode = els(presentation, 'sldsz')[0];
  const width = px(attr(sizeNode, 'cx')) || 1280;
  const height = px(attr(sizeNode, 'cy')) || 720;

  const rels = await readRels(zip, 'ppt/presentation.xml');
  const slideIds = els(presentation, 'sldid').map((node) => relAttr(node, 'id'));
  const slidePaths = slideIds.map((id) => rels.get(id)?.target).filter(Boolean);
  if (!slidePaths.length) throw new Error('프레젠테이션에 슬라이드가 없습니다.');

  ctx.setToolbar(toolbarHTML({
    left: `<div class="tool-group">
        <button class="tool-btn" type="button" id="dr-slide-prev" aria-label="이전 슬라이드" title="이전 슬라이드">←</button>
        <span class="zoom-label dr-slide-count" id="dr-slide-count">1 / ${slidePaths.length}</span>
        <button class="tool-btn" type="button" id="dr-slide-next" aria-label="다음 슬라이드" title="다음 슬라이드">→</button>
      </div>`,
    right: `<button class="tool-btn text" type="button" id="dr-slide-list-btn">슬라이드 목록</button>
      <button class="tool-btn text" type="button" id="dr-notes-btn">발표자 노트</button>`,
  }));

  const stage = ctx.stage;
  stage.innerHTML = '';
  stage.classList.add('dr-slide-stage');

  const fit = document.createElement('div');
  fit.className = 'dr-slide-fit';
  const canvas = document.createElement('div');
  canvas.className = 'dr-slide-canvas';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  fit.append(canvas);
  const notes = document.createElement('div');
  notes.className = 'dr-notes';
  notes.hidden = true;
  stage.append(fit, notes);

  const listPanel = document.createElement('div');
  listPanel.className = 'dr-slide-list';
  listPanel.hidden = true;
  ctx.result.insertBefore(listPanel, stage);

  const countLabel = ctx.result.querySelector('#dr-slide-count');
  const prevButton = ctx.result.querySelector('#dr-slide-prev');
  const nextButton = ctx.result.querySelector('#dr-slide-next');
  const notesButton = ctx.result.querySelector('#dr-notes-btn');

  const cache = new Map();
  let index = 0;
  let notesText = '';

  const rescale = () => {
    const available = fit.clientWidth || stage.clientWidth - 16;
    const scale = Math.min(1, available / width);
    canvas.style.transform = `scale(${scale})`;
    fit.style.height = `${Math.round(height * scale)}px`;
  };
  const observer = new ResizeObserver(rescale);
  observer.observe(fit);

  function drawList() {
    listPanel.innerHTML = `<div class="dr-slide-grid">${slidePaths.map((_, position) => `
      <button class="dr-slide-jump${position === index ? ' is-current' : ''}" type="button" data-position="${position}">${position + 1}</button>`).join('')}</div>`;
    listPanel.querySelectorAll('.dr-slide-jump').forEach((button) => {
      button.addEventListener('click', () => {
        listPanel.hidden = true;
        show(Number(button.dataset.position));
      }, { signal: ctx.signal });
    });
  }

  async function show(position) {
    index = Math.max(0, Math.min(slidePaths.length - 1, position));
    countLabel.textContent = `${index + 1} / ${slidePaths.length}`;
    prevButton.disabled = index === 0;
    nextButton.disabled = index === slidePaths.length - 1;
    canvas.innerHTML = '<div class="loading"><span class="spinner"></span><span>슬라이드를 그리는 중…</span></div>';

    let data = cache.get(index);
    if (!data) {
      const path = slidePaths[index];
      const slideEntry = zip.file(path);
      if (!slideEntry) throw new Error(`슬라이드 파일이 없습니다: ${path}`);
      const slideDoc = xml(await slideEntry.async('string'));
      const slideRels = await readRels(zip, path);

      // 레이아웃 자리표시자 위치
      const placeholders = new Map();
      const layoutRel = [...slideRels.values()].find((rel) => /slideLayout$/i.test(rel.type));
      if (layoutRel) {
        const layoutEntry = zip.file(layoutRel.target);
        if (layoutEntry) {
          // 자리표시자의 위치는 슬라이드 → 레이아웃 → 마스터 순서로 물려받는다.
          let masterMap = new Map();
          const layoutRels = await readRels(zip, layoutRel.target);
          const masterRel = [...layoutRels.values()].find((rel) => /slideMaster$/i.test(rel.type));
          if (masterRel) {
            const masterEntry = zip.file(masterRel.target);
            if (masterEntry) masterMap = placeholderMap(xml(await masterEntry.async('string')));
          }
          const layoutDoc = xml(await layoutEntry.async('string'));
          for (const [key, value] of placeholderMap(layoutDoc, masterMap)) placeholders.set(key, value);
        }
      }

      const images = new Map();
      const embedIds = new Set(els(slideDoc, 'blip').map((blip) => attr(blip, 'embed')).filter(Boolean));
      for (const id of embedIds) {
        const rel = slideRels.get(id);
        if (!rel || rel.external) continue;
        const url = await blobUrl(zip, rel.target);
        if (url) { images.set(id, url); ctx.addUrl(url); }
      }

      const tree = els(slideDoc, 'sptree')[0];
      const state = { placeholders, images, width, height, stack: 0 };
      const html = tree ? (kids(tree, 'sp').map((shape) => shapeHTML(shape, state)).join('')
        + kids(tree, 'pic').map((pic) => pictureHTML(pic, state)).join('')
        + kids(tree, 'graphicframe').map((frame) => graphicFrameHTML(frame, state)).join('')
        + kids(tree, 'grpsp').map((group) => groupHTML(group, state)).join('')) : '';
      data = { html, notes: await readNotes(zip, path, slideRels) };
      cache.set(index, data);
    }

    canvas.innerHTML = sanitizeBody(data.html || '<p class="dr-blank"></p>');
    stripBadLinks(canvas);
    notesText = data.notes || '';
    notes.hidden = !notesButton.classList.contains('is-on');
    notes.innerHTML = notesText
      ? `<b>발표자 노트</b><div>${escapeHtml(notesText).replace(/\n/g, '<br>')}</div>`
      : '<b>발표자 노트</b><div class="dr-notes-empty">이 슬라이드에는 노트가 없습니다.</div>';
    rescale();
    drawList();
  }

  prevButton.addEventListener('click', () => { show(index - 1).catch((error) => console.error(error)); }, { signal: ctx.signal });
  nextButton.addEventListener('click', () => { show(index + 1).catch((error) => console.error(error)); }, { signal: ctx.signal });
  ctx.result.querySelector('#dr-slide-list-btn').addEventListener('click', () => {
    listPanel.hidden = !listPanel.hidden;
  }, { signal: ctx.signal });
  notesButton.addEventListener('click', () => {
    notesButton.classList.toggle('is-on');
    notes.hidden = !notesButton.classList.contains('is-on');
    rescale();
  }, { signal: ctx.signal });

  ctx.result.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); show(index + 1); }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); show(index - 1); }
  }, { signal: ctx.signal });

  await show(0);
  window.setTimeout(rescale, 30);
  return { destroy() { observer.disconnect(); } };
}
