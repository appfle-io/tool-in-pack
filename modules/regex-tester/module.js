/**
 * TIP · 정규식 테스터 (regex-tester)
 * 패턴 · 플래그 · 테스트 문자열로 일치 부분을 실시간 확인한다.
 * 자바스크립트 RegExp를 그대로 쓰므로 브라우저가 아는 문법과 결과가 같다. 전부 기기 안에서 처리.
 */

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2.5M15.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2.5"/><path d="M12 9v6M9.6 10.2l4.8 3.6M14.4 10.2l-4.8 3.6"/></svg>`;

const FLAGS = [
  { id: 'g', label: 'g', title: '전체 찾기 (global)' },
  { id: 'i', label: 'i', title: '대소문자 무시 (ignoreCase)' },
  { id: 'm', label: 'm', title: '여러 줄 모드 (multiline)' },
  { id: 's', label: 's', title: '줄바꿈 포함 (dotAll)' },
];

const PRESETS = [
  { label: '이메일', pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' },
  { label: '휴대폰', pattern: '01[016789]-?\\d{3,4}-?\\d{4}' },
  { label: 'URL', pattern: 'https?:\\/\\/[^\\s<>"\']+' },
  { label: 'IPv4', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b' },
  { label: '한글만', pattern: '[\\uAC00-\\uD7A3]+' },
  { label: '숫자만', pattern: '\\d+' },
];

const MAX_MATCHES = 500;

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const module = {
  id: 'regex-tester',
  name: '정규식 테스터',
  kind: 'tool',
  category: 'utility',
  version: '1.0.0',
  subtitle: '매치 하이라이트 · 캡처 그룹',
  description: '정규식을 입력하면 일치하는 부분을 실시간으로 표시하고, 매치 수와 캡처 그룹을 보여 줍니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root) {
    const controller = new AbortController();
    const { signal } = controller;

    const flags = new Set(['g']);

    root.innerHTML = `
      <div class="v16 rx">
        <div class="v16-field">
          <label class="v16-label" for="rx-pattern">패턴</label>
          <div class="rx-pattern">
            <span class="rx-slash">/</span>
            <input class="pt-input rx-pattern-input" id="rx-pattern" type="text" spellcheck="false"
                   autocomplete="off" autocapitalize="off" placeholder="[a-z]+">
            <span class="rx-slash">/</span>
            <div class="rx-flags" id="rx-flags" role="group" aria-label="플래그"></div>
          </div>
        </div>

        <div class="rx-presets" id="rx-presets" role="group" aria-label="자주 쓰는 패턴"></div>

        <div class="v16-field">
          <label class="v16-label" for="rx-text">테스트 문자열</label>
          <div class="rx-editor">
            <div class="rx-highlight" id="rx-highlight" aria-hidden="true"></div>
            <textarea class="rx-input" id="rx-text" rows="8" spellcheck="false"
                      placeholder="여기에 글을 넣으면 일치하는 부분이 표시됩니다"></textarea>
          </div>
        </div>

        <div class="rx-summary" id="rx-summary" aria-live="polite"></div>
        <div class="rx-matches" id="rx-matches"></div>
      </div>`;

    const patternInput = root.querySelector('#rx-pattern');
    const flagsEl = root.querySelector('#rx-flags');
    const textInput = root.querySelector('#rx-text');
    const highlight = root.querySelector('#rx-highlight');
    const summary = root.querySelector('#rx-summary');
    const matchesEl = root.querySelector('#rx-matches');

    FLAGS.forEach((flag) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rx-flag';
      button.textContent = flag.label;
      button.title = flag.title;
      button.setAttribute('aria-pressed', String(flags.has(flag.id)));
      button.addEventListener('click', () => {
        if (flags.has(flag.id)) flags.delete(flag.id);
        else flags.add(flag.id);
        button.setAttribute('aria-pressed', String(flags.has(flag.id)));
        render();
      }, { signal });
      flagsEl.appendChild(button);
    });

    PRESETS.forEach((preset) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rx-chip';
      chip.textContent = preset.label;
      chip.title = preset.pattern;
      chip.addEventListener('click', () => {
        patternInput.value = preset.pattern;
        render();
      }, { signal });
      root.querySelector('#rx-presets').appendChild(chip);
    });

    function paintHighlight(text, ranges) {
      if (!ranges.length) return text;
      let out = '';
      let cursor = 0;
      ranges.forEach((range) => {
        if (range.start < cursor) return;
        out += escapeText(text.slice(cursor, range.start));
        out += `<mark class="rx-hit">${escapeText(text.slice(range.start, range.end))}</mark>`;
        cursor = range.end;
      });
      out += escapeText(text.slice(cursor));
      return out;
    }

    function showSummary(kind, text) {
      summary.hidden = !text;
      summary.className = `rx-summary${kind ? ` ${kind}` : ''}`;
      summary.textContent = text || '';
    }

    function render() {
      const pattern = patternInput.value;
      const text = textInput.value;
      matchesEl.innerHTML = '';

      if (!pattern) {
        highlight.textContent = text;
        showSummary('', text ? '패턴을 입력하면 일치하는 부분을 표시합니다.' : '');
        return;
      }

      const flagString = FLAGS.filter((flag) => flags.has(flag.id)).map((flag) => flag.id).join('');
      let regex;
      try {
        regex = new RegExp(pattern, flagString);
      } catch (error) {
        highlight.textContent = text;
        showSummary('bad', `정규식 문법 오류 — ${error.message}`);
        return;
      }

      const global = flags.has('g');
      const iter = new RegExp(pattern, global ? flagString : `${flagString}g`);
      const found = [];
      let match;
      let truncated = false;
      try {
        while ((match = iter.exec(text)) !== null) {
          found.push({
            index: match.index,
            end: match.index + match[0].length,
            value: match[0],
            groups: match.slice(1),
            named: match.groups || null,
          });
          if (match[0].length === 0) iter.lastIndex += 1;
          if (found.length >= MAX_MATCHES) { truncated = true; break; }
        }
      } catch (error) {
        highlight.textContent = text;
        showSummary('bad', `정규식을 실행하지 못했습니다 — ${error.message}`);
        return;
      }

      const shown = global ? found : found.slice(0, 1);
      highlight.innerHTML = paintHighlight(text, shown.filter((item) => item.end > item.index)
        .map((item) => ({ start: item.index, end: item.end })));

      if (!found.length) {
        showSummary('warn', '일치하는 부분이 없습니다.');
        return;
      }

      showSummary('ok', global
        ? `매치 ${found.length.toLocaleString()}개${truncated ? ` (${MAX_MATCHES}개까지만 표시)` : ''}`
        : `첫 매치 1개 · g를 켜면 전체를 찾습니다 (전체 ${found.length.toLocaleString()}개)`);

      matchesEl.innerHTML = shown.map((item, order) => {
        const groups = item.groups.map((group, index) =>
          `<div class="rx-group"><span class="rx-group-k">그룹 ${index + 1}</span>
            <code>${group === undefined ? '(없음)' : escapeText(group)}</code></div>`).join('');
        const named = item.named
          ? Object.entries(item.named).map(([name, value]) =>
            `<div class="rx-group"><span class="rx-group-k">${escapeText(name)}</span>
              <code>${value === undefined ? '(없음)' : escapeText(value)}</code></div>`).join('')
          : '';
        return `
          <div class="rx-match">
            <div class="rx-match-head">
              <span class="rx-match-index">#${order + 1}</span>
              <code class="rx-match-value">${escapeText(item.value) || '(빈 문자열)'}</code>
              <span class="rx-match-pos">${item.index}–${item.end}</span>
            </div>
            ${groups || named ? `<div class="rx-groups">${groups}${named}</div>` : ''}
          </div>`;
      }).join('');
    }

    function autoGrow() {
      textInput.style.height = 'auto';
      const limit = 420;
      const next = Math.min(textInput.scrollHeight || 0, limit);
      textInput.style.height = `${next}px`;
      textInput.style.overflowY = (textInput.scrollHeight || 0) > limit ? 'auto' : 'hidden';
    }

    function scheduleRender() {
      clearTimeout(render.timer);
      render.timer = setTimeout(() => { autoGrow(); render(); }, 120);
    }

    patternInput.addEventListener('input', scheduleRender, { signal });
    textInput.addEventListener('input', scheduleRender, { signal });
    textInput.addEventListener('scroll', () => {
      highlight.scrollTop = textInput.scrollTop;
      highlight.scrollLeft = textInput.scrollLeft;
    }, { signal });

    autoGrow();
    render();

    return () => {
      clearTimeout(render.timer);
      controller.abort();
    };
  },
};

export default module;
