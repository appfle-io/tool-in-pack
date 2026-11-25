/* TIP · 두벌식 한영 타자 변환 (v1.16.0)
 *
 * 한글을 두벌식 자판의 영문 글쇠로 바꾸고(안녕 → dkssud), 영문 글쇠를 한글로 되돌린다(dkssud → 안녕).
 * 겹받침(ㄳ·ㄶ·ㅄ …)과 이중모음(ㅘ·ㅙ·ㅢ …)을 양방향으로 다룬다.
 * 한 글자도 밖으로 나가지 않는다.
 */

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

/** 자모 → 글쇠. 겹받침·이중모음은 두 글쇠. */
const JAMO_KEY = {
  ㄱ: 'r', ㄲ: 'R', ㄴ: 's', ㄷ: 'e', ㄸ: 'E', ㄹ: 'f', ㅁ: 'a', ㅂ: 'q', ㅃ: 'Q',
  ㅅ: 't', ㅆ: 'T', ㅇ: 'd', ㅈ: 'w', ㅉ: 'W', ㅊ: 'c', ㅋ: 'z', ㅌ: 'x', ㅍ: 'v', ㅎ: 'g',
  ㅏ: 'k', ㅐ: 'o', ㅑ: 'i', ㅒ: 'O', ㅓ: 'j', ㅔ: 'p', ㅕ: 'u', ㅖ: 'P', ㅗ: 'h',
  ㅘ: 'hk', ㅙ: 'ho', ㅚ: 'hl', ㅛ: 'y', ㅜ: 'n', ㅝ: 'nj', ㅞ: 'np', ㅟ: 'nl',
  ㅠ: 'b', ㅡ: 'm', ㅢ: 'ml', ㅣ: 'l',
  ㄳ: 'rt', ㄵ: 'sw', ㄶ: 'sg', ㄺ: 'fr', ㄻ: 'fa', ㄼ: 'fq', ㄽ: 'ft',
  ㄾ: 'fx', ㄿ: 'fv', ㅀ: 'fg', ㅄ: 'qt',
};

/** 글쇠 → 자모. */
const KEY_JAMO = {};
Object.entries(JAMO_KEY).forEach(([jamo, keys]) => {
  if (keys.length === 1) KEY_JAMO[keys] = jamo;
});

/** 여러 글쇠짜리 자모 — 긴 것부터 찾는다. */
const MULTI_KEYS = Object.entries(JAMO_KEY)
  .filter(([, keys]) => keys.length > 1)
  .map(([jamo, keys]) => ({ jamo, keys }))
  .sort((a, b) => b.keys.length - a.keys.length);

/** 모음 두 개가 만나 이중모음이 되는 짝. */
const JUNG_COMBINE = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ',
  'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ',
  'ㅡㅣ': 'ㅢ',
};

/** 받침 두 개가 만나 겹받침이 되는 짝. */
const JONG_COMBINE = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ',
  'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ',
  'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ',
  'ㅂㅅ': 'ㅄ',
};

/** 겹받침을 둘로 나눌 때 — 앞은 남는 받침, 뒤는 다음 글자 초성. */
const JONG_SPLIT = {
  ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'], ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅀ: ['ㄹ', 'ㅎ'], ㅄ: ['ㅂ', 'ㅅ'],
};

const JONG_SET = new Set(JONG.filter(Boolean));

function isSyllable(code) {
  return code >= 0xAC00 && code <= 0xD7A3;
}

function isConsonantJamo(char) {
  return Object.prototype.hasOwnProperty.call(JAMO_KEY, char) && !JUNG.includes(char);
}

function isVowelJamo(char) {
  return JUNG.includes(char);
}

function syllableOf(cho, jung, jong) {
  return String.fromCharCode(0xAC00 + (cho * 21 + jung) * 28 + jong);
}

/** 한글 → 두벌식 영문 글쇠. */
export function koToEn(text) {
  let out = '';
  for (const char of String(text || '')) {
    const code = char.codePointAt(0);
    if (isSyllable(code)) {
      const index = code - 0xAC00;
      const cho = Math.floor(index / 588);
      const jung = Math.floor((index % 588) / 28);
      const jong = index % 28;
      out += JAMO_KEY[CHO[cho]] || '';
      out += JAMO_KEY[JUNG[jung]] || '';
      if (jong) out += JAMO_KEY[JONG[jong]] || '';
    } else if (JAMO_KEY[char]) {
      out += JAMO_KEY[char];
    } else {
      out += char;
    }
  }
  return out;
}

/** 영문 글쇠를 자모 목록으로 나눈다 — 두 글쇠짜리(겹받침·이중모음)를 먼저 본다. */
function keysToJamo(text) {
  const value = String(text || '');
  const tokens = [];
  let index = 0;
  while (index < value.length) {
    let matched = null;
    for (const entry of MULTI_KEYS) {
      if (value.startsWith(entry.keys, index)) {
        matched = entry;
        break;
      }
    }
    if (matched) {
      tokens.push(matched.jamo);
      index += matched.keys.length;
      continue;
    }
    const char = value[index];
    tokens.push(KEY_JAMO[char] || char);
    index += 1;
  }
  return tokens;
}

/** 영문 글쇠 → 한글. 자모를 모아 음절로 조립한다. */
export function enToKo(text) {
  const tokens = keysToJamo(text);
  let out = '';
  let cho = -1;
  let jung = -1;
  let jong = 0;

  const flush = () => {
    if (cho >= 0) {
      if (jung >= 0) out += syllableOf(cho, jung, jong);
      else out += CHO[cho];
    } else if (jung >= 0) {
      out += JUNG[jung];
    }
    cho = -1;
    jung = -1;
    jong = 0;
  };

  for (const token of tokens) {
    const isVowel = isVowelJamo(token);
    const isConsonant = isConsonantJamo(token);

    if (isConsonant) {
      const choIndex = CHO.indexOf(token);
      if (cho < 0 && jung < 0) {
        cho = Math.max(0, choIndex);
        continue;
      }
      if (cho >= 0 && jung < 0) {
        // 자음 두 개가 이어짐 — 앞의 것은 낱자로 내보낸다.
        flush();
        cho = Math.max(0, choIndex);
        continue;
      }
      if (cho >= 0 && jung >= 0 && jong === 0) {
        if (JONG_SET.has(token)) {
          jong = JONG.indexOf(token);
        } else {
          flush();
          cho = Math.max(0, choIndex);
        }
        continue;
      }
      if (cho >= 0 && jung >= 0 && jong > 0) {
        const pair = JONG[jong] + token;
        if (JONG_COMBINE[pair]) {
          jong = JONG.indexOf(JONG_COMBINE[pair]);
        } else {
          flush();
          cho = Math.max(0, choIndex);
        }
        continue;
      }
      // 모음만 있던 상태에서 자음이 옴
      flush();
      cho = Math.max(0, choIndex);
      continue;
    }

    if (isVowel) {
      const jungIndex = JUNG.indexOf(token);
      if (cho < 0 && jung < 0) {
        jung = jungIndex;
        continue;
      }
      if (cho >= 0 && jung < 0) {
        jung = jungIndex;
        continue;
      }
      if (cho >= 0 && jung >= 0 && jong === 0) {
        const pair = JUNG[jung] + token;
        if (JUNG_COMBINE[pair]) {
          jung = JUNG.indexOf(JUNG_COMBINE[pair]);
        } else {
          flush();
          jung = jungIndex;
        }
        continue;
      }
      if (cho >= 0 && jung >= 0 && jong > 0) {
        // 받침을 다음 글자의 첫소리로 넘긴다.
        const current = JONG[jong];
        const split = JONG_SPLIT[current];
        let carry = current;
        if (split) {
          jong = JONG.indexOf(split[0]);
          carry = split[1];
        } else {
          jong = 0;
        }
        flush();
        cho = Math.max(0, CHO.indexOf(carry));
        jung = jungIndex;
        continue;
      }
      // 모음만 있는 상태 + 모음
      if (jung >= 0) {
        const pair = JUNG[jung] + token;
        if (JUNG_COMBINE[pair]) {
          jung = JUNG.indexOf(JUNG_COMBINE[pair]);
          continue;
        }
      }
      flush();
      jung = jungIndex;
      continue;
    }

    // 한글도 영문도 아닌 글자(공백·문장부호·숫자) — 지금까지를 내보내고 그대로 둔다.
    flush();
    out += token;
  }

  flush();
  return out;
}

/** 글에 한글이 있으면 영문 글쇠로, 없으면 한글로 바꾼다 — 붙여 넣은 글이 어느 쪽인지 모를 때. */
export function autoConvert(text) {
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(String(text || '')) ? koToEn(text) : enToKo(text);
}

/** 이 글이 영문 글쇠처럼 보이는지(한글이 하나도 없고 영문·숫자·기호만). */
export function looksLikeKeys(text) {
  const value = String(text || '').trim();
  return !!value && !/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(value) && /^[\x20-\x7E\r\n\t]+$/.test(value);
}
