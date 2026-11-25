/**
 * TIP · 한영 타자 변환 (typing-converter, v1.16.0)
 *
 * 한글을 두벌식 영문 글쇠로(안녕 → dkssud), 영문 글쇠를 한글로(dkssud → 안녕) 바꾼다.
 * 겹받침·이중모음 양방향. 클립보드 히스토리에도 같은 변환('한영 변환해서 복사')이 붙는다.
 */

import { koToEn, enToKo } from '../../js/typing.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11M8 7v10M6 17h4"/><path d="M14 4l6 8-6 8"/></svg>`;

const module = {
  id: 'typing-converter',
  name: '한영 타자 변환',
  shortName: '한영 변환',
  kind: 'tool',
  category: 'docs',
  version: '1.16.0',
  subtitle: '한글 ↔ 영문 글쇠 바꾸기',
  description: '한글을 두벌식 자판의 영문 글쇠로 바꾸거나, 잘못 눌러 나온 영문을 한글로 되돌립니다. 겹받침과 이중모음도 양쪽으로 바뀝니다.',
  icon: ICON,
  accepts: ['text/*'],
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    let direction = 'ko2en';

    root.innerHTML = `
      <div class="v16 ty">
        <div class="ic-segment ty-modes" id="ty-modes" role="tablist" aria-label="바꾸는 방향"></div>

        <div class="v16-field">
          <label class="v16-label" for="ty-in">바꿀 글</label>
          <textarea class="v16-ta" id="ty-in" rows="6" spellcheck="false"
                    placeholder="안녕하세요 또는 dkssudgktpdy"></textarea>
        </div>

        <div class="v16-field">
          <label class="v16-label" for="ty-out">바뀐 글</label>
          <textarea class="v16-ta" id="ty-out" rows="6" spellcheck="false" readonly></textarea>
        </div>

        <div class="v16-actions">
          <button class="v16-btn" type="button" id="ty-copy">복사</button>
          <button class="v16-btn" type="button" id="ty-swap">결과를 입력으로</button>
          <button class="v16-btn" type="button" id="ty-clear">지우기</button>
        </div>

        <div class="v16-status" id="ty-status" hidden></div>
        <p class="v16-note">두벌식 자판 기준입니다. 한글과 영문이 섞여 있으면 한글만 바뀌고 나머지는 그대로 남습니다.</p>
      </div>`;

    const modesEl = root.querySelector('#ty-modes');
    const inEl = root.querySelector('#ty-in');
    const outEl = root.querySelector('#ty-out');
    const statusEl = root.querySelector('#ty-status');

    const MODES = [
      { id: 'ko2en', label: '한글 → 영문' },
      { id: 'en2ko', label: '영문 → 한글' },
    ];

    function setStatus(text) {
      statusEl.hidden = !text;
      statusEl.className = `v16-status${text ? ' warn' : ''}`;
      statusEl.textContent = text || '';
    }

    function convert() {
      const value = inEl.value;
      const result = direction === 'ko2en' ? koToEn(value) : enToKo(value);
      outEl.value = result;
      if (!value) {
        setStatus('');
        return;
      }
      if (result === value) {
        setStatus(direction === 'ko2en'
          ? '바꿀 한글이 없습니다. 영문은 그대로 둡니다.'
          : '바꿀 영문 글쇠가 없습니다. 한글은 그대로 둡니다.');
      } else {
        setStatus('');
      }
    }

    function paintMode() {
      MODES.forEach((item) => {
        const button = modesEl.querySelector(`[data-mode="${item.id}"]`);
        const selected = item.id === direction;
        button.setAttribute('aria-selected', String(selected));
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      inEl.placeholder = direction === 'ko2en' ? '안녕하세요' : 'dkssudgktpdy';
      convert();
    }

    MODES.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ic-seg';
      button.dataset.mode = item.id;
      button.textContent = item.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === direction));
      button.setAttribute('aria-checked', String(item.id === direction));
      button.tabIndex = item.id === direction ? 0 : -1;
      button.addEventListener('click', () => {
        direction = item.id;
        paintMode();
        inEl.focus({ preventScroll: true });
      }, { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = MODES.findIndex((entry) => entry.id === item.id);
        const next = MODES[(index + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
        direction = next.id;
        paintMode();
        modesEl.querySelector(`[data-mode="${next.id}"]`).focus();
      }, { signal });
      modesEl.append(button);
    });

    inEl.addEventListener('input', convert, { signal });

    root.querySelector('#ty-copy').addEventListener('click', async () => {
      if (!outEl.value) return toast('복사할 결과가 없습니다');
      try {
        await navigator.clipboard.writeText(outEl.value);
        toast('바뀐 글을 복사했습니다');
      } catch {
        toast('복사하지 못했습니다');
      }
    }, { signal });

    root.querySelector('#ty-swap').addEventListener('click', () => {
      if (!outEl.value) return;
      inEl.value = outEl.value;
      direction = direction === 'ko2en' ? 'en2ko' : 'ko2en';
      paintMode();
      inEl.focus({ preventScroll: true });
    }, { signal });

    root.querySelector('#ty-clear').addEventListener('click', () => {
      inEl.value = '';
      outEl.value = '';
      setStatus('');
      inEl.focus({ preventScroll: true });
    }, { signal });

    // '이어서 하기'로 넘어온 글자 — 방향은 글에 맞춰 고른다.
    const continued = ctx?.takeContinue ? ctx.takeContinue() : null;
    if (continued && typeof continued.text === 'string') {
      direction = /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(continued.text) ? 'ko2en' : 'en2ko';
      inEl.value = continued.text;
    }

    paintMode();
    inEl.focus({ preventScroll: true });
    return () => controller.abort();
  },
};

export default module;
