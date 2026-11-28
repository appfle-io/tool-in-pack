/* TIP · 홈 보기 상태 — 상단 분류 필터와 접힌 분류 (v1.28.0)
 *
 * 모듈이 36개로 늘어 홈이 길어졌다. 홈 상단에서 분류를 고르거나 분류 제목 줄을 눌러 접을 수 있고,
 * 그 선택은 이 기기에 남겨 다음에 열 때 그대로 이어진다.
 *
 * 값은 두 곳에 같은 JSON 으로 둔다.
 *   · localStorage 'tip.home.v1' — 늘 되는 곳. Tauri 의 tauri:// 나 file:// 에서도 산다.
 *   · 쿠키 tip_home — localStorage 가 막히는 사생활 보호 모드에서도 남는 곳.
 * 어느 한쪽이 막혀도 다른 쪽이 받쳐 주도록 읽기·쓰기를 모두 try/catch 로 감싼다.
 * 값은 기기 밖으로 나가지 않는다.
 *
 * 저장하는 것: { filter: 'all' | 분류 id, collapsed: [분류 id...] }
 * 검색어는 저장하지 않는다 — 앱을 다시 열면 검색 전 화면(저장된 필터·접힘)으로 돌아온다.
 */

export const HOME_VIEW_KEY = 'tip.home.v1';
export const HOME_VIEW_COOKIE = 'tip_home';
export const HOME_VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1년

/** 고를 수 있는 필터 — 'all' + registry 의 분류 id. */
const FILTERS = ['all', 'docs', 'media', 'file', 'calc', 'dev', 'game', 'mac'];

function normalize(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const filter = FILTERS.includes(value.filter) ? value.filter : 'all';
  const collapsed = [];
  const seen = new Set();
  if (Array.isArray(value.collapsed)) {
    value.collapsed.forEach((id) => {
      // 섹션 id 만 받는다 — 길거나 수상한 값은 버린다(쿠키·저장소를 거쳐 온 값이다).
      if (typeof id !== 'string' || !id || id.length > 32 || seen.has(id)) return;
      seen.add(id);
      collapsed.push(id);
    });
  }
  return { filter, collapsed };
}

function readCookie() {
  try {
    const pairs = String(document.cookie || '').split(';');
    for (const pair of pairs) {
      const index = pair.indexOf('=');
      if (index < 0) continue;
      if (pair.slice(0, index).trim() !== HOME_VIEW_COOKIE) continue;
      const text = decodeURIComponent(pair.slice(index + 1).trim());
      return JSON.parse(text);
    }
  } catch {
    /* 쿠키를 읽지 못하면 저장소 값만 쓴다 */
  }
  return null;
}

function readStorage() {
  try {
    const raw = localStorage.getItem(HOME_VIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(value) {
  try {
    localStorage.setItem(HOME_VIEW_KEY, JSON.stringify(value));
  } catch {
    /* 사생활 보호 모드·용량 초과 — 쿠키가 받쳐 준다 */
  }
}

function writeCookie(value) {
  try {
    // SameSite=Lax, 1년. https 가 아닌 곳(tauri://, file://)에서는 Secure 를 붙이지 않는다.
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${HOME_VIEW_COOKIE}=${encodeURIComponent(JSON.stringify(value))}`
      + `; path=/; max-age=${HOME_VIEW_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    /* 쿠키가 막혀도 저장소가 받쳐 준다 */
  }
}

let cache = null;

/** 지금 홈 보기 상태 — 처음 부를 때 저장소 → 쿠키 순서로 읽고, 비어 있는 쪽을 채운다. */
export function getHomeView() {
  if (cache) return cache;
  const stored = readStorage();
  let parsed = stored;
  if (!parsed) {
    parsed = readCookie();
    // 쿠키에만 값이 있으면(저장소가 막혔던 경우) 저장소에도 다시 채워 둔다.
    if (parsed) writeStorage(normalize(parsed));
  } else {
    // 저장소에만 값이 있으면(쿠키가 막혔던 경우) 쿠키에도 다시 채워 둔다.
    writeCookie(normalize(parsed));
  }
  cache = normalize(parsed);
  return cache;
}

/** 바뀐 값을 저장소와 쿠키에 함께 남긴다. */
export function saveHomeView(patch) {
  const next = normalize({ ...getHomeView(), ...(patch || {}) });
  cache = next;
  writeStorage(next);
  writeCookie(next);
  return next;
}

export function setHomeFilter(id) {
  return saveHomeView({ filter: id });
}

export function setHomeCollapsed(ids) {
  return saveHomeView({ collapsed: Array.isArray(ids) ? ids : [] });
}

/** 저장된 값을 지우고 기본값으로 — 설정의 '홈 보기 초기화'가 없을 때를 위한 자리. */
export function resetHomeView() {
  cache = normalize(null);
  try {
    localStorage.removeItem(HOME_VIEW_KEY);
  } catch {
    /* 저장소를 못 쓰면 쿠키만 지운다 */
  }
  writeCookie(cache);
  return cache;
}
