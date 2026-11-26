/* TIP · 게임 공통 (v1.21.0)
 *
 * 제비뽑기 · 사다리타기 · 선착순 골인이 함께 쓰는 것만 모았다.
 *   · 사람 수(2~30)와 꽝 개수(0~사람 수-1)를 정하는 설정 화면
 *   · 참가자 이름 입력(비우면 '1번'부터 자동으로 채운다) — 30명도 스크롤 안에서
 *   · 순서 섞기(수동 셔플) — 준비 화면에 들어올 때 한 번, 단추를 누를 때마다 다시
 *     (시작을 누르면 더 섞지 않는다. 사용자가 보고 정한 그 자리에서 출발한다)
 *   · 설정 기억(tip.games.<게임>.v1) — 새로 설정하기로 돌아오면 지난 값 그대로
 *   · 다시하기 / 새로 설정하기 버튼과 결과 요약(당첨과 꽝을 나눠서)
 *   · 공정한 난수(crypto)와 섞기
 *   · 캐릭터 아바타 12종(캔버스 직접 드로잉) — 대기·질주·충돌·당첨·꽝 표정
 *     + 30명까지 서로 구분되는 자리 색 30종(링·배지·이름표 테두리)
 *   · 효과음(Web Audio)과 음소거 토글(tip.games.sound.v1)
 *   · 컨페티·스파클
 *
 * 화면 문구는 다른 모듈과 같은 톤으로 짧게 쓰고, 계산은 모두 이 기기 안에서 한다.
 */

export const PEOPLE_MIN = 2;
export const PEOPLE_MAX = 30;
export const NAME_MAX = 12;

/** 판정 방식 — 지금은 선착순 골인이 쓴다(사람 수·꽝 개수와 자연스럽게 맞춘다). */
export const VERDICT_MODES = [
  { id: 'first', label: '선착순', sub: '뒤 N명 꽝' },
  { id: 'last', label: '꼴찌 당첨', sub: '마지막 N명' },
  { id: 'solo', label: '1등만', sub: '나머지 꽝' },
];
const MODE_IDS = VERDICT_MODES.map((mode) => mode.id);

const STORE_PREFIX = 'tip.games.';
export const SOUND_KEY = 'tip.games.sound.v1';

/* ------------------------------ 난수 ------------------------------ */

/** 0 이상 max 미만의 정수 — crypto 를 먼저 쓴다. */
export function randomInt(max) {
  const limit = Math.max(1, Math.floor(max));
  try {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % limit;
  } catch {
    return Math.floor(Math.random() * limit);
  }
}

/** 0 이상 1 미만 — 모듈의 움직임 계산에 쓴다. */
export function randomUnit() {
  return randomInt(1e6) / 1e6;
}

/** 새 배열로 섞기(Fisher–Yates). */
export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

/** count 개 중 losers 개를 골라 꽝 자리로 — Set<number>. 꽝은 아무도 못 받게 사람 수-1 까지만. */
export function loserSlots(count, losers) {
  const total = Math.max(1, Math.floor(count));
  const pick = Math.max(0, Math.min(Math.floor(losers), total - 1));
  const slots = Array.from({ length: total }, (_, index) => index);
  return new Set(shuffle(slots).slice(0, pick));
}

/* ------------------------------ 설정 ------------------------------ */

export function defaultName(index) {
  return `${index + 1}번`;
}

function clampInt(value, min, max, fallback) {
  if (value == null || value === '') return fallback;
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

/** 들어온 값을 쓸 수 있는 설정으로 다듬는다. 이름이 비면 '1번'처럼 채운다. */
export function normalizeSetup(raw) {
  const people = clampInt(raw && raw.people, PEOPLE_MIN, PEOPLE_MAX, 4);
  const mode = raw && MODE_IDS.includes(raw.mode) ? raw.mode : 'first';
  let losers = clampInt(raw && raw.losers, 0, people - 1, Math.min(1, people - 1));
  // 1등만 당첨이면 나머지는 모두 꽝, 꼴찌 당첨이면 최소 한 명은 당첨이다.
  if (mode === 'solo') losers = people - 1;
  else if (mode === 'last') losers = clampInt(Math.max(1, losers), 1, people - 1, 1);
  const names = [];
  for (let index = 0; index < PEOPLE_MAX; index += 1) {
    const given = raw && Array.isArray(raw.names) ? raw.names[index] : '';
    const text = String(given == null ? '' : given).trim().slice(0, NAME_MAX);
    names.push(text || defaultName(index));
  }
  const map = raw && typeof raw.map === 'string' ? raw.map : '';
  return { people, losers, names, map, mode };
}

export function readSetup(gameId) {
  try {
    const text = localStorage.getItem(`${STORE_PREFIX}${gameId}.v1`);
    return text ? normalizeSetup(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function saveSetup(gameId, setup) {
  try {
    localStorage.setItem(`${STORE_PREFIX}${gameId}.v1`, JSON.stringify(normalizeSetup(setup)));
  } catch {
    /* 저장하지 못해도 이번 판은 그대로 둔다 */
  }
}

/* ------------------------------ 글자 ------------------------------ */

export function escapeText(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 이름을 칸 폭에 맞춰 줄인다(가운데 글자 잘라 …). */
export function shortName(name, max = 4) {
  const text = String(name == null ? '' : name);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/* ======================================================================
   캐릭터 아바타 12종
   ----------------------------------------------------------------------
   그림은 모두 캔버스 도형으로 그린다(외부 이미지 없음).
   같은 사람은 어느 게임에서나 같은 캐릭터를 받는다 — 이름 순서(index).
   ====================================================================== */

export const CHARACTERS = [
  { id: 'rabbit', label: '토끼', fur: '#F7F1F3', ink: '#A9707F', inner: '#F4BCCB', color: '#E0559B' },
  { id: 'cat', label: '고양이', fur: '#F2A44E', ink: '#A96B22', inner: '#F8C88C', color: '#EF7B1E' },
  { id: 'dog', label: '강아지', fur: '#C99565', ink: '#8A5F36', inner: '#E6BC93', color: '#9A6C3F' },
  { id: 'bear', label: '곰', fur: '#AE8467', ink: '#7A5539', inner: '#D8B79C', color: '#7C5CD6' },
  { id: 'fox', label: '여우', fur: '#E8863F', ink: '#A95618', inner: '#FBE7D6', color: '#D9562B' },
  { id: 'panda', label: '판다', fur: '#F6F7F9', ink: '#39404B', inner: '#E4E7EC', color: '#4B5563' },
  { id: 'duck', label: '오리', fur: '#F7D45C', ink: '#B08810', inner: '#FBE9A8', color: '#D4A000' },
  { id: 'frog', label: '개구리', fur: '#86C96F', ink: '#4A8738', inner: '#C9E8BC', color: '#3FA34D' },
  { id: 'chick', label: '병아리', fur: '#FFE59A', ink: '#B98B12', inner: '#FFF3CC', color: '#12A5A5' },
  { id: 'penguin', label: '펭귄', fur: '#3C4655', ink: '#212A36', inner: '#F1F4F8', color: '#2F6FE0' },
  { id: 'koala', label: '코알라', fur: '#BCC2CC', ink: '#6F7783', inner: '#E2E6EC', color: '#8A93A5' },
  { id: 'squirrel', label: '다람쥐', fur: '#D08A5C', ink: '#8C5A33', inner: '#F0CFB4', color: '#C2603F' },
];

export const CHARACTER_COUNT = CHARACTERS.length;

export function characterAt(index) {
  const value = Number(index);
  const slot = Number.isFinite(value) ? ((Math.floor(value) % CHARACTER_COUNT) + CHARACTER_COUNT) % CHARACTER_COUNT : 0;
  return CHARACTERS[slot];
}

/**
 * 자리 색 30종 — 30명이어도 링·배지·이름표 테두리 색이 겹치지 않게.
 * 캐릭터가 12종이라 얼굴은 돌아가지만, 이 색으로 사람을 구분한다.
 */
export const SLOT_COLORS = [
  '#E0559B', '#EF7B1E', '#9A6C3F', '#7C5CD6', '#D9562B', '#4B5563',
  '#D4A000', '#3FA34D', '#12A5A5', '#2F6FE0', '#8A93A5', '#C2603F',
  '#B5006B', '#8C6D1F', '#0E7C66', '#5A4FCF', '#C2185B', '#2E7D32',
  '#0277BD', '#6D4C41', '#7B1FA2', '#7FA41B', '#D84315', '#37548A',
  '#E96AA8', '#3FA79C', '#B7810C', '#7E57C2', '#7CB342', '#00838F',
];

/** 아바타 색 — 선·궤적·이름표 테두리. 자리마다 다른 30색. */
export function characterColor(index) {
  const value = Number(index);
  const size = SLOT_COLORS.length;
  const slot = Number.isFinite(value) ? ((Math.floor(value) % size) + size) % size : 0;
  return SLOT_COLORS[slot];
}

const EXPRESSIONS = ['idle', 'run', 'hit', 'win', 'lose'];

/** 표정 이름을 하나로 맞춘다. */
export function expression(mood) {
  return EXPRESSIONS.includes(mood) ? mood : 'idle';
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function ellipse(ctx, x, y, rx, ry, rotation = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
}

/* 뒤쪽(머리보다 먼저 그리는) 귀·꼬리 */
function drawBack(ctx, ch) {
  if (ch.id === 'rabbit') {
    ctx.fillStyle = ch.fur;
    ctx.strokeStyle = ch.ink;
    ctx.lineWidth = 1.1;
    ellipse(ctx, -3.8, -11.2, 2.5, 6.6, -0.14);
    ctx.fill(); ctx.stroke();
    ellipse(ctx, 3.8, -11.2, 2.5, 6.6, 0.14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ch.inner;
    ellipse(ctx, -3.8, -11, 1.2, 4.4, -0.14);
    ctx.fill();
    ellipse(ctx, 3.8, -11, 1.2, 4.4, 0.14);
    ctx.fill();
    return;
  }
  if (ch.id === 'squirrel') {
    ctx.fillStyle = ch.fur;
    ctx.strokeStyle = ch.ink;
    ctx.lineWidth = 1.1;
    ellipse(ctx, -9.2, 3.2, 4.6, 6.6, 0.5);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = ch.inner;
    ellipse(ctx, -9.6, 3.6, 2.2, 4, 0.5);
    ctx.fill();
  }
}

/* 머리 — 바탕 원 */
function drawHead(ctx, ch) {
  const gradient = ctx.createLinearGradient(0, -9, 0, 9);
  gradient.addColorStop(0, ch.fur);
  gradient.addColorStop(1, ch.fur);
  ctx.fillStyle = ch.id === 'panda' || ch.id === 'penguin' ? ch.fur : gradient;
  ctx.strokeStyle = ch.ink;
  ctx.lineWidth = 1.1;
  ellipse(ctx, 0, 0, 9.2, 8.8);
  ctx.fill();
  ctx.stroke();
}

/* 앞쪽 귀·코·볼 — 머리 위에 얹는 것들 */
function drawFront(ctx, ch) {
  ctx.strokeStyle = ch.ink;
  ctx.lineWidth = 1.1;
  if (ch.id === 'cat') {
    ctx.fillStyle = ch.fur;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 8.4, -4.4);
      ctx.lineTo(dir * 6.4, -12.4);
      ctx.lineTo(dir * 2.2, -7.6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = ch.inner;
      ctx.beginPath();
      ctx.moveTo(dir * 7.3, -5.6);
      ctx.lineTo(dir * 6.3, -10.6);
      ctx.lineTo(dir * 4.1, -7.7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ch.fur;
    }
  } else if (ch.id === 'dog') {
    ctx.fillStyle = ch.inner;
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 8.9, -1.2, 2.6, 5.4, dir * 0.34);
      ctx.fill(); ctx.stroke();
    }
  } else if (ch.id === 'bear') {
    ctx.fillStyle = ch.fur;
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 7, -7.4, 3.2, 3);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = ch.inner;
      ellipse(ctx, dir * 7, -7.2, 1.5, 1.4);
      ctx.fill();
      ctx.fillStyle = ch.fur;
    }
  } else if (ch.id === 'fox') {
    ctx.fillStyle = ch.fur;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 8.8, -3.6);
      ctx.lineTo(dir * 6.2, -13.4);
      ctx.lineTo(dir * 1.8, -7.2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = ch.ink;
      ctx.beginPath();
      ctx.moveTo(dir * 7.4, -5.4);
      ctx.lineTo(dir * 6.2, -11.4);
      ctx.lineTo(dir * 3.6, -7.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ch.fur;
    }
    ctx.fillStyle = ch.inner;
    ellipse(ctx, 0, 4.4, 5.2, 3.6);
    ctx.fill();
  } else if (ch.id === 'panda') {
    ctx.fillStyle = ch.ink;
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 7.2, -7, 3.3, 3.1);
      ctx.fill();
    }
    ellipse(ctx, -3.7, -0.4, 3.1, 3.5, 0.28);
    ctx.fill();
    ellipse(ctx, 3.7, -0.4, 3.1, 3.5, -0.28);
    ctx.fill();
  } else if (ch.id === 'duck') {
    ctx.fillStyle = '#F3A32C';
    ellipse(ctx, 0, 3.9, 3.6, 2.2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-1.2, 3.4);
    ctx.lineTo(1.2, 3.4);
    ctx.strokeStyle = '#C07A16';
    ctx.stroke();
  } else if (ch.id === 'frog') {
    ctx.fillStyle = ch.fur;
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 4.8, -7.8, 3.9, 3.7);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#FFFFFF';
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 4.8, -8.2, 2.2, 2.2);
      ctx.fill();
    }
    ctx.fillStyle = ch.ink;
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 4.8, -8.2, 1.1, 1.2);
      ctx.fill();
    }
  } else if (ch.id === 'chick') {
    ctx.strokeStyle = ch.ink;
    ctx.lineWidth = 1.4;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -8.6);
      ctx.quadraticCurveTo(dir * 3, -12.4, dir * 4.6, -10.2);
      ctx.stroke();
    }
    ctx.fillStyle = '#F0A02C';
    ctx.beginPath();
    ctx.moveTo(-1.8, 3.2);
    ctx.lineTo(1.8, 3.2);
    ctx.lineTo(0, 5.2);
    ctx.closePath();
    ctx.fill();
  } else if (ch.id === 'penguin') {
    ctx.fillStyle = ch.inner;
    ellipse(ctx, 0, 1.2, 6.2, 5.6);
    ctx.fill();
    ctx.fillStyle = '#F0A02C';
    ctx.beginPath();
    ctx.moveTo(-2, 2.8);
    ctx.lineTo(2, 2.8);
    ctx.lineTo(0, 4.8);
    ctx.closePath();
    ctx.fill();
  } else if (ch.id === 'koala') {
    ctx.fillStyle = ch.fur;
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * 8.1, -5.6, 4.5, 4.3);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = ch.inner;
      ellipse(ctx, dir * 8.1, -5.6, 2.4, 2.2);
      ctx.fill();
      ctx.fillStyle = ch.fur;
    }
    ctx.fillStyle = '#4B5563';
    ellipse(ctx, 0, 2, 2.5, 3);
    ctx.fill();
  } else if (ch.id === 'squirrel') {
    ctx.fillStyle = ch.fur;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 8.2, -4.2);
      ctx.lineTo(dir * 6, -11.6);
      ctx.lineTo(dir * 2.6, -7.2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = ch.inner;
    ellipse(ctx, 0, 4.2, 4.4, 3.2);
    ctx.fill();
  }
}

/* 표정 — 모든 캐릭터 공통 */
function drawFace(ctx, ch, mood, time) {
  const ink = ch.ink;
  const eyeY = 0.2;
  const eyeX = 3.4;
  const blink = mood === 'idle' && (Math.sin(time / 520 + 1) > 0.975);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.3;

  if (mood === 'win') {
    // ^ ^
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * eyeX - 1.7, eyeY + 0.9);
      ctx.quadraticCurveTo(dir * eyeX, eyeY - 1.6, dir * eyeX + 1.7, eyeY + 0.9);
      ctx.stroke();
    }
  } else if (mood === 'lose') {
    // 처진 눈
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * eyeX - 1.7, eyeY - 0.6);
      ctx.quadraticCurveTo(dir * eyeX, eyeY + 1.5, dir * eyeX + 1.7, eyeY - 0.6);
      ctx.stroke();
    }
  } else if (mood === 'hit') {
    // > <
    for (const dir of [-1, 1]) {
      const cx = dir * eyeX;
      ctx.beginPath();
      ctx.moveTo(cx - 1.6, eyeY - 1.4);
      ctx.lineTo(cx + 1.4 * dir, eyeY);
      ctx.lineTo(cx - 1.6, eyeY + 1.4);
      ctx.stroke();
    }
  } else if (mood === 'run') {
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * eyeX, eyeY, 1.6, 1.9);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ellipse(ctx, dir * eyeX + dir * 0.5, eyeY - 0.7, 0.55, 0.65);
      ctx.fill();
      ctx.fillStyle = ink;
    }
  } else if (blink) {
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * eyeX - 1.5, eyeY);
      ctx.lineTo(dir * eyeX + 1.5, eyeY);
      ctx.stroke();
    }
  } else {
    for (const dir of [-1, 1]) {
      ellipse(ctx, dir * eyeX, eyeY, 1.45, 1.7);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ellipse(ctx, dir * eyeX + dir * 0.45, eyeY - 0.65, 0.5, 0.6);
      ctx.fill();
      ctx.fillStyle = ink;
    }
  }

  // 볼
  ctx.fillStyle = ch.id === 'panda' ? 'rgba(240,140,150,0.22)' : 'rgba(235,120,120,0.26)';
  for (const dir of [-1, 1]) {
    ellipse(ctx, dir * 6.2, 2.6, 1.9, 1.3);
    ctx.fill();
  }

  // 입
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  if (mood === 'win') {
    ctx.arc(0, 3.2, 2.4, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else if (mood === 'lose') {
    ctx.arc(0, 5.4, 2.2, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
    // 땀방울
    ctx.fillStyle = 'rgba(90,160,235,0.9)';
    ctx.beginPath();
    ctx.moveTo(7.6, -4.4);
    ctx.quadraticCurveTo(9.4, -1.6, 7.6, -0.9);
    ctx.quadraticCurveTo(5.9, -1.6, 7.6, -4.4);
    ctx.fill();
  } else if (mood === 'run') {
    ctx.fillStyle = '#7A3B44';
    ellipse(ctx, 0, 3.6, 1.7, 1.3);
    ctx.fill();
  } else if (mood === 'hit') {
    ctx.beginPath();
    ctx.moveTo(-2, 3.4);
    ctx.quadraticCurveTo(0, 5.2, 2, 3.4);
    ctx.stroke();
  } else {
    ctx.arc(0, 2.6, 1.8, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
}

function drawCrown(ctx) {
  ctx.save();
  ctx.translate(0, -10.4);
  ctx.fillStyle = '#F2BE3C';
  ctx.strokeStyle = '#B8860B';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-5.6, 1.6);
  ctx.lineTo(-5.6, -2.6);
  ctx.lineTo(-3.1, -0.9);
  ctx.lineTo(0, -4.2);
  ctx.lineTo(3.1, -0.9);
  ctx.lineTo(5.6, -2.6);
  ctx.lineTo(5.6, 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#E0559B';
  ellipse(ctx, 0, 0.2, 0.9, 0.9);
  ctx.fill();
  ctx.fillStyle = '#2F6FE0';
  ellipse(ctx, -3.4, 0.1, 0.7, 0.7);
  ctx.fill();
  ellipse(ctx, 3.4, 0.1, 0.7, 0.7);
  ctx.fill();
  ctx.restore();
}

function drawSparkles(ctx, time) {
  const count = 3;
  for (let index = 0; index < count; index += 1) {
    const angle = time / 900 + (index * Math.PI * 2) / count;
    const radius = 12.5 + Math.sin(time / 240 + index) * 1.6;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.8 - 1;
    const size = 1.5 + Math.sin(time / 180 + index * 2) * 0.5;
    ctx.fillStyle = sprintColor(index);
    ctx.beginPath();
    ctx.moveTo(x, y - size * 2);
    ctx.quadraticCurveTo(x, y, x + size * 2, y);
    ctx.quadraticCurveTo(x, y, x, y + size * 2);
    ctx.quadraticCurveTo(x, y, x - size * 2, y);
    ctx.quadraticCurveTo(x, y, x, y - size * 2);
    ctx.fill();
  }
}

function sprintColor(index) {
  return ['#F2BE3C', '#E0559B', '#2F6FE0'][index % 3];
}

/**
 * 캐릭터 한 명을 (x, y) 가운데에 그린다.
 * size 는 머리 지름(px). mood 는 idle · run · hit · win · lose.
 */
export function drawCharacter(ctx, index, x, y, size, options = {}) {
  const ch = characterAt(index);
  const mood = expression(options.mood);
  const time = Number(options.t) || 0;
  const scale = Math.max(0.2, size / 18);
  ctx.save();
  ctx.translate(x, y);
  if (options.tilt) ctx.rotate(options.tilt);
  if (options.alpha != null) ctx.globalAlpha = Math.max(0, Math.min(1, options.alpha));
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawBack(ctx, ch);
  drawHead(ctx, ch);
  drawFront(ctx, ch);
  drawFace(ctx, ch, mood, time);
  if (mood === 'win') drawCrown(ctx);
  if (mood === 'win' && options.sparkle) drawSparkles(ctx, time);
  ctx.restore();
}

/** 동그란 배지 안에 캐릭터 얼굴을 넣는다(사다리 위·시상대). */
export function drawBadge(ctx, index, x, y, radius, options = {}) {
  const ch = characterAt(index);
  const mood = expression(options.mood);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = options.bg || '#FFFFFF';
  ctx.globalAlpha = options.alpha == null ? 1 : options.alpha;
  ctx.fill();
  drawCharacter(ctx, index, x, y + radius * 0.1, radius * 1.26, {
    mood,
    t: options.t,
    sparkle: options.sparkle,
  });
  ctx.lineWidth = Math.max(1.6, radius * 0.16);
  ctx.strokeStyle = characterColor(index);
  ctx.beginPath();
  ctx.arc(x, y, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  if (mood === 'win') {
    ctx.fillStyle = '#F2BE3C';
    ctx.strokeStyle = '#B8860B';
    ctx.lineWidth = 0.8;
    ctx.save();
    ctx.translate(x, y - radius - radius * 0.42);
    ctx.beginPath();
    ctx.moveTo(-radius * 0.55, radius * 0.2);
    ctx.lineTo(-radius * 0.55, -radius * 0.24);
    ctx.lineTo(-radius * 0.28, -radius * 0.06);
    ctx.lineTo(0, -radius * 0.4);
    ctx.lineTo(radius * 0.28, -radius * 0.06);
    ctx.lineTo(radius * 0.55, -radius * 0.24);
    ctx.lineTo(radius * 0.55, radius * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** 이름표 — 캐릭터 머리 위에 얹는 작은 알약. */
export function drawNameTag(ctx, text, x, y, options = {}) {
  const size = options.size || 10;
  const label = shortName(text, options.max || 5);
  ctx.save();
  ctx.font = `650 ${size}px Pretendard, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = Math.min(options.maxWidth || 120, ctx.measureText(label).width + size * 0.9);
  const height = size + 5;
  roundRect(ctx, x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fillStyle = options.bg || 'rgba(255,255,255,0.9)';
  ctx.fill();
  if (options.border) {
    ctx.strokeStyle = options.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = options.color || '#24262B';
  ctx.fillText(label, x, y + 0.5, width - size * 0.5);
  ctx.restore();
}

/** 결과 상자·시상대에 넣은 <canvas data-avatar data-index> 를 그린다. */
export function paintAvatars(scope, options = {}) {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  scope.querySelectorAll('canvas[data-avatar]').forEach((element) => {
    const index = Number(element.dataset.index) || 0;
    const mood = element.dataset.mood || options.mood || 'idle';
    const size = Number(element.dataset.size) || 26;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    element.width = Math.round(size * ratio);
    element.height = Math.round(size * ratio);
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    if (element.dataset.badge === '1') {
      drawBadge(context, index, size / 2, size / 2, size / 2 - 1, { mood, sparkle: mood === 'win' });
    } else {
      drawCharacter(context, index, size / 2, size / 2 + size * 0.06, size * 0.78, {
        mood,
        sparkle: mood === 'win',
      });
    }
  });
}

/** 아바타 캔버스 한 칸의 HTML. */
export function avatarCanvas(index, { size = 26, mood = 'idle', badge = false, className = '' } = {}) {
  return `<canvas class="gm-face${badge ? ' is-badge' : ''}${className ? ` ${className}` : ''}"
    data-avatar="1" data-index="${index}" data-mood="${mood}" data-size="${size}"
    ${badge ? 'data-badge="1"' : ''} width="${size}" height="${size}" aria-hidden="true"></canvas>`;
}

/* ======================================================================
   효과음 — Web Audio 로 그때그때 만든다(음원 파일 없음).
   ====================================================================== */

let audioContext = null;
let soundMuted = null;

export function isSoundOn() {
  if (soundMuted == null) {
    try {
      soundMuted = localStorage.getItem(SOUND_KEY) === '0';
    } catch {
      soundMuted = false;
    }
  }
  return !soundMuted;
}

export function setSound(on) {
  soundMuted = !on;
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* 저장하지 못해도 이번 판은 그대로 */
  }
  if (on) resumeAudio();
}

function audio() {
  if (!isSoundOn()) return null;
  try {
    if (!audioContext) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    return audioContext;
  } catch {
    return null;
  }
}

/** 첫 손짓에서 AudioContext 를 깨운다. */
export function resumeAudio() {
  const ctx = audio();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function tone({ freq = 440, to = null, dur = 0.12, type = 'sine', volume = 0.05, delay = 0, attack = 0.005 }) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise({ dur = 0.18, volume = 0.05, delay = 0, from = 900, to = 300, q = 1 }) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + delay;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, to), start + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
}

export const sfx = {
  click() {
    tone({ freq: 620, to: 880, dur: 0.07, type: 'triangle', volume: 0.032 });
  },
  flip() {
    noise({ dur: 0.12, volume: 0.03, from: 2200, to: 600, q: 0.9 });
    tone({ freq: 520, to: 1040, dur: 0.11, type: 'sine', volume: 0.028 });
  },
  bump() {
    tone({ freq: 200, to: 130, dur: 0.09, type: 'square', volume: 0.03 });
    noise({ dur: 0.07, volume: 0.018, from: 1600, to: 500 });
  },
  boost() {
    tone({ freq: 320, to: 980, dur: 0.22, type: 'sawtooth', volume: 0.028 });
    tone({ freq: 640, to: 1560, dur: 0.18, type: 'sine', volume: 0.02, delay: 0.02 });
  },
  splash() {
    noise({ dur: 0.2, volume: 0.03, from: 500, to: 180, q: 0.6 });
  },
  tick() {
    tone({ freq: 1180, dur: 0.03, type: 'square', volume: 0.014 });
  },
  beep(high = false) {
    tone({ freq: high ? 880 : 520, dur: high ? 0.22 : 0.12, type: 'triangle', volume: 0.035 });
  },
  arrive() {
    tone({ freq: 700, dur: 0.09, type: 'triangle', volume: 0.035 });
    tone({ freq: 1050, dur: 0.14, type: 'triangle', volume: 0.03, delay: 0.08 });
  },
  win() {
    [523, 659, 784, 1047].forEach((freq, index) => {
      tone({ freq, dur: 0.16, type: 'triangle', volume: 0.036, delay: index * 0.075 });
    });
  },
  fanfare() {
    [523, 659, 784, 1047, 1319].forEach((freq, index) => {
      tone({ freq, dur: 0.2, type: 'triangle', volume: 0.036, delay: index * 0.09 });
    });
    [1047, 1319].forEach((freq, index) => {
      tone({ freq, dur: 0.5, type: 'sine', volume: 0.022, delay: 0.5 + index * 0.02 });
    });
  },
  lose() {
    tone({ freq: 340, to: 220, dur: 0.2, type: 'sine', volume: 0.032 });
    tone({ freq: 210, to: 150, dur: 0.26, type: 'sine', volume: 0.026, delay: 0.16 });
  },
  whoosh() {
    noise({ dur: 0.28, volume: 0.028, from: 1800, to: 260, q: 0.5 });
  },
};

/** 음소거 단추 — 게임 상단 오른쪽. */
export function soundButton() {
  const on = isSoundOn();
  return `<button class="gm-sound" type="button" data-gm-sound aria-pressed="${on ? 'true' : 'false'}"
    aria-label="${on ? '소리 끄기' : '소리 켜기'}" title="${on ? '소리 끄기' : '소리 켜기'}">
    <svg class="gm-sound-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z"/>
      <path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.6a7.4 7.4 0 0 1 0 10.8"/></svg>
    <svg class="gm-sound-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4z"/>
      <path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>
  </button>`;
}

/** 음소거 단추를 잇는다. 게임이 끝나도 설정은 이 기기에 남는다(게임마다 한 번만). */
export function bindSound(host, signal) {
  if (host.__gmSoundBound) return;
  host.__gmSoundBound = true;
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-gm-sound]');
    if (!button) return;
    event.preventDefault();
    const next = !isSoundOn();
    setSound(next);
    if (next) sfx.click();
    host.querySelectorAll('[data-gm-sound]').forEach((node) => {
      node.setAttribute('aria-pressed', next ? 'true' : 'false');
      node.setAttribute('aria-label', next ? '소리 끄기' : '소리 켜기');
      node.setAttribute('title', next ? '소리 끄기' : '소리 켜기');
    });
  }, { signal });
}

/* ======================================================================
   컨페티 · 스파클
   ====================================================================== */

const CONFETTI_COLORS = ['#E0559B', '#EF7B1E', '#D4A000', '#3FA34D', '#12A5A5', '#2F6FE0', '#7C5CD6', '#D9562B'];

/**
 * 캔버스 위 컨페티. burst() 로 터뜨리고 step(dt) 로 굴린다.
 * 반환한 step 이 true 면 아직 그릴 것이 남았다는 뜻이다.
 */
export function createConfetti() {
  const parts = [];
  return {
    get count() {
      return parts.length;
    },
    burst(x, y, options = {}) {
      const count = options.count || 26;
      const spread = options.spread || Math.PI * 2;
      const base = options.angle == null ? -Math.PI / 2 : options.angle;
      const speed = options.speed || 220;
      for (let index = 0; index < count; index += 1) {
        const angle = base + (Math.random() - 0.5) * spread;
        const power = speed * (0.45 + Math.random() * 0.85);
        parts.push({
          x,
          y,
          vx: Math.cos(angle) * power,
          vy: Math.sin(angle) * power,
          gravity: options.gravity == null ? 520 : options.gravity,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 12,
          size: 2.6 + Math.random() * 3.2,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          shape: Math.random() < 0.35 ? 'circle' : 'rect',
          life: 1,
          fade: 0.5 + Math.random() * 0.5,
        });
      }
    },
    sparkle(x, y, options = {}) {
      const count = options.count || 10;
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count + Math.random() * 0.4;
        const power = (options.speed || 110) * (0.5 + Math.random() * 0.8);
        parts.push({
          x,
          y,
          vx: Math.cos(angle) * power,
          vy: Math.sin(angle) * power,
          gravity: 80,
          rot: 0,
          vr: 0,
          size: 1.4 + Math.random() * 1.8,
          color: options.color || '#F2BE3C',
          shape: 'circle',
          life: 1,
          fade: 1.4,
        });
      }
    },
    step(dt) {
      for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        part.vy += part.gravity * dt;
        part.vx *= 1 - 1.4 * dt;
        part.x += part.vx * dt;
        part.y += part.vy * dt;
        part.rot += part.vr * dt;
        part.life -= part.fade * dt;
        if (part.life <= 0) parts.splice(index, 1);
      }
      return parts.length > 0;
    },
    draw(ctx) {
      parts.forEach((part) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, part.life));
        ctx.fillStyle = part.color;
        if (part.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(part.x, part.y, part.size * 0.55, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.translate(part.x, part.y);
          ctx.rotate(part.rot);
          ctx.fillRect(-part.size / 2, -part.size / 3, part.size, part.size * 0.66);
        }
        ctx.restore();
      });
    },
    clear() {
      parts.length = 0;
    },
  };
}

/* ------------------------------ 설정 화면 ------------------------------ */

function mapButton(map, active) {
  return `
    <button class="gm-map${active ? ' is-on' : ''}" type="button" role="radio"
            aria-checked="${active ? 'true' : 'false'}" data-map="${escapeText(map.id)}">
      <span class="gm-map-art" aria-hidden="true">${map.art || ''}</span>
      <span class="gm-map-text">
        <b>${escapeText(map.name)}</b>
        <span>${escapeText(map.sub || '')}</span>
      </span>
    </button>`;
}

/**
 * 사람 수 · 꽝 · 이름(· 맵 · 판정 방식)을 정하는 화면을 host 안에 그린다.
 * 시작을 누르면 onStart(setup) 을 부르고, 그 설정은 이 기기에 남는다.
 *
 * options: { gameId, maps, modes, hint, signal, onStart }
 */
export function setupScreen(host, options) {
  const { gameId, maps = [], modes = [], hint = '', signal, onStart } = options;
  const state = normalizeSetup(readSetup(gameId));
  // 설정 화면을 다시 그릴 때마다 지난 화면의 단추 연결을 끊는다(두 번 눌리지 않게).
  if (host.__gmSetup) host.__gmSetup.abort();
  const controller = new AbortController();
  host.__gmSetup = controller;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const listen = { signal: controller.signal };
  if (maps.length && !maps.some((map) => map.id === state.map)) state.map = maps[0].id;
  if (modes.length && !modes.some((mode) => mode.id === state.mode)) state.mode = modes[0].id;
  // 판정 방식을 오가도 사용자가 고른 꽝 개수를 잃지 않게 따로 들고 있는다.
  let keptLosers = state.mode === 'solo' ? Math.min(1, state.people - 1) : state.losers;
  // 준비 화면에 들어오면 한 번 섞어 둔다 — 시작 전 기본이 이미 섞인 상태.
  let shuffles = 0;

  function markShuffles() {
    host.dataset.shuffles = String(shuffles);
    host.dataset.order = state.names.slice(0, state.people).join('|');
    const note = host.querySelector('#gm-shuffle-note');
    if (note) {
      note.textContent = shuffles === 1
        ? '순서를 한 번 섞었습니다. 셔플을 누를 때마다 다시 섞입니다.'
        : `${shuffles}번 섞었습니다. 시작하면 이 순서 그대로 출발합니다.`;
    }
  }

  /** 지금 보이는 이름 순서를 그대로 한 번 더 섞는다(수동 셔플). */
  function shuffleNames() {
    if (state.people < 2) return;
    readNames();
    const head = state.names.slice(0, state.people);
    state.names = [...shuffle(head), ...state.names.slice(state.people)];
    shuffles += 1;
    sfx.flip();
    paintNames();
    markShuffles();
  }

  host.innerHTML = `
    <div class="gm gm-setup">
      <div class="gm-panel">
        <div class="gm-row">
          <span class="gm-label" id="gm-people-label">사람 수</span>
          <div class="gm-stepper" role="group" aria-labelledby="gm-people-label">
            <button class="gm-step" type="button" data-field="people" data-dir="-1" aria-label="사람 수 줄이기">−</button>
            <input class="gm-value gm-num" id="gm-people" type="text" inputmode="numeric" size="2"
                   value="${state.people}" aria-label="사람 수(2에서 30)" autocomplete="off" spellcheck="false">
            <button class="gm-step" type="button" data-field="people" data-dir="1" aria-label="사람 수 늘리기">+</button>
          </div>
          <span class="gm-sub">2명에서 30명</span>
          <span class="gm-row-end">${soundButton()}</span>
        </div>
        <div class="gm-row">
          <span class="gm-label" id="gm-losers-label">꽝</span>
          <div class="gm-stepper" role="group" aria-labelledby="gm-losers-label">
            <button class="gm-step" type="button" data-field="losers" data-dir="-1" aria-label="꽝 줄이기">−</button>
            <output class="gm-value" id="gm-losers" aria-live="polite">${state.losers}</output>
            <button class="gm-step" type="button" data-field="losers" data-dir="1" aria-label="꽝 늘리기">+</button>
          </div>
          <span class="gm-sub" id="gm-losers-sub"></span>
        </div>
        ${modes.length ? `
        <div class="gm-row gm-row-head"><span class="gm-label" id="gm-mode-label">판정</span></div>
        <div class="gm-modes" role="radiogroup" aria-labelledby="gm-mode-label">
          ${modes.map((mode) => `
            <button class="gm-mode${mode.id === state.mode ? ' is-on' : ''}" type="button" role="radio"
                    aria-checked="${mode.id === state.mode ? 'true' : 'false'}" data-mode="${escapeText(mode.id)}">
              <b>${escapeText(mode.label)}</b>
              <span>${escapeText(mode.sub || '')}</span>
            </button>`).join('')}
        </div>` : ''}
      </div>

      ${maps.length ? `
      <div class="gm-panel">
        <div class="gm-row gm-row-head"><span class="gm-label">맵</span></div>
        <div class="gm-maps" role="radiogroup" aria-label="맵 고르기">
          ${maps.map((map) => mapButton(map, map.id === state.map)).join('')}
        </div>
      </div>` : ''}

      <div class="gm-panel">
        <div class="gm-row gm-row-head">
          <span class="gm-label">참가자 이름</span>
          <div class="gm-name-tools">
            <button class="gm-link" type="button" id="gm-shuffle" aria-label="이름 순서 섞기">셔플</button>
            <button class="gm-link" type="button" id="gm-refill">이름 자동 채우기</button>
            <button class="gm-link" type="button" id="gm-clear">이름 비우기</button>
          </div>
        </div>
        <div class="gm-names" id="gm-names"></div>
        <p class="gm-hint" id="gm-shuffle-note"></p>
      </div>

      <div class="gm-start-row">
        <button class="v16-btn primary gm-start" type="button" id="gm-start">시작</button>
        ${hint ? `<span class="gm-hint">${escapeText(hint)}</span>` : ''}
      </div>
    </div>`;

  const peopleEl = host.querySelector('#gm-people');
  const losersEl = host.querySelector('#gm-losers');
  const losersLabel = host.querySelector('#gm-losers-label');
  const losersSub = host.querySelector('#gm-losers-sub');
  const namesEl = host.querySelector('#gm-names');

  function paintNames() {
    namesEl.innerHTML = state.names.slice(0, state.people).map((name, index) => `
      <label class="gm-name-row">
        <span class="gm-name-no">${index + 1}</span>
        ${avatarCanvas(index, { size: 22 })}
        <input class="pt-input gm-name-input" type="text" maxlength="${NAME_MAX}" value="${escapeText(name)}"
               data-index="${index}" aria-label="${index + 1}번 참가자 이름" spellcheck="false"
               autocomplete="off" enterkeyhint="done">
      </label>`).join('');
    // 30명이면 이름이 촘촘해지므로 세 칸으로 놓고 목록 안에서 스크롤한다.
    namesEl.classList.toggle('is-dense', state.people > 16);
    namesEl.classList.toggle('is-crowded', state.people > 24);
    paintAvatars(namesEl);
  }

  function paintCounts() {
    const solo = state.mode === 'solo';
    if (peopleEl && peopleEl.value !== String(state.people)) peopleEl.value = String(state.people);
    losersEl.textContent = String(solo ? state.people - 1 : state.losers);
    if (losersLabel) losersLabel.textContent = state.mode === 'last' ? '당첨' : '꽝';
    if (solo) {
      losersSub.textContent = `1등만 당첨 · 나머지 ${state.people - 1}명 꽝`;
    } else if (state.mode === 'last') {
      losersSub.textContent = `마지막 ${state.losers}명이 당첨`;
    } else if (state.people <= PEOPLE_MIN + 1) {
      losersSub.textContent = `0명 또는 ${state.people - 1}명`;
    } else {
      losersSub.textContent = `0명에서 ${state.people - 1}명까지`;
    }
    host.querySelectorAll('.gm-step').forEach((button) => {
      const field = button.dataset.field;
      const dir = Number(button.dataset.dir);
      const value = field === 'people' ? state.people : state.losers;
      const max = field === 'people' ? PEOPLE_MAX : state.people - 1;
      const min = field === 'people' ? PEOPLE_MIN : (state.mode === 'last' ? 1 : 0);
      const locked = field === 'losers' && solo;
      button.disabled = locked || (dir < 0 ? value <= min : value >= max);
    });
  }

  function paintModes() {
    host.querySelectorAll('.gm-mode').forEach((node) => {
      const on = node.dataset.mode === state.mode;
      node.classList.toggle('is-on', on);
      node.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function paint() {
    paintCounts();
    paintModes();
    paintNames();
  }

  /** 사람 수를 바꾼다 — 숫자를 직접 적어도, 단추를 눌러도 같은 길로 들어온다. */
  function setPeople(next) {
    const value = Math.floor(Number(next));
    const target = Math.max(PEOPLE_MIN, Math.min(PEOPLE_MAX, Number.isFinite(value) ? value : state.people));
    if (target === state.people) return false;
    // 이름칸에 적어 둔 값을 먼저 state 로 옮긴 뒤 인원을 바꾼다.
    readNames();
    state.people = target;
    if (state.mode === 'solo') keptLosers = Math.max(1, Math.min(keptLosers, state.people - 1));
    state.losers = Math.min(state.losers, state.people - 1);
    if (state.mode === 'last') state.losers = Math.max(1, state.losers);
    return true;
  }

  function step(field, dir) {
    if (field === 'people') {
      if (!setPeople(state.people + dir)) return;
    } else {
      if (state.mode === 'solo') return;
      const min = state.mode === 'last' ? 1 : 0;
      const next = Math.max(min, Math.min(state.people - 1, state.losers + dir));
      if (next === state.losers) return;
      state.losers = next;
      keptLosers = next;
      losersEl.textContent = String(state.losers);
    }
    sfx.click();
    paint();
  }

  /** 판정 방식을 고른다 — 1등만이면 꽝 개수를 잠그고, 돌아오면 쓰던 값을 살린다. */
  function pickMode(id) {
    if (id === state.mode) return;
    if (state.mode !== 'solo') keptLosers = state.losers;
    state.mode = id;
    if (id === 'solo') state.losers = state.people - 1;
    else if (id === 'last') state.losers = Math.max(1, Math.min(keptLosers, state.people - 1));
    else state.losers = Math.max(0, Math.min(keptLosers, state.people - 1));
    sfx.click();
    paint();
  }

  function readNames() {
    namesEl.querySelectorAll('.gm-name-input').forEach((input, index) => {
      state.names[index] = input.value;
    });
  }

  function finalSetup() {
    readNames();
    const names = [];
    for (let index = 0; index < state.people; index += 1) {
      const text = String(state.names[index] || '').trim().slice(0, NAME_MAX);
      names.push(text || defaultName(index));
    }
    return normalizeSetup({ people: state.people, losers: state.mode === 'solo' ? state.people - 1 : state.losers, names, map: state.map, mode: state.mode });
  }

  host.addEventListener('click', (event) => {
    const stepButton = event.target.closest('.gm-step');
    if (stepButton) {
      event.preventDefault();
      step(stepButton.dataset.field, Number(stepButton.dataset.dir));
      return;
    }
    if (event.target.closest('#gm-shuffle')) {
      event.preventDefault();
      shuffleNames();
      return;
    }
    if (event.target.closest('#gm-refill')) {
      event.preventDefault();
      state.names = Array.from({ length: PEOPLE_MAX }, (_, index) => defaultName(index));
      sfx.click();
      paintNames();
      markShuffles();
      return;
    }
    if (event.target.closest('#gm-clear')) {
      event.preventDefault();
      state.names = Array.from({ length: PEOPLE_MAX }, () => '');
      sfx.click();
      paintNames();
      markShuffles();
      return;
    }
    const mapButtonEl = event.target.closest('.gm-map');
    if (mapButtonEl) {
      event.preventDefault();
      state.map = mapButtonEl.dataset.map;
      sfx.click();
      host.querySelectorAll('.gm-map').forEach((node) => {
        const on = node === mapButtonEl;
        node.classList.toggle('is-on', on);
        node.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      return;
    }
    const modeButton = event.target.closest('.gm-mode');
    if (modeButton) {
      event.preventDefault();
      pickMode(modeButton.dataset.mode);
      return;
    }
    if (event.target.closest('#gm-start')) {
      event.preventDefault();
      const setup = finalSetup();
      saveSetup(gameId, setup);
      sfx.click();
      onStart(setup);
    }
  }, listen);

  host.addEventListener('change', (event) => {
    if (event.target !== peopleEl) return;
    setPeople(peopleEl.value);
    paint();
    saveSetup(gameId, finalSetup());
  }, listen);

  host.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.classList.contains('gm-name-input')) {
      event.preventDefault();
      event.target.blur();
    } else if (event.key === 'Enter' && event.target === peopleEl) {
      event.preventDefault();
      peopleEl.blur();
    }
  }, listen);

  // 준비 화면에 들어오면 한 번 섞어 둔다 — 시작 전 기본이 이미 섞인 상태.
  if (state.people >= 2) {
    state.names = [...shuffle(state.names.slice(0, state.people)), ...state.names.slice(state.people)];
    shuffles = 1;
  }
  paint();
  markShuffles();
}

/* ------------------------------ 결과 ------------------------------ */

/**
 * 결과 요약 상자 — 당첨과 꽝을 나눠 이름을 보여 주고, 아래에 다시하기·새로 설정하기.
 * entries: [{ name, lose, meta, index }]   (index 는 캐릭터 번호, meta 는 이름 옆 짧은 글자)
 * extraHtml: 요약 위에 끼울 것(예: 선착순 골인의 시상대)
 */
export function resultPanel({ id = '', entries = [], extraHtml = '', note = '', groups = true }) {
  const wins = entries.filter((entry) => !entry.lose);
  const loses = entries.filter((entry) => entry.lose);
  const chip = (entry) => `<li class="gm-chip${entry.lose ? ' is-lose' : ' is-win'}">
      ${entry.index != null
        ? avatarCanvas(entry.index, { size: 20, mood: entry.lose ? 'lose' : 'win', badge: true })
        : '<span class="gm-chip-dot" aria-hidden="true"></span>'}
      <span class="gm-chip-name">${escapeText(entry.name)}</span>
      ${entry.meta ? `<span class="gm-chip-meta">${escapeText(entry.meta)}</span>` : ''}
    </li>`;

  return `
    <div class="gm-result"${id ? ` id="${id}"` : ''}>
      <div class="gm-result-head">
        <h3>결과</h3>
        ${note ? `<p class="gm-result-note">${escapeText(note)}</p>` : ''}
      </div>
      ${extraHtml}
      ${groups ? `<div class="gm-groups">
        <div class="gm-group is-win">
          <div class="gm-group-head"><span>당첨</span><b>${wins.length}명</b></div>
          <ul class="gm-chip-list">${wins.length ? wins.map(chip).join('') : '<li class="gm-chip is-empty">없음</li>'}</ul>
        </div>
        <div class="gm-group is-lose">
          <div class="gm-group-head"><span>꽝</span><b>${loses.length}명</b></div>
          <ul class="gm-chip-list">${loses.length ? loses.map(chip).join('') : '<li class="gm-chip is-empty">없음</li>'}</ul>
        </div>
      </div>` : ''}
      <div class="gm-actions">
        <button class="v16-btn primary gm-retry" type="button" data-act="retry">다시하기</button>
        <button class="v16-btn gm-reset" type="button" data-act="setup">새로 설정하기</button>
      </div>
    </div>`;
}

/** 결과 상자의 다시하기·새로 설정하기를 잇는다. */
export function bindActions(host, { onRetry, onSetup }, signal) {
  host.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    event.preventDefault();
    if (button.dataset.act === 'retry') onRetry();
    else if (button.dataset.act === 'setup') onSetup();
  }, { signal });
}

/** 위젯에서 자주 쓰는 짧은 숫자 표시. */
export function hudStat(label, value, variant = '') {
  return `<div class="gm-stat${variant ? ` is-${variant}` : ''}">
      <span class="gm-stat-k">${escapeText(label)}</span>
      <b class="gm-stat-v">${escapeText(value)}</b>
    </div>`;
}

/* ------------------------------ 시상대 ------------------------------ */

/**
 * 1·2·3등 시상대. order 는 [{ name, index, lose }] — 1등부터.
 * 4등 이하는 결과 표(.rc-board)에서 보여 준다.
 */
export function podiumHtml(order) {
  const top = order.slice(0, 3);
  const places = [top[1], top[0], top[2]];
  const heights = [58, 82, 42];
  return `
    <div class="rc-podium" role="list" aria-label="시상대">
      ${places.map((entry, slot) => {
        if (!entry) return '<div class="rc-pod is-empty" role="listitem"></div>';
        const rank = top.indexOf(entry) + 1;
        const mood = rank === 1 ? 'win' : (entry.lose ? 'lose' : 'idle');
        return `
        <div class="rc-pod rc-pod-${rank}${entry.lose ? ' is-lose' : ''}" role="listitem"
             style="--pod-h: ${heights[slot]}px">
          <span class="rc-pod-who">
            ${avatarCanvas(entry.index, { size: rank === 1 ? 46 : 38, mood, badge: true })}
            <span class="rc-pod-name">${escapeText(entry.name)}</span>
          </span>
          <span class="rc-pod-block"><b>${rank}</b></span>
        </div>`;
      }).join('')}
    </div>`;
}