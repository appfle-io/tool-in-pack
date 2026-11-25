/* TIP · 최근 사용한 모듈 (v1.16.0)
 *
 * 홈 '고정됨' 아래에 최근에 연 모듈을 최대 6개 보여 준다.
 * 이미 고정된 모듈은 '고정됨'에 있으니 빼고, 같은 모듈은 한 번만(가장 최근 자리) 남긴다.
 * 값은 이 기기의 localStorage 에만 있고 어디로도 나가지 않는다.
 */

const KEY = 'tip.recent.v1';
const ENABLED_KEY = 'tip.recent.enabled.v1';
const MAX = 20;

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id) => typeof id === 'string' && id))].slice(0, MAX);
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch { /* 저장하지 못하면 이번 실행에만 남는다 */ }
  return list;
}

/** 모듈을 열 때마다 부른다 — 맨 앞으로 올린다. */
export function recordRecent(id) {
  const value = String(id || '').trim();
  if (!value) return read();
  return write([value, ...read().filter((item) => item !== value)]);
}

/** 최근 사용 목록 — limit 개까지. */
export function recentIds(limit = 6) {
  return read().slice(0, Math.max(0, limit));
}

export function getRecentEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRecentEnabled(on) {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch { /* 저장하지 못하면 이번에만 적용된다 */ }
}

export function clearRecent() {
  write([]);
}

/** 검색창(전역 검색)도 최근 사용을 조금 더 쓴다 — 위로 올리고 싶을 때. */
export function recentRank(id) {
  const index = read().indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
