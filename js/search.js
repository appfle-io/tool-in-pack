/* TIP · 전역 빠른 실행 검색 (v1.12.0 → v1.14.0 Spotlight 확장)
 *
 * macOS 앱에서 전역 단축키(기본 Alt+Space)로 열리는 작은 창.
 * v1.14.0 에서 찾는 것과 할 수 있는 일이 늘었다.
 *   · TIP 모듈 (이름·키워드·한글 초성)
 *   · 맥 앱 (/Applications 의 .app — 한글 초성 ㅋㄹ → 크롬)
 *   · 로컬 파일 (mdfind, 홈 폴더 이름 검색)
 *   · 즉석 계산기 (12800*1.1 → 14,080, Enter 로 복사)
 *   · 웹 검색 (g·n 접두어, 또는 결과 아래 Google·Naver 줄)
 *   · 스니펫 (/별칭), 시스템 명령 (잠금·잠자기·다크 모드 …)
 * 검색어와 결과는 이 기기 안에서만 쓰인다.
 */

import { listModules, categoryOf, CATEGORIES } from '../modules/registry.js';
import { moduleState, syncStore } from './store.js';
import { calculate } from './calc.js';
import { koreanRank } from './chosung.js';
import { findSnippets, snippetPreview } from './snippets.js';
import {
  searchScopeEnabled, getSystemCommandEnabled, filesNoticePending, markFilesNoticeShown,
} from './feature-settings.js';
import {
  parseTimerQuery, startTimer, timerState, remainingSeconds, formatClock, describeSeconds, TIMER_PRESETS,
} from './timer-store.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

const inputEl = document.getElementById('palette-input');
const listEl = document.getElementById('palette-list');
const emptyEl = document.getElementById('palette-empty');
const statusEl = document.getElementById('palette-status');

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(({ id, label }) => [id, label]));

/** 검색어 보강 — 모듈 이름에 없는 흔한 말로도 찾히게. */
const KEYWORDS = {
  'doc-reader': 'pdf hwp hwpx 문서 뷰어 열기 읽기',
  'clipboard-history': '클립보드 복사 히스토리 클립 이미지 텍스트',
  'address-search': '주소 우편번호 도로명 영문 해외 검색 변환',
  'parcel-tracker': '배송 택배 송장 운송장 조회 추적 배달',
  'img-converter': '이미지 사진 변환 포맷 png jpg webp heic 리사이즈',
  'pdf-tools': 'pdf 합치기 병합 추출 페이지 자르기',
  'md-editor': '마크다운 메모 작성 md 에디터',
  'photo-privacy': '모자이크 블러 위치정보 gps exif 사진 개인정보',
  'qr-gen': 'qr 큐알 코드 와이파이 링크 생성',
  'video-gif': '동영상 영상 gif 자르기 클립 변환',
  'video-mosaic': '영상 모자이크 얼굴 가리기',
  'dev-tools': '개발 json base64 해시 인코딩 디코딩',
  'text-diff': '텍스트 비교 diff 차이',
  'regex-tester': '정규식 regex 테스트',
  'color-tools': '색 색상 컬러 팔레트 변환 대비',
  'icon-gen': '아이콘 icns ico 파비콘 생성',
  'ocr-reader': 'ocr 글자 인식 이미지 텍스트 추출',
  'file-compress': '압축 해제 zip 용량 줄이기',
  'unit-converter': '단위 변환 길이 무게 온도',
  'currency-calc': '환율 계산 통화 달러 원',
  'sticky-notes': '스티커 메모 포스트잇 바탕화면 메모지',
  'snippets': '스니펫 문구 서명 계좌 주소 복사',
  'screen-picker': '스포이드 색 추출 화면 색상 집기 picker',
  'drag-ocr': '드래그 화면 캡처 글자 추출 ocr',
  'window-snap': '창 분할 반쪽 배열 정렬 타일',
  'bulk-rename': '파일 이름 변경 일괄 정규식 번호',
  'timer': '타이머 시간 알람 시계 카운트다운 분 초',
};

const COMMANDS = [
  { id: 'cmd:home', kind: 'command', name: 'TIP 앱 열기', subtitle: '홈 화면으로', keywords: '홈 열기 메인 창 앱' },
  { id: 'cmd:settings', kind: 'command', name: '환경설정 열기', subtitle: '일반, 노치, 검색, 모듈 탭', keywords: '설정 환경설정 테마 색 단축키' },
  { id: 'cmd:new-sticky', kind: 'command', name: '새 스티커 메모', subtitle: '바탕화면에 메모 한 장', keywords: '스티커 메모 새로 만들기', macOnly: true },
  { id: 'cmd:pick-color', kind: 'command', name: '화면에서 색 고르기', subtitle: '클릭한 점의 색을 복사', keywords: '스포이드 색 추출', macOnly: true },
  { id: 'cmd:drag-ocr', kind: 'command', name: '화면 글자 읽기', subtitle: '화면에서 드래그한 부분의 글자만 뽑기', keywords: '드래그 ocr 캡처 글자 추출 읽기', macOnly: true },
];

/** 시스템 명령 — 위험한 것은 실행 전에 화면이 한 번 더 묻는다. (v1.14.0) */
const SYSTEM_COMMANDS = [
  { id: 'lock', name: '화면 잠금', subtitle: '즉시 잠그고 암호를 묻습니다', keywords: 'lock screen 잠금 화면잠금', risky: false },
  { id: 'sleep', name: '잠자기', subtitle: 'Mac 을 잠자기 상태로', keywords: 'sleep 잠자기 절전', risky: false },
  { id: 'screensaver', name: '화면 보호기', subtitle: '화면 보호기를 바로 켭니다', keywords: 'screensaver 화면보호기 스크린세이버', risky: false },
  { id: 'darkmode', name: '다크 모드와 라이트 모드 전환', subtitle: '지금 모드의 반대로 바꿉니다', keywords: 'dark mode light 다크 라이트 모드 전환 테마', risky: false },
  { id: 'hiddenfiles', name: '숨김 파일 표시 전환', subtitle: 'Finder 의 숨김 파일 보기 켜고 끄기', keywords: 'hidden files 숨김 파일 표시', risky: false },
  { id: 'emptytrash', name: '휴지통 비우기', subtitle: '되돌릴 수 없습니다. 한 번 더 확인합니다', keywords: 'empty trash 휴지통 비우기 삭제', risky: true },
  { id: 'restart', name: '재시동', subtitle: 'Mac 을 다시 시작합니다', keywords: 'restart 재시동 다시시작 리부트', risky: true },
  { id: 'shutdown', name: '시스템 종료', subtitle: 'Mac 을 끕니다', keywords: 'shutdown 종료 전원끄기', risky: true },
  { id: 'logout', name: '로그아웃', subtitle: '지금 사용자를 로그아웃합니다', keywords: 'logout 로그아웃 계정전환', risky: true },
];

const WEB_ENGINES = {
  g: { id: 'google', label: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  n: { id: 'naver', label: 'Naver', url: (q) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}` },
};

let results = [];
let cursor = 0;
let rowNodes = [];
let appIndex = [];
let fileResults = [];
let fileQuery = '';
let fileTimer = 0;
let pendingConfirm = null;
let confirmTimer = 0;

function invoke(command, args) {
  if (!TAURI) return Promise.resolve(null);
  return window.__TAURI__.core.invoke(command, args || {});
}

function normalize(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function flash(text, ms = 1400) {
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('show', !!text);
  if (text) setTimeout(() => { statusEl.classList.remove('show'); }, ms);
}

function hidePalette() {
  if (TAURI) invoke('hide_search').catch(() => {});
  else window.close();
}

function scoreItem(item, query) {
  if (!query) return item.kind === 'command' ? 1 : 2;
  const name = normalize(item.name);
  const haystack = `${name} ${normalize(item.subtitle)} ${normalize(item.keywords)} ${normalize(item.subName)}`;
  if (name.startsWith(query)) return 0;
  if (haystack.includes(query)) return 1;
  const parts = query.split(' ').filter(Boolean);
  if (parts.length > 1 && parts.every((part) => haystack.includes(part))) return 2;
  // 한글 초성 — 'ㅋㄹ' 처럼 자음만 넣었을 때
  const chosung = koreanRank(`${item.name} ${item.subName || ''}`, query);
  if (chosung === 0) return 1;
  if (chosung === 1) return 2;
  if (chosung === 2) return 3;
  return 99;
}

function collectModules() {
  syncStore();
  return listModules().map((mod) => ({
    id: `module:${mod.id}`,
    kind: 'module',
    moduleId: mod.id,
    name: mod.name,
    subName: mod.name,
    subtitle: mod.subtitle,
    icon: mod.icon,
    meta: CATEGORY_LABEL[categoryOf(mod)] || '유틸리티',
    keywords: `${mod.name} ${KEYWORDS[mod.id] || ''} ${mod.description || ''}`,
    enabled: moduleState(mod).enabled,
  }));
}

function snippetItems(query) {
  if (!searchScopeEnabled('snippets')) return [];
  return findSnippets(query).map((snippet) => ({
    id: `snippet:${snippet.id}`,
    kind: 'snippet',
    name: snippet.label || snippet.alias || '스니펫',
    subName: snippet.alias || '',
    subtitle: snippetPreview(snippet),
    glyph: '❝',
    meta: '스니펫',
    body: snippet.body,
    score: 0,
  }));
}

function appItems(query) {
  if (!searchScopeEnabled('apps') || !TAURI) return [];
  const scored = [];
  appIndex.forEach((app) => {
    const name = app.displayName || app.name;
    const rank = Math.min(koreanRank(name, query), koreanRank(app.name, query));
    if (rank < 99) scored.push({ app, rank });
  });
  scored.sort((a, b) => a.rank - b.rank || a.app.name.localeCompare(b.app.name));
  return scored.slice(0, 5).map(({ app }) => ({
    id: `app:${app.path}`,
    kind: 'app',
    name: app.displayName || app.name,
    subName: app.name,
    subtitle: app.path.replace(/^\/Users\/[^/]+/, '~'),
    glyph: '▣',
    meta: '앱',
    path: app.path,
    score: 0,
  }));
}

function fileItems() {
  if (!searchScopeEnabled('files')) return [];
  return fileResults.map((hit) => ({
    id: `file:${hit.path}`,
    kind: 'file',
    name: hit.name,
    subtitle: hit.path.replace(/^\/Users\/[^/]+/, '~'),
    glyph: hit.isDir ? '▤' : '▢',
    meta: hit.isDir ? '폴더' : '파일',
    path: hit.path,
    score: 0,
  }));
}

function webItems(query) {
  if (!searchScopeEnabled('web')) return [];
  const match = query.match(/^([gn])\s+(.+)$/);
  if (match) {
    const engine = WEB_ENGINES[match[1]];
    const term = match[2].trim();
    if (!term) return [];
    return [{
      id: `web:${engine.id}`,
      kind: 'web',
      name: `${engine.label}에서 "${term}" 검색`,
      subtitle: '기본 브라우저로 엽니다',
      glyph: '⌕',
      meta: '웹',
      url: engine.url(term),
      score: 0,
    }];
  }
  const term = query.trim();
  if (!term || term.length < 2) return [];
  return ['google', 'naver'].map((id) => {
    const engine = id === 'google' ? WEB_ENGINES.g : WEB_ENGINES.n;
    return {
      id: `web:${id}`,
      kind: 'web',
      name: `${engine.label}에서 "${term}" 검색`,
      subtitle: '기본 브라우저로 엽니다',
      glyph: '⌕',
      meta: '웹',
      url: engine.url(term),
      score: 0,
    };
  });
}

/* ------------------------------ 타이머 (v1.15.0) ------------------------------ */
// `타이머 7분`, `타이머 1분 30초`, `timer 90s`, `타이머 7:30` → 바로 시작.
// `타이머` 만 치면 프리셋과 지금 남은 시간을 보여 준다.

function timerItems(query) {
  const parsed = parseTimerQuery(query);
  if (!parsed) return [];
  const state = timerState();
  const out = [];

  if (parsed.seconds > 0) {
    out.push({
      id: 'timer:start',
      kind: 'timer',
      name: `타이머 ${formatClock(parsed.seconds)} 시작`,
      subtitle: `${describeSeconds(parsed.seconds)} 타이머. 노치 알약과 메인 창이 함께 봅니다`,
      glyph: '⏱',
      meta: '타이머, Enter 로 시작',
      seconds: parsed.seconds,
      score: 0,
    });
    return out;
  }

  out.push({
    id: 'timer:open',
    kind: 'timer',
    name: '타이머 열기',
    subtitle: '분과 초를 직접 정하고 일시정지와 재개',
    glyph: '⏱',
    meta: '타이머',
    open: true,
    score: 0,
  });
  if (state.status !== 'idle') {
    out.push({
      id: 'timer:status',
      kind: 'timer',
      name: `지금 ${formatClock(remainingSeconds(state))}`,
      subtitle: state.status === 'running' ? '줄어드는 중. Enter 를 누르면 타이머가 열립니다' : (state.status === 'done' ? '끝났습니다' : '일시정지'),
      glyph: '⏱',
      meta: '타이머',
      open: true,
      score: 0,
    });
  }
  TIMER_PRESETS.forEach((minutes) => {
    out.push({
      id: `timer:preset:${minutes}`,
      kind: 'timer',
      name: `${minutes}분 타이머 시작`,
      subtitle: `${minutes}:00 부터. Enter 를 누르면 바로 열립니다`,
      glyph: '⏱',
      meta: '타이머',
      seconds: minutes * 60,
      score: 0,
    });
  });
  return out;
}

function systemItems(query) {
  if (!searchScopeEnabled('system')) return [];
  const enabled = getSystemCommandEnabled();
  const scored = SYSTEM_COMMANDS
    .filter((command) => enabled[command.id] !== false)
    .map((command) => ({ command, rank: Math.min(scoreItem(command, query), koreanRank(command.name, query)) }))
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4);
  return scored.map(({ command }) => ({
    id: `system:${command.id}`,
    kind: 'system',
    name: command.name,
    subtitle: command.subtitle,
    glyph: command.risky ? '⚠' : '⌘',
    meta: command.risky ? '시스템, 확인 필요' : '시스템',
    risky: command.risky,
    commandId: command.id,
    score: 0,
  }));
}

function search(query) {
  const q = normalize(query);
  const out = [];

  // 1) 즉석 계산기 — 맨 위.
  if (searchScopeEnabled('calc')) {
    const calc = calculate(query);
    if (calc) {
      out.push({
        id: 'calc',
        kind: 'calc',
        name: calc.text,
        subtitle: `${String(query).trim()} = ${calc.text}`,
        glyph: '=',
        meta: '계산, Enter 복사',
        copyText: String(calc.value),
        score: 0,
      });
    }
  }

  // 2) 타이머 — `타이머 7분` 처럼 치면 계산기 다음, 맨 위쪽.
  out.push(...timerItems(query));

  // 2) 웹 검색 — g·n 접두어면 계산기 다음, 아니면 맨 아래.
  const explicitWeb = webItems(query).filter((item) => /^[gn]\s/.test(query));
  out.push(...explicitWeb);

  const modules = collectModules()
    .map((item) => ({ item, rank: scoreItem(item, q) }))
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank || Number(b.item.enabled === true) - Number(a.item.enabled === true))
    .slice(0, q ? 5 : 40)
    .map(({ item }) => item);

  const commands = COMMANDS
    .filter((command) => !command.macOnly || TAURI)
    .map((command) => ({ command, rank: scoreItem(command, q) }))
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, q ? 2 : 5)
    .map(({ command }) => ({ ...command, glyph: '⌘', meta: '명령', score: 0 }));

  const snippets = snippetItems(query);
  // 빈 검색어에서 시스템 명령 9개가 깔리지 않게 — 무언가 칠 때만 보인다.
  const system = q ? systemItems(query) : [];
  const apps = q.length >= 1 ? appItems(q) : [];
  const files = q.length >= 2 ? fileItems() : [];

  out.push(...snippets, ...modules, ...commands, ...apps, ...files, ...system);
  if (!explicitWeb) out.push(...webItems(query));

  // 검색어가 없으면 명령·모듈 위주로 짧게.
  return q ? out.slice(0, 12) : out.slice(0, 14);
}

function iconFor(item) {
  if (item.icon) return item.icon;
  return item.glyph || '⌘';
}

function render() {
  results = search(inputEl.value);
  cursor = Math.min(cursor, Math.max(0, results.length - 1));
  listEl.innerHTML = '';
  emptyEl.hidden = results.length > 0;

  let lastGroup = '';
  rowNodes = [];

  results.forEach((item, index) => {
    const group = item.kind === 'module' || item.kind === 'command' ? 'TIP' : item.meta || item.kind;
    if (group !== lastGroup) {
      lastGroup = group;
      listEl.append(Object.assign(document.createElement('li'), {
        className: 'palette-group',
        textContent: group,
      }));
    }

    const li = document.createElement('li');
    const confirming = pendingConfirm && pendingConfirm === item.id;
    li.className = `palette-row${index === cursor ? ' is-active' : ''}${item.enabled === false ? ' is-off' : ''}${item.risky ? ' is-risky' : ''}${confirming ? ' is-confirm' : ''}`;
    li.id = `palette-row-${index}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(index === cursor));
    li.innerHTML = `
      <span class="palette-row-icon">${iconFor(item)}</span>
      <span class="palette-row-text">
        <b>${escapeHtml(confirming ? `${item.name}, 정말 실행하려면 Enter` : item.name)}</b>
        <span>${escapeHtml(item.subtitle || '')}</span>
      </span>
      <span class="palette-row-meta">${item.kind === 'command' ? '명령' : escapeHtml(item.meta || '')}${item.enabled === false ? ', 중지됨' : ''}</span>
    `;
    li.addEventListener('click', () => { cursor = index; activate(results[cursor]); });
    li.addEventListener('mousemove', () => {
      if (cursor === index) return;
      cursor = index;
      rowNodes.forEach((node, i) => {
        node.classList.toggle('is-active', i === index);
        node.setAttribute('aria-selected', String(i === index));
      });
    });
    listEl.append(li);
    rowNodes.push(li);
  });

  inputEl.setAttribute('aria-activedescendant', results.length ? `palette-row-${cursor}` : '');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function copyText(text) {
  if (TAURI) {
    await invoke('copy_text', { text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

/** Enter — 위험 명령은 한 번 더 묻고, 나머지는 바로 실행한다. */
function activate(item) {
  if (!item) return;
  if (item.risky && pendingConfirm !== item.id) {
    pendingConfirm = item.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      pendingConfirm = null;
      render();
    }, 4000);
    flash('한 번 더 Enter 를 누르면 실행합니다. Esc 로 그만둘 수 있습니다');
    render();
    return;
  }
  pendingConfirm = null;
  run(item);
}

async function run(item) {
  if (!item) return;

  if (item.kind === 'timer') {
    if (item.seconds) {
      startTimer(item.seconds);
      flash(`타이머 ${formatClock(item.seconds)} 를 시작했습니다`, 1400);
      setTimeout(hidePalette, 550);
      return;
    }
    try {
      if (TAURI) await invoke('open_tool', { id: 'timer', title: '타이머' });
      else location.href = './index.html?module=timer';
      if (TAURI) invoke('hide_search').catch(() => {});
    } catch (error) {
      console.error('[TIP search] 타이머:', error);
      flash('타이머를 열지 못했습니다');
    }
    return;
  }

  if (item.kind === 'calc' || item.kind === 'snippet') {
    const text = item.kind === 'calc' ? item.copyText : item.body;
    try {
      await copyText(text);
      flash(item.kind === 'calc' ? `${item.name} 복사했습니다` : '스니펫을 복사했습니다', 900);
      setTimeout(hidePalette, 550);
    } catch (error) {
      console.error('[TIP search]', error);
      flash('복사하지 못했습니다');
    }
    return;
  }

  if (!TAURI) {
    if (item.kind === 'module') location.href = `./index.html?module=${encodeURIComponent(item.moduleId)}`;
    else if (item.id === 'cmd:settings') location.href = './index.html?settings=1';
    else if (item.kind === 'web') window.open(item.url, '_blank', 'noopener');
    else location.href = './index.html';
    return;
  }

  try {
    if (item.kind === 'module') {
      if (item.enabled === false) await invoke('open_main', { module: item.moduleId, settings: false });
      else await invoke('open_tool', { id: item.moduleId, title: item.subName || item.name });
    } else if (item.kind === 'command') {
      if (item.id === 'cmd:settings') await invoke('open_main', { module: null, settings: true });
      else if (item.id === 'cmd:new-sticky') await invoke('sticky_create', {});
      else if (item.id === 'cmd:pick-color') await invoke('pick_screen_color');
      else if (item.id === 'cmd:drag-ocr') {
        await invoke('open_tool', { id: 'drag-ocr', title: '화면 글자 읽기' });
      } else await invoke('open_main', { module: null, settings: false });
    } else if (item.kind === 'app') {
      await invoke('open_local_app', { path: item.path });
    } else if (item.kind === 'file') {
      await invoke('open_local_file', { path: item.path });
    } else if (item.kind === 'web') {
      await invoke('open_external_url', { url: item.url });
    } else if (item.kind === 'system') {
      const message = await invoke('run_system_command', { id: item.commandId });
      flash(typeof message === 'string' && message ? message : '실행했습니다', 1200);
      setTimeout(hidePalette, 600);
      return;
    }
    await invoke('hide_search');
  } catch (error) {
    console.error('[TIP search]', error);
    const message = typeof error === 'string' ? error : '실행하지 못했습니다';
    flash(message.replace('[permission]', '').trim() || '실행하지 못했습니다', 3200);
  }
}

/* --------------------------- 로컬 파일 (비동기) --------------------------- */

function scheduleFiles(query) {
  clearTimeout(fileTimer);
  if (!TAURI || !searchScopeEnabled('files')) {
    fileResults = [];
    return;
  }
  const q = String(query || '').trim();
  if (q.length < 2) {
    fileResults = [];
    fileQuery = '';
    return;
  }
  fileTimer = setTimeout(async () => {
    fileQuery = q;
    // v1.15.1 — 파일 검색을 처음 쓸 때 무엇을 검색하는지 한 번만 알린다.
    if (filesNoticePending()) {
      markFilesNoticeShown();
      flash('홈 폴더 파일 이름을 검색합니다. 찾은 경로만 열 수 있습니다', 2600);
    }
    try {
      const hits = await invoke('search_local_files', { query: q });
      if (fileQuery !== q) return;
      fileResults = Array.isArray(hits) ? hits : [];
      render();
    } catch (error) {
      console.warn('[TIP search] 파일 검색:', error);
    }
  }, 220);
}

async function loadApps() {
  if (!TAURI || !searchScopeEnabled('apps')) return;
  try {
    const list = await invoke('list_installed_apps');
    appIndex = Array.isArray(list) ? list : [];
    if (inputEl.value.trim()) render();
  } catch (error) {
    console.warn('[TIP search] 앱 목록:', error);
  }
}

/* ------------------------------ 입력·키 ------------------------------ */

inputEl.addEventListener('input', () => {
  cursor = 0;
  pendingConfirm = null;
  fileResults = [];
  render();
  scheduleFiles(inputEl.value);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (pendingConfirm) {
      pendingConfirm = null;
      clearTimeout(confirmTimer);
      render();
      return;
    }
    hidePalette();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (!results.length) return;
    cursor = (cursor + 1) % results.length;
    render();
    rowNodes[cursor]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (!results.length) return;
    cursor = (cursor - 1 + results.length) % results.length;
    render();
    rowNodes[cursor]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    activate(results[cursor]);
  }
});

/* 단축키로 다시 열 때 — 입력을 비우고 초점을 돌려놓는다. */
function reset() {
  inputEl.value = '';
  cursor = 0;
  pendingConfirm = null;
  fileResults = [];
  flash('');
  render();
  inputEl.focus();
}

if (TAURI && window.__TAURI__.event) {
  window.__TAURI__.event.listen('tip://search-refresh', reset);
  // 스포이드·드래그 OCR 결과는 화면(모듈)이 받는다 — 검색창은 조용히 닫는다.
  window.__TAURI__.event.listen('tip://color-picked', (event) => {
    const payload = event.payload || {};
    if (!payload.cancelled && payload.color) {
      copyText(payload.color).then(() => {
        flash(`${payload.color} 복사했습니다`, 1000);
        setTimeout(hidePalette, 600);
      }).catch(() => {});
    }
  });
}

window.addEventListener('focus', () => inputEl.focus());

if (new URLSearchParams(location.search).has('bg')) {
  document.body.classList.add('has-preview-bg');
}

render();
loadApps();
inputEl.focus();
