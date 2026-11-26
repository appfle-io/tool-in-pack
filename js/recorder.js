/**
 * TIP · 녹음 엔진 (recorder.js, v1.22.0)
 *
 * 이 화면은 앱 안의 **숨은 상주 창**(recorder.html)에서만 돈다. 모듈 창을 닫아도, 노치를 꺼 두어도
 * 여기서 잡은 마이크 스트림은 그대로 살아 있어 녹음이 끊기지 않는다.
 *
 *   · Rust(voice.rs)가 상태의 주인이다. 이 창은 명령(tip://voice-cmd)만 받아
 *     start · pause · resume · stop 을 수행하고, 결과를 커맨드로 돌려준다.
 *   · 소리는 MediaRecorder 가 2초마다 잘라 주는 조각을 base64 로 Rust 에 보내고,
 *     Rust 가 곧바로 파일에 덧붙인다(앱이 갑자기 꺼져도 그때까지의 소리가 남는다).
 *   · 음량은 AnalyserNode 로 재어 초당 열 번 남짓 보낸다(모듈 화면의 파형).
 */

const invoke = (command, args) => window.__TAURI__.core.invoke(command, args || {});
const listen = (name, handler) => window.__TAURI__.event.listen(name, handler);

const stateEl = document.getElementById('state');

/** 고를 수 있는 녹음 형식 — WebKit 은 audio/mp4(.m4a), Chromium 은 audio/webm. */
const MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

/** ArrayBuffer → base64. 큰 조각도 한 번에 넘기지 않게 나눠 붙인다. */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    text += String.fromCharCode.apply(null, bytes.subarray(index, index + step));
  }
  return btoa(text);
}

/** 파일 이름 뼈대 — 이 Mac 의 지역 시각으로 만든다(Rust 는 확장자만 붙인다). */
function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `TIP ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

let stream = null;
let recorder = null;
let audioContext = null;
let analyser = null;
let levelTimer = null;
let queue = Promise.resolve();
let stopping = false;

function say(text) {
  if (stateEl) stateEl.textContent = text;
}

/** 녹음 조각을 차례대로 올린다 — invoke 가 겹치면 파일 순서가 뒤집힐 수 있다. */
function upload(buffer) {
  const data = toBase64(buffer);
  queue = queue.then(() => invoke('voice_chunk', { data })).catch((error) => {
    console.error('[TIP recorder] 조각을 저장하지 못했습니다', error);
    return invoke('voice_failed', { message: '녹음을 저장하지 못했습니다' }).catch(() => {});
  });
  return queue;
}

function startMetering() {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    let lastSent = 0;
    levelTimer = setInterval(() => {
      if (!analyser) return;
      const now = performance.now();
      if (now - lastSent < 90) return;   // Rust 도 80ms 로 거른다 — 여기서 한 번 더 줄인다
      lastSent = now;
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index];
      const rms = Math.sqrt(sum / buffer.length);
      // 사람 목소리의 작은 소리도 보이게 조금 끌어올린다(0~1).
      const level = Math.min(1, Math.pow(rms * 6, 0.6));
      invoke('voice_level', { level }).catch(() => {});
    }, 100);
  } catch (error) {
    console.warn('[TIP recorder] 음량을 재지 못했습니다', error);
  }
}

function stopMetering() {
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  analyser = null;
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
}

function releaseStream() {
  stopMetering();
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  recorder = null;
}

async function start() {
  if (recorder) return;
  stopping = false;
  say('마이크를 여는 중…');
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('이 환경에서는 마이크를 쓸 수 없습니다');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    const name = (error && error.name) || '';
    const message = name === 'NotAllowedError' || name === 'SecurityError'
      ? '마이크 권한이 필요합니다. 시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 TIP 을 켜 주세요'
      : (error && error.message) || '마이크를 열지 못했습니다';
    say(message);
    await invoke('voice_failed', { message }).catch(() => {});
    releaseStream();
    return;
  }

  const mimeType = pickMime();
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  } catch (error) {
    // 형식을 고르지 못하면 기본값으로 한 번 더.
    try {
      recorder = new MediaRecorder(stream);
    } catch (inner) {
      const message = (inner && inner.message) || '녹음기를 만들지 못했습니다';
      say(message);
      await invoke('voice_failed', { message }).catch(() => {});
      releaseStream();
      return;
    }
  }

  const usedMime = recorder.mimeType || mimeType || 'audio/webm';

  recorder.ondataavailable = (event) => {
    if (!event.data || !event.data.size) return;
    event.data.arrayBuffer()
      .then((buffer) => upload(buffer))
      .catch((error) => console.error('[TIP recorder] 조각을 읽지 못했습니다', error));
  };

  recorder.onerror = (event) => {
    const message = (event && event.error && event.error.message) || '녹음 중 오류가 났습니다';
    say(message);
    invoke('voice_failed', { message }).catch(() => {});
    releaseStream();
  };

  recorder.onstop = async () => {
    say('저장하는 중…');
    try {
      await queue;                       // 남은 조각을 모두 파일에 쓴 뒤에 마무리한다
      await invoke('voice_finished');
      say('저장했습니다');
    } catch (error) {
      await invoke('voice_failed', { message: '녹음을 저장하지 못했습니다' }).catch(() => {});
    } finally {
      releaseStream();
    }
  };

  await invoke('voice_started', { mime: usedMime, fileName: stamp() }).catch((error) => {
    console.error('[TIP recorder] 녹음 파일을 만들지 못했습니다', error);
  });
  recorder.start(2000);
  startMetering();
  say(`녹음 중 (${usedMime})`);
}

function pause() {
  if (!recorder || recorder.state !== 'recording') return;
  try { recorder.pause(); } catch { /* 이미 멈춘 경우 */ }
  stopMetering();
  say('일시정지');
}

function resume() {
  if (!recorder || recorder.state !== 'paused') return;
  try { recorder.resume(); } catch { /* 이미 도는 경우 */ }
  if (!audioContext && stream) startMetering();
  say('다시 녹음 중');
}

function stop() {
  if (stopping) return;
  stopping = true;
  if (!recorder) {
    // 아직 시작 전이면 곧바로 마무리(Rust 가 빈 파일을 지운다).
    invoke('voice_finished').catch(() => {});
    releaseStream();
    return;
  }
  try {
    if (recorder.state !== 'inactive') recorder.stop();
    else invoke('voice_finished').catch(() => {});
  } catch {
    invoke('voice_finished').catch(() => {});
    releaseStream();
  }
}

const handlers = { start, pause, resume, stop };

listen('tip://voice-cmd', (event) => {
  const action = String((event && event.payload) || '');
  const handler = handlers[action];
  if (!handler) return;
  Promise.resolve(handler()).catch((error) => {
    console.error('[TIP recorder] 명령을 처리하지 못했습니다', action, error);
  });
}).catch((error) => console.warn('[TIP recorder] 명령을 듣지 못했습니다', error));

// 준비를 알린다 — Rust 가 기다리던 start/stop 명령을 이때 보낸다.
invoke('voice_ready').catch((error) => console.warn('[TIP recorder] 준비를 알리지 못했습니다', error));
say('준비됨');
