/* TIP · 한글 초성 검색 (v1.14.0)
 *
 * 맥 Spotlight 처럼 'ㅋㄹ' 로 크롬을, 'ㅁㅁ' 로 메모를 찾는다.
 * 앱 이름·TIP 모듈 이름 양쪽에 같은 규칙을 쓴다.
 *   · 완성형 한글(가~힣)은 초성 19자 중 하나로 바꾼다.
 *   · 영문·숫자는 소문자 그대로 둔다(초성 질의에는 섞이지 않는다).
 *   · 띄어쓰기는 지우고 비교한다 — '클립 보드' 도 'ㅋㄹㅂㄷ' 로 찾힌다.
 */

const CHOSUNG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const CHOSUNG_SET = new Set(CHOSUNG);

/** 글자들을 초성 문자열로 — 한글은 초성, 나머지는 소문자. */
export function initials(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHOSUNG[Math.floor((code - 0xac00) / 588)];
    } else if (ch === ' ' || ch === '\t') {
      continue;
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/** 질의가 전부 자음(ㅋㄹ 같은)인지 — 그럴 때만 초성 비교를 한다. */
export function isChosungQuery(query) {
  const text = String(query || '').replace(/\s+/g, '');
  if (!text) return false;
  for (const ch of text) {
    if (!CHOSUNG_SET.has(ch)) return false;
  }
  return true;
}

/** 초성이 순서대로 들어 있으면(사이 글자는 건너뛰어도) 참 — 'ㅋㅌ' → 카카오톡(ㅋㅋㅇㅌ). */
function subsequence(haystack, query) {
  let index = 0;
  for (const ch of haystack) {
    if (ch === query[index]) index += 1;
    if (index >= query.length) return true;
  }
  return false;
}

/**
 * 초성 질의와 이름을 비교한다.
 * 0 = 이름(또는 첫 단어)이 그 초성으로 시작, 1 = 중간에 들어 있음,
 * 2 = 초성이 순서대로 들어 있음(사이 글자 건너뜀), 99 = 아님.
 */
export function chosungRank(text, query) {
  const query_ = initials(query);
  const q = String(query || '').replace(/\s+/g, '');
  if (!q) return 99;
  const full = initials(text);
  if (!full) return 99;
  if (full.startsWith(q) || full.startsWith(query_)) return 0;
  if (full.includes(q)) return 1;
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.some((word) => {
    const head = initials(word);
    return head && head.startsWith(q);
  })) return 1;
  // 'ㅋㅌ' → 카카오톡처럼 사이 글자를 건너뛰는 경우 — 뒤 순위로 둔다.
  if (q.length >= 2 && subsequence(full, q)) return 2;
  return 99;
}

/** 편의 — 초성 질의면 초성 순위, 아니면 이름 부분 일치(0/1/99). */
export function koreanRank(text, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 0;
  const haystack = String(text || '').toLowerCase();
  if (haystack.startsWith(q)) return 0;
  if (haystack.includes(q)) return 1;
  if (isChosungQuery(q)) return chosungRank(text, q);
  return 99;
}
