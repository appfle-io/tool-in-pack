/**
 * TIP · 녹음 공용 API (js/voice.js, v1.22.0)
 *
 * 모듈 화면(modules/voice-recorder)과 노치(js/notch.js)가 같은 함수를 쓴다.
 *
 *  · Mac 앱: 상태의 주인은 Rust(voice.rs)다. 여기서는 `voice_status` 를 읽고
 *    `tip://voice-state` 를 듣기만 한다 — 그래서 모듈 창을 닫아도 녹음이 이어지고,
 *    노치 알약·반원·펼친 패널과 모듈 화면이 늘 같은 상태를 보여 준다.
 *  · 웹(PWA): 브라우저 안에서만 녹음한다(MediaRecorder + IndexedDB). 페이지를 닫으면
 *    녹음도 끝나며, 저장한 녹음은 그 브라우저 안에만 남는다.
 */

const TAURI = typeof window !== 'undefined' && !!(window.__TAURI__ && window.__TAURI__.core);
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args || {});
const listen = (name, handler) => window.__TAURI__.event.listen(name, handler);

export const VOICE_STATUS = {
  idle: 'idle',
  starting: 'starting',
  recording: 'recording',
  paused: 'paused',
  saving: 'saving',
};

/** 녹음이 살아 있는 상태인지(시작 중·녹음 중·일시정지·저장 중). */
export function voiceActive(state) {
  const status = state && state.status;
  return status === VOICE_STATUS.starting || status === VOICE_STATUS.recording
    || status === VOICE_STATUS.paused || status === VOICE_STATUS.saving;
}

/** 00:12 · 12:03 · 1:02:03 — 녹음 경과 시간. */
export function formatVoiceClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 파일 크기 — 1.2MB · 860KB. */
export function formatVoiceSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

export function voiceIsMac() {
  return TAURI;
}

const EMPTY = {
  status: VOICE_STATUS.idle, elapsedMs: 0, level: 0, name: null, mime: '',
  error: null, dir: '', bytes: 0, mode: 'normal', partner: null, notice: null,
};

function normalize(state) {
  if (!state || typeof state !== 'object') return { ...EMPTY };
  return {
    status: String(state.status || VOICE_STATUS.idle),
    elapsedMs: Number(state.elapsedMs) || 0,
    level: Number(state.level) || 0,
    name: state.name ? String(state.name) : null,
    mime: String(state.mime || ''),
    error: state.error ? String(state.error) : null,
    dir: String(state.dir || ''),
    bytes: Number(state.bytes) || 0,
    // v1.29.0 — 일반·대면·화상 3모드
    mode: String(state.mode || 'normal'),
    partner: state.partner ? String(state.partner) : null,
    notice: state.notice ? String(state.notice) : null,
  };
}

/* ------------------------------ 웹(PWA) 녹음기 ------------------------------ */

const WEB_DB = 'tip-voice.v1';
const WEB_STORE = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저에서는 녹음을 보관할 수 없습니다'));
      return;
    }
    const request = indexedDB.open(WEB_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WEB_STORE)) db.createObjectStore(WEB_STORE, { keyPath: 'name' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('녹음 보관함을 열지 못했습니다'));
  });
}

async function dbAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_STORE, 'readonly');
    const request = tx.objectStore(WEB_STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => (b.created || 0) - (a.created || 0)));
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(entry) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_STORE, 'readwrite');
    tx.objectStore(WEB_STORE).put(entry);
    tx.oncomplete = () => resolve(entry);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_STORE, 'readwrite');
    tx.objectStore(WEB_STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const web = {
  status: VOICE_STATUS.idle,
  startedAt: 0,
  accumulated: 0,
  level: 0,
  name: null,
  mime: '',
  error: null,
  stream: null,
  recorder: null,
  chunks: [],
  audioContext: null,
  analyser: null,
  levelTimer: null,
  stateListeners: new Set(),
  levelListeners: new Set(),
};

function webState() {
  const elapsed = web.status === VOICE_STATUS.recording
    ? web.accumulated + (performance.now() - web.startedAt)
    : web.accumulated;
  return normalize({
    status: web.status,
    elapsedMs: elapsed,
    level: web.level,
    name: web.name,
    mime: web.mime,
    error: web.error,
    dir: '',
    bytes: 0,
  });
}

function webEmit() {
  const state = webState();
  web.stateListeners.forEach((cb) => {
    try { cb(state); } catch (error) { console.error('[TIP voice]', error); }
  });
}

function webEmitLevel(level) {
  web.level = level;
  web.levelListeners.forEach((cb) => {
    try { cb(level); } catch (error) { console.error('[TIP voice]', error); }
  });
}

function webStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `TIP ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function webExt(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.includes('mp4') || value.includes('aac')) return 'm4a';
  if (value.includes('ogg')) return 'ogg';
  if (value.includes('wav')) return 'wav';
  return 'webm';
}

function webMimeCandidates() {
  const list = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return list.find((item) => MediaRecorder.isTypeSupported(item)) || '';
}

function webStopMetering() {
  if (web.levelTimer) clearInterval(web.levelTimer);
  web.levelTimer = null;
  web.analyser = null;
  if (web.audioContext) {
    web.audioContext.close().catch(() => {});
    web.audioContext = null;
  }
}

function webRelease() {
  webStopMetering();
  if (web.stream) {
    web.stream.getTracks().forEach((track) => track.stop());
    web.stream = null;
  }
  web.recorder = null;
}

async function webStart() {
  if (web.recorder) return webState();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('이 환경에서는 마이크를 쓸 수 없습니다');
  }
  web.error = null;
  web.status = VOICE_STATUS.starting;
  web.chunks = [];
  webEmit();

  try {
    web.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    web.status = VOICE_STATUS.idle;
    web.error = (error && error.name) === 'NotAllowedError'
      ? '마이크 권한이 필요합니다. 브라우저 주소창의 마이크 허용을 켜 주세요'
      : (error && error.message) || '마이크를 열지 못했습니다';
    webEmit();
    throw new Error(web.error);
  }

  const mimeType = webMimeCandidates();
  web.recorder = mimeType ? new MediaRecorder(web.stream, { mimeType }) : new MediaRecorder(web.stream);
  web.mime = web.recorder.mimeType || mimeType || 'audio/webm';
  web.name = `${webStamp()}.${webExt(web.mime)}`;
  web.recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) web.chunks.push(event.data);
  };
  web.recorder.onstop = async () => {
    try {
      const blob = new Blob(web.chunks, { type: web.mime });
      if (blob.size > 0) {
        await dbPut({ name: web.name, blob, mime: web.mime, created: Date.now(), size: blob.size });
      }
    } catch (error) {
      console.error('[TIP voice] 녹음을 보관하지 못했습니다', error);
      web.error = '녹음을 보관하지 못했습니다';
    } finally {
      web.chunks = [];
      web.status = VOICE_STATUS.idle;
      webEmit();
      webRelease();
    }
  };
  web.recorder.start(1000);
  web.accumulated = 0;
  web.startedAt = performance.now();
  web.status = VOICE_STATUS.recording;

  try {
    web.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = web.audioContext.createMediaStreamSource(web.stream);
    web.analyser = web.audioContext.createAnalyser();
    web.analyser.fftSize = 1024;
    web.analyser.smoothingTimeConstant = 0.7;
    source.connect(web.analyser);
    const buffer = new Float32Array(web.analyser.fftSize);
    web.levelTimer = setInterval(() => {
      if (!web.analyser) return;
      web.analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let index = 0; index < buffer.length; index += 1) sum += buffer[index] * buffer[index];
      const rms = Math.sqrt(sum / buffer.length);
      webEmitLevel(Math.min(1, Math.pow(rms * 6, 0.6)));
    }, 100);
  } catch { /* 음량을 못 재도 녹음은 계속된다 */ }

  webEmit();
  return webState();
}

function webPause() {
  if (web.recorder && web.recorder.state === 'recording') {
    web.recorder.pause();
    web.accumulated += performance.now() - web.startedAt;
    web.status = VOICE_STATUS.paused;
    webEmitLevel(0);
    webEmit();
  }
  return webState();
}

function webResume() {
  if (web.recorder && web.recorder.state === 'paused') {
    web.recorder.resume();
    web.startedAt = performance.now();
    web.status = VOICE_STATUS.recording;
    webEmit();
  }
  return webState();
}

function webStop() {
  if (web.status === VOICE_STATUS.recording) {
    web.accumulated += performance.now() - web.startedAt;
  }
  if (web.recorder && web.recorder.state !== 'inactive') {
    web.status = VOICE_STATUS.saving;
    webEmit();
    web.recorder.stop();
  } else {
    web.status = VOICE_STATUS.idle;
    webEmit();
    webRelease();
  }
  return webState();
}

/* ------------------------------ 바깥에 보이는 API ------------------------------ */

/** 지금 녹음 상태 — Mac 은 Rust, 웹은 이 페이지의 녹음기. */
export async function voiceState() {
  if (!TAURI) return webState();
  try {
    return normalize(await invoke('voice_status'));
  } catch (error) {
    console.warn('[TIP voice] 상태를 읽지 못했습니다', error);
    return { ...EMPTY };
  }
}

export async function voiceStart(mode) {
  if (!TAURI) return webStart();
  try {
    return normalize(await invoke('voice_start', mode ? { mode } : {}));
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : (error && error.message) || '녹음을 시작하지 못했습니다');
  }
}

export async function voiceStop() {
  if (!TAURI) return webStop();
  try {
    return normalize(await invoke('voice_stop'));
  } catch (error) {
    console.warn('[TIP voice] 중지하지 못했습니다', error);
    return voiceState();
  }
}

export async function voiceToggle(mode) {
  if (!TAURI) {
    const state = webState();
    if (state.status === VOICE_STATUS.recording || state.status === VOICE_STATUS.paused) return webStop();
    return webStart();
  }
  try {
    return normalize(await invoke('voice_toggle', mode ? { mode } : {}));
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : (error && error.message) || '녹음을 시작하지 못했습니다');
  }
}

export async function voicePause() {
  if (!TAURI) return webPause();
  try {
    return normalize(await invoke('voice_pause'));
  } catch (error) {
    console.warn('[TIP voice] 일시정지하지 못했습니다', error);
    return voiceState();
  }
}

export async function voiceResume() {
  if (!TAURI) return webResume();
  try {
    return normalize(await invoke('voice_resume'));
  } catch (error) {
    console.warn('[TIP voice] 이어서 하지 못했습니다', error);
    return voiceState();
  }
}

/** 저장한 녹음 목록 — [{ name, size, created }]. */
export async function voiceList() {
  if (!TAURI) {
    const items = await dbAll().catch(() => []);
    return items.map((entry) => ({ name: entry.name, size: entry.size || 0, created: entry.created || 0 }));
  }
  try {
    const list = await invoke('voice_list');
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.warn('[TIP voice] 녹음 목록을 읽지 못했습니다', error);
    return [];
  }
}

function mimeForName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return 'audio/webm';
}

/** 녹음 하나를 재생할 수 있는 Blob URL 로. 다 쓴 뒤 revokeVoiceUrl 로 놓아 준다. */
export async function voiceUrl(name) {
  if (!TAURI) {
    const items = await dbAll();
    const found = items.find((entry) => entry.name === name);
    if (!found || !found.blob) throw new Error('녹음을 찾지 못했습니다');
    return URL.createObjectURL(found.blob);
  }
  const raw = await invoke('voice_read', { name });
  const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw || 0);
  if (!bytes.length) throw new Error('녹음이 비어 있습니다');
  return URL.createObjectURL(new Blob([bytes], { type: mimeForName(name) }));
}

export function revokeVoiceUrl(url) {
  if (url) {
    try { URL.revokeObjectURL(url); } catch { /* 이미 놓아 준 주소 */ }
  }
}

/** 파일로 저장(내려받기). Mac 은 같은 파일을 한 번 더 내려받는 셈이다. */
export async function voiceDownload(name) {
  const url = await voiceUrl(name);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => revokeVoiceUrl(url), 4000);
}

export async function voiceDelete(name) {
  if (!TAURI) {
    await dbDelete(name);
    return true;
  }
  await invoke('voice_delete', { name });
  return true;
}

/** Finder 에서 보기 — Mac 만. */
export async function voiceReveal(name) {
  if (!TAURI) return false;
  await invoke('voice_reveal', { name });
  return true;
}

/** 마이크 권한 상태 — { status, label }. */
export async function voiceMicStatus() {
  if (TAURI) {
    try {
      const value = await invoke('voice_mic_status');
      if (value && typeof value === 'object') {
        return { status: String(value.status || 'unknown'), label: String(value.label || '') };
      }
    } catch (error) {
      console.warn('[TIP voice] 마이크 권한을 확인하지 못했습니다', error);
    }
    return { status: 'unknown', label: '확인하지 못했습니다' };
  }
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    const map = {
      granted: ['authorized', '허용됨'],
      denied: ['denied', '거부됨. 브라우저 설정에서 마이크를 허용해 주세요'],
      prompt: ['notDetermined', '아직 묻지 않음. 녹음을 처음 시작할 때 브라우저가 묻습니다'],
    };
    const [status, label] = map[result.state] || ['unknown', '확인하지 못했습니다'];
    return { status, label };
  } catch {
    return { status: 'unknown', label: '브라우저가 권한 상태를 알려 주지 않습니다' };
  }
}

/** 마이크 권한을 묻는다 — Mac 은 macOS 팝업, 웹은 브라우저 팝업. */
export async function voiceMicRequest() {
  if (TAURI) {
    await invoke('voice_mic_request').catch((error) => {
      console.warn('[TIP voice] 마이크 권한을 요청하지 못했습니다', error);
    });
    return null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

/** 상태가 바뀔 때마다 부른다. 돌려받은 함수를 부르면 그만 듣는다. */
export function subscribeVoice(callback) {
  if (typeof callback !== 'function') return () => {};
  if (!TAURI) {
    web.stateListeners.add(callback);
    return () => web.stateListeners.delete(callback);
  }
  let stop = null;
  try {
    const pending = listen('tip://voice-state', (event) => {
      callback(normalize(event && event.payload));
    });
    if (pending && typeof pending.then === 'function') {
      pending.then((unlisten) => { if (typeof unlisten === 'function') stop = unlisten; }).catch(() => {});
    }
  } catch (error) {
    console.warn('[TIP voice] 상태 알림을 듣지 못했습니다', error);
  }
  return () => {
    try { if (typeof stop === 'function') stop(); } catch { /* 이미 놓아 준 리스너 */ }
  };
}

/** 음량(0~1) — 모듈 화면의 파형. */
export function subscribeVoiceLevel(callback) {
  if (typeof callback !== 'function') return () => {};
  if (!TAURI) {
    web.levelListeners.add(callback);
    return () => web.levelListeners.delete(callback);
  }
  let stop = null;
  try {
    const pending = listen('tip://voice-level', (event) => {
      const value = Number(event && event.payload);
      callback(Number.isFinite(value) ? value : 0);
    });
    if (pending && typeof pending.then === 'function') {
      pending.then((unlisten) => { if (typeof unlisten === 'function') stop = unlisten; }).catch(() => {});
    }
  } catch (error) {
    console.warn('[TIP voice] 음량 알림을 듣지 못했습니다', error);
  }
  return () => {
    try { if (typeof stop === 'function') stop(); } catch { /* 이미 놓아 준 리스너 */ }
  };
}

/* ------------------------- v1.29.0 · 회의록(화자 분리·받아 적기) ------------------------- */

/** 회의록 엔진 (whisper.cpp + sherpa-onnx) — 준비 여부와 받을 크기. */
export async function voiceEngineStatus() {
  if (!TAURI) {
    return { whisper: false, diarizer: false, ready: false, missing: [], downloadSize: 0, message: '회의록은 Mac 앱에서 만들어집니다' };
  }
  try {
    const value = await invoke('voice_engine_status');
    return {
      whisper: !!(value && value.whisper),
      diarizer: !!(value && value.diarizer),
      ready: !!(value && value.ready),
      missing: Array.isArray(value && value.missing) ? value.missing : [],
      downloadSize: Number(value && value.downloadSize) || 0,
      message: (value && value.message) || '',
    };
  } catch (error) {
    console.warn('[TIP voice] 회의록 엔진 상태를 읽지 못했습니다', error);
    return { whisper: false, diarizer: false, ready: false, missing: [], downloadSize: 0, message: '엔진 상태를 확인하지 못했습니다' };
  }
}

/** 회의록 엔진 내려받기 — 진행률은 subscribeVoiceEngineProgress 로. */
export async function voiceEngineDownload() {
  if (!TAURI) throw new Error('회의록 엔진은 Mac 앱에서 받습니다');
  return invoke('voice_engine_download');
}

/** 저장된 대화록 — 없으면 null. */
export async function voiceTranscript(name) {
  if (!TAURI) return null;
  try {
    return await invoke('voice_transcript', { name });
  } catch (error) {
    console.warn('[TIP voice] 대화록을 읽지 못했습니다', error);
    return null;
  }
}

/** 대화록을 다시 만든다 — 화자 수(2~4)를 바꿔 볼 수 있다. */
export async function voiceTranscribe(name, speakers) {
  if (!TAURI) throw new Error('대화록은 Mac 앱에서 만듭니다');
  return invoke('voice_transcribe', { name, speakers: Number(speakers) || 2 });
}

/** 대화록 준비 상황 — { name, mode, stage, percent, error, transcript }. */
export function subscribeVoiceTranscript(callback) {
  if (typeof callback !== 'function' || !TAURI) return () => {};
  let stop = null;
  try {
    const pending = listen('tip://voice-transcript', (event) => {
      callback((event && event.payload) || {});
    });
    if (pending && typeof pending.then === 'function') {
      pending.then((unlisten) => { if (typeof unlisten === 'function') stop = unlisten; }).catch(() => {});
    }
  } catch (error) {
    console.warn('[TIP voice] 대화록 알림을 듣지 못했습니다', error);
  }
  return () => {
    try { if (typeof stop === 'function') stop(); } catch { /* 이미 놓아 준 리스너 */ }
  };
}

/** 엔진 내려받기 진행률 — { stage, percent }. */
export function subscribeVoiceEngineProgress(callback) {
  if (typeof callback !== 'function' || !TAURI) return () => {};
  let stop = null;
  try {
    const pending = listen('tip://voice-engine-progress', (event) => {
      callback((event && event.payload) || {});
    });
    if (pending && typeof pending.then === 'function') {
      pending.then((unlisten) => { if (typeof unlisten === 'function') stop = unlisten; }).catch(() => {});
    }
  } catch (error) {
    console.warn('[TIP voice] 엔진 진행률을 듣지 못했습니다', error);
  }
  return () => {
    try { if (typeof stop === 'function') stop(); } catch { /* 이미 놓아 준 리스너 */ }
  };
}
