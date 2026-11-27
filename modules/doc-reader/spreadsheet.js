/**
 * 스프레드시트 렌더러 (v1.26.0) — .xlsx .xls .xlsm .csv .tsv .ods
 *
 * SheetJS(로컬 번들, Apache-2.0)로 읽고 표로 그린다. 시트 탭, 병합 셀, 고정 머리글,
 * 시트 안 찾기(찾은 셀로 이동·강조), 열 너비, 200행씩 나눠 보기.
 */

import { escapeHtml } from '../../js/ui.js';
import { findBarHTML, toolbarHTML } from './findbar.js';
import { readText } from './textdoc.js';

const ROWS_PER_PAGE = 200;
const MAX_COLS = 400;

function widthOf(column) {
  if (!column) return 96;
  const width = Number(column.wpx || (column.wch ? column.wch * 7 + 6 : 0));
  if (!Number.isFinite(width) || width <= 0) return 96;
  return Math.max(52, Math.min(420, Math.round(width)));
}

function escapeCell(value) {
  return escapeHtml(String(value ?? '')).replace(/\n/g, '<br>');
}

export async function openSpreadsheet(ctx) {
  const XLSX = await import('../../vendor/xlsx/xlsx.mjs');
  const ext = ctx.ext;
  const isDelimited = ext === 'csv' || ext === 'tsv' || ext === 'txt';
  let workbook;
  if (isDelimited) {
    const text = await readText(ctx.file);
    workbook = XLSX.read(text, { type: 'string', raw: false, cellDates: true });
  } else {
    const buffer = await ctx.file.arrayBuffer();
    workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: false, cellDates: true, cellNF: true });
  }

  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const range = sheet && sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const rows = sheet && range
      ? XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true })
      : [];
    const merges = (sheet && sheet['!merges'] ? sheet['!merges'] : []).map((merge) => ({
      r1: merge.s.r, c1: merge.s.c, r2: merge.e.r, c2: merge.e.c,
    }));
    const widths = (sheet && sheet['!cols'] ? sheet['!cols'] : []).map(widthOf);
    return { name, rows, merges, widths, columns: range ? range.e.c + 1 : 1 };
  }).filter((sheet) => sheet.rows.length);

  if (!sheets.length) throw new Error('시트에 보여 줄 내용이 없습니다.');

  ctx.setToolbar(toolbarHTML({
    left: findBarHTML('dr-find'),
    right: `<div class="tool-group">
        <button class="tool-btn" type="button" id="dr-page-prev" aria-label="이전 행" title="이전 200행">←</button>
        <span class="zoom-label" id="dr-page-label">1 / 1</span>
        <button class="tool-btn" type="button" id="dr-page-next" aria-label="다음 행" title="다음 200행">→</button>
      </div>`,
  }) + `<div class="dr-sheet-tabs" role="tablist" aria-label="시트">${sheets.map((sheet, position) => `
      <button class="dr-sheet-tab${position === 0 ? ' is-on' : ''}" type="button" role="tab"
        aria-selected="${position === 0 ? 'true' : 'false'}" data-sheet="${position}">${escapeHtml(sheet.name)}</button>`).join('')}</div>`);

  const stage = ctx.stage;
  stage.classList.add('dr-sheet-stage');
  stage.innerHTML = '<div class="dr-sheet-view" id="dr-sheet-view"></div><div class="dr-sheet-info" id="dr-sheet-info"></div>';

  const view = stage.querySelector('#dr-sheet-view');
  const info = stage.querySelector('#dr-sheet-info');
  const pageLabel = ctx.result.querySelector('#dr-page-label');
  const prevButton = ctx.result.querySelector('#dr-page-prev');
  const nextButton = ctx.result.querySelector('#dr-page-next');
  const findInput = ctx.result.querySelector('#dr-find-q');
  const findCount = ctx.result.querySelector('#dr-find-n');

  let sheetIndex = 0;
  let page = 0;
  let matches = [];
  let matchIndex = -1;

  const pageCount = () => Math.max(1, Math.ceil((sheets[sheetIndex].rows.length - 1) / ROWS_PER_PAGE));

  function render() {
    const sheet = sheets[sheetIndex];
    const total = sheet.rows.length;
    const header = sheet.rows[0] || [];
    const bodyRows = sheet.rows.slice(1);
    const start = page * ROWS_PER_PAGE;
    const slice = bodyRows.slice(start, start + ROWS_PER_PAGE);
    const columnCount = Math.min(MAX_COLS, Math.max(
      header.length,
      ...slice.map((row) => row.length),
      sheet.columns,
    ));

    const mergeMap = new Map();
    const covered = new Set();
    for (const merge of sheet.merges) {
      mergeMap.set(`${merge.r1},${merge.c1}`, merge);
      for (let row = merge.r1; row <= merge.r2; row += 1) {
        for (let column = merge.c1; column <= merge.c2; column += 1) {
          if (row === merge.r1 && column === merge.c1) continue;
          covered.add(`${row},${column}`);
        }
      }
    }

    const columns = Array.from({ length: columnCount }, (_, index) =>
      `<col style="width:${sheet.widths[index] || 96}px">`).join('');

    const headCells = Array.from({ length: columnCount }, (_, column) => {
      const key = `0,${column}`;
      if (covered.has(key)) return '';
      const merge = mergeMap.get(key);
      const colspan = merge ? Math.min(merge.c2, columnCount - 1) - column + 1 : 1;
      const value = header[column] ?? '';
      const align = /^[\d,.\-+%()\s]+$/.test(String(value)) && String(value).trim() ? ' class="num"' : '';
      return `<th${colspan > 1 ? ` colspan="${colspan}"` : ''}${align}>${escapeCell(value)}</th>`;
    }).join('');

    const body = slice.map((row, offset) => {
      const rowNumber = start + offset + 1;
      const cells = [];
      for (let column = 0; column < columnCount; column += 1) {
        const key = `${rowNumber},${column}`;
        if (covered.has(key)) continue;
        const merge = mergeMap.get(key);
        const colspan = merge ? Math.min(merge.c2, columnCount - 1) - column + 1 : 1;
        const rowspan = merge ? Math.min(merge.r2, sheet.rows.length - 1) - rowNumber + 1 : 1;
        const value = row[column] ?? '';
        const text = String(value);
        const align = /^[\d,.\-+%()\s]+$/.test(text) && text.trim() ? ' class="num"' : '';
        const spanAttrs = `${colspan > 1 ? ` colspan="${colspan}"` : ''}${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}`;
        cells.push(`<td${align}${spanAttrs} data-r="${rowNumber}" data-c="${column}">${escapeCell(text)}</td>`);
      }
      return `<tr><th class="dr-rowno" scope="row">${rowNumber + 1}</th>${cells.join('')}</tr>`;
    }).join('');

    view.innerHTML = `<table class="dr-sheet" role="grid">
        <colgroup><col class="dr-rownocol">${columns}</colgroup>
        <thead><tr><th class="dr-rowno dr-corner" aria-hidden="true"></th>${headCells}</tr></thead>
        <tbody>${body || `<tr><td colspan="${columnCount + 1}" class="dr-empty-cell">내용이 없습니다.</td></tr>`}</tbody>
      </table>`;

    pageLabel.textContent = `${page + 1} / ${pageCount()}`;
    prevButton.disabled = page <= 0;
    nextButton.disabled = page >= pageCount() - 1;
    const shownFrom = total > 1 ? start + 2 : 0;
    const shownTo = Math.min(total, start + ROWS_PER_PAGE + 1);
    info.textContent = total > 1
      ? `${total.toLocaleString()}행 · ${shownFrom.toLocaleString()}–${shownTo.toLocaleString()}행 표시`
      : '행이 없습니다';

    applyHighlight(false);
  }

  function cellText(rowNumber, column) {
    const row = sheets[sheetIndex].rows[rowNumber];
    return row ? String(row[column] ?? '') : '';
  }

  function computeMatches(query) {
    const needle = query.trim().toLowerCase();
    matches = [];
    matchIndex = -1;
    if (!needle) {
      findCount.textContent = '0/0';
      return;
    }
    const sheet = sheets[sheetIndex];
    for (let row = 1; row < sheet.rows.length; row += 1) {
      const values = sheet.rows[row] || [];
      for (let column = 0; column < values.length; column += 1) {
        if (String(values[column] ?? '').toLowerCase().includes(needle)) matches.push({ row, column });
      }
    }
    findCount.textContent = matches.length ? `1/${matches.length}` : '0/0';
  }

  function applyHighlight(scroll = true) {
    const active = matches[matchIndex];
    const query = findInput ? findInput.value.trim() : '';
    const from = page * ROWS_PER_PAGE + 1;
    const to = from + ROWS_PER_PAGE - 1;
    if (query && matches.length) {
      view.querySelectorAll('td.is-hit, td.is-current').forEach((cell) => cell.classList.remove('is-hit', 'is-current'));
      for (const match of matches) {
        if (match.row < from || match.row > to) continue;
        const cell = view.querySelector(`td[data-r="${match.row}"][data-c="${match.column}"]`);
        if (cell) cell.classList.add('is-hit');
      }
      const target = active ? view.querySelector(`td[data-r="${active.row}"][data-c="${active.column}"]`) : null;
      if (target) {
        target.classList.add('is-current');
        if (scroll) {
          const stageBox = stage.getBoundingClientRect();
          const box = target.getBoundingClientRect();
          if (box.top < stageBox.top + 30 || box.bottom > stageBox.bottom - 10
            || box.left < stageBox.left || box.right > stageBox.right) {
            target.scrollIntoView({ block: 'center', inline: 'center' });
          }
        }
      }
    } else {
      view.querySelectorAll('td.is-hit, td.is-current').forEach((cell) => cell.classList.remove('is-hit', 'is-current'));
    }
  }

  function goToMatch(direction) {
    if (!matches.length) return;
    if (direction === 0) {
      const current = matches.findIndex((match) => {
        const pageOf = Math.floor((match.row - 1) / ROWS_PER_PAGE);
        return pageOf === page;
      });
      matchIndex = current >= 0 ? current : 0;
    } else {
      matchIndex = (matchIndex + direction + matches.length) % matches.length;
    }
    const match = matches[matchIndex];
    const targetPage = Math.floor((match.row - 1) / ROWS_PER_PAGE);
    findCount.textContent = `${matchIndex + 1}/${matches.length}`;
    if (targetPage !== page) {
      page = Math.max(0, Math.min(pageCount() - 1, targetPage));
      render();
    }
    applyHighlight(true);
  }

  findInput?.addEventListener('input', () => {
    computeMatches(findInput.value);
    if (matches.length) goToMatch(0);
    else applyHighlight(false);
  });
  findInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!matches.length) { computeMatches(findInput.value); if (matches.length) goToMatch(0); return; }
      goToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      findInput.value = '';
      matches = [];
      findCount.textContent = '0/0';
      applyHighlight(false);
    }
  });
  ctx.result.querySelector('#dr-find-prev')?.addEventListener('click', () => goToMatch(-1));
  ctx.result.querySelector('#dr-find-next')?.addEventListener('click', () => goToMatch(1));

  prevButton.addEventListener('click', () => { page = Math.max(0, page - 1); render(); }, { signal: ctx.signal });
  nextButton.addEventListener('click', () => { page = Math.min(pageCount() - 1, page + 1); render(); }, { signal: ctx.signal });

  ctx.result.querySelectorAll('.dr-sheet-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      sheetIndex = Number(tab.dataset.sheet);
      page = 0;
      matches = [];
      matchIndex = -1;
      if (findInput) findInput.value = '';
      findCount.textContent = '0/0';
      ctx.result.querySelectorAll('.dr-sheet-tab').forEach((other) => {
        const on = other === tab;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
      render();
    }, { signal: ctx.signal });
  });

  render();
  return {};
}
