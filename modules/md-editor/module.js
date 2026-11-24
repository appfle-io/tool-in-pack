/**
 * TIP · 마크다운 편집기 (md-editor)
 * 경량 파서 marked(vendor/marked, MIT) + DOMPurify(vendor/dompurify) 새니타이즈.
 * GFM 표·체크박스·코드블록·인용문을 그리고, .md/.html 저장·인쇄·localStorage 임시 저장을 지원한다.
 */

import { marked } from '../../vendor/marked/marked.esm.js';
import { icons } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 15V9l2.5 3L12 9v6"/><path d="M16 9v4.5M14.4 12l1.6 1.8 1.6-1.8"/></svg>`;

const STORE_KEY = 'tip.mdx.v1';
const SAMPLE = `# 마크다운 편집기

왼쪽(모바일은 **편집** 탭)에 글을 쓰면 오른쪽에 바로 그려집니다.

## 표

| 항목 | 값 |
| --- | --- |
| 처리 | 이 기기 안 |
| 저장 | .md, .html |

## 할 일

- [x] 표와 체크박스 확인
- [ ] 코드 블록 확인

\`\`\`js
const tip = 'TOOL-IN-PACK';
console.log(tip);
\`\`\`

> 인용문은 이렇게 표시됩니다. **굵게**, *기울임*, ~~취소선~~, \`코드\`.
`;

const TOOLS = [
  { id: 'bold', label: 'B', title: '굵게 (Ctrl/Cmd+B)', wrap: ['**', '**'], className: 'mdx-b' },
  { id: 'italic', label: 'I', title: '기울임 (Ctrl/Cmd+I)', wrap: ['_', '_'], className: 'mdx-i' },
  { id: 'strike', label: 'S', title: '취소선', wrap: ['~~', '~~'], className: 'mdx-s' },
  { sep: true },
  { id: 'h1', label: 'H1', title: '제목 1', line: '# ' },
  { id: 'h2', label: 'H2', title: '제목 2', line: '## ' },
  { sep: true },
  { id: 'ul', label: '•', title: '글머리 기호', line: '- ' },
  { id: 'ol', label: '1.', title: '번호 목록', line: '1. ' },
  { id: 'check', label: '☑', title: '체크박스', line: '- [ ] ' },
  { id: 'quote', label: '❝', title: '인용문', line: '> ' },
  { sep: true },
  { id: 'code', label: '</>', title: '코드 블록', block: '```\n\n```' },
  { id: 'link', label: '링크', title: '링크', wrap: ['[', '](https://)'] },
  { id: 'table', label: '표', title: '표 넣기', block: '| 항목 | 값 |\n| --- | --- |\n|  |  |' },
];

function renderMarkdown(text) {
  const purify = window.DOMPurify;
  const raw = marked.parse(text || '', { gfm: true, breaks: true });
  if (!purify) return raw.replace(/<script[\s\S]*?<\/script>/gi, '');
  return purify.sanitize(raw, { USE_PROFILES: { html: true }, ADD_ATTR: ['target', 'rel'] });
}

function downloadFile(text, name, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

function baseName(name) {
  return (name || '').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim();
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && typeof data.text === 'string') return data;
  } catch { /* 초안 없음 */ }
  return null;
}

const module = {
  id: 'md-editor',
  name: '마크다운 편집기',
  shortName: '마크다운',
  kind: 'tool',
  category: 'document',
  version: '1.0.0',
  subtitle: '표와 체크박스까지 바로 그려집니다',
  description: '마크다운을 쓰면서 표, 체크박스, 코드까지 바로 미리 보고 .md 나 .html 로 저장하거나 인쇄합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx.toast || (() => {});

    const draft = loadDraft();
    let text = draft && draft.text ? draft.text : '';
    let name = draft && draft.name ? draft.name : '';
    let mode = 'edit';
    let saveTimer = null;

    root.innerHTML = `
      <div class="mdx" data-mode="edit">
        <div class="mdx-bar">
          <div class="doc-toolbar mdx-toolbar" id="mdx-toolbar" role="toolbar" aria-label="서식"></div>
          <div class="mdx-filebar">
            <button class="ghost-btn" type="button" id="mdx-open">${icons.doc} 열기</button>
            <button class="ghost-btn" type="button" id="mdx-save">저장 .md</button>
            <button class="ghost-btn" type="button" id="mdx-html">.html</button>
            <button class="ghost-btn" type="button" id="mdx-print">인쇄</button>
          </div>
          <input type="file" id="mdx-input" class="sr-only" accept=".md,.markdown,.txt,text/markdown,text/plain">
        </div>

        <div class="mdx-tabs" role="tablist" aria-label="편집 또는 미리보기">
          <button class="mdx-tab" type="button" role="tab" data-mode="edit" aria-selected="true">편집</button>
          <button class="mdx-tab" type="button" role="tab" data-mode="preview" aria-selected="false">미리보기</button>
        </div>

        <div class="mdx-grid">
          <div class="mdx-pane mdx-edit">
            <textarea class="mdx-textarea" id="mdx-text" spellcheck="false"
                      placeholder="# 제목을 입력하세요&#10;&#10;마크다운으로 쓰면 오른쪽 미리보기에 바로 나타납니다."></textarea>
          </div>
          <div class="mdx-pane mdx-preview-wrap">
            <article class="mdx-preview" id="mdx-preview" aria-label="미리보기"></article>
          </div>
        </div>

        <div class="mdx-foot">
          <span id="mdx-stats" class="mdx-stats"></span>
          <span id="mdx-saved" class="mdx-saved"></span>
        </div>
      </div>`;

    const editor = root.querySelector('#mdx-text');
    const preview = root.querySelector('#mdx-preview');
    const statsEl = root.querySelector('#mdx-stats');
    const savedEl = root.querySelector('#mdx-saved');
    const fileInput = root.querySelector('#mdx-input');
    const rootEl = root.querySelector('.mdx');

    // ── 툴바 ─────────────────────────────────────────────
    const toolbar = root.querySelector('#mdx-toolbar');
    TOOLS.forEach((tool) => {
      if (tool.sep) {
        toolbar.append(Object.assign(document.createElement('span'), { className: 'tool-sep' }));
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tool-btn${tool.className ? ` ${tool.className}` : ''}`;
      btn.title = tool.title;
      btn.setAttribute('aria-label', tool.title);
      btn.textContent = tool.label;
      btn.addEventListener('click', () => applyTool(tool), { signal });
      toolbar.append(btn);
    });

    function replaceSelection(insert, selectOffset, selectLength) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const value = editor.value;
      const next = value.slice(0, start) + insert + value.slice(end);
      editor.value = next;
      const caret = start + (selectOffset ?? insert.length);
      editor.setSelectionRange(caret, caret + (selectLength || 0));
      editor.focus();
      onInput();
    }

    function applyTool(tool) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const selected = editor.value.slice(start, end);

      if (tool.wrap) {
        const [before, after] = tool.wrap;
        replaceSelection(before + selected + after, before.length, selected.length);
        return;
      }
      if (tool.block) {
        const lead = start > 0 && editor.value[start - 1] !== '\n' ? '\n' : '';
        const insert = `${lead}${tool.block}\n`;
        // 코드 블록은 빈 줄 안쪽(``` 다음 줄)에, 표는 끝에 커서를 둔다.
        const caret = tool.block.startsWith('```') ? lead.length + 4 : insert.length;
        replaceSelection(insert, caret, 0);
        return;
      }
      if (tool.line) {
        const lineStart = editor.value.lastIndexOf('\n', start - 1) + 1;
        const atLineStart = editor.value.slice(lineStart, start).trim() === '';
        if (atLineStart) {
          const next = editor.value.slice(0, lineStart) + tool.line + editor.value.slice(lineStart);
          editor.value = next;
          const caret = start + tool.line.length;
          editor.setSelectionRange(caret, end + tool.line.length);
        } else {
          const next = editor.value.slice(0, start) + `\n${tool.line}` + editor.value.slice(end);
          editor.value = next;
          const caret = start + tool.line.length + 1;
          editor.setSelectionRange(caret, caret);
        }
        editor.focus();
        onInput();
      }
    }

    // ── 렌더 ─────────────────────────────────────────────
    function renderPreview() {
      preview.innerHTML = renderMarkdown(editor.value);
      // 체크박스는 미리보기에서 누를 수 없게 둔다(문서 내용을 바꾸지 않음).
      preview.querySelectorAll('input[type="checkbox"]').forEach((box) => box.setAttribute('disabled', ''));
    }

    function renderStats() {
      const value = editor.value;
      const chars = value.replace(/\s/g, '').length;
      const lines = value === '' ? 0 : value.split('\n').length;
      const words = value.trim() ? value.trim().split(/\s+/).length : 0;
      statsEl.textContent = `${chars.toLocaleString('ko-KR')}자, ${words.toLocaleString('ko-KR')}단어, ${lines.toLocaleString('ko-KR')}줄`;
    }

    function persist() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ text: editor.value, name, savedAt: new Date().toISOString() }));
          savedEl.textContent = '임시 저장됨';
        } catch {
          savedEl.textContent = '임시 저장 실패';
        }
      }, 500);
    }

    function onInput() {
      renderPreview();
      renderStats();
      persist();
    }

    editor.addEventListener('input', onInput, { signal });

    editor.addEventListener('keydown', (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === 'b' || key === 'i') {
        event.preventDefault();
        applyTool(TOOLS.find((t) => t.id === (key === 'b' ? 'bold' : 'italic')));
      }
    }, { signal });

    // ── 탭 (모바일) ──────────────────────────────────────
    root.querySelectorAll('.mdx-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const next = tab.getAttribute('data-mode');
        if (mode === next) return;
        mode = next;
        rootEl.dataset.mode = next;
        root.querySelectorAll('.mdx-tab').forEach((btn) => {
          btn.setAttribute('aria-selected', String(btn.getAttribute('data-mode') === next));
        });
        if (next === 'edit') editor.focus();
      }, { signal });
    });

    // ── 파일 ─────────────────────────────────────────────
    root.querySelector('#mdx-open').addEventListener('click', () => fileInput.click(), { signal });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const content = await file.text();
        editor.value = content;
        name = file.name;
        onInput();
        toast(`${file.name} 열었습니다`);
      } catch (error) {
        console.error('[TIP md-editor]', error);
        toast('파일을 읽지 못했습니다');
      }
    }, { signal });

    root.querySelector('#mdx-save').addEventListener('click', () => {
      const fileName = `${baseName(name) || 'document'}.md`;
      downloadFile(editor.value, fileName, 'text/markdown;charset=utf-8');
      toast(`${fileName} 저장`);
    }, { signal });

    root.querySelector('#mdx-html').addEventListener('click', () => {
      const body = renderMarkdown(editor.value);
      const title = baseName(name) || 'document';
      const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&"]/g, '')}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; line-height: 1.7; color: #1c1c1e; }
  h1, h2, h3 { line-height: 1.3; margin: 1.6em 0 .6em; }
  h1 { font-size: 28px; border-bottom: 1px solid #e5e5ea; padding-bottom: .3em; }
  h2 { font-size: 22px; border-bottom: 1px solid #f0f0f5; padding-bottom: .25em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 14px; }
  th, td { border: 1px solid #d8d8de; padding: 7px 10px; text-align: left; }
  th { background: #f6f6f9; }
  code { background: #f2f2f7; padding: .15em .4em; border-radius: 5px; font-size: .9em; }
  pre { background: #f2f2f7; padding: 14px; border-radius: 9px; overflow: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: .2em 1em; border-left: 3px solid #2E5E4E; color: #4a4a4f; }
  img { max-width: 100%; }
  input[type=checkbox] { margin-right: 6px; }
</style>
</head>
<body>
${body}
</body>
</html>`;
      const fileName = `${title}.html`;
      downloadFile(html, fileName, 'text/html;charset=utf-8');
      toast(`${fileName} 저장`);
    }, { signal });

    root.querySelector('#mdx-print').addEventListener('click', () => {
      const body = renderMarkdown(editor.value);
      if (!body.trim()) {
        toast('인쇄할 내용이 없습니다');
        return;
      }
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
      document.body.appendChild(frame);
      const doc = frame.contentWindow.document;
      doc.open();
      doc.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${baseName(name) || 'document'}</title>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; line-height: 1.65; color: #111; }
  h1 { font-size: 22pt; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  h2 { font-size: 16pt; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 10.5pt; }
  th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: left; }
  code { background: #f2f2f2; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f6f6f6; padding: 10px; border-radius: 4px; white-space: pre-wrap; }
  blockquote { margin: 10px 0; padding: 2px 12px; border-left: 3px solid #2E5E4E; color: #444; }
  img { max-width: 100%; }
  @page { margin: 18mm 16mm; }
</style></head><body>${body}</body></html>`);
      doc.close();
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (error) {
          console.error('[TIP md-editor]', error);
          toast('이 브라우저에서는 인쇄 창을 열지 못했습니다');
        }
      }, 120);
      setTimeout(() => frame.remove(), 60000);
    }, { signal });

    // ── 초기값 ───────────────────────────────────────────
    editor.value = text;
    if (!editor.value) {
      const sampleBtn = document.createElement('button');
      sampleBtn.type = 'button';
      sampleBtn.className = 'mdx-sample';
      sampleBtn.textContent = '예제 문서 넣기';
      sampleBtn.addEventListener('click', () => {
        editor.value = SAMPLE;
        onInput();
        editor.focus();
      }, { signal });
      savedEl.append(sampleBtn);
    }
    if (draft && draft.savedAt) {
      savedEl.textContent = '이전에 쓰던 초안을 열었습니다';
    }
    renderPreview();
    renderStats();

    return () => {
      clearTimeout(saveTimer);
      controller.abort();
    };
  },
};

export default module;
