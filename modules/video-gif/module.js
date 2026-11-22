/**
 * TIP · 동영상 자르기 · GIF 변환 (video-gif)
 * - GIF: <video> + <canvas> 프레임 추출 → gifenc(순수 JS) 인코딩. 완전 오프라인.
 * - 클립 자르기: 브라우저 MediaRecorder + canvas.captureStream (실시간 재인코딩).
 *   SharedArrayBuffer가 필요한 멀티스레드 ffmpeg.wasm은 쓰지 않는다 — GitHub Pages는
 *   COOP/COEP 헤더를 보내지 않아 라이브에서 깨지기 때문. 그래서 여기엔 wasm이 없다.
 */

import { formatBytes, icons } from '../../js/ui.js';
import { GIFEncoder, quantize, applyPalette } from '../../vendor/gifenc/gifenc.esm.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10 9.5l5 2.5-5 2.5z"/><path d="M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3"/></svg>`;

const ACCEPT = 'video/*,.mp4,.m4v,.webm,.mov,.ogv';
const FPS_OPTIONS = [5, 10, 15];
const WIDTH_OPTIONS = [320, 480, 640];
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function fmtTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(value / 60);
  const s = value - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch { /* keep looking */ }
  }
  return '';
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

function noticeBox(kind, title, body) {
  const glyph = { warn: '⚠', bad: '✕', info: 'ℹ' }[kind] || 'ℹ';
  const box = document.createElement('div');
  box.className = `notice${kind === 'info' ? '' : ` ${kind}`}`;
  box.innerHTML = `<span class="n-icon">${glyph}</span>
    <div class="n-body"><div class="n-title"></div><div class="n-text"></div></div>`;
  box.querySelector('.n-title').textContent = title;
  box.querySelector('.n-text').textContent = body;
  return box;
}

const module = {
  id: 'video-gif',
  name: '동영상 자르기 · GIF',
  kind: 'tool',
  category: 'media',
  version: '1.0.0',
  subtitle: '구간 잘라 GIF·클립으로',
  description: '동영상의 원하는 구간을 GIF로 만들거나 클립으로 잘라 저장합니다. 기기 안에서만 처리합니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root) {
    const controller = new AbortController();
    const { signal } = controller;

    let file = null;
    let duration = 0;
    let start = 0;
    let end = 0;
    let fps = 10;
    let gifWidth = 480;
    let busy = false;
    let objectUrl = null;
    let audioCtx = null;
    let audioSource = null;
    let audioDest = null;

    root.innerHTML = `
      <div class="vg">
        <div class="dr-empty" id="vg-empty">
          <div class="dz-icon">${ICON}</div>
          <button class="primary-btn" type="button" id="vg-browse">${icons.upload} 동영상 선택</button>
          <p>MP4 · WebM · MOV — 끌어다 놓아도 됩니다</p>
        </div>
        <input type="file" id="vg-input" class="sr-only" accept="${ACCEPT}">
        <div id="vg-main" hidden>
          <div class="vg-grid">
            <div class="vg-left">
              <div class="vg-player">
                <video id="vg-video" playsinline muted controls preload="metadata"></video>
              </div>
              <div class="vg-info" id="vg-info"></div>
            </div>

            <aside class="vg-panel">
              <section class="pp-card">
                <h3 class="pp-card-title">구간</h3>
                <div class="vg-time-row">
                  <span class="ic-label">시작</span>
                  <input type="range" id="vg-start" min="0" max="1" step="0.05" value="0" aria-label="시작 시간">
                  <span class="pp-value" id="vg-start-value">0:00.0</span>
                </div>
                <div class="vg-time-row">
                  <span class="ic-label">끝</span>
                  <input type="range" id="vg-end" min="0" max="1" step="0.05" value="1" aria-label="끝 시간">
                  <span class="pp-value" id="vg-end-value">0:00.0</span>
                </div>
                <p class="vg-hint" id="vg-length"></p>
              </section>

              <section class="pp-card">
                <h3 class="pp-card-title">GIF 변환</h3>
                <div class="ic-row">
                  <span class="ic-label">FPS</span>
                  <div class="ic-segment" id="vg-fps" role="radiogroup" aria-label="초당 프레임"></div>
                </div>
                <div class="ic-row">
                  <span class="ic-label">가로</span>
                  <div class="ic-segment" id="vg-width" role="radiogroup" aria-label="GIF 가로 폭"></div>
                </div>
                <div class="ic-actions pp-actions">
                  <button class="primary-btn" type="button" id="vg-gif">GIF 만들기</button>
                </div>
              </section>

              <section class="pp-card">
                <h3 class="pp-card-title">동영상 자르기</h3>
                <div class="ic-actions pp-actions">
                  <button class="primary-btn" type="button" id="vg-clip">클립 자르기</button>
                  <button class="primary-btn ghost" type="button" id="vg-change">다른 영상</button>
                </div>
                <p class="vg-hint" id="vg-clip-hint"></p>
              </section>

              <div class="vg-progress" id="vg-progress" hidden>
                <div class="vg-progress-bar"><span id="vg-progress-fill"></span></div>
                <span class="vg-progress-text" id="vg-progress-text"></span>
              </div>
            </aside>
          </div>

          <div id="vg-results"></div>
          <p class="vg-note">iOS Safari는 30초 이내 짧은 클립에서 가장 안정적입니다 · 모든 처리는 기기 안에서.</p>
          <div id="vg-msg"></div>
        </div>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const empty = $('#vg-empty');
    const inputEl = $('#vg-input');
    const main = $('#vg-main');
    const video = $('#vg-video');
    const infoEl = $('#vg-info');
    const startInput = $('#vg-start');
    const endInput = $('#vg-end');
    const startValue = $('#vg-start-value');
    const endValue = $('#vg-end-value');
    const lengthEl = $('#vg-length');
    const resultsEl = $('#vg-results');
    const msgEl = $('#vg-msg');
    const gifBtn = $('#vg-gif');
    const clipBtn = $('#vg-clip');
    const progressEl = $('#vg-progress');
    const progressFill = $('#vg-progress-fill');
    const progressText = $('#vg-progress-text');

    /* ------------------------------ controls ------------------------------ */

    const fpsEl = $('#vg-fps');
    FPS_OPTIONS.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-seg';
      btn.setAttribute('role', 'radio');
      btn.dataset.fps = String(value);
      btn.setAttribute('aria-checked', String(value === fps));
      btn.textContent = String(value);
      fpsEl.append(btn);
    });
    fpsEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-fps]');
      if (!btn) return;
      fps = Number(btn.dataset.fps);
      fpsEl.querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      updateLength();
    }, { signal });

    const widthEl = $('#vg-width');
    WIDTH_OPTIONS.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ic-seg';
      btn.setAttribute('role', 'radio');
      btn.dataset.width = String(value);
      btn.setAttribute('aria-checked', String(value === gifWidth));
      btn.textContent = String(value);
      widthEl.append(btn);
    });
    widthEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-width]');
      if (!btn) return;
      gifWidth = Number(btn.dataset.width);
      widthEl.querySelectorAll('.ic-seg').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    }, { signal });

    $('#vg-browse').addEventListener('click', () => inputEl.click(), { signal });
    $('#vg-change').addEventListener('click', () => inputEl.click(), { signal });
    inputEl.addEventListener('change', () => {
      const picked = inputEl.files && inputEl.files[0];
      if (picked) loadVideo(picked);
      inputEl.value = '';
    }, { signal });

    startInput.addEventListener('input', () => {
      let value = Number(startInput.value);
      if (value > end - 0.1) value = Math.max(0, end - 0.1);
      start = value;
      startInput.value = String(value);
      startValue.textContent = fmtTime(value);
      if (!busy) video.currentTime = value;
      updateLength();
    }, { signal });

    endInput.addEventListener('input', () => {
      let value = Number(endInput.value);
      if (value < start + 0.1) value = Math.min(duration, start + 0.1);
      end = value;
      endInput.value = String(value);
      endValue.textContent = fmtTime(value);
      updateLength();
    }, { signal });

    gifBtn.addEventListener('click', makeGif, { signal });
    clipBtn.addEventListener('click', cutClip, { signal });

    /* -------------------------------- loading ----------------------------- */

    async function loadVideo(picked) {
      msgEl.innerHTML = '';
      resultsEl.innerHTML = '';
      if (!/^(video|application)\//.test(picked.type) && !/\.(mp4|m4v|webm|mov|ogv)$/i.test(picked.name)) {
        msgEl.append(noticeBox('warn', '동영상이 아닙니다', 'MP4 · WebM · MOV 파일을 넣어 주세요.'));
        return;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(picked);
      file = picked;
      video.src = objectUrl;
      video.muted = true;
      empty.hidden = true;
      main.hidden = false;
      infoEl.textContent = '영상을 여는 중…';

      try {
        await new Promise((resolve, reject) => {
          const onMeta = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error('이 브라우저에서 재생할 수 없는 형식입니다.')); };
          const cleanup = () => {
            video.removeEventListener('loadedmetadata', onMeta);
            video.removeEventListener('error', onError);
          };
          video.addEventListener('loadedmetadata', onMeta);
          video.addEventListener('error', onError);
        });
        duration = await readDuration();
        if (!duration) throw new Error('영상 길이를 읽지 못했습니다.');

        start = 0;
        end = Math.min(duration, 5);
        startInput.min = '0';
        startInput.max = String(Math.max(0.1, duration));
        endInput.min = '0';
        endInput.max = String(duration);
        startInput.step = duration > 30 ? '0.5' : '0.05';
        endInput.step = duration > 30 ? '0.5' : '0.05';
        startInput.value = String(start);
        endInput.value = String(end);
        startValue.textContent = fmtTime(start);
        endValue.textContent = fmtTime(end);

        infoEl.textContent = `${video.videoWidth}×${video.videoHeight} · ${fmtTime(duration)} · ${formatBytes(picked.size)}`;
        updateLength();
      } catch (error) {
        console.error('[TIP video-gif]', error);
        infoEl.textContent = '';
        msgEl.append(noticeBox('bad', '영상을 열지 못했습니다', String((error && error.message) || error)));
      }
    }

    /** MediaRecorder로 만든 WebM은 duration이 Infinity인 경우가 많다.
     *  아주 먼 곳으로 seek하면 브라우저가 실제 길이를 알려준다(Chrome/Edge). */
    async function readDuration() {
      if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('durationchange', finish);
          video.removeEventListener('timeupdate', finish);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 2500);
        video.addEventListener('durationchange', finish);
        video.addEventListener('timeupdate', finish);
        try { video.currentTime = 1e101; } catch { finish(); }
      });
      const value = video.duration;
      try { video.currentTime = 0; } catch { /* ignore */ }
      return Number.isFinite(value) ? value : 0;
    }

    function updateLength() {
      const span = Math.max(0, end - start);
      const frames = Math.min(600, Math.max(1, Math.round(span * fps)));
      lengthEl.textContent = `${fmtTime(span)} · GIF ${frames}프레임`;
      const mime = pickMime();
      const hasRecorder = Boolean(mime);
      clipBtn.disabled = busy || !hasRecorder || !duration;
      $('#vg-clip-hint').textContent = hasRecorder
        ? `구간 길이만큼 실시간으로 다시 인코딩합니다 (${fmtTime(span)})`
        : '이 브라우저는 클립 저장(MediaRecorder)을 지원하지 않습니다 — GIF를 사용해 주세요.';
      gifBtn.disabled = busy || !duration;
    }

    function setBusy(next, label = '', ratio = 0) {
      busy = next;
      progressEl.hidden = !next && !label;
      progressFill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
      progressText.textContent = label;
      gifBtn.disabled = next || !duration;
      clipBtn.disabled = next || !pickMime() || !duration;
    }

    /* ------------------------------- seeking ------------------------------ */

    function seekTo(time) {
      return new Promise((resolve) => {
        const target = Math.max(0, Math.min(time, Math.max(0, duration - 0.001)));
        if (Math.abs(video.currentTime - target) < 0.004 && video.readyState >= 2) {
          resolve();
          return;
        }
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('seeked', finish);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(finish, 4000);
        video.addEventListener('seeked', finish);
        try { video.currentTime = target; } catch { finish(); }
      });
    }

    /* --------------------------------- GIF -------------------------------- */

    async function makeGif() {
      if (busy || !file) return;
      msgEl.innerHTML = '';
      resultsEl.innerHTML = '';
      const span = Math.max(0.1, end - start);
      const frames = Math.max(1, Math.round(span * fps));
      if (frames > 300) {
        msgEl.append(noticeBox('warn', '구간이 너무 깁니다', `GIF는 최대 300프레임까지 만듭니다. 지금 설정은 ${frames}프레임입니다. 구간을 줄이거나 FPS를 낮춰 주세요.`));
        return;
      }

      const width = gifWidth;
      const height = Math.max(2, Math.round((width * video.videoHeight) / video.videoWidth / 2) * 2);
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      const fctx = frameCanvas.getContext('2d', { willReadFrequently: true });

      setBusy(true, 'GIF 준비 중…', 0);
      video.pause();

      try {
        const gif = GIFEncoder();
        for (let index = 0; index < frames; index += 1) {
          const time = start + index / fps;
          await seekTo(time);
          fctx.drawImage(video, 0, 0, width, height);
          const pixels = fctx.getImageData(0, 0, width, height);
          const data = new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.length);
          const palette = quantize(data, 256, { format: 'rgb565' });
          const indexed = applyPalette(data, palette, 'rgb565');
          gif.writeFrame(indexed, width, height, {
            palette,
            delay: Math.round(1000 / fps),
            repeat: index === 0 ? 0 : -1,
            dispose: 1,
          });
          setBusy(true, `GIF 인코딩 ${index + 1}/${frames}…`, (index + 1) / frames);
        }
        gif.finish();
        const bytes = gif.bytes();
        const blob = new Blob([bytes], { type: 'image/gif' });
        const name = `${(file.name || 'clip').replace(/\.[^.]+$/, '')}_${start.toFixed(1)}-${end.toFixed(1)}.gif`;
        showGifResult(blob, name, { width, height, frames, fps });
        setBusy(false, '', 0);
        progressEl.hidden = true;
      } catch (error) {
        console.error('[TIP video-gif]', error);
        setBusy(false, '', 0);
        progressEl.hidden = true;
        msgEl.append(noticeBox('bad', 'GIF를 만들지 못했습니다', String((error && error.message) || error)));
      } finally {
        if (!busy) updateLength();
      }
    }

    function showGifResult(blob, name, meta) {
      const card = document.createElement('div');
      card.className = 'vg-result';
      card.innerHTML = `
        <div class="vg-result-media"><img alt="GIF 미리보기"></div>
        <div class="vg-result-info">
          <div class="f-name"></div>
          <div class="f-meta"></div>
          <div class="vg-result-actions"><button class="primary-btn" type="button">저장</button></div>
        </div>`;
      const img = card.querySelector('img');
      img.src = URL.createObjectURL(blob);
      card.querySelector('.f-name').textContent = name;
      card.querySelector('.f-meta').textContent =
        `GIF · ${meta.width}×${meta.height} · ${meta.frames}프레임 · ${meta.fps}fps · ${formatBytes(blob.size)}`;
      card.querySelector('button').addEventListener('click', () => download(blob, name), { signal });
      resultsEl.prepend(card);
    }

    /* -------------------------------- clip -------------------------------- */

    async function cutClip() {
      if (busy || !file) return;
      const mime = pickMime();
      if (!mime) {
        msgEl.innerHTML = '';
        msgEl.append(noticeBox('bad', '클립 저장을 지원하지 않습니다', '이 브라우저에는 MediaRecorder가 없습니다. GIF 변환을 사용해 주세요.'));
        return;
      }

      msgEl.innerHTML = '';
      const span = Math.max(0.2, end - start);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const cctx = canvas.getContext('2d');

      setBusy(true, '클립 준비 중…', 0);
      video.pause();

      let stream = null;
      let audioTrack = null;
      try {
        stream = canvas.captureStream(30);
        if (!stream || !stream.getVideoTracks().length) throw new Error('화면 캡처를 시작하지 못했습니다.');

        // 오디오: 요소의 소리를 스피커 대신 MediaRecorder로 보낸다.
        try {
          if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          if (audioCtx.state === 'suspended') await audioCtx.resume();
          if (!audioSource) {
            audioSource = audioCtx.createMediaElementSource(video);
            audioDest = audioCtx.createMediaStreamDestination();
            audioSource.connect(audioDest);
          }
          audioTrack = audioDest.stream.getAudioTracks()[0] || null;
        } catch (audioError) {
          console.warn('[TIP video-gif] audio capture unavailable', audioError);
          audioTrack = null;
        }

        const tracks = [...stream.getVideoTracks()];
        if (audioTrack) tracks.push(audioTrack);
        const mixed = new MediaStream(tracks);

        const recorder = new MediaRecorder(mixed, {
          mimeType: mime,
          videoBitsPerSecond: 6_000_000,
          audioBitsPerSecond: 128_000,
        });
        const chunks = [];
        recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
        const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

        await seekTo(start);
        video.muted = false;
        video.volume = 1;
        recorder.start(200);
        await video.play();

        const startedAt = performance.now();
        await new Promise((resolve) => {
          const tick = () => {
            if (video.ended || video.currentTime >= end - 0.01) { resolve(); return; }
            if (performance.now() - startedAt > (span + 5) * 1000) { resolve(); return; }
            cctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            setBusy(true, `클립 녹화 중… ${fmtTime(Math.max(0, video.currentTime - start))} / ${fmtTime(span)}`,
              (video.currentTime - start) / span);
            requestAnimationFrame(tick);
          };
          tick();
        });

        video.pause();
        if (recorder.state !== 'inactive') recorder.stop();
        await stopped;
        stream.getVideoTracks().forEach((track) => track.stop());

        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) throw new Error('녹화된 데이터가 없습니다. 구간을 조금 넓혀 다시 시도해 주세요.');
        const ext = mime.includes('mp4') ? 'mp4' : 'webm';
        const name = `${(file.name || 'clip').replace(/\.[^.]+$/, '')}_${start.toFixed(1)}-${end.toFixed(1)}.${ext}`;
        showClipResult(blob, name, { ext, span, withAudio: Boolean(audioTrack) });
      } catch (error) {
        console.error('[TIP video-gif]', error);
        msgEl.append(noticeBox('bad', '클립을 만들지 못했습니다', String((error && error.message) || error)));
      } finally {
        if (stream) stream.getVideoTracks().forEach((track) => { try { track.stop(); } catch { /* ignore */ } });
        video.muted = true;
        setBusy(false, '', 0);
        progressEl.hidden = true;
        updateLength();
      }
    }

    function showClipResult(blob, name, meta) {
      const card = document.createElement('div');
      card.className = 'vg-result';
      card.innerHTML = `
        <div class="vg-result-media"><video controls playsinline muted></video></div>
        <div class="vg-result-info">
          <div class="f-name"></div>
          <div class="f-meta"></div>
          <div class="vg-result-actions"><button class="primary-btn" type="button">저장</button></div>
        </div>`;
      const el = card.querySelector('video');
      el.src = URL.createObjectURL(blob);
      card.querySelector('.f-name').textContent = name;
      card.querySelector('.f-meta').textContent =
        `${meta.ext.toUpperCase()} · ${fmtTime(meta.span)} · ${meta.withAudio ? '오디오 포함' : '무음'} · ${formatBytes(blob.size)}`;
      card.querySelector('button').addEventListener('click', () => download(blob, name), { signal });
      resultsEl.prepend(card);
    }

    /* ---------------------------- drag & drop ----------------------------- */

    ['dragenter', 'dragover'].forEach((type) =>
      root.addEventListener(type, (event) => {
        if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
        event.preventDefault();
        root.classList.add('dr-over');
      }, { signal }));

    ['dragleave', 'drop'].forEach((type) =>
      root.addEventListener(type, (event) => {
        event.preventDefault();
        root.classList.remove('dr-over');
      }, { signal }));

    root.addEventListener('drop', (event) => {
      const picked = Array.from(event.dataTransfer?.files || [])[0];
      if (picked) loadVideo(picked);
    }, { signal });

    updateLength();

    return () => {
      controller.abort();
      try { video.pause(); } catch { /* ignore */ }
      video.removeAttribute('src');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; audioSource = null; audioDest = null; }
    };
  },
};

export default module;
