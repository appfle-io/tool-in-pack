/* TIP · 모듈 다이얼 규칙 — v1.17.0
 *
 * 노치의 '간단히 보기'(반원 다이얼)와 '전체 보기'의 '켜 둔 모듈' 한 줄이 같은 회전 규칙을 쓴다.
 * 예전 js/radial.js(반원 퀵바 창)에 있던 계산을 화면과 떼어 여기에 모았다 — 화면(DOM)은 만지지 않는다.
 *
 * 회전 방식(환경설정 → 노치 → 모듈 회전 방식, tip.notch.v1 rotation):
 *   'loop'    — 계속 회전. 마지막 모듈 다음에 처음 모듈이 이어진다(기본, 예전 반원과 같다).
 *   'bounded' — 처음과 끝에서 멈춤. 첫 모듈과 마지막 모듈에서 더 돌지 않는다.
 */

export const DIAL_SLOTS = 7;          // 한 화면에 보이는 칸 수(반원·한 줄 모두)

/** 연속 위치 pos 에서 index 번째 모듈이 가운데로부터 몇 칸 떨어져 있는지 — 계속 회전(가장 가까운 쪽). */
export function dialDelta(index, pos, n) {
  if (!n) return 0;
  let d = ((index - pos) % n + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

/** 회전 방식에 맞춘 거리 — 멈춤 방식은 감지 않고 그대로 뺀다. */
export function offsetOf(index, pos, n, loop) {
  return loop ? dialDelta(index, pos, n) : index - pos;
}

/** 위치 값을 회전 방식에 맞게 자른다 — 멈춤 방식은 0 ~ n-1 안에서만 움직인다. */
export function clampPos(pos, n, loop) {
  if (!n) return 0;
  if (loop) return pos;
  return Math.max(0, Math.min(n - 1, pos));
}

/** 지금 가운데에 있는 모듈의 순번. */
export function centerIndex(pos, n, loop) {
  if (!n) return -1;
  const rounded = Math.round(pos);
  if (!loop) return Math.max(0, Math.min(n - 1, rounded));
  return ((rounded % n) + n) % n;
}

/** 가운데를 index 로 옮길 때의 목표 위치 — 계속 회전이면 가까운 쪽으로 돈다. */
export function targetFor(index, pos, n, loop) {
  if (!n) return 0;
  return loop ? pos + dialDelta(index, pos, n) : Math.max(0, Math.min(n - 1, index));
}

/** 끝에 닿았는지 — 멈춤 방식에서만 true 가 될 수 있다. [앞 끝, 뒤 끝] */
export function atEnds(pos, n, loop) {
  if (n <= 1) return [true, true];
  if (loop) return [false, false];
  const center = centerIndex(pos, n, loop);
  return [center <= 0, center >= n - 1];
}

/* ------------------------------ 한 줄(켜 둔 모듈) ------------------------------ */

/** 한 줄의 첫 칸 위치를 회전 방식에 맞게 자른다. */
export function clampRowStart(start, n, size = DIAL_SLOTS, loop = true) {
  if (n <= size) return 0;
  if (loop) return ((start % n) + n) % n;
  return Math.max(0, Math.min(n - size, start));
}

/** 한 줄에 보일 항목 — 계속 회전이면 끝에서 처음으로 이어 붙인다. */
export function rowWindow(list, start, size = DIAL_SLOTS, loop = true) {
  const n = list.length;
  if (n <= size) return list.slice();
  const first = clampRowStart(start, n, size, loop);
  const out = [];
  for (let i = 0; i < size; i += 1) out.push(list[(first + i) % n]);
  return out;
}

/** 머리글의 위치 표시 — '1–7 / 18', 계속 회전으로 넘어가면 '15–18, 1–3 / 18', 7개 이하면 '3개'. */
export function rowPositionLabel(start, n, size = DIAL_SLOTS, loop = true) {
  if (n <= size) return `${n}개`;
  const first = clampRowStart(start, n, size, loop);
  const last = first + size;
  if (last <= n) return `${first + 1}–${last} / ${n}`;
  return `${first + 1}–${n}, 1–${last - n} / ${n}`;
}

/** 한 줄이 양 끝에 닿았는지 — [앞 끝, 뒤 끝]. 7개 이하면 화살표 자체를 숨긴다. */
export function rowAtEnds(start, n, size = DIAL_SLOTS, loop = true) {
  if (n <= size) return [true, true];
  if (loop) return [false, false];
  const first = clampRowStart(start, n, size, loop);
  return [first <= 0, first >= n - size];
}

/* ------------------------------ 찾기 ------------------------------ */

/** 이름(또는 짧은 이름)에 query 가 들어간 첫 모듈의 순번. 없으면 -1. 대소문자는 가리지 않는다. */
export function findIndex(ids, query, nameOf) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return -1;
  return ids.findIndex((id) => {
    const names = nameOf(id);
    return (Array.isArray(names) ? names : [names])
      .some((name) => String(name || '').toLowerCase().includes(q));
  });
}
