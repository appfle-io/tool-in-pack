/* TIP · 기능별 설정 저장 + 전역 단축키 (v1.14.0)
 *
 * 세 가지를 이 파일 하나에 모은다.
 *  1) 기능 옵션 값 (tip.featureValues.v1) — 스티커 기본 색, 스포이드 형식, OCR 언어 등
 *  2) 기능별 전역 단축키 (tip.shortcuts.v1) — 기능 id → accelerator 문자열
 *  3) 전역 검색 대상 스위치 (tip.searchScope.v1) — 모듈·앱·파일·계산기·웹·스니펫
 *
 * 단축키의 진짜 주인은 이 저장소이고, Mac 앱이 켜질 때 set_module_shortcuts 로 Rust 에 밀어 준다
 * (Rust 는 등록만 하고 저장하지 않는다 — 화면을 지우면 단축키도 함께 사라진다).
 */

const VALUES_KEY = 'tip.featureValues.v1';

/** 시스템 명령 9종 — 설정과 검색이 함께 쓴다. */
export const SYSTEM_COMMANDS = {
  lock: '화면 잠금',
  sleep: '잠자기',
  screensaver: '화면 보호기',
  darkmode: '다크 · 라이트 모드 전환',
  hiddenfiles: '숨김 파일 표시 전환',
  emptytrash: '휴지통 비우기',
  restart: '재시동',
  shutdown: '시스템 종료',
  logout: '로그아웃',
};

/** 되돌릴 수 없는 네 명령 — 기본 OFF(v1.15.1). Rust 도 같은 기본값으로 거부한다. */
export const RISKY_SYSTEM_COMMANDS = ['emptytrash', 'restart', 'shutdown', 'logout'];
const SHORTCUTS_KEY = 'tip.shortcuts.v1';
const SCOPE_KEY = 'tip.searchScope.v1';

/* v1.15.0 — 모듈 단축키의 공통 조합(Prefix)과 한 글자.
 *
 * 유동규 님 지시: "전역에 컨트롤+쉽프트로 해두고 다른 단축키 지정은 여기서 알파벳만.
 * (옵션+스페이스는 그대로 유지. 이건 별도야)"
 *   · 공통 조합 하나(tip.shortcutPrefix.v1, 기본 Control+Shift)를 정하고
 *   · 각 모듈·도구는 알파벳·숫자 한 글자(tip.shortcutLetters.v1)만 고른다.
 *   · 실제 전역 단축키는 'Control+Shift+KeyS' 처럼 조합해 Rust 에 넘긴다.
 * v1.14.0 의 '전체 조합 직접 입력'(tip.shortcuts.v1) 값은 한 번 옮긴다 — 기본 조합과
 * 같은 조합은 글자로, 방향키처럼 글자로 표현할 수 없는 조합은 그대로 남긴다(extra).
 */
const PREFIX_KEY = 'tip.shortcutPrefix.v1';
const LETTERS_KEY = 'tip.shortcutLetters.v1';
const EXTRA_KEY = 'tip.shortcutExtra.v1';
const MIGRATION_KEY = 'tip.shortcutMigration.v115';

/** 고를 수 있는 공통 조합 — 모두 'Shift 또는 Control/Command' 가 붙어 오타 입력이 없다. */
export const SHORTCUT_PREFIXES = [
  { id: 'Control+Shift', label: 'Control + Shift', short: '⌃⇧' },
  { id: 'Alt+Shift', label: 'Option + Shift', short: '⌥⇧' },
  { id: 'Command+Shift', label: 'Command + Shift', short: '⌘⇧' },
  { id: 'Control+Alt', label: 'Control + Option', short: '⌃⌥' },
  { id: 'Command+Alt', label: 'Command + Option', short: '⌘⌥' },
  { id: 'Control+Command', label: 'Control + Command', short: '⌃⌘' },
];

export const DEFAULT_PREFIX = 'Control+Shift';

/** 저장된 공통 조합 — 모르는 값이면 기본값. */
export function getShortcutPrefix() {
  try {
    const saved = localStorage.getItem(PREFIX_KEY);
    return SHORTCUT_PREFIXES.some((item) => item.id === saved) ? saved : DEFAULT_PREFIX;
  } catch {
    return DEFAULT_PREFIX;
  }
}

export function setShortcutPrefix(prefix) {
  if (!SHORTCUT_PREFIXES.some((item) => item.id === prefix)) return false;
  try {
    localStorage.setItem(PREFIX_KEY, prefix);
  } catch { /* 저장하지 못하면 이번에만 */ }
  return true;
}

/** 'KeyS' → 'S', 'Digit1' → '1'. 글자·숫자가 아니면 ''. */
export function letterForCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return '';
}

/** 'S' → 'KeyS', '1' → 'Digit1'. 알파벳·숫자 한 글자가 아니면 ''. */
export function codeForLetter(letter) {
  const value = String(letter || '').trim().toUpperCase();
  if (/^[A-Z]$/.test(value)) return `Key${value}`;
  if (/^[0-9]$/.test(value)) return `Digit${value}`;
  return '';
}

/** 공통 조합 + 한 글자 → 실제 accelerator. 글자가 없으면 ''. */
export function acceleratorForLetter(letter, prefix = getShortcutPrefix()) {
  const code = codeForLetter(letter);
  return code ? `${prefix}+${code}` : '';
}

/** 모듈 단축키로 쓸 수 있는 한 글자인지. */
export function validShortcutLetter(letter) {
  return !!codeForLetter(letter);
}

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);

function invoke(command, args) {
  return window.__TAURI__.core.invoke(command, args || {});
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 저장하지 못하면 이번 실행에만 적용된다 */ }
}

/* ------------------------------ 기능 옵션 ------------------------------ */

/** 화면이 고르는 값 — 모듈이 getFeatureValue 로 읽는다. */
export function getFeatureValue(key, fallback) {
  const values = readJson(VALUES_KEY, {});
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
}

export function setFeatureValue(key, value) {
  const values = { ...readJson(VALUES_KEY, {}), [key]: value };
  writeJson(VALUES_KEY, values);
  return value;
}

/* ------------------------------ 전역 검색 대상 ------------------------------ */

export const SEARCH_SCOPE_ITEMS = [
  { id: 'modules', label: 'TIP 모듈', hint: '켜 둔 모듈을 이름·키워드로 찾아 실행' },
  { id: 'apps', label: '맥 앱 (초성)', hint: '/Applications 의 앱을 이름·초성(ㅋㄹ → 크롬)으로 찾아 실행', mac: true },
  { id: 'files', label: '로컬 파일 (mdfind)', hint: '홈 폴더의 파일 이름을 Spotlight 색인으로 찾아 열기', mac: true },
  { id: 'calc', label: '즉석 계산기', hint: '수식을 넣으면 결과를 바로 — Enter 로 복사' },
  { id: 'web', label: '웹 검색', hint: 'g·n 으로 Google·Naver 검색, 또는 결과 아래에서 바로' },
  { id: 'snippets', label: '스니펫', hint: '/별칭 이나 낱말로 자주 쓰는 문구를 찾아 복사' },
  { id: 'system', label: '시스템 명령', hint: '화면 잠금·잠자기·다크 모드·종료 등 — 위험한 명령은 한 번 더 확인합니다', mac: true },
];

const SCOPE_DEFAULTS = { modules: true, apps: true, files: true, calc: true, web: true, snippets: true, system: true };

export function getSearchScope() {
  const saved = readJson(SCOPE_KEY, {});
  const scope = {};
  SEARCH_SCOPE_ITEMS.forEach(({ id }) => {
    scope[id] = typeof saved[id] === 'boolean' ? saved[id] : SCOPE_DEFAULTS[id];
  });
  return scope;
}

export function setSearchScope(id, on) {
  const next = { ...getSearchScope(), [id]: !!on };
  writeJson(SCOPE_KEY, next);
  return next;
}

export function searchScopeEnabled(id) {
  return getSearchScope()[id] !== false;
}

/* --------------------------- 시스템 명령 켜기/끄기 --------------------------- */
// 검색창(js/search.js)과 설정(app.js)이 같은 값을 본다.

const SYSTEM_KEY = 'tip.systemCommands.v1';

export function getSystemCommandEnabled() {
  let saved = {};
  try {
    const parsed = JSON.parse(localStorage.getItem(SYSTEM_KEY) || 'null');
    if (parsed && typeof parsed === 'object') saved = parsed;
  } catch { saved = {}; }
  const next = {};
  Object.keys(SYSTEM_COMMANDS).forEach((id) => {
    const fallback = !RISKY_SYSTEM_COMMANDS.includes(id);
    next[id] = typeof saved[id] === 'boolean' ? saved[id] : fallback;
  });
  return next;
}

export function setSystemCommandEnabled(id, on) {
  const next = { ...getSystemCommandEnabled(), [id]: !!on };
  try {
    localStorage.setItem(SYSTEM_KEY, JSON.stringify(next));
  } catch { /* 저장하지 못하면 이번에만 */ }
  // v1.15.1 — Rust 가 같은 값을 들고 있어야 꺼 둔 명령을 실제로 거부한다.
  syncSystemCommands(next);
  return next;
}

/** 시스템 명령 스위치 전부를 Rust 에 밀어 준다(앱이 켜질 때·바뀔 때). */
export async function syncSystemCommands(settings) {
  if (!TAURI) return;
  const values = settings || getSystemCommandEnabled();
  try {
    await invoke('set_system_commands', { settings: values });
  } catch (error) {
    console.warn('[TIP] 시스템 명령 설정을 밀지 못했습니다', error);
  }
}

/* ------------------------------ 전역 단축키 ------------------------------ */

/** 기능 id → 한 글자. 값이 없으면 그 기능은 단축키가 없다. */
export function getShortcutLetters() {
  return readJson(LETTERS_KEY, {});
}

/** 글자로 표현할 수 없는 조합(방향키 등, v1.14.0에서 직접 정한 값). */
export function getShortcutExtras() {
  return readJson(EXTRA_KEY, {});
}

/** v1.14.0 값 옮기기 — 한 번만. 기본 조합과 같은 것은 글자로, 나머지는 extra 로. */
function migrateShortcuts() {
  try {
    if (localStorage.getItem(MIGRATION_KEY) === '1') return;
  } catch {
    return;
  }
  const old = readJson(SHORTCUTS_KEY, {});
  const prefix = getShortcutPrefix();
  const letters = readJson(LETTERS_KEY, {});
  const extras = readJson(EXTRA_KEY, {});
  Object.entries(old).forEach(([key, accelerator]) => {
    const value = String(accelerator || '').trim();
    if (!value || letters[key] || extras[key]) return;
    const match = value.match(/^(.*)\+(Key[A-Z]|Digit[0-9])$/);
    if (match && match[1] === prefix) letters[key] = letterForCode(match[2]);
    else extras[key] = value;
  });
  writeJson(LETTERS_KEY, letters);
  writeJson(EXTRA_KEY, extras);
  try {
    localStorage.setItem(MIGRATION_KEY, '1');
  } catch { /* 다음 실행에 다시 시도해도 결과는 같다 */ }
}

migrateShortcuts();

/** 지금 실제로 등록할 단축키 — 글자(공통 조합과 합침) + 그대로 쓴 조합. */
export function shortcutEntries() {
  const prefix = getShortcutPrefix();
  const entries = [];
  Object.entries(getShortcutLetters()).forEach(([key, letter]) => {
    const accelerator = acceleratorForLetter(letter, prefix);
    if (accelerator) entries.push([key, accelerator]);
  });
  Object.entries(getShortcutExtras()).forEach(([key, accelerator]) => {
    if (String(accelerator || '').trim()) entries.push([key, String(accelerator).trim()]);
  });
  return entries;
}

/** 기능 id → 실제 accelerator. 글자가 먼저, 없으면 직접 정한 조합. */
export function getShortcut(actionKey) {
  const letter = getShortcutLetters()[actionKey];
  if (letter) return acceleratorForLetter(letter);
  return getShortcutExtras()[actionKey] || '';
}

/** v1.14.0 호환 — 전체 조합을 직접 넣는다(방향키처럼 글자가 아닌 것만). */
export function setShortcut(actionKey, accelerator) {
  const value = String(accelerator || '').trim();
  const extras = { ...getShortcutExtras() };
  if (value) extras[actionKey] = value;
  else delete extras[actionKey];
  writeJson(EXTRA_KEY, extras);
  return extras;
}

/** 한 글자로 지정한다. 같은 조합을 이미 쓰는 기능이 있으면 { ok:false, owner }. */
export function setShortcutLetter(actionKey, letter) {
  const value = String(letter || '').trim().toUpperCase();
  if (!value) return { ok: false, reason: 'empty' };
  if (!validShortcutLetter(value)) return { ok: false, reason: 'invalid' };
  const accelerator = acceleratorForLetter(value);
  const owner = shortcutOwner(accelerator, actionKey);
  if (owner) return { ok: false, reason: 'duplicate', owner, accelerator };

  const letters = { ...getShortcutLetters(), [actionKey]: value };
  writeJson(LETTERS_KEY, letters);
  // 같은 기능에 직접 정한 조합이 남아 있으면 지운다 — 둘 다 등록되면 늘 실패한다.
  const extras = { ...getShortcutExtras() };
  if (extras[actionKey]) {
    delete extras[actionKey];
    writeJson(EXTRA_KEY, extras);
  }
  return { ok: true, accelerator };
}

export function clearShortcut(actionKey) {
  const letters = { ...getShortcutLetters() };
  const extras = { ...getShortcutExtras() };
  delete letters[actionKey];
  delete extras[actionKey];
  writeJson(LETTERS_KEY, letters);
  writeJson(EXTRA_KEY, extras);
  return letters;
}

/** 같은 단축키를 이미 쓰는 기능 — 충돌을 미리 알려 준다. */
export function shortcutOwner(accelerator, exceptKey) {
  const target = String(accelerator || '').trim();
  if (!target) return null;
  const found = shortcutEntries().find(([key, value]) => key !== exceptKey && value === target);
  return found ? found[0] : null;
}

/** 저장된 단축키를 Rust 에 통째로 등록한다. 실패한 항목 목록을 돌려준다. */
export async function syncShortcuts() {
  if (!TAURI) return [];
  const items = shortcutEntries();
  try {
    const failures = await invoke('set_module_shortcuts', { items });
    return Array.isArray(failures) ? failures : [];
  } catch (error) {
    console.warn('[TIP] 단축키를 등록하지 못했습니다', error);
    return [];
  }
}

/* ------------------------- 모듈별 설정 차례 · 항목 ------------------------- */

/**
 * 모듈 id → 그 모듈의 설정 차례.
 *  value  : 기능 옵션(스위치·고르기·색)
 *  action : 단축키를 걸 수 있는 동작
 */
export const MODULE_SETTINGS = {
  // v1.15.1 — 비밀번호 관리자가 복사한 값은 기록하지 않는다(기본 ON). Rust(clip.rs)가 같은 값을 든다.
  'clipboard-history': {
    values: [
      {
        key: 'clip.excludeSecret',
        label: '비밀번호 앱에서 복사한 항목 제외',
        type: 'switch',
        fallback: true,
        hint: '1Password·Apple 암호 같은 앱이 복사한 값은 기록에 넣지 않습니다(Mac).',
        apply: (value) => {
          if (TAURI) {
            invoke('set_clipboard_exclude_secret', { enabled: value !== false })
              .catch((error) => console.warn('[TIP] 클립보드 설정을 밀지 못했습니다', error));
          }
        },
      },
    ],
    actions: [{ key: 'clipboard-history', label: '클립보드 열기' }],
  },
  'sticky-notes': {
    values: [
      {
        key: 'sticky.color',
        label: '새 스티커 기본 색',
        type: 'color',
        fallback: 'auto',
        hint: 'auto 는 환경설정의 기본 색을 따라갑니다.',
        options: [
          ['auto', '기본 색 따르기'], ['yellow', '노랑'], ['green', '딥그린'],
          ['blue', '파랑'], ['pink', '분홍'], ['purple', '보라'], ['dark', '다크그레이'],
        ],
      },
    ],
    actions: [{ key: 'sticky:new', label: '새 스티커 열기', hint: '어디서든 새 스티커를 띄웁니다' }],
  },
  'screen-picker': {
    values: [
      {
        key: 'picker.format',
        label: '복사할 색 형식',
        type: 'select',
        fallback: 'hex',
        options: [['hex', 'HEX (#2E5E4E)'], ['rgb', 'RGB (rgb(46, 94, 78))'], ['hsl', 'HSL (hsl(160, 34%, 27%))']],
      },
      { key: 'picker.autoCopy', label: '고른 색 자동 복사', type: 'switch', fallback: true },
    ],
    actions: [
      { key: 'screen-picker', label: '화면에서 색 고르기', hint: '단축키를 누르고 화면의 한 점을 클릭' },
    ],
  },
  'drag-ocr': {
    values: [
      {
        key: 'ocr.lang',
        label: '글자 인식 언어',
        type: 'select',
        fallback: 'kor+eng',
        options: [['kor+eng', '한국어 + 영어'], ['kor', '한국어'], ['eng', '영어'], ['jpn', '일본어']],
      },
      { key: 'ocr.autoCopy', label: '추출한 글자 자동 복사', type: 'switch', fallback: true },
    ],
    actions: [{ key: 'drag-ocr', label: '화면 영역 글자 추출', hint: '단축키를 누르고 화면을 드래그' }],
  },
  'window-snap': {
    values: [],
    actions: [
      { key: 'snap:left', label: '왼쪽 절반', recommended: 'Control+Alt+ArrowLeft' },
      { key: 'snap:right', label: '오른쪽 절반', recommended: 'Control+Alt+ArrowRight' },
      { key: 'snap:top', label: '위쪽 절반', recommended: 'Control+Alt+ArrowUp' },
      { key: 'snap:bottom', label: '아래쪽 절반', recommended: 'Control+Alt+ArrowDown' },
      { key: 'snap:max', label: '최대화', recommended: 'Control+Alt+Enter' },
      { key: 'snap:center', label: '가운데 70%', recommended: 'Control+Alt+KeyC' },
    ],
  },
  'bulk-rename': {
    values: [
      {
        key: 'rename.pad',
        label: '일련번호 자릿수',
        type: 'select',
        fallback: '3',
        options: [['2', '2자리 (01)'], ['3', '3자리 (001)'], ['4', '4자리 (0001)']],
      },
    ],
    actions: [],
  },
  snippets: {
    values: [],
    actions: [],
  },
};

/** 값이 있는 옵션의 apply 훅을 한 번 실행한다 — 앱이 켜질 때 저장값을 Rust 에 밀어 줄 때 쓴다. */
export function applyModuleValues() {
  Object.values(MODULE_SETTINGS).forEach((entry) => {
    (entry.values || []).forEach((option) => {
      if (typeof option.apply === 'function') {
        option.apply(getFeatureValue(option.key, option.fallback));
      }
    });
  });
}

/* ------------------------- 로컬 파일 검색 첫 안내 ------------------------- */
// v1.15.1 — 파일 검색을 처음 쓴 사람에게 '홈 폴더 파일 이름을 검색한다'를 한 번만 알린다.

const FILES_NOTICE_KEY = 'tip.search.filesNotice.v1';

export function filesNoticePending() {
  try {
    return localStorage.getItem(FILES_NOTICE_KEY) !== '1';
  } catch {
    return true;
  }
}

export function markFilesNoticeShown() {
  try {
    localStorage.setItem(FILES_NOTICE_KEY, '1');
  } catch { /* 못 적어도 다음에 또 보여 줄 뿐이다 */ }
}

/** 설정 차례가 없는 모듈도 '모듈 열기' 단축키는 걸 수 있다. */
export function actionsFor(moduleId) {
  const custom = MODULE_SETTINGS[moduleId]?.actions;
  if (custom && custom.length) return custom;
  return [{ key: moduleId, label: '모듈 열기' }];
}

export function valuesFor(moduleId) {
  return MODULE_SETTINGS[moduleId]?.values || [];
}
