/**
 * 문서 안 찾기 (v1.26.0) — 표·본문·코드 뷰 어디서나 같은 막대를 쓴다.
 *
 * 찾은 곳은 <mark class="dr-hit"> 로 감싸고, 지금 보고 있는 곳에만 .is-current 를 준다.
 * 강조를 지울 때는 처음 잡아 둔 HTML 로 되돌린다(원문을 건드리지 않는다).
 */

export function findBarHTML(prefix) {
  return `
    <div class="dr-find" role="search">
      <input type="search" id="${prefix}-q" class="dr-find-input" placeholder="문서에서 찾기"
             aria-label="문서에서 찾기" autocomplete="off" spellcheck="false">
      <span class="dr-find-count" id="${prefix}-n" aria-live="polite">0/0</span>
      <button class="tool-btn" type="button" id="${prefix}-prev" aria-label="이전 찾기" title="이전 찾기">↑</button>
      <button class="tool-btn" type="button" id="${prefix}-next" aria-label="다음 찾기" title="다음 찾기">↓</button>
    </div>`;
}

export function extOf(filename) {
  const match = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return match ? match[1].toLowerCase() : '';
}

export function createFinder(scope, root, prefix) {
  const input = root.querySelector(`#${prefix}-q`);
  const count = root.querySelector(`#${prefix}-n`);
  const prev = root.querySelector(`#${prefix}-prev`);
  const next = root.querySelector(`#${prefix}-next`);
  let snapshot = scope.innerHTML;
  let marks = [];
  let index = -1;

  function label() {
    if (count) count.textContent = marks.length ? `${index + 1}/${marks.length}` : '0/0';
  }

  function clear() {
    if (marks.length) scope.innerHTML = snapshot;
    marks = [];
    index = -1;
    label();
  }

  function focusMark() {
    marks.forEach((mark, position) => mark.classList.toggle('is-current', position === index));
    const mark = marks[index];
    if (!mark) return;
    const stage = scope.closest('.doc-stage') || scope.parentElement;
    if (stage) {
      const box = mark.getBoundingClientRect();
      const frame = stage.getBoundingClientRect();
      if (box.top < frame.top + 8 || box.bottom > frame.bottom - 8) {
        stage.scrollTop += box.top - frame.top - frame.height / 3;
      }
      const left = mark.offsetLeft;
      if (Number.isFinite(left) && left > stage.scrollLeft && left < stage.scrollLeft + stage.clientWidth) {
        // 가로 표에서도 보이게 — 이미 보이면 건드리지 않는다.
      }
    }
  }

  function apply(query) {
    clear();
    const needle = String(query || '').trim();
    if (!needle) return;
    const lower = needle.toLowerCase();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('script,style,noscript')) return NodeFilter.FILTER_REJECT;
        return node.nodeValue && node.nodeValue.toLowerCase().includes(lower)
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const value = node.nodeValue;
      const pieces = [];
      let cursor = 0;
      let at = value.toLowerCase().indexOf(lower);
      while (at >= 0) {
        if (at > cursor) pieces.push(document.createTextNode(value.slice(cursor, at)));
        const mark = document.createElement('mark');
        mark.className = 'dr-hit';
        mark.textContent = value.slice(at, at + needle.length);
        pieces.push(mark);
        marks.push(mark);
        cursor = at + needle.length;
        at = value.toLowerCase().indexOf(lower, cursor);
      }
      if (!pieces.length) continue;
      if (cursor < value.length) pieces.push(document.createTextNode(value.slice(cursor)));
      const fragment = document.createDocumentFragment();
      pieces.forEach((piece) => fragment.append(piece));
      node.replaceWith(fragment);
    }

    index = marks.length ? 0 : -1;
    label();
    focusMark();
  }

  function step(direction) {
    if (!marks.length) return;
    index = (index + direction + marks.length) % marks.length;
    label();
    focusMark();
  }

  input?.addEventListener('input', () => apply(input.value));
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!marks.length) apply(input.value);
      else step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      input.value = '';
      clear();
    }
  });
  prev?.addEventListener('click', () => step(-1));
  next?.addEventListener('click', () => step(1));

  return {
    /** 내용을 다시 그린 뒤(시트 전환·장 이동 등) 강조 기준을 새로 잡는다. */
    refresh({ keep = false } = {}) {
      const query = keep ? input?.value || '' : '';
      if (input && !keep) input.value = '';
      marks = [];
      index = -1;
      snapshot = scope.innerHTML;
      label();
      if (query) apply(query);
    },
    apply,
    clear,
    get query() { return input?.value || ''; },
  };
}

/** 공통 toolbar 뼈대 — 왼쪽 묶음 + 오른쪽 묶음. */
export function toolbarHTML(groups) {
  const left = groups.left || '';
  const right = groups.right || '';
  return `<div class="doc-toolbar dr-toolbar">${left}${right ? `<div class="tool-group right">${right}</div>` : ''}</div>`;
}
