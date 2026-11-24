/**
 * TIP · 영상 모자이크 (video-mosaic)
 * 캔버스 위에서 마우스/터치로 사각 영역을 그려 모자이크·블러를 입히고,
 * canvas.captureStream + MediaRecorder 로 그 화면을 그대로 실시간 인코딩한다.
 * SharedArrayBuffer/ffmpeg.wasm 없이 동작 — GitHub Pages(COOP/COEP 없음)에서도 안전.
 * 오디오는 AudioContext(MediaElementSource)로 함께 담는다. 파일은 기기 안에서만 처리.
 */

import { formatBytes, icons } from '../../js/ui.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M7 10h2M12 10h2M17 10h2M7 14h2M12 14h2M17 14h2"/></svg>`;

const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/></svg>';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

const MAX_CANVAS_WIDTH = 1280;

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch { /* 다음 후보 */ }
  }
  return '';
}

function fmtTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(value / 60);
  const s = value - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function download(blob, name) {
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
  return (name || 'clip').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'clip';
}

function noticeBox(kind, title, body) {
  const glyph = { warn: '!', bad: '×', info: 'i' }[kind] || 'i';
  const box = document.createElement('div');
  box.className = `notice${kind === 'info' ? '' : ` ${kind}`}`;
  box.innerHTML = `<span class="n-icon">${glyph}</span>
    <div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
  box.querySelector('.n-title').textContent = title;
  box.querySelector('.n-text').textContent = body;
  return box;
}

const module = {
  id: 'video-mosaic',
  name: '영상 모자이크',
  shortName: '영상 모자이크',
  kind: 'tool',
  category: 'media',
  version: '1.0.0',
  subtitle: '영상 속 얼굴과 번호 가리기',
  description: '영상을 틀어 놓고 가릴 곳을 끌어 지정하면 모자이크나 흐림을 입혀 새 클립으로 저장합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx.toast || (() => {});

    let file = null;
    let videoUrl = null;
    let duration = 0;
    let rects = [];
    let mode = 'mosaic';
    let strength = 24;
    let dragging = null;
    let previewRect = null;
    let rafId = 0;
    let recording = false;
    let recorder = null;
    let chunks = [];
    let result = null;
    let audioCtx = null;
    let audioSource = null;
    let audioDest = null;
    let recordingStart = 0;

    root.innerHTML = `
      <div class="vm">
        <div class="dr-empty vm-empty" id="vm-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="vm-browse">${icons.upload} 영상 선택</button>
          <p>MP4, WebM, MOV — 끌어다 놓아도 됩니다</p>
        </div>
        <input type="file" id="vm-input" class="sr-only" accept="video/*,.mp4,.m4v,.webm,.mov,.ogv">

        <div class="vm-main" id="vm-main" hidden>
          <div class="vm-grid">
            <div class="vm-left">
              <div class="vm-stage" id="vm-stage">
                <canvas id="vm-canvas" aria-label="영상 미리보기 — 가릴 곳을 드래그하세요"></canvas>
                <div class="vm-hint" id="vm-hint">가릴 곳을 드래그하세요</div>
              </div>
              <div class="vm-transport">
                <button class="icon-btn vm-play" type="button" id="vm-play" aria-label="재생">${PLAY}</button>
                <input class="vm-seek" type="range" id="vm-seek" min="0" max="1" step="0.01" value="0" aria-label="재생 위치">
                <span class="vm-time" id="vm-time">0:00.0 / 0:00.0</span>
              </div>
              <div class="vm-info" id="vm-info"></div>
            </div>

            <aside class="vm-panel">
              <section class="pp-card">
                <h3 class="pp-card-title">가리기 방식</h3>
                <div class="ic-segment vm-mode" id="vm-mode" role="radiogroup" aria-label="가리기 방식">
                  <button class="ic-seg" type="button" data-mode="mosaic" aria-checked="true">모자이크</button>
                  <button class="ic-seg" type="button" data-mode="blur" aria-checked="false">블러</button>
                </div>
                <div class="ic-row vm-strength-row">
                  <span class="ic-label">강도</span>
                  <input type="range" id="vm-strength" min="6" max="48" step="1" value="24" aria-label="모자이크와 흐림 강도">
                  <span class="pp-value" id="vm-strength-value">24</span>
                </div>
                <div class="ic-actions pp-actions vm-actions">
                  <button class="primary-btn ghost" type="button" id="vm-undo" disabled>실행취소</button>
                  <button class="primary-btn ghost" type="button" id="vm-clear" disabled>전체 삭제</button>
                </div>
                <p class="vm-count" id="vm-count">지정한 영역 0개</p>
              </section>

              <section class="pp-card">
                <h3 class="pp-card-title">저장</h3>
                <p class="vm-hint-text">영상을 처음부터 끝까지 실시간으로 다시 인코딩합니다. 짧은 클립(10~30초)을 권장합니다.</p>
                <div class="fc-progress vm-progress" id="vm-progress" hidden>
                  <div class="fc-bar"><span id="vm-bar"></span></div>
                  <p class="fc-progress-text" id="vm-progress-text"></p>
                </div>
                <div class="ic-actions pp-actions">
                  <button class="primary-btn" type="button" id="vm-record">영상 저장</button>
                </div>
                <div id="vm-result" class="vm-result"></div>
              </section>
            </aside>
          </div>
        </div>

        <video id="vm-video" playsinline preload="metadata" class="sr-only"></video>
      </div>`;

    const canvas = root.querySelector('#vm-canvas');
    const ctx2d = canvas.getContext('2d');
    const video = root.querySelector('#vm-video');
    const emptyEl = root.querySelector('#vm-empty');
    const mainEl = root.querySelector('#vm-main');
    const inputEl = root.querySelector('#vm-input');
    const playBtn = root.querySelector('#vm-play');
    const seekEl = root.querySelector('#vm-seek');
    const timeEl = root.querySelector('#vm-time');
    const infoEl = root.querySelector('#vm-info');
    const hintEl = root.querySelector('#vm-hint');
    const countEl = root.querySelector('#vm-count');
    const undoBtn = root.querySelector('#vm-undo');
    const clearBtn = root.querySelector('#vm-clear');
    const recordBtn = root.querySelector('#vm-record');
    const progressEl = root.querySelector('#vm-progress');
    const barEl = root.querySelector('#vm-bar');
    const progressTextEl = root.querySelector('#vm-progress-text');
    const resultEl = root.querySelector('#vm-result');
    const strengthEl = root.querySelector('#vm-strength');
    const strengthValueEl = root.querySelector('#vm-strength-value');

    // 오프스크린 원본 프레임(모자이크/블러 계산용)
    const src = document.createElement('canvas');
    const srcCtx = src.getContext('2d');
    const tmp = document.createElement('canvas');
    const tmpCtx = tmp.getContext('2d');

    /* -------------------------------- 그리기 -------------------------------- */

    function ensureCanvasSize() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return false;
      const width = Math.min(vw, MAX_CANVAS_WIDTH);
      const height = Math.round((vh / vw) * width);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        src.width = width;
        src.height = height;
      }
      return true;
    }

    function drawRegion(x, y, w, h) {
      if (w < 1 || h < 1) return;
      // 강도는 640px 폭 기준 픽셀 값 — 큰 영상에서도 같은 세기로 가려지도록 비례해 키운다.
      const scale = Math.max(1, canvas.width / 640);
      if (mode === 'blur') {
        ctx2d.save();
        ctx2d.beginPath();
        ctx2d.rect(x, y, w, h);
        ctx2d.clip();
        ctx2d.filter = `blur(${Math.max(1, (strength / 2) * scale)}px)`;
        ctx2d.drawImage(src, 0, 0, canvas.width, canvas.height);
        ctx2d.restore();
        ctx2d.filter = 'none';
        return;
      }
      const block = Math.max(2, Math.round((strength / 2) * scale));
      const bw = Math.max(1, Math.round(w / block));
      const bh = Math.max(1, Math.round(h / block));
      tmp.width = bw;
      tmp.height = bh;
      tmpCtx.imageSmoothingEnabled = true;
      tmpCtx.drawImage(src, x, y, w, h, 0, 0, bw, bh);
      ctx2d.save();
      ctx2d.imageSmoothingEnabled = false;
      ctx2d.drawImage(tmp, 0, 0, bw, bh, x, y, w, h);
      ctx2d.restore();
    }

    function paint() {
      const width = canvas.width;
      const height = canvas.height;
      if (!width || !height) return;
      if (video.readyState >= 2) {
        srcCtx.drawImage(video, 0, 0, width, height);
        ctx2d.drawImage(src, 0, 0);
        rects.forEach((rect) => {
          drawRegion(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
        });
      }

      // 편집 보조선 — 녹화 중에는 그리지 않아 결과 영상에 선이 남지 않는다.
      if (!recording) {
        ctx2d.save();
        ctx2d.lineWidth = Math.max(1.5, width / 640);
        rects.forEach((rect) => {
          ctx2d.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx2d.strokeRect(rect.x * width + 1, rect.y * height + 1, rect.w * width - 2, rect.h * height - 2);
        });
        if (previewRect) {
          ctx2d.setLineDash([6, 4]);
          ctx2d.strokeStyle = 'rgba(46,94,78,1)';
          ctx2d.strokeRect(previewRect.x * width, previewRect.y * height, previewRect.w * width, previewRect.h * height);
        }
        ctx2d.restore();
      }
    }

    function loop() {
      if (!file) return;
      paint();
      if (recording) {
        const percent = duration ? Math.min(100, (video.currentTime / duration) * 100) : 0;
        barEl.style.width = `${percent}%`;
        progressTextEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(duration)}`;
      }
      if (!video.paused && !video.ended) {
        seekEl.value = String(video.currentTime);
        timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(duration)}`;
      }
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    }

    function renderRects() {
      const total = rects.length;
      countEl.textContent = `지정한 영역 ${total}개`;
      undoBtn.disabled = total === 0 || recording;
      clearBtn.disabled = total === 0 || recording;
      hintEl.hidden = total > 0 || recording;
    }

    /* ------------------------------- 파일 열기 ------------------------------- */

    function open(fileIn) {
      if (!fileIn) return;
      if (!/^video\//.test(fileIn.type) && !/\.(mp4|m4v|webm|mov|ogv)$/i.test(fileIn.name)) {
        toast('영상 파일이 아닙니다');
        return;
      }
      if (recording) stopRecording();
      resetResult();
      rects = [];
      renderRects();

      if (videoUrl) URL.revokeObjectURL(videoUrl);
      file = fileIn;
      videoUrl = URL.createObjectURL(fileIn);
      video.src = videoUrl;
      emptyEl.hidden = true;
      mainEl.hidden = false;

      video.addEventListener('loadedmetadata', () => {
        duration = video.duration || 0;
        if (!Number.isFinite(duration)) duration = 0;
        seekEl.max = String(duration || 1);
        timeEl.textContent = `0:00.0 / ${fmtTime(duration || 0)}`;
        ensureCanvasSize();
        paint();
        infoEl.innerHTML = `<span>${file.name}</span><em>${formatBytes(file.size)}, ${video.videoWidth}×${video.videoHeight}, ${fmtTime(duration || 0)}</em>`;
        // 첫 프레임이 검게 남지 않도록 아주 조금 앞으로 옮겨 한 장 그린다.
        if (!video.currentTime) {
          video.currentTime = Math.min(0.1, Math.max(0.01, (duration || 1) / 2));
          setTimeout(paint, 250);
        }
        if (duration > 60) {
          infoEl.append(noticeBox('warn', '긴 영상입니다', `저장은 영상 길이(${fmtTime(duration)})만큼 실시간이 걸립니다. 짧은 클립을 권장합니다.`));
        }
      }, { signal });

      startLoop();
    }

    inputEl.addEventListener('change', () => {
      const picked = inputEl.files && inputEl.files[0];
      inputEl.value = '';
      if (picked) open(picked);
    }, { signal });
    root.querySelector('#vm-browse').addEventListener('click', () => inputEl.click(), { signal });

    root.addEventListener('dragover', (event) => {
      event.preventDefault();
      root.classList.add('is-dragging');
    }, { signal });
    root.addEventListener('dragleave', (event) => {
      if (event.target !== root) return;
      root.classList.remove('is-dragging');
    }, { signal });
    root.addEventListener('drop', (event) => {
      event.preventDefault();
      root.classList.remove('is-dragging');
      const dropped = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (dropped) open(dropped);
    }, { signal });

    /* ------------------------------- 재생 제어 ------------------------------- */

    function syncPlayButton() {
      playBtn.innerHTML = video.paused ? PLAY : PAUSE;
      playBtn.setAttribute('aria-label', video.paused ? '재생' : '일시정지');
    }

    playBtn.addEventListener('click', async () => {
      if (recording) return;
      if (video.paused) {
        if (video.ended) video.currentTime = 0;
        try { await video.play(); } catch (error) { console.error('[TIP video-mosaic]', error); }
      } else {
        video.pause();
      }
      syncPlayButton();
    }, { signal });

    video.addEventListener('play', syncPlayButton, { signal });
    video.addEventListener('pause', syncPlayButton, { signal });
    video.addEventListener('ended', () => {
      syncPlayButton();
      if (recording) stopRecording();
    }, { signal });

    video.addEventListener('seeked', () => {
      paint();
      timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(duration)}`;
    }, { signal });

    seekEl.addEventListener('input', () => {
      if (recording) return;
      video.currentTime = Number(seekEl.value);
      timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(duration)}`;
    }, { signal });

    /* --------------------------- 사각 영역 그리기 --------------------------- */

    function pointFromEvent(event) {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!file || recording) return;
      const point = pointFromEvent(event);
      if (!point) return;
      canvas.setPointerCapture(event.pointerId);
      dragging = { start: point, pointerId: event.pointerId };
      previewRect = { x: point.x, y: point.y, w: 0, h: 0 };
      event.preventDefault();
    }, { signal });

    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const point = pointFromEvent(event);
      if (!point) return;
      const x = Math.min(dragging.start.x, point.x);
      const y = Math.min(dragging.start.y, point.y);
      previewRect = {
        x,
        y,
        w: Math.abs(point.x - dragging.start.x),
        h: Math.abs(point.y - dragging.start.y),
      };
      event.preventDefault();
    }, { signal });

    function endDrag(event) {
      if (!dragging || (event && event.pointerId !== dragging.pointerId)) return;
      dragging = null;
      if (previewRect && previewRect.w > 0.01 && previewRect.h > 0.01) {
        rects.push({ ...previewRect });
        renderRects();
      }
      previewRect = null;
    }

    canvas.addEventListener('pointerup', endDrag, { signal });
    canvas.addEventListener('pointercancel', () => {
      dragging = null;
      previewRect = null;
    }, { signal });

    undoBtn.addEventListener('click', () => {
      rects.pop();
      renderRects();
    }, { signal });

    clearBtn.addEventListener('click', () => {
      rects = [];
      renderRects();
    }, { signal });

    root.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        root.querySelectorAll('[data-mode]').forEach((other) => {
          other.setAttribute('aria-checked', String(other.dataset.mode === mode));
        });
      }, { signal });
    });

    strengthEl.addEventListener('input', () => {
      strength = Number(strengthEl.value);
      strengthValueEl.textContent = String(strength);
    }, { signal });

    /* -------------------------------- 인코딩 -------------------------------- */

    function resetResult() {
      result = null;
      resultEl.innerHTML = '';
    }

    function showResult(blob, mime) {
      const ext = /mp4/.test(mime) ? 'mp4' : 'webm';
      const name = `${baseName(file ? file.name : 'clip')}-mosaic.${ext}`;
      result = { blob, name };
      resultEl.innerHTML = '';
      const videoEl = document.createElement('video');
      const objectUrl = URL.createObjectURL(blob);
      videoEl.src = objectUrl;
      videoEl.controls = true;
      videoEl.playsInline = true;
      videoEl.className = 'vm-result-video';
      const meta = document.createElement('p');
      meta.className = 'vm-result-meta';
      meta.textContent = `${ext.toUpperCase()}, ${formatBytes(blob.size)}, ${canvas.width}×${canvas.height}`;
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'primary-btn';
      save.textContent = '저장';
      save.addEventListener('click', () => download(blob, name), { signal });
      resultEl.append(videoEl, meta, save);
      toast('모자이크 영상을 만들었습니다');
    }

    function ensureAudio() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        if (!audioCtx) audioCtx = new Ctx();
        if (!audioSource) {
          audioSource = audioCtx.createMediaElementSource(video);
          audioDest = audioCtx.createMediaStreamDestination();
          audioSource.connect(audioDest);
          audioSource.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return true;
      } catch (error) {
        console.error('[TIP video-mosaic]', error);
        return false;
      }
    }

    async function startRecording() {
      if (!file || recording) return;
      if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
        resultEl.innerHTML = '';
        resultEl.append(noticeBox('bad', '이 브라우저는 영상 저장을 지원하지 않습니다',
          'Chrome, Edge, 최신 Safari에서 다시 시도하세요.'));
        return;
      }
      const mime = pickMime();
      if (mime === null) {
        resultEl.innerHTML = '';
        resultEl.append(noticeBox('bad', 'MediaRecorder를 쓸 수 없습니다', 'Chrome, Edge, 최신 Safari에서 다시 시도하세요.'));
        return;
      }

      resetResult();
      progressEl.hidden = false;
      barEl.style.width = '0%';
      progressTextEl.textContent = '준비 중…';
      video.pause();
      video.currentTime = 0;
      if (video.readyState < 2) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 1500);
          video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      ensureCanvasSize();
      paint();

      ensureAudio();

      let stream;
      try {
        stream = canvas.captureStream(30);
      } catch (error) {
        console.error('[TIP video-mosaic]', error);
        toast('화면을 캡처하지 못했습니다');
        return;
      }

      // 오디오 트랙: video.captureStream 을 우선 시도, 없으면 AudioContext 출력 사용
      try {
        if (typeof video.captureStream === 'function') {
          const mediaStream = video.captureStream();
          mediaStream.getAudioTracks().forEach((track) => stream.addTrack(track));
        }
      } catch { /* 무음 영상 등 — 아래 AudioContext 로 보완 */ }
      if (!stream.getAudioTracks().length && audioDest) {
        audioDest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      }

      const options = { videoBitsPerSecond: 5_000_000 };
      if (mime) options.mimeType = mime;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        try {
          recorder = new MediaRecorder(stream);
        } catch (error) {
          console.error('[TIP video-mosaic]', error);
          toast('녹화를 시작하지 못했습니다');
          return;
        }
      }

      chunks = [];
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        recording = false;
        recordBtn.textContent = '영상 저장';
        progressEl.hidden = true;
        root.querySelectorAll('button').forEach((btn) => { if (!btn.matches('[data-mode]')) btn.disabled = false; });
        undoBtn.disabled = rects.length === 0;
        clearBtn.disabled = rects.length === 0;
        hintEl.hidden = rects.length > 0;
        const type = recorder.mimeType || mime || 'video/webm';
        const blob = new Blob(chunks, { type });
        chunks = [];
        if (blob.size) showResult(blob, type);
        else {
          resultEl.innerHTML = '';
          resultEl.append(noticeBox('bad', '영상을 만들지 못했습니다', '다시 시도해 주세요.'));
        }
      });

      recording = true;
      recordingStart = Date.now();
      progressEl.hidden = false;
      barEl.style.width = '0%';
      progressTextEl.textContent = '0:00.0 / ' + fmtTime(duration);
      recordBtn.textContent = '녹화 중지';
      undoBtn.disabled = true;
      clearBtn.disabled = true;
      hintEl.hidden = true;
      seekEl.disabled = true;
      video.muted = false;
      video.currentTime = 0;
      try {
        recorder.start(250);
        await video.play();
      } catch (error) {
        console.error('[TIP video-mosaic]', error);
        stopRecording();
      }
    }

    function stopRecording() {
      if (!recording) return;
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch (error) {
        console.error('[TIP video-mosaic]', error);
      }
      video.pause();
      seekEl.disabled = false;
      syncPlayButton();
    }

    recordBtn.addEventListener('click', () => {
      if (recording) {
        stopRecording();
        return;
      }
      startRecording();
    }, { signal });

    /* -------------------------------- 정리 -------------------------------- */

    startLoop();

    return () => {
      cancelAnimationFrame(rafId);
      controller.abort();
      try { video.pause(); } catch { /* noop */ }
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (audioCtx) {
        try { audioCtx.close(); } catch { /* noop */ }
      }
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* noop */ }
      }
    };
  },
};

export default module;
