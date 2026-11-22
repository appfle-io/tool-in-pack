/**
 * HWP (한글 5.x 바이너리) renderer.
 *
 * Parser: hwp.js v0.0.3 (Apache-2.0) by Han Lee — https://github.com/hahnlee/hwp.js
 * Self-hosted ESM build: ./vendor/hwpjs/hwp.esm.js (node 'fs' import stubbed).
 *
 * 파서가 돌려준 문서 모델(sections → paragraphs → text/controls)을
 * TIP 스타일의 정리된 HTML로 다시 그린다. 암호 문서·구버전은 파서가
 * 던지는 에러 메시지를 사용자용 안내로 바꿔 전달한다.
 */

const LINE_BREAK = 13;
const TAB = 9;

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function alignStyle(shape) {
  const align = shape?.align;
  if (align === 1) return ' style="text-align:center"';
  if (align === 2) return ' style="text-align:right"';
  return '';
}

/* ------------------------------ controls ------------------------------ */

function renderTable(control, renderParagraph) {
  const rows = [];
  for (let r = 0; r < (control.rowCount || 0); r += 1) {
    const cells = (control.content?.[r] || []).map((list) => {
      const attrs = list.attribute || {};
      const body = (list.items || []).map((p) => renderParagraph(p, true)).join('') || '<p></p>';
      const colspan = attrs.colSpan > 1 ? ` colspan="${attrs.colSpan}"` : '';
      const rowspan = attrs.rowSpan > 1 ? ` rowspan="${attrs.rowSpan}"` : '';
      return `<td${colspan}${rowspan}>${body}</td>`;
    });
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table><tbody>${rows.join('')}</tbody></table>`;
}

function renderControl(control, renderParagraph) {
  try {
    // table: rowCount + content = rows of paragraph lists
    if (Number.isFinite(control.rowCount) && Array.isArray(control.content)) {
      return renderTable(control, renderParagraph);
    }
    // generic shape / picture / container: keep the text inside
    if (Array.isArray(control.content)) {
      const inner = [];
      for (const list of control.content) {
        for (const p of list.items || []) inner.push(renderParagraph(p, true));
      }
      return inner.join('');
    }
  } catch {
    return '<p>…</p>';
  }
  return '';
}

/* ----------------------------- paragraphs ----------------------------- */

function renderParagraph(paragraph, info, inline = false) {
  const shape = info?.paragraphShapes?.[paragraph.shapeIndex];
  const style = alignStyle(shape);
  const html = [];
  let text = '';
  let ctrlIndex = 0;

  const flush = () => {
    if (text.trim()) html.push(`<p${style}>${esc(text)}</p>`);
    else if (text.includes('\n')) html.push(`<p${style}></p>`);
    text = '';
  };

  for (const ch of paragraph.content || []) {
    if (typeof ch.value === 'string') {
      text += ch.value;
    } else if (ch.value === LINE_BREAK) {
      text += '\n';
      flush();
    } else if (ch.value === TAB) {
      text += '　';
    } else if (ch.type === 2) {
      // extended control char → the control object sits in paragraph.controls
      const control = paragraph.controls?.[ctrlIndex];
      ctrlIndex += 1;
      if (control) {
        flush();
        html.push(renderControl(control, (p, inlineP) => renderParagraph(p, info, inlineP)));
      }
    }
  }
  flush();

  if (inline) return html.join('');
  return html.join('');
}

/* ------------------------------ document ------------------------------ */

export function renderDocument(doc) {
  const info = doc.info || {};
  const out = [];

  (doc.sections || []).forEach((section, index) => {
    if (index > 0) out.push('<hr class="pagebreak">');
    for (const paragraph of section.content || []) {
      out.push(renderParagraph(paragraph, info));
    }
  });

  return collapseBlankRuns(out.join('')) || '<p></p>';
}

/* HWP 문단의 연속 줄바꿈이 수십 개의 빈 <p>가 되는 것을 1개로 접는다 */
function collapseBlankRuns(html) {
  return html.replace(/(?:<p[^>]*><\/p>\s*){3,}/g, '<p></p>');
}

export function errorHint(error) {
  const message = String(error?.message || error || '');
  if (/encrypt|Encrypted|암호/i.test(message)) {
    return '암호로 보호된 HWP 파일입니다. 암호를 푼 뒤 다시 열어 주세요.';
  }
  if (/only support|Received version/i.test(message)) {
    return '지원하지 않는 버전의 HWP입니다. HWP 5.x 파일만 열 수 있습니다(3.x 등 구버전은 미지원).';
  }
  if (/signature|FileHeader|Cannot find|not exist/i.test(message)) {
    return 'HWP 5.x 형식이 아니거나 파일이 손상된 것 같습니다. 확장자만 바꾼 다른 형식일 수도 있습니다.';
  }
  return `이 HWP 파일을 여는 데 실패했습니다: ${message}`;
}
