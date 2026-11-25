/**
 * TIP · 글자 추출 (ocr-reader, v1.16.0 — 통합 OCR)
 *
 * v1.16.0 에서 예전 이미지 글자 인식과 Mac 전용 화면 글자 읽기(drag-ocr)를 하나로 합쳤다.
 *   · 화면에서 — 화면의 한 영역을 드래그해 찍고 바로 읽는다. (Mac 앱 전용, 화면 기록 권한)
 *   · 이미지에서 — PNG·JPG·WebP·BMP 이미지를 고르거나 끌어다 놓는다. (웹·Mac 공통)
 * 인식은 tesseract.js(vendor 셀프호스팅)로 기기 안에서만 한다. 이미지는 어디로도 전송되지 않는다.
 *
 * 예전 주소 #/drag-ocr 은 js/app.js 가 이 모듈의 '화면에서' 모드로 보낸다.
 * 예전 드래그 OCR 전역 단축키(feature key 'drag-ocr')와 OCR 언어 설정도 그대로 쓴다.
 */

import { formatBytes, icons } from '../../js/ui.js';
import { getFeatureValue } from '../../js/feature-settings.js';
import { appendContinueBar } from '../../js/continue.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 9h8M12 9v7M10 16h4"/></svg>`;

const LANGS = [
  { id: 'kor+eng', label: '한국어 + 영어', data: ['kor', 'eng'], size: '약 3MB' },
  { id: 'kor', label: '한국어', data: ['kor'], size: '약 1.1MB' },
  { id: 'eng', label: '영어', data: ['eng'], size: '약 2.0MB' },
  { id: 'jpn', label: '일본어', data: ['jpn'], size: '약 3MB' },
];

const STATUS_KO = {
  'loading tesseract core': '인식 엔진 불러오는 중',
  'initializing tesseract': '인식 엔진 초기화 중',
  'loading language traineddata': '언어 데이터 준비 중',
  'initializing api': '언어 데이터 적용 중',
  'recognizing text': '글자 읽는 중',
};

/** WASM SIMD 지원 여부 — 지원하면 더 빠른 LSTM 전용 코어를 쓴다. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

function hasSimd() {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

function baseName(name) {
  return String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

let tesseractLoader = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoader) return tesseractLoader;
  tesseractLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/tesseract/tesseract.min.js', window.location.href).href;
    script.onload = () => (window.Tesseract
      ? resolve(window.Tesseract)
      : reject(new Error('인식 엔진을 찾지 못했습니다.')));
    script.onerror = () => {
      tesseractLoader = null;
      reject(new Error('인식 엔진 스크립트를 불러오지 못했습니다.'));
    };
    document.head.appendChild(script);
  });
  return tesseractLoader;
}

const LANG_CACHE = 'tip-ocr-lang-v1';

const module = {
  id: 'ocr-reader',
  name: '글자 추출',
  shortName: '글자 추출',
  kind: 'tool',
  category: 'docs',
  version: '1.16.0',
  subtitle: '화면이나 이미지에서 글자만',
  description: '화면의 한 영역을 드래그해 찍거나 이미지를 골라 한국어, 영어, 일본어 글자를 읽습니다. 추출한 글자는 고쳐서 복사하거나 TXT 로 저장하고, 텍스트 비교나 마크다운으로 이어서 보낼 수 있습니다.',
  icon: ICON,
  accepts: ['image/*'],
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    let file = null;
    let previewUrl = null;
    // v1.14.0 — 설정(설정 → 모듈 → 글자 추출)에서 고른 언어로 시작한다.
    let langId = (() => {
      const saved = getFeatureValue('ocr.lang', 'kor+eng');
      return LANGS.some((lang) => lang.id === saved) ? saved : LANGS[0].id;
    })();
    let mode = TAURI ? 'screen' : 'image';
    let worker = null;
    let workerLangId = null;
    let busy = false;
    let lastText = '';

    root.innerHTML = `
      <div class="v16 ocr">
        <div class="ic-segment ocr-modes" id="ocr-modes" role="tablist" aria-label="글자를 가져올 곳"></div>

        <div class="dr-empty" id="ocr-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="ocr-start"></button>
          <p id="ocr-empty-note"></p>
        </div>
        <input type="file" id="ocr-input" class="sr-only" accept="image/*">

        <div id="ocr-main" hidden>
          <div class="filebar">
            <img class="ic-thumb" id="ocr-thumb" alt="">
            <div class="f-info">
              <div class="f-name" id="ocr-name"></div>
              <div class="f-meta" id="ocr-meta"></div>
            </div>
            <button class="icon-btn" type="button" id="ocr-remove" aria-label="이미지 빼기">${icons.close}</button>
          </div>

          <div class="ic-options">
            <div class="ic-row">
              <span class="ic-label">언어</span>
              <div class="ic-segment" id="ocr-langs" role="radiogroup" aria-label="인식 언어"></div>
            </div>
          </div>

          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="ocr-run">텍스트 추출</button>
            <button class="v16-btn" type="button" id="ocr-again">다시 찍기</button>
            <button class="v16-btn" type="button" id="ocr-clear">비우기</button>
          </div>
          <p class="v16-note" id="ocr-note">처음 실행할 때 인식 언어 데이터를 한 번만 기기에 저장합니다. 이후에는 오프라인에서도 동작합니다.</p>

          <div class="ocr-progress" id="ocr-progress" hidden>
            <div class="ocr-bar"><span id="ocr-fill"></span></div>
            <div class="ocr-status" id="ocr-status"></div>
          </div>
          <div class="v16-status" id="ocr-error" hidden></div>

          <div class="ocr-result" id="ocr-result" hidden>
            <div class="v16-block-head">
              <span>추출한 텍스트</span>
              <span class="ocr-count" id="ocr-count"></span>
            </div>
            <textarea class="v16-ta" id="ocr-text" rows="10" spellcheck="false"
                      aria-label="추출한 텍스트 (편집 가능)"></textarea>
            <div class="v16-actions">
              <button class="v16-btn" type="button" id="ocr-copy">복사</button>
              <button class="v16-btn" type="button" id="ocr-save">TXT 저장</button>
            </div>
            <div id="ocr-continue"></div>
          </div>
        </div>
      </div>`;

    const modesEl = root.querySelector('#ocr-modes');
    const empty = root.querySelector('#ocr-empty');
    const emptyNote = root.querySelector('#ocr-empty-note');
    const startBtn = root.querySelector('#ocr-start');
    const input = root.querySelector('#ocr-input');
    const main = root.querySelector('#ocr-main');
    const thumb = root.querySelector('#ocr-thumb');
    const nameEl = root.querySelector('#ocr-name');
    const metaEl = root.querySelector('#ocr-meta');
    const langsEl = root.querySelector('#ocr-langs');
    const progress = root.querySelector('#ocr-progress');
    const fill = root.querySelector('#ocr-fill');
    const statusEl = root.querySelector('#ocr-status');
    const errorEl = root.querySelector('#ocr-error');
    const resultEl = root.querySelector('#ocr-result');
    const textEl = root.querySelector('#ocr-text');
    const countEl = root.querySelector('#ocr-count');
    const runBtn = root.querySelector('#ocr-run');
    const noteEl = root.querySelector('#ocr-note');

    /* ---------------------------- 가져올 곳 ---------------------------- */

    const MODES = [
      ...(TAURI ? [{ id: 'screen', label: '화면에서' }] : []),
      { id: 'image', label: '이미지에서' },
    ];

    function paintMode() {
      MODES.forEach((item) => {
        const button = modesEl.querySelector(`[data-mode="${item.id}"]`);
        const selected = item.id === mode;
        button.setAttribute('aria-selected', String(selected));
        button.setAttribute('aria-checked', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      startBtn.innerHTML = mode === 'screen'
        ? `${icons.fit || ''} 화면 영역 드래그해서 찍기`
        : `${icons.upload} 이미지 선택`;
      emptyNote.textContent = mode === 'screen'
        ? '찍은 영역의 글자를 기기 안에서 읽습니다. 처음 한 번은 화면 기록 권한을 물어봅니다.'
        : 'PNG·JPG·WebP·BMP 이미지를 고르거나 끌어다 놓으세요. 글자가 또렷할수록 잘 읽습니다.';
      root.querySelector('#ocr-again').textContent = mode === 'screen' ? '다시 찍기' : '다른 이미지';
    }

    MODES.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ic-seg';
      button.dataset.mode = item.id;
      button.textContent = item.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === mode));
      button.setAttribute('aria-checked', String(item.id === mode));
      button.tabIndex = item.id === mode ? 0 : -1;
      button.addEventListener('click', () => {
        if (busy) return;
        mode = item.id;
        paintMode();
      }, { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = MODES.findIndex((entry) => entry.id === item.id);
        const next = MODES[(index + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
        mode = next.id;
        paintMode();
        modesEl.querySelector(`[data-mode="${next.id}"]`).focus();
      }, { signal });
      modesEl.append(button);
    });
    paintMode();

    LANGS.forEach((lang) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ic-seg';
      button.textContent = lang.label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(lang.id === langId));
      button.addEventListener('click', () => {
        if (busy) return;
        langId = lang.id;
        langsEl.querySelectorAll('.ic-seg').forEach((el) => el.setAttribute('aria-checked', 'false'));
        button.setAttribute('aria-checked', 'true');
        noteEl.textContent = `처음 실행할 때 ${lang.label} 인식 데이터(${lang.size})를 한 번만 기기에 저장합니다. 이후에는 오프라인에서도 동작합니다.`;
      }, { signal });
      langsEl.appendChild(button);
    });

    function setError(text) {
      errorEl.hidden = !text;
      errorEl.className = `v16-status${text ? ' bad' : ''}`;
      errorEl.textContent = text || '';
    }

    function setProgress(ratio, text) {
      progress.hidden = false;
      fill.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
      statusEl.textContent = text;
    }

    function hideProgress() {
      progress.hidden = true;
      fill.style.width = '0%';
    }

    function updateCount() {
      const value = textEl.value;
      const bytes = new TextEncoder().encode(value).length;
      countEl.textContent = `${value.length.toLocaleString()}자, ${formatBytes(bytes)}`;
    }

    /**
     * 언어 데이터를 우리 캐시(tip-ocr-lang-v1)에 넣는다.
     * sw.js 는 이 경로를 프리캐시하지 않고, 서비스 워커의 caches.match()가 이 캐시를 함께 찾으므로
     * 한 번 저장된 뒤에는 워커의 fetch도 오프라인에서 해결된다.
     */
    async function ensureLangData(lang) {
      if (!('caches' in window)) return;
      let cache;
      try {
        cache = await caches.open(LANG_CACHE);
      } catch {
        return;
      }
      for (let index = 0; index < lang.data.length; index += 1) {
        const code = lang.data[index];
        const url = new URL(`./vendor/tesseract/lang/${code}.traineddata.gz`, window.location.href).href;
        const hit = await cache.match(url);
        if (hit) continue;
        setProgress(index / lang.data.length, `언어 데이터 준비 중 (${index + 1}/${lang.data.length})`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`언어 데이터(${code})를 불러오지 못했습니다.`);
        await cache.put(url, response.clone());
      }
    }

    async function getWorker(lang) {
      if (worker && workerLangId === lang.id) return worker;
      if (worker) {
        try { await worker.terminate(); } catch { /* 이미 끝났으면 무시 */ }
        worker = null;
        workerLangId = null;
      }
      const Tesseract = await loadTesseract();
      const coreFile = hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
      worker = await Tesseract.createWorker(lang.id, 1, {
        workerPath: new URL('./vendor/tesseract/worker.min.js', window.location.href).href,
        corePath: new URL(`./vendor/tesseract/core/${coreFile}`, window.location.href).href,
        langPath: new URL('./vendor/tesseract/lang', window.location.href).href,
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger: (message) => {
          const label = STATUS_KO[message.status] || message.status;
          const ratio = message.status === 'recognizing text' ? message.progress : 0;
          if (message.status === 'recognizing text') setProgress(ratio, `${label} ${Math.round(ratio * 100)}%`);
          else setProgress(ratio, label);
        },
      });
      workerLangId = lang.id;
      return worker;
    }

    async function run() {
      if (!file || busy) return;
      const lang = LANGS.find((item) => item.id === langId) || LANGS[0];
      busy = true;
      runBtn.disabled = true;
      runBtn.textContent = '읽는 중…';
      setError('');
      resultEl.hidden = true;

      try {
        await ensureLangData(lang);
        const instance = await getWorker(lang);
        const { data } = await instance.recognize(file);
        const text = (data.text || '').replace(/\n{4,}/g, '\n\n\n').trim();
        lastText = text;
        textEl.value = text;
        updateCount();
        // v1.14.0 — 설정에서 켜 두면 추출한 글자를 바로 복사한다(드래그 OCR 단축키 흐름).
        if (text && getFeatureValue('ocr.autoCopy', true)) {
          navigator.clipboard.writeText(text).catch(() => {
            if (C) C.invoke('copy_text', { text }).catch(() => {});
          });
        }
        resultEl.hidden = false;
        hideProgress();
        if (!text) {
          setError('글자를 찾지 못했습니다. 이미지가 흐리거나 글자가 너무 작으면 인식되지 않을 수 있습니다.');
        } else {
          const confidence = Math.round(data.confidence || 0);
          setProgress(1, `완료, 평균 신뢰도 ${confidence}%`);
          paintContinue();
        }
      } catch (error) {
        console.error('[TIP ocr-reader]', error);
        hideProgress();
        setError(`텍스트를 추출하지 못했습니다. ${error.message}`);
      } finally {
        busy = false;
        runBtn.disabled = false;
        runBtn.textContent = '텍스트 추출';
      }
    }

    /** v1.16.0 — 결과를 텍스트 비교·마크다운 편집기로 이어 보낸다(저장소에 남기지 않음). */
    function paintContinue() {
      const text = textEl.value.trim();
      appendContinueBar(root.querySelector('#ocr-continue'), ctx, text ? [
        { id: 'text-diff', label: '텍스트 비교', payload: { text } },
        { id: 'md-editor', label: '마크다운으로 쓰기', payload: { text } },
      ] : []);
    }

    function loadFile(nextFile) {
      if (!nextFile) return;
      if (!/^image\//.test(nextFile.type)) {
        setError('이미지 파일만 넣을 수 있습니다.');
        return;
      }
      file = nextFile;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      thumb.src = previewUrl;
      nameEl.textContent = file.name;
      metaEl.textContent = formatBytes(file.size);
      empty.hidden = true;
      main.hidden = false;
      resultEl.hidden = true;
      setError('');
      hideProgress();
    }

    /** v1.16.0 — 화면에서: macOS 의 screencapture 로 한 영역을 찍어 바로 읽는다. */
    async function captureFromScreen() {
      if (!TAURI || busy) return;
      const label = startBtn.textContent;
      busy = true;
      startBtn.disabled = true;
      startBtn.textContent = '영역을 고르세요…';
      setError('');
      try {
        const capture = await C.invoke('capture_region');
        if (!capture || !capture.png) throw new Error('찍은 화면이 없습니다');
        const binary = atob(capture.png);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        loadFile(new File([bytes], 'screen-shot.png', { type: 'image/png' }));
        await run();
      } catch (error) {
        const message = typeof error === 'string' ? error : (error && error.message) || '';
        if (message === '취소' || /취소/.test(message)) {
          toast('화면 찍기를 취소했습니다');
        } else if (message.includes('[permission]')) {
          setError(message.replace('[permission]', '').trim());
          const button = document.createElement('button');
          button.className = 'v16-btn';
          button.type = 'button';
          button.textContent = '화면 기록 설정 열기';
          button.addEventListener('click', () => {
            C.invoke('open_privacy_settings', { kind: 'screen-recording' }).catch(() => {});
          }, { signal });
          root.querySelector('#ocr-main').prepend(button);
        } else {
          console.error('[TIP ocr-reader]', error);
          toast('화면을 찍지 못했습니다');
        }
      } finally {
        busy = false;
        startBtn.disabled = false;
        startBtn.textContent = label;
      }
    }

    startBtn.addEventListener('click', () => {
      if (mode === 'screen') captureFromScreen();
      else input.click();
    }, { signal });
    input.addEventListener('change', () => {
      loadFile(input.files && input.files[0]);
      input.value = '';
    }, { signal });
    runBtn.addEventListener('click', run, { signal });
    root.querySelector('#ocr-again').addEventListener('click', () => {
      if (mode === 'screen') captureFromScreen();
      else input.click();
    }, { signal });
    root.querySelector('#ocr-clear').addEventListener('click', () => {
      resultEl.hidden = true;
      textEl.value = '';
      lastText = '';
      setError('');
      hideProgress();
    }, { signal });
    root.querySelector('#ocr-remove').addEventListener('click', async () => {
      file = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      main.hidden = true;
      empty.hidden = false;
      resultEl.hidden = true;
      textEl.value = '';
      lastText = '';
      setError('');
      hideProgress();
      if (worker) {
        try { await worker.terminate(); } catch { /* 무시 */ }
        worker = null;
        workerLangId = null;
      }
    }, { signal });
    textEl.addEventListener('input', () => {
      updateCount();
      if (textEl.value.trim() !== lastText) paintContinue();
    }, { signal });
    root.querySelector('#ocr-copy').addEventListener('click', async () => {
      if (!textEl.value) return toast('복사할 텍스트가 없습니다');
      try {
        await navigator.clipboard.writeText(textEl.value);
        toast('복사했습니다');
      } catch {
        toast('복사하지 못했습니다');
      }
    }, { signal });
    root.querySelector('#ocr-save').addEventListener('click', () => {
      if (!textEl.value) return toast('저장할 텍스트가 없습니다');
      const name = `${baseName(file?.name)}-text.txt`;
      download(new Blob([textEl.value], { type: 'text/plain;charset=utf-8' }), name);
    }, { signal });

    /* v1.14.0 — 전역 단축키로 찍어 둔 화면이 있으면 이 창이 열리자마자 불러와 읽는다. */
    async function takePendingShot() {
      if (!C) return;
      try {
        const shot = await C.invoke('take_pending_shot');
        if (!shot) return;
        const base64 = await C.invoke('read_capture', { path: shot });
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const image = new File([bytes], 'screen-shot.png', { type: 'image/png' });
        mode = 'screen';
        paintMode();
        loadFile(image);
        run();
      } catch (error) {
        console.warn('[TIP ocr-reader] 찍어 둔 화면을 불러오지 못했습니다', error);
      }
    }

    // v1.16.0 — 앞 모듈(화면 글자 읽기 주소·전역 단축키)이나 '이어서 하기'로 온 값.
    if (ctx?.intent?.mode === 'screen' && TAURI) {
      mode = 'screen';
      paintMode();
    }
    const continued = ctx?.takeContinue ? ctx.takeContinue() : null;
    if (continued && continued.file) {
      mode = 'image';
      paintMode();
      loadFile(continued.file);
    } else {
      takePendingShot();
    }

    ['dragenter', 'dragover'].forEach((type) =>
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.add('dr-over');
      }, { signal }));
    ['dragleave', 'drop'].forEach((type) =>
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.remove('dr-over');
      }, { signal }));
    root.addEventListener('drop', (event) => {
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) {
        mode = 'image';
        paintMode();
        loadFile(dropped);
      }
    }, { signal });

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      if (worker) {
        worker.terminate().catch(() => {});
        worker = null;
        workerLangId = null;
      }
      controller.abort();
    };
  },
};

export default module;
