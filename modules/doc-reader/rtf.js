/**
 * RTF 렌더러 (v1.26.0) — 서식 있는 텍스트(.rtf).
 *
 * RTF 는 그룹({...})과 제어어(\b, \par …)로 이루어진다. 그룹마다 서식 상태를 쌓고,
 * 글자는 현재 상태(굵게·기울임·밑줄·크기·색·정렬)로 감싼다. 표(\trowd … \cell … \row)는
 * HTML 표로, 한글은 \ansicpg949 / \'hh 바이트를 EUC-KR 로 풀어 읽는다.
 */

import { escapeHtml } from '../../js/ui.js';
import { sanitizeBody, stripBadLinks } from './sanitize.js';

const CODEPAGES = { 949: 'euc-kr', 1252: 'windows-1252', 65001: 'utf-8', 932: 'shift_jis', 936: 'gbk' };

const DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'footer', 'headerl',
  'headerr', 'footerl', 'footerr', 'footnote', 'fldinst', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'datastore', 'latentstyles',
  'filetbl', 'revtbl', 'pnseclvl', 'listtext', 'pntext', 'pntxta', 'pntxtb', 'nonshppict', 'field',
]);

function baseState() {
  return {
    bold: false, italic: false, underline: false, strike: false, hidden: false,
    size: 0, color: null, font: '', align: '',
  };
}

/** \word 로 시작하는 그룹을 통째로 잘라 낸다(중괄호 세기). */
function extractBlock(source, wordAt) {
  let open = source.lastIndexOf('{', wordAt);
  if (open < 0) open = wordAt;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return source.slice(open);
}

function readColorTable(source) {
  const at = source.indexOf('\\colortbl');
  if (at < 0) return [];
  const block = extractBlock(source, at);
  return block.replace(/^\{\\colortbl/, '').replace(/\}$/, '').split(';').map((token) => {
    const red = /\\red(\d+)/.exec(token);
    const green = /\\green(\d+)/.exec(token);
    const blue = /\\blue(\d+)/.exec(token);
    if (!red || !green || !blue) return null;
    const hex = (value) => Number(value).toString(16).padStart(2, '0');
    return `#${hex(red[1])}${hex(green[1])}${hex(blue[1])}`;
  });
}

function readFontTable(source) {
  const at = source.indexOf('\\fonttbl');
  if (at < 0) return [];
  const block = extractBlock(source, at);
  const fonts = [];
  for (const match of block.matchAll(/\\f(\d+)([^;{}]*);/g)) {
    const name = match[2].replace(/\\[a-z]+\d* ?/gi, '').replace(/[{}]/g, '').trim();
    fonts[Number(match[1])] = name;
  }
  return fonts;
}

export function renderRtf(source) {
  let codepage = 1252;
  const colors = readColorTable(source);
  const fonts = readFontTable(source);
  let ucSkip = 1;
  let ucPending = 0;

  let index = 0;
  const length = source.length;

  let state = baseState();
  const stack = [];
  let skipping = 0;
  let depth = 0;

  const blocks = [];
  let paragraph = '';
  let inTable = false;
  let tableRows = [];
  let cells = [];
  let cellBuffer = '';
  let pendingBytes = [];
  let textBuffer = '';
  let cellClosed = false;

  const span = (text) => {
    if (!text || state.hidden) return '';
    const style = [];
    if (state.bold) style.push('font-weight:700');
    if (state.italic) style.push('font-style:italic');
    if (state.underline) style.push('text-decoration:underline');
    if (state.strike) style.push('text-decoration:line-through');
    if (state.size) style.push(`font-size:${(state.size / 2).toFixed(1)}pt`);
    if (state.color) style.push(`color:${state.color}`);
    if (/courier|consolas|mono/i.test(state.font)) style.push('font-family:ui-monospace,Menlo,monospace');
    return style.length ? `<span style="${style.join(';')}">${text}</span>` : text;
  };

  const append = (html) => {
    if (inTable) cellBuffer += html;
    else paragraph += html;
  };

  const flushBytes = () => {
    if (!pendingBytes.length) return;
    let decoder;
    try { decoder = new TextDecoder(CODEPAGES[codepage] || 'windows-1252'); }
    catch { decoder = new TextDecoder('windows-1252'); }
    const text = decoder.decode(new Uint8Array(pendingBytes));
    pendingBytes = [];
    if (text) append(span(escapeHtml(text)));
  };

  const flushText = () => {
    if (!textBuffer) { flushBytes(); return; }
    flushBytes();
    append(span(escapeHtml(textBuffer)));
    textBuffer = '';
  };

  const pushText = (character) => {
    if (ucPending > 0) { ucPending -= 1; return; }
    // latin1 로 읽은 128 이상 글자는 원래 바이트다 — nsicpg 로 풀어야 한글이 산다.
    if (character.charCodeAt(0) > 127) { pushByte(character.charCodeAt(0)); return; }
    if (pendingBytes.length) flushBytes();
    textBuffer += character;
  };

  const pushByte = (byte) => {
    if (textBuffer) { append(span(escapeHtml(textBuffer))); textBuffer = ''; }
    pendingBytes.push(byte);
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    blocks.push(`<table class="dr-rtf-table"><tbody>${tableRows.join('')}</tbody></table>`);
    tableRows = [];
  };

  const flushParagraph = () => {
    flushText();
    const html = paragraph.trim();
    paragraph = '';
    if (!html) return;
    flushTable();
    const align = state.align ? ` style="text-align:${state.align}"` : '';
    blocks.push(/^<(table|hr|ul|ol|div)/.test(html) ? html : `<p${align}>${html}</p>`);
  };

  const flushCell = () => {
    flushText();
    cells.push(cellBuffer);
    cellBuffer = '';
    cellClosed = true;
  };

  const flushRow = () => {
    if (!cellClosed) flushCell();
    const row = cells.map((cell) => `<td>${cell || '&nbsp;'}</td>`).join('');
    tableRows.push(`<tr>${row}</tr>`);
    cells = [];
    cellClosed = false;
    inTable = false;
  };

  while (index < length) {
    const character = source[index];

    if (character === '{') {
      depth += 1;
      index += 1;
      if (!skipping) stack.push({ ...state });
      continue;
    }
    if (character === '}') {
      const wasSkipping = !!skipping;
      if (skipping && depth <= skipping) skipping = 0;
      depth -= 1;
      index += 1;
      if (!wasSkipping && stack.length) state = stack.pop();
      continue;
    }
    if (character === '\r' || character === '\n') { index += 1; continue; }

    if (character !== '\\') {
      if (!skipping) pushText(character);
      index += 1;
      continue;
    }

    index += 1;
    const next = source[index];
    if (next === undefined) break;

    if (next === '*') {
      index += 1;
      if (!skipping) skipping = depth;
      continue;
    }

    if (!/[a-z]/i.test(next)) {
      index += 1;
      if (skipping) continue;
      if (next === "'") {
        const hex = source.slice(index, index + 2);
        index += 2;
        const byte = parseInt(hex, 16);
        if (Number.isFinite(byte)) pushByte(byte);
      } else if (next === '\\' || next === '{' || next === '}') {
        flushText();
        append(span(escapeHtml(next)));
      } else if (next === '~') {
        flushText();
        append('&nbsp;');
      } else if (next === '_' || next === '-') {
        flushText();
        append(next === '_' ? '&#8209;' : '&shy;');
      } else if (next === '\n' || next === '\r') {
        flushParagraph();
      }
      continue;
    }

    let name = '';
    while (index < length && /[a-z]/i.test(source[index])) { name += source[index]; index += 1; }
    let parameterText = '';
    if (source[index] === '-') { parameterText += '-'; index += 1; }
    while (index < length && /[0-9]/.test(source[index])) { parameterText += source[index]; index += 1; }
    if (source[index] === ' ') index += 1;
    const parameter = parameterText ? Number(parameterText) : null;

    if (skipping) {
      if (name === 'bin' && parameter) index += Math.max(0, parameter);
      continue;
    }
    if (DESTINATIONS.has(name)) { skipping = depth; continue; }
    if (name === 'bin') { index += Math.max(0, parameter || 0); continue; }

    switch (name) {
      case 'ansicpg': if (parameter) codepage = parameter; break;
      case 'uc': if (parameter !== null) ucSkip = parameter; break;
      case 'u': {
        flushText();
        const code = parameter !== null ? parameter : 0;
        append(span(escapeHtml(String.fromCharCode(code < 0 ? code + 65536 : code))));
        ucPending = ucSkip;
        break;
      }
      case 'b': state = { ...state, bold: parameter !== 0 }; break;
      case 'i': state = { ...state, italic: parameter !== 0 }; break;
      case 'ul': state = { ...state, underline: parameter !== 0 }; break;
      case 'ulnone': state = { ...state, underline: false }; break;
      case 'strike': case 'striked': state = { ...state, strike: parameter !== 0 }; break;
      case 'v': state = { ...state, hidden: parameter !== 0 }; break;
      case 'fs': if (parameter) state = { ...state, size: parameter }; break;
      case 'cf': state = { ...state, color: colors[parameter || 0] || null }; break;
      case 'f': state = { ...state, font: fonts[parameter || 0] || '' }; break;
      case 'qc': state = { ...state, align: 'center' }; break;
      case 'qr': state = { ...state, align: 'right' }; break;
      case 'qj': state = { ...state, align: 'justify' }; break;
      case 'ql': state = { ...state, align: '' }; break;
      case 'par': case 'sect': case 'page': flushText(); flushParagraph(); break;
      case 'line': flushText(); append('<br>'); break;
      case 'tab': flushText(); append('<span class="dr-tab"></span>'); break;
      case 'emdash': flushText(); append('&#8212;'); break;
      case 'endash': flushText(); append('–'); break;
      case 'lquote': flushText(); append('‘'); break;
      case 'rquote': flushText(); append('’'); break;
      case 'ldblquote': flushText(); append('“'); break;
      case 'rdblquote': flushText(); append('”'); break;
      case 'bullet': flushText(); append('•'); break;
      case 'pard': state = { ...state, align: '' }; break;
      case 'trowd': flushParagraph(); inTable = true; cells = []; cellBuffer = ''; cellClosed = false; break;
      case 'cell': flushCell(); break;
      case 'row': flushRow(); break;
      case 'intbl': inTable = true; break;
      case 'nestcell': flushCell(); break;
      case 'nestrow': flushRow(); break;
      default: break;
    }
  }

  flushText();
  flushParagraph();
  if (inTable && (cells.length || cellBuffer)) flushRow();
  flushTable();

  return blocks.join('\n');
}

export async function openRtf(ctx) {
  const buffer = await ctx.file.arrayBuffer();
  // RTF 는 ASCII + 코드페이지 바이트다 — latin1 로 읽어 바이트를 그대로 살린다.
  const source = new TextDecoder('latin1').decode(buffer);
  const html = renderRtf(source);
  const clean = sanitizeBody(html || '<p class="dr-blank"></p>');
  ctx.stage.classList.add('dr-paper', 'dr-rtf');
  ctx.stage.innerHTML = clean;
  stripBadLinks(ctx.stage);
  if (!ctx.stage.textContent.trim() && !ctx.stage.querySelector('img')) {
    throw new Error('RTF 문서에 보여 줄 내용이 없습니다.');
  }
  return {};
}
