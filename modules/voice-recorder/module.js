/**
 * TIP · 녹음 (voice-recorder, v1.22.0)
 *
 * 한 번 누르면 바로 녹음이 시작되고, 같은 버튼(또는 단축키)을 다시 누르면 중지·저장한다.
 * 녹음은 Mac 앱의 숨은 상주 창(js/recorder.js)이 맡으므로 **이 창을 닫아도 끊기지 않는다**.
 * 저장한 녹음은 ~/Music/TIP Recordings 에 남고, 여기서 재생·저장·삭제할 수 있다.
 * 웹(PWA)에서는 이 화면 안에서만 녹음하고, 저장한 녹음은 브라우저(IndexedDB)에 남는다.
 */

import {
  voiceState, voiceStart, voiceStop, voicePause, voiceResume,
  voiceList, voiceUrl, revokeVoiceUrl, voiceDownload, voiceDelete, voiceReveal,
  voiceMicStatus, voiceMicRequest, subscribeVoice, subscribeVoiceLevel,
  formatVoiceClock, formatVoiceSize, voiceIsMac, VOICE_STATUS,
} from '../../js/voice.js';
import { getShortcut } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/></svg>`;

/** 단축키 표시 — ⌃⇧R 처럼. */
function prettyShortcut(value) {
  if (!value) return '';
  return String(value)
    .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, '⌘')
    .replace(/Control|Ctrl/g, '⌃')
    .replace(/Alt|Option/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '')
    .replace(/Key([A-Z])/g, '$1')
    .replace(/Digit([0-9])/g, '$1');
}

function dayLabel(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return sameDay ? `오늘 ${clock}` : `${date.getMonth() + 1}월 ${date.getDate()}일 ${clock}`;
}

const module = {
  id: 'voice-recorder',
  name: '녹음',
  shortName: '녹음',
  kind: 'tool',
  category: 'media',
  version: '1.22.0',
  subtitle: '단축키 한 번으로 켜고 끄는 녹음',
  description: '단축키를 한 번 누르면 바로 녹음이 시작되고, 다시 누르면 중지해 저장합니다. 창을 닫아도 녹음은 이어지고, 노치 알약과 반원, 펼친 패널에서 녹음 중임을 확인하고 멈출 수 있습니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: true,
  macOnly: false,

  mount(root, ctx) {
    const controller = new AbortController();
    const { signal } = controller;
    const toast = ctx?.toast || (() => {});
    const mac = voiceIsMac();

    let state = {
      status: VOICE_STATUS.idle, elapsedMs: 0, level: 0, name: null, mime: '', error: null, dir: '', bytes: 0,
    };
    let level = 0;
    let levelPaint = 0;
    let files = [];
    let playing = null;      // { name, url, audio }
    let confirming = null;   // 삭제 두 번 확인 중인 이름
    let confirmTimer = null;
    let tickTimer = null;
    let busy = false;

    const shortcut = mac ? prettyShortcut(getShortcut('voice:record')) : '';

    root.innerHTML = `
      <div class="v16 vr">
        <div class="vr-card" id="vr-card">
          <div class="vr-head">
            <span class="vr-tag" id="vr-tag"><i></i>대기</span>
            <span class="vr-meta" id="vr-meta"></span>
          </div>
          <div class="vr-clock" id="vr-clock" aria-live="off">00:00</div>
          <div class="vr-meter" role="img" aria-label="녹음 음량">
            <i class="vr-meter-fill" id="vr-fill"></i>
          </div>
          <p class="vr-state" id="vr-state">녹음을 시작하면 이 Mac 안에만 저장합니다</p>
          <div class="vr-actions">
            <button class="v16-btn primary vr-main" type="button" id="vr-main">녹음 시작</button>
            <button class="v16-btn" type="button" id="vr-pause" disabled>일시정지</button>
          </div>
        </div>

        <div class="v16-block">
          <div class="v16-block-head"><span>어디서든</span><span class="vr-side" id="vr-side">${mac ? '단축키' : '이 화면'}</span></div>
          <p class="v16-note" id="vr-hint">${mac
    ? (shortcut
      ? `<b>${shortcut}</b> 한 번이면 바로 녹음이 시작되고, 같은 단축키를 한 번 더 누르면 중지해 저장합니다. 이 창을 닫아도 녹음은 이어집니다.`
      : '환경설정 → 모듈 → 녹음에서 단축키를 정하면 어디서든 한 번에 켜고 끌 수 있습니다.')
    : '이 화면을 닫으면 녹음이 끝납니다. 저장한 녹음은 이 브라우저 안에만 남습니다.'}</p>
          <p class="v16-note" id="vr-dir">${mac ? '저장 위치: ~/Music/TIP Recordings' : '저장 위치: 이 브라우저의 녹음 보관함'}</p>
        </div>

        <div class="v16-block">
          <div class="v16-block-head">
            <span>저장한 녹음</span>
            <span class="vr-side"><span id="vr-count">0</span>개</span>
          </div>
          <ul class="vr-list" id="vr-list" aria-label="저장한 녹음"></ul>
          <p class="v16-note" id="vr-empty">아직 저장한 녹음이 없습니다.</p>
        </div>

        <div class="v16-block" id="vr-perm-block"${mac ? '' : ' hidden'}>
          <div class="v16-block-head"><span>마이크 권한</span><span class="vr-side" id="vr-perm">확인 중…</span></div>
          <div class="vr-perm-row">
            <button class="v16-btn" type="button" id="vr-perm-ask">권한 요청</button>
            <button class="v16-btn" type="button" id="vr-perm-open">시스템 설정 열기</button>
          </div>
        </div>
      </div>`;

    const cardEl = root.querySelector('#vr-card');
    const tagEl = root.querySelector('#vr-tag');
    const metaEl = root.querySelector('#vr-meta');
    const clockEl = root.querySelector('#vr-clock');
    const fillEl = root.querySelector('#vr-fill');
    const stateEl = root.querySelector('#vr-state');
    const mainBtn = root.querySelector('#vr-main');
    const pauseBtn = root.querySelector('#vr-pause');
    const listEl = root.querySelector('#vr-list');
    const emptyEl = root.querySelector('#vr-empty');
    const countEl = root.querySelector('#vr-count');
    const dirEl = root.querySelector('#vr-dir');
    const permEl = root.querySelector('#vr-perm');

    function paint() {
      const active = state.status === VOICE_STATUS.recording;
      const paused = state.status === VOICE_STATUS.paused;
      const saving = state.status === VOICE_STATUS.saving;
      const starting = state.status === VOICE_STATUS.starting;
      const live = active || paused || saving || starting;

      cardEl.classList.toggle('is-live', live);
      cardEl.classList.toggle('is-paused', paused);
      cardEl.classList.toggle('is-saving', saving);
      clockEl.textContent = state.status === VOICE_STATUS.idle
        ? '00:00'
        : formatVoiceClock(state.elapsedMs);
      clockEl.classList.toggle('is-live', active);

      tagEl.innerHTML = live
        ? `<i class="is-rec"></i>${saving ? '저장 중' : paused ? '일시정지' : starting ? '시작 중' : '녹음 중'}`
        : '<i></i>대기';
      metaEl.textContent = state.name || '';

      stateEl.textContent = state.error
        ? state.error
        : saving ? '파일을 마무리하는 중입니다'
          : paused ? '일시정지했습니다. 이어서 눌러 계속 녹음하세요'
            : active ? '녹음 중입니다. 창을 닫아도 이어집니다'
              : starting ? '마이크를 여는 중입니다'
                : '녹음을 시작하면 이 Mac 안에만 저장합니다';

      mainBtn.textContent = live ? '중지하고 저장' : '녹음 시작';
      mainBtn.disabled = saving || busy;
      pauseBtn.textContent = paused ? '이어서 녹음' : '일시정지';
      pauseBtn.disabled = !(active || paused) || saving || busy;

      const width = active || paused ? Math.max(2, Math.round(level * 100)) : 0;
      fillEl.style.width = `${width}%`;
      if (state.dir) dirEl.textContent = `저장 위치: ${state.dir}`;
    }

    function paintPermission(position) {
      if (!permEl) return;
      const map = {
        authorized: '허용됨',
        denied: '거부됨',
        restricted: '막혀 있음',
        notDetermined: '아직 묻지 않음',
        unknown: '확인하지 못함',
      };
      permEl.textContent = map[position] || String(position || '확인하지 못함');
    }

    async function refreshPermission() {
      if (!mac) return;
      const status = await voiceMicStatus();
      paintPermission(status.status);
      permEl.title = status.label || '';
    }

    async function refreshList() {
      files = await voiceList().catch(() => []);
      countEl.textContent = String(files.length);
      emptyEl.hidden = files.length > 0;
      listEl.innerHTML = '';
      files.forEach((file) => {
        const item = document.createElement('li');
        item.className = 'vr-item';
        item.dataset.name = file.name;
        item.innerHTML = `
          <div class="vr-item-text">
            <b>${file.name.replace(/\.[^.]+$/, '')}</b>
            <span>${dayLabel(file.created)} · ${formatVoiceSize(file.size)}</span>
          </div>
          <div class="vr-item-actions">
            <button class="vr-mini" type="button" data-act="play">재생</button>
            <button class="vr-mini" type="button" data-act="save">저장</button>
            ${mac ? '<button class="vr-mini" type="button" data-act="finder">Finder</button>' : ''}
            <button class="vr-mini is-danger" type="button" data-act="delete">삭제</button>
          </div>`;
        listEl.append(item);
      });
    }

    function stopPlayback() {
      if (!playing) return;
      try { playing.audio.pause(); } catch { /* 이미 멈춤 */ }
      revokeVoiceUrl(playing.url);
      const item = playing.name ? listEl.querySelector(`.vr-item[data-name="${CSS.escape(playing.name)}"]`) : null;
      if (item) {
        const button = item.querySelector('[data-act="play"]');
        if (button) button.textContent = '재생';
      }
      playing = null;
    }

    async function togglePlay(name) {
      if (playing && playing.name === name) {
        stopPlayback();
        return;
      }
      stopPlayback();
      const item = listEl.querySelector(`.vr-item[data-name="${CSS.escape(name)}"]`);
      const button = item ? item.querySelector('[data-act="play"]') : null;
      try {
        const url = await voiceUrl(name);
        const audio = new Audio(url);
        audio.addEventListener('ended', () => stopPlayback(), { signal });
        audio.addEventListener('error', () => {
          toast('녹음을 재생하지 못했습니다');
          stopPlayback();
        }, { signal });
        await audio.play();
        playing = { name, url, audio };
        if (button) button.textContent = '멈춤';
      } catch (error) {
        console.error('[TIP voice] 재생하지 못했습니다', error);
        toast('녹음을 재생하지 못했습니다');
      }
    }

    async function onListClick(event) {
      const button = event.target.closest('button[data-act]');
      const item = event.target.closest('.vr-item');
      if (!button || !item) return;
      const name = item.dataset.name;
      const act = button.dataset.act;
      if (act === 'play') {
        await togglePlay(name);
        return;
      }
      if (act === 'save') {
        try {
          await voiceDownload(name);
          toast('녹음 파일을 내려받았습니다');
        } catch (error) {
          console.error('[TIP voice] 저장하지 못했습니다', error);
          toast('녹음 파일을 저장하지 못했습니다');
        }
        return;
      }
      if (act === 'finder') {
        try {
          await voiceReveal(name);
        } catch (error) {
          toast('Finder 를 열지 못했습니다');
        }
        return;
      }
      if (act === 'delete') {
        if (confirming !== name) {
          confirming = name;
          if (confirmTimer) clearTimeout(confirmTimer);
          listEl.querySelectorAll('[data-act="delete"]').forEach((el) => {
            el.classList.remove('is-confirm');
            el.textContent = '삭제';
          });
          button.classList.add('is-confirm');
          button.textContent = '정말 삭제';
          confirmTimer = setTimeout(() => {
            confirming = null;
            button.classList.remove('is-confirm');
            button.textContent = '삭제';
          }, 4000);
          return;
        }
        if (confirmTimer) clearTimeout(confirmTimer);
        confirming = null;
        if (playing && playing.name === name) stopPlayback();
        try {
          await voiceDelete(name);
          toast('녹음을 지웠습니다');
          await refreshList();
        } catch (error) {
          console.error('[TIP voice] 지우지 못했습니다', error);
          toast('녹음을 지우지 못했습니다');
        }
      }
    }

    async function run(action) {
      if (busy) return;
      busy = true;
      paint();
      try {
        const next = await action();
        if (next) state = next;
      } catch (error) {
        console.error('[TIP voice]', error);
        toast((error && error.message) || '녹음을 시작하지 못했습니다');
        state = await voiceState();
      } finally {
        busy = false;
        paint();
      }
    }

    mainBtn.addEventListener('click', () => {
      const live = state.status === VOICE_STATUS.recording || state.status === VOICE_STATUS.paused
        || state.status === VOICE_STATUS.starting;
      run(async () => {
        if (live) {
          const next = await voiceStop();
          await refreshList();
          return next;
        }
        return voiceStart();
      });
    }, { signal });

    pauseBtn.addEventListener('click', () => {
      run(() => (state.status === VOICE_STATUS.paused ? voiceResume() : voicePause()));
    }, { signal });

    listEl.addEventListener('click', onListClick, { signal });

    const askBtn = root.querySelector('#vr-perm-ask');
    if (askBtn) {
      askBtn.addEventListener('click', async () => {
        if (mac) {
          await voiceMicRequest();
          setTimeout(refreshPermission, 800);
        } else {
          const granted = await voiceMicRequest();
          paintPermission(granted ? 'authorized' : 'denied');
        }
      }, { signal });
    }
    const openBtn = root.querySelector('#vr-perm-open');
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        if (mac && ctx?.openSettings) ctx.openSettings('voice-recorder');
        else toast('시스템 설정 → 개인정보 보호 및 보안 → 마이크에서 TIP 을 켜 주세요');
      }, { signal });
    }

    // 상태 알림 — Mac 은 다른 창(단축키·노치)에서 시작·중지해도 이 화면이 따라온다.
    const stopState = subscribeVoice((next) => {
      const wasLive = state.status !== VOICE_STATUS.idle;
      state = next;
      paint();
      if (wasLive && next.status === VOICE_STATUS.idle) refreshList();
    });

    const stopLevel = subscribeVoiceLevel((value) => {
      const now = performance.now();
      if (now - levelPaint < 60) return;
      levelPaint = now;
      level = value;
      paint();
    });

    // 경과 시간은 0.5초마다 새로 읽는다(Mac 은 Rust 가, 웹은 이 화면이 센다).
    tickTimer = setInterval(async () => {
      if (state.status === VOICE_STATUS.idle || state.status === VOICE_STATUS.saving) return;
      const next = await voiceState();
      if (next.status !== state.status || Math.abs(next.elapsedMs - state.elapsedMs) > 400) {
        state = next;
        paint();
        return;
      }
      state = next;
      paint();
    }, 500);

    refreshPermission();
    refreshList();
    voiceState().then((next) => {
      state = next;
      paint();
    });

    return () => {
      controller.abort();
      if (confirmTimer) clearTimeout(confirmTimer);
      if (tickTimer) clearInterval(tickTimer);
      stopState();
      stopLevel();
      stopPlayback();
    };
  },
};

export default module;
