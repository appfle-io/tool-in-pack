/* PDF rendering for the doc reader — pdf.js, page canvas, zoom/rotate, iOS pinch. */

import { STAGE_ID } from './renderers.js';

export function createPdfSession(file) {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('pdf.js가 아직 로드되지 않았습니다. 잠시 후 다시 시도하세요.');

  pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';

  const state = {
    doc: null,
    page: 1,
    totalPages: 0,
    rotation: 0,
    zoom: 1,        // used when fitWidth is off; 1 = 100 % of the page's own size
    fitWidth: true,
    rendering: false,
    renderTask: null,
    deviceRatio: Math.min(window.devicePixelRatio || 1, 2),
    onChange: null, // (page, totalPages, zoomPercent) — set by the caller
  };

  const stage = document.getElementById(STAGE_ID);
  stage.classList.add('pdf-stage');
  stage.innerHTML = '<canvas id="dr-canvas"></canvas>';
  const canvas = document.getElementById('dr-canvas');

  function emit() {
    if (state.onChange) {
      state.onChange(state.page, state.totalPages, Math.round(state.fitWidth ? fitScale(state.page) * 100 : state.zoom * 100));
    }
  }

  function cssWidth() {
    return Math.max(stage.clientWidth - 24, 200);
  }

  async function fitScaleAsync() {
    const page = await state.doc.getPage(state.page);
    const viewport = page.getViewport({ scale: 1, rotation: state.rotation });
    return cssWidth() / viewport.width;
  }

  function fitScale() {
    return 1; // exact value computed during render; only used for the label
  }

  async function render() {
    if (!state.doc || state.rendering) return;
    state.rendering = true;
    try {
      const page = await state.doc.getPage(state.page);
      const viewport = page.getViewport({ scale: 1, rotation: state.rotation });

      const scale = state.fitWidth ? cssWidth() / viewport.width : state.zoom;
      const renderViewport = page.getViewport({ scale: scale * state.deviceRatio, rotation: state.rotation });

      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      canvas.style.width = `${Math.floor(renderViewport.width / state.deviceRatio)}px`;
      canvas.style.height = `${Math.floor(renderViewport.height / state.deviceRatio)}px`;

      if (state.renderTask) {
        try { state.renderTask.cancel(); } catch { /* already finished */ }
      }
      const ctx = canvas.getContext('2d');
      state.renderTask = page.render({ canvasContext: ctx, viewport: renderViewport });
      await state.renderTask.promise;
      emit();
    } finally {
      state.rendering = false;
    }
  }

  async function goto(pageNumber) {
    if (!state.doc) return;
    const next = Math.min(Math.max(1, pageNumber), state.totalPages);
    if (next === state.page) return;
    state.page = next;
    await render();
  }

  async function zoomBy(factor) {
    const current = state.fitWidth ? await fitScaleAsync() : state.zoom;
    state.fitWidth = false;
    state.zoom = Math.min(Math.max(0.3, current * factor), 6);
    await render();
  }

  async function fitToWidth() {
    state.fitWidth = true;
    await render();
  }

  async function rotate() {
    state.rotation = (state.rotation + 90) % 360;
    await render();
  }

  // pinch-to-zoom on iOS / two-finger trackpad gestures
  let pinchStart = null;
  stage.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
  }, { passive: true });
  stage.addEventListener('touchmove', async (event) => {
    if (event.touches.length === 2 && pinchStart) {
      const [a, b] = event.touches;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (Math.abs(dist - pinchStart) > 26) {
        await zoomBy(dist / pinchStart);
        pinchStart = dist;
      }
    }
  }, { passive: true });
  stage.addEventListener('touchend', () => { pinchStart = null; }, { passive: true });

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.doc) render();
    }, 180);
  }
  window.addEventListener('resize', onResize);

  async function open() {
    const data = await file.arrayBuffer();
    state.doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    state.totalPages = state.doc.numPages;
    await render();
  }

  return {
    open,
    gotoPage: goto,
    zoomBy,
    fitToWidth,
    rotate,
    get page() { return state.page; },
    get totalPages() { return state.totalPages; },
    set onChange(handler) { state.onChange = handler; },
    async destroy() {
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      if (state.renderTask) {
        try { state.renderTask.cancel(); } catch { /* noop */ }
      }
      if (state.doc) {
        try { await state.doc.destroy(); } catch { /* noop */ }
      }
    },
  };
}
