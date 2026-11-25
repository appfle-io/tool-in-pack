/**
 * TIP · 글자 수 세기 (text-counter, v1.16.0)
 *
 * 붙여 넣는 즉시 글자(공백 포함·제외), 단어, 줄, UTF-8, EUC-KR 바이트, 원고지(200자) 매수,
 * 목표 글자 수까지 남은 수와 진행 막대를 보여 준다. 모두 기기 안에서만 센다.
 * 글자 수는 Intl.Segmenter 의 문자(grapheme) 기준이라 이모지·겹모음도 한 글자로 센다.
 */

import { getFeatureValue, setFeatureValue } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V4h16v2M12 4v16M8 20h8"/><path d="M17 11h3M18.5 11v6"/></svg>`;

const EUC_KR_NOTE = 'EUC-KR 은 한글·한자 2바이트, 영문·숫자·공백 1바이트로 셉니다. 이모지는 EUC-KR 에 없어 2바이트로 셉니다.';

/** 문자(grapheme) 단위로 나눈다 — 이모지·겹받침도 한 글자. */
function graphemes(text) {
  const value = String(text || '');
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
      return [...segmenter.segment(value)].map((part) => part.segment);
    }
  } catch { /* 오래된 브라우저는 아래로 */ }
  return [...value];
}

/** 단어 — 띄어쓰기 기준. 문장부호만 있는 조각은 세지 않는다. */
function words(text) {
  const value = String(text || '').trim();
  if (!value) return 0;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('ko', { granularity: 'word' });
      return [...segmenter.segment(value)].filter((part) => part.isWordLike).length;
    }
  } catch { /* 아래로 */ }
  return value.split(/\s+/).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

/** 줄 — 마지막 빈 줄은 세지 않는다. */
function lines(text) {
  const value = String(text || '');
  if (!value) return 0;
  const parts = value.split(/\r\n|\r|\n/);
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

function utf8Bytes(text) {
  try {
    return new TextEncoder().encode(String(text || '')).length;
  } catch {
    return 0;
  }
}

/** EUC-KR 바이트(추정) — 브라우저에는 EUC-KR 인코더가 없어 규칙으로 센다. */
function eucKrBytes(text) {
  let total = 0;
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    if (code < 0x80) total += 1;
    else total += 2;
  }
  return total;
}

function countAll(text) {
  const all = graphemes(text);
  const withoutSpace = all.filter((ch) => !/\s/.test(ch));
  return {
    withSpace: all.length,
    withoutSpace: withoutSpace.length,
    words: words(text),
    lines: lines(text),
    utf8: utf8Bytes(text),
    eucKr: eucKrBytes(text),
    sheets: Math.ceil(all.length / 200),
  };
}

const module = {
  id: 'text-counter',
  name: '글자 수 세기',
  shortName: '글자 수',
  kind: 'tool',
  category: 'docs',
  version: '1.16.0',
  subtitle: '글자, 단어, 바이트, 원고지',
  description: '글을 붙여 넣으면 공백 포함과 제외 글자 수, 단어, 줄, UTF-8, EUC-KR 바이트, 원고지 매수와 목표 글자 수까지의 진행을 바로 보여 줍니다.',
  icon: ICON,
  accepts: ['text/*'],
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    let target = Math.max(0, Math.floor(Number(getFeatureValue('counter.target', 0)) || 0));

    root.innerHTML = `
      <div class="v16 tc">
        <div class="v16-field">
          <label class="v16-label" for="tc-text">글</label>
          <textarea class="v16-ta tc-ta" id="tc-text" rows="10" spellcheck="false"
                    placeholder="여기에 붙여 넣으면 바로 세어 줍니다"></textarea>
        </div>

        <div class="v16-actions">
          <button class="v16-btn" type="button" id="tc-copy">결과 복사</button>
          <button class="v16-btn" type="button" id="tc-clear">지우기</button>
          <button class="v16-btn" type="button" id="tc-paste">클립보드 붙여넣기</button>
        </div>

        <div class="v16-block">
          <div class="v16-block-head"><span>세는 중</span><span class="tc-live" id="tc-live" aria-live="polite"></span></div>
          <table class="tc-table">
            <caption class="sr-only">글자 수 결과</caption>
            <tr><th scope="row">공백 포함</th><td id="tc-with">0</td></tr>
            <tr><th scope="row">공백 제외</th><td id="tc-without">0</td></tr>
            <tr><th scope="row">단어</th><td id="tc-words">0</td></tr>
            <tr><th scope="row">줄</th><td id="tc-lines">0</td></tr>
            <tr><th scope="row">UTF-8</th><td id="tc-utf8">0 B</td></tr>
            <tr><th scope="row">EUC-KR</th><td id="tc-euckr">0 B</td></tr>
            <tr><th scope="row">원고지(200자)</th><td id="tc-sheets">0매</td></tr>
          </table>
          <p class="v16-note">${EUC_KR_NOTE}</p>
        </div>

        <div class="v16-block">
          <div class="v16-block-head"><span>목표 글자 수</span><span class="tc-live" id="tc-left"></span></div>
          <div class="v16-actions">
            <input class="pt-input v16-input tc-target" id="tc-target" type="number" inputmode="numeric"
                   min="0" step="10" value="${target}" aria-label="목표 글자 수">
            <span class="tc-unit">자</span>
            <button class="v16-btn" type="button" id="tc-target-clear">목표 지우기</button>
          </div>
          <div class="tc-bar" role="progressbar" aria-label="목표까지 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <span class="tc-bar-fill" id="tc-fill"></span>
          </div>
          <p class="v16-note">공백 포함 글자 수로 셉니다. 목표는 이 기기에만 저장됩니다.</p>
        </div>
      </div>`;

    const textEl = root.querySelector('#tc-text');
    const liveEl = root.querySelector('#tc-live');
    const leftEl = root.querySelector('#tc-left');
    const targetEl = root.querySelector('#tc-target');
    const fillEl = root.querySelector('#tc-fill');
    const barEl = root.querySelector('.tc-bar');
    let last = countAll('');

    function formatNumber(value) {
      return Number(value).toLocaleString('ko-KR');
    }

    function paint() {
      const text = textEl.value;
      const result = countAll(text);
      last = result;
      root.querySelector('#tc-with').textContent = formatNumber(result.withSpace);
      root.querySelector('#tc-without').textContent = formatNumber(result.withoutSpace);
      root.querySelector('#tc-words').textContent = formatNumber(result.words);
      root.querySelector('#tc-lines').textContent = formatNumber(result.lines);
      root.querySelector('#tc-utf8').textContent = `${formatNumber(result.utf8)} B`;
      root.querySelector('#tc-euckr').textContent = `${formatNumber(result.eucKr)} B`;
      root.querySelector('#tc-sheets').textContent = `${formatNumber(result.sheets)}매`;
      liveEl.textContent = `${formatNumber(result.withSpace)}자`;
      paintTarget(result.withSpace);
    }

    function paintTarget(length) {
      target = Math.max(0, Math.floor(Number(targetEl.value) || 0));
      const percent = target > 0 ? Math.min(100, Math.round((length / target) * 100)) : 0;
      fillEl.style.width = `${percent}%`;
      barEl.setAttribute('aria-valuenow', String(percent));
      barEl.classList.toggle('is-over', target > 0 && length > target);
      if (!target) {
        leftEl.textContent = '목표를 정하면 남은 글자를 셉니다';
        return;
      }
      const left = target - length;
      leftEl.textContent = left > 0
        ? `${formatNumber(left)}자 남음`
        : (left === 0 ? '목표와 같습니다' : `${formatNumber(-left)}자 넘음`);
    }

    textEl.addEventListener('input', paint, { signal });
    targetEl.addEventListener('input', () => {
      setFeatureValue('counter.target', Math.max(0, Math.floor(Number(targetEl.value) || 0)));
      paintTarget(last.withSpace);
    }, { signal });

    root.querySelector('#tc-target-clear').addEventListener('click', () => {
      targetEl.value = '0';
      setFeatureValue('counter.target', 0);
      paintTarget(last.withSpace);
    }, { signal });

    root.querySelector('#tc-clear').addEventListener('click', () => {
      textEl.value = '';
      paint();
      textEl.focus();
    }, { signal });

    root.querySelector('#tc-copy').addEventListener('click', async () => {
      const summary = [
        `공백 포함 ${formatNumber(last.withSpace)}자`,
        `공백 제외 ${formatNumber(last.withoutSpace)}자`,
        `단어 ${formatNumber(last.words)}개`,
        `줄 ${formatNumber(last.lines)}개`,
        `UTF-8 ${formatNumber(last.utf8)} B`,
        `EUC-KR ${formatNumber(last.eucKr)} B`,
        `원고지 ${formatNumber(last.sheets)}매`,
      ].join('\n');
      try {
        await navigator.clipboard.writeText(summary);
        toast('글자 수 결과를 복사했습니다');
      } catch {
        toast('복사하지 못했습니다');
      }
    }, { signal });

    root.querySelector('#tc-paste').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) {
          toast('클립보드가 비어 있습니다');
          return;
        }
        textEl.value = text;
        paint();
        toast('붙여 넣었습니다');
      } catch {
        toast('클립보드를 읽지 못했습니다. 입력칸을 길게 눌러 붙여 넣어 주세요');
      }
    }, { signal });

    // '이어서 하기'로 넘어온 글자
    const continued = ctx?.takeContinue ? ctx.takeContinue() : null;
    if (continued && typeof continued.text === 'string') {
      textEl.value = continued.text;
    }

    paint();
    textEl.focus({ preventScroll: true });
    return () => controller.abort();
  },
};

export default module;
