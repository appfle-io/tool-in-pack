/**
 * TIP · 영상 편집 (video-editor) — v1.24.0
 *
 * 캡컷 스타일 3단 작업실: 왼쪽 도구 탭(미디어·전환·자막·오디오·필터), 가운데 미리보기,
 * 오른쪽 속성, 아래 멀티 트랙 타임라인(영상·오버레이·자막·오디오).
 *
 * 두 가지 길로 내보낸다.
 *  · Mac 앱 — 온디맨드 ffmpeg(engine.rs)로 클립·전환(xfade)·오버레이·줌/팬(zoompan)·자막
 *    (drawtext)·BGM 을 한 번에 합쳐 HD·FHD·2K·4K MP4 로 저장한다. 진행률은
 *    tip://video-export-progress 로 받는다.
 *  · 웹(PWA) — <canvas> + MediaRecorder 로 실시간 인코딩(최대 FHD). 2K·4K 와 자동 자막은 Mac 전용.
 *
 * v1.24.0 — 작업하던 타임라인을 IndexedDB 에 자동 저장하고 이어서 편집한다. 프로젝트 파일
 *           (.tipproj)로 내보내고 불러온다. 자막은 복사·붙여넣기·복제와 '모든 자막에 적용',
 *           클립은 복제와 '모든 클립에 적용'을 갖는다. 끌 때 자석처럼 붙는 스냅과 ←/→ 1프레임
 *           이동도 넣었다. Mac 은 whisper.cpp 로 음성을 받아 자막을 만들고, 오버레이(PIP)와
 *           클립 줌/팬, 자막 프리셋·등장 애니메이션은 미리보기와 ffmpeg 결과가 같게 맞췄다.
 *
 * 화면에서 쓰는 말은 짧게, 버튼은 44px 이상, 글자는 12px 이상(다른 모듈과 같은 기준).
 */

import { el, icons, formatBytes } from '../../js/ui.js';
import {
  ASPECTS, RESOLUTIONS, FPS_OPTIONS, TRANSITIONS, FILTER_PRESETS, FONTS,
  SUBTITLE_PRESETS, SUBTITLE_ANIMATIONS, MOTIONS,
  SPEED_MIN, SPEED_MAX, CUT, FRAME_STEP, SNAP_PIXELS,
  createProject, createSubtitle, createOverlay, createMotion, newId,
  clipDuration, layout, totalDuration, frameAt, indexAt, outputSize, timecode, friendlyDuration,
  transitionById, fontById, subtitlePresetById, matchSubtitlePreset, applySubtitlePreset,
  subtitleStyle, applySubtitleStyle, animationAt, clipFormat, applyClipFormat, applyMotionPreset,
  motionById, motionAt, cloneSubtitle, cloneClip, cloneAudio, cloneOverlay,
  snapTargets, snapTime, snapRange, freeSpan,
} from './model.js';

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.6"/><path d="M7 10.2v3.6M10.5 10.2v3.6"/><path d="M14 9.4l4 2.6-4 2.6z"/></svg>';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const CORE = TAURI ? window.__TAURI__.core : null;
/// Mac 앱에서 고른 로컬 파일을 화면에서 재생하려면 asset 주소로 바꾼다(읽기 전용, 범위 요청 지원).
const fileSrc = TAURI && CORE && typeof CORE.convertFileSrc === 'function'
  ? (path) => CORE.convertFileSrc(path)
  : () => null;
const EVENT = TAURI && window.__TAURI__.event ? window.__TAURI__.event : null;
const IS_MAC = TAURI;

const TAB_LABELS = [
  { id: 'media', label: '미디어' },
  { id: 'transition', label: '전환' },
  { id: 'subtitle', label: '자막' },
  { id: 'audio', label: '오디오' },
  { id: 'filter', label: '필터' },
];

const MEDIA_ACCEPT = 'video/*,image/*';
const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.aiff,.flac';

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6L19 12z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
const ICON_SCISSORS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><path d="M8.4 15.6 18 6M15.6 8.4 6 18"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.6h5V7M6.5 7l.9 12.2A1.9 1.9 0 0 0 9.3 21h5.4a1.9 1.9 0 0 0 1.9-1.8L17.5 7"/></svg>';
const ICON_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7H5V3"/><path d="M5.5 6.5a8 8 0 1 1-1.2 8"/></svg>';
const ICON_REDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h4V3"/><path d="M18.5 6.5a8 8 0 1 0 1.2 8"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 18.5v1a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-1"/></svg>';
const ICON_SNAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v9a4 4 0 0 0 8 0V4"/><path d="M6 8h4M14 8h4"/><path d="M3 20h18"/></svg>';

const module = {
  id: 'video-editor',
  name: '영상 편집',
  kind: 'tool',
  category: 'media',
  version: '1.0.0',
  accepts: ['video/*', 'image/*'],
  subtitle: '자르고 이어 붙이고 자막까지',
  description: '여러 영상을 이어 붙이고 자르고, 전환과 자막, 배경 음악을 넣어 HD부터 4K까지 MP4로 저장합니다. Mac 앱은 편집 엔진(ffmpeg)을 한 번 내려받아 씁니다.',
  icon: ICON,
  defaultEnabled: true,
  defaultPinned: false,

  mount(root, ctx = {}) {
    const controller = new AbortController();
    const { signal } = controller;

    const project = createProject();
    const media = new Map();          // mediaId → { id, name, kind, url, path, width, height, duration, hasAudio, file }
    const elements = new Map();       // mediaId → { node, ready }
    const state = {
      tab: 'media',
      selected: null,                 // { kind:'clip'|'subtitle'|'audio'|'overlay', id }
      playhead: 0,
      playing: false,
      zoom: 56,                       // px / 초
      exportOpen: false,
      exporting: false,
      engine: null,
      engineBusy: false,
      webFonts: new Map(),            // 업로드한 폰트 이름 → FontFace
      clipboard: null,                // { kind, data } — ⌘C 로 담은 것
      snap: true,                     // 자석 스냅
      defaultPreset: 'basic',         // 새 자막에 쓸 프리셋
      whisper: null,                  // { available, model, modelSize, binary, downloadSize }
      whisperBusy: false,
      lastSavedAt: 0,
      resumeAsked: false,
    };
    const undoStack = [];
    const redoStack = [];
    let activeCtx = null;             // 미리보기 캔버스(아래에서 연결)
    let subBoxes = [];                // 자막 드래그 판정용
    let overlayBoxes = [];            // 오버레이 드래그 판정용
    let rafId = 0;
    let lastTick = 0;
    let audioCtx = null;
    let recordDest = null;
    let elementSources = new Map();

    /* ------------------------------ 공통 ------------------------------ */

    const invoke = (command, args) => {
      if (!CORE) return Promise.reject(new Error('Mac 앱에서만 됩니다'));
      return CORE.invoke(command, args);
    };

    const say = (message, ms) => {
      if (typeof ctx.toast === 'function') ctx.toast(message, ms);
    };

    const mediaOf = (id) => media.get(id) || null;
    const clipOf = (id) => project.clips.find((clip) => clip.id === id) || null;
    const subtitleOf = (id) => project.subtitles.find((item) => item.id === id) || null;
    const audioOf = (id) => project.audios.find((item) => item.id === id) || null;
    const overlayOf = (id) => project.overlays.find((item) => item.id === id) || null;

    function snapshot() {
      return JSON.stringify({
        aspect: project.aspect,
        clips: project.clips,
        subtitles: project.subtitles,
        audios: project.audios,
        overlays: project.overlays,
      });
    }

    function restore(text) {
      const parsed = JSON.parse(text);
      project.aspect = parsed.aspect;
      project.clips = parsed.clips;
      project.subtitles = parsed.subtitles;
      project.audios = parsed.audios;
      project.overlays = parsed.overlays || [];
      if (state.selected) {
        const still = {
          clip: clipOf,
          subtitle: subtitleOf,
          audio: audioOf,
          overlay: overlayOf,
        }[state.selected.kind];
        if (!still || !still(state.selected.id)) state.selected = null;
      }
      state.playhead = Math.min(state.playhead, totalDuration(project.clips));
      refreshAll();
    }

    function commit() {
      undoStack.push(snapshot());
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
    }

    function undo() {
      if (!undoStack.length) { say('되돌릴 것이 없습니다'); return; }
      redoStack.push(snapshot());
      restore(undoStack.pop());
      say('되돌렸습니다');
    }

    function redo() {
      if (!redoStack.length) { say('다시 할 것이 없습니다'); return; }
      undoStack.push(snapshot());
      restore(redoStack.pop());
      say('다시 했습니다');
    }

    /* ------------------------------ 프로젝트 저장 (IndexedDB) ------------------------------ */

    // 작업 중인 타임라인은 브라우저 저장소(IndexedDB)에 0.7초 쉬었다가 조용히 저장한다.
    // 미디어 파일 자체는 저장하지 않는다(웹은 파일 핸들을 오래 둘 수 없고, Mac 은 원본 경로만 기억).
    const DB_NAME = 'tip-video-editor';
    const DB_STORE = 'projects';
    const DB_KEY = 'current';
    const PROJECT_FORMAT = 'tip-video-project';
    const PROJECT_VERSION = 1;

    function openDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('저장소를 쓸 수 없습니다')); return; }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('저장소를 열지 못했습니다'));
      });
    }

    function idbPut(value) {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, DB_KEY);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      }));
    }

    function idbGet() {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const request = tx.objectStore(DB_STORE).get(DB_KEY);
        request.onsuccess = () => { db.close(); resolve(request.result || null); };
        request.onerror = () => { db.close(); reject(request.error); };
      }));
    }

    function idbDelete() {
      return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(DB_KEY);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      }));
    }

    function mediaManifest() {
      return [...media.values()].map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        path: item.path || null,
        width: item.width || 0,
        height: item.height || 0,
        duration: item.duration || 0,
        hasAudio: !!item.hasAudio,
        size: item.size || 0,
        missing: !!item.missing,
      }));
    }

    function projectPayload() {
      return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        savedAt: Date.now(),
        project: {
          aspect: project.aspect,
          clips: project.clips,
          subtitles: project.subtitles,
          audios: project.audios,
          overlays: project.overlays,
        },
        media: mediaManifest(),
      };
    }

    function projectItemCount(data) {
      const source = data || {};
      return ['clips', 'subtitles', 'audios', 'overlays']
        .reduce((sum, key) => sum + (Array.isArray(source[key]) ? source[key].length : 0), 0);
    }

    /** 미디어 목록을 지운다 — 미리보기 요소와 blob 주소도 함께 정리. */
    function clearMedia() {
      for (const entry of elements.values()) {
        if (entry && entry.node) {
          if (entry.node.pause) entry.node.pause();
          if (entry.node instanceof HTMLVideoElement && entry.node.parentNode) entry.node.remove();
        }
      }
      elements.clear();
      for (const item of media.values()) {
        if (item.url && String(item.url).startsWith('blob:')) URL.revokeObjectURL(item.url);
      }
      media.clear();
    }

    /** 매니페스트로 미디어를 되살린다 — Mac 은 경로로, 웹은 '다시 연결' 자리로. */
    function restoreMedia(list) {
      (list || []).forEach((item) => {
        if (!item || !item.id) return;
        const path = item.path || null;
        const usable = !!path && IS_MAC;
        media.set(item.id, {
          id: item.id,
          name: item.name || '파일',
          kind: item.kind || 'video',
          url: usable ? fileSrc(path) : null,
          path,
          width: item.width || 0,
          height: item.height || 0,
          duration: item.duration || 0,
          hasAudio: !!item.hasAudio,
          size: item.size || 0,
          file: null,
          missing: !usable,
        });
      });
    }

    /** 클립·오버레이·오디오가 가리키는 미디어가 없으면 이름만 있는 빈 항목을 만든다. */
    function ensureMediaStubs() {
      const add = (mediaId, name, kind) => {
        if (!mediaId || media.has(mediaId)) return;
        media.set(mediaId, {
          id: mediaId,
          name: name || '파일',
          kind: kind || 'video',
          url: null,
          path: null,
          width: 0,
          height: 0,
          duration: 0,
          hasAudio: false,
          file: null,
          missing: true,
        });
      };
      project.clips.forEach((clip) => add(clip.mediaId, clip.name, clip.kind === 'image' ? 'image' : 'video'));
      project.overlays.forEach((item) => add(item.mediaId, item.name, item.kind || 'video'));
      project.audios.forEach((item) => add(item.mediaId, item.name, 'audio'));
    }

    /** 저장된 프로젝트(자동 저장본·.tipproj)를 화면에 올린다. */
    function applyProject(payload) {
      const data = (payload && payload.project) || payload || {};
      project.aspect = data.aspect || '16:9';
      project.clips = Array.isArray(data.clips) ? data.clips : [];
      project.subtitles = Array.isArray(data.subtitles) ? data.subtitles : [];
      project.audios = Array.isArray(data.audios) ? data.audios : [];
      project.overlays = Array.isArray(data.overlays) ? data.overlays : [];
      clearMedia();
      restoreMedia(payload && payload.media);
      ensureMediaStubs();
      state.selected = null;
      state.playhead = Math.min(state.playhead, totalDuration(project.clips));
      undoStack.length = 0;
      redoStack.length = 0;
      refreshAll();
    }

    let saveTimer = 0;
    let savedHint = null;

    function renderSavedHint() {
      if (!savedHint) return;
      if (!state.lastSavedAt) { savedHint.textContent = ''; return; }
      const at = new Date(state.lastSavedAt);
      savedHint.textContent = `자동 저장 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    }

    async function saveNow() {
      try {
        if (!projectItemCount(project)) {
          await idbDelete();
          return;
        }
        const payload = projectPayload();
        await idbPut(payload);
        state.lastSavedAt = payload.savedAt;
        renderSavedHint();
      } catch (error) {
        console.warn('[TIP video] 자동 저장', error);
      }
    }

    /** 타임라인이 바뀔 때마다 부른다 — 0.7초 쉬었다가 한 번만 저장한다. */
    function scheduleSave() {
      if (state.exporting) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveNow(); }, 700);
    }

    /** 미디어가 없다는 안내 — 웹 저장본을 다시 열었거나 파일을 못 찾았을 때. */
    function missingNotice() {
      const missing = [...media.values()].filter((item) => item.missing);
      if (!missing.length) return null;
      const row = el('div', { class: 've-notice is-warn' });
      row.append(el('div', {
        class: 've-notice-text',
        text: IS_MAC
          ? `원본 파일 ${missing.length}개를 찾지 못했습니다. 미디어 탭에서 '다시 연결'로 골라 주세요.`
          : `브라우저는 파일을 기억하지 못합니다. 미디어 탭에서 ${missing.length}개를 '다시 연결'해 주세요.`,
      }));
      return row;
    }

    /** 자동 저장본이 있으면 이어서 편집할지 묻는다. */
    async function offerResume() {
      let saved = null;
      try { saved = await idbGet(); } catch { saved = null; }
      if (state.resumeAsked) return;
      state.resumeAsked = true;
      if (!saved || !saved.project || !projectItemCount(saved.project)) return;
      const when = saved.savedAt ? new Date(saved.savedAt) : null;
      const stamp = when
        ? `${when.getMonth() + 1}월 ${when.getDate()}일 ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
        : '이전';
      const data = saved.project;
      const overlay = el('div', { class: 've-modal-overlay' });
      const dialog = el('div', { class: 've-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '이어서 편집' });
      const close = () => overlay.remove();
      const resume = el('button', { class: 've-btn ve-btn-primary', type: 'button', text: '이어서 편집' });
      resume.addEventListener('click', () => {
        try {
          applyProject(saved);
          say('이어서 편집합니다');
        } catch (error) {
          console.warn('[TIP video] 이어서 편집', error);
          say('저장본을 열지 못했습니다');
        }
        close();
      });
      const fresh = el('button', { class: 've-btn', type: 'button', text: '새로 시작' });
      fresh.addEventListener('click', () => {
        idbDelete().catch(() => {});
        close();
        say('새 프로젝트를 시작합니다');
      });
      dialog.append(
        el('div', { class: 've-modal-head' }, [el('h2', { text: '이어서 편집할까요?' })]),
        el('div', { class: 've-modal-body' }, [
          el('p', { class: 've-hint', text: `${stamp}에 자동 저장한 작업이 있습니다.` }),
          el('div', { class: 've-stat' }, [
            el('div', { class: 've-stat-row' }, [el('span', { text: '클립' }), el('b', { text: `${(data.clips || []).length}개` })]),
            el('div', { class: 've-stat-row' }, [el('span', { text: '자막' }), el('b', { text: `${(data.subtitles || []).length}개` })]),
            el('div', { class: 've-stat-row' }, [el('span', { text: '오버레이' }), el('b', { text: `${(data.overlays || []).length}개` })]),
            el('div', { class: 've-stat-row' }, [el('span', { text: '오디오' }), el('b', { text: `${(data.audios || []).length}개` })]),
          ]),
          el('p', { class: 've-hint', text: '새로 시작하면 저장본은 지워집니다.' }),
        ]),
        el('div', { class: 've-modal-actions' }, [fresh, resume]),
      );
      overlay.append(dialog);
      document.body.append(overlay);
      resume.focus();
    }

    /* ------------------------------ 프로젝트 파일(.tipproj) ------------------------------ */

    function projectFileName() {
      const stamp = new Date();
      return `TIP-프로젝트-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}.tipproj`;
    }

    async function saveProjectFile() {
      const text = JSON.stringify(projectPayload());
      if (IS_MAC) {
        try {
          const saved = await invoke('save_backup_file', { name: projectFileName(), content: text });
          if (saved && saved.path) say('프로젝트 파일을 저장했습니다');
        } catch (error) {
          console.warn('[TIP video] 프로젝트 저장', error);
          say(typeof error === 'string' ? error : '프로젝트를 저장하지 못했습니다');
        }
        return;
      }
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = projectFileName();
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      say('프로젝트 파일을 저장했습니다');
    }

    function pickTextFile() {
      return new Promise((resolve) => {
        const input = el('input', { type: 'file', accept: '.tipproj,application/json', style: 'display:none' });
        input.addEventListener('change', async () => {
          const file = (input.files || [])[0];
          input.remove();
          if (!file) { resolve(null); return; }
          try { resolve(await file.text()); } catch { resolve(null); }
        });
        document.body.append(input);
        input.click();
      });
    }

    /** .tipproj 를 읽어 타임라인을 되살린다. Mac 은 원본 경로를 다시 허용 목록에 넣는다. */
    async function openProjectFile() {
      let text = null;
      try {
        if (IS_MAC) {
          const opened = await invoke('open_backup_file');
          if (!opened) return;
          text = opened.content;
        } else {
          text = await pickTextFile();
        }
      } catch (error) {
        console.warn('[TIP video] 프로젝트 열기', error);
        say(typeof error === 'string' ? error : '프로젝트를 열지 못했습니다');
        return;
      }
      if (!text) return;
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        say('프로젝트 파일을 읽지 못했습니다');
        return;
      }
      if (!payload || (payload.format && payload.format !== PROJECT_FORMAT)) {
        say('TIP 프로젝트 파일이 아닙니다');
        return;
      }
      commit();
      applyProject(payload);
      if (IS_MAC) {
        const paths = [...media.values()].map((item) => item.path).filter(Boolean);
        if (paths.length) {
          try {
            await invoke('video_project_media', { paths });
            const missing = [...media.values()].filter((item) => item.missing);
            if (missing.length) say(`원본 ${missing.length}개를 찾지 못했습니다`);
          } catch (error) {
            console.warn('[TIP video] 프로젝트 미디어', error);
          }
        }
      }
      say('프로젝트를 열었습니다');
      scheduleSave();
    }

    /* ------------------------------ 뼈대 ------------------------------ */

    const shell = el('div', { class: 've' });
    const noticeHost = el('div', { class: 've-notice-host' });
    const leftTabBar = el('div', { class: 've-tabs', role: 'tablist', 'aria-label': '편집 도구' });
    const leftBody = el('div', { class: 've-tab-body' });
    const leftPanel = el('aside', { class: 've-left' }, [leftTabBar, leftBody]);

    const canvas = el('canvas', { class: 've-canvas', 'aria-label': '미리보기' });
    activeCtx = canvas.getContext('2d');
    const stage = el('div', { class: 've-stage' }, [canvas]);
    const timeNow = el('span', { class: 've-time', text: '00:00.0' });
    const timeTotal = el('span', { class: 've-time-total', text: '00:00.0' });
    const playBtn = el('button', { class: 've-play', type: 'button', 'aria-label': '재생', html: ICON_PLAY });
    const aspectBar = el('div', { class: 've-aspects', role: 'group', 'aria-label': '화면 비율' });
    const centerPanel = el('section', { class: 've-center' }, [
      stage,
      el('div', { class: 've-transport' }, [
        playBtn,
        el('div', { class: 've-clock' }, [timeNow, el('span', { class: 've-clock-sep', text: '/' }), timeTotal]),
        aspectBar,
        el('button', {
          class: 've-export-btn', type: 'button', html: `${ICON_DOWNLOAD}<span>내보내기</span>`, 'aria-label': '내보내기',
        }),
      ]),
    ]);

    const propsBody = el('div', { class: 've-props-body' });
    const rightPanel = el('aside', { class: 've-right' }, [
      el('div', { class: 've-props-head' }, [el('h2', { text: '속성' })]),
      propsBody,
    ]);

    const timelineToolbar = el('div', { class: 've-tl-toolbar' });
    const ruler = el('div', { class: 've-ruler' });
    const trackArea = el('div', { class: 've-tracks' });
    const playheadEl = el('div', { class: 've-playhead' });
    const snapGuide = el('div', { class: 've-snap-guide', 'aria-hidden': 'true' });
    const timelineInner = el('div', { class: 've-tl-inner' }, [ruler, trackArea, playheadEl, snapGuide]);
    const timelineScroll = el('div', { class: 've-tl-scroll' }, [timelineInner]);
    const timeline = el('section', { class: 've-timeline' }, [timelineToolbar, timelineScroll]);

    shell.append(noticeHost, el('div', { class: 've-top' }, [leftPanel, centerPanel, rightPanel]), timeline);
    root.append(shell);

    /* ------------------------------ 미디어 ------------------------------ */

    function mediaKindOf(file) {
      if (file.type.startsWith('image/')) return 'image';
      if (file.type.startsWith('audio/')) return 'audio';
      return 'video';
    }

    function addMediaFromFile(file) {
      const kind = mediaKindOf(file);
      const url = URL.createObjectURL(file);
      const item = {
        id: newId('media'),
        name: file.name || (kind === 'image' ? '이미지' : '영상'),
        kind,
        url,
        path: null,
        width: 0,
        height: 0,
        duration: 0,
        hasAudio: kind === 'video',
        file,
        missing: false,
      };
      media.set(item.id, item);
      probeLocal(item);
      return item;
    }

    /** 웹에서 저장본을 열었을 때 — 같은 파일을 다시 골라 미디어 항목에 이어 붙인다. */
    function relinkMedia(item) {
      if (!item) return;
      const input = el('input', {
        type: 'file',
        accept: item.kind === 'audio' ? AUDIO_ACCEPT : MEDIA_ACCEPT,
        style: 'display:none',
      });
      input.addEventListener('change', () => {
        const file = (input.files || [])[0];
        input.remove();
        if (!file) return;
        commit();
        if (item.url && String(item.url).startsWith('blob:')) URL.revokeObjectURL(item.url);
        item.url = URL.createObjectURL(file);
        item.file = file;
        item.name = file.name || item.name;
        item.kind = mediaKindOf(file) === 'audio' ? 'audio' : (mediaKindOf(file) === 'image' ? 'image' : 'video');
        item.missing = false;
        const entry = elements.get(item.id);
        if (entry && entry.node) {
          if (entry.node.pause) entry.node.pause();
          if (entry.node instanceof HTMLVideoElement && entry.node.parentNode) entry.node.remove();
        }
        elements.delete(item.id);
        probeLocal(item);
        refreshAll();
        say(`${item.name}을(를) 다시 연결했습니다`);
      });
      document.body.append(input);
      input.click();
    }

    function probeLocal(item) {
      if (item.kind === 'audio') {
        const node = new Audio();
        node.src = item.url;
        node.preload = 'metadata';
        node.addEventListener('loadedmetadata', () => {
          item.duration = Number.isFinite(node.duration) ? node.duration : 0;
          item.hasAudio = true;
          renderLeft();
          renderTimeline();
        });
        return;
      }
      if (item.kind === 'image') {
        const img = new Image();
        img.onload = () => {
          item.width = img.naturalWidth;
          item.height = img.naturalHeight;
          item.duration = 4;
          renderLeft();
        };
        img.src = item.url;
        return;
      }
      const node = document.createElement('video');
      node.src = item.url;
      node.preload = 'metadata';
      node.muted = false;
      node.playsInline = true;
      node.addEventListener('loadedmetadata', () => {
        item.duration = Number.isFinite(node.duration) ? node.duration : 0;
        item.width = node.videoWidth;
        item.height = node.videoHeight;
        renderLeft();
      });
      node.addEventListener('error', () => {
        item.duration = 0;
        renderLeft();
      });
    }

    async function addMediaNative(kind) {
      try {
        const picked = await invoke('video_pick_media', { kind });
        if (!Array.isArray(picked) || !picked.length) return [];
        const added = [];
        for (const file of picked) {
          if (kind === 'audio' ? file.kind !== 'audio' : file.kind === 'audio') continue;
          const item = {
            id: newId('media'),
            name: file.name,
            kind: file.kind === 'font' ? 'video' : file.kind,
            url: fileSrc(file.path),
            path: file.path,
            width: 0,
            height: 0,
            duration: 0,
            hasAudio: file.kind === 'video',
            file: null,
            size: file.size,
            missing: false,
          };
          media.set(item.id, item);
          added.push(item);
          try {
            const info = await invoke('video_probe', { path: file.path });
            if (info) {
              item.duration = Number(info.duration) || 0;
              item.width = Number(info.width) || 0;
              item.height = Number(info.height) || 0;
              item.hasAudio = !!info.hasAudio;
              if (item.kind === 'image') item.duration = 4;
            }
          } catch { /* 길이를 못 읽어도 4초로 넣을 수 있다 */ }
        }
        renderLeft();
        return added;
      } catch (error) {
        console.warn('[TIP video] 파일 고르기', error);
        say('파일을 고르지 못했습니다');
        return [];
      }
    }

    /** 파일(브라우저) 또는 경로(Mac)에서 미디어 풀에 넣는다. */
    async function pickMedia(kind) {
      if (IS_MAC) return addMediaNative(kind);
      return new Promise((resolve) => {
        const input = el('input', {
          type: 'file',
          accept: kind === 'audio' ? AUDIO_ACCEPT : MEDIA_ACCEPT,
          multiple: true,
          style: 'display:none',
        });
        input.addEventListener('change', () => {
          const files = Array.from(input.files || []);
          const added = files.map(addMediaFromFile).filter((item) => (kind === 'audio' ? item.kind === 'audio' : item.kind !== 'audio'));
          input.remove();
          renderLeft();
          resolve(added);
        });
        document.body.append(input);
        input.click();
      });
    }

    function pushClip(item) {
      if (!item) return null;
      const isImage = item.kind === 'image';
      const span = isImage
        ? Math.min(10, Math.max(2, Number(item.duration) || 4))
        : Math.max(0.2, Number(item.duration) || 4);
      const clip = {
        id: newId('clip'),
        mediaId: item.id,
        name: item.name,
        kind: isImage ? 'image' : 'video',
        trimStart: 0,
        trimEnd: span,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        filter: { brightness: 1, contrast: 1, saturation: 1 },
        transition: { kind: 'fade', duration: project.clips.length ? 0.5 : 0 },
        motion: createMotion(),
        sourceDuration: isImage ? 0 : (Number(item.duration) || span),
        hasAudio: !!item.hasAudio && !isImage,
      };
      project.clips.push(clip);
      state.selected = { kind: 'clip', id: clip.id };
      refreshAll();
      return clip;
    }

    function addMediaToTimeline(item) {
      if (!item) return;
      if (item.kind === 'audio') {
        addAudioItem(item);
        return;
      }
      commit();
      pushClip(item);
      say(`${item.name}을(를) 타임라인에 넣었습니다`);
    }

    /* ------------------------------ 오버레이(PIP) ------------------------------ */

    /** 오버레이 기본 길이 — 영상은 원본 길이(최대 15초), 이미지는 4초. */
    function overlaySpan(item) {
      if (!item) return 4;
      const seconds = Number(item.duration) || 4;
      return Math.max(1, Math.min(seconds, item.kind === 'image' ? 6 : 15));
    }

    /** 오버레이를 타임라인에 얹는다 — start 를 주면 그 자리에, 아니면 플레이헤드 뒤 빈 자리에. */
    function addOverlay(item, start) {
      if (!item) return null;
      const span = overlaySpan(item);
      const at = start === undefined
        ? freeSpan(project.overlays, Math.max(0, state.playhead), span, 0)
        : Math.max(0, start);
      const overlay = createOverlay(item.id, item.name, item.kind, at, at + span);
      project.overlays.push(overlay);
      state.selected = { kind: 'overlay', id: overlay.id };
      return overlay;
    }

    function addOverlayFromMedia(item) {
      if (!item) return;
      if (item.kind === 'audio') { say('오디오는 오버레이로 얹을 수 없습니다'); return; }
      commit();
      addOverlay(item);
      refreshAll();
      say(`${item.name}을(를) 오버레이로 얹었습니다`);
    }

    /* ------------------------------ 복사·붙여넣기·복제 ------------------------------ */

    const KIND_LABEL = { clip: '클립', subtitle: '자막', audio: '오디오', overlay: '오버레이' };
    const itemOf = (kind, id) => ({
      clip: clipOf,
      subtitle: subtitleOf,
      audio: audioOf,
      overlay: overlayOf,
    }[kind] || (() => null))(id);

    function copySelected() {
      const selected = state.selected;
      if (!selected) { say('복사할 것을 고르세요'); return false; }
      const item = itemOf(selected.kind, selected.id);
      if (!item) { say('복사할 것을 고르세요'); return false; }
      state.clipboard = { kind: selected.kind, data: JSON.parse(JSON.stringify(item)) };
      say(`${KIND_LABEL[selected.kind]}을(를) 복사했습니다`);
      return true;
    }

    /** 붙여넣을 자리 — 자막·오버레이·오디오는 플레이헤드에서, 이미 겹치면 그 뒤로. */
    function pasteAt(kind, span) {
      const items = kind === 'subtitle' ? project.subtitles
        : kind === 'overlay' ? project.overlays
          : kind === 'audio' ? project.audios.map((item) => ({ start: item.start, end: item.start + Number(item.duration || 0), id: item.id }))
            : [];
      return freeSpan(items, Math.max(0, state.playhead), Math.max(0.2, span), 0);
    }

    function pasteClipboard() {
      const board = state.clipboard;
      if (!board || !board.data) { say('복사한 것이 없습니다'); return; }
      const data = board.data;
      if (board.kind === 'clip') {
        const source = mediaOf(data.mediaId);
        if (!source) { say('복사한 클립의 원본이 없습니다'); return; }
        commit();
        const clip = cloneClip(data);
        const at = state.selected && state.selected.kind === 'clip'
          ? project.clips.findIndex((item) => item.id === state.selected.id) + 1
          : project.clips.length;
        project.clips.splice(Math.max(0, at), 0, clip);
        state.selected = { kind: 'clip', id: clip.id };
        refreshAll();
        say('클립을 붙여넣었습니다');
        return;
      }
      if (board.kind === 'subtitle') {
        commit();
        const span = Math.max(0.2, Number(data.end) - Number(data.start));
        const subtitle = cloneSubtitle(data, pasteAt('subtitle', span));
        project.subtitles.push(subtitle);
        state.selected = { kind: 'subtitle', id: subtitle.id };
        seek(subtitle.start);
        refreshAll();
        say('자막을 붙여넣었습니다');
        return;
      }
      if (board.kind === 'audio') {
        commit();
        const audio = cloneAudio(data, pasteAt('audio', Number(data.duration) || 1));
        project.audios.push(audio);
        state.selected = { kind: 'audio', id: audio.id };
        refreshAll();
        say('오디오를 붙여넣었습니다');
        return;
      }
      if (board.kind === 'overlay') {
        commit();
        const span = Math.max(0.2, Number(data.end) - Number(data.start));
        const overlay = cloneOverlay(data, pasteAt('overlay', span));
        project.overlays.push(overlay);
        state.selected = { kind: 'overlay', id: overlay.id };
        refreshAll();
        say('오버레이를 붙여넣었습니다');
      }
    }

    /** 속성 패널의 '복제' 버튼 — 고른 항목 바로 뒤에 같은 모양으로 하나 더. */
    function duplicateSelected() {
      const selected = state.selected;
      if (!selected) { say('복제할 것을 고르세요'); return; }
      const item = itemOf(selected.kind, selected.id);
      if (!item) { say('복제할 것을 고르세요'); return; }
      commit();
      if (selected.kind === 'clip') {
        const index = project.clips.findIndex((clip) => clip.id === item.id);
        const copy = cloneClip(item);
        project.clips.splice(index < 0 ? project.clips.length : index + 1, 0, copy);
        state.selected = { kind: 'clip', id: copy.id };
      } else if (selected.kind === 'subtitle') {
        const span = Math.max(0.2, Number(item.end) - Number(item.start));
        const copy = cloneSubtitle(item, freeSpan(project.subtitles.filter((sub) => sub.id !== item.id), item.end, span, 0));
        project.subtitles.push(copy);
        state.selected = { kind: 'subtitle', id: copy.id };
      } else if (selected.kind === 'audio') {
        const span = Math.max(0.2, Number(item.duration) || 1);
        const start = freeSpan(project.audios.map((audio) => ({ start: audio.start, end: audio.start + Number(audio.duration || 0) })), item.start + span, span, 0);
        const copy = cloneAudio(item, start);
        project.audios.push(copy);
        state.selected = { kind: 'audio', id: copy.id };
      } else if (selected.kind === 'overlay') {
        const span = Math.max(0.2, Number(item.end) - Number(item.start));
        const copy = cloneOverlay(item, freeSpan(project.overlays.filter((ov) => ov.id !== item.id), item.end, span, 0));
        project.overlays.push(copy);
        state.selected = { kind: 'overlay', id: copy.id };
      }
      refreshAll();
      say(`${KIND_LABEL[selected.kind]}을(를) 복제했습니다`);
    }

    /* ------------------------------ 일괄 적용 ------------------------------ */

    /** 고른 자막의 스타일(프리셋·글꼴·크기·색·외곽선·배경·애니메이션·y)을 모든 자막에. */
    function applySubtitleToAll() {
      const selected = state.selected && state.selected.kind === 'subtitle' ? subtitleOf(state.selected.id) : null;
      if (!selected) { say('기준이 될 자막을 고르세요'); return; }
      if (project.subtitles.length < 2) { say('적용할 다른 자막이 없습니다'); return; }
      commit();
      const style = subtitleStyle(selected);
      project.subtitles.forEach((subtitle) => {
        if (subtitle.id !== selected.id) applySubtitleStyle(subtitle, style);
      });
      refreshAll();
      say(`자막 ${project.subtitles.length}개에 같은 스타일을 입혔습니다`);
    }

    /** 고른 클립의 포맷(필터·배속·볼륨·페이드·줌/팬)을 모든 클립에 — 소스·트림은 그대로. */
    function applyClipToAll() {
      const selected = state.selected && state.selected.kind === 'clip' ? clipOf(state.selected.id) : null;
      if (!selected) { say('기준이 될 클립을 고르세요'); return; }
      if (project.clips.length < 2) { say('적용할 다른 클립이 없습니다'); return; }
      commit();
      const format = clipFormat(selected);
      project.clips.forEach((clip) => {
        if (clip.id !== selected.id) applyClipFormat(clip, format);
      });
      refreshAll();
      say(`클립 ${project.clips.length}개에 같은 포맷을 입혔습니다`);
    }

    /* ------------------------------ 오디오 ------------------------------ */

    function addAudioItem(item) {
      if (!item) return;
      commit();
      const audio = {
        id: newId('audio'),
        mediaId: item.id,
        name: item.name,
        start: 0,
        duration: Math.min(Number(item.duration) || 30, Math.max(1, totalDuration(project.clips))),
        volume: 0.8,
        fadeIn: 0,
        fadeOut: 0,
      };
      if (!audio.duration) audio.duration = Math.min(30, Number(item.duration) || 30);
      project.audios.push(audio);
      state.selected = { kind: 'audio', id: audio.id };
      refreshAll();
    }

    async function separateAudio() {
      const selected = state.selected && state.selected.kind === 'clip' ? clipOf(state.selected.id) : null;
      const clip = selected || project.clips[Math.max(0, indexAt(project.clips, state.playhead))];
      if (!clip) { say('소리를 뽑을 클립을 고르세요'); return; }
      if (clip.kind === 'image') { say('이미지에는 소리가 없습니다'); return; }
      const item = mediaOf(clip.mediaId);
      if (!item) return;

      if (IS_MAC && item.path) {
        try {
          const path = await invoke('video_extract_audio', {
            path: item.path,
            start: Number(clip.trimStart) || 0,
            end: Number(clip.trimEnd) || 0,
          });
          commit();
          const audio = {
            id: newId('audio'),
            mediaId: null,
            name: `${clip.name} 소리`,
            start: 0,
            duration: clipDuration(clip),
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            path,
          };
          project.audios.push(audio);
          state.selected = { kind: 'audio', id: audio.id };
          refreshAll();
          say('클립의 소리를 오디오 트랙으로 내렸습니다');
        } catch (error) {
          console.warn('[TIP video] 오디오 분리', error);
          say('이 클립에서는 소리를 뽑지 못했습니다');
        }
        return;
      }

      // 웹 — 브라우저에서 디코딩해 WAV 로 만든다(짧은 클립에 알맞다).
      if (!item.file && !item.url) { say('Mac 앱에서 클립을 넣으면 소리를 뽑을 수 있습니다'); return; }
      try {
        const buffer = await (await fetch(item.url)).arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await audioContext.decodeAudioData(buffer.slice(0));
        const wav = encodeWav(decoded);
        await audioContext.close();
        const blob = new Blob([wav], { type: 'audio/wav' });
        const file = new File([blob], `${clip.name}-소리.wav`, { type: 'audio/wav' });
        const added = addMediaFromFile(file);
        added.duration = decoded.duration;
        commit();
        const audio = {
          id: newId('audio'),
          mediaId: added.id,
          name: `${clip.name} 소리`,
          start: 0,
          duration: clipDuration(clip),
          volume: 1,
          fadeIn: 0,
          fadeOut: 0,
        };
        project.audios.push(audio);
        state.selected = { kind: 'audio', id: audio.id };
        refreshAll();
        say('클립의 소리를 오디오 트랙으로 내렸습니다');
      } catch (error) {
        console.warn('[TIP video] 오디오 분리(웹)', error);
        say('이 클립의 소리를 읽지 못했습니다');
      }
    }

    function encodeWav(buffer) {
      const channels = Math.min(2, buffer.numberOfChannels);
      const frames = buffer.length;
      const data = new DataView(new ArrayBuffer(44 + frames * channels * 2));
      const writeText = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) data.setUint8(offset + i, text.charCodeAt(i));
      };
      writeText(0, 'RIFF');
      data.setUint32(4, 36 + frames * channels * 2, true);
      writeText(8, 'WAVE');
      writeText(12, 'fmt ');
      data.setUint32(16, 16, true);
      data.setUint16(20, 1, true);
      data.setUint16(22, channels, true);
      data.setUint32(24, buffer.sampleRate, true);
      data.setUint32(28, buffer.sampleRate * channels * 2, true);
      data.setUint16(32, channels * 2, true);
      data.setUint16(34, 16, true);
      writeText(36, 'data');
      data.setUint32(40, frames * channels * 2, true);
      const arrays = [];
      for (let channel = 0; channel < channels; channel += 1) arrays.push(buffer.getChannelData(channel));
      let offset = 44;
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channels; channel += 1) {
          const sample = Math.max(-1, Math.min(1, arrays[channel][frame]));
          data.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        }
      }
      return data;
    }

    /* ------------------------------ 클립 조작 ------------------------------ */

    function splitAtPlayhead() {
      const index = indexAt(project.clips, state.playhead);
      const clip = project.clips[index];
      if (!clip) { say('플레이헤드를 클립 위에 두세요'); return; }
      const at = layout(project.clips)[index];
      const offset = state.playhead - at.start;
      if (offset < 0.1 || offset > at.duration - 0.1) { say('클립 가운데에서 나눠 주세요'); return; }
      commit();
      const left = { ...clip };
      const right = { ...clip, id: newId('clip') };
      if (clip.kind === 'image') {
        left.trimEnd = Number(clip.trimStart) + offset;
        right.trimStart = left.trimEnd;
      } else {
        const cut = Number(clip.trimStart) + offset * (Number(clip.speed) || 1);
        left.trimEnd = cut;
        right.trimStart = cut;
        right.transition = { kind: 'fade', duration: CUT * 2 };
      }
      right.transition = right.transition || { kind: 'fade', duration: CUT * 2 };
      project.clips.splice(index, 1, left, right);
      state.selected = { kind: 'clip', id: right.id };
      refreshAll();
      say('클립을 나눴습니다');
    }

    function deleteSelected() {
      const selected = state.selected;
      if (!selected) { say('지울 항목을 고르세요'); return; }
      if (selected.kind === 'clip') {
        const index = project.clips.findIndex((clip) => clip.id === selected.id);
        if (index < 0) return;
        commit();
        project.clips.splice(index, 1);
      } else if (selected.kind === 'subtitle') {
        const index = project.subtitles.findIndex((item) => item.id === selected.id);
        if (index < 0) return;
        commit();
        project.subtitles.splice(index, 1);
      } else if (selected.kind === 'audio') {
        const index = project.audios.findIndex((item) => item.id === selected.id);
        if (index < 0) return;
        commit();
        project.audios.splice(index, 1);
      } else if (selected.kind === 'overlay') {
        const index = project.overlays.findIndex((item) => item.id === selected.id);
        if (index < 0) return;
        commit();
        project.overlays.splice(index, 1);
      }
      state.selected = null;
      state.playhead = Math.min(state.playhead, totalDuration(project.clips));
      refreshAll();
      say('지웠습니다');
    }

    function moveClip(clipId, toIndex) {
      const from = project.clips.findIndex((clip) => clip.id === clipId);
      if (from < 0 || toIndex < 0 || toIndex >= project.clips.length || from === toIndex) return;
      commit();
      const [clip] = project.clips.splice(from, 1);
      project.clips.splice(toIndex, 0, clip);
      refreshAll();
    }

    /* ------------------------------ 미리보기 ------------------------------ */

    function aspectValue() {
      return (ASPECTS.find((item) => item.id === project.aspect) || ASPECTS[0]).value;
    }

    function previewSize() {
      const height = 480;
      const width = Math.round(height * aspectValue());
      return { width: width % 2 ? width + 1 : width, height };
    }

    function elementFor(item) {
      if (!item) return null;
      if (elements.has(item.id)) return elements.get(item.id);
      let node;
      if (item.kind === 'image') {
        node = new Image();
        node.src = item.url;
      } else if (item.kind === 'audio') {
        node = new Audio();
        node.src = item.url;
        node.preload = 'auto';
      } else if (item.url) {
        node = document.createElement('video');
        node.src = item.url;
        node.preload = 'auto';
        node.playsInline = true;
        node.addEventListener('loadedmetadata', () => {
          if (!item.duration) item.duration = Number(node.duration) || 0;
        });
        node.style.display = 'none';
        document.body.append(node);
      } else {
        // Mac — 경로만 있는 파일은 화면에서 미리 볼 수 없다(내보내기에는 그대로 쓴다).
        node = null;
      }
      const entry = { node, path: item.path, ready: item.kind === 'image' };
      elements.set(item.id, entry);
      return entry;
    }

    function fillFilter(filter) {
      const brightness = Number(filter && filter.brightness) || 1;
      const contrast = Number(filter && filter.contrast) || 1;
      const saturation = Number(filter && filter.saturation);
      const sat = saturation === undefined ? 1 : Number(saturation);
      return `brightness(${brightness}) contrast(${contrast}) saturate(${sat})`;
    }

    /** 한 장면을 그린다 — 비율 유지(cover)로 캔버스를 채우고, 줌/팬은 그 위에 배율로 얹는다. */
    function drawMedia(context, width, height, item, sourceTime, filter, motion, progress) {
      const entry = elementFor(item);
      const node = entry && entry.node;
      context.save();
      context.filter = fillFilter(filter);
      const targetRatio = width / height;
      let drawWidth = width;
      let drawHeight = height;
      let natural = 0;
      if (node && (node instanceof HTMLVideoElement || node instanceof Image)) {
        natural = node instanceof HTMLVideoElement ? node.videoWidth : node.naturalWidth;
        const naturalHeight = node instanceof HTMLVideoElement ? node.videoHeight : node.naturalHeight;
        if (node instanceof HTMLVideoElement && node.readyState < 2) {
          context.restore();
          return;
        }
        if (natural && naturalHeight) {
          const sourceRatio = natural / naturalHeight;
          if (sourceRatio > targetRatio) {
            drawHeight = height;
            drawWidth = height * sourceRatio;
          } else {
            drawWidth = width;
            drawHeight = width / sourceRatio;
          }
        }
      }
      // 줌/팬 — 중심점을 기준으로 배율만큼 당겨 그린다(내보내기의 zoompan 과 같은 뜻).
      if (motion && motion.kind && motion.kind !== 'none') {
        const moved = motionAt(motion, progress);
        context.translate(width * moved.cx, height * moved.cy);
        context.scale(moved.scale, moved.scale);
        context.translate(-width * moved.cx, -height * moved.cy);
      }
      const x = (width - drawWidth) / 2;
      const y = (height - drawHeight) / 2;
      if (node) {
        try {
          context.drawImage(node, x, y, drawWidth, drawHeight);
        } catch { /* 아직 디코드되지 않은 프레임 */ }
      } else {
        // 화면에 그릴 수 없는 파일 — 빈 칸에 이름만 남긴다(내보내기 결과에는 들어간다).
        context.fillStyle = '#1b1d1c';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#7C8288';
        context.font = `${Math.round(height * 0.035)}px Pretendard, system-ui, sans-serif`;
        context.textAlign = 'center';
        context.fillText('Mac 내보내기로 합쳐집니다', width / 2, height / 2);
        context.textAlign = 'start';
      }
      context.restore();
      void natural;
    }

    /** 오버레이(PIP) — 메인 영상 위에 크기·위치·불투명도대로 얹는다. */
    function drawOverlay(context, width, height, overlay) {
      const item = mediaOf(overlay.mediaId);
      const entry = elementFor(item);
      const node = entry && entry.node;
      const scale = Math.min(1, Math.max(0.05, Number(overlay.scale) || 0.32));
      const boxWidth = Math.max(24, width * scale);
      let boxHeight = boxWidth * 0.5625;
      if (node) {
        const naturalWidth = node instanceof HTMLVideoElement ? node.videoWidth : (node.naturalWidth || 0);
        const naturalHeight = node instanceof HTMLVideoElement ? node.videoHeight : (node.naturalHeight || 0);
        if (naturalWidth && naturalHeight) boxHeight = boxWidth * (naturalHeight / naturalWidth);
      }
      const x = overlay.x * width - boxWidth / 2;
      const y = overlay.y * height - boxHeight / 2;
      const opacity = Math.min(1, Math.max(0, overlay.opacity === undefined ? 1 : Number(overlay.opacity)));
      context.save();
      context.globalAlpha = opacity;
      if (node && boxHeight > 0) {
        try {
          context.drawImage(node, x, y, boxWidth, boxHeight);
        } catch { /* 아직 디코드되지 않은 프레임 */ }
      } else {
        context.fillStyle = 'rgba(40, 44, 42, 0.9)';
        context.fillRect(x, y, boxWidth, boxHeight);
        context.fillStyle = '#9AA3A0';
        context.font = `${Math.round(height * 0.028)}px Pretendard, system-ui, sans-serif`;
        context.textAlign = 'center';
        context.fillText(overlay.name || '오버레이', x + boxWidth / 2, y + boxHeight / 2);
        context.textAlign = 'start';
      }
      context.restore();
      return { x, y, width: boxWidth, height: Math.max(12, boxHeight), overlay };
    }

    /** 자막 하나 — 등장 애니메이션(투명도·배율·아래서 위로)을 반영해 그린다. */
    function drawSubtitleBox(context, width, height, subtitle, time) {
      const scale = height / 1080;
      const size = Math.max(12, subtitle.size * scale);
      const family = fontFamilyFor(subtitle);
      const local = (Number(time) || 0) - Number(subtitle.start || 0);
      const anim = animationAt(subtitle.animation, local, subtitle.size);
      context.save();
      context.globalAlpha = Math.max(0, Math.min(1, anim.alpha));
      context.font = `600 ${size}px ${family}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const maxWidth = width * 0.86;
      const lines = wrapText(context, subtitle.text, maxWidth);
      const lineHeight = size * 1.28;
      const blockHeight = lines.length * lineHeight;
      const centerX = subtitle.x * width;
      const baseY = subtitle.y * height;
      if (anim.scale !== 1) {
        context.translate(centerX, baseY);
        context.scale(anim.scale, anim.scale);
        context.translate(-centerX, -baseY);
      }
      const centerY = baseY + anim.offsetY * scale;
      const top = centerY - blockHeight / 2 + lineHeight / 2;

      if (Number(subtitle.background) > 0) {
        const boxWidth = Math.min(maxWidth, Math.max(...lines.map((line) => context.measureText(line).width), size));
        context.fillStyle = `rgba(0, 0, 0, ${Math.min(1, Number(subtitle.background))})`;
        const padX = size * 0.35;
        const padY = size * 0.22;
        context.fillRect(centerX - boxWidth / 2 - padX, top - lineHeight / 2 - padY, boxWidth + padX * 2, blockHeight + padY * 2);
      }

      const widest = Math.max(...lines.map((line) => context.measureText(line).width), size);
      const outline = Number(subtitle.outlineWidth) * scale;
      lines.forEach((line, index) => {
        const y = top + index * lineHeight;
        if (outline > 0.2) {
          context.lineWidth = outline * 2;
          context.strokeStyle = subtitle.outlineColor || '#000000';
          context.lineJoin = 'round';
          context.strokeText(line, centerX, y);
        }
        context.fillStyle = subtitle.color || '#FFFFFF';
        context.fillText(line, centerX, y);
      });
      context.restore();

      return {
        x: centerX,
        y: centerY,
        width: widest + size * 0.8,
        height: blockHeight + size * 0.5,
        subtitle,
      };
    }

    function wrapText(context, text, maxWidth) {
      const paragraphs = String(text || '').split('\n');
      const lines = [];
      for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (!words.length) { lines.push(''); continue; }
        let line = '';
        for (const word of words) {
          const next = line ? `${line} ${word}` : word;
          if (context.measureText(next).width > maxWidth && line) {
            lines.push(line);
            line = word;
          } else {
            line = next;
          }
        }
        if (line) lines.push(line);
      }
      return lines.length ? lines : [''];
    }

    function fontFamilyFor(subtitle) {
      if (subtitle.fontFile && state.webFonts.has(subtitle.fontId || subtitle.font)) {
        return `"${subtitle.fontId || subtitle.font}"`;
      }
      return fontById(subtitle.font).family || 'Pretendard';
    }

    function drawScene(context, width, height, time) {
      context.clearRect(0, 0, width, height);
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      const items = layout(project.clips);
      const ratioOf = (item) => (item ? Math.min(1, Math.max(0, (time - item.start) / Math.max(0.001, item.duration))) : 0);
      const frame = frameAt(project.clips, time);
      if (frame) {
        if (frame.kind === 'transition') {
          const fromClip = project.clips[frame.from.index];
          const toClip = project.clips[frame.to.index];
          drawTransition(context, width, height, {
            fromItem: mediaOf(fromClip.mediaId),
            fromClip,
            fromTime: frame.from.local,
            fromRatio: ratioOf(items[frame.from.index]),
            toItem: mediaOf(toClip.mediaId),
            toClip,
            toTime: frame.to.local,
            toRatio: ratioOf(items[frame.to.index]),
            progress: frame.progress,
            transition: frame.transition,
          });
        } else {
          const clip = project.clips[frame.index];
          drawMedia(context, width, height, mediaOf(clip.mediaId), frame.local, clip.filter,
            clip.motion, ratioOf(items[frame.index]));
        }
      }

      // 오버레이(PIP) — 메인 영상 위, 자막 아래.
      overlayBoxes = [];
      project.overlays.forEach((overlay) => {
        if (time + 0.001 >= Number(overlay.start) && time < Number(overlay.end)) {
          overlayBoxes.push(drawOverlay(context, width, height, overlay));
        }
      });

      const boxes = [];
      for (const subtitle of project.subtitles) {
        if (time + 0.001 >= subtitle.start && time < subtitle.end) {
          boxes.push(drawSubtitleBox(context, width, height, subtitle, time));
        }
      }
      return boxes;
    }

    /** 전환 — 브라우저는 ffmpeg 의 xfade 를 흉내 낸다(가장 비슷한 방식). */
    function drawTransition(context, width, height, options) {
      const { fromItem, fromClip, fromTime, fromRatio, toItem, toClip, toTime, toRatio, progress, transition } = options;
      const t = Math.max(0, Math.min(1, progress));
      const meta = transitionById(transition.kind);
      const family = meta.family;
      const dir = meta.dir || 'left';

      const drawA = (alpha = 1) => {
        context.save();
        context.globalAlpha = alpha;
        drawMedia(context, width, height, fromItem, fromTime, fromClip.filter, fromClip.motion, fromRatio);
        context.restore();
      };
      const drawB = (alpha = 1) => {
        context.save();
        context.globalAlpha = alpha;
        drawMedia(context, width, height, toItem, toTime, toClip.filter, toClip.motion, toRatio);
        context.restore();
      };

      context.save();
      switch (family) {
        case 'fade':
        case 'dissolve':
          drawA(1);
          drawB(t);
          break;
        case 'fadeblack':
          if (t < 0.5) {
            drawA(1);
            context.fillStyle = `rgba(0,0,0,${t * 2})`;
            context.fillRect(0, 0, width, height);
          } else {
            drawB(1);
            context.fillStyle = `rgba(0,0,0,${(1 - t) * 2})`;
            context.fillRect(0, 0, width, height);
          }
          break;
        case 'fadewhite':
          if (t < 0.5) {
            drawA(1);
            context.fillStyle = `rgba(255,255,255,${t * 2})`;
            context.fillRect(0, 0, width, height);
          } else {
            drawB(1);
            context.fillStyle = `rgba(255,255,255,${(1 - t) * 2})`;
            context.fillRect(0, 0, width, height);
          }
          break;
        case 'wipe': {
          drawA(1);
          context.beginPath();
          if (dir === 'left') context.rect(0, 0, width * t, height);
          else if (dir === 'right') context.rect(width * (1 - t), 0, width * t, height);
          else if (dir === 'up') context.rect(0, 0, width, height * t);
          else context.rect(0, height * (1 - t), width, height * t);
          context.clip();
          drawB(1);
          break;
        }
        case 'slide': {
          drawA(1);
          context.save();
          context.beginPath();
          context.rect(0, 0, width, height);
          context.clip();
          if (dir === 'left') context.translate(-width * (1 - t), 0);
          else if (dir === 'right') context.translate(width * (1 - t), 0);
          else if (dir === 'up') context.translate(0, -height * (1 - t));
          else context.translate(0, height * (1 - t));
          drawB(1);
          context.restore();
          break;
        }
        case 'circleopen':
        case 'circleclose': {
          const radius = (family === 'circleopen' ? t : 1 - t) * Math.hypot(width, height) * 0.7;
          drawA(1);
          context.beginPath();
          context.arc(width / 2, height / 2, Math.max(0.1, radius), 0, Math.PI * 2);
          context.clip();
          drawB(1);
          break;
        }
        case 'split': {
          drawA(1);
          const amount = t * 0.5;
          context.beginPath();
          if (dir.startsWith('vert')) {
            const width2 = width * (dir.endsWith('open') ? amount : 0.5 - amount);
            context.rect(width / 2 - width2, 0, width2 * 2, height);
          } else {
            const height2 = height * (dir.endsWith('open') ? amount : 0.5 - amount);
            context.rect(0, height / 2 - height2, width, height2 * 2);
          }
          context.clip();
          drawB(1);
          break;
        }
        case 'diag': {
          drawA(1);
          context.beginPath();
          context.moveTo(0, 0);
          if (dir === 'tl') {
            context.lineTo(width * t, 0);
            context.lineTo(0, height * t);
          } else if (dir === 'tr') {
            context.moveTo(width, 0);
            context.lineTo(width * (1 - t), 0);
            context.lineTo(width, height * t);
          } else if (dir === 'bl') {
            context.moveTo(0, height);
            context.lineTo(width * t, height);
            context.lineTo(0, height * (1 - t));
          } else {
            context.moveTo(width, height);
            context.lineTo(width * (1 - t), height);
            context.lineTo(width, height * (1 - t));
          }
          context.closePath();
          context.clip();
          drawB(1);
          break;
        }
        case 'zoom': {
          drawA(1);
          context.save();
          context.globalAlpha = t;
          const zoom = 1.6 - t * 0.6;
          context.translate(width / 2, height / 2);
          context.scale(zoom, zoom);
          context.translate(-width / 2, -height / 2);
          drawB(1);
          context.restore();
          break;
        }
        case 'squeeze': {
          drawA(1);
          context.save();
          context.globalAlpha = t;
          context.translate(width / 2, height / 2);
          context.scale(1.25 - t * 0.25, 1);
          context.translate(-width / 2, -height / 2);
          drawB(1);
          context.restore();
          break;
        }
        case 'pixelize': {
          drawA(1);
          const size = Math.max(2, Math.round(48 * (1 - t)));
          const small = document.createElement('canvas');
          small.width = Math.max(2, Math.round(width / size));
          small.height = Math.max(2, Math.round(height / size));
          const sctx = small.getContext('2d');
          drawMedia(sctx, small.width, small.height, toItem, toTime, toClip.filter);
          context.imageSmoothingEnabled = false;
          context.globalAlpha = t;
          context.drawImage(small, 0, 0, width, height);
          context.imageSmoothingEnabled = true;
          break;
        }
        case 'radial': {
          drawA(1);
          context.beginPath();
          context.moveTo(width / 2, height / 2);
          context.arc(width / 2, height / 2, Math.hypot(width, height), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
          context.closePath();
          context.clip();
          drawB(1);
          break;
        }
        default:
          drawA(1);
          drawB(t);
      }
      context.restore();
    }

    function syncMedia(time) {
      const items = layout(project.clips);
      const frame = frameAt(project.clips, time);
      const active = new Set();
      if (frame && frame.kind === 'single') active.add(frame.index);
      if (frame && frame.kind === 'transition') {
        active.add(frame.from.index);
        active.add(frame.to.index);
      }
      project.clips.forEach((clip, index) => {
        const item = mediaOf(clip.mediaId);
        if (!item || item.kind !== 'video') return;
        const entry = elementFor(item);
        const node = entry && entry.node;
        if (!node) return;
        if (!active.has(index)) {
          if (!node.paused) node.pause();
          return;
        }
        const layoutItem = items[index];
        const speed = Math.max(SPEED_MIN, Number(clip.speed) || 1);
        const local = (time - layoutItem.start) * speed + Number(clip.trimStart);
        node.playbackRate = Math.min(4, speed);
        node.volume = Math.min(1, Math.max(0, Number(clip.volume) || 0));
        const drift = Math.abs(node.currentTime - local);
        if (state.playing) {
          if (drift > 0.35) node.currentTime = Math.max(0, local);
          if (node.paused) node.play().catch(() => {});
        } else {
          if (!node.paused) node.pause();
          if (drift > 0.06) node.currentTime = Math.max(0, Math.min(local, Number(clip.trimEnd) || local));
        }
      });

      // 배경 음악 — 플레이헤드가 재생 구간에 있으면 그 위치로.
      project.audios.forEach((audio) => {
        const item = mediaOf(audio.mediaId);
        if (!item) return;
        const entry = elementFor(item);
        const node = entry && entry.node;
        if (!node) return;
        node.volume = Math.min(1, Math.max(0, Number(audio.volume) || 0));
        const inside = time >= audio.start && time < audio.start + audio.duration;
        if (!inside || !state.playing) {
          if (!node.paused) node.pause();
          return;
        }
        const local = time - audio.start;
        if (Math.abs(node.currentTime - local) > 0.35) node.currentTime = Math.max(0, local);
        if (node.paused) node.play().catch(() => {});
      });
    }

    function drawPreview() {
      if (!activeCtx) return;
      const { width, height } = previewSize();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      syncMedia(state.playhead);
      subBoxes = drawScene(activeCtx, width, height, state.playhead);
      timeNow.textContent = timecode(state.playhead);
      timeTotal.textContent = timecode(totalDuration(project.clips));
    }

    function tick(now) {
      if (!state.playing) return;
      const delta = Math.min(0.25, (now - lastTick) / 1000 || 0);
      lastTick = now;
      const end = totalDuration(project.clips);
      state.playhead += delta;
      if (state.playhead >= end) {
        state.playhead = end;
        pause();
        updatePlayhead();
        drawPreview();
        return;
      }
      updatePlayhead();
      drawPreview();
      rafId = requestAnimationFrame(tick);
    }

    function play() {
      if (!project.clips.length) { say('먼저 영상을 타임라인에 넣으세요'); return; }
      if (state.playhead >= totalDuration(project.clips) - 0.01) state.playhead = 0;
      state.playing = true;
      playBtn.innerHTML = ICON_PAUSE;
      playBtn.setAttribute('aria-label', '일시정지');
      lastTick = performance.now();
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    }

    function pause() {
      state.playing = false;
      playBtn.innerHTML = ICON_PLAY;
      playBtn.setAttribute('aria-label', '재생');
      cancelAnimationFrame(rafId);
      syncMedia(state.playhead);
    }

    function togglePlay() {
      if (state.playing) pause();
      else play();
    }

    function seek(time) {
      const end = totalDuration(project.clips);
      state.playhead = Math.max(0, Math.min(time, end));
      updatePlayhead();
      drawPreview();
      renderTimelineMeta();
    }

    /* ------------------------------ 왼쪽 탭 ------------------------------ */

    function renderTabs() {
      leftTabBar.innerHTML = '';
      TAB_LABELS.forEach((tab) => {
        const on = state.tab === tab.id;
        const button = el('button', {
          class: `ve-tab${on ? ' is-on' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': on ? 'true' : 'false',
          text: tab.label,
        });
        button.addEventListener('click', () => {
          state.tab = tab.id;
          renderTabs();
          renderLeft();
        });
        leftTabBar.append(button);
      });
    }

    function mediaListItems(kind) {
      return [...media.values()].filter((item) => (kind === 'audio' ? item.kind === 'audio' : item.kind !== 'audio'));
    }

    function renderMediaTab() {
      const wrap = el('div', { class: 've-stack' });
      const addRow = el('div', { class: 've-btn-row' });
      const addButton = el('button', { class: 've-btn ve-btn-primary', type: 'button', html: `${icons.plus}<span>${IS_MAC ? '파일 추가' : '영상·이미지 추가'}</span>` });
      addButton.addEventListener('click', async () => {
        const added = await pickMedia('video');
        if (added.length) {
          commit();
          added.forEach((item) => pushClip(item));
          say(`${added.length}개를 타임라인에 넣었습니다`);
        }
      });
      addRow.append(addButton);
      wrap.append(addRow, el('p', { class: 've-hint', text: IS_MAC ? '영상·이미지는 Mac 파일 선택 창에서 고릅니다. 끌어다 놓아도 됩니다.' : '영상과 이미지를 골라 타임라인에 이어 붙입니다.' }));

      const list = el('div', { class: 've-media-list' });
      const items = mediaListItems('video');
      if (!items.length) {
        list.append(el('p', { class: 've-empty', text: '아직 넣은 파일이 없습니다' }));
      }
      items.forEach((item) => {
        const row = el('div', { class: `ve-media-row${item.missing ? ' is-missing' : ''}` });
        const thumb = el('div', { class: 've-media-thumb' });
        if (item.kind === 'image' && item.url) {
          thumb.append(el('img', { src: item.url, alt: '' }));
        } else {
          thumb.innerHTML = item.kind === 'image' ? ICON : ICON;
        }
        const body = el('div', { class: 've-media-body' }, [
          el('div', { class: 've-media-name', text: item.name }),
          el('div', { class: 've-media-meta', text: item.missing ? '파일 없음 · 다시 연결하세요' : `${item.kind === 'image' ? '이미지' : '영상'} · ${item.duration ? friendlyDuration(item.duration) : '길이 확인 중'}` }),
        ]);
        const actions = el('div', { class: 've-media-actions' });
        if (item.missing) {
          const relink = el('button', { class: 've-mini-btn', type: 'button', text: '다시 연결', 'aria-label': `${item.name} 다시 연결` });
          relink.addEventListener('click', () => relinkMedia(item));
          actions.append(relink);
        } else {
          const add = el('button', { class: 've-mini-btn', type: 'button', text: '넣기', 'aria-label': `${item.name} 타임라인에 넣기` });
          add.addEventListener('click', () => addMediaToTimeline(item));
          actions.append(add);
          if (item.kind !== 'audio') {
            const pip = el('button', { class: 've-mini-btn', type: 'button', text: 'PIP', 'aria-label': `${item.name} 오버레이로 얹기` });
            pip.addEventListener('click', () => addOverlayFromMedia(item));
            actions.append(pip);
          }
        }
        row.append(thumb, body, actions);
        list.append(row);
      });
      wrap.append(list);

      // 프로젝트 파일 — 다른 브라우저·다른 날로 옮기거나 보관할 때.
      const projectRow = el('div', { class: 've-btn-row' });
      const saveProject = el('button', { class: 've-btn', type: 'button', text: '프로젝트 저장' });
      saveProject.addEventListener('click', saveProjectFile);
      const openProject = el('button', { class: 've-btn', type: 'button', text: '프로젝트 열기' });
      openProject.addEventListener('click', openProjectFile);
      projectRow.append(saveProject, openProject);
      wrap.append(projectRow, el('p', { class: 've-hint', text: '작업은 자동으로 저장됩니다. .tipproj 파일로 보관하면 다른 기기에서도 이어서 열 수 있습니다.' }));
      return wrap;
    }

    function renderTransitionTab() {
      const wrap = el('div', { class: 've-stack' });
      let targetIndex = state.selected && state.selected.kind === 'clip'
        ? project.clips.findIndex((clip) => clip.id === state.selected.id)
        : indexAt(project.clips, state.playhead);
      // 첫 클립 앞에는 놓을 경계가 없다 — 그때는 바로 뒤 클립 앞(첫 경계)에 놓는다.
      if (targetIndex === 0 && project.clips.length > 1) targetIndex = 1;
      const target = project.clips[targetIndex];
      const current = target && target.transition ? target.transition.kind : null;
      wrap.append(el('p', {
        class: 've-hint',
        text: target ? `${target.name} 앞에 놓을 전환을 고르세요` : '클립을 먼저 넣고 경계를 고르세요',
      }));
      const grid = el('div', { class: 've-transition-grid' });
      TRANSITIONS.forEach((transition) => {
        const on = current === transition.id;
        const button = el('button', {
          class: `ve-transition${on ? ' is-on' : ''}`,
          type: 'button',
          title: transition.label,
        }, [
          el('span', { class: `ve-transition-mark is-${transition.family}`, 'aria-hidden': 'true' }),
          el('span', { class: 've-transition-label', text: transition.label }),
        ]);
        button.addEventListener('click', () => {
          if (!target) { say('클립을 먼저 넣으세요'); return; }
          commit();
          const duration = target.transition && Number(target.transition.duration) > 0 ? target.transition.duration : 0.5;
          target.transition = { kind: transition.id, duration };
          refreshAll();
          say(`${transition.label} 전환을 놓았습니다`);
        });
        grid.append(button);
      });
      wrap.append(grid);
      return wrap;
    }

    function renderSubtitleTab() {
      const wrap = el('div', { class: 've-stack' });
      const area = el('textarea', {
        class: 've-textarea',
        rows: '3',
        placeholder: '자막 내용을 넣고 추가를 누르세요',
        'aria-label': '자막 내용',
      });
      const row = el('div', { class: 've-btn-row' });
      const add = el('button', { class: 've-btn ve-btn-primary', type: 'button', text: '자막 추가' });
      add.addEventListener('click', () => {
        const text = area.value.trim();
        if (!text) { area.focus(); return; }
        commit();
        const start = Math.max(0, state.playhead);
        const end = start + Math.min(3, Math.max(1.2, totalDuration(project.clips) - start || 2));
        const subtitle = createSubtitle(text, start, end);
        applySubtitlePreset(subtitle, state.defaultPreset);
        project.subtitles.push(subtitle);
        state.selected = { kind: 'subtitle', id: subtitle.id };
        area.value = '';
        refreshAll();
      });
      row.append(add);
      wrap.append(area, row, el('p', { class: 've-hint', text: '미리보기에서 자막을 끌어 위치를 바꿀 수 있습니다. 글꼴·색은 오른쪽 속성에서.' }));

      // 스타일 프리셋 — 고른 자막에 바로 입히고, 다음에 만드는 자막에도 같은 프리셋을 쓴다.
      wrap.append(el('p', { class: 've-field-label', text: '스타일 프리셋' }));
      const presetGrid = el('div', { class: 've-preset-grid' });
      SUBTITLE_PRESETS.forEach((preset) => {
        const selectedSub = state.selected && state.selected.kind === 'subtitle' ? subtitleOf(state.selected.id) : null;
        const on = selectedSub
          ? matchSubtitlePreset(selectedSub) === preset.id
          : state.defaultPreset === preset.id;
        const button = el('button', {
          class: `ve-preset${on ? ' is-on' : ''}`,
          type: 'button',
          text: preset.label,
          'aria-label': `${preset.label} 자막 프리셋`,
        });
        button.addEventListener('click', () => {
          state.defaultPreset = preset.id;
          const subtitle = state.selected && state.selected.kind === 'subtitle' ? subtitleOf(state.selected.id) : null;
          if (!subtitle) { renderLeft(); say(`${preset.label} 프리셋을 다음 자막에 씁니다`); return; }
          commit();
          applySubtitlePreset(subtitle, preset.id);
          refreshAll();
          say(`${preset.label} 프리셋을 입혔습니다`);
        });
        presetGrid.append(button);
      });
      wrap.append(presetGrid);

      // 자동 자막 — Mac 앱의 whisper.cpp 로 소리를 받아 적는다.
      const autoRow = el('div', { class: 've-btn-row' });
      const auto = el('button', {
        class: 've-btn',
        type: 'button',
        text: IS_MAC ? '음성으로 자동 자막' : '자동 자막 (Mac 앱)',
        'aria-label': '음성으로 자동 자막',
      });
      auto.addEventListener('click', () => {
        if (!IS_MAC) { say('자동 자막은 Mac 앱에서 됩니다(whisper.cpp)'); return; }
        whisperDialog();
      });
      autoRow.append(auto);
      wrap.append(autoRow);

      const list = el('div', { class: 've-sub-list' });
      if (!project.subtitles.length) list.append(el('p', { class: 've-empty', text: '아직 자막이 없습니다' }));
      project.subtitles
        .slice()
        .sort((a, b) => a.start - b.start)
        .forEach((subtitle) => {
          const on = state.selected && state.selected.kind === 'subtitle' && state.selected.id === subtitle.id;
          const rowEl = el('button', {
            class: `ve-sub-row${on ? ' is-on' : ''}`,
            type: 'button',
          }, [
            el('span', { class: 've-sub-time', text: timecode(subtitle.start, false) }),
            el('span', { class: 've-sub-text', text: subtitle.text }),
          ]);
          rowEl.addEventListener('click', () => {
            state.selected = { kind: 'subtitle', id: subtitle.id };
            seek(subtitle.start);
            refreshAll();
          });
          list.append(rowEl);
        });
      wrap.append(list);
      return wrap;
    }

    function renderAudioTab() {
      const wrap = el('div', { class: 've-stack' });
      const row = el('div', { class: 've-btn-row' });
      const add = el('button', { class: 've-btn ve-btn-primary', type: 'button', html: `${icons.plus}<span>배경 음악 추가</span>` });
      add.addEventListener('click', async () => {
        const added = await pickMedia('audio');
        if (!added.length) return;
        added.forEach((item) => addAudioItem(item));
        say('오디오 트랙에 넣었습니다');
      });
      const separate = el('button', { class: 've-btn', type: 'button', text: '선택 클립 소리 분리' });
      separate.addEventListener('click', separateAudio);
      row.append(add, separate);
      wrap.append(row, el('p', { class: 've-hint', text: '배경 음악은 오디오 트랙에 놓이고, 클립 소리는 따로 뽑아 내릴 수 있습니다.' }));

      const list = el('div', { class: 've-sub-list' });
      if (!project.audios.length) list.append(el('p', { class: 've-empty', text: '아직 오디오가 없습니다' }));
      project.audios.forEach((audio) => {
        const on = state.selected && state.selected.kind === 'audio' && state.selected.id === audio.id;
        const rowEl = el('button', { class: `ve-sub-row${on ? ' is-on' : ''}`, type: 'button' }, [
          el('span', { class: 've-sub-time', text: timecode(audio.start, false) }),
          el('span', { class: 've-sub-text', text: audio.name }),
          el('span', { class: 've-sub-meta', text: friendlyDuration(audio.duration) }),
        ]);
        rowEl.addEventListener('click', () => {
          state.selected = { kind: 'audio', id: audio.id };
          refreshAll();
        });
        list.append(rowEl);
      });
      wrap.append(list);
      return wrap;
    }

    function renderFilterTab() {
      const wrap = el('div', { class: 've-stack' });
      const clip = state.selected && state.selected.kind === 'clip'
        ? clipOf(state.selected.id)
        : project.clips[Math.max(0, indexAt(project.clips, state.playhead))];
      if (!clip) {
        wrap.append(el('p', { class: 've-empty', text: '필터를 넣을 클립을 고르세요' }));
        return wrap;
      }
      const grid = el('div', { class: 've-preset-grid' });
      FILTER_PRESETS.forEach((preset) => {
        const on = Math.abs((clip.filter.brightness || 1) - preset.brightness) < 0.01
          && Math.abs((clip.filter.contrast || 1) - preset.contrast) < 0.01
          && Math.abs((clip.filter.saturation ?? 1) - preset.saturation) < 0.01;
        const button = el('button', { class: `ve-preset${on ? ' is-on' : ''}`, type: 'button', text: preset.label });
        button.addEventListener('click', () => {
          commit();
          clip.filter = { brightness: preset.brightness, contrast: preset.contrast, saturation: preset.saturation };
          refreshAll();
        });
        grid.append(button);
      });
      wrap.append(el('p', { class: 've-hint', text: `${clip.name}에 적용됩니다` }), grid);
      return wrap;
    }

    function renderLeft() {
      renderTabs();
      leftBody.innerHTML = '';
      const body = state.tab === 'media' ? renderMediaTab()
        : state.tab === 'transition' ? renderTransitionTab()
          : state.tab === 'subtitle' ? renderSubtitleTab()
            : state.tab === 'audio' ? renderAudioTab()
              : renderFilterTab();
      leftBody.append(body);
    }

    /* ------------------------------ 오른쪽 속성 ------------------------------ */

    function field(label, control, hint) {
      return el('label', { class: 've-field' }, [
        el('span', { class: 've-field-label', text: label }),
        control,
        hint ? el('span', { class: 've-field-hint', text: hint }) : null,
      ]);
    }

    function slider({ min, max, step, value, format, onInput }) {
      const input = el('input', {
        type: 'range',
        class: 've-range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
      });
      const out = el('span', { class: 've-field-value', text: format(value) });
      input.addEventListener('pointerdown', () => commit());
      input.addEventListener('keydown', () => commit());
      input.addEventListener('input', () => {
        const next = Number(input.value);
        out.textContent = format(next);
        onInput(next);
      });
      return el('div', { class: 've-slider' }, [input, out]);
    }

    function renderProps() {
      propsBody.innerHTML = '';
      const selected = state.selected;
      if (!selected) {
        const info = el('div', { class: 've-stack' });
        info.append(
          el('p', { class: 've-hint', text: '클립·자막·오디오를 고르면 여기에서 자세히 바꿉니다.' }),
          el('div', { class: 've-stat' }, [
            el('div', { class: 've-stat-row' }, [el('span', { text: '클립' }), el('b', { text: `${project.clips.length}개` })]),
            el('div', { class: 've-stat-row' }, [el('span', { text: '자막' }), el('b', { text: `${project.subtitles.length}개` })]),
            el('div', { class: 've-stat-row' }, [el('span', { text: '오디오' }), el('b', { text: `${project.audios.length}개` })]),
            el('div', { class: 've-stat-row' }, [el('span', { text: '길이' }), el('b', { text: friendlyDuration(totalDuration(project.clips)) })]),
          ]),
          el('div', { class: 've-keys' }, [
            el('div', { class: 've-key' }, [el('kbd', { text: 'Space' }), el('span', { text: '재생·정지' })]),
            el('div', { class: 've-key' }, [el('kbd', { text: 'S' }), el('span', { text: '클립 나누기' })]),
            el('div', { class: 've-key' }, [el('kbd', { text: '← →' }), el('span', { text: '1프레임 이동' })]),
            el('div', { class: 've-key' }, [el('kbd', { text: '⇧ ← →' }), el('span', { text: '0.5초 이동' })]),
            el('div', { class: 've-key' }, [el('kbd', { text: '⌘C / ⌘V' }), el('span', { text: '복사·붙여넣기' })]),
            el('div', { class: 've-key' }, [el('kbd', { text: '⌘Z' }), el('span', { text: '되돌리기' })]),
            el('div', { class: 've-key' }, [el('kbd', { text: '⌫' }), el('span', { text: '고른 것 지우기' })]),
          ]),
        );
        propsBody.append(info);
        return;
      }

      if (selected.kind === 'clip') {
        const clip = clipOf(selected.id);
        if (!clip) { state.selected = null; renderProps(); return; }
        const item = mediaOf(clip.mediaId);
        const wrap = el('div', { class: 've-stack' });
        wrap.append(el('h3', { class: 've-prop-title', text: clip.name }));

        wrap.append(field('속도', slider({
          min: SPEED_MIN, max: SPEED_MAX, step: 0.05, value: clip.speed,
          format: (value) => `${value.toFixed(2)}x`,
          onInput: (value) => { clip.speed = value; drawPreview(); renderTimeline(); },
        }), `${clipDuration(clip).toFixed(1)}초로 재생`));

        if (clip.kind !== 'image') {
          wrap.append(field('볼륨', slider({
            min: 0, max: 2, step: 0.05, value: clip.volume,
            format: (value) => `${Math.round(value * 100)}%`,
            onInput: (value) => { clip.volume = value; },
          })));
          wrap.append(field('페이드 인', slider({
            min: 0, max: 3, step: 0.1, value: clip.fadeIn,
            format: (value) => `${value.toFixed(1)}초`,
            onInput: (value) => { clip.fadeIn = value; },
          })));
          wrap.append(field('페이드 아웃', slider({
            min: 0, max: 3, step: 0.1, value: clip.fadeOut,
            format: (value) => `${value.toFixed(1)}초`,
            onInput: (value) => { clip.fadeOut = value; },
          })));
        }

        const transitionRow = el('div', { class: 've-field' }, [
          el('span', { class: 've-field-label', text: '들어오는 전환' }),
          (() => {
            const select = el('select', { class: 've-select', 'aria-label': '들어오는 전환' });
            TRANSITIONS.forEach((transition) => {
              const option = el('option', { value: transition.id, text: transition.label });
              if (clip.transition && clip.transition.kind === transition.id) option.selected = true;
              select.append(option);
            });
            select.addEventListener('change', () => {
              commit();
              clip.transition = { kind: select.value, duration: (clip.transition && Number(clip.transition.duration)) || 0.5 };
              refreshAll();
            });
            return select;
          })(),
        ]);
        wrap.append(transitionRow);
        wrap.append(field('전환 시간', slider({
          min: 0, max: 2, step: 0.05, value: Number(clip.transition && clip.transition.duration) || 0.5,
          format: (value) => `${value.toFixed(2)}초`,
          onInput: (value) => { clip.transition = { ...(clip.transition || { kind: 'fade' }), duration: value }; },
        })));

        // 줌/팬 — 프리셋을 고르면 시작·끝 배율과 중심점이 채워지고, '직접 설정'은 슬라이더로 맞춘다.
        const motionSelect = el('select', { class: 've-select', 'aria-label': '줌/팬' });
        MOTIONS.forEach((motion) => {
          const option = el('option', { value: motion.id, text: motion.label });
          if (((clip.motion && clip.motion.kind) || 'none') === motion.id) option.selected = true;
          motionSelect.append(option);
        });
        motionSelect.addEventListener('change', () => {
          commit();
          if (!clip.motion) clip.motion = createMotion();
          applyMotionPreset(clip.motion, motionSelect.value);
          refreshAll();
          say(`${motionById(motionSelect.value).label} 효과를 넣었습니다`);
        });
        wrap.append(field('줌/팬', motionSelect));

        if (clip.motion && clip.motion.kind && clip.motion.kind !== 'none') {
          wrap.append(field('시작 배율', slider({
            min: 1, max: 2.5, step: 0.01, value: clip.motion.startScale,
            format: (value) => `${value.toFixed(2)}x`,
            onInput: (value) => { clip.motion.startScale = value; drawPreview(); },
          })));
          wrap.append(field('끝 배율', slider({
            min: 1, max: 2.5, step: 0.01, value: clip.motion.endScale,
            format: (value) => `${value.toFixed(2)}x`,
            onInput: (value) => { clip.motion.endScale = value; drawPreview(); },
          })));
          if (clip.motion.kind === 'custom') {
            wrap.append(field('시작 중심 가로', slider({
              min: 0, max: 1, step: 0.01, value: clip.motion.startX,
              format: (value) => `${Math.round(value * 100)}%`,
              onInput: (value) => { clip.motion.startX = value; drawPreview(); },
            })));
            wrap.append(field('끝 중심 가로', slider({
              min: 0, max: 1, step: 0.01, value: clip.motion.endX,
              format: (value) => `${Math.round(value * 100)}%`,
              onInput: (value) => { clip.motion.endX = value; drawPreview(); },
            })));
            wrap.append(field('시작 중심 세로', slider({
              min: 0, max: 1, step: 0.01, value: clip.motion.startY,
              format: (value) => `${Math.round(value * 100)}%`,
              onInput: (value) => { clip.motion.startY = value; drawPreview(); },
            })));
            wrap.append(field('끝 중심 세로', slider({
              min: 0, max: 1, step: 0.01, value: clip.motion.endY,
              format: (value) => `${Math.round(value * 100)}%`,
              onInput: (value) => { clip.motion.endY = value; drawPreview(); },
            })));
          }
        }

        if (!item || !item.path) {
          wrap.append(el('p', { class: 've-hint', text: '브라우저에서 넣은 파일은 화면으로 미리 보며 편집하고, Mac 앱에서는 같은 작업을 ffmpeg 로 한 번에 내보냅니다.' }));
        }

        const actions = el('div', { class: 've-btn-row' });
        const split = el('button', { class: 've-btn', type: 'button', text: '나누기 (S)' });
        split.addEventListener('click', splitAtPlayhead);
        const duplicate = el('button', { class: 've-btn', type: 'button', text: '클립 복제', 'aria-label': '클립 복제' });
        duplicate.addEventListener('click', duplicateSelected);
        const remove = el('button', { class: 've-btn ve-btn-danger', type: 'button', text: '클립 지우기' });
        remove.addEventListener('click', deleteSelected);
        actions.append(split, duplicate, remove);
        wrap.append(actions);

        const applyRow = el('div', { class: 've-btn-row' });
        const applyAll = el('button', { class: 've-btn', type: 'button', text: '모든 클립에 적용', 'aria-label': '모든 클립에 적용' });
        applyAll.addEventListener('click', applyClipToAll);
        applyRow.append(applyAll);
        wrap.append(applyRow, el('p', { class: 've-hint', text: '필터·배속·볼륨·페이드·줌/팬을 모든 클립에 그대로 입힙니다(소스·자르기 구간은 그대로).' }));
        propsBody.append(wrap);
        return;
      }

      if (selected.kind === 'subtitle') {
        const subtitle = subtitleOf(selected.id);
        if (!subtitle) { state.selected = null; renderProps(); return; }
        const wrap = el('div', { class: 've-stack' });
        const area = el('textarea', { class: 've-textarea', rows: '2', 'aria-label': '자막 내용' });
        area.value = subtitle.text;
        area.addEventListener('change', () => { commit(); subtitle.text = area.value; drawPreview(); renderTimeline(); });
        wrap.append(area);

        const fontSelect = el('select', { class: 've-select', 'aria-label': '글꼴' });
        FONTS.forEach((font) => {
          const option = el('option', { value: font.id, text: font.label });
          if (subtitle.font === font.id) option.selected = true;
          fontSelect.append(option);
        });
        if (subtitle.fontFile) {
          const option = el('option', { value: 'custom', text: `${subtitle.fontLabel || '내 글꼴'}` });
          option.selected = true;
          fontSelect.append(option);
        }
        fontSelect.addEventListener('change', () => {
          commit();
          if (fontSelect.value === 'custom') return;
          subtitle.font = fontSelect.value;
          subtitle.fontFile = null;
          subtitle.fontLabel = fontById(fontSelect.value).label;
          refreshAll();
        });
        wrap.append(field('글꼴', fontSelect));

        if (IS_MAC) {
          const fontRow = el('div', { class: 've-btn-row' });
          const pick = el('button', { class: 've-btn', type: 'button', text: '.ttf/.otf 글꼴' });
          pick.addEventListener('click', async () => {
            try {
              const picked = await invoke('video_pick_font');
              if (!picked) return;
              commit();
              subtitle.font = 'custom';
              subtitle.fontFile = picked.path;
              subtitle.fontLabel = picked.name;
              refreshAll();
              say(`${picked.name} 글꼴을 씁니다`);
            } catch (error) {
              console.warn('[TIP video] 글꼴', error);
              say('글꼴을 고르지 못했습니다');
            }
          });
          fontRow.append(pick);
          wrap.append(fontRow);
        }

        wrap.append(field('크기', slider({
          min: 20, max: 140, step: 1, value: subtitle.size,
          format: (value) => `${Math.round(value)}px`,
          onInput: (value) => { subtitle.size = value; drawPreview(); },
        })));

        const color = el('input', { type: 'color', class: 've-color', value: subtitle.color, 'aria-label': '글자 색' });
        color.addEventListener('input', () => { subtitle.color = color.value; drawPreview(); });
        color.addEventListener('change', () => { commit(); refreshAll(); });
        wrap.append(field('글자 색', color));

        const outline = el('input', { type: 'color', class: 've-color', value: subtitle.outlineColor, 'aria-label': '외곽선 색' });
        outline.addEventListener('input', () => { subtitle.outlineColor = outline.value; drawPreview(); });
        outline.addEventListener('change', () => { commit(); refreshAll(); });
        wrap.append(field('외곽선 색', outline));

        wrap.append(field('외곽선 두께', slider({
          min: 0, max: 10, step: 0.5, value: subtitle.outlineWidth,
          format: (value) => `${value.toFixed(1)}`,
          onInput: (value) => { subtitle.outlineWidth = value; drawPreview(); },
        })));

        wrap.append(field('배경', slider({
          min: 0, max: 0.9, step: 0.05, value: Number(subtitle.background) || 0,
          format: (value) => (value > 0 ? `${Math.round(value * 100)}%` : '없음'),
          onInput: (value) => { subtitle.background = value; drawPreview(); },
        })));

        wrap.append(field('시작', slider({
          min: 0, max: Math.max(1, totalDuration(project.clips)), step: 0.1, value: subtitle.start,
          format: (value) => timecode(value),
          onInput: (value) => { subtitle.start = Math.min(value, subtitle.end - 0.2); drawPreview(); },
        })));
        wrap.append(field('끝', slider({
          min: 0, max: Math.max(1, totalDuration(project.clips) + 1), step: 0.1, value: subtitle.end,
          format: (value) => timecode(value),
          onInput: (value) => { subtitle.end = Math.max(value, subtitle.start + 0.2); drawPreview(); },
        })));

        // 스타일 프리셋 — 한 번에 글꼴·크기·색·외곽선·배경·세로 위치· 애니메이션.
        const presetSelect = el('select', { class: 've-select', 'aria-label': '자막 프리셋' });
        SUBTITLE_PRESETS.forEach((preset) => {
          const option = el('option', { value: preset.id, text: preset.label });
          if (matchSubtitlePreset(subtitle) === preset.id) option.selected = true;
          presetSelect.append(option);
        });
        presetSelect.addEventListener('change', () => {
          commit();
          applySubtitlePreset(subtitle, presetSelect.value);
          state.defaultPreset = presetSelect.value;
          refreshAll();
          say(`${subtitlePresetById(presetSelect.value).label} 프리셋을 입혔습니다`);
        });
        wrap.append(field('프리셋', presetSelect));

        const animSelect = el('select', { class: 've-select', 'aria-label': '등장 애니메이션' });
        SUBTITLE_ANIMATIONS.forEach((animation) => {
          const option = el('option', { value: animation.id, text: animation.label });
          if ((subtitle.animation || 'none') === animation.id) option.selected = true;
          animSelect.append(option);
        });
        animSelect.addEventListener('change', () => {
          commit();
          subtitle.animation = animSelect.value;
          refreshAll();
        });
        wrap.append(field('등장 애니메이션', animSelect));

        const actions = el('div', { class: 've-btn-row' });
        const duplicate = el('button', { class: 've-btn', type: 'button', text: '자막 복제', 'aria-label': '자막 복제' });
        duplicate.addEventListener('click', duplicateSelected);
        const remove = el('button', { class: 've-btn ve-btn-danger', type: 'button', text: '자막 지우기' });
        remove.addEventListener('click', deleteSelected);
        actions.append(duplicate, remove);
        wrap.append(actions);

        const applyRow = el('div', { class: 've-btn-row' });
        const applyAll = el('button', { class: 've-btn', type: 'button', text: '모든 자막에 적용', 'aria-label': '모든 자막에 적용' });
        applyAll.addEventListener('click', applySubtitleToAll);
        applyRow.append(applyAll);
        wrap.append(applyRow, el('p', { class: 've-hint', text: '프리셋·글꼴·크기·색·외곽선·배경·애니메이션·세로 위치를 다른 자막에도 그대로 입힙니다(글자·시간은 그대로).' }));
        propsBody.append(wrap);
        return;
      }

      if (selected.kind === 'audio') {
        const audio = audioOf(selected.id);
        if (!audio) { state.selected = null; renderProps(); return; }
        const wrap = el('div', { class: 've-stack' });
        wrap.append(el('h3', { class: 've-prop-title', text: audio.name }));
        wrap.append(field('볼륨', slider({
          min: 0, max: 2, step: 0.05, value: audio.volume,
          format: (value) => `${Math.round(value * 100)}%`,
          onInput: (value) => { audio.volume = value; },
        })));
        wrap.append(field('시작 위치', slider({
          min: 0, max: Math.max(1, totalDuration(project.clips)), step: 0.1, value: audio.start,
          format: (value) => timecode(value),
          onInput: (value) => { audio.start = value; renderTimeline(); },
        })));
        wrap.append(field('길이', slider({
          min: 0.5, max: Math.max(1, totalDuration(project.clips) + 30), step: 0.1, value: audio.duration,
          format: (value) => friendlyDuration(value),
          onInput: (value) => { audio.duration = value; renderTimeline(); },
        })));
        wrap.append(field('페이드 인', slider({
          min: 0, max: 5, step: 0.1, value: audio.fadeIn,
          format: (value) => `${value.toFixed(1)}초`,
          onInput: (value) => { audio.fadeIn = value; },
        })));
        wrap.append(field('페이드 아웃', slider({
          min: 0, max: 5, step: 0.1, value: audio.fadeOut,
          format: (value) => `${value.toFixed(1)}초`,
          onInput: (value) => { audio.fadeOut = value; },
        })));
        const actions = el('div', { class: 've-btn-row' });
        const duplicate = el('button', { class: 've-btn', type: 'button', text: '오디오 복제', 'aria-label': '오디오 복제' });
        duplicate.addEventListener('click', duplicateSelected);
        const remove = el('button', { class: 've-btn ve-btn-danger', type: 'button', text: '오디오 지우기' });
        remove.addEventListener('click', deleteSelected);
        actions.append(duplicate, remove);
        wrap.append(actions);
        propsBody.append(wrap);
        return;
      }

      if (selected.kind === 'overlay') {
        const overlay = overlayOf(selected.id);
        if (!overlay) { state.selected = null; renderProps(); return; }
        const wrap = el('div', { class: 've-stack' });
        wrap.append(el('h3', { class: 've-prop-title', text: `오버레이 · ${overlay.name}` }));
        wrap.append(field('시작', slider({
          min: 0, max: Math.max(1, totalDuration(project.clips)), step: 0.05, value: overlay.start,
          format: (value) => timecode(value),
          onInput: (value) => { overlay.start = Math.min(value, overlay.end - 0.2); renderTimeline(); drawPreview(); },
        })));
        wrap.append(field('끝', slider({
          min: 0, max: Math.max(1, totalDuration(project.clips) + 5), step: 0.05, value: overlay.end,
          format: (value) => timecode(value),
          onInput: (value) => { overlay.end = Math.max(value, overlay.start + 0.2); renderTimeline(); drawPreview(); },
        })));
        wrap.append(field('크기', slider({
          min: 0.05, max: 1, step: 0.01, value: overlay.scale,
          format: (value) => `${Math.round(value * 100)}%`,
          onInput: (value) => { overlay.scale = value; drawPreview(); },
        }), '가로 폭 기준입니다. 미리보기에서 끌어 옮길 수 있습니다'));
        wrap.append(field('가로 위치', slider({
          min: 0, max: 1, step: 0.01, value: overlay.x,
          format: (value) => `${Math.round(value * 100)}%`,
          onInput: (value) => { overlay.x = value; drawPreview(); },
        })));
        wrap.append(field('세로 위치', slider({
          min: 0, max: 1, step: 0.01, value: overlay.y,
          format: (value) => `${Math.round(value * 100)}%`,
          onInput: (value) => { overlay.y = value; drawPreview(); },
        })));
        wrap.append(field('불투명도', slider({
          min: 0, max: 1, step: 0.01, value: overlay.opacity === undefined ? 1 : overlay.opacity,
          format: (value) => `${Math.round(value * 100)}%`,
          onInput: (value) => { overlay.opacity = value; drawPreview(); },
        })));
        const actions = el('div', { class: 've-btn-row' });
        const duplicate = el('button', { class: 've-btn', type: 'button', text: '오버레이 복제', 'aria-label': '오버레이 복제' });
        duplicate.addEventListener('click', duplicateSelected);
        const remove = el('button', { class: 've-btn ve-btn-danger', type: 'button', text: '오버레이 지우기' });
        remove.addEventListener('click', deleteSelected);
        actions.append(duplicate, remove);
        wrap.append(actions);
        propsBody.append(wrap);
        return;
      }
    }

    /* ------------------------------ 타임라인 ------------------------------ */

    function timelineWidth() {
      const total = Math.max(totalDuration(project.clips), totalDuration(project.clips) + 4, 10);
      return Math.max(320, Math.ceil(total * state.zoom) + 80);
    }

    function updatePlayhead() {
      const left = state.playhead * state.zoom;
      playheadEl.style.transform = `translateX(${left}px)`;
      const rulerTime = timeNow.textContent;
      playheadEl.dataset.time = rulerTime;
      // 화면에는 0.1초까지 보이지만, 자동 검사는 정밀한 위치를 읽는다.
      playheadEl.dataset.seconds = Number(state.playhead).toFixed(3);
      renderTimelineMeta();
    }

    function renderRuler(width) {
      ruler.innerHTML = '';
      const step = state.zoom >= 90 ? 1 : state.zoom >= 45 ? 2 : 5;
      const total = Math.ceil(totalDuration(project.clips) + 6);
      for (let second = 0; second <= total; second += step) {
        const tick = el('div', { class: `ve-tick${second % (step * 2) === 0 ? ' is-major' : ''}` }, [
          el('span', { class: 've-tick-label', text: `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')}` }),
        ]);
        tick.style.left = `${second * state.zoom}px`;
        ruler.append(tick);
      }
      ruler.style.width = `${width}px`;
    }

    function renderTrack(kind, width) {
      const track = el('div', { class: `ve-track ve-track-${kind}` });
      track.style.width = `${width}px`;
      const items = layout(project.clips);

      if (kind === 'video') {
        if (!project.clips.length) {
          track.append(el('p', { class: 've-track-empty', text: '영상·이미지를 넣으면 여기에 쌓입니다' }));
        }
        project.clips.forEach((clip, index) => {
          const item = items[index];
          const on = state.selected && state.selected.kind === 'clip' && state.selected.id === clip.id;
          const block = el('div', {
            class: `ve-clip${on ? ' is-on' : ''}${clip.kind === 'image' ? ' is-image' : ''}`,
            role: 'button',
            tabindex: '0',
            'aria-label': `${clip.name} ${friendlyDuration(item.duration)}`,
          });
          block.style.left = `${item.start * state.zoom}px`;
          block.style.width = `${Math.max(18, item.duration * state.zoom)}px`;
          block.dataset.clipId = clip.id;
          block.dataset.start = Number(item.start).toFixed(3);
          const mediaItem = mediaOf(clip.mediaId);
          if (mediaItem && mediaItem.kind === 'image' && mediaItem.url) {
            block.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url("${mediaItem.url}")`;
            block.classList.add('has-thumb');
          }
          block.append(
            el('span', { class: 've-clip-name', text: clip.name }),
            el('span', { class: 've-clip-len', text: friendlyDuration(item.duration) }),
            el('span', { class: 've-trim ve-trim-left', 'data-trim': 'left', 'aria-hidden': 'true' }),
            el('span', { class: 've-trim ve-trim-right', 'data-trim': 'right', 'aria-hidden': 'true' }),
          );
          if (item.transition) {
            const mark = el('span', {
              class: `ve-clip-transition${item.transition.hidden ? ' is-cut' : ''}`,
              title: item.transition.hidden ? '짧은 붙임' : transitionById(item.transition.kind).label,
            });
            mark.style.left = `${-item.transition.duration * state.zoom}px`;
            mark.style.width = `${Math.max(6, item.transition.duration * state.zoom)}px`;
            block.append(mark);
          }
          if (clip.kind !== 'image' && clip.hasAudio === false) block.classList.add('is-silent');
          track.append(block);
        });
      }

      if (kind === 'subtitle') {
        if (!project.subtitles.length) {
          track.append(el('p', { class: 've-track-empty', text: '자막 트랙' }));
        }
        project.subtitles.forEach((subtitle) => {
          const on = state.selected && state.selected.kind === 'subtitle' && state.selected.id === subtitle.id;
          const block = el('div', {
            class: `ve-sub-block${on ? ' is-on' : ''}`,
            role: 'button',
            tabindex: '0',
            'aria-label': `자막 ${subtitle.text}`,
          });
          block.style.left = `${subtitle.start * state.zoom}px`;
          block.style.width = `${Math.max(16, (subtitle.end - subtitle.start) * state.zoom)}px`;
          block.dataset.subId = subtitle.id;
          block.dataset.start = Number(subtitle.start).toFixed(3);
          block.append(el('span', { class: 've-sub-block-text', text: subtitle.text }));
          block.append(el('span', { class: 've-trim ve-trim-left', 'data-trim': 'left' }));
          block.append(el('span', { class: 've-trim ve-trim-right', 'data-trim': 'right' }));
          track.append(block);
        });
      }

      if (kind === 'overlay') {
        if (!project.overlays.length) {
          track.append(el('p', { class: 've-track-empty', text: '오버레이(PIP) 트랙' }));
        }
        project.overlays.forEach((overlay) => {
          const on = state.selected && state.selected.kind === 'overlay' && state.selected.id === overlay.id;
          const block = el('div', {
            class: `ve-overlay-block${on ? ' is-on' : ''}`,
            role: 'button',
            tabindex: '0',
            'aria-label': `오버레이 ${overlay.name}`,
          });
          block.style.left = `${overlay.start * state.zoom}px`;
          block.style.width = `${Math.max(16, (overlay.end - overlay.start) * state.zoom)}px`;
          block.dataset.overlayId = overlay.id;
          block.dataset.start = Number(overlay.start).toFixed(3);
          block.append(el('span', { class: 've-sub-block-text', text: `PIP · ${overlay.name}` }));
          block.append(el('span', { class: 've-trim ve-trim-left', 'data-trim': 'left' }));
          block.append(el('span', { class: 've-trim ve-trim-right', 'data-trim': 'right' }));
          track.append(block);
        });
      }

      if (kind === 'audio') {
        if (!project.audios.length) {
          track.append(el('p', { class: 've-track-empty', text: '배경 음악 트랙' }));
        }
        project.audios.forEach((audio) => {
          const on = state.selected && state.selected.kind === 'audio' && state.selected.id === audio.id;
          const block = el('div', {
            class: `ve-audio-block${on ? ' is-on' : ''}`,
            role: 'button',
            tabindex: '0',
            'aria-label': `오디오 ${audio.name}`,
          });
          block.style.left = `${audio.start * state.zoom}px`;
          block.style.width = `${Math.max(16, audio.duration * state.zoom)}px`;
          block.dataset.audioId = audio.id;
          block.dataset.start = Number(audio.start).toFixed(3);
          block.append(el('span', { class: 've-sub-block-text', text: audio.name }));
          block.append(el('span', { class: 've-trim ve-trim-left', 'data-trim': 'left' }));
          block.append(el('span', { class: 've-trim ve-trim-right', 'data-trim': 'right' }));
          track.append(block);
        });
      }
      return track;
    }

    function renderTimeline() {
      const width = timelineWidth();
      renderRuler(width);
      trackArea.innerHTML = '';
      ['video', 'overlay', 'subtitle', 'audio'].forEach((kind) => trackArea.append(renderTrack(kind, width)));
      timelineInner.style.width = `${width}px`;
      updatePlayhead();
    }

    function renderTimelineMeta() {
      if (!timelineMeta) return;
      timelineMeta.textContent = `${timecode(state.playhead)} / ${timecode(totalDuration(project.clips))}`;
    }

    let timelineMeta = null;

    function renderToolbar() {
      timelineToolbar.innerHTML = '';
      timelineMeta = el('span', { class: 've-tl-time', text: `${timecode(state.playhead)} / ${timecode(totalDuration(project.clips))}` });
      const split = el('button', { class: 've-icon-btn', type: 'button', html: ICON_SCISSORS, 'aria-label': '클립 나누기 (S)', title: '나누기 (S)' });
      split.addEventListener('click', splitAtPlayhead);
      const remove = el('button', { class: 've-icon-btn', type: 'button', html: ICON_TRASH, 'aria-label': '고른 것 지우기 (⌫)', title: '지우기 (⌫)' });
      remove.addEventListener('click', deleteSelected);
      const undoBtn = el('button', { class: 've-icon-btn', type: 'button', html: ICON_UNDO, 'aria-label': '되돌리기 (⌘Z)', title: '되돌리기' });
      undoBtn.addEventListener('click', undo);
      const redoBtn = el('button', { class: 've-icon-btn', type: 'button', html: ICON_REDO, 'aria-label': '다시 실행 (⇧⌘Z)', title: '다시 실행' });
      redoBtn.addEventListener('click', redo);

      const zoomOut = el('button', { class: 've-icon-btn', type: 'button', html: icons.minus, 'aria-label': '타임라인 축소' });
      zoomOut.addEventListener('click', () => { state.zoom = Math.max(16, state.zoom / 1.4); renderTimeline(); });
      const zoomIn = el('button', { class: 've-icon-btn', type: 'button', html: icons.plus, 'aria-label': '타임라인 확대' });
      zoomIn.addEventListener('click', () => { state.zoom = Math.min(240, state.zoom * 1.4); renderTimeline(); });
      const zoomValue = el('span', { class: 've-zoom', text: `${Math.round(state.zoom)}px/초` });

      const snapBtn = el('button', {
        class: `ve-icon-btn${state.snap ? ' is-on' : ''}`,
        type: 'button',
        html: ICON_SNAP,
        'aria-label': '자석 스냅',
        'aria-pressed': state.snap ? 'true' : 'false',
        title: `자석 스냅 ${state.snap ? '켜짐' : '꺼짐'}`,
      });
      snapBtn.addEventListener('click', () => {
        state.snap = !state.snap;
        if (!state.snap) hideSnapGuide();
        renderToolbar();
        say(state.snap ? '자석 스냅을 켰습니다' : '자석 스냅을 껐습니다');
      });

      savedHint = el('span', { class: 've-saved' });
      renderSavedHint();

      timelineToolbar.append(
        timelineMeta,
        el('div', { class: 've-tl-group' }, [split, remove]),
        el('div', { class: 've-tl-group' }, [undoBtn, redoBtn]),
        el('div', { class: 've-tl-group' }, [snapBtn]),
        el('div', { class: 've-tl-group ve-zoom-group' }, [zoomOut, zoomValue, zoomIn]),
        savedHint,
      );
    }

    /* ------------------------------ 자석 스냅 ------------------------------ */

    /** 스냅 판정 거리 — 화면 8px 를 초로 바꾼 값. */
    function snapTolerance() {
      return SNAP_PIXELS / Math.max(1, state.zoom);
    }

    function showSnapGuide(time) {
      snapGuide.style.left = `${Number(time) * state.zoom}px`;
      snapGuide.classList.add('is-on');
    }

    function hideSnapGuide() {
      snapGuide.classList.remove('is-on');
    }

    /** 끌고 있는 항목(kind·id)을 뺀 스냅 후보. */
    function snapCandidates(kind, id) {
      return snapTargets(project, state.playhead, id);
    }

    /* ------------------------------ 비율 막대 ------------------------------ */

    function renderAspects() {
      aspectBar.innerHTML = '';
      ASPECTS.forEach((aspect) => {
        const on = project.aspect === aspect.id;
        const button = el('button', {
          class: `ve-aspect${on ? ' is-on' : ''}`,
          type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          text: aspect.label,
        });
        button.addEventListener('click', () => {
          commit();
          project.aspect = aspect.id;
          renderAspects();
          canvas.width = 0;
          drawPreview();
          say(`${aspect.label} 비율로 바꿨습니다`);
        });
        aspectBar.append(button);
      });
    }

    /* ------------------------------ 내보내기 ------------------------------ */

    function engineNotice() {
      noticeHost.innerHTML = '';
      const missing = missingNotice();
      if (missing) noticeHost.append(missing);
      if (!IS_MAC) {
        noticeHost.append(el('div', { class: 've-notice' }, [
          el('span', { class: 've-notice-text', text: '웹에서는 브라우저로 HD·FHD까지 저장합니다. 2K·4K와 빠른 인코딩은 Mac 앱에서.' }),
        ]));
        return;
      }
      const engine = state.engine;
      if (!engine || engine.available) return;
      const row = el('div', { class: 've-notice is-warn' });
      const text = el('div', { class: 've-notice-text' });
      text.append(
        el('b', { text: '고속 편집 엔진(ffmpeg)이 필요합니다. ' }),
        el('span', { text: `한 번만 내려받으면 됩니다(약 ${Math.round((engine.downloadSize || 0) / (1024 * 1024))}MB). Homebrew ffmpeg 가 있으면 그것을 씁니다.` }),
      );
      const button = el('button', { class: 've-btn ve-btn-primary', type: 'button', text: state.engineBusy ? '내려받는 중…' : '엔진 다운로드' });
      button.disabled = !!state.engineBusy;
      const bar = el('div', { class: 've-progress' }, [el('span', { style: 'width:0%' })]);
      button.addEventListener('click', async () => {
        if (state.engineBusy) return;
        state.engineBusy = true;
        engineNotice();
        try {
          const next = await invoke('video_engine_download');
          state.engine = next;
          say('편집 엔진을 준비했습니다');
        } catch (error) {
          console.error('[TIP video] 엔진', error);
          say(typeof error === 'string' ? error : '엔진을 내려받지 못했습니다', 4200);
        } finally {
          state.engineBusy = false;
          engineNotice();
        }
      });
      row.append(text, button, bar);
      noticeHost.append(row);
    }

    async function loadEngine() {
      if (!IS_MAC) {
        // 웹에서도 상단 안내를 그린다 — v1.23.0 은 여기서 그냥 돌아가 안내 띠가 사라졌다.
        engineNotice();
        return;
      }
      try {
        state.engine = await invoke('video_engine_status');
      } catch (error) {
        console.warn('[TIP video] 엔진 상태', error);
        state.engine = { available: false, downloadSize: 0 };
      }
      engineNotice();
      if (state.engine && state.engine.available) renderProps();
    }

    function exportDialog() {
      const overlay = el('div', { class: 've-modal-overlay' });
      const dialog = el('div', { class: 've-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '영상 내보내기' });
      const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = (event) => {
        if (event.key === 'Escape' && !state.exporting) { event.preventDefault(); close(); }
      };

      const resolution = el('select', { class: 've-select', 'aria-label': '해상도' });
      RESOLUTIONS.forEach((item) => {
        const disabled = item.macOnly && !IS_MAC;
        const option = el('option', {
          value: item.id,
          text: `${item.label}${disabled ? ' (Mac 앱)' : ''}`,
        });
        if (disabled) option.disabled = true;
        if (item.id === 'fhd') option.selected = true;
        resolution.append(option);
      });

      const fps = el('select', { class: 've-select', 'aria-label': '프레임' });
      FPS_OPTIONS.forEach((value) => {
        const option = el('option', { value: String(value), text: `${value}fps` });
        if (value === 30) option.selected = true;
        fps.append(option);
      });

      const aspect = el('select', { class: 've-select', 'aria-label': '비율' });
      ASPECTS.forEach((item) => {
        const option = el('option', { value: item.id, text: item.label });
        if (item.id === project.aspect) option.selected = true;
        aspect.append(option);
      });

      const summary = el('p', { class: 've-hint' });
      const updateSummary = () => {
        const res = RESOLUTIONS.find((item) => item.id === resolution.value) || RESOLUTIONS[1];
        const size = outputSize(aspect.value, res.height);
        summary.textContent = `${size.width}×${size.height} · ${fps.value}fps · ${friendlyDuration(totalDuration(project.clips))} · 자막 ${project.subtitles.length}개`;
      };
      resolution.addEventListener('change', updateSummary);
      fps.addEventListener('change', updateSummary);
      aspect.addEventListener('change', updateSummary);
      updateSummary();

      const progressBar = el('div', { class: 've-progress' }, [el('span', { style: 'width:0%' })]);
      const progressText = el('p', { class: 've-hint', text: '' });
      const actions = el('div', { class: 've-modal-actions' });
      const cancel = el('button', { class: 've-btn', type: 'button', text: '취소' });
      cancel.addEventListener('click', () => { if (!state.exporting) close(); });
      const start = el('button', { class: 've-btn ve-btn-primary', type: 'button', text: '내보내기' });
      actions.append(cancel, start);

      const runExport = async () => {
        if (!project.clips.length) { say('타임라인이 비어 있습니다'); return; }
        if (!IS_MAC) {
          // 웹 — 최대 FHD
          const res = RESOLUTIONS.find((item) => item.id === resolution.value) || RESOLUTIONS[1];
          if (res.macOnly) return;
          state.exporting = true;
          start.disabled = true;
          cancel.textContent = '중단';
          await exportWeb({ height: res.height, aspect: aspect.value, fps: Number(fps.value) }, progressBar, progressText);
          state.exporting = false;
          start.disabled = false;
          cancel.textContent = '취소';
          return;
        }

        const missing = project.clips.find((clip) => {
          const item = mediaOf(clip.mediaId);
          return !item || !item.path;
        }) || project.overlays.find((overlay) => {
          const item = mediaOf(overlay.mediaId);
          return !item || !item.path;
        });
        if (missing) {
          say('Mac 에서는 파일 선택 창으로 넣은 파일만 내보낼 수 있습니다');
          return;
        }
        const res = RESOLUTIONS.find((item) => item.id === resolution.value) || RESOLUTIONS[1];
        const size = outputSize(aspect.value, res.height);
        const stamp = new Date();
        const name = `TIP-편집-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}.mp4`;
        let output = null;
        try {
          output = await invoke('video_save_path', { name });
        } catch (error) {
          console.warn('[TIP video] 저장 위치', error);
        }
        if (!output) return;

        state.exporting = true;
        start.disabled = true;
        cancel.textContent = '중단';
        const spec = {
          clips: project.clips.map((clip) => {
            const item = mediaOf(clip.mediaId);
            return {
              path: item.path,
              kind: clip.kind,
              trimStart: Number(clip.trimStart) || 0,
              trimEnd: Number(clip.trimEnd) || 0,
              speed: Number(clip.speed) || 1,
              volume: Number(clip.volume) || 1,
              fadeIn: Number(clip.fadeIn) || 0,
              fadeOut: Number(clip.fadeOut) || 0,
              brightness: (Number(clip.filter.brightness) || 1) - 1,
              contrast: Number(clip.filter.contrast) || 1,
              saturation: clip.filter.saturation === undefined ? 1 : Number(clip.filter.saturation),
              motion: clip.motion && clip.motion.kind && clip.motion.kind !== 'none' ? {
                kind: clip.motion.kind,
                startScale: Number(clip.motion.startScale) || 1,
                endScale: Number(clip.motion.endScale) || 1,
                startX: clip.motion.startX === undefined ? 0.5 : Number(clip.motion.startX),
                startY: clip.motion.startY === undefined ? 0.5 : Number(clip.motion.startY),
                endX: clip.motion.endX === undefined ? 0.5 : Number(clip.motion.endX),
                endY: clip.motion.endY === undefined ? 0.5 : Number(clip.motion.endY),
              } : null,
              transition: clip.transition ? {
                kind: clip.transition.kind,
                duration: Number(clip.transition.duration) || 0,
              } : null,
            };
          }),
          overlays: project.overlays.map((overlay) => {
            const item = mediaOf(overlay.mediaId);
            return {
              path: item ? item.path : '',
              kind: overlay.kind === 'image' ? 'image' : 'video',
              start: Number(overlay.start) || 0,
              end: Number(overlay.end) || 0,
              x: overlay.x,
              y: overlay.y,
              scale: overlay.scale,
              opacity: overlay.opacity === undefined ? 1 : Number(overlay.opacity),
            };
          }).filter((overlay) => overlay.path),
          subtitles: project.subtitles.map((subtitle) => ({
            text: subtitle.text,
            start: subtitle.start,
            end: subtitle.end,
            font: subtitle.font,
            fontFile: subtitle.fontFile || null,
            fontSize: subtitle.size,
            color: subtitle.color,
            outlineColor: subtitle.outlineColor,
            outlineWidth: subtitle.outlineWidth,
            background: subtitle.background,
            animation: subtitle.animation || 'none',
            x: subtitle.x,
            y: subtitle.y,
          })),
          audios: project.audios.map((audio) => {
            const item = mediaOf(audio.mediaId);
            return {
              path: audio.path || (item && item.path) || '',
              start: audio.start,
              volume: audio.volume,
              fadeIn: audio.fadeIn,
              fadeOut: audio.fadeOut,
              duration: audio.duration,
            };
          }).filter((audio) => audio.path),
          width: size.width,
          height: size.height,
          fps: Number(fps.value),
          output,
        };

        progressText.textContent = '편집 엔진을 준비하는 중…';
        try {
          const result = await invoke('video_export', { spec });
          progressBar.firstChild.style.width = '100%';
          progressText.textContent = `저장했습니다 · ${result && result.path ? result.path.split('/').pop() : ''}`;
          say('영상을 저장했습니다');
          if (result && result.path) {
            const reveal = el('button', { class: 've-btn', type: 'button', text: 'Finder 에서 보기' });
            reveal.addEventListener('click', () => invoke('video_reveal', { path: result.path }).catch(() => {}));
            actions.prepend(reveal);
          }
          start.textContent = '닫기';
          start.disabled = false;
          start.removeEventListener('click', runExport);
          start.addEventListener('click', close);
        } catch (error) {
          console.error('[TIP video] 내보내기', error);
          progressText.textContent = typeof error === 'string' ? error : '내보내지 못했습니다';
          start.disabled = false;
        } finally {
          state.exporting = false;
          cancel.textContent = '취소';
        }
      };
      start.addEventListener('click', runExport);

      cancel.addEventListener('click', () => {
        if (state.exporting && IS_MAC) {
          invoke('video_cancel_export').catch(() => {});
          progressText.textContent = '취소하는 중…';
        }
      });

      dialog.append(
        el('div', { class: 've-modal-head' }, [
          el('h2', { text: '영상 내보내기' }),
          (() => {
            const button = el('button', { class: 've-icon-btn', type: 'button', html: icons.close, 'aria-label': '닫기' });
            button.addEventListener('click', () => { if (!state.exporting) close(); });
            return button;
          })(),
        ]),
        el('div', { class: 've-modal-body' }, [
          field('해상도', resolution),
          field('프레임', fps),
          field('비율', aspect),
          summary,
          progressBar,
          progressText,
        ]),
        actions,
      );
      overlay.append(dialog);
      document.body.append(overlay);
      document.addEventListener('keydown', onKey, true);
      start.focus();
    }

    /* ------------------------------ 자동 자막(whisper.cpp) ------------------------------ */

    const WHISPER_LANGUAGES = [
      { id: 'auto', label: '자동 감지' },
      { id: 'ko', label: '한국어' },
      { id: 'en', label: '영어' },
      { id: 'ja', label: '일본어' },
      { id: 'zh', label: '중국어' },
    ];

    /** 받아 적을 클립 목록 — 전체 타임라인 또는 고른 클립 하나. 음성이 없는 이미지는 뻐긴다. */
    function transcribeClips(scope) {
      const source = scope === 'clip' && state.selected && state.selected.kind === 'clip'
        ? [clipOf(state.selected.id)].filter(Boolean)
        : project.clips;
      return source
        .filter((clip) => clip.kind !== 'image')
        .map((clip) => {
          const item = mediaOf(clip.mediaId);
          return item && item.path ? {
            path: item.path,
            trimStart: Number(clip.trimStart) || 0,
            trimEnd: Number(clip.trimEnd) || 0,
            speed: Number(clip.speed) || 1,
          } : null;
        })
        .filter(Boolean);
    }

    function whisperDialog() {
      const overlay = el('div', { class: 've-modal-overlay' });
      const dialog = el('div', { class: 've-modal ve-whisper', role: 'dialog', 'aria-modal': 'true', 'aria-label': '음성으로 자동 자막' });
      const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = (event) => {
        if (event.key === 'Escape' && !state.whisperBusy) { event.preventDefault(); close(); }
      };

      const language = el('select', { class: 've-select', 'aria-label': '언어' });
      WHISPER_LANGUAGES.forEach((item) => {
        const option = el('option', { value: item.id, text: item.label });
        if (item.id === 'ko') option.selected = true;
        language.append(option);
      });

      const scope = el('select', { class: 've-select', 'aria-label': '범위' });
      const whole = el('option', { value: 'all', text: `타임라인 전체 (${transcribeClips('all').length}개 클립)` });
      scope.append(whole);
      const selectedClip = state.selected && state.selected.kind === 'clip' ? clipOf(state.selected.id) : null;
      if (selectedClip && selectedClip.kind !== 'image') {
        const one = el('option', { value: 'clip', text: `고른 클립: ${selectedClip.name}` });
        scope.append(one);
      }

      const ready = !!(state.whisper && state.whisper.available);
      const sizeMb = Math.round(((state.whisper && state.whisper.downloadSize) || 150 * 1024 * 1024) / (1024 * 1024));
      const status = el('p', {
        class: 've-hint',
        text: ready
          ? `받아 적기 엔진 준비됨. ${(state.whisper && state.whisper.model) || 'ggml-base'} 모델을 Mac 안에서만 씁니다.`
          : `처음 한 번 whisper.cpp 엔진과 한국어 모델(약 ${sizeMb}MB)을 내려받습니다. 내려받은 뒤에는 인터넷 없이도 됩니다.`,
      });
      const bar = el('div', { class: 've-progress' }, [el('span', { style: 'width:0%' })]);
      const progressText = el('p', { class: 've-hint', text: '' });

      const actions = el('div', { class: 've-modal-actions' });
      const cancel = el('button', { class: 've-btn', type: 'button', text: '취소' });
      cancel.addEventListener('click', () => {
        if (state.whisperBusy) {
          invoke('video_cancel_transcribe').catch(() => {});
          progressText.textContent = '취소하는 중…';
          return;
        }
        close();
      });
      const download = el('button', { class: 've-btn', type: 'button', text: `엔진 받기 (약 ${sizeMb}MB)` });
      download.hidden = ready;
      download.addEventListener('click', async () => {
        download.disabled = true;
        progressText.textContent = '내려받는 중…';
        try {
          state.whisper = await invoke('video_whisper_download');
          say('자동 자막 엔진을 준비했습니다');
          progressText.textContent = '준비되었습니다';
          status.textContent = '받아 적기 엔진 준비됨. ggml-base 모델을 Mac 안에서만 씁니다.';
          start.disabled = false;
        } catch (error) {
          console.warn('[TIP video] whisper 다운로드', error);
          progressText.textContent = typeof error === 'string' ? error : '엔진을 내려받지 못했습니다';
        } finally {
          download.disabled = false;
        }
      });
      const start = el('button', { class: 've-btn ve-btn-primary', type: 'button', text: '자막 만들기' });
      start.disabled = !ready;
      actions.append(cancel, download, start);

      const run = async () => {
        const clips = transcribeClips(scope.value);
        if (!clips.length) { progressText.textContent = '받아 적을 영상이 없습니다'; return; }
        state.whisperBusy = true;
        start.disabled = true;
        cancel.textContent = '중단';
        progressText.textContent = '소리를 뽑는 중…';
        bar.firstChild.style.width = '2%';
        try {
          const result = await invoke('video_transcribe', {
            spec: { clips, language: language.value },
          });
          const segments = (result && result.segments) || [];
          if (!segments.length) {
            progressText.textContent = '알아들은 말이 없습니다'; return;
          }
          commit();
          const offset = project.clips.length ? layout(project.clips)[0].start : 0;
          const created = segments.map((segment) => {
            const subtitle = createSubtitle(String(segment.text || '').trim(), offset + Number(segment.start || 0), offset + Number(segment.end || 0));
            applySubtitlePreset(subtitle, state.defaultPreset);
            subtitle.animation = 'none';
            return subtitle;
          }).filter((subtitle) => subtitle.text && subtitle.end > subtitle.start + 0.05);
          created.forEach((subtitle) => project.subtitles.push(subtitle));
          if (created.length) {
            state.selected = { kind: 'subtitle', id: created[0].id };
            seek(created[0].start);
          }
          refreshAll();
          bar.firstChild.style.width = '100%';
          progressText.textContent = `자막 ${created.length}개를 만들었습니다`;
          say(`자막 ${created.length}개를 만들었습니다`);
          start.textContent = '닫기';
          start.disabled = false;
          start.removeEventListener('click', run);
          start.addEventListener('click', close);
        } catch (error) {
          console.warn('[TIP video] 자동 자막', error);
          progressText.textContent = typeof error === 'string' ? error : '자막을 만들지 못했습니다';
          start.disabled = false;
        } finally {
          state.whisperBusy = false;
          cancel.textContent = '취소';
        }
      };
      start.addEventListener('click', run);

      dialog.append(
        el('div', { class: 've-modal-head' }, [
          el('h2', { text: '음성으로 자동 자막' }),
          (() => {
            const button = el('button', { class: 've-icon-btn', type: 'button', html: icons.close, 'aria-label': '닫기' });
            button.addEventListener('click', () => { if (!state.whisperBusy) close(); });
            return button;
          })(),
        ]),
        el('div', { class: 've-modal-body' }, [
          field('언어', language),
          field('범위', scope),
          status,
          bar,
          progressText,
        ]),
        actions,
      );
      overlay.append(dialog);
      document.body.append(overlay);
      document.addEventListener('keydown', onKey, true);
      start.focus();
    }

    async function loadWhisper() {
      if (!IS_MAC) return;
      try {
        state.whisper = await invoke('video_whisper_status');
      } catch (error) {
        console.warn('[TIP video] whisper 상태', error);
        state.whisper = { available: false, downloadSize: 150 * 1024 * 1024 };
      }
    }

    /* ------------------------------ 웹 내보내기 ------------------------------ */

    async function exportWeb({ height, aspect, fps }, bar, text) {
      const size = outputSize(aspect, height);
      const canvasEl = document.createElement('canvas');
      canvasEl.width = size.width;
      canvasEl.height = size.height;
      const context = canvasEl.getContext('2d');
      const total = totalDuration(project.clips);
      if (!total) { say('타임라인이 비어 있습니다'); return; }

      text.textContent = '준비 중…';
      const stream = canvasEl.captureStream(fps);
      let audioTrack = null;
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        recordDest = audioCtx.createMediaStreamDestination();
        for (const item of media.values()) {
          if (item.kind === 'audio' || item.kind === 'video') {
            const entry = elementFor(item);
            if (entry && entry.node && !elementSources.has(item.id)) {
              try {
                const source = audioCtx.createMediaElementSource(entry.node);
                const gain = audioCtx.createGain();
                gain.gain.value = 1;
                source.connect(gain);
                gain.connect(audioCtx.destination);
                elementSources.set(item.id, { source, gain });
              } catch { /* 이미 연결된 요소 */ }
            }
            const pair = elementSources.get(item.id);
            if (pair) pair.gain.connect(recordDest);
          }
        }
        audioTrack = recordDest.stream.getAudioTracks()[0] || null;
        if (audioTrack) stream.addTrack(audioTrack);
      } catch (error) {
        console.warn('[TIP video] 웹 오디오', error);
      }

      const mime = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm'].find((candidate) => {
        try { return MediaRecorder.isTypeSupported(candidate); } catch { return false; }
      }) || '';
      let recorder;
      try {
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      } catch (error) {
        console.warn('[TIP video] MediaRecorder', error);
        say('이 브라우저에서는 녹화 저장을 할 수 없습니다');
        return;
      }
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      const finished = new Promise((resolve) => { recorder.onstop = () => resolve(); });

      state.playhead = 0;
      state.playing = false;
      drawScene(context, size.width, size.height, 0);
      recorder.start(250);
      const startedAt = performance.now();
      state.playing = true;
      syncMedia(0);

      await new Promise((resolve) => {
        const step = () => {
          const elapsed = (performance.now() - startedAt) / 1000;
          state.playhead = Math.min(elapsed, total);
          syncMedia(state.playhead);
          drawScene(context, size.width, size.height, state.playhead);
          bar.firstChild.style.width = `${Math.min(100, (state.playhead / total) * 100)}%`;
          text.textContent = `${timecode(state.playhead)} / ${timecode(total)} 저장 중…`;
          if (state.playhead >= total) { resolve(); return; }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });

      state.playing = false;
      for (const item of media.values()) {
        const entry = elements.get(item.id);
        if (entry && entry.node && entry.node.pause) entry.node.pause();
      }
      recorder.stop();
      await finished;
      if (audioTrack) stream.removeTrack(audioTrack);
      const blob = new Blob(chunks, { type: mime || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = mime.includes('mp4') ? 'TIP-편집.mp4' : 'TIP-편집.webm';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      text.textContent = `저장했습니다 · ${formatBytes(blob.size)}`;
      bar.firstChild.style.width = '100%';
    }

    /* ------------------------------ 상태 반영 ------------------------------ */

    function refreshAll() {
      renderLeft();
      renderProps();
      renderToolbar();
      renderAspects();
      renderTimeline();
      drawPreview();
      engineNotice();
      scheduleSave();
    }

    /* ------------------------------ 입력 ------------------------------ */

    playBtn.addEventListener('click', togglePlay);

    shell.querySelector('.ve-export-btn').addEventListener('click', () => {
      if (state.exporting) { say('내보내는 중입니다'); return; }
      exportDialog();
    });

    // 타임라인 조작 — 누르고 끌기
    let drag = null;

    function timeFromEvent(event) {
      const rect = timelineInner.getBoundingClientRect();
      const x = event.clientX - rect.left;
      return Math.max(0, x / state.zoom);
    }

    timelineScroll.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const clipBlock = target.closest('[data-clip-id]');
      const subBlock = target.closest('[data-sub-id]');
      const audioBlock = target.closest('[data-audio-id]');
      const overlayBlock = target.closest('[data-overlay-id]');
      const trim = target.closest('[data-trim]');

      if (clipBlock || subBlock || audioBlock || overlayBlock) {
        const kind = clipBlock ? 'clip' : subBlock ? 'subtitle' : audioBlock ? 'audio' : 'overlay';
        const id = clipBlock ? clipBlock.dataset.clipId
          : subBlock ? subBlock.dataset.subId
            : audioBlock ? audioBlock.dataset.audioId
              : overlayBlock.dataset.overlayId;
        state.selected = { kind, id };
        const blockEl = clipBlock || subBlock || audioBlock || overlayBlock;
        if (trim) {
          const side = trim.dataset.trim;
          const clip = kind === 'clip' ? clipOf(id) : null;
          const subtitle = kind === 'subtitle' ? subtitleOf(id) : null;
          const audio = kind === 'audio' ? audioOf(id) : null;
          const overlay = kind === 'overlay' ? overlayOf(id) : null;
          drag = { mode: 'trim', kind, id, side, startX: event.clientX, clip, subtitle, audio, overlay };
          commit();
        } else {
          const item = itemOf(kind, id);
          drag = {
            mode: 'move',
            kind,
            id,
            startX: event.clientX,
            original: JSON.parse(JSON.stringify(item)),
            index: clipBlock ? project.clips.findIndex((clip) => clip.id === id) : -1,
            moved: false,
          };
        }
        blockEl.setPointerCapture?.(event.pointerId);
        // 여기서 타임라인을 통째로 다시 그리면 방금 잡은 포인터가 붙어 있던 요소가 사라져
        // 끌기가 첫 줌에 끊긴다. 선택 표시만 바꾸고 다시 그리기는 pointermove 에 맡긴다.
        timelineScroll.querySelectorAll('.is-on').forEach((node) => node.classList.remove('is-on'));
        blockEl.classList.add('is-on');
        renderProps();
        drawPreview();
        event.preventDefault();
        return;
      }

      // 빈 곳 — 플레이헤드 옮기기
      if (target.closest('.ve-ruler') || target.closest('.ve-track') || target === timelineInner) {
        drag = { mode: 'seek' };
        seek(timeFromEvent(event));
        event.preventDefault();
      }
    });

    // 끌기는 window 에서 받는다 — 움직일 때마다 타임라인을 다시 그리므로(블록이 새로 만들어짐)
    // timelineScroll 에만 걸어 두면 포인터 캡처가 붙은 요소가 사라져 이벤트가 끊긴다.
    window.addEventListener('pointermove', (event) => {
      if (!drag) return;
      if (drag.mode === 'seek') {
        seek(timeFromEvent(event));
        return;
      }
      const deltaX = event.clientX - drag.startX;
      const deltaSeconds = deltaX / state.zoom;

      if (drag.mode === 'move') {
        if (Math.abs(deltaX) > 3 && !drag.moved) {
          drag.moved = true;
          // 처음 움직이는 순간의 모습을 남긴다 — 끌어 옮긴 것도 ⌘Z 로 되돌린다.
          commit();
        }
        if (drag.kind === 'clip' && drag.moved) {
          // 순서 바꾸기 — 옮긴 x 가 이웃 클립의 가운데를 넘으면 자리를 바꾼다.
          const items = layout(project.clips);
          const self = items[drag.index];
          const center = (self.start + self.end) / 2 + deltaSeconds;
          let target = drag.index;
          if (deltaSeconds < 0 && drag.index > 0) {
            const before = items[drag.index - 1];
            if (center < (before.start + before.end) / 2) target = drag.index - 1;
          } else if (deltaSeconds > 0 && drag.index < project.clips.length - 1) {
            const after = items[drag.index + 1];
            if (center > (after.start + after.end) / 2) target = drag.index + 1;
          }
          if (target !== drag.index) {
            const [clip] = project.clips.splice(drag.index, 1);
            project.clips.splice(target, 0, clip);
            drag.index = target;
            drag.startX = event.clientX;
            renderLeft();
            renderTimeline();
            drawPreview();
          }
        } else if (drag.kind === 'subtitle') {
          const subtitle = subtitleOf(drag.id);
          if (subtitle) {
            const span = drag.original.end - drag.original.start;
            let start = Math.max(0, drag.original.start + deltaSeconds);
            if (state.snap) {
              const result = snapRange(start, start + span, snapCandidates('subtitle', drag.id), snapTolerance());
              if (result.snapped !== null && result.snapped !== undefined) {
                start = Math.max(0, result.start);
                showSnapGuide(result.snapped);
              } else hideSnapGuide();
            } else hideSnapGuide();
            subtitle.start = start;
            subtitle.end = start + span;
            renderTimeline();
            drawPreview();
          }
        } else if (drag.kind === 'overlay') {
          const overlay = overlayOf(drag.id);
          if (overlay) {
            const span = drag.original.end - drag.original.start;
            let start = Math.max(0, drag.original.start + deltaSeconds);
            if (state.snap) {
              const result = snapRange(start, start + span, snapCandidates('overlay', drag.id), snapTolerance());
              if (result.snapped !== null && result.snapped !== undefined) {
                start = Math.max(0, result.start);
                showSnapGuide(result.snapped);
              } else hideSnapGuide();
            } else hideSnapGuide();
            overlay.start = start;
            overlay.end = start + span;
            renderTimeline();
            drawPreview();
          }
        } else if (drag.kind === 'audio') {
          const audio = audioOf(drag.id);
          if (audio) {
            let start = Math.max(0, drag.original.start + deltaSeconds);
            const span = Number(drag.original.duration) || 1;
            if (state.snap) {
              const result = snapRange(start, start + span, snapCandidates('audio', drag.id), snapTolerance());
              if (result.snapped !== null && result.snapped !== undefined) {
                start = Math.max(0, result.start);
                showSnapGuide(result.snapped);
              } else hideSnapGuide();
            } else hideSnapGuide();
            audio.start = start;
          }
          renderTimeline();
          drawPreview();
        }
        return;
      }

      if (drag.mode === 'trim') {
        if (drag.kind === 'clip' && drag.clip) {
          const clip = drag.clip;
          if (drag.side === 'left') {
            const speed = clip.kind === 'image' ? 1 : (Number(clip.speed) || 1);
            clip.trimStart = Math.max(0, Math.min(Number(clip.trimEnd) - 0.2, Number(drag.original.trimStart) + deltaSeconds * speed));
          } else if (clip.kind === 'image') {
            clip.trimEnd = Math.max(Number(clip.trimStart) + 0.2, Number(drag.original.trimEnd) + deltaSeconds);
          } else {
            const speed = Number(clip.speed) || 1;
            const max = Number(clip.sourceDuration) || Number(drag.original.trimEnd);
            clip.trimEnd = Math.max(Number(clip.trimStart) + 0.2, Math.min(max, Number(drag.original.trimEnd) + deltaSeconds * speed));
          }
          renderTimeline();
          drawPreview();
        } else if (drag.kind === 'subtitle' && drag.subtitle) {
          const subtitle = drag.subtitle;
          const targets = snapCandidates('subtitle', drag.id);
          const tolerance = snapTolerance();
          if (drag.side === 'left') {
            let start = Math.max(0, Math.min(subtitle.end - 0.2, drag.original.start + deltaSeconds));
            if (state.snap) {
              const result = snapTime(start, targets, tolerance);
              if (result.snapped) { start = Math.max(0, Math.min(subtitle.end - 0.2, result.value)); showSnapGuide(result.value); }
              else hideSnapGuide();
            }
            subtitle.start = start;
          } else {
            let end = Math.max(subtitle.start + 0.2, drag.original.end + deltaSeconds);
            if (state.snap) {
              const result = snapTime(end, targets, tolerance);
              if (result.snapped) { end = Math.max(subtitle.start + 0.2, result.value); showSnapGuide(result.value); }
              else hideSnapGuide();
            }
            subtitle.end = end;
          }
          renderTimeline();
          drawPreview();
        } else if (drag.kind === 'overlay' && drag.overlay) {
          const overlay = drag.overlay;
          const targets = snapCandidates('overlay', drag.id);
          const tolerance = snapTolerance();
          if (drag.side === 'left') {
            let start = Math.max(0, Math.min(overlay.end - 0.2, drag.original.start + deltaSeconds));
            if (state.snap) {
              const result = snapTime(start, targets, tolerance);
              if (result.snapped) { start = Math.max(0, Math.min(overlay.end - 0.2, result.value)); showSnapGuide(result.value); }
              else hideSnapGuide();
            }
            overlay.start = start;
          } else {
            let end = Math.max(overlay.start + 0.2, drag.original.end + deltaSeconds);
            if (state.snap) {
              const result = snapTime(end, targets, tolerance);
              if (result.snapped) { end = Math.max(overlay.start + 0.2, result.value); showSnapGuide(result.value); }
              else hideSnapGuide();
            }
            overlay.end = end;
          }
          renderTimeline();
          drawPreview();
        } else if (drag.kind === 'audio' && drag.audio) {
          const audio = drag.audio;
          if (drag.side === 'right') {
            let end = Math.max(0.3, drag.original.duration + deltaSeconds);
            if (state.snap) {
              const result = snapTime(audio.start + end, snapCandidates('audio', drag.id), snapTolerance());
              if (result.snapped) { end = Math.max(0.3, result.value - audio.start); showSnapGuide(result.value); }
              else hideSnapGuide();
            }
            audio.duration = end;
          }
          renderTimeline();
          drawPreview();
        }
      }
    });

    const endDrag = (event) => {
      if (!drag) return;
      // 클립을 끌지 않고 그냥 눌렀으면 그 자리로 플레이헤드를 옮긴다(캡컷과 같은 감각).
      const tapped = drag.mode === 'move' && !drag.moved;
      hideSnapGuide();
      if (drag.mode !== 'seek') {
        renderLeft();
        renderProps();
        renderTimeline();
        drawPreview();
        if (tapped && event) seek(timeFromEvent(event));
      }
      drag = null;
    };
    window.addEventListener('pointerup', (event) => endDrag(event), { signal });
    window.addEventListener('pointercancel', (event) => endDrag(event), { signal });

    // 미리보기에서 자막·오버레이 끌기
    let subDrag = null;
    let overlayDrag = null;
    canvas.addEventListener('pointerdown', (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      const overlayHit = overlayBoxes.find((box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
      if (overlayHit) {
        state.selected = { kind: 'overlay', id: overlayHit.overlay.id };
        overlayDrag = {
          overlay: overlayHit.overlay,
          offsetX: x - (overlayHit.x + overlayHit.width / 2),
          offsetY: y - (overlayHit.y + overlayHit.height / 2),
          width: canvas.width,
          height: canvas.height,
        };
        commit();
        renderProps();
        drawPreview();
        canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        return;
      }
      const hit = subBoxes.find((box) => Math.abs(x - box.x) < box.width / 2 && Math.abs(y - box.y) < box.height / 2);
      if (!hit) return;
      state.selected = { kind: 'subtitle', id: hit.subtitle.id };
      subDrag = {
        subtitle: hit.subtitle,
        offsetX: x - hit.x,
        offsetY: y - hit.y,
        width: canvas.width,
        height: canvas.height,
      };
      commit();
      renderProps();
      drawPreview();
      canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!subDrag && !overlayDrag) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      if (overlayDrag) {
        overlayDrag.overlay.x = Math.min(1, Math.max(0, (x - overlayDrag.offsetX) / overlayDrag.width));
        overlayDrag.overlay.y = Math.min(1, Math.max(0, (y - overlayDrag.offsetY) / overlayDrag.height));
        drawPreview();
        return;
      }
      subDrag.subtitle.x = Math.min(1, Math.max(0, (x - subDrag.offsetX) / subDrag.width));
      subDrag.subtitle.y = Math.min(1, Math.max(0, (y - subDrag.offsetY) / subDrag.height));
      drawPreview();
    });
    canvas.addEventListener('pointerup', () => {
      if (!subDrag && !overlayDrag) return;
      subDrag = null;
      overlayDrag = null;
      renderProps();
      renderTimeline();
    });

    // 키보드 — 입력칸에 있을 때는 가로채지 않는다.
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing) return;
      if (!root.isConnected) return;
      const meta = event.metaKey || event.ctrlKey;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === 's' || event.key === 'S' || (meta && event.key.toLowerCase() === 'b')) {
        event.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }
      if (meta && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }
      if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        // ←/→ 는 한 프레임(1/30초), ⇧를 누르면 0.5초.
        const step = event.shiftKey ? 0.5 : FRAME_STEP;
        seek(state.playhead + (event.key === 'ArrowRight' ? step : -step));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        seek(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        seek(totalDuration(project.clips));
      }
    };
    document.addEventListener('keydown', onKeyDown, { signal });

    // Tauri 이벤트 — 진행률·엔진 다운로드.
    if (EVENT) {
      EVENT.listen('tip://video-export-progress', (event) => {
        const payload = event && event.payload ? event.payload : {};
        const bar = document.querySelector('.ve-modal .ve-progress span');
        const label = document.querySelectorAll('.ve-modal .ve-hint');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(payload.percent) || 0))}%`;
        if (label && label.length) {
          const last = label[label.length - 1];
          if (payload.stage === 'encoding') last.textContent = `${timecode(payload.time || 0)} / ${timecode(payload.total || 0)} 인코딩 중…`;
        }
      });
      EVENT.listen('tip://video-engine-progress', (event) => {
        const payload = event && event.payload ? event.payload : {};
        const bar = noticeHost.querySelector('.ve-progress span');
        if (bar && typeof payload.percent === 'number') bar.style.width = `${Math.min(100, payload.percent)}%`;
      });
      EVENT.listen('tip://video-whisper-progress', (event) => {
        const payload = event && event.payload ? event.payload : {};
        const bar = document.querySelector('.ve-whisper .ve-progress span');
        if (bar && typeof payload.percent === 'number') bar.style.width = `${Math.max(0, Math.min(100, payload.percent))}%`;
        const hints = document.querySelectorAll('.ve-whisper .ve-hint');
        if (hints.length && payload.stage === 'transcribe') {
          hints[hints.length - 1].textContent = `받아 적는 중… ${Math.round(payload.percent || 0)}%`;
        }
      });
      EVENT.listen('tip://video-export-done', (event) => {
        const payload = event && event.payload ? event.payload : {};
        if (payload.ok) return;
        if (payload.canceled) say('내보내기를 취소했습니다');
      });
      // 단축키로 모듈 창이 다시 열리면 화면을 새로 그린다(창은 살아 있다).
      EVENT.listen('tip://open-module', (event) => {
        if (event && event.payload === 'video-editor') {
          engineNotice();
          drawPreview();
        }
      });
    }

    // 창 크기가 바뀌면 미리보기도 따라간다.
    const onResize = () => { drawPreview(); };
    window.addEventListener('resize', onResize, { signal });

    /* ------------------------------ 시작 ------------------------------ */

    renderToolbar();
    renderAspects();
    refreshAll();
    loadEngine();
    loadWhisper();
    offerResume();

    return () => {
      controller.abort();
      cancelAnimationFrame(rafId);
      clearTimeout(saveTimer);
      state.playing = false;
      for (const entry of elements.values()) {
        if (entry && entry.node) {
          if (entry.node.pause) entry.node.pause();
          if (entry.node instanceof HTMLVideoElement && entry.node.parentNode) entry.node.remove();
        }
      }
      for (const item of media.values()) {
        if (item.url) URL.revokeObjectURL(item.url);
      }
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
      window.removeEventListener('resize', onResize);
    };
  },
};

export default module;
