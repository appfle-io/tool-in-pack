/**
 * 텍스트·개발 포맷 (v1.26.0) — .txt .md .json .yaml/.yml .xml .log
 *
 * .md  : marked 로 그리고 DOMPurify 로 지운다(스크립트·onerror 차단)
 * .json: 접고 펼치는 트리 + 유효성 표시, 원문 보기 전환
 * 나머지: 줄 번호가 붙은 코드 뷰 + 찾기(로그는 ERROR/WARN 색)
 */

import { marked } from '../../vendor/marked/marked.esm.js';
import { escapeHtml } from '../../js/ui.js';
import { sanitizeBody, stripBadLinks } from './sanitize.js';
import { findBarHTML, createFinder, toolbarHTML } from './findbar.js';

const MAX_LINES = 20000;

/** UTF-8 로 읽고, 깨진 글자가 많으면 EUC-KR(옛 한글 문서)로 다시 읽는다. */
export async function readText(file) {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buffer);
  const broken = (text.match(/\uFFFD/g) || []).length;
  if (broken > 0 && broken > text.length / 200) {
    try {
      const legacy = new TextDecoder('euc-kr').decode(buffer);
      if ((legacy.match(/\uFFFD/g) || []).length < broken) text = legacy;
    } catch { /* 브라우저가 euc-kr 을 모르면 UTF-8 그대로 */ }
  }
  return text.replace(/^\uFEFF/, '');
}

export function codeHTML(text, { log = false } = {}) {
  const all = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const lines = all.slice(0, MAX_LINES);
  const body = lines.map((line, index) => {
    let tone = '';
    if (log) {
      if (/\b(ERROR|FATAL|CRITICAL)\b/.test(line)) tone = ' is-error';
      else if (/\bWARN(ING)?\b/.test(line)) tone = ' is-warn';
      else if (/\b(DEBUG|TRACE)\b/.test(line)) tone = ' is-dim';
    }
    return `<div class="dr-line${tone}"><span class="dr-ln" aria-hidden="true">${index + 1}</span>`
      + `<span class="dr-tx">${escapeHtml(line) || ' '}</span></div>`;
  }).join('');
  const cut = all.length > MAX_LINES
    ? `<p class="dr-code-cut">앞 ${MAX_LINES.toLocaleString()}줄만 보여 줍니다(전체 ${all.length.toLocaleString()}줄).</p>`
    : '';
  return `${cut}<div class="dr-code" role="document">${body}</div>`;
}

function jsonTree(value, key, depth) {
  const label = key === null
    ? ''
    : `<span class="jt-key">${escapeHtml(key)}</span><span class="jt-colon">: </span>`;

  if (value === null || typeof value !== 'object') {
    let text;
    let kind;
    if (typeof value === 'string') { text = JSON.stringify(value); kind = 'str'; }
    else if (typeof value === 'number') { text = String(value); kind = 'num'; }
    else if (typeof value === 'boolean') { text = String(value); kind = 'bool'; }
    else { text = 'null'; kind = 'null'; }
    return `<div class="jt-row">${label}<span class="jt-${kind}">${escapeHtml(text)}</span></div>`;
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((item, index) => [index, item]) : Object.entries(value);
  const open = depth < 2 ? ' open' : '';
  const bracket = isArray ? ['[', ']'] : ['{', '}'];
  const inner = entries.map(([childKey, child]) => jsonTree(child, isArray ? null : childKey, depth + 1)).join('');
  const prefix = isArray ? '' : '';
  return `<details class="jt-node"${open}><summary>${label}<span class="jt-brace">${bracket[0]}</span>`
    + `<span class="jt-count">${entries.length}</span><span class="jt-brace">${bracket[1]}</span>`
    + `${prefix}</summary><div class="jt-children">${inner || '<div class="jt-row jt-null">(비어 있음)</div>'}</div></details>`;
}

function jsonErrorHint(error, text) {
  const message = String(error?.message || '');
  const position = /position\s+(\d+)/i.exec(message);
  let lineText = '';
  if (position) {
    const at = Number(position[1]);
    const before = text.slice(0, at);
    const line = before.split('\n').length;
    lineText = ` (${line}번째 줄 근처)`;
  }
  return `${message}${lineText}`;
}

export async function openText(ctx) {
  const ext = ctx.ext;
  const text = await readText(ctx.file);
  const isMarkdown = ext === 'md' || ext === 'markdown';
  const isJson = ext === 'json';

  const right = `<label class="dr-wrap-toggle"><input type="checkbox" id="dr-wrap" checked> 줄바꿈</label>`;
  const toolbar = isJson
    ? toolbarHTML({
      left: findBarHTML('dr-find'),
      right: `<span class="dr-badge" id="dr-json-valid"></span>`
        + `<button class="tool-btn text" type="button" id="dr-json-mode">원문 보기</button>`
        + `<button class="tool-btn text" type="button" id="dr-json-expand">모두 펼치기</button>`,
    })
    : toolbarHTML({ left: findBarHTML('dr-find'), right });

  ctx.setToolbar(toolbar);

  const stage = ctx.stage;
  if (isMarkdown) stage.classList.add('dr-paper', 'dr-paper-md');
  else stage.classList.add('dr-text-stage');
  if (!isMarkdown) stage.innerHTML = '<div id="dr-scope" class="dr-scope"></div>';
  const scope = isMarkdown ? stage : stage.querySelector('#dr-scope');

  let finder = null;
  const wrapToggle = ctx.result.querySelector('#dr-wrap');
  wrapToggle?.addEventListener('change', () => {
    ctx.result.querySelector('.dr-code')?.classList.toggle('nowrap', !wrapToggle.checked);
  }, { signal: ctx.signal });

  if (isMarkdown) {
    const raw = marked.parse(text, { gfm: true, breaks: false });
    stage.innerHTML = sanitizeBody(raw);
    stripBadLinks(stage);
    // 외부 이미지는 이 앱이 불러오지 않는다(오프라인·프라이버시).
    stage.querySelectorAll('img').forEach((image) => {
      if (!/^blob:/i.test(image.getAttribute('src') || '')) {
        const note = document.createElement('span');
        note.className = 'dr-img-note';
        note.textContent = `[그림] ${image.getAttribute('alt') || image.getAttribute('src') || ''}`;
        image.replaceWith(note);
      }
    });
    finder = createFinder(stage, ctx.result, 'dr-find');
    return { finder };
  }

  if (isJson) {
    let parsed = null;
    let error = null;
    try { parsed = JSON.parse(text); } catch (problem) { error = problem; }
    const badge = ctx.result.querySelector('#dr-json-valid');
    const modeButton = ctx.result.querySelector('#dr-json-mode');
    const expandButton = ctx.result.querySelector('#dr-json-expand');
    let tree = true;

    const draw = () => {
      if (error) {
        badge.textContent = '올바른 JSON 이 아님';
        badge.classList.add('is-bad');
        scope.innerHTML = `<div class="dr-json-error"><b>JSON 을 읽지 못했습니다.</b><span>${escapeHtml(jsonErrorHint(error, text))}</span></div>`
          + codeHTML(text);
        modeButton.hidden = true;
        expandButton.hidden = true;
        return;
      }
      badge.textContent = '올바른 JSON';
      badge.classList.add('is-ok');
      if (tree) {
        scope.innerHTML = `<div class="dr-json-tree">${jsonTree(parsed, null, 0)}</div>`;
      } else {
        const pretty = JSON.stringify(parsed, null, 2);
        scope.innerHTML = codeHTML(pretty);
      }
      modeButton.textContent = tree ? '원문 보기' : '트리 보기';
    };

    modeButton.addEventListener('click', () => {
      tree = !tree;
      draw();
      finder?.refresh({ keep: true });
    }, { signal: ctx.signal });

    expandButton.addEventListener('click', () => {
      const nodes = Array.from(scope.querySelectorAll('details'));
      const anyClosed = nodes.some((node) => !node.open);
      nodes.forEach((node) => { node.open = anyClosed; });
      expandButton.textContent = anyClosed ? '모두 접기' : '모두 펼치기';
    }, { signal: ctx.signal });

    draw();
    finder = createFinder(scope, ctx.result, 'dr-find');
    return { finder };
  }

  // .txt .yaml .yml .xml .log — 줄 번호 코드 뷰
  scope.innerHTML = codeHTML(text, { log: ext === 'log' });
  finder = createFinder(scope, ctx.result, 'dr-find');
  return { finder };
}
