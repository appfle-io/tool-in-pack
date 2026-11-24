/* TIP · 노치 아일랜드 — macOS 화면 최상단 중앙(노치 자리)에 붙는 작은 창. v1.13.0
 *
 * 평소에는 노치 자리에 작은 알약으로 붙어 있다가, 알약을 클릭하거나 파일을 끌어다 놓으면 펼쳐진다.
 * (v1.12.3 — 마우스를 올리는 것만으로는 펼쳐지지 않는다. 다른 앱을 쓰다가 지나가듯 올려도
 *  작업을 가리지 않게, 펼침은 클릭으로만 한다.)
 * 창 크기와 위치는 Rust(mac/src-tauri) 가 바꾸고, 이 파일은 안쪽 화면만 담당한다.
 * 접힘/펼침은 창 너비로 판단한다 — Rust 가 접힘 240×28(노치 화면은 노치 높이), 펼침 452×600 으로 맞춘다.
 *
 * v1.13.0 — 캘린더 카드를 누르면 패널 안에 달력 보기(일별·주별·월별)가 열린다.
 *   날짜를 누르면 그날 일정이 아래에 나오고, '캘린더' 버튼의 체크 목록으로 캘린더를 골라
 *   볼 수 있다(맥 캘린더 앱과 독립, localStorage 'tip.calendar.selectedIds.v1'). 이 필터는
 *   노치의 '다가오는 일정' 카드에도 그대로 적용된다.
 *
 * v1.12.2 수정
 *   · 환경설정에서 테마·기본 색·위젯·퀵바 순서를 바꾸면 tip://notch-refresh 를 받아 즉시 다시 그린다.
 *     (다른 창이라 storage 이벤트가 늘 닿지 않았다. 메인 창 js/store.js 가 값을 저장할 때 알린다.)
 *   · 펼칠 때마다 설정을 다시 읽어, 꺼 둔 위젯이 남아 있는 일을 없앴다.
 *   · Finder 파일 드롭은 Tauri 네이티브 이벤트(tip://shelf-drop = 경로 목록)로 받는다.
 *     HTML5 dataTransfer 로는 파일이 오지 않았다. 보관함을 클릭하면 파일 선택창도 열린다.
 *   · 빠른 메모를 클릭하면 notch_focus 로 창을 key window 로 만들어 바로 타이핑된다.
 */

import { getModule } from '../modules/registry.js';
import { quickOrderIds } from './quickbar.js';
import { getNotchSettings, syncStore, applyTheme, getTheme } from './store.js';

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

const notchEl = document.getElementById('notch');
const pillEl = document.getElementById('pill');
const panelEl = document.getElementById('panel');
const widgetsEl = document.getElementById('widgets');
const emptyEl = document.getElementById('panel-empty');
const toastEl = document.getElementById('notch-toast');

let expanded = false;
let collapseTimer = null;
let heldOpen = false;         // 입력 중이거나 파일을 끌고 있는 동안에는 접지 않는다
let mediaTimer = null;
let calendarTimer = null;
let widgetsDelay = null;      // 펼친 뒤 위젯 조회를 조금 미루는 타이머
let mediaBusy = false;        // 조회가 끝나기 전에 또 부르지 않는다
let calendarBusy = false;
let mediaPlaying = false;
let settingsRev = 0;          // 설정이 바뀔 때마다 +1 — 화면에 그린 마지막 상태와 비교한다
let renderedSignature = '';   // 마지막으로 그린 설정(저장값) — 펼칠 때마다 달라졌는지 싼 값으로 본다
let dragHeld = false;         // Finder 파일을 끌고 노치 위에 있는 동안에는 접지 않는다

/** Tauri 커맨드가 권한 거부를 알리는 표시(mac/src-tauri/src/media.rs 의 PERMISSION_TAG). */
const PERMISSION_TAG = '[permission]';

function isPermissionError(error) {
  return String((error && error.message) || error || '').includes(PERMISSION_TAG);
}

/** 지금 저장된 설정을 한 줄로 요약한다 — 이벤트를 놓쳤어도 펼칠 때 달라졌는지 알 수 있다. */
function settingsSignature() {
  try {
    return [
      localStorage.getItem('tip.notch.v1') || '',
      localStorage.getItem('tip.theme') || '',
      localStorage.getItem('tip.accent') || '',
      localStorage.getItem('tip.settings.v1') || '',
      localStorage.getItem('tip.radialOrder.v1') || '',
      localStorage.getItem('tip.radialOrderMode.v1') || '',
    ].join('|');
  } catch {
    return String(settingsRev);
  }
}

/* ------------------------------ 모양(테마·색) ------------------------------ */

/** 저장된 테마·기본 색을 이 창에도 적용한다. 메인 창 설정이 바뀌면 즉시 다시 부른다. */
function applyAppearance() {
  applyTheme(getTheme());   // data-theme + data-accent(기본 색)를 함께 맞춘다
}

/* ------------------------------ 공통 ------------------------------ */

function invoke(command, args) {
  if (!TAURI) return Promise.resolve(null);
  return window.__TAURI__.core.invoke(command, args || {}).catch((error) => {
    console.error('[TIP notch]', command, error);
    throw error;
  });
}

let toastTimer = null;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

/** 오류에서 사람이 읽을 한 줄을 꺼낸다 — 콘솔에만 남기지 않고 카드에도 짧게 보여 준다(v1.12.4). */
function errorText(error) {
  const raw = String((error && error.message) || error || '').replace(PERMISSION_TAG, '').trim();
  if (!raw) return '알 수 없는 오류';
  return raw.length > 90 ? `${raw.slice(0, 90)}…` : raw;
}

/* ------------------------------ 펼침/접힘 ------------------------------ */

function setExpanded(next, { animate = true } = {}) {
  if (expanded === next) return;
  expanded = next;
  if (!animate) notchEl.classList.add('no-anim');
  notchEl.classList.toggle('is-collapsed', !next);
  notchEl.classList.toggle('is-expanded', next);

  if (next) {
    // 화면 전환(패널 그리기)을 먼저 끝내고 다음 프레임에 창 크기를 바꾼다.
    // 창 리사이즈와 위젯 조회가 같은 순간에 몰려 멈추지 않도록 조회는 startWidgets 가 미룬다.
    if (renderedSignature !== settingsSignature()) renderWidgets();
    applyAppearance();
    requestAnimationFrame(() => { invoke('notch_expand').catch(() => {}); });
    startWidgets();
    // v1.13.0 — 달력 보기가 열려 있었으면 다시 펼칠 때 보이는 기간을 새로 읽는다.
    if (calView.open) loadCalendarView();
  } else {
    invoke('notch_collapse').catch(() => {});
    stopWidgets();
    heldOpen = false;
  }
  syncHold();
  if (!animate) requestAnimationFrame(() => notchEl.classList.remove('no-anim'));
}

/** Rust 의 커서 감시에 '지금은 접지 마라'를 알린다 — 입력 중·드래그 중·거울이 켜진 동안(v1.12.4). */
function syncHold() {
  if (!TAURI) return;
  const active = document.activeElement;
  const typing = !!(active && active.matches && active.matches('#notch input, #notch textarea'));
  const hold = !!(notchHeld() || typing);
  invoke('notch_hover_hold', { hold }).catch(() => {});
}

/** 접지 않아야 하는 이유들 — 펼친 뒤 잠깐(openHeld), 파일 드래그, 웹캠 거울. */
function notchHeld() {
  return heldOpen || dragHeld || !!mirrorStream;
}

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    if (heldOpen) return;
    if (dragHeld) return;
    if (document.querySelector('.mirror-video.is-live')) return;
    if (notchEl.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    setExpanded(false);
  }, 650);
}

function cancelCollapse() {
  clearTimeout(collapseTimer);
}

/* ------------------------------ 위젯 그리기 ------------------------------ */

function widgetCard(id, inner, className = '') {
  const card = document.createElement('section');
  card.className = `wg-card wg-${id} ${className}`.trim();
  card.dataset.widget = id;
  card.innerHTML = inner;
  return card;
}

function renderWidgets() {
  syncStore();
  const { widgets } = getNotchSettings();
  widgetsEl.innerHTML = '';

  let count = 0;
  const add = (node) => { widgetsEl.append(node); count += 1; };

  if (widgets.media) add(mediaCard());
  if (widgets.calendar) add(calendarCard());
  if (widgets.shelf) add(shelfCard());
  if (widgets.timer) add(timerCard());
  if (widgets.memo) add(memoCard());
  if (widgets.mirror) add(mirrorCard());
  if (widgets.launcher) add(launcherCard());

  emptyEl.hidden = count > 0;
  // v1.13.0 — 달력 보기가 열려 있으면 위젯 목록은 그 아래에 두고 숨긴다.
  widgetsEl.hidden = calView.open ? true : count === 0;
  renderedSignature = settingsSignature();
}

/* 미디어 */

function mediaCard() {
  return widgetCard('media', `
    <div class="wg-head">
      <span class="wg-label">지금 재생 중</span>
      <span class="wg-side" id="media-app">—</span>
    </div>
    <div class="media-body">
      <div class="media-art" id="media-art" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>
      </div>
      <div class="media-text">
        <b id="media-title">재생 중인 곡이 없습니다</b>
        <span id="media-artist">Apple Music 또는 Spotify</span>
      </div>
      <div class="media-controls">
        <button class="media-btn" type="button" data-media="previous" aria-label="이전 곡" title="이전">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v14H7zM19 5v14l-9-7z"/></svg>
        </button>
        <button class="media-btn media-play" type="button" data-media="playpause" aria-label="재생·일시정지" title="재생·일시정지">
          <svg id="media-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="media-btn" type="button" data-media="next" aria-label="다음 곡" title="다음">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5h2v14h-2zM5 5v14l9-7z"/></svg>
        </button>
      </div>
    </div>
    <button class="wg-perm" id="media-perm" type="button" hidden>권한 설정</button>
  `);
}

async function refreshMedia() {
  if (!TAURI || !expanded || mediaBusy) return;
  if (!getNotchSettings().widgets.media) return;
  const titleEl = panelEl.querySelector('#media-title');
  if (!titleEl) return;
  mediaBusy = true;
  try {
    const state = await invoke('media_state');
    const playing = !!(state && state.playing);
    mediaPlaying = playing;
    panelEl.querySelector('#media-app').textContent = state && state.app ? state.app : '—';
    titleEl.textContent = state && state.title ? state.title : '재생 중인 곡이 없습니다';
    panelEl.querySelector('#media-artist').textContent = state && state.artist
      ? state.artist
      : 'Apple Music 또는 Spotify';
    panelEl.querySelector('#media-icon').innerHTML = playing
      ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    const permBtn = panelEl.querySelector('#media-perm');
    if (permBtn) permBtn.hidden = true;
    const dot = document.getElementById('pill-dot');
    if (dot) dot.classList.toggle('is-playing', playing);
  } catch (error) {
    // v1.12.3 — 권한 거부(-1743)는 다른 오류와 다르게 안내하고 '권한 설정' 버튼을 띄운다.
    // v1.12.4 — 권한 문제가 아닌 오류도 콘솔에만 남기지 않고 짧은 원인을 함께 보여 준다.
    const permission = isPermissionError(error);
    titleEl.textContent = permission ? '음악 앱 권한이 필요합니다' : '미디어 정보를 읽지 못했습니다';
    panelEl.querySelector('#media-artist').textContent = permission
      ? '시스템 설정 › 자동화에서 TIP을 허용하세요'
      : errorText(error);
    const permBtn = panelEl.querySelector('#media-perm');
    if (permBtn) permBtn.hidden = !permission;
  } finally {
    mediaBusy = false;
  }
}

/* 캘린더 */

const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3.5V6M16 3.5V6"/></svg>';

function calendarCard() {
  const card = widgetCard('calendar', `
    <div class="wg-head">
      <span class="wg-label">다가오는 일정</span>
      <button class="wg-link" id="cal-open" type="button" aria-label="달력 열기" title="달력 열기">${CAL_ICON}</button>
    </div>
    <ul class="cal-list" id="cal-list"><li class="cal-empty">일정을 불러오는 중…</li></ul>
    <button class="wg-perm" id="cal-perm" type="button" hidden>권한 설정</button>
  `);
  // 카드 아무 곳이나 눌러도 달력이 열린다(아이콘을 정확히 겨냥하지 않아도 되게).
  card.dataset.calOpen = '1';
  return card;
}

function clock(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function relativeUntil(ms) {
  const diff = new Date(ms).getTime() - Date.now();
  if (!Number.isFinite(diff)) return '';
  if (diff <= 0) return '진행 중';
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}분 뒤`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 뒤`;
  return '내일';
}

/** Rust(EventKit)는 start 를 에포크 밀리초 숫자로 준다. 예전 문자열도 받아 준다. */
function startMs(event) {
  const raw = event && event.start;
  if (typeof raw === 'number') return raw;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/* --------------------------- 캘린더 — 독립 필터 (v1.13.0) --------------------------- */

/** TIP 안에서만 쓰는 캘린더 선택값 — macOS 달력 앱의 체크 상태와 무관하다. */
const CAL_SELECTED_KEY = 'tip.calendar.selectedIds.v1';
const CAL_DOW = ['일', '월', '화', '수', '목', '금', '토'];
const CAL_FALLBACK_COLOR = '#2E5E4E';

/** 저장된 선택 목록 — 저장값이 없으면 null(전체 선택). */
function storedCalendarIds() {
  try {
    const raw = localStorage.getItem(CAL_SELECTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

function saveCalendarIds(ids) {
  try {
    localStorage.setItem(CAL_SELECTED_KEY, JSON.stringify(ids));
  } catch (error) {
    console.warn('[TIP notch] 캘린더 선택을 저장하지 못했습니다', error);
  }
}

/** 조회에 넘길 캘린더 식별자 — null 이면 전체(필터 없음), 빈 배열이면 아무 캘린더도 표시하지 않음. */
function selectedCalendarIds() {
  return storedCalendarIds();
}

function isCalendarChecked(id) {
  const stored = storedCalendarIds();
  return stored === null ? true : stored.includes(id);
}

/** 색은 Rust 가 준 `#RRGGBB` 만 받는다 — 그 밖의 값이 style 로 흘러가지 않게. */
function safeColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || '')) ? String(value) : CAL_FALLBACK_COLOR;
}

/* --------------------------- 캘린더 — 날짜 계산 --------------------------- */

function pad2(value) {
  return String(value).padStart(2, '0');
}

function midnight(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDayKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function weekStart(value) {
  const date = midnight(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

/** 화면에 열어 둔 캘린더 보기의 상태. */
const calView = {
  open: false,
  mode: 'month',          // 'day' | 'week' | 'month'
  selected: midnight(new Date()),
  calendars: null,        // null = 아직 안 읽음
  events: [],
  loading: false,
  error: '',
  permission: false,
  req: 0,                 // 늦게 도착한 조회 결과를 버리기 위한 번호
};

function calDom() {
  return {
    view: document.getElementById('cal-view'),
    title: document.getElementById('cal-view-title'),
    grid: document.getElementById('cal-grid-wrap'),
    dayHead: document.getElementById('cal-day-head'),
    dayList: document.getElementById('cal-day-list'),
    filterBtn: document.getElementById('cal-filter-btn'),
    filterPanel: document.getElementById('cal-filter-panel'),
    filterList: document.getElementById('cal-filter-list'),
    tabs: panelEl.querySelectorAll('[data-cal-mode]'),
  };
}

/** 지금 보기(월·주·일)가 화면에 담는 기간 — [시작일 00:00, 끝 다음 날 00:00). */
function calendarViewRange() {
  const selected = calView.selected;
  if (calView.mode === 'month') {
    const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const start = weekStart(first);
    return [start, addDays(start, 42)];   // 6주 격자 — 달마다 같은 높이
  }
  if (calView.mode === 'week') {
    const start = weekStart(selected);
    return [start, addDays(start, 7)];
  }
  const start = midnight(selected);
  return [start, addDays(start, 1)];
}

function normalizeEvent(event) {
  if (!event) return null;
  const start = Number(event.start);
  if (!Number.isFinite(start)) return null;
  const end = Number(event.end);
  return {
    title: String(event.title || '(제목 없음)'),
    start,
    end: Number.isFinite(end) && end >= start ? end : start,
    allDay: !!event.allDay,
    calendarId: String(event.calendarId || ''),
    calendar: String(event.calendar || ''),
    color: safeColor(event.color),
  };
}

function eventsOnDay(date, events = calView.events) {
  const from = midnight(date).getTime();
  const to = addDays(midnight(date), 1).getTime();
  return events
    .filter((event) => event.start < to && Math.max(event.end, event.start + 1) > from)
    .sort((a, b) => (Number(b.allDay) - Number(a.allDay)) || (a.start - b.start));
}

/** 기간 안의 일정을 날짜별로 나눈다 — 여러 날에 걸친 일정은 그 날들 모두에 점이 찍힌다. */
function eventsByDay(events = calView.events) {
  const map = new Map();
  events.forEach((event) => {
    let cursor = midnight(event.start);
    const last = midnight(Math.max(event.start, event.end - 1));
    let guard = 0;
    while (cursor.getTime() <= last.getTime() && guard < 62) {
      const key = dayKey(cursor);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
      cursor = addDays(cursor, 1);
      guard += 1;
    }
  });
  return map;
}

async function loadCalendarList(force = false) {
  if (calView.calendars && !force) return calView.calendars;
  const list = await invoke('calendar_list');
  calView.calendars = (Array.isArray(list) ? list : [])
    .map((calendar) => ({
      id: String(calendar.id || ''),
      title: String(calendar.title || '캘린더'),
      color: safeColor(calendar.color),
      source: String(calendar.source || ''),
    }))
    .filter((calendar) => calendar.id);
  return calView.calendars;
}

/** 보이는 기간의 일정을 읽어 다시 그린다. 필터(선택한 캘린더)가 있으면 그것만 요청한다. */
async function loadCalendarView() {
  if (!TAURI || !calView.open) return;
  const request = ++calView.req;
  calView.loading = true;
  calView.error = '';
  calView.permission = false;
  const dom = calDom();
  if (dom.dayList && !calView.events.length) {
    dom.dayList.innerHTML = '<li class="cal-empty">일정을 불러오는 중…</li>';
  }
  try {
    await loadCalendarList(false);
    const [start, end] = calendarViewRange();
    const ids = selectedCalendarIds();
    const events = await invoke('calendar_events', {
      startMs: start.getTime(),
      endMs: end.getTime(),
      calendarIds: ids === null ? null : ids,
    });
    if (request !== calView.req) return;   // 그사이 보기·날짜가 바뀌었다
    calView.events = (Array.isArray(events) ? events : []).map(normalizeEvent).filter(Boolean);
  } catch (error) {
    if (request !== calView.req) return;
    calView.permission = isPermissionError(error);
    calView.error = errorText(error);
    calView.events = [];
  } finally {
    if (request === calView.req) {
      calView.loading = false;
      renderCalendarView();
    }
  }
}

/* --------------------------- 캘린더 — 그리기 --------------------------- */

function calendarTitle() {
  const selected = calView.selected;
  const year = selected.getFullYear();
  const month = selected.getMonth() + 1;
  if (calView.mode === 'month') return `${year}년 ${month}월`;
  if (calView.mode === 'week') {
    const start = weekStart(selected);
    const end = addDays(start, 6);
    const sameMonth = start.getMonth() === end.getMonth();
    return sameMonth
      ? `${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getDate()}일`
      : `${start.getMonth() + 1}월 ${start.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }
  return `${month}월 ${selected.getDate()}일 (${CAL_DOW[selected.getDay()]})`;
}

function renderMonthGrid(dom) {
  const selected = calView.selected;
  const start = weekStart(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(selected);
  const byDay = eventsByDay();

  const head = CAL_DOW.map((label) => `<span class="cal-dow">${label}</span>`).join('');
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    const key = dayKey(date);
    const dots = (byDay.get(key) || []).slice(0, 3)
      .map((event) => `<span class="cal-dot" style="background:${event.color}"></span>`)
      .join('');
    const classes = ['cal-cell'];
    if (date.getMonth() !== selected.getMonth()) classes.push('is-out');
    if (key === todayKey) classes.push('is-today');
    if (key === selectedKey) classes.push('is-sel');
    const count = (byDay.get(key) || []).length;
    cells.push(`
      <button class="${classes.join(' ')}" type="button" data-cal-date="${key}"
        aria-label="${date.getMonth() + 1}월 ${date.getDate()}일${count ? `, 일정 ${count}개` : ''}"
        ${key === selectedKey ? 'aria-current="date"' : ''}>
        <span class="cal-num">${date.getDate()}</span>
        <span class="cal-dots" aria-hidden="true">${dots}</span>
      </button>`);
  }
  dom.grid.innerHTML = `<div class="cal-grid">${head}${cells.join('')}</div>`;
}

function renderWeekStrip(dom) {
  const start = weekStart(calView.selected);
  const todayKey = dayKey(new Date());
  const selectedKey = dayKey(calView.selected);
  const byDay = eventsByDay();

  const cells = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(start, index);
    const key = dayKey(date);
    const dots = (byDay.get(key) || []).slice(0, 4)
      .map((event) => `<span class="cal-dot" style="background:${event.color}"></span>`)
      .join('');
    const classes = ['cal-week-cell'];
    if (key === todayKey) classes.push('is-today');
    if (key === selectedKey) classes.push('is-sel');
    const count = (byDay.get(key) || []).length;
    cells.push(`
      <button class="${classes.join(' ')}" type="button" data-cal-date="${key}"
        aria-label="${date.getMonth() + 1}월 ${date.getDate()}일 ${CAL_DOW[index]}요일${count ? `, 일정 ${count}개` : ''}">
        <span class="cal-week-dow">${CAL_DOW[index]}</span>
        <span class="cal-week-num">${date.getDate()}</span>
        <span class="cal-dots" aria-hidden="true">${dots}</span>
      </button>`);
  }
  dom.grid.innerHTML = `<div class="cal-week">${cells.join('')}</div>`;
}

function renderDayPanel(dom) {
  const selected = calView.selected;
  const events = eventsOnDay(selected);
  const when = `${selected.getMonth() + 1}월 ${selected.getDate()}일 (${CAL_DOW[selected.getDay()]})`;

  if (calView.permission) {
    dom.dayHead.innerHTML = `<span>${when}</span>`;
    dom.dayList.innerHTML = `
      <li class="cal-empty">캘린더 권한이 필요합니다 — 시스템 설정 › 개인정보 보호 및 보안 › 캘린더에서 TIP을 허용하세요</li>
      <li><button class="cal-tool" type="button" data-cal-perm>권한 설정 열기</button></li>`;
    return;
  }
  if (calView.error) {
    dom.dayHead.innerHTML = `<span>${when}</span>`;
    dom.dayList.innerHTML = `<li class="cal-empty">캘린더를 읽지 못했습니다<span class="cal-error">${escapeHtml(calView.error)}</span></li>`;
    return;
  }

  dom.dayHead.innerHTML = `<span>${when}</span><span>${events.length ? `${events.length}개 일정` : '일정 없음'}</span>`;
  if (!events.length) {
    dom.dayList.innerHTML = `<li class="cal-empty">${calView.loading ? '일정을 불러오는 중…' : '이 날은 일정이 없습니다'}</li>`;
    return;
  }

  const wide = calView.mode === 'day';
  dom.dayList.innerHTML = events.map((event) => {
    const time = event.allDay
      ? '종일'
      : wide
        ? `${clock(event.start)}–${clock(event.end)}`
        : clock(event.start);
    const meta = [event.calendar, event.allDay ? '' : `${clock(event.start)}–${clock(event.end)}`]
      .filter(Boolean)
      .join(' · ');
    return `
      <li class="cal-item${wide ? ' is-day' : ''}">
        <span class="cal-item-bar" aria-hidden="true" style="background:${event.color}"></span>
        <span class="cal-item-time">${time}</span>
        <span class="cal-item-text">
          <b>${escapeHtml(event.title)}</b>
          <span>${escapeHtml(meta)}</span>
        </span>
      </li>`;
  }).join('');
}

function renderCalendarFilter() {
  const dom = calDom();
  const calendars = calView.calendars || [];
  const bySource = new Map();
  calendars.forEach((calendar) => {
    const key = calendar.source || '기타';
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(calendar);
  });

  if (!calendars.length) {
    dom.filterList.innerHTML = '<li class="cal-empty">캘린더가 없습니다</li>';
    return;
  }
  dom.filterList.innerHTML = calendars.map((calendar) => `
    <li class="cal-filter-row">
      <label>
        <input type="checkbox" data-cal-id="${escapeHtml(calendar.id)}" ${isCalendarChecked(calendar.id) ? 'checked' : ''}>
        <span class="cal-filter-dot" style="background:${calendar.color}"></span>
        <span class="cal-filter-name">${escapeHtml(calendar.title)}</span>
        <span class="cal-filter-source">${escapeHtml(calendar.source)}</span>
      </label>
    </li>`).join('');
}

function renderCalendarView() {
  if (!calView.open) return;
  const dom = calDom();
  dom.title.textContent = calendarTitle();
  dom.tabs.forEach((tab) => {
    const on = tab.dataset.calMode === calView.mode;
    tab.classList.toggle('is-on', on);
    tab.setAttribute('aria-selected', String(on));
  });
  dom.filterBtn.classList.toggle('is-on', !dom.filterPanel.hidden);
  dom.filterBtn.setAttribute('aria-expanded', String(!dom.filterPanel.hidden));
  if (calView.mode === 'month') renderMonthGrid(dom);
  else if (calView.mode === 'week') renderWeekStrip(dom);
  else dom.grid.innerHTML = '';
  renderDayPanel(dom);
  renderCalendarFilter();
}

/* --------------------------- 캘린더 — 조작 --------------------------- */

function openCalendarView() {
  if (!TAURI) {
    toast('달력은 Mac 앱에서만 볼 수 있습니다');
    return;
  }
  const dom = calDom();
  if (!dom.view) return;
  calView.open = true;
  calView.selected = midnight(new Date());
  dom.view.hidden = false;
  widgetsEl.hidden = true;
  const hint = panelEl.querySelector('#panel-hint');
  if (hint) hint.hidden = true;
  cancelCollapse();
  renderCalendarView();
  loadCalendarView();
}

function closeCalendarView() {
  const dom = calDom();
  calView.open = false;
  calView.req += 1;              // 진행 중인 조회 결과는 버린다
  if (dom.view) dom.view.hidden = true;
  widgetsEl.hidden = widgetsEl.childElementCount === 0;
  const hint = panelEl.querySelector('#panel-hint');
  if (hint) hint.hidden = false;
  if (dom.filterPanel) dom.filterPanel.hidden = true;
}

function setCalendarMode(mode) {
  if (!['day', 'week', 'month'].includes(mode) || calView.mode === mode) return;
  calView.mode = mode;
  renderCalendarView();
  loadCalendarView();
}

function selectCalendarDay(value) {
  const date = typeof value === 'string' ? parseDayKey(value) : midnight(value);
  if (Number.isNaN(date.getTime())) return;
  // 월별 격자의 앞뒤 달 칸을 누르면 그 달로 넘어간다 — 격자가 바뀌므로 기간을 다시 읽는다.
  const changedMonth = calView.mode === 'month'
    && (date.getMonth() !== calView.selected.getMonth() || date.getFullYear() !== calView.selected.getFullYear());
  const changedRange = calView.mode === 'day' || changedMonth || !isInView(date);
  calView.selected = date;
  renderCalendarView();
  if (changedRange) loadCalendarView();
}

/** 지금 읽어 둔 기간 안의 날인지 — 안이면 다시 조회하지 않고 그려만 준다. */
function isInView(date) {
  const [start, end] = calendarViewRange();
  const ms = midnight(date).getTime();
  return ms >= start.getTime() && ms < end.getTime();
}

function stepCalendar(direction) {
  const selected = calView.selected;
  let next;
  if (calView.mode === 'month') {
    const year = selected.getFullYear();
    const month = selected.getMonth() + direction;
    const lastDay = new Date(year, month + 1, 0).getDate();
    next = new Date(year, month, Math.min(selected.getDate(), lastDay));
  } else if (calView.mode === 'week') {
    next = addDays(selected, 7 * direction);
  } else {
    next = addDays(selected, direction);
  }
  calView.selected = midnight(next);
  renderCalendarView();
  loadCalendarView();
}

function goCalendarToday() {
  calView.selected = midnight(new Date());
  renderCalendarView();
  loadCalendarView();
}

function toggleCalendarFilter(force) {
  const dom = calDom();
  if (!dom.filterPanel) return;
  const next = typeof force === 'boolean' ? force : dom.filterPanel.hidden;
  dom.filterPanel.hidden = !next;
  dom.filterBtn.classList.toggle('is-on', next);
  dom.filterBtn.setAttribute('aria-expanded', String(next));
  if (next) renderCalendarFilter();
  cancelCollapse();
}

/** 필터를 바꾸면 달력과 노치 오늘 요약을 함께 다시 읽는다. */
function applyCalendarFilter() {
  renderCalendarFilter();
  if (calView.open) loadCalendarView();
  refreshCalendar();
}

function setCalendarChecked(id, checked) {
  const all = (calView.calendars || []).map((calendar) => calendar.id);
  const base = storedCalendarIds() ?? all;
  const next = checked
    ? Array.from(new Set([...base, id]))
    : base.filter((value) => value !== id);
  saveCalendarIds(next);
  applyCalendarFilter();
}

function setAllCalendars(checked) {
  const all = (calView.calendars || []).map((calendar) => calendar.id);
  saveCalendarIds(checked ? all : []);
  applyCalendarFilter();
}

async function refreshCalendar() {
  if (!TAURI || !expanded || calendarBusy) return;
  if (!getNotchSettings().widgets.calendar) return;
  const list = panelEl.querySelector('#cal-list');
  if (!list) return;
  calendarBusy = true;
  try {
    const today = midnight(new Date());
    const ids = selectedCalendarIds();
    // v1.13.0 — 카드도 달력과 같은 독립 필터를 쓴다(고른 캘린더만).
    const events = await invoke('calendar_events', {
      startMs: today.getTime(),
      endMs: addDays(today, 1).getTime(),
      calendarIds: ids === null ? null : ids,
    });
    const now = Date.now();
    const rows = (Array.isArray(events) ? events : [])
      .map(normalizeEvent)
      .filter(Boolean)
      .filter((event) => Math.max(event.end, event.start + 1) >= now)
      .sort((a, b) => (Number(b.allDay) - Number(a.allDay)) || (a.start - b.start))
      .slice(0, 4);
    if (!rows.length) {
      list.innerHTML = '<li class="cal-empty">오늘 남은 일정이 없습니다</li>';
      const permBtn = panelEl.querySelector('#cal-perm');
      if (permBtn) permBtn.hidden = true;
      return;
    }
    const permBtn = panelEl.querySelector('#cal-perm');
    if (permBtn) permBtn.hidden = true;
    list.innerHTML = rows.map((event) => `
      <li class="cal-row">
        <span class="cal-bar" aria-hidden="true" style="background:${event.color}"></span>
        <span class="cal-text">
          <b>${escapeHtml(event.title)}</b>
          <span>${event.allDay ? '종일' : `${clock(event.start)} · ${relativeUntil(event.start)}`}${event.calendar ? ` · ${escapeHtml(event.calendar)}` : ''}</span>
        </span>
      </li>
    `).join('');
  } catch (error) {
    // v1.12.4 — 캘린더는 EventKit 권한을 쓴다. 권한이면 '권한 설정' 버튼,
    // 그 밖의 오류는 콘솔에만 남기지 않고 짧은 원인을 카드에 함께 보여 준다.
    const permission = isPermissionError(error);
    list.innerHTML = permission
      ? '<li class="cal-empty">캘린더 권한이 필요합니다 — 시스템 설정 › 개인정보 보호 및 보안 › 캘린더에서 TIP을 허용하세요</li>'
      : `<li class="cal-empty">캘린더를 읽지 못했습니다<span class="cal-error">${escapeHtml(errorText(error))}</span></li>`;
    const permBtn = panelEl.querySelector('#cal-perm');
    if (permBtn) permBtn.hidden = !permission;
  } finally {
    calendarBusy = false;
  }
}

/* 임시 보관함 */

const shelf = [];   // { id, file, url }

function shelfCard() {
  const card = widgetCard('shelf', `
    <div class="wg-head">
      <span class="wg-label">임시 보관함</span>
      <span class="wg-side" id="shelf-count">0개</span>
    </div>
    <div class="shelf-drop" id="shelf-drop" role="button" tabindex="0" title="클릭해서 파일 고르기">
      <span class="shelf-drop-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
      </span>
      <b>파일을 끌어다 놓거나 클릭하세요</b>
      <span>잠깐 보관했다가 바로 변환·압축·모자이크</span>
    </div>
    <!-- v1.12.2 — 드래그가 막히는 환경에서도 담을 수 있게 클릭 선택을 함께 둔다. -->
    <input class="shelf-file-input" id="shelf-file" type="file" multiple tabindex="-1" aria-hidden="true">
    <div class="shelf-list" id="shelf-list"></div>
  `);
  requestAnimationFrame(() => {
    renderShelf();
    const picker = card.querySelector('#shelf-file');
    if (!picker) return;
    picker.addEventListener('change', () => {
      if (picker.files && picker.files.length) addFiles(picker.files);
      picker.value = '';   // 같은 파일을 다시 골라도 change 가 오게 비운다
    });
  });
  return card;
}

const CONVERTERS = [
  { id: 'img-converter', label: '변환', test: (file) => /^image\//.test(file.type) },
  { id: 'file-compress', label: '압축', test: (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name) },
  { id: 'photo-privacy', label: '모자이크', test: (file) => /^image\//.test(file.type) },
  { id: 'pdf-tools', label: 'PDF', test: (file) => /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) },
  { id: 'video-gif', label: 'GIF', test: (file) => /^video\//.test(file.type) },
];

function renderShelf() {
  const list = panelEl.querySelector('#shelf-list');
  const count = panelEl.querySelector('#shelf-count');
  if (!list) return;
  if (count) count.textContent = `${shelf.length}개`;
  if (!shelf.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = '';
  shelf.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'shelf-item';
    const isImage = /^image\//.test(item.file.type);
    row.innerHTML = `
      ${isImage ? `<img class="shelf-thumb" src="${item.url}" alt="">` : `<span class="shelf-file" aria-hidden="true">${(item.file.name.split('.').pop() || '파일').slice(0, 4).toUpperCase()}</span>`}
      <span class="shelf-name" title="${escapeHtml(item.file.name)}">
        <b>${escapeHtml(item.file.name)}</b>
        <span>${(item.file.size / 1024 < 1024 ? `${Math.max(1, Math.round(item.file.size / 1024))} KB` : `${(item.file.size / 1048576).toFixed(1)} MB`)}</span>
      </span>
      <span class="shelf-actions"></span>
      <button class="shelf-remove" type="button" aria-label="${escapeHtml(item.file.name)} 빼기" title="빼기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    `;
    const actions = row.querySelector('.shelf-actions');
    CONVERTERS.filter((tool) => tool.test(item.file)).slice(0, 3).forEach((tool) => {
      const btn = document.createElement('button');
      btn.className = 'shelf-action';
      btn.type = 'button';
      btn.textContent = tool.label;
      btn.addEventListener('click', () => sendToModule(tool.id, item));
      actions.append(btn);
    });
    row.querySelector('.shelf-remove').addEventListener('click', () => {
      const index = shelf.indexOf(item);
      if (index >= 0) shelf.splice(index, 1);
      URL.revokeObjectURL(item.url);
      renderShelf();
    });
    list.append(row);
  });
}

function addFiles(files) {
  const list = Array.from(files || []).filter((file) => file && file.name);
  if (!list.length) return;
  list.forEach((file) => {
    if (shelf.length >= 8) return;
    shelf.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, url: URL.createObjectURL(file) });
  });
  renderShelf();
  toast(`${list.length}개를 임시 보관함에 담았습니다`);
  openHeld();
}

/* Finder 에서 끌어다 놓은 파일 — Rust 가 보내 준 경로 목록을 읽어 File 로 만든다.
   (v1.12.2 — HTML5 dataTransfer 대신 네이티브 드롭 경로. 읽기는 Rust read_shelf_file 이
    일반 파일·50MB 이하만 허용한다.) */

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
  svg: 'image/svg+xml', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain',
  md: 'text/markdown', json: 'application/json', csv: 'text/csv',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
};

function mimeOf(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function addShelfPaths(paths) {
  const list = Array.isArray(paths) ? paths.filter((path) => typeof path === 'string' && path.trim()) : [];
  if (!list.length) return;
  if (!expanded) setExpanded(true);
  if (!panelEl.querySelector('#shelf-list')) {
    toast('환경설정에서 임시 보관함 위젯을 켜 주세요');
    return;
  }

  let added = 0;
  let problem = '';
  for (const path of list) {
    if (shelf.length >= 8) { problem = problem || '임시 보관함은 8개까지 담을 수 있습니다'; break; }
    try {
      const raw = await invoke('read_shelf_file', { path });
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw || 0);
      if (!bytes.length) throw new Error('빈 파일입니다');
      const name = String(path).split('/').pop() || 'file';
      const file = new File([bytes], name, { type: mimeOf(name) });
      shelf.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, url: URL.createObjectURL(file) });
      added += 1;
    } catch (error) {
      const message = typeof error === 'string' ? error : (error && error.message) || '파일을 읽지 못했습니다';
      problem = problem || message;
      console.error('[TIP notch] 보관함 파일을 읽지 못했습니다', path, error);
    }
  }

  renderShelf();
  if (added) toast(`${added}개를 임시 보관함에 담았습니다`);
  else toast(String(problem).slice(0, 90) || '파일을 담지 못했습니다');
  openHeld();
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function sendToModule(moduleId, item) {
  const mod = getModule(moduleId);
  if (item.file.size > 3 * 1024 * 1024) {
    toast('3MB가 넘는 파일은 TIP 창에 직접 끌어다 놓아 주세요');
  }
  try {
    const dataUrl = item.file.size <= 3 * 1024 * 1024 ? await readDataUrl(item.file) : null;
    if (dataUrl) {
      localStorage.setItem('tip.handoff.v1', JSON.stringify({
        moduleId, name: item.file.name, type: item.file.type, dataUrl, created: Date.now(),
      }));
    }
    if (TAURI) {
      await invoke('open_tool', { id: moduleId, title: mod ? mod.name : moduleId });
      setExpanded(false);
    } else {
      location.href = `./index.html?module=${encodeURIComponent(moduleId)}`;
    }
    if (dataUrl) toast(`${mod ? mod.shortName || mod.name : moduleId}로 보냈습니다`);
  } catch (error) {
    console.error('[TIP notch] 보관함 파일을 보내지 못했습니다', error);
    toast('파일을 보내지 못했습니다');
  }
}

/* 타이머 */

let timerLeft = 0;
let timerTick = null;

function timerCard() {
  return widgetCard('timer', `
    <div class="wg-head">
      <span class="wg-label">타이머</span>
      <span class="wg-side" id="timer-side">대기</span>
    </div>
    <div class="timer-body">
      <b class="timer-display" id="timer-display">00:00</b>
      <div class="timer-row">
        <button class="timer-chip" type="button" data-min="1">1분</button>
        <button class="timer-chip" type="button" data-min="5">5분</button>
        <button class="timer-chip" type="button" data-min="10">10분</button>
        <button class="timer-btn" type="button" id="timer-toggle">시작</button>
      </div>
    </div>
  `);
}

function paintTimer() {
  const display = panelEl.querySelector('#timer-display');
  if (!display) return;
  const seconds = Math.max(0, Math.ceil(timerLeft));
  display.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  display.classList.toggle('is-running', timerLeft > 0 && !!timerTick);
  const side = panelEl.querySelector('#timer-side');
  if (side) side.textContent = timerTick ? '진행 중' : (timerLeft > 0 ? '일시정지' : '대기');
  const toggle = panelEl.querySelector('#timer-toggle');
  if (toggle) toggle.textContent = timerTick ? '일시정지' : (timerLeft > 0 ? '계속' : '시작');
}

function startTimer() {
  clearInterval(timerTick);
  timerTick = setInterval(() => {
    timerLeft = Math.max(0, timerLeft - 0.25);
    paintTimer();
    if (timerLeft <= 0) {
      clearInterval(timerTick);
      timerTick = null;
      paintTimer();
      toast('타이머가 끝났습니다');
      try {
        new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=').play();
      } catch { /* 소리는 못 내도 알림은 남는다 */ }
    }
  }, 250);
}

/* 빠른 메모 */

function memoCard() {
  let saved = '';
  try { saved = localStorage.getItem('tip.quickMemo.v1') || ''; } catch { saved = ''; }
  const card = widgetCard('memo', `
    <div class="wg-head">
      <span class="wg-label">빠른 메모</span>
      <span class="wg-side" id="memo-side"></span>
    </div>
    <textarea class="memo-input" id="memo-input" rows="3" placeholder="한 줄 메모 — 바로 저장됩니다">${escapeHtml(saved)}</textarea>
  `);
  requestAnimationFrame(() => {
    const input = card.querySelector('#memo-input');
    const side = card.querySelector('#memo-side');
    if (!input) return;
    const paint = () => { if (side) side.textContent = `${input.value.length}자`; };
    paint();
    let saveTimer = null;
    input.addEventListener('input', () => {
      paint();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem('tip.quickMemo.v1', input.value); } catch { /* 저장 못하면 이번만 */ }
      }, 350);
    });
    input.addEventListener('focus', () => {
      openHeld();
      // v1.12.2 — borderless NSPanel 은 스스로 key window 가 되지 못한다. 클릭한 순간
      // 창을 key window 로 만들어야 키보드 입력이 들어간다.
      invoke('notch_focus').catch(() => {});
    });
    input.addEventListener('mousedown', () => { invoke('notch_focus').catch(() => {}); });
    input.addEventListener('blur', () => { heldOpen = false; scheduleCollapse(); });
  });
  return card;
}

/* 웹캠 거울 */

function mirrorCard() {
  return widgetCard('mirror', `
    <div class="wg-head">
      <span class="wg-label">거울</span>
      <span class="wg-side" id="mirror-side">꺼짐</span>
    </div>
    <div class="mirror-body">
      <video class="mirror-video" id="mirror-video" playsinline muted></video>
      <button class="mirror-toggle" type="button" id="mirror-toggle">카메라 켜기</button>
    </div>
  `);
}

let mirrorStream = null;

async function toggleMirror() {
  const video = panelEl.querySelector('#mirror-video');
  const btn = panelEl.querySelector('#mirror-toggle');
  const side = panelEl.querySelector('#mirror-side');
  if (!video || !btn) return;
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
    video.srcObject = null;
    video.classList.remove('is-live');
    btn.textContent = '카메라 켜기';
    if (side) side.textContent = '꺼짐';
    heldOpen = false;
    scheduleCollapse();
    return;
  }
  try {
    mirrorStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = mirrorStream;
    await video.play().catch(() => {});
    video.classList.add('is-live');
    btn.textContent = '끄기';
    if (side) side.textContent = '켜짐';
    openHeld();
  } catch (error) {
    console.error('[TIP notch] 카메라를 열지 못했습니다', error);
    toast('카메라를 열 수 없습니다 — 시스템 설정에서 카메라 접근을 허용해 주세요');
  }
}

/* 모듈 실행 */

function launcherCard() {
  const card = widgetCard('launcher', `
    <div class="wg-head">
      <span class="wg-label">모듈 실행</span>
      <span class="wg-side">켜 둔 모듈</span>
    </div>
    <div class="launcher-row" id="launcher-row"></div>
  `, 'wg-wide');
  requestAnimationFrame(() => {
    const row = card.querySelector('#launcher-row');
    if (!row) return;
    // v1.14.0 — 노치에서도 바로 새 스티커 한 장.
    if (TAURI) {
      const add = document.createElement('button');
      add.className = 'launcher-tile launcher-new';
      add.type = 'button';
      add.title = '새 스티커 메모';
      add.innerHTML = '<span class="launcher-icon" aria-hidden="true">+</span><span>새 스티커</span>';
      add.addEventListener('click', async () => {
        try {
          await invoke('sticky_create', {});
          setExpanded(false);
        } catch (error) {
          console.error('[TIP notch] 스티커를 띄우지 못했습니다', error);
          toast('스티커를 띄우지 못했습니다');
        }
      });
      row.append(add);
    }

    const ids = quickOrderIds();
    if (!ids.length) {
      if (!TAURI) row.innerHTML = '<p class="launcher-empty">켜 둔 모듈이 없습니다</p>';
      return;
    }
    ids.forEach((id) => {
      const mod = getModule(id);
      if (!mod) return;
      const btn = document.createElement('button');
      btn.className = 'launcher-tile';
      btn.type = 'button';
      btn.title = mod.name;
      btn.innerHTML = `<span class="launcher-icon">${mod.icon || ''}</span><span>${escapeHtml(mod.shortName || mod.name)}</span>`;
      btn.addEventListener('click', async () => {
        try {
          if (TAURI) await invoke('open_tool', { id, title: mod.name });
          else location.href = `./index.html?module=${encodeURIComponent(id)}`;
          setExpanded(false);
        } catch (error) {
          console.error('[TIP notch] 모듈을 열지 못했습니다', error);
          toast('모듈을 열지 못했습니다');
        }
      });
      row.append(btn);
    });
  });
  return card;
}

/* ------------------------------ 위젯 생명주기 ------------------------------ */

function startWidgets() {
  // 창 크기 변경(notch_expand)과 무거운 조회가 겹치지 않도록 첫 조회는 다음 프레임 뒤로 미룬다.
  clearTimeout(widgetsDelay);
  widgetsDelay = setTimeout(() => {
    if (!expanded) return;
    refreshMedia();
    refreshCalendar();
  }, 220);
  clearInterval(mediaTimer);
  clearInterval(calendarTimer);
  mediaTimer = setInterval(refreshMedia, 5000);
  calendarTimer = setInterval(refreshCalendar, 5 * 60 * 1000);
}

function stopWidgets() {
  clearTimeout(widgetsDelay);
  widgetsDelay = null;
  clearInterval(mediaTimer);
  clearInterval(calendarTimer);
  mediaTimer = null;
  calendarTimer = null;
  clearInterval(timerTick);
  if (timerLeft <= 0) timerTick = null;
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
    const video = panelEl.querySelector('#mirror-video');
    if (video) { video.srcObject = null; video.classList.remove('is-live'); }
  }
}

function openHeld() {
  heldOpen = true;
  cancelCollapse();
  setTimeout(() => { heldOpen = false; syncHold(); }, 1200);
  syncHold();
}

/* ------------------------------ 이벤트 ------------------------------ */

pillEl.addEventListener('click', () => {
  // v1.12.3 — 펼침은 클릭으로만. (마우스오버 자동 펼침은 다른 앱을 쓰다 지나가도 화면을 가려 뻈다.)
  setExpanded(!expanded);
});
// 설정에서 '마우스를 올려서 열기'를 켰을 때만 hover 로 펼친다(기본 OFF, v1.12.3).
pillEl.addEventListener('mouseenter', () => {
  if (getNotchSettings().hoverOpen) setExpanded(true);
});
notchEl.addEventListener('mouseenter', cancelCollapse);
notchEl.addEventListener('mouseleave', scheduleCollapse);
panelEl.addEventListener('mouseenter', cancelCollapse);

// 패널 안의 위젯 버튼 — 위임 처리
panelEl.addEventListener('click', (event) => {
  // v1.13.0 — 캘린더 카드(아이콘·카드 아무 곳)를 누르면 달력 보기가 열린다.
  if (event.target.closest('[data-cal-open]') || event.target.closest('#cal-open')) {
    openCalendarView();
    return;
  }
  if (event.target.closest('[data-cal-perm]')) {
    invoke('open_privacy_settings', { kind: 'calendars' }).catch(() => toast('시스템 설정을 열지 못했습니다'));
    return;
  }
  const calDate = event.target.closest('[data-cal-date]');
  if (calDate) {
    selectCalendarDay(calDate.dataset.calDate);
    return;
  }
  const calMode = event.target.closest('[data-cal-mode]');
  if (calMode) {
    setCalendarMode(calMode.dataset.calMode);
    return;
  }
  const calStep = event.target.closest('[data-cal-step]');
  if (calStep) {
    stepCalendar(Number(calStep.dataset.calStep) || 0);
    return;
  }
  if (event.target.closest('#cal-view-close')) {
    closeCalendarView();
    return;
  }
  if (event.target.closest('#cal-view-title') || event.target.closest('#cal-today-btn')) {
    goCalendarToday();
    return;
  }
  if (event.target.closest('#cal-filter-btn')) {
    toggleCalendarFilter();
    return;
  }
  const calAll = event.target.closest('[data-cal-filter]');
  if (calAll) {
    setAllCalendars(calAll.dataset.calFilter !== 'none');
    return;
  }

  // v1.12.3 — 카드의 '권한 설정' 버튼 — 시스템 설정의 해당 개인정보 보호 항목을 연다.
  if (event.target.closest('#media-perm')) {
    invoke('open_privacy_settings', { kind: 'automation' }).catch(() => toast('시스템 설정을 열지 못했습니다'));
    return;
  }
  if (event.target.closest('#cal-perm')) {
    invoke('open_privacy_settings', { kind: 'calendars' }).catch(() => toast('시스템 설정을 열지 못했습니다'));
    return;
  }

  const mediaBtn = event.target.closest('[data-media]');
  if (mediaBtn) {
    const action = mediaBtn.dataset.media;
    invoke('media_control', { action })
      .then(() => setTimeout(refreshMedia, 350))
      .catch((error) => {
        if (isPermissionError(error)) {
          toast('음악 앱 자동화 권한이 필요합니다 — 권한 설정을 눌러 주세요');
          refreshMedia();   // 카드에 '권한 설정' 버튼을 띄운다
        } else {
          toast('음악 앱을 조작하지 못했습니다');
        }
      });
    return;
  }

  if (event.target.closest('#timer-toggle')) {
    if (timerTick) {
      clearInterval(timerTick);
      timerTick = null;
    } else {
      if (timerLeft <= 0) timerLeft = 5 * 60;
      startTimer();
    }
    paintTimer();
    return;
  }

  const minBtn = event.target.closest('[data-min]');
  if (minBtn) {
    clearInterval(timerTick);
    timerTick = null;
    timerLeft = Number(minBtn.dataset.min) * 60;
    paintTimer();
    openHeld();
    return;
  }

  if (event.target.closest('#shelf-drop')) {
    const picker = panelEl.querySelector('#shelf-file');
    if (picker) picker.click();
    return;
  }

  if (event.target.closest('#mirror-toggle')) toggleMirror();
  if (event.target.closest('#collapse')) setExpanded(false);
  if (event.target.closest('#open-home')) {
    invoke('open_main', { module: null, settings: false });
    setExpanded(false);
  }
  if (event.target.closest('#open-settings')) {
    invoke('open_main', { module: null, settings: true });
    setExpanded(false);
  }
});

// v1.13.0 — 독립 캘린더 필터 — 체크를 바꾸면 바로 다시 읽는다(달력과 노치 요약 모두).
panelEl.addEventListener('change', (event) => {
  const box = event.target.closest('input[data-cal-id]');
  if (!box) return;
  setCalendarChecked(box.dataset.calId, box.checked);
});

/* 파일 끌어다 놓기 — 두 갈래를 모두 받는다. (v1.12.2)
   ① Tauri 네이티브: Rust 가 tip://shelf-drag / tip://shelf-drop(경로 목록)을 보낸다.
      NonactivatingPanel + WKWebView 에서는 HTML5 dataTransfer 로 파일이 오지 않았다.
   ② HTML5: 브라우저·미리보기처럼 dataTransfer 로 오는 경우의 대비. */

function setDragState(on) {
  dragHeld = !!on;
  const drop = panelEl.querySelector('#shelf-drop');
  if (drop) drop.classList.toggle('is-over', dragHeld);
  syncHold();
  if (dragHeld) {
    cancelCollapse();
    if (!expanded) setExpanded(true);
  } else {
    scheduleCollapse();
  }
}

window.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  setDragState(true);
});

window.addEventListener('dragenter', (event) => {
  event.preventDefault();
  setDragState(true);
});

window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget) return;   // 창 안에서 움직인 것은 무시
  setDragState(false);
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  setDragState(false);
  const files = event.dataTransfer && event.dataTransfer.files;
  if (!files || !files.length) return;
  if (!expanded) setExpanded(true);
  if (!panelEl.querySelector('#shelf-list')) {
    toast('환경설정에서 임시 보관함 위젯을 켜 주세요');
    return;
  }
  addFiles(files);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    setExpanded(false);
  }
});

// 창 크기가 바뀌면 Rust 가 접거나 펼친 것 — 화면도 맞춘다.
function syncLayout() {
  const wide = window.innerWidth >= 320;
  if (wide && !expanded) {
    expanded = true;
    notchEl.classList.remove('is-collapsed');
    notchEl.classList.add('is-expanded');
    startWidgets();
  } else if (!wide && expanded) {
    expanded = false;
    notchEl.classList.remove('is-expanded');
    notchEl.classList.add('is-collapsed');
    stopWidgets();
  }
}
window.addEventListener('resize', syncLayout);

window.addEventListener('storage', refreshFromSettings);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!getTheme()) applyAppearance();   // 시스템 모드를 따르는 중이면 노치도 따라간다
});

if (TAURI && window.__TAURI__.event) {
  const listen = (name, handler) => {
    try {
      const result = window.__TAURI__.event.listen(name, handler);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* 이벤트를 못 듣게 되면 펼칠 때 다시 읽는 것으로 물러선다 */ }
  };

  // 환경설정(테마·기본 색·위젯·퀵바 순서)이 바뀌면 노치도 즉시 다시 그린다.
  listen('tip://notch-refresh', refreshFromSettings);

  // v1.12.4 — Rust 의 커서 감시가 알리는 '알약 위로 커서가 들어왔다/나갔다'.
  // WKWebView 는 앱이 백그라운드일 때 DOM mouseenter 를 보내지 않아, 다른 앱을 쓰는 중에도
  // 이 이벤트로 펼치고 접는다.
  listen('tip://notch-hover-enter', () => {
    if (!expanded && getNotchSettings().hoverOpen) setExpanded(true);
  });
  listen('tip://notch-hover-leave', () => {
    if (expanded) setExpanded(false);
  });

  // Finder 파일 드래그 — 들어오면 펼치고, 놓으면 경로를 읽어 보관함에 담는다.
  listen('tip://shelf-drag', (event) => setDragState(!!(event && event.payload)));
  listen('tip://shelf-drop', (event) => {
    setDragState(false);
    addShelfPaths(event && event.payload).catch(() => toast('파일을 담지 못했습니다'));
  });
}

/* ------------------------------ 설정 다시 읽기 ------------------------------ */

/** 저장된 설정을 새로 읽어 모양·위젯 목록을 다시 그린다. 펼쳐져 있으면 조회도 새로 한다. */
function refreshFromSettings() {
  syncStore();
  applyAppearance();
  settingsRev += 1;
  renderWidgets();
  // 마우스 오버 설정이 바뀌면 Rust 커서 감시도 바로 따라가게 한다(v1.12.4).
  invoke('set_notch_hover', { enabled: getNotchSettings().hoverOpen }).catch(() => {});
  if (expanded) {
    refreshMedia();
    refreshCalendar();
  }
}

/* ------------------------------ 시작 ------------------------------ */

if (new URLSearchParams(location.search).has('bg')) {
  document.body.classList.add('has-preview-bg');
}

applyAppearance();
renderWidgets();
syncLayout();
// 노치 창이 직접 저장값을 Rust 에 밀어 준다 — 메인 창이 닫혀 있어도 커서 감시가 맞게 돈다.
invoke('set_notch_hover', { enabled: getNotchSettings().hoverOpen }).catch(() => {});

// 빠른 메모 입력 중·파일 드래그 중에는 Rust 가 접지 않게 한다(v1.12.4).
document.addEventListener('focusin', syncHold);
document.addEventListener('focusout', () => setTimeout(syncHold, 0));
