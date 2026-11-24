/**
 * TIP · 한국 주소 → 영문 주소 (v1.14.0)
 *
 * 해외직구 때 필요한 영문 주소를 만들기 위해, 국내 주소를 **국어의 로마자 표기법**에 가깝게
 * 로컬에서 바꾼다. 외부 API·네트워크를 쓰지 않는다(CSP 추가 없음, 주소가 밖으로 나가지 않음).
 *
 * 규칙
 *  · 한글 음절을 초성·중성·종성으로 풀어 로마자로 적는다(예: 종로 → jongno).
 *  · 주소 꼬리말은 도로명 표기로 바꾼다 — 대로 -daero, 로 -ro, 길 -gil, 번길 -beon-gil,
 *    구 -gu, 시 -si, 군 -gun, 도 -do, 동 -dong, 읍 -eup, 면 -myeon, 리 -ri, 층 -floor, 호 -ho.
 *  · 자주 쓰는 지명은 실제 표기를 쓴다(서울 Seoul, 부산 Busan, 경기 Gyeonggi …).
 *  · '지하'는 B, '번지'는 빼고, 5자리 우편번호는 따로 뽑는다.
 *
 * 완벽한 공식 표기는 아니다 — 도로명 주소는 도로명 고유 표기가 따로 있으므로, 해외 배송지에는
 * 도로명 주소 검색 결과의 공식 영문 주소(roadAddressEnglish)를 먼저 쓰고 이 변환은 참고용으로 쓴다.
 */

const INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

/** 꼬리말 — 긴 것부터 본다. */
const SUFFIXES = [
  ['대로', 'daero'], ['번길', 'beon-gil'], ['번지', ''], ['로', 'ro'], ['길', 'gil'],
  ['구', 'gu'], ['시', 'si'], ['군', 'gun'], ['도', 'do'], ['동', 'dong'], ['읍', 'eup'],
  ['면', 'myeon'], ['리', 'ri'], ['층', 'floor'], ['호', 'ho'], ['관', 'gwan'],
];

/** 자주 나오는 지명 — 규칙 로마자보다 실제 표기가 낫다. */
const PLACES = {
  서울: 'Seoul', 서울특별시: 'Seoul', 부산: 'Busan', 부산광역시: 'Busan', 대구: 'Daegu', 대구광역시: 'Daegu',
  인천: 'Incheon', 인천광역시: 'Incheon', 광주: 'Gwangju', 광주광역시: 'Gwangju', 대전: 'Daejeon',
  대전광역시: 'Daejeon', 울산: 'Ulsan', 울산광역시: 'Ulsan', 세종: 'Sejong', 세종특별자치시: 'Sejong',
  경기: 'Gyeonggi', 경기도: 'Gyeonggi-do', 강원: 'Gangwon', 강원도: 'Gangwon-do', 강원특별자치도: 'Gangwon-do',
  충북: 'Chungbuk', 충청북도: 'Chungcheongbuk-do', 충남: 'Chungnam', 충청남도: 'Chungcheongnam-do',
  전북: 'Jeonbuk', 전라북도: 'Jeollabuk-do', 전남: 'Jeonnam', 전라남도: 'Jeollanam-do',
  경북: 'Gyeongbuk', 경상북도: 'Gyeongsangbuk-do', 경남: 'Gyeongnam', 경상남도: 'Gyeongsangnam-do',
  제주: 'Jeju', 제주도: 'Jeju-do', 제주특별자치도: 'Jeju-do',
  용인: 'Yongin', 용인시: 'Yongin-si', 기흥: 'Giheung', 기흥구: 'Giheung-gu', 수원: 'Suwon', 수원시: 'Suwon-si',
  성남: 'Seongnam', 성남시: 'Seongnam-si', 분당: 'Bundang', 분당구: 'Bundang-gu', 서울시: 'Seoul',
  중구: 'Jung-gu', 종로: 'Jongno', 종로구: 'Jongno-gu', 강남: 'Gangnam', 강남구: 'Gangnam-gu',
  서초: 'Seocho', 송파: 'Songpa', 마포: 'Mapo', 영등포: 'Yeongdeungpo', 노원: 'Nowon',
  화성: 'Hwaseong', 화성시: 'Hwaseong-si', 오산: 'Osan', 평택: 'Pyeongtaek', 안양: 'Anyang',
  안산: 'Ansan', 부천: 'Bucheon', 고양: 'Goyang', 파주: 'Paju', 김포: 'Gimpo', 남양주: 'Namyangju',
  하남: 'Hanam', 광명: 'Gwangmyeong', 군포: 'Gunpo', 의왕: 'Uiwang', 과천: 'Gwacheon',
};

function romanizeSyllable(code) {
  const index = code - 0xac00;
  const initial = Math.floor(index / 588);
  const medial = Math.floor((index % 588) / 28);
  const final = index % 28;
  return `${INITIAL[initial]}${MEDIAL[medial]}${FINAL[final]}`;
}

function capitalize(text) {
  if (!text) return text;
  return String(text)
    .split('-')
    .map((part, index) => {
      if (!part) return part;
      // 뒤에 붙는 도로명 꼬리말(-ro, -daero, -gu, -si …)은 소문자 그대로 — 'Sejong-daero'.
      if (index > 0 && /^(ro|daero|gil|beon-gil|gu|si|gun|do|dong|eup|myeon|ri|floor|ho|gwan)$/.test(part)) return part;
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('-');
}

/** 한 낱말(지명·도로명)을 로마자로 — 꼬리말은 도로명 규칙으로 붙인다. */
function romanizeWord(word) {
  const raw = String(word || '').trim();
  if (!raw) return '';
  // 아라비아 숫자·영문은 그대로 둔다.
  if (!/[가-힣]/.test(raw)) return raw;

  // 동·호·층은 해외 배송지 표기로 — 301호 → #301, 3층 → 3F, 101동 → Bldg 101.
  const numeric = raw.match(/^(\d+)\s*(호|층|동)$/);
  if (numeric) {
    if (numeric[2] === '호') return `#${numeric[1]}`;
    if (numeric[2] === '층') return `${numeric[1]}F`;
    return `Bldg ${numeric[1]}`;
  }

  if (PLACES[raw]) return PLACES[raw];

  for (const [suffix, roman] of SUFFIXES) {
    if (!raw.endsWith(suffix) || raw.length <= suffix.length) continue;
    const stem = raw.slice(0, -suffix.length);
    const head = romanizeHangul(stem);
    if (!roman) return capitalize(head);
    return `${capitalize(head)}-${roman}`;
  }
  return capitalize(romanizeHangul(raw));
}

function romanizeHangul(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += romanizeSyllable(code);
    else if (/[0-9a-zA-Z]/.test(ch)) out += ch;
    else if (ch === ' ' || ch === '-' || ch === '.') out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** '3층 301호' → '3F, #301' 같은 해외 배송지 표기. */
function romanizeDetail(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw
    .replace(/지하/g, 'B')
    .replace(/(\d+)\s*층/g, '$1F')
    .replace(/(\d+)\s*호/g, '#$1')
    .replace(/(\d+)\s*동/g, 'Bldg $1')
    .split(/\s+/)
    .map((part) => romanizeWord(part))
    .filter(Boolean)
    .join(' ');
}

/**
 * 한국어 주소 하나를 영문 주소로 바꾼다.
 * 돌려주는 값
 *   korean  — 입력 그대로(정리)
 *   full    — 한 줄 영문 주소(도로명 → 구 → 시·도 순서로 뒤집지 않고, 입력 순서를 살린다)
 *   line    — 해외직구 Address Line (도로명 + 상세)
 *   city    — 시·군·구
 *   state   — 도·광역시
 *   zip     — 5자리 우편번호(없으면 빈 문자열)
 */
export function romanizeAddress(input) {
  const korean = String(input || '').replace(/\s+/g, ' ').trim();
  if (!korean) return { korean: '', full: '', line: '', city: '', state: '', zip: '' };

  const zipMatch = korean.match(/(\d{5})(?!\d)/);
  const zip = zipMatch ? zipMatch[1] : '';

  let body = korean;
  if (zip) body = body.replace(zip, ' ');
  body = body.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();

  const words = body.split(' ').filter(Boolean);
  const romanized = words.map((word) => (/^\d+(-\d+)?$/.test(word) ? word : romanizeWord(word)));

  // 시·도/시·군·구를 뒤에서 찾아 항목별로 나눈다.
  let state = '';
  let city = '';
  const rest = [];
  words.forEach((word, index) => {
    const roman = romanized[index];
    if (!state && /(특별시|광역시|특별자치시|도)$/.test(word)) {
      state = roman;
      return;
    }
    if (!city && /(시|군|구)$/.test(word)) {
      // '시'로 끝나는데 아직 시·도가 없으면 그게 시·도다(예: '용인시').
      if (/시$/.test(word) && !state) {
        state = roman;
        return;
      }
      city = roman;
      return;
    }
    rest.push({ word, roman });
  });

  if (!state && rest.length > 1) state = rest[rest.length - 1].roman;
  if (!city && rest.length > 1) city = rest[rest.length - 2].roman;

  // 도로명·번지가 먼저, 구·동이 뒤로 — 해외 배송지는 '도로명 번지, 구, 시' 순서를 읽는다.
  const roadish = (roman) => /-(ro|daero|gil|beon-gil)$/i.test(roman) || /^[\d-]+$/.test(roman) || /^#?\d/.test(roman);
  const ordered = [...rest.filter(({ roman }) => roadish(roman)), ...rest.filter(({ roman }) => !roadish(roman))];
  const street = ordered.map(({ roman }) => roman).filter(Boolean);
  const line = street.join(', ');

  const full = [...street, city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');

  return { korean, full: full.trim(), line, city, state, zip };
}

/** 상세 주소(동·호수)를 따로 넣을 때 — '3층 301호' → '3F, #301'. */
export function romanizeAddressDetail(input) {
  return romanizeDetail(input);
}
