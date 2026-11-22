/**
 * TIP · 앱 아이콘 생성기 (icon-gen)
 * 이미지 1장 → 16·32·48·180·192·512·1024px PNG 7종 + manifest 스니펫 ZIP.
 * Canvas 리사이즈와 ZIP 묶기(JSZip) 모두 기기 안에서 처리한다.
 */

import { formatBytes, icons } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 15V9l4 3 4-3v6"/></svg>`;

const SIZES = [16, 32, 48, 180, 192, 512, 1024];

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

function toBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
        image.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

function drawIcon(source, size, mode, background) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (mode === 'pad') {
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);
  }
  const scale = mode === 'crop'
    ? Math.max(size / source.width, size / source.height)
    : Math.min(size / source.width, size / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  context.drawImage(source, (size - width) / 2, (size - height) / 2, width, height);
  return canvas;
}

function manifestSnippet() {
  return JSON.stringify({
    icons: SIZES.map((size) => ({
      src: `icons/icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
    })),
  }, null, 2);
}

const module = {
  id: 'icon-gen',
  name: '앱 아이콘 생성기',
  kind: 'tool',
  category: 'utility',
  version: '1.0.0',
  subtitle: 'PNG 7종 · manifest 스니펫',
  description: '이미지 한 장으로 앱 아이콘 크기 7종(16~1024px) PNG와 manifest 스니펫을 ZIP으로 만듭니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});

    let file = null;
    let bitmap = null;
    let mode = 'crop';
    let results = [];

    root.innerHTML = `
      <div class="v16 ig">
        <div class="dr-empty" id="ig-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="ig-browse">${icons.upload} 이미지 선택</button>
          <p>PNG · JPG · WebP · SVG — 1024px 이상을 권장합니다</p>
        </div>
        <input type="file" id="ig-input" class="sr-only" accept="image/*">

        <div id="ig-main" hidden>
          <div class="filebar">
            <img class="ic-thumb" id="ig-thumb" alt="">
            <div class="f-info">
              <div class="f-name" id="ig-name"></div>
              <div class="f-meta" id="ig-meta"></div>
            </div>
            <button class="icon-btn" type="button" id="ig-remove" aria-label="이미지 빼기">${icons.close}</button>
          </div>

          <div class="ic-options">
            <div class="ic-row">
              <span class="ic-label">맞춤</span>
              <div class="ic-segment" id="ig-modes" role="radiogroup" aria-label="맞춤 방식"></div>
            </div>
            <div class="ic-row" id="ig-bg-row" hidden>
              <span class="ic-label">배경</span>
              <input class="ig-color" type="color" id="ig-bg" value="#ffffff" aria-label="여백 배경색">
              <span class="ic-hint">빈 여백을 채울 색</span>
            </div>
          </div>

          <div class="v16-actions">
            <button class="v16-btn primary" type="button" id="ig-run">PNG 7종 만들기</button>
            <button class="v16-btn" type="button" id="ig-zip" disabled>ZIP 저장</button>
            <button class="v16-btn" type="button" id="ig-clear">비우기</button>
          </div>

          <div class="v16-status" id="ig-status" hidden></div>
          <div class="ig-grid" id="ig-grid"></div>

          <div class="ig-manifest" id="ig-manifest" hidden>
            <div class="v16-block-head">
              <span>manifest-snippet.json</span>
              <button class="v16-mini" type="button" id="ig-copy-manifest">복사</button>
            </div>
            <pre class="v16-out" id="ig-manifest-text"></pre>
            <p class="v16-note">ZIP 안의 icons/ 폴더를 프로젝트에 풀면 이 경로 그대로 쓸 수 있습니다.</p>
          </div>
        </div>
      </div>`;

    const empty = root.querySelector('#ig-empty');
    const input = root.querySelector('#ig-input');
    const main = root.querySelector('#ig-main');
    const thumb = root.querySelector('#ig-thumb');
    const nameEl = root.querySelector('#ig-name');
    const metaEl = root.querySelector('#ig-meta');
    const modesEl = root.querySelector('#ig-modes');
    const bgRow = root.querySelector('#ig-bg-row');
    const bgInput = root.querySelector('#ig-bg');
    const statusEl = root.querySelector('#ig-status');
    const gridEl = root.querySelector('#ig-grid');
    const manifestEl = root.querySelector('#ig-manifest');
    const manifestText = root.querySelector('#ig-manifest-text');
    const zipBtn = root.querySelector('#ig-zip');

    const MODES = [
      { id: 'crop', label: '정사각 크롭' },
      { id: 'pad', label: '여백 맞춤' },
    ];

    MODES.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ic-seg';
      button.textContent = item.label;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(item.id === mode));
      button.addEventListener('click', () => {
        mode = item.id;
        modesEl.querySelectorAll('.ic-seg').forEach((el) => el.setAttribute('aria-checked', 'false'));
        button.setAttribute('aria-checked', 'true');
        bgRow.hidden = mode !== 'pad';
      }, { signal });
      modesEl.appendChild(button);
    });

    function setStatus(kind, text) {
      statusEl.hidden = !text;
      statusEl.className = `v16-status${kind ? ` ${kind}` : ''}`;
      statusEl.textContent = text || '';
    }

    function resetResults() {
      results.forEach((result) => URL.revokeObjectURL(result.url));
      results = [];
      gridEl.innerHTML = '';
      manifestEl.hidden = true;
      zipBtn.disabled = true;
    }

    async function loadFile(nextFile) {
      if (!nextFile) return;
      if (!/^image\//.test(nextFile.type) && !/\.(png|jpe?g|webp|gif|bmp|svg|avif|ico)$/i.test(nextFile.name)) {
        setStatus('warn', '이미지 파일만 넣을 수 있습니다.');
        return;
      }
      try {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        bitmap = await decodeImage(nextFile);
      } catch (error) {
        console.error('[TIP icon-gen]', error);
        setStatus('bad', '이미지를 읽지 못했습니다. 다른 파일로 시도해 보세요.');
        return;
      }
      file = nextFile;
      resetResults();
      empty.hidden = true;
      main.hidden = false;
      nameEl.textContent = file.name;
      metaEl.textContent = `${bitmap.width} × ${bitmap.height}px · ${formatBytes(file.size)}`;
      const url = URL.createObjectURL(file);
      thumb.src = url;
      thumb.onload = () => URL.revokeObjectURL(url);
      setStatus('ok', bitmap.width >= 512
        ? '만들 준비가 됐습니다.'
        : '원본이 작아 512 · 1024px는 확대되어 조금 흐려질 수 있습니다.');
    }

    function renderManifest() {
      manifestText.textContent = manifestSnippet();
      manifestEl.hidden = false;
    }

    async function run() {
      if (!bitmap) return;
      const runBtn = root.querySelector('#ig-run');
      runBtn.disabled = true;
      runBtn.textContent = '만드는 중…';
      setStatus('', '');
      resetResults();

      try {
        const background = bgInput.value || '#ffffff';
        for (const size of SIZES) {
          const canvas = drawIcon(bitmap, size, mode, background);
          const blob = await toBlob(canvas);
          if (!blob) throw new Error('PNG를 만들지 못했습니다.');
          results.push({ size, blob, width: canvas.width, height: canvas.height, url: URL.createObjectURL(blob) });
        }
      } catch (error) {
        console.error('[TIP icon-gen]', error);
        setStatus('bad', `아이콘을 만들지 못했습니다 — ${error.message}`);
        runBtn.disabled = false;
        runBtn.textContent = 'PNG 7종 만들기';
        return;
      }

      gridEl.innerHTML = results.map((result) => `
        <button class="ig-item" type="button" data-size="${result.size}" aria-label="icon-${result.size}.png 저장">
          <img src="${result.url}" alt="icon ${result.size}px">
          <span>${result.size}px</span>
          <em>${formatBytes(result.blob.size)}</em>
        </button>`).join('');
      gridEl.querySelectorAll('.ig-item').forEach((button) => {
        button.addEventListener('click', () => {
          const found = results.find((result) => String(result.size) === button.dataset.size);
          if (found) download(found.blob, `icon-${found.size}.png`);
        }, { signal });
      });

      renderManifest();
      zipBtn.disabled = false;
      setStatus('ok', `PNG ${results.length}종을 만들었습니다 · 합계 ${formatBytes(results.reduce((sum, r) => sum + r.blob.size, 0))}`);
      runBtn.disabled = false;
      runBtn.textContent = 'PNG 7종 만들기';
    }

    async function makeZip() {
      if (!results.length) return;
      if (!window.JSZip) {
        setStatus('bad', 'ZIP 라이브러리를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도하세요.');
        return;
      }
      zipBtn.disabled = true;
      try {
        const zip = new window.JSZip();
        results.forEach((result) => zip.file(`icons/icon-${result.size}.png`, result.blob));
        zip.file('manifest-snippet.json', manifestSnippet());
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        download(blob, 'app-icons.zip');
        setStatus('ok', `app-icons.zip 저장 · PNG ${results.length}개 + manifest-snippet.json · ${formatBytes(blob.size)}`);
      } catch (error) {
        console.error('[TIP icon-gen]', error);
        setStatus('bad', `ZIP을 만들지 못했습니다 — ${error.message}`);
      } finally {
        zipBtn.disabled = false;
      }
    }

    root.querySelector('#ig-browse').addEventListener('click', () => input.click(), { signal });
    input.addEventListener('change', () => {
      loadFile(input.files && input.files[0]);
      input.value = '';
    }, { signal });
    root.querySelector('#ig-run').addEventListener('click', run, { signal });
    zipBtn.addEventListener('click', makeZip, { signal });
    root.querySelector('#ig-remove').addEventListener('click', () => {
      resetResults();
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      bitmap = null;
      file = null;
      main.hidden = true;
      empty.hidden = false;
      setStatus('', '');
    }, { signal });
    root.querySelector('#ig-clear').addEventListener('click', () => {
      resetResults();
      setStatus('', '');
    }, { signal });
    root.querySelector('#ig-copy-manifest').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(manifestSnippet());
        toast('manifest 스니펫을 복사했습니다');
      } catch {
        toast('복사하지 못했습니다');
      }
    }, { signal });

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
      if (dropped) loadFile(dropped);
    }, { signal });

    return () => {
      resetResults();
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      controller.abort();
    };
  },
};

export default module;
