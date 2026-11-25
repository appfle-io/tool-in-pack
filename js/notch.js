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
 *
 * v1.17.0 — 반원 퀵바 창(radial.html)을 이 창 안의 '간단히 보기'로 옮겼다.
 *   펼친 판(#sheet)은 두 화면을 갖는다: 간단히 보기(#dial, 반원 다이얼) / 전체 보기(#panel).
 *   · 여는 길: 알약 클릭 · 메뉴 막대 TIP 아이콘(tip://notch-tray) · 마우스 올리기(설정). 처음 화면은
 *     환경설정 '노치 시작 화면'(tip.notch.v1 startView)을 따른다.
 *   · 클릭이나 메뉴 막대로 열었을 때만 키보드 포커스를 가져간다(찾기 칸 또는 빠른 메모).
 *     마우스를 올려 열렸을 때는 다른 앱에서 치던 글자를 가져가지 않는다.
 *   · 달력은 열기 직전 화면을 기억했다가 닫으면 그 화면(반원/전체 보기)으로 돌아간다.
 *   · 파일을 노치로 끌어 놓으면 펼치지 않고 임시 보관함에 담는다. 반원에는 개수만, 목록은 전체 보기에만.
 *   · 회전 규칙은 js/dial.js 를 반원과 '켜 둔 모듈' 한 줄이 함께 쓴다.
 */

import { getModule } from '../modules/registry.js';
import { quickOrderIds } from './quickbar.js';
import { getNotchSettings, syncStore, applyTheme, getTheme, getQuickbarOpacity } from './store.js';
import { recentIds, getRecentEnabled } from './recent.js';
import {
  DIAL_SLOTS, offsetOf, clampPos, centerIndex, targetFor, atEnds,
  clampRowStart, rowWindow, rowPositionLabel, rowAtEnds, findIndex,
} from './dial.js';
import {
  timerState, remainingSeconds, startTimer, toggleTimer, resetTimer, extendTimer,
  formatClock, describeSeconds, TIMER_PRESETS, tickTimer, alertTimerDone,
} from './timer-store.js';

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
let calendarTimer = null;
let widgetsDelay = null;      // 펼친 뒤 위젯 조회를 조금 미루는 타이머
let mediaBusy = false;        // 조회가 끝나기 전에 또 부르지 않는다
let calendarBusy = false;
let mediaPlaying = false;

/* v1.15.0 — 접힌 알약의 음악·타이머 상태. osascript 4.5초 조회를 화면이 0.5초마다 보간한다. */
let mediaState = null;
let mediaError = null;
let mediaPolledAt = 0;        // performance.now() 기준
let pillMediaTimer = null;
let pillTickTimer = null;
let pillModeSent = '';        // 마지막으로 Rust 에 알린 알약 내용(media|timer)
let notchInfo = { hasNotch: false, notchWidth: 0, notchHeight: 0 };
let settingsRev = 0;          // 설정이 바뀔 때마다 +1 — 화면에 그린 마지막 상태와 비교한다
let renderedSignature = '';   // 마지막으로 그린 설정(저장값) — 펼칠 때마다 달라졌는지 싼 값으로 본다
let dragHeld = false;         // Finder 파일을 끌고 노치 위에 있는 동안에는 접지 않는다
/* v1.17.1 — '방금 열었다' 보호. 알약·메뉴 막대를 누르면 커서가 판 바깥(위쪽 노치 자리)에 있는 채로
   판이 아래로 펼쳐져 DOM mouseleave 가 한 번 올 수 있다. 오픈한 지 1.5초 안에 커서가 판 안에
   들어온 적이 없으면 접지 않는다 — 마우스를 올려 연 경우에는 기다리지 않는다. */
let openedAt = 0;
let openedVia = 'click';      // 'click' | 'tray' | 'hover'
let enteredSinceOpen = false;

/* v1.17.0 — 펼친 판의 화면 */
const sheetEl = document.getElementById('sheet');
const dialEl = document.getElementById('dial');
let view = 'simple';          // 펼쳤을 때 보이는 화면: 'simple'(반원) | 'full'(전체 보기)
let calReturnTo = 'full';     // 달력을 닫으면 돌아갈 화면
let openedWithKeys = false;   // 클릭·메뉴 막대로 열었는지 — 이때만 키보드 포커스를 가져간다
let mediaPausedAt = 0;        // 음악이 멈춘 시각 — 멈춘 뒤 5분까지는 알약에 멈춘 이퀄라이저를 둔다
let timerDoneAt = 0;          // 타이머가 끝난 시각 — 5초 동안 '완료'를 보이고 숨긴다
let pillNoteText = '';        // 알약에 잠깐 보일 글자(놓기 안내·담은 개수)
let pillNoteTimer = null;
const DIAL_BASE_H = 252;      // 반원 판 높이(노치 화면에서는 노치 높이만큼 더한다)
const MEDIA_PAUSE_KEEP_MS = 5 * 60 * 1000;
const TIMER_DONE_KEEP_MS = 5000;

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
      localStorage.getItem('tip.recent.enabled.v1') || '',
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

/* ------------------------------ 패널 높이 맞춤 (v1.15.2) ------------------------------ */

let fitTimer = null;
let fitSent = 0;

/** 펼친 패널이 실제로 필요한 높이 — 창 높이(max-height 100%)에 가려지지 않게 자식들의 높이를 더한다. */
function panelContentHeight() {
  const style = getComputedStyle(panelEl);
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;
  const gap = parseFloat(style.rowGap || style.gap) || 0;
  const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  const kids = [...panelEl.children].filter((el) => {
    if (el.hidden) return false;
    if (el.id === 'panel-hint' && el.hidden) return false;
    return el.getClientRects().length > 0;
  });
  if (!kids.length) return 0;
  let total = padTop + padBottom + border + (kids.length - 1) * gap;
  kids.forEach((el) => {
    // 위젯 상자는 남는 공간을 채우므로 내용 높이(scrollHeight)를 쓴다.
    total += el.classList.contains('widgets') ? Math.max(el.scrollHeight, 0) : el.getBoundingClientRect().height;
  });
  return Math.ceil(total);
}

/** 반원 판의 높이 — 노치 화면이면 물리 노치 높이만큼 아래로 내린다(가운데 글자가 노치에 가리지 않게). */
function dialHeight() {
  return DIAL_BASE_H + dialOffset();
}

function dialOffset() {
  return notchInfo.hasNotch ? Math.round(notchInfo.notchHeight || 0) : 0;
}

/** 지금 화면이 바라는 판 높이 — 반원은 고정, 전체 보기·달력은 내용 높이. */
function sheetTargetHeight() {
  if (view === 'simple' && !calView.open) return dialHeight();
  return Math.max(dialHeight(), Math.min(600, panelContentHeight() || 0));
}

let shrinkTimer = null;

/** 판 높이를 맞추고 Rust 에 창 높이를 알린다(v1.15.2 → v1.17.0).
 *  커질 때는 창을 먼저 키우고 판이 따라 늘어나게, 작아질 때는 판이 다 줄어든 뒤 창을 줄인다. */
function fitPanel({ now = false } = {}) {
  if (!expanded) return;
  clearTimeout(fitTimer);
  const run = () => {
    if (!expanded) return;
    const height = sheetTargetHeight();
    if (!height) return;
    const before = parseFloat(sheetEl.style.height) || height;
    sheetEl.style.height = `${height}px`;
    if (!TAURI || Math.abs(height - fitSent) < 8) return;
    clearTimeout(shrinkTimer);
    const send = () => {
      fitSent = height;
      invoke('notch_resize', { height }).catch(() => {});
    };
    if (height < before - 1 && !reducedMotion()) shrinkTimer = setTimeout(send, 280);
    else send();
  };
  if (now) run();
  else fitTimer = setTimeout(run, 160);
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* ------------------------------ 펼침/접힘 ------------------------------ */

/** 노치를 연다 — 처음 화면은 '노치 시작 화면' 설정. via: 'click' | 'tray' | 'hover'. */
function openNotch(via = 'click') {
  view = getNotchSettings().startView;
  openedWithKeys = via === 'click' || via === 'tray';
  openedVia = via;
  if (expanded) {
    applyView();
    focusForView();
    return;
  }
  setExpanded(true);
}

function setExpanded(next, { animate = true } = {}) {
  if (expanded === next) return;
  expanded = next;
  if (!animate) notchEl.classList.add('no-anim');
  notchEl.classList.toggle('is-collapsed', !next);
  notchEl.classList.toggle('is-expanded', next);

  if (next) {
    hintCounted = false;
    openedAt = Date.now();
    enteredSinceOpen = false;
    // 화면 전환(판 그리기)을 먼저 끝내고 다음 프레임에 창 크기를 바꾼다.
    // 창 리사이즈와 위젯 조회가 같은 순간에 몰려 멈추지 않도록 조회는 startWidgets 가 미룬다.
    if (renderedSignature !== settingsSignature()) renderWidgets();
    applyAppearance();
    applyView();
    const height = sheetTargetHeight();
    fitSent = height;
    sheetEl.style.height = `${height}px`;
    requestAnimationFrame(() => {
      // 펼치기 전에 원하는 높이를 먼저 알려 둔다 — 처음부터 그 크기로 열린다.
      invoke('notch_resize', { height }).catch(() => {}).finally(() => {
        invoke('notch_expand').catch(() => {});
      });
    });
    startWidgets();
    focusForView();
  } else {
    // v1.17.0 — 다시 열면 달력이 아니라 시작 화면으로 연다.
    if (calView.open) closeCalendarView({ restore: false });
    invoke('notch_collapse').catch(() => {});
    stopWidgets();
    closeCalendarForm();
    heldOpen = false;
    openedWithKeys = false;
    cancelCollapse();
    // v1.17.1 — 접을 때 안쪽 입력칸의 초점을 놓는다. 초점이 남아 있으면 syncHold 가 계속
    // '입력 중'으로 알려 Rust 커서 감시가 펼친 판을 영영 접지 않았다(마우스를 치워도 그대로).
    const active = document.activeElement;
    if (active && active !== document.body && notchEl.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
    const find = document.getElementById('dial-find');
    if (find) find.value = '';
  }
  syncHold();
  paintPill();
  if (!animate) requestAnimationFrame(() => notchEl.classList.remove('no-anim'));
}

/** 간단히 보기 ↔ 전체 보기 — 판은 그대로 두고 높이·모서리만 바꾼다. */
function setView(next, { focus = true } = {}) {
  if (!['simple', 'full'].includes(next)) return;
  view = next;
  applyView();
  if (focus) focusForView({ force: true });
}

function applyView() {
  const simple = view === 'simple' && !calView.open;
  notchEl.classList.toggle('is-simple', simple);
  notchEl.classList.toggle('is-full', !simple);
  // 보이지 않는 화면은 Tab 순서와 스크린 리더에서 뺀다.
  dialEl.inert = !simple;
  panelEl.inert = simple;
  dialEl.setAttribute('aria-hidden', String(!simple));
  panelEl.setAttribute('aria-hidden', String(simple));
  if (simple) renderDial();
  else paintPanelHint();
  paintDialSides();
  fitPanel({ now: true });
}

/** 클릭·메뉴 막대로 열었을 때만 — 반원은 찾기 칸, 전체 보기는 빠른 메모. */
function focusForView({ force = false } = {}) {
  if (!openedWithKeys && !force) return;
  const target = view === 'simple' && !calView.open
    ? document.getElementById('dial-find')
    : (panelEl.querySelector('#memo-input') || panelEl.querySelector('#to-simple'));
  if (!target) return;
  const focus = () => requestAnimationFrame(() => {
    if (document.activeElement !== target) target.focus({ preventScroll: true });
  });
  if (TAURI) invoke('notch_focus').catch(() => {}).finally(focus);
  else focus();
}

/** '노치에서 마우스를 내리면 접힙니다' 안내 — 전체 보기를 처음 세 번 열 때만. */
const HINT_KEY = 'tip.notch.hintCount.v1';
let hintCounted = false;
function paintPanelHint() {
  const hint = panelEl.querySelector('#panel-hint');
  if (!hint) return;
  let count = 0;
  try { count = Number(localStorage.getItem(HINT_KEY)) || 0; } catch { count = 0; }
  hint.hidden = count > 3 || calView.open;
  if (!hintCounted && count <= 3) {
    hintCounted = true;   // 한 번 열 때 한 번만 센다
    try { localStorage.setItem(HINT_KEY, String(count + 1)); } catch { /* 못 세면 계속 보인다 */ }
  }
}

/** Rust 의 커서 감시에 '지금은 접지 마라'를 알린다 — 입력 중·드래그 중·거울이 켜진 동안(v1.12.4).
 *  v1.17.1 — 초점이 있다는 것만으로는 '입력 중'이 아니다. 클릭으로 열면 찾기 칸이 저절로
 *  초점을 가져가는데, 그 상태를 계속 입력 중으로 보면 마우스를 치워도 판이 접히지 않았다. */
function syncHold() {
  if (!TAURI) return;
  const hold = !!(notchHeld() || typingNow());
  invoke('notch_hover_hold', { hold }).catch(() => {});
}

/** 지금 글자를 치는 중인가 — 방금(3초) 고쳤거나, 쓰던 글이 남아 있거나, 고르기 창이 열리는 칸. */
const TYPING_KEEP_MS = 3000;
let typedAt = 0;
let typingTimer = null;

function typingNow() {
  const active = document.activeElement;
  if (!expanded || !active || active === document.body || !notchEl.contains(active) || !active.matches) return false;
  if (active.matches('select')) return true;                                        // 고르기 목록이 펼쳐진다
  if (active.matches('input[type="date"], input[type="time"]')) return true;        // 날짜·시간 고르기 창
  if (!active.matches('input, textarea')) return false;
  if (Date.now() - typedAt < TYPING_KEEP_MS) return true;                           // 방금 쳤다
  return String(active.value || '').trim().length > 0;                              // 쓰던 글이 그대로 있다
}

/** 글자를 칠 때마다 '입력 중' 시계를 다시 건다 — 멈추면 3초 뒤 스스로 풀린다(그때 접힘도 다시 본다). */
function noteTyping() {
  typedAt = Date.now();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    syncHold();
    if (expanded) scheduleCollapse();   // 커서가 이미 밖이면 Rust 감시가 0.7초 뒤 접는다
  }, TYPING_KEEP_MS + 50);
  syncHold();
}

/** 접지 않아야 하는 이유들 — 펼친 뒤 잠깐(openHeld), 파일 드래그, 웹캠 거울. */
function notchHeld() {
  return heldOpen || dragHeld || !!mirrorStream;
}

/** 커서가 정말 창 밖에 있는지 — Mac 앱에서는 Rust 가 실제 창 사각형과 커서 위치로 본다(v1.17.1).
 *  창 크기가 바뀌는 순간이나 투명 여백을 지날 때 DOM mouseleave 가 이벤트 없이 와도,
 *  커서가 창 안이면 접지 않는다. 브라우저 미리보기에서는 DOM 판정만 쓴다. */
async function cursorOutside() {
  if (TAURI) {
    try {
      const inside = await invoke('notch_cursor_inside');
      if (typeof inside === 'boolean') return !inside;
    } catch { /* 못 물으면 DOM 판정으로 물러선다 */ }
  }
  return true;
}

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(async () => {
    if (!expanded) return;
    if (notchHeld()) return;
    if (document.querySelector('.mirror-video.is-live')) return;
    if (typingNow()) return;
    if (!(await cursorOutside())) return;   // v1.17.1 — 커서가 창 안이면 접지 않는다(영역 오판 방지)
    if (!expanded) return;
    // 방금 열었고 커서가 한 번도 판 안에 들어오지 않았다 — 마우스가 알약(노치 자리)에 있다.
    if (openedVia !== 'hover' && !enteredSinceOpen && Date.now() - openedAt < 1500) return;
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

/** 같은 줄에 놓을 카드 묶음 — 행끼리는 세로, 행 안의 카드는 높이를 맞춘다(v1.15.2). */
function widgetRow() {
  const row = document.createElement('div');
  row.className = 'wg-row';
  return row;
}

function renderWidgets() {
  syncStore();
  const { widgets } = getNotchSettings();
  widgetsEl.innerHTML = '';

  /* v1.17.0 — 전체 보기 배치(위에서 아래로, 폭 640):
       1줄 [지금 재생 중][다가오는 일정][타이머] — 세 칸, 같은 높이
       2줄 [빠른 메모][임시 보관함(두 칸)]
       3줄 [최근 사용]  4줄 [켜 둔 모듈 한 줄]  5줄 [웹캠 거울]
     꺼 둔 위젯은 빼고, 남은 카드끼리 빈칸 없이 채운다. */
  let count = 0;
  const addRow = (cards, className = '') => {
    const list = cards.filter(Boolean);
    if (!list.length) return;
    const row = widgetRow();
    if (className) row.classList.add(className);
    row.append(...list);
    widgetsEl.append(row);
    count += list.length;
  };

  addRow([
    widgets.media ? mediaCard() : null,
    widgets.calendar ? calendarCard() : null,
    widgets.timer ? timerCard() : null,
  ], 'wg-row-status');
  addRow([
    widgets.memo ? memoCard() : null,
    widgets.shelf ? shelfCard() : null,
  ], 'wg-row-keep');
  if (widgets.recent && getRecentEnabled()) addRow([recentCard()]);
  if (widgets.launcher) addRow([launcherCard()]);
  if (widgets.mirror) addRow([mirrorCard()]);

  emptyEl.hidden = count > 0;
  // v1.13.0 — 달력 보기가 열려 있으면 위젯 목록은 그 아래에 두고 숨긴다.
  widgetsEl.hidden = calView.open ? true : count === 0;
  renderedSignature = settingsSignature();
  // 반원의 위젯 상태(달력·미디어·타이머·보관함 표시 여부)도 같이 맞춘다.
  paintDialSides();
  if (view === 'simple') renderDial();
  fitPanel();
}

/* 미디어 */

function mediaCard() {
  return widgetCard('media', `
    <div class="wg-head">
      <span class="wg-label">지금 재생 중</span>
      <span class="wg-side" id="media-app" hidden></span>
    </div>
    <div class="media-body">
      <div class="media-art" id="media-art" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>
      </div>
      <div class="media-text">
        <b id="media-title">재생 중인 곡 없음</b>
        <span id="media-artist">Apple Music, Spotify</span>
        <span class="media-progress" id="media-progress" hidden aria-hidden="true">
          <i id="media-progress-fill"></i>
        </span>
      </div>
      <div class="media-controls">
        <button class="media-btn" type="button" data-media="previous" aria-label="이전 곡" title="이전" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v14H7zM19 5v14l-9-7z"/></svg>
        </button>
        <button class="media-btn media-play" type="button" data-media="playpause" aria-label="재생 또는 일시정지" title="재생 또는 일시정지" disabled>
          <svg id="media-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="media-btn" type="button" data-media="next" aria-label="다음 곡" title="다음" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5h2v14h-2zM5 5v14l9-7z"/></svg>
        </button>
      </div>
    </div>
    <!-- v1.15.2 — 오류·권한 안내는 제목·아티스트 자리가 아니라 이 줄에 따로 보여 준다. -->
    <p class="wg-state" id="media-state" hidden></p>
    <button class="wg-perm" id="media-perm" type="button" hidden>권한 설정</button>
  `);
}

/** 미디어 상태를 읽어 카드와 접힌 알약을 함께 갱신한다(v1.15.0).
 *  예전에는 펼쳤을 때만 읽었는데, 이제는 접힌 알약에 곡 제목·진행률을 그려야 해서
 *  창이 접혀 있어도 4.5초마다 한 번 읽는다(윈도우는 0.5초마다 그 위치를 보간). */
async function fetchMedia() {
  if (!TAURI || mediaBusy) return;
  if (!getNotchSettings().widgets.media) {
    mediaState = null;
    paintPill();
    return;
  }
  mediaBusy = true;
  try {
    const state = await invoke('media_state');
    mediaState = {
      app: (state && state.app) || '',
      playing: !!(state && state.playing),
      title: (state && state.title) || '',
      artist: (state && state.artist) || '',
      position: Number(state && state.position) || 0,
      duration: Number(state && state.duration) || 0,
    };
    mediaPolledAt = performance.now();
    // v1.17.0 — 멈춘 시각을 기억한다. 멈춘 뒤 5분까지는 알약·반원에 '일시정지'로 남긴다.
    if (mediaState.playing || !mediaState.title) mediaPausedAt = 0;
    else if (!mediaPausedAt) mediaPausedAt = Date.now();
    mediaError = null;
    paintMediaCard();
    paintPill();
    updatePillMode();
  } catch (error) {
    mediaError = error;
    mediaState = null;
    paintMediaCard();
    paintPill();
    updatePillMode();
  } finally {
    mediaBusy = false;
  }
}

function refreshMedia() {
  return fetchMedia();
}

/** 펼친 패널의 미디어 카드 — 요소가 없으면(다른 위젯만 켜져 있으면) 조용히 넘어간다. */
/** 진행률 바만 0.5초마다 앞으로 — 조회(4.5초) 사이에도 음악이 흐르게(v1.15.2). */
function paintMediaProgress() {
  if (!expanded || !mediaState || !mediaState.duration) return;
  const progress = panelEl.querySelector('#media-progress');
  const fill = panelEl.querySelector('#media-progress-fill');
  if (!progress || !fill || progress.hidden) return;
  const percent = Math.max(0, Math.min(100, (mediaPositionNow() / mediaState.duration) * 100));
  fill.style.width = `${percent}%`;
}

function paintMediaCard() {
  const titleEl = panelEl.querySelector('#media-title');
  if (!titleEl) return;
  const card = panelEl.querySelector('.wg-media');
  const state = mediaState;
  const hasTrack = !!(state && state.title);
  const playing = !!(state && state.playing);
  mediaPlaying = playing;
  const appEl = panelEl.querySelector('#media-app');
  const artistEl = panelEl.querySelector('#media-artist');
  const progress = panelEl.querySelector('#media-progress');
  const fill = panelEl.querySelector('#media-progress-fill');
  const stateEl = panelEl.querySelector('#media-state');
  const permBtn = panelEl.querySelector('#media-perm');
  const buttons = panelEl.querySelectorAll('[data-media]');

  // 재생할 것이 없으면 버튼은 늘 잠가 둔다(v1.15.2).
  buttons.forEach((button) => { button.disabled = !hasTrack || !!mediaError; });

  if (mediaError) {
    // v1.15.2 — 권한·오류는 제목·아티스트 자리에 넣지 않고 별도 상태 줄에 보여 준다.
    const permission = isPermissionError(mediaError);
    if (card) card.classList.remove('is-compact');
    if (appEl) appEl.hidden = true;
    titleEl.hidden = true;
    if (artistEl) artistEl.hidden = true;
    if (progress) progress.hidden = true;
    if (stateEl) {
      stateEl.hidden = false;
      stateEl.textContent = permission
        ? '음악 앱 자동화 권한이 필요합니다'
        : '미디어 정보를 읽지 못했습니다';
      stateEl.title = permission ? '시스템 설정 › 개인정보 보호 및 보안 › 자동화에서 TIP을 허용하세요' : errorText(mediaError);
    }
    if (permBtn) permBtn.hidden = !permission;
    const dot = document.getElementById('pill-dot');
    if (dot) dot.classList.remove('is-playing');
    return;
  }

  if (stateEl) stateEl.hidden = true;
  if (permBtn) permBtn.hidden = true;
  titleEl.hidden = false;
  if (artistEl) artistEl.hidden = false;
  if (appEl) {
    if (!hasTrack) {
      // 한 줄로 접힌 카드에서는 상태를 오른쪽에 짧게 보여 준다('—' 대신).
      appEl.hidden = false;
      appEl.textContent = '재생 중인 곡 없음';
    } else {
      appEl.hidden = !(state && state.app);
      appEl.textContent = (state && state.app) || '';
    }
  }

  // v1.15.2 — 재생 중인 곡이 없으면 카드를 한 줄로 접는다.
  if (card) card.classList.toggle('is-compact', !hasTrack);
  titleEl.textContent = hasTrack ? state.title : '재생 중인 곡 없음';
  if (artistEl) {
    artistEl.textContent = hasTrack
      ? (state.artist || '재생 중')
      : 'Apple Music 또는 Spotify';
  }
  panelEl.querySelector('#media-icon').innerHTML = playing
    ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'
    : '<path d="M8 5v14l11-7z"/>';

  // 진행률 — 곡이 있을 때만.
  if (progress && fill) {
    const duration = state && state.duration > 0 ? state.duration : 0;
    progress.hidden = !hasTrack || !duration;
    fill.style.width = duration
      ? `${Math.max(0, Math.min(100, (mediaPositionNow() / duration) * 100))}%`
      : '0%';
  }

  const dot = document.getElementById('pill-dot');
  if (dot) dot.classList.toggle('is-playing', playing);
}

/* 캘린더 */

const CAL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3.5V6M16 3.5V6"/></svg>';

function calendarCard() {
  const card = widgetCard('calendar', `
    <div class="wg-head">
      <span class="wg-label">다가오는 일정</span>
      <span class="wg-side" id="cal-side" hidden></span>
      <span class="wg-tools">
        <button class="wg-link wg-add" type="button" data-cal-add="1" aria-label="일정 추가" title="일정 추가">+</button>
        <button class="wg-link" id="cal-open" type="button" aria-label="달력 열기" title="달력 열기">${CAL_ICON}</button>
      </span>
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
      writable: calendar.writable === true,
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
      <li class="cal-empty">캘린더 권한이 필요합니다. 시스템 설정 › 개인정보 보호 및 보안 › 캘린더에서 TIP을 허용하세요</li>
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

/* --------------------------- 캘린더 — 일정 추가 (v1.15.0) --------------------------- */

const calForm = { open: false, saving: false };

function calFormDom() {
  return {
    form: document.getElementById('cal-form'),
    title: document.getElementById('cal-form-title'),
    allDay: document.getElementById('cal-form-allday'),
    startDate: document.getElementById('cal-form-start-date'),
    startTime: document.getElementById('cal-form-start-time'),
    endDate: document.getElementById('cal-form-end-date'),
    endTime: document.getElementById('cal-form-end-time'),
    calendar: document.getElementById('cal-form-calendar'),
    note: document.getElementById('cal-form-note'),
    save: document.getElementById('cal-form-save'),
  };
}

/** 입력값(date·time)을 로컬 시각의 에포크 ms 로. 종일이면 그날 00:00. */
function formDateMs(dateValue, timeValue, allDay) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  if (!year || !month || !day) return NaN;
  if (allDay) return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  const [hour, minute] = String(timeValue || '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0).getTime();
}

function setFormDates(start, end) {
  const dom = calFormDom();
  if (!dom.startDate) return;
  dom.startDate.value = dayKey(start);
  dom.startTime.value = clock(start.getTime());
  dom.endDate.value = dayKey(end);
  dom.endTime.value = clock(end.getTime());
}

/** 종일 토글 — 시간 입력을 감추고 시작을 그날 00:00, 끝을 같은 날(또는 다음 날) 00:00 으로. */
function syncCalFormAllDay() {
  const dom = calFormDom();
  if (!dom.allDay) return;
  const allDay = dom.allDay.checked;
  dom.startTime.hidden = allDay;
  dom.endTime.hidden = allDay;
  if (allDay) {
    const start = formDateMs(dom.startDate.value, '00:00', true);
    const end = formDateMs(dom.endDate.value, '00:00', true);
    if (!(end > start)) dom.endDate.value = dayKey(addDays(new Date(start || Date.now()), 1));
  }
}

/** 일정 추가 폼을 연다 — 날짜를 골랐으면 그날이 기본. */
async function openCalendarForm(date = null) {
  if (!TAURI) {
    toast('일정 추가는 Mac 앱에서만 됩니다');
    return;
  }
  const dom = calFormDom();
  if (!dom.form) return;

  const base = date ? midnight(date) : new Date();
  if (!date) {
    base.setSeconds(0, 0);
    base.setMinutes(base.getMinutes() + (30 - (base.getMinutes() % 30 || 30)));
  } else {
    base.setHours(9, 0, 0, 0);
  }
  const end = new Date(base.getTime() + 60 * 60 * 1000);
  setFormDates(base, end);

  dom.title.value = '';
  dom.allDay.checked = false;
  syncCalFormAllDay();

  // 저장할 수 있는 캘린더만 — 읽기 전용(공휴일·구독)은 고를 수 없다.
  let calendars = calView.calendars;
  try {
    calendars = await loadCalendarList();
  } catch (error) {
    calendars = null;
  }
  const writable = (calendars || []).filter((calendar) => calendar.writable);
  dom.calendar.innerHTML = '';
  if (!writable.length) {
    dom.calendar.append(new Option('저장할 수 있는 캘린더가 없습니다', ''));
    dom.calendar.disabled = true;
    dom.save.disabled = true;
    dom.note.textContent = '캘린더 앱에서 계정을 확인하거나, 이 앱의 캘린더 권한(읽기와 쓰기)을 허용해 주세요.';
  } else {
    dom.calendar.disabled = false;
    dom.save.disabled = false;
    dom.note.textContent = '저장하면 맥 캘린더 앱에도 바로 보입니다.';
    const allowed = selectedCalendarIds();
    const preferred = writable.find((calendar) => !allowed || allowed.includes(calendar.id));
    writable.forEach((calendar) => {
      const label = calendar.source ? `${calendar.title} (${calendar.source})` : calendar.title;
      const option = new Option(label, calendar.id);
      option.selected = preferred ? calendar.id === preferred.id : false;
      dom.calendar.append(option);
    });
    if (!preferred && writable.length) dom.calendar.selectedIndex = 0;
  }

  calForm.open = true;
  dom.form.hidden = false;
  dom.form.scrollTop = 0;
  cancelCollapse();
  openHeld();
  setTimeout(() => { dom.title.focus(); invoke('notch_focus').catch(() => {}); }, 30);
}

function closeCalendarForm() {
  const dom = calFormDom();
  calForm.open = false;
  if (dom.form) dom.form.hidden = true;
}

async function saveCalendarEvent() {
  if (!TAURI || calForm.saving) return;
  const dom = calFormDom();
  const title = dom.title.value.trim();
  if (!title) {
    toast('일정 제목을 넣어 주세요');
    dom.title.focus();
    return;
  }
  const allDay = dom.allDay.checked;
  const startMs = formDateMs(dom.startDate.value, dom.startTime.value, allDay);
  const endMs = formDateMs(dom.endDate.value, dom.endTime.value, allDay);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    toast('끝 시각이 시작보다 빨라요');
    return;
  }
  const calendarId = dom.calendar.value || null;
  calForm.saving = true;
  dom.save.disabled = true;
  try {
    await invoke('calendar_create', { title, startMs, endMs, allDay, calendarId });
    closeCalendarForm();
    toast('일정을 저장했습니다');
    // Rust 가 조회 캐시를 비웠다 — 보이는 기간과 다가오는 일정을 다시 읽는다.
    calView.events = [];
    if (calView.open) loadCalendarView();
    refreshCalendar();
  } catch (error) {
    console.error('[TIP notch] 일정 저장', error);
    toast(errorText(error));
  } finally {
    calForm.saving = false;
    dom.save.disabled = false;
  }
}

/* --------------------------- 캘린더 — 조작 --------------------------- */

/** 달력 보기 — v1.17.0 부터 반원(간단히 보기)에서도 바로 연다.
 *  열기 직전 화면(반원/전체 보기)을 기억했다가, 닫으면 그 화면으로 돌아간다. */
function openCalendarView() {
  if (!TAURI) {
    toast('달력은 Mac 앱에서만 볼 수 있습니다');
    return;
  }
  const dom = calDom();
  if (!dom.view) return;
  if (!calView.open) calReturnTo = view;
  if (!expanded) {
    openedWithKeys = true;
    view = 'full';
    setExpanded(true);
  }
  calView.open = true;
  calView.selected = midnight(new Date());
  dom.view.hidden = false;
  widgetsEl.hidden = true;
  const hint = panelEl.querySelector('#panel-hint');
  if (hint) hint.hidden = true;
  cancelCollapse();
  const toSimple = panelEl.querySelector('#to-simple');
  if (toSimple) toSimple.hidden = true;   // 달력에서는 닫기 하나만 둔다
  applyView();
  renderCalendarView();
  loadCalendarView();
  fitPanel();
  const close = panelEl.querySelector('#cal-view-close');
  if (close && openedWithKeys) requestAnimationFrame(() => close.focus({ preventScroll: true }));
}

/** 달력 닫기 — restore 가 true 면 열기 전 화면으로 돌아간다(닫기 버튼·Esc). */
function closeCalendarView({ restore = true } = {}) {
  const dom = calDom();
  calView.open = false;
  calView.req += 1;              // 진행 중인 조회 결과는 버린다
  if (dom.view) dom.view.hidden = true;
  widgetsEl.hidden = widgetsEl.childElementCount === 0;
  if (dom.filterPanel) dom.filterPanel.hidden = true;
  const toSimple = panelEl.querySelector('#to-simple');
  if (toSimple) toSimple.hidden = false;
  if (restore && expanded) {
    setView(calReturnTo === 'simple' ? 'simple' : 'full', { focus: openedWithKeys });
  } else {
    fitPanel();
  }
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
    const card = panelEl.querySelector('.wg-calendar');
    const side = panelEl.querySelector('#cal-side');
    const permBtn = panelEl.querySelector('#cal-perm');
    // v1.17.0 — 반원의 달력 아이콘 툴팁·스크린 리더 이름에 다음 일정을 쓴다.
    nextEventText = rows.length
      ? `${rows[0].title} ${rows[0].allDay ? '종일' : `${clock(rows[0].start)} · ${relativeUntil(rows[0].start)}`}`
      : '';
    paintDialSides();
    if (!rows.length) {
      // v1.15.2 — 남은 일정이 없으면 한 줄로 접는다.
      if (card) card.classList.add('is-compact');
      if (side) {
        side.hidden = false;
        side.textContent = '남은 일정 없음';
      }
      list.innerHTML = '<li class="cal-empty">오늘 남은 일정이 없습니다</li>';
      if (permBtn) permBtn.hidden = true;
      fitPanel();
      return;
    }
    if (card) card.classList.remove('is-compact');
    if (side) side.hidden = true;
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
    fitPanel();
  } catch (error) {
    // v1.12.4 — 캘린더는 EventKit 권한을 쓴다. 권한이면 '권한 설정' 버튼,
    // 그 밖의 오류는 콘솔에만 남기지 않고 짧은 원인을 카드에 함께 보여 준다.
    const permission = isPermissionError(error);
    const card = panelEl.querySelector('.wg-calendar');
    const side = panelEl.querySelector('#cal-side');
    if (card) card.classList.remove('is-compact');
    if (side) side.hidden = true;
    list.innerHTML = permission
      ? '<li class="cal-empty">캘린더 권한이 필요합니다. 시스템 설정 › 개인정보 보호 및 보안 › 캘린더에서 TIP을 허용하세요</li>'
      : `<li class="cal-empty">캘린더를 읽지 못했습니다<span class="cal-error">${escapeHtml(errorText(error))}</span></li>`;
    const permBtn = panelEl.querySelector('#cal-perm');
    if (permBtn) permBtn.hidden = !permission;
    fitPanel();
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
      <button class="wg-link wg-add" type="button" data-shelf-add="1" aria-label="파일 추가" title="파일 추가" hidden>+</button>
    </div>
    <div class="shelf-drop" id="shelf-drop" role="button" tabindex="0" title="클릭해서 파일 고르기">
      <span class="shelf-drop-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>
      </span>
      <span class="shelf-drop-text">
        <b><span class="shelf-mini-label">임시 보관함</span> 파일을 노치로 끌어다 놓으면 여기에 잠시 보관해요</b>
        <span>클릭해서 고를 수도 있어요. 앱을 끄면 비워집니다</span>
      </span>
    </div>
    <!-- v1.12.2 — 드래그가 막히는 환경에서도 담을 수 있게 클릭 선택을 함께 둔다. -->
    <input class="shelf-file-input" id="shelf-file" type="file" multiple tabindex="-1" aria-hidden="true">
    <div class="shelf-list" id="shelf-list"></div>
  `);
  card.classList.add('is-empty');
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
  const card = panelEl.querySelector('.wg-shelf');
  paintDialSides();   // 반원의 보관함 개수도 같은 배열을 본다(v1.17.0)
  if (!list) return;
  if (count) count.textContent = `${shelf.length}개`;
  const addBtn = card ? card.querySelector('[data-shelf-add]') : null;
  if (addBtn) addBtn.hidden = shelf.length === 0;
  // v1.15.2 — 비어 있으면 얇은 한 줄, 담긴 파일이나 드래그가 있으면 펼친다.
  if (card) card.classList.toggle('is-empty', shelf.length === 0 && !dragHeld);
  if (!shelf.length) {
    list.innerHTML = '';
    fitPanel();
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
  fitPanel();
}

function addFiles(files) {
  const list = Array.from(files || []).filter((file) => file && file.name);
  if (!list.length) return;
  if (!getNotchSettings().widgets.shelf) {
    toast('환경설정 → 노치 → 위젯에서 임시 보관함을 켜 주세요');
    return;
  }
  let added = 0;
  list.forEach((file) => {
    if (shelf.length >= 8) return;
    shelf.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, url: URL.createObjectURL(file) });
    added += 1;
  });
  renderShelf();
  announceShelf(added, added < list.length ? '임시 보관함은 8개까지 담을 수 있습니다' : '');
}

/** 담은 뒤 알림 — 접혀 있으면 펼치지 않고 알약에 '보관함 +2' 를 2초(v1.17.0). */
function announceShelf(added, problem = '') {
  if (added) {
    toast(`파일 ${added}개를 임시 보관함에 담았습니다`);
    if (!expanded) setPillNote(`보관함 +${added}`, 2000);
    else openHeld();
  } else {
    toast(String(problem).slice(0, 90) || '파일을 담지 못했습니다');
    if (!expanded) setPillNote('', 0);
  }
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
  // v1.17.0 — 접혀 있어도 펼치지 않고 담는다. 위젯이 꺼져 있으면 담지 않는다.
  if (!getNotchSettings().widgets.shelf) {
    toast('환경설정 → 노치 → 위젯에서 임시 보관함을 켜 주세요');
    setPillNote('', 0);
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
  announceShelf(added, problem);
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

/* ------------------------------ 접힌 알약 (v1.15.0) ------------------------------ */

/** 지금 저장된 설정·상태에서 알약에 무엇을 보일지 정한다.
 *  v1.17.0 — 음악은 멈춘 뒤 5분까지 멈춘 이퀄라이저로 남기고, 타이머는 끝난 뒤 5초 동안 '완료'.
 *  환경설정 '노래와 타이머 표시'(pillActivity)를 끄면 늘 TIP 로고만 보인다. */
function pillContent() {
  const settings = getNotchSettings();
  const widgets = settings.widgets;
  const state = timerState();
  const now = Date.now();

  if (state.status === 'done') {
    if (!timerDoneAt) timerDoneAt = now;
  } else {
    timerDoneAt = 0;
  }
  const hasTrack = !!(mediaState && (mediaState.title || mediaState.playing));
  const mediaShown = !!(widgets.media && hasTrack
    && (mediaState.playing || (mediaPausedAt && now - mediaPausedAt < MEDIA_PAUSE_KEEP_MS)));
  const timerShown = !!(widgets.timer && (state.status === 'running' || state.status === 'paused'
    || (state.status === 'done' && now - timerDoneAt < TIMER_DONE_KEEP_MS)));

  const activity = settings.pillActivity !== false;
  return {
    hasMedia: activity && mediaShown,
    hasTimer: activity && timerShown,
    mediaShown,
    timerShown,
    state,
  };
}

/** 미디어 재생 위치 — 마지막 조회(4.5초 전)에서 지난 시간만큼 앞으로 당긴다. */
function mediaPositionNow() {
  if (!mediaState) return 0;
  let position = mediaState.position;
  if (mediaState.playing) position += (performance.now() - mediaPolledAt) / 1000;
  if (mediaState.duration > 0) position = Math.min(position, mediaState.duration);
  return Math.max(0, position);
}

/** 접힌 알약을 그린다 — 음악은 왼쪽 날개(이퀄라이저), 타이머는 오른쪽 날개(남은 시간).
 *  파일을 끄는 동안·막 담은 뒤에는 그 안내(pill-note)가 먼저다. */
function paintPill() {
  const { hasMedia, hasTimer, state } = pillContent();
  const note = pillNoteText;
  pillEl.classList.toggle('has-media', hasMedia && !note);
  pillEl.classList.toggle('has-timer', hasTimer && !note);
  pillEl.classList.toggle('has-note', !!note);
  pillEl.classList.toggle('no-notch', !notchInfo.hasNotch);

  const eqEl = document.getElementById('pill-eq');
  if (eqEl) {
    eqEl.hidden = !hasMedia || !!note;
    eqEl.classList.toggle('is-paused', !!(mediaState && !mediaState.playing));
  }
  const dropIcon = document.getElementById('pill-drop-icon');
  if (dropIcon) dropIcon.hidden = !note;
  const noteEl = document.getElementById('pill-note');
  if (noteEl) {
    noteEl.hidden = !note;
    noteEl.textContent = note;
  }

  const timerEl = document.getElementById('pill-timer');
  const clockEl = document.getElementById('pill-clock');
  if (timerEl && clockEl) {
    timerEl.hidden = !hasTimer || !!note;
    timerEl.classList.toggle('is-paused', state.status === 'paused');
    timerEl.classList.toggle('is-done', state.status === 'done');
    clockEl.textContent = state.status === 'done' ? '완료' : formatClock(remainingSeconds(state));
  }

  const parts = [];
  if (note) parts.push(note);
  if (hasMedia && !note) parts.push(mediaState.playing ? '노래 재생 중' : '노래 일시정지');
  if (hasTimer && !note) {
    parts.push(state.status === 'done' ? '타이머 끝남' : `타이머 ${describeSeconds(Math.ceil(remainingSeconds(state)))} 남음`);
  }
  pillEl.setAttribute('aria-label', parts.length ? `TIP 노치 열기, ${parts.join(', ')}` : 'TIP 노치 열기');

  // 안내 글자가 있으면 양쪽 날개 폭을 모두 빌린다.
  updatePillMode(hasMedia || !!note, hasTimer || !!note);
  paintDialSides();
}

/** 알약에 잠깐 보일 글자 — 끌고 있는 동안은 계속, 담은 뒤에는 2초. */
function setPillNote(text, ms = 0) {
  clearTimeout(pillNoteTimer);
  pillNoteText = text || '';
  paintPill();
  if (pillNoteText && ms > 0) {
    pillNoteTimer = setTimeout(() => {
      pillNoteText = '';
      paintPill();
    }, ms);
  }
}

/** 알약에 담을 내용이 바뀌면 Rust 에 알린다 — 접힌 창 폭이 그만큼 넓어진다. */
function updatePillMode(hasMedia, hasTimer) {
  if (!TAURI) return;
  const signature = `${hasMedia ? 1 : 0}${hasTimer ? 1 : 0}`;
  if (signature === pillModeSent) return;
  pillModeSent = signature;
  invoke('set_notch_pill', { media: !!hasMedia, timer: !!hasTimer }).catch(() => {
    // 못 알렸으면 다음 그림에 다시 시도한다.
    pillModeSent = '';
  });
}

/** 개발용 가짜 노치 — 노치가 없는 Mac·브라우저 미리보기에서 노치 화면을 흉내 낸다(v1.17.0).
 *  localStorage 'tip.dev.fakeNotch' = 노치 너비(pt). Mac 앱(Tauri)에서는 쓰지 않는다. */
function fakeNotch() {
  if (TAURI) return null;
  try {
    const width = Number(localStorage.getItem('tip.dev.fakeNotch'));
    return width > 0 ? { hasNotch: true, notchWidth: width, notchHeight: 32 } : null;
  } catch {
    return null;
  }
}

/** 노치 화면 정보 — 가운데 물리 노치 너비를 CSS 변수로 넣어 그 자리를 비운다. */
async function loadNotchMetrics() {
  if (!TAURI) {
    notchInfo = fakeNotch() || { hasNotch: false, notchWidth: 0, notchHeight: 0 };
    applyNotchGap();
    paintPill();
    return;
  }
  try {
    const info = await invoke('notch_metrics');
    notchInfo = {
      hasNotch: !!(info && info.hasNotch),
      notchWidth: Number(info && info.notchWidth) || 0,
      notchHeight: Number(info && info.notchHeight) || 0,
    };
  } catch {
    notchInfo = { hasNotch: false, notchWidth: 0, notchHeight: 0 };
  }
  applyNotchGap();
  paintPill();
}

function applyNotchGap() {
  // 노치가 없으면 0 — 가운데를 비울 필요가 없다.
  const gap = notchInfo.hasNotch ? Math.max(0, notchInfo.notchWidth) : 0;
  pillEl.style.setProperty('--notch-gap', `${gap}px`);
  pillEl.classList.toggle('no-notch', !notchInfo.hasNotch);
  // 반원도 노치 높이만큼 아래로 — 가운데 이름·찾기 칸이 노치에 가리지 않게.
  notchEl.style.setProperty('--dial-offset', `${dialOffset()}px`);
  // 노치 정보는 늦게 도착한다 — 이미 그린 타일도 같은 만큼 내린다.
  if (dialItems.length) layoutDial();
  if (expanded) fitPanel({ now: true });
}

/* ------------------------------ 타이머 (v1.15.0) ------------------------------ */

/* v1.15.2 — 타이머 카드 상태. 직접 입력은 접어 두고, 고른 시간은 표시 시간과 늘 같다. */
let timerChoice = 5 * 60;      // 지금 고른 시간(초) — 5분 프리셋으로 시작한다
let timerCustomOpen = false;   // '직접 입력' 을 펼쳤는지

function timerCard() {
  return widgetCard('timer', `
    <div class="wg-head">
      <span class="wg-label">타이머</span>
      <span class="wg-side" id="timer-side">대기</span>
    </div>
    <div class="timer-body">
      <div class="timer-top">
        <b class="timer-display" id="timer-display">${formatClock(timerChoice)}</b>
        <button class="timer-link" type="button" id="timer-custom-toggle" aria-expanded="false" aria-controls="timer-custom-row">직접 입력</button>
      </div>
      <div class="timer-presets">
        ${TIMER_PRESETS.map((minutes) => `<button class="timer-chip${minutes * 60 === timerChoice ? ' is-on' : ''}" type="button" data-timer-seconds="${minutes * 60}">${minutes}분</button>`).join('')}
      </div>
      <div class="timer-custom" id="timer-custom-row" hidden>
        <label class="timer-field"><span>분</span><input class="timer-input" id="timer-min" type="number" inputmode="numeric" min="0" max="1440" step="1" value="${Math.floor(timerChoice / 60)}"></label>
        <label class="timer-field"><span>초</span><input class="timer-input" id="timer-sec" type="number" inputmode="numeric" min="0" max="59" step="1" value="${timerChoice % 60}"></label>
        <button class="timer-btn" type="button" id="timer-custom">설정</button>
      </div>
      <div class="timer-row">
        <button class="timer-btn primary" type="button" id="timer-toggle">시작</button>
        <button class="timer-btn" type="button" id="timer-extend" disabled>+1분</button>
        <button class="timer-btn" type="button" id="timer-reset" disabled>초기화</button>
      </div>
    </div>
  `);
}

/** 타이머 카드의 분·초 입력 → 초. 0 이면 0. */
function timerCardSeconds() {
  const minEl = panelEl.querySelector('#timer-min');
  const secEl = panelEl.querySelector('#timer-sec');
  const minutes = Math.max(0, Math.min(1440, Math.floor(Number(minEl && minEl.value) || 0)));
  const seconds = Math.max(0, Math.min(59, Math.floor(Number(secEl && secEl.value) || 0)));
  return minutes * 60 + seconds;
}

/** 프리셋·입력 강조를 지금 고른 시간에 맞춘다. */
function paintTimerChoice() {
  panelEl.querySelectorAll('[data-timer-seconds]').forEach((chip) => {
    chip.classList.toggle('is-on', Number(chip.dataset.timerSeconds) === timerChoice);
  });
  const row = panelEl.querySelector('#timer-custom-row');
  if (row) row.hidden = !timerCustomOpen;
  const toggle = panelEl.querySelector('#timer-custom-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', String(timerCustomOpen));
}

/** 패널의 타이머 카드를 지금 상태로 — 접혀 있어도 요소가 없으면 조용히 넘어간다. */
function paintTimerCard() {
  const display = panelEl.querySelector('#timer-display');
  if (!display) return;
  const state = timerState();
  const idle = state.status === 'idle';
  // v1.15.2 — 고른 시간과 표시 시간이 늘 같다: 대기 중에는 고른 시간을 그대로 보여 준다.
  display.textContent = formatClock(idle ? timerChoice : remainingSeconds(state));
  display.classList.toggle('is-running', state.status === 'running');
  display.classList.toggle('is-done', state.status === 'done');
  const side = panelEl.querySelector('#timer-side');
  if (side) {
    side.textContent = state.status === 'running' ? '진행 중'
      : state.status === 'paused' ? '일시정지'
        : state.status === 'done' ? '완료' : '대기';
  }
  const toggle = panelEl.querySelector('#timer-toggle');
  if (toggle) {
    toggle.textContent = state.status === 'running' ? '일시정지' : (state.status === 'paused' ? '계속' : '시작');
    toggle.disabled = idle && timerChoice <= 0;
  }
  const extend = panelEl.querySelector('#timer-extend');
  if (extend) extend.disabled = idle || state.status === 'done';
  const reset = panelEl.querySelector('#timer-reset');
  if (reset) reset.disabled = idle;
  // 돌아가는 동안에는 프리셋·직접 입력을 잠깐 잠근다(시간이 엉키지 않게).
  const running = state.status === 'running' || state.status === 'paused';
  panelEl.querySelectorAll('[data-timer-seconds]').forEach((chip) => { chip.disabled = running; });
  panelEl.querySelectorAll('#timer-min, #timer-sec, #timer-custom').forEach((el) => { el.disabled = running; });
  paintTimerChoice();
}

/** 시간이 다 됐는지 — 끝났음을 이 창이 확정했을 때만 알림·소리를 낸다. */
function checkTimerDone() {
  if (!tickTimer()) return;
  const state = timerState();
  alertTimerDone(state.duration);
  toast('타이머가 끝났습니다');
  paintPill();
  paintTimerCard();
}

/** 알약·타이머를 위한 배경 루프 — 창이 접혀 있어도 돈다. */
function startPillLoops() {
  if (!TAURI) return;
  stopPillLoops();
  pillMediaTimer = setInterval(() => {
    // v1.17.0 — 노치 아일랜드를 꺼 두어도 메뉴 막대로 연 동안에는 읽는다.
    if (!getNotchSettings().enabled && !expanded) return;
    fetchMedia();
  }, 4500);
  pillTickTimer = setInterval(() => {
    paintPill();
    paintTimerCard();
    checkTimerDone();
    paintMediaProgress();
  }, 500);
  fetchMedia();
  paintPill();
}

function stopPillLoops() {
  clearInterval(pillMediaTimer);
  clearInterval(pillTickTimer);
  pillMediaTimer = null;
  pillTickTimer = null;
}

/* 빠른 메모 */

function memoCard() {
  let saved = '';
  try { saved = localStorage.getItem('tip.quickMemo.v1') || ''; } catch { saved = ''; }
  const card = widgetCard('memo', `
    <div class="wg-head">
      <span class="wg-label">빠른 메모</span>
    </div>
    <textarea class="memo-input" id="memo-input" rows="2" placeholder="한 줄 메모. 바로 저장됩니다">${escapeHtml(saved)}</textarea>
  `);
  requestAnimationFrame(() => {
    const input = card.querySelector('#memo-input');
    if (!input) return;
    let saveTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try { localStorage.setItem('tip.quickMemo.v1', input.value); } catch { /* 저장 못하면 이번만 */ }
      }, 350);
    });
    input.addEventListener('focus', () => { openHeld(); });
    // v1.15.3 — borderless NSPanel 은 스스로 key window 가 되지 못해 클릭한 순간 창을 key 로
    // 만들어야 한다. 예전에는 mousedown 과 focus 두 곳에서 불렀고, Rust 가 첫 응답자를 다시
    // 잡으면서 방금 들어간 커서가 한 번 깜빡이고 사라졌다. 이제 mousedown 에서 한 번만 부르고,
    // key 창이 된 다음 입력칸에 초점이 남아 있는지 한 박자 뒤에 확인한다.
    input.addEventListener('mousedown', () => {
      // v1.17.0 — 클릭·메뉴 막대로 열 때 이미 키 창이 되었으면 다시 부르지 않는다(커서 깜빡임 방지).
      if (document.hasFocus()) return;
      invoke('notch_focus')
        .catch(() => {})
        .finally(() => {
          requestAnimationFrame(() => {
            if (document.activeElement !== input) input.focus({ preventScroll: true });
          });
        });
    });
    // key 창으로 바뀌는 짧은 순간의 blur 로 패널이 접히지 않게 한 박자 뒤에 본다.
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement === input) return;
        heldOpen = false;
        scheduleCollapse();
      }, 220);
    });
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
    toast('카메라를 열 수 없습니다. 시스템 설정에서 카메라 접근을 허용해 주세요');
  }
}

/* 최근 사용 (v1.17.0) — 홈의 '최근 사용'과 같은 기록(tip.recent.v1)을 칩으로 보여 준다. */

function recentCard() {
  const card = widgetCard('recent', `
    <div class="wg-head">
      <span class="wg-label">최근 사용</span>
    </div>
    <div class="recent-row" id="recent-row"></div>
  `, 'wg-wide');
  requestAnimationFrame(() => {
    const row = card.querySelector('#recent-row');
    if (!row) return;
    const ids = recentIds(6).filter((id) => !!getModule(id));
    if (!ids.length) {
      row.innerHTML = '<p class="launcher-empty">아직 연 모듈이 없습니다</p>';
      return;
    }
    ids.forEach((id) => {
      const mod = getModule(id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recent-chip';
      btn.title = mod.name;
      btn.setAttribute('aria-label', `${mod.name} 열기`);
      btn.innerHTML = `<span class="launcher-icon" aria-hidden="true">${mod.icon || ''}</span><span>${escapeHtml(mod.shortName || mod.name)}</span>`;
      btn.addEventListener('click', () => openModuleFromNotch(id));
      row.append(btn);
    });
    fitPanel();
  });
  return card;
}

/* 켜 둔 모듈 (v1.17.0 — 예전 '모듈 실행' 가로 스크롤을 한 줄 7칸으로 바꾼다)
   반원과 같은 순서(quickOrderIds)·같은 회전 방식(js/dial.js)을 따른다. 머리글에 위치와 찾기 칸. */

let launcherStart = 0;
let launcherQuery = '';
let launcherWheelAt = 0;

function launcherList() {
  const ids = quickOrderIds().filter((id) => !!getModule(id));
  if (!launcherQuery) return ids;
  const q = launcherQuery.toLowerCase();
  return ids.filter((id) => {
    const mod = getModule(id);
    return [mod.name, mod.shortName].some((name) => String(name || '').toLowerCase().includes(q));
  });
}

function launcherCard() {
  const card = widgetCard('launcher', `
    <div class="wg-head">
      <span class="wg-label">켜 둔 모듈 <span class="launcher-pos" id="launcher-pos"></span></span>
      <span class="wg-tools">
        <input class="launcher-find" id="launcher-find" type="text" autocomplete="off" spellcheck="false" placeholder="이름으로 찾기" aria-label="켜 둔 모듈 이름으로 찾기">
        <button class="wg-link wg-add" type="button" id="launcher-new" aria-label="새 스티커 메모" title="새 스티커 메모">+</button>
      </span>
    </div>
    <div class="launcher-wrap" id="launcher-wrap">
      <button class="launcher-nav" type="button" data-launcher="prev" aria-label="켜 둔 모듈 왼쪽으로" title="왼쪽으로">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>
      </button>
      <div class="launcher-row" id="launcher-row"></div>
      <button class="launcher-nav" type="button" data-launcher="next" aria-label="켜 둔 모듈 오른쪽으로" title="오른쪽으로">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 6 6 6-6 6"/></svg>
      </button>
    </div>
  `, 'wg-wide');
  requestAnimationFrame(() => {
    const find = card.querySelector('#launcher-find');
    if (find) {
      find.value = launcherQuery;
      find.addEventListener('input', () => {
        launcherQuery = find.value.trim();
        launcherStart = 0;
        paintLauncher();
      });
      find.addEventListener('mousedown', () => { invoke('notch_focus').catch(() => {}); });
      find.addEventListener('focus', openHeld);
    }
    const wrap = card.querySelector('#launcher-wrap');
    if (wrap) {
      wrap.addEventListener('wheel', (event) => {
        const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
        const delta = vertical ? event.deltaY : event.deltaX;
        if (!delta) return;
        // 전체 보기가 창보다 길어 스크롤할 것이 있으면, 세로 휠은 목록 스크롤에 양보한다(v1.17.0 검수 D7).
        // 가로 휠·트랙패드 옆으로 밀기와 ‹ › 는 그대로 한 칸씩 넘긴다.
        if (vertical && widgetsEl.scrollHeight > widgetsEl.clientHeight + 1) return;
        event.preventDefault();
        const now = Date.now();
        if (now - launcherWheelAt < 130) return;   // 한 번 굴리면 한 칸
        launcherWheelAt = now;
        scrollLauncher(delta > 0 ? 1 : -1);
      }, { passive: false });
    }
    paintLauncher();
  });
  return card;
}

/** 한 줄 7칸을 지금 위치로 다시 그린다 — 위치 표시와 끝 화살표도 함께. */
function paintLauncher() {
  const row = panelEl.querySelector('#launcher-row');
  const card = panelEl.querySelector('.wg-launcher');
  if (!row || !card) return;
  const loop = dialLoop();
  const all = launcherList();
  const n = all.length;
  launcherStart = clampRowStart(launcherStart, n, DIAL_SLOTS, loop);

  const pos = card.querySelector('#launcher-pos');
  if (pos) pos.textContent = n ? rowPositionLabel(launcherStart, n, DIAL_SLOTS, loop) : '';

  row.innerHTML = '';
  if (!n) {
    row.innerHTML = launcherQuery
      ? '<p class="launcher-empty">찾는 모듈이 없어요</p>'
      : '<p class="launcher-empty">켜 둔 모듈이 없습니다</p>';
  }
  rowWindow(all, launcherStart, DIAL_SLOTS, loop).forEach((id) => {
    const mod = getModule(id);
    const btn = document.createElement('button');
    btn.className = 'launcher-tile';
    btn.type = 'button';
    btn.title = mod.name;
    btn.setAttribute('aria-label', `${mod.name} 열기`);
    btn.innerHTML = `<span class="launcher-icon" aria-hidden="true">${mod.icon || ''}</span><span>${escapeHtml(mod.shortName || mod.name)}</span>`;
    btn.addEventListener('click', () => openModuleFromNotch(id));
    row.append(btn);
  });

  const few = n <= DIAL_SLOTS;
  const [startEnd, finishEnd] = rowAtEnds(launcherStart, n, DIAL_SLOTS, loop);
  [['prev', startEnd], ['next', finishEnd]].forEach(([dir, end]) => {
    const btn = card.querySelector(`[data-launcher="${dir}"]`);
    if (!btn) return;
    btn.hidden = few;
    btn.classList.toggle('is-end', end);
    btn.setAttribute('aria-disabled', String(end));
  });
}

function scrollLauncher(direction) {
  const n = launcherList().length;
  if (n <= DIAL_SLOTS) return;
  launcherStart = clampRowStart(launcherStart + direction, n, DIAL_SLOTS, dialLoop());
  paintLauncher();
}

/* ------------------------------ 간단히 보기 — 반원 다이얼 (v1.17.0) ------------------------------ */

/* 예전 반원 퀵바 창(js/radial.js)의 판과 호를 이 창으로 옮겼다. 판의 반타원 모양은 CSS(.sheet 의
 * border-radius)가 맡고, 여기서는 모듈 타일을 얕은 호 위에 놓는다. 회전 규칙은 js/dial.js.
 * 위쪽 한 줄: [달력] [미디어] [‹] [이름·설명·찾기] [›] [타이머] [보관함]. */

const DIAL_GEO = {
  arc: 520,          // 타일 중심이 놓이는 호의 반지름 — 클수록 납작하다
  centerY: 146,      // 가운데 타일 중심의 y(판 위쪽 일직선 기준, 노치 높이는 따로 더한다)
  x3: 232,           // 3칸 옆(가장 바깥) 타일의 x 오프셋
  spill: 0.55,       // 가장자리에서 살짝 걸쳐 보이는 정도(칸)
};

const dialSlotsEl = document.getElementById('dial-slots');
let dialIds = [];          // 지금 그려진 모듈 id
let dialItems = [];        // [{ id, el }]
let dialPos = 0;           // 연속 회전 위치 — dialPos 번째 모듈이 가운데 칸에 온다
let dialTarget = 0;
let dialAnimating = false;
let dialSnapTimer = null;

function dialLoop() {
  return getNotchSettings().rotation !== 'bounded';
}

function renderDial({ keepCenter = true } = {}) {
  if (!dialSlotsEl) return;
  syncStore();
  const loop = dialLoop();
  const centerId = dialIds.length ? dialIds[centerIndex(dialPos, dialIds.length, loop)] : null;
  const ids = quickOrderIds().filter((id) => !!getModule(id));

  dialSlotsEl.innerHTML = '';
  dialItems = ids.map((id) => {
    const mod = getModule(id);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'dial-slot';
    el.dataset.moduleId = id;
    el.title = mod.name;
    el.innerHTML = `<span class="dial-tile" aria-hidden="true">${mod.icon || ''}</span>`
      + `<span class="dial-label">${escapeHtml(mod.shortName || mod.name)}</span>`;
    el.addEventListener('click', () => onDialSlotClick(id));
    dialSlotsEl.append(el);
    return { id, el };
  });
  dialIds = ids;

  const empty = document.getElementById('dial-empty');
  if (empty) empty.hidden = ids.length > 0;

  dialPos = keepCenter && centerId && ids.includes(centerId) ? ids.indexOf(centerId) : 0;
  dialPos = clampPos(dialPos, ids.length, loop);
  dialTarget = dialPos;
  layoutDial();
}

/* v1.17.1 — 모듈 칸을 놓을 수 있는 최소 폭.
 * 메뉴 막대 아이콘·마우스 올리기로 열면 창이 아직 알약 폭(92)일 때 한 번 그린다. 그때는
 * cx(46) - 82 가 음수라 호 계산이 뒤집혀 **모든 칸이 hidden** 이 되고, 창이 펼쳐진 뒤에도
 * 다시 그리지 않아 빈 판(흰 화면)만 남았다(휠을 굴려야 layoutDial 이 다시 돌아 나타났다).
 * 폭이 모자라면 그리지 않고 칸을 숨겨 두었다가, 창이 커지면 다시 그린다. */
const DIAL_MIN_W = 200;

function layoutDial() {
  const n = dialItems.length;
  paintDialHub();
  if (!n) return;
  const width = dialEl.clientWidth;
  if (width < DIAL_MIN_W) {
    dialItems.forEach((item) => {
      item.el.style.visibility = 'hidden';
      item.el.style.opacity = '0';
    });
    return;
  }
  const loop = dialLoop();
  const cx = width / 2;
  const top = dialOffset();
  // 3칸 옆(가장 바깥) 타일의 x — 창이 좁아도 0 아래로 내려가지 않게 한다.
  const x3 = Math.min(DIAL_GEO.x3, Math.max(24, cx - 82));
  const step = Math.asin(x3 / DIAL_GEO.arc) / 3;
  const yc = top + DIAL_GEO.centerY - DIAL_GEO.arc;
  const inner = ((DIAL_SLOTS - 1) / 2) * step;
  const limit = inner + DIAL_GEO.spill * step;
  const center = centerIndex(dialPos, n, loop);

  dialItems.forEach((item, index) => {
    const d = offsetOf(index, dialPos, n, loop);
    const angle = d * step;
    const ad = Math.abs(angle);
    if (ad > limit + 0.001) {
      item.el.style.visibility = 'hidden';
      item.el.style.opacity = '0';
      item.el.tabIndex = -1;
      // 화면 밖으로 나간 칸에 '가운데' 표시가 남지 않게 지운다.
      item.el.classList.remove('is-center');
      item.el.removeAttribute('aria-current');
      return;
    }
    const x = cx + DIAL_GEO.arc * Math.sin(angle);
    const y = yc + DIAL_GEO.arc * Math.cos(angle);
    const t = inner > 0 ? Math.min(1, ad / inner) : 0;
    const fade = ad <= inner ? 1 : 1 - (ad - inner) / (DIAL_GEO.spill * step);
    const isCenter = index === center;
    item.el.style.visibility = 'visible';
    item.el.style.left = `${x.toFixed(2)}px`;
    item.el.style.top = `${y.toFixed(2)}px`;
    item.el.style.transform = `translate(-50%, -24px) scale(${(isCenter ? 1.08 : 1 - 0.1 * t).toFixed(3)})`;
    // 양 끝 칸은 아이콘만 흐리게 — 이름 글자는 흐리게 하지 않는다(대비 유지).
    item.el.style.opacity = fade < 1 ? Math.max(0, fade).toFixed(3) : '1';
    item.el.style.setProperty('--tile-fade', ad > inner * 0.9 ? '0.55' : '1');
    item.el.classList.toggle('is-center', isCenter);
    item.el.tabIndex = fade > 0.5 ? 0 : -1;
    const mod = getModule(item.id);
    item.el.setAttribute('aria-label', isCenter ? `${mod.name} 열기` : `${mod.name}, 가운데로 옮기기`);
    if (isCenter) item.el.setAttribute('aria-current', 'true');
    else item.el.removeAttribute('aria-current');
  });
}

/* v1.17.1 — 다이얼을 놓는 자리와 크기 감시.
 * 판(창) 크기가 바뀌면 다이얼을 다시 놓는다. 창 크기는 Rust 가 바꾸는데(notch_expand), JS 는
 * 이미 '펼침' 상태라 resize 리스너의 syncLayout 이 아무것도 하지 않았다. 그래서 알약 폭에서
 * 그린 칸이 그대로 남았다. 판의 실제 크기를 지켜보다가 폭·높이가 달라지면 다시 그리고,
 * 첫 크기가 들어오면 그때 처음 그린다. */
let dialBox = '';
function watchDialSize() {
  if (typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => {
    const box = `${dialEl.clientWidth}x${dialEl.clientHeight}`;
    if (box === dialBox) return;
    dialBox = box;
    if (!expanded) return;
    layoutDial();
  });
  observer.observe(dialEl);
}

/** 가운데 모듈의 이름·설명과 양쪽 화살표(끝에 닿으면 흐리게). */
function paintDialHub() {
  const n = dialIds.length;
  const loop = dialLoop();
  const nameEl = document.getElementById('dial-name');
  const descEl = document.getElementById('dial-desc');
  const mod = n ? getModule(dialIds[centerIndex(dialPos, n, loop)]) : null;
  if (nameEl) nameEl.textContent = mod ? mod.name : '켜 둔 모듈 없음';
  if (descEl) descEl.textContent = mod ? (mod.subtitle || mod.description || '') : '';
  const [startEnd, finishEnd] = atEnds(dialTarget, n, loop);
  [['dial-prev', startEnd], ['dial-next', finishEnd]].forEach(([id, end]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('is-end', end);
    btn.setAttribute('aria-disabled', String(end));
  });
}

function animateDial() {
  if (dialAnimating) return;
  if (reducedMotion()) {
    dialPos = dialTarget;
    layoutDial();
    return;
  }
  dialAnimating = true;
  const step = () => {
    const diff = dialTarget - dialPos;
    if (Math.abs(diff) < 0.002) {
      dialPos = dialTarget;
      layoutDial();
      dialAnimating = false;
      normalizeDial();
      return;
    }
    dialPos += diff * 0.3;
    layoutDial();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 계속 회전에서 위치 값이 한없이 커지지 않게 모듈 수의 배수만큼 되돌린다. */
function normalizeDial() {
  const n = dialItems.length;
  if (!n || !dialLoop()) return;
  while (dialTarget - dialPos > n / 2) { dialPos += n; dialTarget += n; }
  while (dialTarget - dialPos < -n / 2) { dialPos -= n; dialTarget -= n; }
}

function nudgeDial(amount) {
  const n = dialItems.length;
  if (n <= 1) return;
  dialTarget = clampPos(Math.round(dialTarget) + amount, n, dialLoop());
  animateDial();
}

function centerDialOn(index) {
  const n = dialItems.length;
  if (index < 0 || index >= n) return;
  dialTarget = targetFor(index, dialPos, n, dialLoop());
  animateDial();
}

function onDialSlotClick(id) {
  const index = dialIds.indexOf(id);
  if (index < 0) return;
  if (index !== centerIndex(dialPos, dialIds.length, dialLoop())) {
    // 가장자리 모듈은 먼저 가운데로 끌어온다.
    centerDialOn(index);
    return;
  }
  openModuleFromNotch(id);
}

async function openModuleFromNotch(id) {
  const mod = getModule(id);
  if (!mod) return;
  try {
    if (TAURI) await invoke('open_tool', { id, title: mod.name });
    else location.href = `./index.html?module=${encodeURIComponent(id)}`;
    setExpanded(false);
  } catch (error) {
    console.error('[TIP notch] 모듈을 열지 못했습니다', error);
    toast('모듈을 열지 못했습니다');
  }
}

function openCenterModule() {
  const n = dialIds.length;
  if (!n) return;
  openModuleFromNotch(dialIds[centerIndex(dialTarget, n, dialLoop())]);
}

/** 반원 양옆 — 달력 아이콘·미디어·타이머·보관함. 위젯이 꺼져 있거나 보일 것이 없으면 빈 자리. */
let nextEventText = '';
function paintDialSides() {
  const widgets = getNotchSettings().widgets;
  const { mediaShown, timerShown, state } = pillContent();

  const cal = document.getElementById('dial-cal');
  if (cal) {
    cal.hidden = !widgets.calendar;
    const label = nextEventText ? `달력 열기, 다음 일정 ${nextEventText}` : '달력 열기';
    cal.setAttribute('aria-label', label);
    cal.title = nextEventText || '달력 열기';
  }

  const media = document.getElementById('dial-media');
  if (media) {
    media.hidden = !mediaShown;
    if (mediaShown) {
      const title = mediaState.title || mediaState.artist || '재생 중';
      const stateText = mediaState.playing ? '재생 중' : '일시정지';
      document.getElementById('dial-media-title').textContent = title;
      document.getElementById('dial-media-state').textContent = stateText;
      media.setAttribute('aria-label', `${title}, ${stateText}. 전체 보기에서 재생 조절`);
    }
  }

  const timer = document.getElementById('dial-timer');
  if (timer) {
    timer.hidden = !timerShown;
    if (timerShown) {
      const done = state.status === 'done';
      const clockText = done ? '완료' : formatClock(remainingSeconds(state));
      const stateText = done ? '타이머 끝남' : (state.status === 'paused' ? '일시정지' : '타이머 남음');
      document.getElementById('dial-timer-clock').textContent = clockText;
      document.getElementById('dial-timer-state').textContent = stateText;
      timer.classList.toggle('is-paused', state.status === 'paused');
      timer.setAttribute('aria-label', done ? '타이머 끝남. 전체 보기에서 조절'
        : `타이머 ${describeSeconds(Math.ceil(remainingSeconds(state)))} ${state.status === 'paused' ? '멈춤' : '남음'}. 전체 보기에서 조절`);
    }
  }

  const shelfBtn = document.getElementById('dial-shelf');
  const badge = document.getElementById('dial-shelf-count');
  if (shelfBtn) {
    shelfBtn.hidden = !widgets.shelf;
    shelfBtn.setAttribute('aria-label', `임시 보관함 열기, 파일 ${shelf.length}개`);
  }
  if (badge) {
    badge.hidden = shelf.length === 0;
    badge.textContent = shelf.length > 99 ? '99+' : String(shelf.length);
  }
}

/** 반원의 상태 칸을 누르면 전체 보기로 펼치고 그 카드를 잠깐 강조한다(멈춤·재생은 카드에서만). */
function goFullAndFlash(widgetId) {
  setView('full', { focus: false });
  setTimeout(() => {
    const card = panelEl.querySelector(`.wg-${widgetId}`);
    if (!card) return;
    card.classList.add('is-flash');
    card.scrollIntoView({ block: 'nearest' });
    const focusable = card.querySelector('button:not([disabled]), input, textarea');
    if (focusable && openedWithKeys) focusable.focus({ preventScroll: true });
    setTimeout(() => card.classList.remove('is-flash'), 1400);
  }, reducedMotion() ? 0 : 300);
}

function bindDial() {
  document.getElementById('dial-prev').addEventListener('click', () => nudgeDial(-1));
  document.getElementById('dial-next').addEventListener('click', () => nudgeDial(1));
  document.getElementById('dial-cal').addEventListener('click', () => openCalendarView());
  document.getElementById('dial-media').addEventListener('click', () => goFullAndFlash('media'));
  document.getElementById('dial-timer').addEventListener('click', () => goFullAndFlash('timer'));
  document.getElementById('dial-shelf').addEventListener('click', () => goFullAndFlash('shelf'));
  document.getElementById('to-full').addEventListener('click', () => setView('full'));
  document.getElementById('to-simple').addEventListener('click', () => setView('simple'));

  const find = document.getElementById('dial-find');
  find.addEventListener('input', () => {
    const index = findIndex(dialIds, find.value, (id) => {
      const mod = getModule(id);
      return mod ? [mod.name, mod.shortName] : [];
    });
    if (index >= 0) centerDialOn(index);
  });
  find.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openCenterModule();
    } else if (!find.value && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      // 찾기 칸이 비어 있을 때만 ←→ 가 다이얼을 돌린다(글자가 있으면 커서를 옮긴다).
      event.preventDefault();
      nudgeDial(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  find.addEventListener('mousedown', () => {
    invoke('notch_focus').catch(() => {}).finally(() => {
      requestAnimationFrame(() => { if (document.activeElement !== find) find.focus({ preventScroll: true }); });
    });
  });
  find.addEventListener('focus', openHeld);

  dialEl.addEventListener('wheel', (event) => {
    if (dialItems.length <= 1) return;
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!delta) return;
    event.preventDefault();
    let amount = delta;
    if (event.deltaMode === 1) amount *= 16;        // 줄 단위
    else if (event.deltaMode === 2) amount *= 400;  // 페이지 단위
    dialTarget = clampPos(dialTarget + amount * 0.005, dialItems.length, dialLoop());
    animateDial();
    // 휠이 멈추면 가까운 칸에 맞춘다.
    clearTimeout(dialSnapTimer);
    dialSnapTimer = setTimeout(() => {
      dialTarget = clampPos(Math.round(dialTarget), dialItems.length, dialLoop());
      animateDial();
    }, 160);
  }, { passive: false });

  dialEl.addEventListener('keydown', (event) => {
    if (event.target === find) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      nudgeDial(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}

/* ------------------------------ 위젯 생명주기 ------------------------------ */

function startWidgets() {
  // 창 크기 변경(notch_expand)과 무거운 조회가 겹치지 않도록 첫 조회는 다음 프레임 뒤로 미룬다.
  clearTimeout(widgetsDelay);
  widgetsDelay = setTimeout(() => {
    if (!expanded) return;
    // v1.15.0 — 미디어는 배경 루프가 함께 돌린다(접힌 알약도 곡을 보여 줘야 하므로).
    fetchMedia();
    refreshCalendar();
    paintTimerCard();
  }, 220);
  clearInterval(calendarTimer);
  calendarTimer = setInterval(refreshCalendar, 5 * 60 * 1000);
}

function stopWidgets() {
  clearTimeout(widgetsDelay);
  widgetsDelay = null;
  clearInterval(calendarTimer);
  calendarTimer = null;
  if (mirrorStream) {
    mirrorStream.getTracks().forEach((track) => track.stop());
    mirrorStream = null;
    const video = panelEl.querySelector('#mirror-video');
    if (video) { video.srcObject = null; video.classList.remove('is-live'); }
  }
}

function openHeld(ms = 1200) {
  heldOpen = true;
  cancelCollapse();
  setTimeout(() => { heldOpen = false; syncHold(); }, ms);
  syncHold();
}

/* ------------------------------ 이벤트 ------------------------------ */

pillEl.addEventListener('click', () => {
  // v1.12.3 — 펼침은 클릭으로만. (마우스오버 자동 펼침은 다른 앱을 쓰다 지나가도 화면을 가려 뻈다.)
  // v1.17.0 — 처음 화면은 '노치 시작 화면' 설정을 따르고, 클릭으로 열었으니 키보드 포커스를 가져간다.
  if (expanded) setExpanded(false);
  else openNotch('click');
});
// 설정에서 '마우스를 올려서 열기'를 켰을 때만 hover 로 펼친다(기본 OFF, v1.12.3).
// 마우스로 열었을 때는 포커스를 가져가지 않는다 — 다른 앱에서 치던 글자가 들어오지 않게.
pillEl.addEventListener('mouseenter', () => {
  if (getNotchSettings().hoverOpen && !expanded) openNotch('hover');
});
dialEl.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-settings]')) {
    invoke('open_main', { module: null, settings: true });
    setExpanded(false);
  }
});
notchEl.addEventListener('mouseenter', cancelCollapse);
notchEl.addEventListener('mouseleave', scheduleCollapse);
// v1.17.1 — 판 안에서 커서가 움직였다면 '들어왔다'(이제 나가면 접힘).
notchEl.addEventListener('pointermove', () => { if (expanded) enteredSinceOpen = true; }, { passive: true });
panelEl.addEventListener('mouseenter', cancelCollapse);
// v1.17.1 — 글자를 칠 때마다 '입력 중' 시계를 다시 건다(찾기 칸·메모·타이머 분·초 모두).
notchEl.addEventListener('input', noteTyping, true);

// 패널 안의 위젯 버튼 — 위임 처리
panelEl.addEventListener('click', (event) => {
  // v1.15.0 — 일정 추가 폼이 먼저다(카드의 data-cal-open 보다 앞).
  if (event.target.closest('#cal-form-close') || event.target.closest('#cal-form-cancel')) {
    closeCalendarForm();
    return;
  }
  if (event.target.closest('#cal-form-save')) {
    saveCalendarEvent();
    return;
  }
  if (event.target.closest('[data-cal-add]')) {
    openCalendarForm(calView.open ? calView.selected : null);
    return;
  }
  if (event.target.closest('#cal-add-btn')) {
    openCalendarForm(calView.selected);
    return;
  }
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
          toast('음악 앱 자동화 권한이 필요합니다. 권한 설정을 눌러 주세요');
          refreshMedia();   // 카드에 '권한 설정' 버튼을 띄운다
        } else {
          toast('음악 앱을 조작하지 못했습니다');
        }
      });
    return;
  }

  if (event.target.closest('#timer-toggle')) {
    const state = timerState();
    if (state.status === 'running' || state.status === 'paused') {
      toggleTimer();
    } else if (timerChoice > 0) {
      startTimer(timerChoice);
    }
    paintTimerCard();
    paintPill();
    openHeld();
    return;
  }

  // v1.15.2 — 프리셋은 시간을 고르기만 한다(시작은 시작 버튼). 고른 값이 곧 표시 시간이다.
  const presetBtn = event.target.closest('[data-timer-seconds]');
  if (presetBtn) {
    timerChoice = Number(presetBtn.dataset.timerSeconds) || 0;
    timerCustomOpen = false;
    paintTimerCard();
    fitPanel();
    openHeld();
    return;
  }

  // 분·초 직접 입력은 '직접 입력' 을 눌렀을 때만 보인다.
  if (event.target.closest('#timer-custom-toggle')) {
    timerCustomOpen = !timerCustomOpen;
    const minEl = panelEl.querySelector('#timer-min');
    const secEl = panelEl.querySelector('#timer-sec');
    if (timerCustomOpen) {
      if (minEl) minEl.value = String(Math.floor(timerChoice / 60));
      if (secEl) secEl.value = String(timerChoice % 60);
      setTimeout(() => { if (minEl) { minEl.focus(); minEl.select(); } }, 0);
    }
    paintTimerCard();
    fitPanel();
    openHeld();
    return;
  }

  if (event.target.closest('#timer-custom')) {
    const seconds = timerCardSeconds();
    if (!seconds) {
      toast('분이나 초를 1 이상으로 넣어 주세요');
      return;
    }
    timerChoice = seconds;
    timerCustomOpen = false;
    paintTimerCard();
    fitPanel();
    openHeld();
    return;
  }

  if (event.target.closest('#timer-reset')) {
    resetTimer();
    paintTimerCard();
    paintPill();
    return;
  }

  if (event.target.closest('#timer-extend')) {
    if (!extendTimer(60)) toast('먼저 타이머를 시작해 주세요');
    paintTimerCard();
    paintPill();
    return;
  }

  if (event.target.closest('#shelf-drop') || event.target.closest('[data-shelf-add]')) {
    const picker = panelEl.querySelector('#shelf-file');
    // v1.17.1 — 파일 고르기 창은 다른 창이라 커서가 판을 벗어난다. 고르는 동안은 접지 않는다.
    if (picker) { openHeld(8000); picker.click(); }
    return;
  }

  // v1.15.2 — 새 스티커는 타일이 아니라 카드 제목 옆 + 로.
  if (event.target.closest('#launcher-new')) {
    invoke('sticky_create', {})
      .then(() => setExpanded(false))
      .catch((error) => {
        console.error('[TIP notch] 스티커를 띄우지 못했습니다', error);
        toast('스티커를 띄우지 못했습니다');
      });
    return;
  }
  const launcherNav = event.target.closest('[data-launcher]');
  if (launcherNav) {
    scrollLauncher(launcherNav.dataset.launcher === 'next' ? 1 : -1);
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

// v1.15.0 — 일정 추가 폼의 종일 토글·날짜 변경.
const calFormBindings = () => {
  const dom = calFormDom();
  if (!dom.form) return;
  dom.allDay.addEventListener('change', syncCalFormAllDay);
  const fixEnd = () => {
    const startMs = formDateMs(dom.startDate.value, dom.startTime.value, dom.allDay.checked);
    const endMs = formDateMs(dom.endDate.value, dom.endTime.value, dom.allDay.checked);
    if (!Number.isFinite(endMs) || endMs <= startMs) {
      const start = new Date(startMs || Date.now());
      const end = new Date(start.getTime() + (dom.allDay.checked ? 0 : 60 * 60 * 1000));
      if (dom.allDay.checked) end.setDate(end.getDate() + 1);
      dom.endDate.value = dayKey(end);
      if (!dom.allDay.checked) dom.endTime.value = clock(end.getTime());
    }
  };
  [dom.startDate, dom.startTime, dom.endDate, dom.endTime].forEach((input) => {
    input.addEventListener('change', fixEnd);
  });
};
calFormBindings();

// v1.13.0 — 독립 캘린더 필터 — 체크를 바꾸면 바로 다시 읽는다(달력과 노치 요약 모두).
panelEl.addEventListener('change', (event) => {
  const box = event.target.closest('input[data-cal-id]');
  if (!box) return;
  setCalendarChecked(box.dataset.calId, box.checked);
});

// v1.15.2 — 분·초를 고치는 동안 표시 시간이 바로 따라간다(입력값 = 표시 시간).
panelEl.addEventListener('input', (event) => {
  if (!event.target.closest('#timer-min, #timer-sec')) return;
  timerChoice = timerCardSeconds();
  const display = panelEl.querySelector('#timer-display');
  if (display) display.textContent = formatClock(timerChoice);
  paintTimerChoice();
});

/* 파일 끌어다 놓기 — 두 갈래를 모두 받는다. (v1.12.2)
   ① Tauri 네이티브: Rust 가 tip://shelf-drag / tip://shelf-drop(경로 목록)을 보낸다.
      NonactivatingPanel + WKWebView 에서는 HTML5 dataTransfer 로 파일이 오지 않았다.
   ② HTML5: 브라우저·미리보기처럼 dataTransfer 로 오는 경우의 대비. */

function setDragState(on) {
  dragHeld = !!on;
  const drop = panelEl.querySelector('#shelf-drop');
  if (drop) drop.classList.toggle('is-over', dragHeld && view === 'full');
  // 파일을 끌고 들어오면 빈 보관함도 놓을 자리를 보여 준다(v1.15.2).
  const card = panelEl.querySelector('.wg-shelf');
  if (card) card.classList.toggle('is-empty', !dragHeld && shelf.length === 0);
  // v1.17.0 — 접혀 있으면 펼치지 않고 알약에 '여기에 놓기', 반원이면 판 전체에 안내.
  const dialDrop = document.getElementById('dial-drop');
  if (dialDrop) dialDrop.hidden = !(dragHeld && expanded && view === 'simple' && !calView.open);
  notchEl.classList.toggle('is-drag', dragHeld);
  if (!expanded) setPillNote(dragHeld ? '여기에 놓기' : '', 0);
  syncHold();
  if (dragHeld) cancelCollapse();
  else if (expanded) scheduleCollapse();
  fitPanel();
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
  addFiles(files);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    // 일정 추가 폼이 열려 있으면 폼부터 닫는다.
    if (calForm.open) {
      closeCalendarForm();
      return;
    }
    // v1.17.0 — 달력에서는 노치를 닫지 않고 열기 전 화면으로 돌아간다(닫기 버튼과 같다).
    if (calView.open) {
      closeCalendarView();
      return;
    }
    setExpanded(false);
  }
});

/* v1.17.0 — 클릭·메뉴 막대로 열어 키 창이 된 노치는, 다른 곳을 눌러 키 창을 잃으면 접는다.
   (예전 반원 퀵바 창이 바깥을 누르면 닫히던 것과 같다. 마우스로만 연 노치는 키 창이 아니라 오지 않는다.)
   키 창으로 바뀌는 짧은 순간의 blur 는 한 박자 뒤에 다시 보고 넘긴다.
   v1.17.1 — 커서가 아직 창 안이면 접지 않는다(달력의 <select>·날짜 고르기 창처럼 키만 잠깐 옴기는 경우). */
window.addEventListener('blur', () => {
  // 키 상태를 잃으면 안쪽 초점을 놓아 '입력 중' 표시가 남지 않게 한다(v1.17.1).
  setTimeout(() => {
    if (document.hasFocus()) return;
    const active = document.activeElement;
    if (active && active !== document.body && notchEl.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
    heldOpen = false;
    syncHold();
  }, 0);
  if (!expanded || !openedWithKeys) return;
  setTimeout(async () => {
    if (!expanded || document.hasFocus() || notchHeld() || dragHeld) return;
    if (!(await cursorOutside())) return;
    if (!expanded) return;
    setExpanded(false);
  }, 220);
});

// 창 크기가 바뀌면 Rust 가 접거나 펼친 것 — 화면도 맞춘다.
// v1.15.0 — 접힌 알약이 음악·타이머로 320px 넘게 넓어질 수 있어, 폭이 아니라 **높이**로
// 펼침을 가른다(접힘 ~36pt · 펼침 600pt).
function syncLayout() {
  const wide = window.innerHeight >= 200;
  if (wide && !expanded) {
    expanded = true;
    // Rust 가 먼저 펼친 경우(마우스 올리기) — 시작 화면으로 맞춘다. 포커스는 가져가지 않는다.
    openedVia = 'hover';
    openedAt = Date.now();
    enteredSinceOpen = false;
    notchEl.classList.remove('is-collapsed');
    notchEl.classList.add('is-expanded');
    view = getNotchSettings().startView;
    applyView();
    startWidgets();
  } else if (!wide && expanded) {
    expanded = false;
    notchEl.classList.remove('is-expanded');
    notchEl.classList.add('is-collapsed');
    stopWidgets();
  }
}
window.addEventListener('resize', () => {
  syncLayout();
  // v1.17.1 — 창이 펼쳐진 뒤 모듈 칸을 다시 놓는다(알약 폭에서 그린 칸이 남지 않게).
  if (expanded) layoutDial();
  // 디스플레이를 옮기면 노치 유무가 달라진다 — 가운데 여백을 다시 잰다.
  if (!expanded) loadNotchMetrics();
});

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
    if (!expanded && getNotchSettings().hoverOpen) openNotch('hover');
  });

  // v1.17.0 — 메뉴 막대 TIP 아이콘(예전에는 반원 퀵바 창을 열었다). 열려 있으면 닫는다.
  listen('tip://notch-tray', () => {
    if (expanded) setExpanded(false);
    else openNotch('tray');
  });
  listen('tip://notch-hover-leave', () => {
    if (expanded) setExpanded(false);
  });

  // v1.15.0 — 타이머가 바뀌면(다른 창에서 시작·정지) 알약을 바로 다시 그린다.
  listen('tip://timer', () => { paintPill(); paintTimerCard(); });

  // Finder 파일 드래그 — 들어오면 펼치고, 놓으면 경로를 읽어 보관함에 담는다.
  listen('tip://shelf-drag', (event) => setDragState(!!(event && event.payload)));
  listen('tip://shelf-drop', (event) => {
    setDragState(false);
    addShelfPaths(event && event.payload).catch(() => toast('파일을 담지 못했습니다'));
  });
}

/* ------------------------------ 설정 다시 읽기 ------------------------------ */

/** 판 배경 불투명도 — 환경설정 '반원 배경 불투명도'(tip.quickbarOpacity.v1, 70~100%).
 *  반원과 전체 보기가 같은 판이라 둘 다 같은 값을 쓴다(v1.17.0). */
function applySheetOpacity() {
  document.documentElement.style.setProperty('--sheet-alpha', (getQuickbarOpacity() / 100).toFixed(2));
}

/** 저장된 설정을 새로 읽어 모양·위젯 목록을 다시 그린다. 펼쳐져 있으면 조회도 새로 한다. */
function refreshFromSettings() {
  syncStore();
  applyAppearance();
  applySheetOpacity();
  settingsRev += 1;
  renderWidgets();
  // 미디어 위젯을 꺼면 알약에서도 곧바로 지우고, 켜면 바로 한 번 읽는다.
  if (!getNotchSettings().widgets.media) {
    mediaState = null;
  } else if (!mediaState) {
    fetchMedia();
  }
  paintPill();
  paintTimerCard();
  // 마우스 오버 설정이 바뀌면 Rust 커서 감시도 바로 따라가게 한다(v1.12.4).
  invoke('set_notch_hover', { enabled: getNotchSettings().hoverOpen }).catch(() => {});
  if (expanded) {
    fetchMedia();
    refreshCalendar();
  }
}

/* ------------------------------ 시작 ------------------------------ */

if (new URLSearchParams(location.search).has('bg')) {
  document.body.classList.add('has-preview-bg');
}

applyAppearance();
applySheetOpacity();
bindDial();
renderWidgets();
syncLayout();
// v1.17.1 — 판 크기가 바뀜에 따라 다이얼을 다시 놓을 수 있게 지켜본다.
watchDialSize();
// v1.15.0 — 알약의 음악·타이머 표시와 그 배경 루프, 노치 자리(가운데 여백).
loadNotchMetrics();
startPillLoops();
// 노치 창이 직접 저장값을 Rust 에 밀어 준다 — 메인 창이 닫혀 있어도 커서 감시가 맞게 돈다.
invoke('set_notch_hover', { enabled: getNotchSettings().hoverOpen }).catch(() => {});

// 빠른 메모 입력 중·파일 드래그 중에는 Rust 가 접지 않게 한다(v1.12.4).
document.addEventListener('focusin', syncHold);
document.addEventListener('focusout', () => setTimeout(syncHold, 0));
