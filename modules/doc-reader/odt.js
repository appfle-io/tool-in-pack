/**
 * ODT 렌더러 (v1.26.0) — OpenDocument(.odt) 본문.
 *
 * content.xml 의 text:h / text:p / text:list / table:table / draw:frame 을 읽어
 * 제목·문단·목록·표(병합 셀)·그림을 그리고, 글자 모양은 automatic-styles 를 따라간다.
 */

import { escapeHtml } from '../../js/ui.js';
import { loadZip, xml, els, kids, kid, attr, nameOf, blobUrl } from './ooxml.js';
import { sanitizeBody, stripBadLinks } from './sanitize.js';

const CM = 37.795; // 1cm = 37.795px (96dpi)

function styleProps(styleNode) {
  const props = {};
  const text = kid(styleNode, 'text-properties');
  const paragraph = kid(styleNode, 'paragraph-properties');
  if (text) {
    const weight = attr(text, 'font-weight');
    if (weight === 'bold' || weight === '600' || weight === '700') props.bold = true;
    if (attr(text, 'font-style') === 'italic') props.italic = true;
    const underline = attr(text, 'text-underline-style');
    if (underline && underline !== 'none') props.underline = true;
    if (attr(text, 'text-line-through-style') && attr(text, 'text-line-through-style') !== 'none') props.strike = true;
    const color = attr(text, 'color');
    if (color && /^#[0-9a-f]{6}$/i.test(color)) props.color = color;
    const size = attr(text, 'font-size');
    if (size && /pt$/.test(size)) props.size = size;
  }
  if (paragraph) {
    const align = attr(paragraph, 'text-align');
    if (align) props.align = align;
    const background = attr(paragraph, 'background-color');
    if (background && /^#[0-9a-f]{6}$/i.test(background)) props.background = background;
  }
  return props;
}

async function readStyles(zip, contentDoc) {
  const raw = new Map();
  const collect = (document) => {
    for (const node of els(document, 'style')) {
      const name = attr(node, 'name');
      const family = attr(node, 'family');
      if (!name) continue;
      raw.set(`${family || ''}:${name}`, {
        props: styleProps(node),
        parent: attr(node, 'parent-style-name') || '',
        family: family || '',
      });
    }
  };
  collect(contentDoc);
  const stylesEntry = zip.file('styles.xml');
  if (stylesEntry) collect(xml(await stylesEntry.async('string')));

  const resolved = new Map();
  const resolve = (key, depth = 0) => {
    if (!key || depth > 8) return {};
    if (resolved.has(key)) return resolved.get(key);
    const entry = raw.get(key);
    if (!entry) return {};
    const merged = { ...resolve(`${entry.family}:${entry.parent}`, depth + 1), ...entry.props };
    resolved.set(key, merged);
    return merged;
  };
  for (const key of raw.keys()) resolve(key);
  return (family, name) => resolved.get(`${family}:${name}`) || resolve(`${family}:${name}`) || {};
}

function textStyleAttr(props) {
  const style = [];
  if (props.bold) style.push('font-weight:700');
  if (props.italic) style.push('font-style:italic');
  if (props.underline) style.push('text-decoration:underline');
  if (props.strike) style.push('text-decoration:line-through');
  if (props.color) style.push(`color:${props.color}`);
  if (props.size) style.push(`font-size:${props.size}`);
  return style.length ? ` style="${style.join(';')}"` : '';
}

function imageHTML(frame, state) {
  const image = els(frame, 'image')[0];
  if (!image) return '';
  const href = attr(image, 'href') || '';
  const key = decodeURIComponent(href.replace(/^\.\//, ''));
  const url = state.images.get(key) || state.images.get(href);
  if (!url) return '';
  const width = attr(frame, 'width');
  const height = attr(frame, 'height');
  const style = [
    width && /cm$/.test(width) ? `width:${(parseFloat(width) * CM).toFixed(1)}px` : 'max-width:100%',
    height && /cm$/.test(height) ? `height:auto` : '',
  ].filter(Boolean).join(';');
  return `<img class="dr-odt-img" src="${url}" alt="" style="${style}">`;
}

function renderInline(node, state) {
  let html = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { html += escapeHtml(child.nodeValue); continue; }
    const name = nameOf(child);
    if (name === 'span') {
      const props = state.styleOf('text', attr(child, 'style-name'));
      html += `<span${textStyleAttr(props)}>${renderInline(child, state)}</span>`;
    } else if (name === 's') {
      const count = Number(attr(child, 'c') || 1);
      html += '&nbsp;'.repeat(Math.max(1, Math.min(50, count)));
    } else if (name === 'tab') html += '<span class="dr-tab"></span>';
    else if (name === 'line-break') html += '<br>';
    else if (name === 'a') {
      const href = attr(child, 'href') || '';
      const inner = renderInline(child, state);
      html += /^(https?|mailto):/i.test(href) ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
    } else if (name === 'frame') {
      html += imageHTML(child, state);
    } else if (name === 'note') {
      html += '<sup class="dr-note-ref">*</sup>';
    } else if (name === 'bookmark' || name === 'bookmark-start' || name === 'bookmark-end'
      || name === 'soft-page-break') {
      // 자리 표시는 그리지 않는다.
    } else {
      html += renderInline(child, state);
    }
  }
  return html;
}

function tableHTML(table, state) {
  const rows = [];
  let gridColumns = 0;
  const owner = new Map();

  kids(table, 'table-row').forEach((row, rowIndex) => {
    const cells = [];
    let column = 0;
    for (const cell of kids(row, 'table-cell')) {
      while (owner.has(`${rowIndex},${column}`)) column += 1;
      const span = Math.max(1, Number(attr(cell, 'number-columns-spanned') || 1));
      const rowspan = Math.max(1, Number(attr(cell, 'number-rows-spanned') || 1));
      const model = {
        column,
        span,
        rowspan,
        html: renderBlocks(cell, state, true) || '<p></p>',
        shade: null,
      };
      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        for (let c = column; c < column + span; c += 1) owner.set(`${r},${c}`, model);
      }
      cells.push(model);
      column += span;
      gridColumns = Math.max(gridColumns, column);
    }
    rows.push(cells);
  });

  const body = rows.map((cells) => `<tr>${cells.map((cell) => {
    const attrs = [
      cell.span > 1 ? ` colspan="${cell.span}"` : '',
      cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
    ].join('');
    return `<td${attrs}>${cell.html}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="dr-odt-table"><tbody>${body}</tbody></table>`;
}

function renderBlocks(container, state, inCell = false) {
  const out = [];
  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const name = nameOf(child);
    if (name === 'h') {
      const level = Math.min(6, Math.max(1, Number(attr(child, 'outline-level') || 1)));
      const props = state.styleOf('paragraph', attr(child, 'style-name'));
      out.push(`<h${level}${textStyleAttr(props)}>${renderInline(child, state)}</h${level}>`);
    } else if (name === 'p') {
      const props = state.styleOf('paragraph', attr(child, 'style-name'));
      const inner = renderInline(child, state);
      const style = [];
      if (props.align) style.push(`text-align:${props.align}`);
      if (props.background) style.push(`background:${props.background}`);
      if (props.size) style.push(`font-size:${props.size}`);
      if (!inner.trim() && !inner.includes('<img')) { out.push('<p class="dr-blank"></p>'); continue; }
      out.push(`<p${style.length ? ` style="${style.join(';')}"` : ''}>${inner}</p>`);
    } else if (name === 'list') {
      const items = kids(child, 'list-item').map((item) => {
        const content = renderBlocks(item, state, inCell);
        return `<li>${content || '&nbsp;'}</li>`;
      }).join('');
      out.push(`<ul class="dr-list">${items}</ul>`);
    } else if (name === 'table') {
      out.push(tableHTML(child, state));
    } else if (name === 'section') {
      out.push(renderBlocks(child, state, inCell));
    } else if (name === 'soft-page-break') {
      if (out.length && !inCell) out.push('<hr class="pagebreak">');
    } else if (name === 'frame') {
      out.push(imageHTML(child, state));
    }
  }
  return out.filter(Boolean).join('');
}

export async function openOdt(ctx) {
  const zip = await loadZip(ctx.file);
  const entry = zip.file('content.xml');
  if (!entry) throw new Error('ODT 본문(content.xml)을 찾지 못했습니다.');
  const doc = xml(await entry.async('string'));
  const styleOf = await readStyles(zip, doc);

  const pictures = els(doc, 'image').map((image) => attr(image, 'href') || '').filter(Boolean);
  const images = new Map();
  for (const href of new Set(pictures)) {
    const path = decodeURIComponent(href.replace(/^\.\//, ''));
    const url = await blobUrl(zip, path);
    if (url) { images.set(path, url); images.set(href, url); ctx.addUrl(url); }
  }

  const body = els(doc, 'text')[0] || doc.documentElement;
  const html = renderBlocks(body, { styleOf, images });
  const clean = sanitizeBody(html || '<p class="dr-blank"></p>');

  ctx.stage.classList.add('dr-paper', 'dr-odt');
  ctx.stage.innerHTML = clean;
  stripBadLinks(ctx.stage);
  if (!ctx.stage.textContent.trim() && !ctx.stage.querySelector('img')) {
    throw new Error('문서에 보여 줄 내용이 없습니다(빈 문서일 수 있습니다).');
  }
  return {};
}
