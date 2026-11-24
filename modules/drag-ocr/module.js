/**
 * TIP · 화면 드래그 OCR (drag-ocr, v1.14.0 — Mac 앱 전용)
 *
 * 단축키나 이 버튼으로 화면을 드래그해 찍고, 그 그림을 OCR 모듈로 넘겨 글자를 뽑는다.
 * 캡처는 macOS 의 screencapture 로 하고(화면 기록 권한 필요), 인식은 기존 OCR 모듈이 기기 안에서 한다.
 */

import { getFeatureValue } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 10h8M8 14h5"/></svg>`;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;
const HANDOFF_KEY = 'tip.handoff.v1';

const module = {
  id: 'drag-ocr',
  name: '화면 드래그 OCR',
  shortName: '드래그 OCR',
  kind: 'tool',
  category: 'utility',
  version: '1.14.0',
  subtitle: '화면을 끌어 글자만 뽑기',
  description: '화면의 한 영역을 끌어 찍고 그 안의 글자를 읽습니다.',
  icon: ICON,
  badge: 'Mac',
  macOnly: true,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    root.innerHTML = `
      <div class="v16 dragocr">
        <div class="dr-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="docr-run">화면 영역 드래그해서 찍기</button>
          <p>찍은 영역의 글자를 OCR 모듈이 읽습니다 — 처음 한 번은 화면 기록 권한을 물어봅니다.</p>
        </div>
        <p class="v16-note" id="docr-note">전역 단축키를 걸어 두면 어디서든 한 번에 찍고 바로 글자를 뽑을 수 있습니다.</p>
        <div class="v16-actions">
          <button class="v16-btn" type="button" id="docr-settings">단축키 설정</button>
        </div>
      </div>`;

    const noteEl = root.querySelector('#docr-note');
    const runBtn = root.querySelector('#docr-run');

    if (!TAURI) {
      runBtn.disabled = true;
      noteEl.textContent = '화면 드래그 OCR 은 Mac 앱에서만 쓸 수 있습니다.';
      return () => controller.abort();
    }

    async function run() {
      runBtn.disabled = true;
      const label = runBtn.textContent;
      runBtn.textContent = '영역을 고르세요…';
      try {
        const capture = await C.invoke('capture_region');
        if (!capture || !capture.png) throw new Error('찍은 화면이 없습니다');
        try {
          localStorage.setItem(HANDOFF_KEY, JSON.stringify({
            moduleId: 'ocr-reader',
            name: 'screen-shot.png',
            type: 'image/png',
            dataUrl: `data:image/png;base64,${capture.png}`,
            created: Date.now(),
          }));
        } catch { /* 넘기지 못하면 아래 안내로 */ }

        // 컴팩트 창이면 그 창을 OCR 로 바꾸고, 메인 창이면 화면을 바꾼다.
        if (ctx?.goModule) ctx.goModule('ocr-reader');
        else location.hash = '#/ocr-reader';
        toast('찍은 영역을 OCR 로 넘겼습니다 — [텍스트 추출]을 누르세요');
      } catch (error) {
        const message = typeof error === 'string' ? error : (error && error.message) || '';
        if (message === '취소' || /취소/.test(message)) {
          toast('화면 찍기를 취소했습니다');
        } else if (message.includes('[permission]')) {
          noteEl.textContent = message.replace('[permission]', '').trim();
          const button = document.createElement('button');
          button.className = 'v16-btn';
          button.type = 'button';
          button.textContent = '화면 기록 설정 열기';
          button.addEventListener('click', () => {
            C.invoke('open_privacy_settings', { kind: 'screen-recording' }).catch(() => {});
          }, { signal });
          root.querySelector('.v16-actions').prepend(button);
        } else {
          console.error('[TIP drag-ocr]', error);
          toast('화면을 찍지 못했습니다');
        }
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = label;
      }
    }

    runBtn.addEventListener('click', run, { signal });
    root.querySelector('#docr-settings').addEventListener('click', () => {
      if (ctx?.openSettings) ctx.openSettings('drag-ocr');
      else toast('설정 → 모듈 → 화면 드래그 OCR 에서 단축키를 정할 수 있습니다');
    }, { signal });

    const lang = getFeatureValue('ocr.lang', 'kor+eng');
    const langLabel = { 'kor+eng': '한국어 + 영어', kor: '한국어', eng: '영어', jpn: '일본어' }[lang] || lang;
    noteEl.textContent = `인식 언어: ${langLabel}, 전역 단축키를 걸어 두면 어디서든 한 번에 찍고 글자를 뽑습니다.`;

    return () => controller.abort();
  },
};

export default module;
