/**
 * DOCX 렌더러 (v1.26.0) — Word(.docx) 본문을 HTML 로.
 *
 * 문단·제목·목록·표(병합 셀)·내장 이미지·기본 서식(굵게/기울임/밑줄/색/크기/취소선/위아래첨자)을
 * 그린다. 만든 HTML 은 sanitizeBody 를 지나 script·onerror·javascript: 가 남지 않는다.
 */

import { escapeHtml } from '../../js/ui.js';
import { loadZip, xml, els, kids, kid, attr, readRels, blobUrl, nameOf } from './ooxml.js';
import { sanitizeBody, stripBadLinks } from './sanitize.js';

const EMU = 9525; // 1px = 9525 EMU (96dpi)
const TWIP = 15;  // 1px = 15 twip

function styleName(node) {
  const name = kid(node, 'name');
  return (attr(name, 'val') || '').toLowerCase();
}

function styleProps(style) {
  const pPr = kid(style, 'pPr');
  const rPr = kid(style, 'rPr');
  const outlineRaw = pPr ? attr(kid(pPr, 'outlineLvl'), 'val') : null;
  const outline = outlineRaw === null ? NaN : Number(outlineRaw);
  const numPr = pPr ? kid(pPr, 'numpr') : null;
  const name = styleName(style);
  let heading = 0;
  const numbered = /heading\s*([1-6])/.exec(name) || /^제목\s*([1-6])$/.exec(name);
  if (numbered) heading = Number(numbered[1]);
  else if (name === 'title' || name === '제목') heading = 1;
  else if (Number.isFinite(outline) && outline < 6) heading = outline + 1;
  return {
    name,
    heading,
    align: pPr ? attr(kid(pPr, 'jc'), 'val') : null,
    numId: numPr ? attr(kid(numPr, 'numid'), 'val') : null,
    ilvl: numPr ? Number(attr(kid(numPr, 'ilvl'), 'val') || 0) : null,
    bold: !!kid(rPr, 'b'),
    italic: !!kid(rPr, 'i'),
    color: rPr ? attr(kid(rPr, 'color'), 'val') : null,
    size: rPr ? Number(attr(kid(rPr, 'sz'), 'val') || 0) / 2 : 0,
  };
}

/** 스타일은 basedOn 으로 이어진다 — 목록 번호(numPr)도 스타일에서 물려받는다. */
async function readStyles(zip) {
  const raw = new Map();
  const entry = zip.file('word/styles.xml');
  if (!entry) return {};
  const doc = xml(await entry.async('string'));
  for (const style of els(doc, 'style')) {
    const id = attr(style, 'styleid');
    if (!id) continue;
    raw.set(id, { basedOn: attr(kid(style, 'basedOn'), 'val') || '', props: styleProps(style) });
  }
  const resolved = new Map();
  const resolve = (id, depth = 0) => {
    if (!id || depth > 8 || !raw.has(id)) return {};
    if (resolved.has(id)) return resolved.get(id);
    const entryValue = raw.get(id);
    const base = resolve(entryValue.basedOn, depth + 1);
    const own = entryValue.props;
    const merged = { ...base, ...own };
    // 값이 비어 있는 항목은 물려받은 값을 지우지 않는다.
    for (const key of ['heading', 'size', 'numId', 'ilvl']) {
      if (!own[key] && base[key]) merged[key] = base[key];
    }
    if (!own.name) merged.name = base.name || '';
    resolved.set(id, merged);
    return merged;
  };
  for (const id of raw.keys()) resolve(id);
  const out = {};
  for (const [id, value] of resolved) out[id] = value;
  return out;
}

async function readNumbering(zip) {
  const formats = {};
  const entry = zip.file('word/numbering.xml');
  if (!entry) return formats;
  const doc = xml(await entry.async('string'));
  const abstract = {};
  for (const node of els(doc, 'abstractnum')) {
    const id = attr(node, 'abstractnumid');
    const levels = {};
    for (const level of kids(node, 'lvl')) {
      const index = Number(attr(level, 'ilvl') || 0);
      levels[index] = attr(kid(level, 'numfmt'), 'val') || 'bullet';
    }
    abstract[id] = levels;
  }
  for (const node of els(doc, 'num')) {
    const id = attr(node, 'numid');
    const ref = attr(kid(node, 'abstractnumid'), 'val');
    formats[id] = abstract[ref] || {};
  }
  return formats;
}

/* ------------------------------- runs -------------------------------- */

function hexColor(value) {
  const hex = String(value || '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`;
  return '';
}

function runStyle(rPr) {
  const style = [];
  const classes = [];
  if (!rPr) return { style: '', classes };
  const on = (name) => {
    const node = kid(rPr, name);
    if (!node) return false;
    const value = attr(node, 'val');
    return !(value === '0' || value === 'false' || value === 'none');
  };
  if (on('b')) style.push('font-weight:700');
  if (on('i')) style.push('font-style:italic');
  if (on('strike') || on('dstrike')) classes.push('dr-strike');
  const underline = kid(rPr, 'u');
  if (underline && attr(underline, 'val') !== 'none') style.push('text-decoration:underline');
  const color = hexColor(attr(kid(rPr, 'color'), 'val'));
  if (color) style.push(`color:${color}`);
  const size = Number(attr(kid(rPr, 'sz'), 'val'));
  if (size) style.push(`font-size:${(size / 2).toFixed(1)}pt`);
  const highlight = attr(kid(rPr, 'highlight'), 'val');
  const shade = hexColor(attr(kid(rPr, 'shd'), 'fill'));
  if (highlight) {
    const colors = {
      yellow: '#fff59d', green: '#b9f6ca', cyan: '#b2ebf2', magenta: '#f8bbd0', red: '#ffcdd2',
      blue: '#bbdefb', gray: '#e0e0e0', lightgray: '#eeeeee', darkgray: '#bdbdbd', black: '#000000',
      white: '#ffffff',
    };
    style.push(`background:${colors[highlight] || '#fff59d'}`);
  } else if (shade) {
    style.push(`background:${shade}`);
  }
  const vert = attr(kid(rPr, 'vertalign'), 'val');
  if (vert === 'superscript') classes.push('dr-sup');
  else if (vert === 'subscript') classes.push('dr-sub');
  return { style: style.join(';'), classes };
}

function imageHTML(drawing, state) {
  const blip = els(drawing, 'blip')[0];
  const id = blip ? attr(blip, 'embed') || attr(blip, 'link') : '';
  const url = id ? state.images.get(id) : '';
  if (!url) return '';
  const extent = els(drawing, 'extent')[0];
  const width = extent ? Math.round(Number(attr(extent, 'cx') || 0) / EMU) : 0;
  const widthStyle = width ? ` style="width:${Math.min(width, 760)}px"` : '';
  return `<img class="dr-docx-img" src="${url}" alt=""${widthStyle}>`;
}

function renderRun(run, state) {
  const { style, classes } = runStyle(kid(run, 'rPr'));
  let inner = '';
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { inner += escapeHtml(child.nodeValue); continue; }
    const name = nameOf(child);
    if (name === 't') inner += escapeHtml(child.textContent || '');
    else if (name === 'tab') inner += '<span class="dr-tab"></span>';
    else if (name === 'br') {
      inner += attr(child, 'type') === 'page' ? PAGE_MARK : '<br>';
    } else if (name === 'cr') inner += '<br>';
    else if (name === 'drawing') inner += imageHTML(child, state);
    else if (name === 'pict') { /* 구형 그림 — 건너뛴다 */ }
    else if (name === 'noBreakHyphen') inner += '-';
    else if (name === 'sym') {
      const code = Number(attr(child, 'char'));
      if (Number.isFinite(code)) inner += escapeHtml(String.fromCharCode(code));
    } else if (name === 'footnoteReference' || name === 'endnoteReference') {
      inner += '<sup class="dr-note-ref">*</sup>';
    }
  }
  if (!inner) return '';
  const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
  const styleAttr = style ? ` style="${style}"` : '';
  return `<span${classAttr}${styleAttr}>${inner}</span>`;
}

function renderInline(node, state) {
  let html = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { html += escapeHtml(child.nodeValue); continue; }
    const name = nameOf(child);
    if (name === 'r') html += renderRun(child, state);
    else if (name === 'hyperlink') {
      const rel = state.rels.get(attr(child, 'id'));
      const inner = renderInline(child, state);
      if (rel && rel.external && /^(https?|mailto):/i.test(rel.target)) {
        html += `<a href="${escapeHtml(rel.target)}">${inner}</a>`;
      } else if (rel && attr(child, 'anchor')) {
        html += `<span class="dr-anchor">${inner}</span>`;
      } else html += inner;
    } else if (name === 'ins' || name === 'smarttag' || name === 'sdt' || name === 'sdtcontent'
      || name === 'fldsimple' || name === 'bookmarkstart' || name === 'bookmarkend') {
      html += renderInline(child, state);
    } else if (name === 'r' || name === 'customXml') {
      html += renderInline(child, state);
    } else if (name === 'del' || name === 'movefrom' || name === 'instrtext') {
      // 지운 글자·필드 코드는 보이지 않는다.
    } else if (name === 'p') {
      html += `<br>${renderInline(child, state)}`;
    }
  }
  return html;
}

/* ------------------------------ tables ------------------------------- */

function cellHTML(tc, state) {
  const blocks = renderBlocks(tc, state, { inCell: true });
  return blocks || '<p></p>';
}

function renderTable(tbl, state) {
  const rows = kids(tbl, 'tr');
  const owner = new Map(); // "행,열" → 그 자리를 차지한 셀 모델
  const models = [];

  rows.forEach((tr, rowIndex) => {
    const model = [];
    let column = 0;
    for (const tc of kids(tr, 'tc')) {
      while (owner.has(`${rowIndex},${column}`)) column += 1;
      const tcPr = kid(tc, 'tcPr');
      const span = Math.max(1, Number(attr(kid(tcPr, 'gridspan'), 'val') || 1));
      const vMerge = kid(tcPr, 'vmerge');
      const continuing = vMerge && (attr(vMerge, 'val') || 'continue') === 'continue';
      const upper = owner.get(`${rowIndex - 1},${column}`);
      if (continuing && upper) {
        upper.rowspan += 1;
        for (let index = 0; index < span; index += 1) owner.set(`${rowIndex},${column + index}`, upper);
      } else {
        const cell = {
          column,
          span,
          rowspan: 1,
          shade: hexColor(attr(kid(tcPr, 'shd'), 'fill')),
          html: cellHTML(tc, state),
        };
        model.push(cell);
        for (let index = 0; index < span; index += 1) owner.set(`${rowIndex},${column + index}`, cell);
      }
      column += span;
    }
    models.push(model);
  });

  const width = attr(kid(kid(tbl, 'tblPr') || tbl, 'tblw'), 'w');
  const widthStyle = width && Number(width) > 0
    ? ` style="max-width:${Math.min(760, Math.round(Number(width) / TWIP))}px"` : '';
  const body = models.map((model) => {
    const cells = model.map((cell) => {
      const attrs = [
        cell.span > 1 ? ` colspan="${cell.span}"` : '',
        cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
        cell.shade ? ` style="background:${cell.shade}"` : '',
      ].join('');
      return `<td${attrs}>${cell.html}</td>`;
    }).join('');
    return `<tr>${cells || '<td></td>'}</tr>`;
  }).join('');

  return `<table class="dr-docx-table"${widthStyle}><tbody>${body}</tbody></table>`;
}

/* ---------------------------- paragraphs ----------------------------- */

function paragraphInfo(p, state) {
  const pPr = kid(p, 'pPr');
  const styleId = attr(kid(pPr, 'pstyle'), 'val') || '';
  const style = state.styles[styleId] || {};
  let heading = style.heading || 0;
  const outline = pPr ? attr(kid(pPr, 'outlinelvl'), 'val') : null;
  if (!heading && outline !== null) heading = Number(outline) + 1;
  if (!heading && /^(title|제목)$/.test(style.name || '')) heading = 1;
  const align = attr(kid(pPr, 'jc'), 'val') || style.align || '';
  const numPr = kid(pPr, 'numpr');
  const numId = (numPr ? attr(kid(numPr, 'numid'), 'val') : null) || style.numId || null;
  const ilvl = numPr ? Number(attr(kid(numPr, 'ilvl'), 'val') || 0) : (style.ilvl || 0);
  return { style, heading, align, numId, ilvl };
}

const ALIGN = { center: 'center', right: 'right', both: 'justify', justify: 'justify' };

const PAGE_MARK = '<span class="dr-pagebreak"></span>';

function paragraphHTML(p, state) {
  const info = paragraphInfo(p, state);
  const inner = renderInline(p, state);
  if (inner.includes(PAGE_MARK)) {
    const out = [];
    inner.split(PAGE_MARK).forEach((piece, index) => {
      const cleaned = piece.replace(/<span><\/span>/g, '').trim();
      const hasContent = cleaned && (cleaned.replace(/<[^>]+>/g, '').trim() || /<img/i.test(cleaned));
      if (index > 0) out.push('<hr class="pagebreak">');
      if (hasContent) out.push(info.heading
        ? `<h${Math.min(6, Math.max(1, info.heading))}>${cleaned}</h${Math.min(6, Math.max(1, info.heading))}>`
        : `<p>${cleaned}</p>`);
    });
    return out.join('');
  }
  const style = [
    info.align && ALIGN[info.align] ? `text-align:${ALIGN[info.align]}` : '',
    info.style.color ? `color:${hexColor(info.style.color)}` : '',
    info.style.size ? `font-size:${info.style.size}pt` : '',
  ].filter(Boolean).join(';');

  if (info.heading) {
    const level = Math.min(6, Math.max(1, info.heading));
    return `<h${level}${style ? ` style="${style}"` : ''}>${inner || '&nbsp;'}</h${level}>`;
  }
  if (!inner.trim()) return '<p class="dr-blank"></p>';
  return `<p${style ? ` style="${style}"` : ''}>${inner}</p>`;
}

/* ------------------------------ blocks ------------------------------- */

function listFormat(state, numId, ilvl) {
  const levels = state.numbering[numId] || {};
  const format = levels[ilvl] || 'bullet';
  return format === 'bullet' || format === 'none' ? 'ul' : 'ol';
}

export function renderBlocks(container, state, { inCell = false } = {}) {
  const out = [];
  let list = null;

  const flush = () => {
    if (!list) return;
    out.push(`<${list.tag} class="dr-list">${list.items.join('')}</${list.tag}>`);
    list = null;
  };

  const visit = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const name = nameOf(child);
      if (name === 'p') {
        const info = paragraphInfo(child, state);
        if (info.numId) {
          const tag = listFormat(state, info.numId, info.ilvl);
          if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
          list.items.push(`<li style="--lvl:${info.ilvl}">${renderInline(child, state) || '&nbsp;'}</li>`);
          continue;
        }
        flush();
        out.push(paragraphHTML(child, state));
      } else if (name === 'tbl') {
        flush();
        out.push(renderTable(child, state));
      } else if (name === 'sdt') {
        visit(kid(child, 'sdtcontent') || child);
      } else if (name === 'sectpr') {
        // 마지막 구역의 용지 설정 — 쪽 나눔이 아니다.
        flush();
      } else if (name === 'customxml' || name === 'smarttag') {
        visit(child);
      } else if (name === 'altchunk') {
        // 다른 형식 덩어리 — 이 리더는 풀지 않는다.
      }
    }
  };

  visit(container);
  flush();
  if (inCell && !out.length) return '';
  return out.join('');
}

export async function openDocx(ctx) {
  const zip = await loadZip(ctx.file);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Word 문서 본문(word/document.xml)을 찾지 못했습니다.');
  const [rels, styles, numbering] = await Promise.all([
    readRels(zip, 'word/document.xml'),
    readStyles(zip),
    readNumbering(zip),
  ]);
  const documentXml = xml(await entry.async('string'));
  const body = els(documentXml, 'body')[0] || documentXml.documentElement;

  // 문서가 쓰는 그림만 미리 blob URL 로 만든다.
  const images = new Map();
  const ids = new Set(els(body, 'blip').map((blip) => attr(blip, 'embed')).filter(Boolean));
  for (const id of ids) {
    const rel = rels.get(id);
    if (!rel || rel.external) continue;
    const url = await blobUrl(zip, rel.target);
    if (url) { images.set(id, url); ctx.addUrl(url); }
  }

  const html = renderBlocks(body, { rels, styles, numbering, images });
  const clean = sanitizeBody(html || '<p class="dr-blank"></p>');

  ctx.stage.classList.add('dr-paper', 'dr-docx');
  ctx.stage.innerHTML = clean;
  stripBadLinks(ctx.stage);
  ctx.stage.querySelectorAll('.dr-pagebreak').forEach((mark) => {
    const rule = document.createElement('hr');
    rule.className = 'pagebreak';
    mark.replaceWith(rule);
  });
  if (!ctx.stage.textContent.trim() && !ctx.stage.querySelector('img')) {
    throw new Error('문서에 보여 줄 내용이 없습니다(빈 문서일 수 있습니다).');
  }
  return {};
}
