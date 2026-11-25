/* TIP · 데이터 백업과 복원 (v1.16.0)
 *
 * 설정 전체(모듈 켜기·고정, 홈 순서, 테마·색, 노치·메뉴 막대, 전역 검색·단축키, 스니펫,
 * 타이머 상태, 최근 사용)를 JSON 한 파일로 만들고, 그 파일로 되돌린다.
 * 스티커 메모와 클립보드 기록은 Mac 앱에서만 있고, 클립보드는 [클립보드 기록도 포함]을 켰을 때만 넣는다.
 *
 * 형식(format)과 판(version)을 적어 두고, 모르는 형식이나 깨진 파일은 아무것도 바꾸지 않고 이유만 알린다.
 * 파일은 기기 안에서만 다룬다(어디로도 보내지 않는다).
 */

export const BACKUP_FORMAT = 'tip-backup';
export const BACKUP_VERSION = 1;

const TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
const C = TAURI ? window.__TAURI__.core : null;

/** 백업에 넣는 localStorage 키 — 앱의 설정·기록만. 임시 값(handoff·캐시)은 넣지 않는다. */
export const BACKUP_KEYS = [
  'tip.settings.v1',
  'tip.order.v1',
  'tip.radialOrder.v1',
  'tip.radialOrderMode.v1',
  'tip.menuBarVisible.v1',
  'tip.quickbarOpacity.v1',
  'tip.notch.v1',
  'tip.searchShortcut.v1',
  'tip.theme',
  'tip.accent',
  'tip.featureValues.v1',
  'tip.shortcuts.v1',
  'tip.shortcutLetters.v1',
  'tip.shortcutExtra.v1',
  'tip.shortcutPrefix.v1',
  'tip.systemCommands.v1',
  'tip.searchScope.v1',
  'tip.snippets.v1',
  'tip.timer.v1',
  'tip.calendar.selectedIds.v1',
  'tip.recent.v1',
  'tip.recent.enabled.v1',
];

const MAX_CLIPBOARD_BYTES = 6 * 1024 * 1024;

function rawValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function countOf(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

/* ------------------------------ 만들기 ------------------------------ */

/** 지금 설정을 백업 파일 내용으로 만든다. includeClipboard 는 Mac 에서만 뜻이 있다. */
export async function collectBackup({ includeClipboard = false, version = '' } = {}) {
  const settings = {};
  BACKUP_KEYS.forEach((key) => {
    const raw = rawValue(key);
    if (raw !== null) settings[key] = raw;
  });

  const data = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: version,
    created: new Date().toISOString(),
    settings,
    stickyNotes: null,
    clipboard: null,
  };

  if (TAURI) {
    try {
      data.stickyNotes = await C.invoke('sticky_list');
    } catch {
      data.stickyNotes = null;
    }
  }

  if (includeClipboard && TAURI) {
    try {
      const items = await C.invoke('clipboard_list');
      let list = Array.isArray(items) ? items : [];
      const textOnly = list.filter((item) => item.kind !== 'image');
      const withImages = JSON.stringify(list);
      // 그림이 많아 6MB 를 넘으면 그림은 빼고 글자만 넣는다(파일이 너무 커지지 않게).
      let skippedImages = 0;
      if (withImages.length > MAX_CLIPBOARD_BYTES) {
        skippedImages = list.length - textOnly.length;
        list = textOnly;
      }
      data.clipboard = { included: true, items: list, skippedImages };
    } catch {
      data.clipboard = { included: false, items: [], error: '클립보드 기록을 읽지 못했습니다' };
    }
  }

  return JSON.stringify(data, null, 2);
}

export function backupFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `tip-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.json`;
}

/* ------------------------------ 미리보기 ------------------------------ */

/**
 * 백업 파일 내용을 읽어 무엇이 들어 있는지 센다. 깨졌거나 모르는 형식이면 ok:false 와 이유.
 * 아직 아무것도 바꾸지 않는다.
 */
export function readBackup(text) {
  const source = String(text || '').trim();
  if (!source) return { ok: false, error: '파일이 비어 있습니다' };
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    return { ok: false, error: 'JSON 파일이 깨졌습니다. TIP 에서 만든 백업 파일인지 확인해 주세요' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '백업 파일 형식이 아닙니다' };
  }
  if (data.format !== BACKUP_FORMAT) {
    return { ok: false, error: `모르는 형식입니다(${String(data.format || '형식 없음')})` };
  }
  const version = Number(data.version);
  if (!Number.isFinite(version) || version < 1) {
    return { ok: false, error: '백업 파일의 판(version)을 읽지 못했습니다' };
  }
  if (version > BACKUP_VERSION) {
    return { ok: false, error: `이 앱보다 새로운 백업입니다(v${version}). 앱을 먼저 업데이트해 주세요` };
  }
  if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    return { ok: false, error: '설정 묶음이 없습니다' };
  }

  const settings = {};
  let ignored = 0;
  Object.entries(data.settings).forEach(([key, value]) => {
    if (!BACKUP_KEYS.includes(key) || typeof value !== 'string') {
      ignored += 1;
      return;
    }
    settings[key] = value;
  });

  const moduleSettings = parseJson(settings['tip.settings.v1'], {});
  const modules = moduleSettings && moduleSettings.modules && typeof moduleSettings.modules === 'object'
    ? Object.keys(moduleSettings.modules).length
    : 0;
  const order = parseJson(settings['tip.order.v1'], {});
  const orderCount = Object.values(order || {}).reduce((total, list) => total + (Array.isArray(list) ? list.length : 0), 0);
  const letters = parseJson(settings['tip.shortcutLetters.v1'], {});
  const extras = parseJson(settings['tip.shortcutExtra.v1'], {});
  const snippets = parseJson(settings['tip.snippets.v1'], []);
  const recent = parseJson(settings['tip.recent.v1'], []);
  const sticky = Array.isArray(data.stickyNotes) ? data.stickyNotes : [];
  const clipboard = data.clipboard && Array.isArray(data.clipboard.items) ? data.clipboard.items : [];

  const summary = [];
  summary.push({ label: '모듈 설정', value: `${modules}개` });
  summary.push({ label: '홈 카드 순서', value: `${orderCount}개` });
  summary.push({ label: '단축키', value: `${countOf(letters) + countOf(extras)}개` });
  summary.push({ label: '스니펫', value: `${countOf(snippets)}개` });
  summary.push({ label: '최근 사용 기록', value: `${countOf(recent)}개` });
  summary.push({ label: '설정 항목', value: `${Object.keys(settings).length}개` });
  if (TAURI) summary.push({ label: '스티커 메모', value: sticky.length ? `${sticky.length}장` : '없음' });
  if (clipboard.length) {
    const skipped = Number(data.clipboard.skippedImages) || 0;
    summary.push({ label: '클립보드 기록', value: `${clipboard.length}개${skipped ? ` (그림 ${skipped}개는 빠짐)` : ''}` });
  } else {
    summary.push({ label: '클립보드 기록', value: '포함하지 않음' });
  }

  return {
    ok: true,
    data,
    settings,
    stickyNotes: sticky,
    clipboard: clipboard.length ? data.clipboard : null,
    ignored,
    summary,
    created: typeof data.created === 'string' ? data.created : '',
    app: typeof data.app === 'string' ? data.app : '',
  };
}

/** 미리보기에서 '무엇을 덮어쓰는지' 한 줄로. */
export function describeBackup(parsed) {
  if (!parsed || !parsed.ok) return '';
  const when = parsed.created ? new Date(parsed.created) : null;
  const stamp = when && !Number.isNaN(when.getTime())
    ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
    : '만든 날짜 모름';
  return `${stamp} 백업${parsed.app ? `, TIP ${parsed.app}` : ''}`;
}

/* ------------------------------ 되돌리기 ------------------------------ */

/** 미리보기에서 확인한 백업을 실제로 적용한다. 실패하면 이유를 돌려준다. */
export async function applyBackup(parsed) {
  if (!parsed || !parsed.ok) return { ok: false, error: '먼저 백업 파일을 읽어 주세요' };

  // 값이 하나라도 이상하면 아무것도 바꾸지 않는다 — 먼저 전부 검사한다.
  const writes = [];
  for (const [key, raw] of Object.entries(parsed.settings)) {
    if (!BACKUP_KEYS.includes(key) || typeof raw !== 'string') continue;
    // JSON 으로 저장되는 키는 문자열이 JSON 인지 확인한다(깨진 값이 들어가지 않게).
    if (!['tip.theme', 'tip.accent', 'tip.menuBarVisible.v1', 'tip.quickbarOpacity.v1', 'tip.searchShortcut.v1', 'tip.shortcutPrefix.v1'].includes(key)) {
      try {
        JSON.parse(raw);
      } catch {
        return { ok: false, error: `${key} 값이 깨져 있어 아무것도 바꾸지 않았습니다` };
      }
    }
    writes.push([key, raw]);
  }

  try {
    writes.forEach(([key, raw]) => localStorage.setItem(key, raw));
  } catch {
    return { ok: false, error: '이 브라우저에서는 저장 공간을 쓸 수 없어 되돌리지 못했습니다' };
  }

  if (TAURI && Array.isArray(parsed.stickyNotes) && parsed.stickyNotes.length) {
    try {
      await C.invoke('sticky_restore', { notes: parsed.stickyNotes });
    } catch (error) {
      console.warn('[TIP backup] 스티커 메모를 되돌리지 못했습니다', error);
      return { ok: true, warning: '설정은 되돌렸지만 스티커 메모는 되돌리지 못했습니다' };
    }
  }

  if (TAURI && parsed.clipboard && Array.isArray(parsed.clipboard.items) && parsed.clipboard.items.length) {
    try {
      await C.invoke('clipboard_restore', { items: parsed.clipboard.items });
    } catch (error) {
      console.warn('[TIP backup] 클립보드 기록을 되돌리지 못했습니다', error);
      return { ok: true, warning: '설정은 되돌렸지만 클립보드 기록은 되돌리지 못했습니다' };
    }
  }

  return { ok: true, keys: writes.length };
}
