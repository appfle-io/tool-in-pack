/**
 * TIP · 텍스트 비교 · 정리 (text-diff)
 * 두 글을 줄 단위로 비교(LCS)하고, 글자·단어·바이트 수를 세고, 한 번에 정리한다.
 * 입력은 브라우저 메모리 안에서만 다룬다. 서버로 보내지 않는다.
 */

import { formatBytes } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M12 3v18M9.5 8.5L12 6l2.5 2.5"/></svg>`;

const MAX_CELLS = 4_000_000; // LCS 표 크기 상한 (약 4백만 칸 = 16MB)

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * 줄 단위 LCS diff. 너무 큰 입력은 자리 기준 비교로 대체한다.
 * 반환: [{ type: 'same' | 'add' | 'del', left?, right?, text }]
 */
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    const rows = [];
    const limit = Math.max(n, m);
    for (let i = 0; i < limit; i += 1) {
      if (i < n && i < m && a[i] === b[i]) rows.push({ type: 'same', left: i + 1, right: i + 1, text: a[i] });
      else {
        if (i < n) rows.push({ type: 'del', left: i + 1, text: a[i] });
        if (i < m) rows.push({ type: 'add', right: i + 1, text: b[i] });
      }
    }
    rows.fallback = true;
    return rows;
  }

  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'same', left: i + 1, right: j + 1, text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      rows.push({ type: 'del', left: i + 1, text: a[i] });
      i += 1;
    } else {
      rows.push({ type: 'add', right: j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', left: i + 1, text: a[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: 'add', right: j + 1, text: b[j] });
    j += 1;
  }
  return rows;
}

const module = {
  id: 'text-diff',
  name: '텍스트 비교',
  kind: 'tool',
  category: 'dev',
  version: '1.0.0',
  subtitle: '줄 단위 비교와 글자수 세기',
  description: '두 글을 줄 단위로 비교하고 글자수와 단어수, 바이트 수를 세며 빈 줄과 중복 줄을 한 번에 정리합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    root.innerHTML = `
      <div class="v16 td">
        <div class="v16-tabs" role="tablist" aria-label="모드 선택" id="td-tabs"></div>

        <section class="v16-panel" id="td-p-diff" role="tabpanel" aria-label="비교">
          <div class="td-two">
            <div class="v16-field">
              <label class="v16-label" for="td-a">원본</label>
              <textarea class="v16-ta" id="td-a" rows="6" spellcheck="false" placeholder="고치기 전 글"></textarea>
            </div>
            <div class="v16-field">
              <label class="v16-label" for="td-b">수정본</label>
              <textarea class="v16-ta" id="td-b" rows="6" spellcheck="false" placeholder="고친 뒤 글"></textarea>
            </div>
          </div>
          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="td-run">비교</button>
            <button class="v16-btn" type="button" id="td-swap">좌우 바꾸기</button>
            <button class="v16-btn" type="button" id="td-clear">지우기</button>
          </div>
          <div class="td-stats" id="td-stats"></div>
          <div class="td-diff" id="td-diff">
            <p class="td-hint">두 칸에 글을 넣으면 줄 단위로 비교합니다. 입력하는 동안 자동으로 갱신됩니다.</p>
          </div>
        </section>

        <section class="v16-panel" id="td-p-clean" role="tabpanel" aria-label="정리와 통계" hidden>
          <div class="v16-field">
            <label class="v16-label" for="td-clean">텍스트</label>
            <textarea class="v16-ta" id="td-clean" rows="8" spellcheck="false" placeholder="붙여 넣으면 글자수와 단어수, 바이트 수를 셉니다"></textarea>
          </div>
          <div class="v16-stats" id="td-counts"></div>
          <div class="v16-actions">
            <button class="v16-btn" type="button" id="td-trim">앞뒤 공백 정리</button>
            <button class="v16-btn" type="button" id="td-blank">빈 줄 제거</button>
            <button class="v16-btn" type="button" id="td-dup">중복 줄 제거</button>
            <button class="v16-btn" type="button" id="td-asc">오름차순 정렬</button>
            <button class="v16-btn" type="button" id="td-desc">내림차순 정렬</button>
            <button class="v16-btn" type="button" id="td-undo" disabled>되돌리기</button>
            <button class="v16-btn" type="button" id="td-copy">복사</button>
          </div>
          <div class="v16-status" id="td-clean-status" hidden></div>
        </section>
      </div>`;

    /* ------------------------------- tabs ------------------------------- */

    const tabBar = root.querySelector('#td-tabs');
    const TABS = [{ id: 'diff', label: '비교' }, { id: 'clean', label: '정리와 통계' }];
    const panels = new Map(TABS.map((tab) => [tab.id, root.querySelector(`#td-p-${tab.id}`)]));

    function selectTab(id) {
      TABS.forEach((tab) => {
        const button = tabBar.querySelector(`[data-tab="${tab.id}"]`);
        const selected = tab.id === id;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        panels.get(tab.id).hidden = !selected;
      });
      if (id === 'clean') updateCounts();
    }

    TABS.forEach((tab, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'v16-tab';
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.addEventListener('click', () => selectTab(tab.id), { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        selectTab(next.id);
        tabBar.querySelector(`[data-tab="${next.id}"]`).focus();
      }, { signal });
      tabBar.appendChild(button);
    });

    /* ------------------------------- 비교 ------------------------------- */

    const areaA = root.querySelector('#td-a');
    const areaB = root.querySelector('#td-b');
    const diffEl = root.querySelector('#td-diff');
    const statsEl = root.querySelector('#td-stats');

    function compare() {
      const leftText = areaA.value;
      const rightText = areaB.value;
      if (!leftText && !rightText) {
        statsEl.innerHTML = '';
        diffEl.innerHTML = '<p class="td-hint">두 칸에 글을 넣으면 줄 단위로 비교합니다. 입력하는 동안 자동으로 갱신됩니다.</p>';
        return;
      }

      const rows = diffLines(splitLines(leftText), splitLines(rightText));
      const counts = { same: 0, add: 0, del: 0 };
      rows.forEach((row) => { counts[row.type] += 1; });

      statsEl.innerHTML = `
        <span class="td-chip add">추가 ${counts.add}줄</span>
        <span class="td-chip del">삭제 ${counts.del}줄</span>
        <span class="td-chip same">동일 ${counts.same}줄</span>
        <span class="td-chip">전체 ${rows.length}줄</span>`;
      if (rows.fallback) {
        statsEl.insertAdjacentHTML('beforeend',
          '<span class="td-chip warn">줄이 너무 많아 자리 기준으로 비교했습니다</span>');
      }

      const LABEL = { same: '동일', add: '추가', del: '삭제' };
      const html = rows.map((row) => `
        <div class="td-row ${row.type}">
          <span class="td-ln">${row.left ?? ''}</span>
          <span class="td-ln">${row.right ?? ''}</span>
          <span class="td-sign" aria-label="${LABEL[row.type]}">${row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}</span>
          <span class="td-text">${escapeText(row.text)}</span>
        </div>`).join('');
      diffEl.innerHTML = html || '<p class="td-hint">차이가 없습니다.</p>';
    }

    function scheduleCompare() {
      clearTimeout(compare.timer);
      compare.timer = setTimeout(compare, 220);
    }

    areaA.addEventListener('input', scheduleCompare, { signal });
    areaB.addEventListener('input', scheduleCompare, { signal });
    root.querySelector('#td-run').addEventListener('click', compare, { signal });
    root.querySelector('#td-swap').addEventListener('click', () => {
      const a = areaA.value;
      areaA.value = areaB.value;
      areaB.value = a;
      compare();
    }, { signal });
    root.querySelector('#td-clear').addEventListener('click', () => {
      areaA.value = '';
      areaB.value = '';
      compare();
      areaA.focus();
    }, { signal });

    /* ---------------------------- 정리 · 통계 ---------------------------- */

    const clean = root.querySelector('#td-clean');
    const countsEl = root.querySelector('#td-counts');
    const cleanStatus = root.querySelector('#td-clean-status');
    const undoBtn = root.querySelector('#td-undo');
    let undoValue = null;

    function setCleanStatus(kind, text) {
      cleanStatus.hidden = !text;
      cleanStatus.className = `v16-status${kind ? ` ${kind}` : ''}`;
      cleanStatus.textContent = text || '';
    }

    function stats(value) {
      const chars = value.length;
      const withoutSpace = value.replace(/\s/g, '').length;
      const words = value.trim() ? value.trim().split(/\s+/).length : 0;
      const lines = value ? splitLines(value).length : 0;
      const bytes = new TextEncoder().encode(value).length;
      return { chars, withoutSpace, words, lines, bytes };
    }

    function updateCounts() {
      const value = clean.value;
      const s = stats(value);
      const items = [
        ['글자수 (공백 포함)', s.chars.toLocaleString()],
        ['글자수 (공백 제외)', s.withoutSpace.toLocaleString()],
        ['단어 수', s.words.toLocaleString()],
        ['줄 수', s.lines.toLocaleString()],
        ['UTF-8 바이트', formatBytes(s.bytes)],
      ];
      countsEl.innerHTML = items.map(([label, valueText]) => `
        <div class="v16-stat"><b>${valueText}</b><span>${label}</span></div>`).join('');
    }

    function scheduleCounts() {
      clearTimeout(updateCounts.timer);
      updateCounts.timer = setTimeout(updateCounts, 150);
    }

    function applyTransform(fn, message) {
      const before = clean.value;
      if (!before) {
        setCleanStatus('warn', '정리할 텍스트를 먼저 넣으세요.');
        return;
      }
      const after = fn(before);
      if (after === before) {
        setCleanStatus('warn', message === '앞뒤 공백 정리' ? '정리할 공백이 없습니다.' : '바뀐 내용이 없습니다.');
        return;
      }
      undoValue = before;
      undoBtn.disabled = false;
      clean.value = after;
      updateCounts();
      setCleanStatus('ok', `${message} — ${splitLines(before).length}줄 → ${splitLines(after).length}줄`);
    }

    clean.addEventListener('input', scheduleCounts, { signal });

    root.querySelector('#td-trim').addEventListener('click', () => {
      applyTransform((text) => text.split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim(), '앞뒤 공백 정리');
    }, { signal });

    root.querySelector('#td-blank').addEventListener('click', () => {
      applyTransform((text) => text.split('\n').filter((line) => line.trim() !== '').join('\n'), '빈 줄 제거');
    }, { signal });

    root.querySelector('#td-dup').addEventListener('click', () => {
      applyTransform((text) => {
        const seen = new Set();
        return text.split('\n').filter((line) => {
          const key = line.trim();
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).join('\n');
      }, '중복 줄 제거');
    }, { signal });

    root.querySelector('#td-asc').addEventListener('click', () => {
      applyTransform((text) => text.split('\n').sort((a, b) => a.localeCompare(b, 'ko')).join('\n'), '오름차순 정렬');
    }, { signal });

    root.querySelector('#td-desc').addEventListener('click', () => {
      applyTransform((text) => text.split('\n').sort((a, b) => b.localeCompare(a, 'ko')).join('\n'), '내림차순 정렬');
    }, { signal });

    undoBtn.addEventListener('click', () => {
      if (undoValue === null) return;
      clean.value = undoValue;
      undoValue = null;
      undoBtn.disabled = true;
      updateCounts();
      setCleanStatus('ok', '되돌렸습니다.');
    }, { signal });

    root.querySelector('#td-copy').addEventListener('click', async () => {
      if (!clean.value) return toast('복사할 텍스트가 없습니다');
      try {
        await navigator.clipboard.writeText(clean.value);
        toast('복사했습니다');
      } catch {
        toast('복사하지 못했습니다');
      }
    }, { signal });

    updateCounts();

    return () => {
      clearTimeout(compare.timer);
      clearTimeout(updateCounts.timer);
      controller.abort();
    };
  },
};

export default module;
