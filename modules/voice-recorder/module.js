/**
 * TIP · 녹음 (voice-recorder, v1.29.0)
 *
 * 모드 세 가지 — 같은 버튼·단축키로 켜고 끈다.
 *   일반 녹음   마이크로 담아 저장만 한다(예전 그대로).
 *   대면 회의   마이크로 담고, 멈추면 **화자 분리 + 받아 적기**로 화자별 대화록을 만든다.
 *   화상 회의   내 마이크('나') + macOS 시스템 오디오('상대방')를 함께 담아 각각 받아 적는다.
 *
 * 녹음은 Mac 앱의 숨은 상주 창(js/recorder.js)이 맡으므로 **이 창을 닫아도 끊기지 않는다**.
 * 회의록 엔진(whisper.cpp + sherpa-onnx)은 처음 한 번만 내려받고, 그 뒤에는 인터넷 없이 돈다.
 *
 * 웹(PWA)에서는 이 화면 안에서만 녹음하고(일반 녹음), 화자 분리·받아 적기는 Mac 앱에서 된다.
 */

import {
  voiceState, voiceStart, voiceStop, voicePause, voiceResume,
  voiceList, voiceUrl, revokeVoiceUrl, voiceDownload, voiceDelete, voiceReveal,
  voiceMicStatus, voiceMicRequest, subscribeVoice, subscribeVoiceLevel,
  voiceEngineStatus, voiceEngineDownload, voiceTranscript, voiceTranscribe,
  subscribeVoiceTranscript, subscribeVoiceEngineProgress,
  formatVoiceClock, formatVoiceSize, voiceIsMac, VOICE_STATUS,
} from '../../js/voice.js';
import { getShortcut, getFeatureValue } from '../../js/feature-settings.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M9 21h6"/></svg>`;

const MODES = [
  {
    id: 'normal',
    label: '일반 녹음',
    note: '마이크로 담아 그대로 저장합니다.',
    shortcutKey: 'voice:record',
  },
  {
    id: 'inperson',
    label: '대면 회의',
    note: '마이크로 담고, 멈추면 화자 분리와 받아 적기로 화자별 대화록을 만듭니다.',
    shortcutKey: 'voice:meeting-inperson',
  },
  {
    id: 'online',
    label: '화상 회의',
    note: '내 마이크(나)와 Mac 안에서 나는 소리(상대방)를 함께 담고, 각각 받아 적습니다.',
    shortcutKey: 'voice:meeting-online',
  },
];

const SPEAKER_KEY = 'tip.voice.speakers.v1';

/** ⌃⇧R 처럼 보여 준다. */
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

function clockLabel(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** 대화록의 화자 이름(사용자가 바꾼 것) 저장소. */
function readSpeakerNames() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SPEAKER_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSpeakerNames(all) {
  try {
    localStorage.setItem(SPEAKER_KEY, JSON.stringify(all));
  } catch { /* 저장하지 못하면 이번 화면에만 */ }
}

const module = {
  id: 'voice-recorder',
  name: '녹음',
  shortName: '녹음',
  kind: 'tool',
  category: 'media',
  version: '1.29.0',
  subtitle: '한 번에 켜고, 회의는 대화록까지',
  description: '일반 녹음과 대면 회의, 화상 회의 세 모드로 담습니다. 회의 모드는 멈추면 이 Mac 안에서 화자 분리와 받아 적기를 해 화자별 대화록을 만들고, 화상 회의는 내 마이크(나)와 시스템 오디오(상대방)를 나누어 받아 적습니다.',
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
      status: VOICE_STATUS.idle, elapsedMs: 0, level: 0, name: null, mime: '', error: null,
      dir: '', bytes: 0, mode: 'normal', partner: null, notice: null,
    };
    let level = 0;
    let levelPaint = 0;
    let files = [];
    let playing = null;
    let confirming = null;
    let confirmTimer = null;
    let tickTimer = null;
    let busy = false;
    let mode = 'normal';
    let engine = { ready: false, whisper: false, diarizer: false, downloadSize: 0, message: '' };
    let engineBusy = false;
    let transcript = null;        // 지금 화면에 띄운 대화록
    let transcriptJob = { name: '', stage: '', percent: 0, error: '' };
    let speakerNames = readSpeakerNames();
    const speakerCount = Number(getFeatureValue('voice.speakers', '2')) || 2;

    root.innerHTML = `
      <div class="v16 vr">
        <div class="ic-segment vr-modes" id="vr-modes" role="tablist" aria-label="녹음 모드"></div>
        <p class="v16-note" id="vr-mode-note"></p>

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

        <div class="v16-block" id="vr-engine" hidden>
          <div class="v16-block-head"><span>회의록 엔진</span><span class="vr-side" id="vr-engine-state">확인 중…</span></div>
          <p class="v16-note" id="vr-engine-note"></p>
          <div class="vr-perm-row">
            <button class="v16-btn primary" type="button" id="vr-engine-get">내려받기</button>
          </div>
          <div class="ocr-progress" id="vr-engine-progress" hidden>
            <div class="ocr-bar"><span id="vr-engine-fill"></span></div>
            <div class="ocr-status" id="vr-engine-status"></div>
          </div>
        </div>

        <div class="v16-block" id="vr-transcript" hidden>
          <div class="v16-block-head">
            <span>대화록</span>
            <span class="vr-side" id="vr-transcript-state"></span>
          </div>
          <div class="ocr-progress" id="vr-transcript-progress" hidden>
            <div class="ocr-bar"><span id="vr-transcript-fill"></span></div>
            <div class="ocr-status" id="vr-transcript-status"></div>
          </div>
          <div class="vr-perm-row" id="vr-transcript-tools">
            <button class="v16-btn" type="button" id="vr-transcript-again">다시 만들기</button>
            <button class="v16-btn" type="button" id="vr-transcript-copy">복사</button>
            <button class="v16-btn" type="button" id="vr-transcript-save">TXT 저장</button>
          </div>
          <ol class="vr-lines" id="vr-lines" aria-label="대화록"></ol>
          <p class="v16-note" id="vr-transcript-empty">대화록이 아직 없습니다.</p>
        </div>

        <div class="v16-block">
          <div class="v16-block-head"><span>어디서든</span><span class="vr-side" id="vr-side">${mac ? '단축키' : '이 화면'}</span></div>
          <p class="v16-note" id="vr-hint"></p>
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
          <div class="v16-block-head"><span>권한</span><span class="vr-side" id="vr-perm">확인 중…</span></div>
          <div class="vr-perm-row">
            <button class="v16-btn" type="button" id="vr-perm-ask">마이크 권한 요청</button>
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
    const modesEl = root.querySelector('#vr-modes');
    const modeNoteEl = root.querySelector('#vr-mode-note');
    const hintEl = root.querySelector('#vr-hint');
    const engineEl = root.querySelector('#vr-engine');
    const engineStateEl = root.querySelector('#vr-engine-state');
    const engineNoteEl = root.querySelector('#vr-engine-note');
    const engineBtn = root.querySelector('#vr-engine-get');
    const engineProgress = root.querySelector('#vr-engine-progress');
    const engineFill = root.querySelector('#vr-engine-fill');
    const engineStatusEl = root.querySelector('#vr-engine-status');
    const transcriptEl = root.querySelector('#vr-transcript');
    const transcriptStateEl = root.querySelector('#vr-transcript-state');
    const transcriptProgress = root.querySelector('#vr-transcript-progress');
    const transcriptFill = root.querySelector('#vr-transcript-fill');
    const transcriptStatusEl = root.querySelector('#vr-transcript-status');
    const transcriptEmpty = root.querySelector('#vr-transcript-empty');
    const linesEl = root.querySelector('#vr-lines');

    /* ------------------------------ 모드 탭 ------------------------------ */

    MODES.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ic-seg';
      button.dataset.mode = item.id;
      button.textContent = item.label;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(item.id === mode));
      button.tabIndex = item.id === mode ? 0 : -1;
      button.addEventListener('click', () => {
        if (busy || live()) return;
        mode = item.id;
        paintModes();
      }, { signal });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const index = MODES.findIndex((entry) => entry.id === item.id);
        const next = MODES[(index + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
        mode = next.id;
        paintModes();
        modesEl.querySelector(`[data-mode="${next.id}"]`).focus();
      }, { signal });
      modesEl.append(button);
    });

    function live() {
      return state.status === VOICE_STATUS.recording || state.status === VOICE_STATUS.paused
        || state.status === VOICE_STATUS.starting || state.status === VOICE_STATUS.saving;
    }

    function shortcutOf(key) {
      if (!mac) return '';
      return prettyShortcut(getShortcut(key));
    }

    function paintModes() {
      MODES.forEach((item) => {
        const button = modesEl.querySelector(`[data-mode="${item.id}"]`);
        if (!button) return;
        const selected = item.id === mode;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.disabled = live();
      });
      const current = MODES.find((item) => item.id === mode) || MODES[0];
      modeNoteEl.textContent = current.note;
      // 화상 회의는 macOS 시스템 오디오가 필요하다.
      const needsMac = mode !== 'normal';
      engineEl.hidden = !(mac && needsMac);
      if (!mac && needsMac) modeNoteEl.textContent = `${current.note} 화자 분리와 받아 적기는 Mac 앱에서 됩니다.`;
      const shortcut = shortcutOf(current.shortcutKey);
      hintEl.innerHTML = mac
        ? (shortcut
          ? `<b>${shortcut}</b> 한 번이면 ${current.label}이 시작되고, 같은 단축키를 한 번 더 누르면 중지해 저장합니다. 이 창을 닫아도 녹음은 이어집니다.`
          : `환경설정 → 모듈 → 녹음에서 ${current.label} 단축키를 정하면 어디서든 한 번에 켜고 끌 수 있습니다.`)
        : '이 화면을 닫으면 녹음이 끝납니다. 저장한 녹음은 이 브라우저 안에만 남습니다.';
      mainBtn.textContent = live() ? '중지하고 저장' : `${current.label} 시작`;
      paintEngine();
    }

    /* ------------------------------ 카드 ------------------------------ */

    function paint() {
      const active = state.status === VOICE_STATUS.recording;
      const paused = state.status === VOICE_STATUS.paused;
      const saving = state.status === VOICE_STATUS.saving;
      const starting = state.status === VOICE_STATUS.starting;
      const running = active || paused || saving || starting;

      cardEl.classList.toggle('is-live', running);
      cardEl.classList.toggle('is-paused', paused);
      cardEl.classList.toggle('is-saving', saving);
      clockEl.textContent = state.status === VOICE_STATUS.idle ? '00:00' : formatVoiceClock(state.elapsedMs);
      clockEl.classList.toggle('is-live', active);

      tagEl.innerHTML = running
        ? `<i class="is-rec"></i>${saving ? '저장 중' : paused ? '일시정지' : starting ? '시작 중' : '녹음 중'}`
        : '<i></i>대기';
      const shown = state.name || state.partner || '';
      metaEl.textContent = shown;
      metaEl.title = shown;

      stateEl.textContent = state.error
        ? state.error
        : state.notice ? state.notice
          : saving ? '파일을 마무리하는 중입니다'
            : paused ? '일시정지했습니다. 이어서 눌러 계속 녹음하세요'
              : active ? (state.mode === 'normal' ? '녹음 중입니다. 창을 닫아도 이어집니다' : '녹음 중입니다. 멈추면 대화록을 만듭니다')
                : starting ? '마이크를 여는 중입니다'
                  : '녹음을 시작하면 이 Mac 안에만 저장합니다';

      const current = MODES.find((item) => item.id === mode) || MODES[0];
      mainBtn.textContent = running ? '중지하고 저장' : `${current.label} 시작`;
      mainBtn.disabled = saving || busy;
      pauseBtn.textContent = paused ? '이어서 녹음' : '일시정지';
      pauseBtn.disabled = !(active || paused) || saving || busy;

      const width = active || paused ? Math.max(2, Math.round(level * 100)) : 0;
      fillEl.style.width = `${width}%`;
      if (state.dir) dirEl.textContent = `저장 위치: ${state.dir}`;

      // 녹음 중에는 모드를 바꾸지 않는다.
      MODES.forEach((item) => {
        const button = modesEl.querySelector(`[data-mode="${item.id}"]`);
        if (button) button.disabled = running || busy;
      });
    }

    function paintPermission(position) {
      if (!permEl) return;
      const map = {
        authorized: '마이크 허용됨',
        denied: '마이크 거부됨',
        restricted: '마이크 막혀 있음',
        notDetermined: '마이크 아직 묻지 않음',
        unknown: '권한 확인하지 못함',
      };
      permEl.textContent = map[position] || String(position || '확인하지 못함');
    }

    async function refreshPermission() {
      if (!mac) return;
      const status = await voiceMicStatus();
      paintPermission(status.status);
      permEl.title = status.label || '';
    }

    /* ------------------------------ 회의록 엔진 ------------------------------ */

    function paintEngine() {
      if (!mac) return;
      const needed = mode !== 'normal';
      engineEl.hidden = !needed;
      if (!needed) return;
      if (engineBusy) {
        engineBtn.disabled = true;
        engineBtn.textContent = '받는 중…';
        return;
      }
      engineBtn.disabled = engine.ready;
      engineBtn.textContent = engine.ready ? '준비됨' : '내려받기';
      engineStateEl.textContent = engine.ready ? '준비됨' : '아직 없음';
      const sizeMb = Math.round((engine.downloadSize || 0) / 1048576);
      engineNoteEl.textContent = engine.ready
        ? '이 Mac 안에서 화자 분리와 받아 적기를 합니다. 인터넷 없이도 됩니다.'
        : `처음 한 번 회의록 엔진(약 ${sizeMb}MB)을 내려받습니다. 그 뒤에는 인터넷 없이 돕니다.`;

      // 화상 회의는 시스템 오디오 담기에 화면 기록 권한이 필요하다.
      if (mode === 'online') {
        const extra = document.createElement('p');
        extra.className = 'v16-note';
        extra.textContent = '화상 회의는 Mac 의 소리를 담아야 해서 화면 기록 권한이 필요합니다(시스템 설정 → 개인정보 보호 및 보안 → 화면 기록).';
        if (!engineEl.querySelector('.vr-screen-note')) {
          extra.classList.add('vr-screen-note');
          engineEl.append(extra);
        }
      }
    }

    async function refreshEngine() {
      if (!mac) return;
      engine = await voiceEngineStatus();
      paintEngine();
    }

    /* ------------------------------ 대화록 ------------------------------ */

    function namesFor(name) {
      const saved = speakerNames[name];
      return saved && typeof saved === 'object' ? saved : {};
    }

    function labelOf(speaker) {
      if (!transcript) return speaker;
      return namesFor(transcript.name)[speaker] || speaker;
    }

    function transcriptText() {
      if (!transcript) return '';
      return transcript.segments
        .map((item) => `[${clockLabel(item.start)}] ${labelOf(item.speaker)}: ${item.text}`)
        .join('\n');
    }

    function paintTranscript() {
      const jobName = transcriptJob.name;
      const showing = transcript && (!jobName || jobName === transcript.name);
      const inProgress = transcriptJob.stage && !['done', 'error', 'engine-missing'].includes(transcriptJob.stage);
      transcriptEl.hidden = !(showing || inProgress || (jobName && transcriptJob.stage === 'engine-missing'));

      if (!transcriptEl.hidden) {
        if (inProgress) {
          transcriptProgress.hidden = false;
          const percent = Math.max(2, Math.min(100, Math.round(transcriptJob.percent || 0)));
          transcriptFill.style.width = `${percent}%`;
          transcriptStatusEl.textContent = `${stageLabel(transcriptJob.stage)} ${percent}%`;
        } else {
          transcriptProgress.hidden = true;
        }
        transcriptStateEl.textContent = transcriptJob.stage === 'error'
          ? (transcriptJob.error || '만들지 못했습니다')
          : transcript?.segments?.length
            ? `${transcript.segments.length}줄 · ${clockLabel(transcript.seconds || 0)}`
            : (transcriptJob.stage === 'engine-missing' ? '엔진을 먼저 내려받아 주세요' : '');
      }

      linesEl.innerHTML = '';
      const segments = transcript?.segments || [];
      transcriptEmpty.hidden = segments.length > 0;
      if (!segments.length) {
        transcriptEmpty.textContent = transcriptJob.stage === 'engine-missing'
          ? '이 녹음은 대화록을 만들지 못했습니다. 위에서 엔진을 내려받은 뒤 다시 만들어 주세요.'
          : '대화록이 아직 없습니다.';
      }
      segments.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'vr-line';
        const who = document.createElement('button');
        who.type = 'button';
        who.className = 'vr-speaker';
        who.textContent = labelOf(item.speaker);
        who.title = '눌러서 화자 이름 바꾸기';
        who.addEventListener('click', () => renameSpeaker(item.speaker, who));
        const time = document.createElement('span');
        time.className = 'vr-time';
        time.textContent = clockLabel(item.start);
        const text = document.createElement('span');
        text.className = 'vr-text';
        text.textContent = item.text;
        li.append(time, who, text);
        linesEl.append(li);
      });
    }

    function stageLabel(stage) {
      return {
        start: '준비 중',
        convert: '소리 준비 중',
        transcribe: '받아 적는 중',
        diarize: '화자를 나누는 중',
        download: '내려받는 중',
        whisper: '음성 인식 엔진 받는 중',
        sherpa: '화자 분리 엔진 받는 중',
      }[stage] || '만드는 중';
    }

    function renameSpeaker(speaker, button) {
      if (!transcript) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'pt-input vr-speaker-input';
      input.value = labelOf(speaker);
      input.maxLength = 24;
      input.setAttribute('aria-label', `${speaker} 이름`);
      const finish = (save) => {
        if (save) {
          const value = input.value.trim();
          const all = readSpeakerNames();
          const current = all[transcript.name] && typeof all[transcript.name] === 'object' ? all[transcript.name] : {};
          if (value && value !== speaker) current[speaker] = value;
          else delete current[speaker];
          all[transcript.name] = current;
          speakerNames = all;
          saveSpeakerNames(all);
        }
        paintTranscript();
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      button.replaceWith(input);
      input.focus();
      input.select();
    }

    async function loadTranscript(name) {
      if (!mac || !name) return;
      const found = await voiceTranscript(name);
      if (found && Array.isArray(found.segments)) {
        transcript = found;
      } else if (transcript && transcript.name !== name) {
        transcript = null;
      }
      paintTranscript();
    }

    async function runTranscribe(name) {
      if (!mac) {
        toast('대화록은 Mac 앱에서 만듭니다');
        return;
      }
      if (!engine.ready) {
        toast('회의록 엔진을 먼저 내려받아 주세요');
        return;
      }
      transcriptJob = { name, stage: 'start', percent: 1, error: '' };
      paintTranscript();
      try {
        const result = await voiceTranscribe(name, speakerCount);
        transcript = result;
        transcriptJob = { name, stage: 'done', percent: 100, error: '' };
        toast('대화록을 만들었습니다');
      } catch (error) {
        transcriptJob = { name, stage: 'error', percent: 0, error: (error && error.message) || String(error) };
        toast(transcriptJob.error);
      }
      paintTranscript();
    }

    /* ------------------------------ 목록 ------------------------------ */

    async function refreshList() {
      files = await voiceList().catch(() => []);
      countEl.textContent = String(files.length);
      emptyEl.hidden = files.length > 0;
      listEl.innerHTML = '';
      for (const file of files) {
        const item = document.createElement('li');
        item.className = 'vr-item';
        item.dataset.name = file.name;
        const text = document.createElement('div');
        text.className = 'vr-item-text';
        const title = document.createElement('b');
        title.textContent = file.name.replace(/\.[^.]+$/, '');
        const meta = document.createElement('span');
        meta.textContent = `${dayLabel(file.created)} · ${formatVoiceSize(file.size)}`;
        text.append(title, meta);

        const actions = document.createElement('div');
        actions.className = 'vr-item-actions';
        actions.append(
          miniButton('재생', 'play'),
          miniButton('저장', 'save'),
        );
        if (mac) actions.append(miniButton('대화록', 'transcript'));
        if (mac) actions.append(miniButton('Finder', 'finder'));
        actions.append(miniButton('삭제', 'delete', 'is-danger'));
        item.append(text, actions);
        listEl.append(item);
      }
    }

    function miniButton(label, act, extra) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `vr-mini${extra ? ` ${extra}` : ''}`;
      button.dataset.act = act;
      button.textContent = label;
      return button;
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
      if (act === 'transcript') {
        await loadTranscript(name);
        if (!transcript || transcript.name !== name) {
          transcriptEl.hidden = false;
          transcriptJob = { name, stage: '', percent: 0, error: '' };
          paintTranscript();
          await runTranscribe(name);
        }
        transcriptEl.scrollIntoView({ block: 'nearest' });
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
          if (transcript && transcript.name === name) {
            transcript = null;
            transcriptEl.hidden = true;
          }
          toast('녹음을 지웠습니다');
          await refreshList();
        } catch (error) {
          console.error('[TIP voice] 지우지 못했습니다', error);
          toast('녹음을 지우지 못했습니다');
        }
      }
    }

    /* ------------------------------ 시작·중지 ------------------------------ */

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
      run(async () => {
        if (live()) {
          const next = await voiceStop();
          await refreshList();
          return next;
        }
        return voiceStart(mode);
      });
    }, { signal });

    pauseBtn.addEventListener('click', () => {
      run(() => (state.status === VOICE_STATUS.paused ? voiceResume() : voicePause()));
    }, { signal });

    listEl.addEventListener('click', onListClick, { signal });

    engineBtn.addEventListener('click', async () => {
      if (engineBusy) return;
      engineBusy = true;
      engineProgress.hidden = false;
      engineFill.style.width = '2%';
      engineStatusEl.textContent = '내려받는 중 0%';
      paintEngine();
      try {
        engine = await voiceEngineDownload();
        toast('회의록 엔진을 받았습니다');
      } catch (error) {
        console.error('[TIP voice] 엔진을 받지 못했습니다', error);
        toast((error && error.message) || '엔진을 받지 못했습니다');
      } finally {
        engineBusy = false;
        engineProgress.hidden = true;
        paintEngine();
      }
    }, { signal });

    root.querySelector('#vr-transcript-again').addEventListener('click', () => {
      const name = transcript ? transcript.name : transcriptJob.name;
      if (name) runTranscribe(name);
    }, { signal });
    root.querySelector('#vr-transcript-copy').addEventListener('click', async () => {
      const text = transcriptText();
      if (!text) return toast('복사할 대화록이 없습니다');
      try {
        await navigator.clipboard.writeText(text);
        toast('대화록을 복사했습니다');
      } catch {
        toast('복사하지 못했습니다');
      }
    }, { signal });
    root.querySelector('#vr-transcript-save').addEventListener('click', () => {
      const text = transcriptText();
      if (!text || !transcript) return toast('저장할 대화록이 없습니다');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${transcript.name.replace(/\.[^.]+$/, '')}.txt`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, { signal });

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

    /* ------------------------------ 알림 ------------------------------ */

    const stopState = subscribeVoice((next) => {
      const wasLive = state.status !== VOICE_STATUS.idle;
      state = next;
      paint();
      if (wasLive && next.status === VOICE_STATUS.idle) {
        refreshList();
        if (mac && next.name) loadTranscript(next.name);
      }
    });

    const stopLevel = subscribeVoiceLevel((value) => {
      const now = performance.now();
      if (now - levelPaint < 60) return;
      levelPaint = now;
      level = value;
      paint();
    });

    const stopTranscript = subscribeVoiceTranscript((payload) => {
      const name = String(payload?.name || '');
      const stage = String(payload?.stage || '');
      if (!stage) return;
      // 진행률 이벤트(whisper·diarize)에는 이름이 없다 — 지금 작업의 것으로 본다.
      if (!name && !transcriptJob.name) return;
      if (name && transcriptJob.name && name !== transcriptJob.name
        && stage !== 'done' && stage !== 'error' && stage !== 'engine-missing') return;
      const jobName = name || transcriptJob.name;
      transcriptJob = {
        name: jobName,
        stage,
        percent: Number(payload?.percent) || 0,
        error: payload?.error ? String(payload.error) : '',
      };
      if (stage === 'done' && payload?.transcript && Array.isArray(payload.transcript.segments)) {
        transcript = payload.transcript;
        refreshList();
      }
      if (stage === 'engine-missing') {
        transcriptEl.hidden = false;
        refreshEngine();
      }
      paintTranscript();
    });

    const stopEngineProgress = subscribeVoiceEngineProgress((payload) => {
      if (!engineBusy) return;
      engineProgress.hidden = false;
      const percent = Math.max(2, Math.min(100, Math.round(Number(payload?.percent) || 0)));
      engineFill.style.width = `${percent}%`;
      engineStatusEl.textContent = `${stageLabel(String(payload?.stage || 'download'))} ${percent}%`;
    });

    // 경과 시간은 0.5초마다 새로 읽는다(Mac 은 Rust 가, 웹은 이 화면이 센다).
    tickTimer = setInterval(async () => {
      if (state.status === VOICE_STATUS.idle || state.status === VOICE_STATUS.saving) return;
      const next = await voiceState();
      state = next;
      paint();
    }, 500);

    paintModes();
    refreshPermission();
    refreshEngine();
    refreshList();
    voiceState().then((next) => {
      state = next;
      if (next.mode && next.mode !== 'normal') mode = next.mode;
      paintModes();
      paint();
    });
    loadTranscript(state.name);

    return () => {
      controller.abort();
      if (confirmTimer) clearTimeout(confirmTimer);
      if (tickTimer) clearInterval(tickTimer);
      stopState();
      stopLevel();
      stopTranscript();
      stopEngineProgress();
      stopPlayback();
    };
  },
};

export default module;
