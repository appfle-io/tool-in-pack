/**
 * HWPX (한글 markup, zip 패키지) renderer.
 *
 * HWPX는 ZIP: Contents/section*.xml 이 본문(문단 <hp> 목록).
 * JSZip으로 해제하고 DOMParser로 파싱해 정리된 HTML로 변환한다.
 * 네임스페이스 접두어(hp:) 유무와 관계없이 localName 기준으로 읽는다.
 */

/* extended controls we render */
const CTRL = { TABLE: 'tbl', LINE_BREAK: 'br', TAB: 'tab', CHAR: 'char' };

function tag(node) {
  return (node.localName || node.nodeName || '').toLowerCase();
}

function kids(node, name) {
  return Array.from(node.children || []).filter((child) => tag(child) === name);
}

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ------------------------------- runs --------------------------------- */

function renderRun(node) {
  const out = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(esc(child.nodeValue || ''));
      continue;
    }
    const name = tag(child);
    if (name === 'br') out.push('<br>');
    else if (name === 'tab') out.push('　');
    else if (name === 'char') {
      const value = Number(child.getAttribute('Char'));
      if (value === 13) out.push('<br>');
      else if (value === 9) out.push('　');
      else if (value < 32) out.push(' ');
      else out.push(esc(String.fromCodePoint(value)));
    } else if (name === 't') {
      // <T> text element inside a run
      out.push(esc(child.textContent || ''));
    } else {
      out.push(renderRun(child));
    }
  }
  return out.join('');
}

/* ------------------------------ controls ------------------------------ */

function renderTable(tbl) {
  const rows = kids(tbl, 'tr').concat(kids(tbl, 'htr'));
  const html = rows.map((tr) => {
    const cells = kids(tr, 'tc').concat(kids(tr, 'htc')).map((tc) => {
      const body = kids(tc, 'hp').map((p) => renderParagraph(p, true)).join('') || '<p></p>';
      const colspan = Number(tc.getAttribute('colSpan') || 1);
      const rowspan = Number(tc.getAttribute('rowSpan') || 1);
      return `<td colspan="${colspan}" rowspan="${rowspan}">${body}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  return `<table><tbody>${html.join('')}</tbody></table>`;
}

function renderControl(node) {
  const name = tag(node);
  if (name === CTRL.TABLE || name === 'htable') return renderTable(node);
  if (name === 'pic' || name === 'hpicture') {
    const ref = node.getAttribute('binaryItemIDRef') || node.getAttribute('BinItemIDRef') || '';
    if (ref) return `<img data-binref="${esc(ref)}" alt="">`;
    return '';
  }
  // container controls (ctrl/obj): render tables or paragraphs inside
  const innerTbl = Array.from(node.querySelectorAll('*')).find((n) => tag(n) === 'tbl');
  if (innerTbl) return renderTable(innerTbl);
  const innerParas = Array.from(node.querySelectorAll('*')).filter((n) => tag(n) === 'hp');
  if (innerParas.length) return innerParas.map((p) => renderParagraph(p, true)).join('');
  return '';
}

/* ----------------------------- paragraphs ----------------------------- */

function renderParagraph(p, inline = false) {
  const parts = [];
  for (const child of Array.from(p.children)) {
    const name = tag(child);
    if (name === 'run' || name === 'hrun') {
      parts.push(renderRun(child));
    } else if (name === CTRL.LINE_BREAK) {
      parts.push('<br>');
    } else if (name === CTRL.TAB) {
      parts.push('　');
    } else {
      const control = renderControl(child);
      if (control) parts.push(control);
    }
  }
  const joined = parts.join('');
  if (!joined) return inline ? '<p></p>' : '<p></p>';
  if (joined.startsWith('<table') || joined.startsWith('<img')) return joined;
  return inline ? `<p>${joined}</p>` : `<p>${joined}</p>`;
}

/* ------------------------------ document ------------------------------ */

export function renderSections(sectionXmlList) {
  const parser = new DOMParser();
  const out = [];

  sectionXmlList.forEach((xml, index) => {
    const doc = parser.parseFromString(xml, 'text/xml');
    const paragraphs = Array.from(doc.querySelectorAll('*')).filter((n) => tag(n) === 'hp');
    if (!paragraphs.length) {
      if (doc.querySelector('parsererror')) {
        throw new Error('HWPX의 XML을 해석하지 못했습니다(손상된 파일일 수 있습니다).');
      }
      throw new Error('HWPX 안에 문단(hp)을 찾지 못했습니다.');
    }
    if (index > 0) out.push('<hr class="pagebreak">');
    for (const p of paragraphs) {
      // nested paragraph (table cells 등)는 상위 렌더링에서 처리되므로 건너뛴다
      let nested = false;
      let parent = p.parentElement;
      while (parent) {
        if (tag(parent) === 'hp' || tag(parent) === 'tc' || tag(parent) === 'htc') { nested = true; break; }
        parent = parent.parentElement;
      }
      if (nested) continue;
      out.push(renderParagraph(p));
    }
  });

  return out.join('') || '<p></p>';
}

export function errorHint(error) {
  const message = String(error?.message || error || '');
  if (/암호|encrypted|Corrupted/i.test(message)) {
    return '암호로 보호되었거나 손상된 HWPX 파일입니다.';
  }
  return `이 HWPX 파일을 여는 데 실패했습니다: ${message}`;
}
