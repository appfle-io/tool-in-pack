/* TIP · 타이머 — 모든 창이 함께 쓰는 하나의 상태 (v1.15.0)
 *
 * macOS 기본 시계 앱은 다른 앱이 조종할 API 가 없다. 그래서 TIP 이 직접 타이머를 돌린다.
 * 상태는 localStorage('tip.timer.v1') 한 곳에만 두고, 노치 알약·노치 패널·메인 창(모듈)이
 * 같은 값을 읽는다. 한 곳에서 시작하면 나머지 창이 storage 이벤트(웹) 또는
 * tip://timer 이벤트(Mac 앱의 다른 창)로 즉시 따라온다.
 *
 * 상태 모양
 *   {
 *     duration: 초,            // 처음 정한 길이
 *     remaining: 초,           // 멈춰 있을 때 남은 시간 (돌고 있으면 endsAt 으로 계산)
 *     endsAt: 에포크 ms | null, // 돌고 있을 때 끝나는 시각
 *     status: 'idle' | 'running' | 'paused' | 'done',
 *     startedAt, finishedAt,
 *   }
 * 끝났다는 판단은 running 이던 상태를 done 으로 **바꾼 창**이 한 번만 알린다
 * (tickTimer 가 true 를 돌려준 쪽). 같은 타이머로 소리가 여러 번 나지 않게 하기 위해서다.
 */

const KEY = 'tip.timer.v1';
const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

/** 빠른 프리셋(분) — 노치·모듈·환경설정이 같은 값을 쓴다. */
export const TIMER_PRESETS = [1, 3, 5, 10, 25];

/** 한 번에 돌릴 수 있는 최대 길이(초) — 24시간. 오타로 며칠짜리가 도는 일을 막는다. */
export const TIMER_MAX_SECONDS = 24 * 60 * 60;

function normalize(raw) {
  const status = ['idle', 'running', 'paused', 'done'].includes(raw && raw.status) ? raw.status : 'idle';
  const duration = Number(raw && raw.duration);
  const remaining = Number(raw && raw.remaining);
  const endsAt = Number(raw && raw.endsAt);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? Math.min(duration, TIMER_MAX_SECONDS) : 0,
    remaining: Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, TIMER_MAX_SECONDS) : 0,
    endsAt: status === 'running' && Number.isFinite(endsAt) && endsAt > 0 ? endsAt : null,
    status,
    startedAt: Number(raw && raw.startedAt) || 0,
    finishedAt: Number(raw && raw.finishedAt) || 0,
  };
}

/** 지금 저장된 타이머 상태. 저장값이 없거나 망가졌으면 idle. */
export function timerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    return normalize(parsed);
  } catch {
    return normalize(null);
  }
}

let lastEmit = 0;

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* private mode — 이번 실행에만 적용된다 */ }
  emit();
}

/** 다른 창에 알린다 — Tauri 는 모든 창에 이벤트로, 웹은 storage 이벤트로 전달된다. */
function emit() {
  // 같은 순간에 여러 번 쓰면 이벤트도 여러 번 — 20ms 안의 중복은 보내지 않는다.
  const now = Date.now();
  if (now - lastEmit < 20) return;
  lastEmit = now;
  try {
    const tauri = window.__TAURI__;
    if (tauri && tauri.event && typeof tauri.event.emit === 'function') {
      Promise.resolve(tauri.event.emit('tip://timer', null)).catch(() => {});
    }
  } catch { /* 알리지 못해도 값은 저장됐다 — 다음 틱에 읽는다 */ }
}

/** 남은 시간(초, 소수) — 돌고 있으면 지금 시각으로 계산한다. */
export function remainingSeconds(state = timerState()) {
  if (state.status === 'running' && state.endsAt) {
    return Math.max(0, (state.endsAt - Date.now()) / 1000);
  }
  if (state.status === 'done') return 0;
  return state.remaining;
}

/** 지금 길이 — 처음 정한 시간. 진행률 계산에 쓴다. */
export function totalSeconds(state = timerState()) {
  return state.duration || 0;
}

/** '초' 를 받아 시작한다. 0 이하·너무 긴 값은 거절한다. */
export function startTimer(seconds) {
  const value = Math.round(Number(seconds));
  if (!Number.isFinite(value) || value <= 0) return false;
  const length = Math.min(value, TIMER_MAX_SECONDS);
  write({
    duration: length,
    remaining: length,
    endsAt: Date.now() + length * 1000,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: 0,
  });
  return true;
}

export function pauseTimer() {
  const state = timerState();
  if (state.status !== 'running') return false;
  const left = remainingSeconds(state);
  if (left <= 0.2) return false;
  write({ ...state, status: 'paused', remaining: left, endsAt: null });
  return true;
}

export function resumeTimer() {
  const state = timerState();
  if (state.status !== 'paused' || state.remaining <= 0) return false;
  write({ ...state, status: 'running', endsAt: Date.now() + state.remaining * 1000 });
  return true;
}

/** 멈춤/재개를 한 버튼으로 — 노치·모듈의 큰 버튼. */
export function toggleTimer() {
  const state = timerState();
  if (state.status === 'running') return pauseTimer();
  if (state.status === 'paused') return resumeTimer();
  return false;
}

/** 처음 상태로 되돌린다(기록은 남기지 않는다). */
export function resetTimer() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* 지우지 못하면 idle 로 덮어쓴다 */ }
  emit();
}

/** 남은 시간에 더한다(+60초 등). 돌고 있으면 끝나는 시각을 늘린다. */
export function extendTimer(seconds) {
  const state = timerState();
  if (state.status === 'idle') return false;
  const delta = Math.round(Number(seconds)) || 0;
  if (!delta) return false;
  if (state.status === 'running') {
    write({ ...state, endsAt: (state.endsAt || Date.now()) + delta * 1000, duration: Math.max(1, state.duration + delta) });
    return true;
  }
  if (state.status === 'paused') {
    write({ ...state, remaining: Math.max(1, state.remaining + delta), duration: Math.max(1, state.duration + delta) });
    return true;
  }
  return false;
}

/** 시간이 다 됐는지 확인한다. 끝났음을 이 호출이 확정했으면 true — 알림은 그 창만 낸다. */
export function tickTimer() {
  const state = timerState();
  if (state.status !== 'running' || !state.endsAt) return false;
  if (Date.now() < state.endsAt) return false;
  const fresh = timerState();   // 다른 창이 먼저 끝냈는지 마지막으로 확인
  if (fresh.status !== 'running') return false;
  write({ ...fresh, status: 'done', remaining: 0, endsAt: null, finishedAt: Date.now() });
  return true;
}

/* ------------------------------ 표시 형식 ------------------------------ */

/** 남은 초 → '04:58' (한 시간이 넘으면 '1:04:58'). */
export function formatClock(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 사람이 읽는 길이 — '1분 30초', '7분', '2시간'. */
export function describeSeconds(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total <= 0) return '0초';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const parts = [];
  if (hours) parts.push(`${hours}시간`);
  if (minutes) parts.push(`${minutes}분`);
  if (rest || !parts.length) parts.push(`${rest}초`);
  return parts.join(' ');
}

/* --------------------------- 검색어 → 시간 --------------------------- */
/*
 * 전역 검색(Option+Space)에서 `타이머 7분`, `타이머 1분 30초`, `timer 90s`, `타이머 7:30`
 * 처럼 치면 바로 시작할 수 있게 초로 바꾼다. 타이머라는 말이 없으면 null.
 */

const TIMER_WORD = /^(?:타이머|타이머시작|timer|timerstart)\s*(.*)$/i;

/** 검색어가 타이머 명령인지 — 맞으면 { seconds, text }, 아니면 null. */
export function parseTimerQuery(query) {
  const text = String(query || '').trim();
  const match = text.match(TIMER_WORD);
  if (!match) return null;
  const rest = (match[1] || '').trim();
  if (!rest) return { seconds: 0, text: '', bare: true };

  // 7:30 — 분:초
  const clock = rest.match(/^(\d{1,3})\s*:\s*(\d{1,2})$/);
  if (clock) {
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    if (seconds < 60) return { seconds: minutes * 60 + seconds, text: rest, bare: false };
  }

  // 1시간 20분 30초 / 2h 15m / 90s 같은 조합
  let total = 0;
  let matched = false;
  const part = /(\d+(?:\.\d+)?)\s*(시간|분|초|hours?|hrs?|minutes?|mins?|seconds?|secs?|h|m|s)/gi;
  let found;
  while ((found = part.exec(rest)) !== null) {
    const value = Number(found[1]);
    const unit = found[2].toLowerCase();
    matched = true;
    if (unit.startsWith('시') || unit === 'h' || unit.startsWith('hour') || unit.startsWith('hr')) total += value * 3600;
    else if (unit.startsWith('분') || unit === 'm' || unit.startsWith('min')) total += value * 60;
    else total += value;
  }
  if (matched) return { seconds: Math.round(total), text: rest, bare: false };

  // 숫자만 — 분으로 본다(타이머 7 → 7분). 90 처럼 60을 넘으면 초로 본다.
  const bare = rest.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const value = Number(bare[1]);
    return { seconds: Math.round(value > 60 ? value : value * 60), text: rest, bare: false };
  }
  return { seconds: 0, text: rest, bare: false };
}

/* ------------------------------ 구독 ------------------------------ */

/** 타이머가 바뀔 때마다 cb — 다른 창의 저장(storage)과 Tauri 이벤트를 함께 듣는다. */
export function subscribeTimer(cb) {
  const onStorage = (event) => {
    if (!event.key || event.key === KEY) cb(timerState());
  };
  window.addEventListener('storage', onStorage);
  let unlisten = null;
  try {
    const tauri = window.__TAURI__;
    if (tauri && tauri.event && typeof tauri.event.listen === 'function') {
      Promise.resolve(tauri.event.listen('tip://timer', () => cb(timerState())))
        .then((fn) => { unlisten = fn; })
        .catch(() => {});
    }
  } catch { /* 이벤트를 못 들으면 다음 틱에 읽는다 */ }
  return () => {
    window.removeEventListener('storage', onStorage);
    try { if (typeof unlisten === 'function') unlisten(); } catch { /* 이미 정리됨 */ }
  };
}

/* ------------------------------ 끝 알림 ------------------------------ */

function beepWeb() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [0, 0.28, 0.56].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.24);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1400);
  } catch { /* 소리를 못 내도 화면 알림은 남는다 */ }
}

/** 타이머가 끝났을 때 — Mac 은 알림 센터 + 소리, 웹은 알림 + 소리. 실패해도 조용히 넘어간다. */
export async function alertTimerDone(length = 0) {
  const body = length ? `${describeSeconds(length)} 타이머가 끝났습니다` : '타이머가 끝났습니다';
  if (TAURI) {
    try {
      await window.__TAURI__.core.invoke('timer_alert', { title: 'TIP 타이머', body });
      return;
    } catch (error) {
      console.warn('[TIP timer] 알림:', error);
    }
  }
  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') new Notification('TIP 타이머', { body });
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') new Notification('TIP 타이머', { body });
        }).catch(() => {});
      }
    }
  } catch { /* 알림을 못 띄워도 소리는 낸다 */ }
  beepWeb();
}
