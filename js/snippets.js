/* TIP · 스니펫(자주 쓰는 문구) 저장 (v1.14.0)
 *
 * 이메일 서명·계좌·주소·코드 조각처럼 매번 같은 문장을 붙여넣는 일을 줄인다.
 * 값은 이 기기의 localStorage(tip.snippets.v1)에만 있고 어디로도 나가지 않는다.
 * 전역 검색에서 별칭(/mail)이나 낱말로 찾아 Enter 한 번에 복사한다.
 */

const KEY = 'tip.snippets.v1';
const MAX = 200;

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === 'object' && typeof item.body === 'string')
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list) {
  cache = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* 저장 공간이 없으면 이번 실행에만 남는다 */ }
  return cache;
}

function newId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 별칭은 항상 '/' 로 시작한다 — 검색창에서 명령과 구분된다. */
export function normalizeAlias(alias) {
  const text = String(alias || '').trim();
  if (!text) return '';
  return text.startsWith('/') ? text : `/${text.replace(/^\//, '')}`;
}

export function listSnippets() {
  return read().slice().sort((a, b) => String(a.label || a.alias || '').localeCompare(String(b.label || b.alias || ''), 'ko'));
}

export function getSnippet(id) {
  return read().find((item) => item.id === id) || null;
}

export function saveSnippet(input) {
  const list = read().slice();
  const alias = normalizeAlias(input.alias);
  const body = String(input.body || '');
  if (!body.trim()) return { ok: false, message: '내용이 비어 있습니다' };
  if (alias && list.some((item) => normalizeAlias(item.alias) === alias && item.id !== input.id)) {
    return { ok: false, message: `${alias} 는 이미 쓰고 있습니다` };
  }
  const now = Date.now();
  if (input.id) {
    const index = list.findIndex((item) => item.id === input.id);
    if (index < 0) return { ok: false, message: '스니펫을 찾지 못했습니다' };
    list[index] = { ...list[index], label: String(input.label || '').trim(), alias, body, updated: now };
  } else {
    list.unshift({ id: newId(), label: String(input.label || '').trim(), alias, body, created: now, updated: now });
  }
  write(list);
  return { ok: true };
}

export function deleteSnippet(id) {
  write(read().filter((item) => item.id !== id));
}

/** 검색어에 맞는 스니펫 — 별칭 정확 일치가 가장 앞, 그다음 별칭·이름·내용 부분 일치. */
export function findSnippets(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return listSnippets()
    .map((item) => {
      const alias = normalizeAlias(item.alias).toLowerCase();
      const label = String(item.label || '').toLowerCase();
      const body = String(item.body || '').toLowerCase();
      let rank = 99;
      if (alias && alias === q) rank = 0;
      else if (alias && alias.startsWith(q)) rank = 1;
      else if (label && label.includes(q)) rank = 2;
      else if (body.includes(q)) rank = 3;
      return { item, rank };
    })
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4)
    .map(({ item }) => item);
}

/** 복사할 때 보여 줄 짧은 한 줄 — 첫 줄만, 40자까지. */
export function snippetPreview(snippet) {
  const first = String(snippet.body || '').split('\n')[0].trim();
  return first.length > 40 ? `${first.slice(0, 40)}…` : first;
}
