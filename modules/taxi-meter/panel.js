/*
 * TIP · 택시 미터기 (taxi-meter) 표시판 — 7세그먼트 요금 숫자와 도트 매트릭스 말.
 *
 * 화면은 두 캔버스로 나뉜다.
 *   · createLedPanel  — 붉은 LED 숫자. 실제 한국 택시 미터기처럼 7.5° 기울인 굵은 획을 쓰고,
 *                       꺼진 획은 아주 은은하게 남겨 전광판의 판이 보이게 한다. 글자 수가 늘면
 *                       판 높이·폭에 맞춰 글자 크기를 다시 계산해 잘리거나 찌그러지지 않는다.
 *   · createDotHorse  — 점 격자 위에 말 실루엣을 찍는다. 몸통·목·머리·꼬리는 도형 안쪽 점을 칠하고,
 *                       다리는 관절 두 마디를 수식으로 풀어 점과의 거리로 칠한다. 속도에 맞춰 다리 위상이 돈다.
 *
 * 두 캔버스 모두 화면 배율(devicePixelRatio)에 맞춰 다시 그리고, 크기가 바뀌면 스스로 측정해 맞춘다.
 */

/* ------------------------------ 7세그먼트 숫자 ------------------------------ */

// a 위, b 오른쪽 위, c 오른쪽 아래, d 아래, e 왼쪽 아래, f 왼쪽 위, g 가운데
const DIGIT_SEGMENTS = {
  0: 'abcdef',
  1: 'bc',
  2: 'abged',
  3: 'abgcd',
  4: 'fgbc',
  5: 'afgcd',
  6: 'afgedc',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};
const ALL_SEGMENTS = 'abcdefg';

/*
 * 실제 미터기 판의 비율을 옮겼다. 모든 값은 글자 높이(h)에 대한 비율이다.
 * 획 두께 0.14h · 글자 폭 0.58h 로, 세로로 길쭉한 예전 판보다 균형이 잡힌 모양이 된다.
 */
const SKEW = Math.tan((7.5 * Math.PI) / 180); // 위로 갈수록 오른쪽으로 기우는 각도
const STROKE_RATIO = 0.14;
const DIGIT_WIDTH_RATIO = 0.58;
const DIGIT_GAP_RATIO = 0.135;
const COMMA_WIDTH_RATIO = 0.11;
const COMMA_GAP_RATIO = 0.055;
const INNER_GAP_RATIO = 0.028;

/** 글자 상자 안에서 획 하나를 육각형(끝을 45°로 깎은 막대)으로 만든 좌표. */
function barPolygon(x0, y0, x1, y1, thickness) {
  const half = thickness / 2;
  if (y0 === y1) {
    return [
      [x0 + half, y0 - half], [x1 - half, y0 - half], [x1, y0],
      [x1 - half, y0 + half], [x0 + half, y0 + half], [x0, y0],
    ];
  }
  return [
    [x0, y0 + half], [x0 + half, y0], [x0 + half, y1 - half],
    [x0, y1], [x0 - half, y1 - half], [x0 - half, y0 + half],
  ];
}

/** 글자 상자의 획 7개 — 좌표는 (0,0)~(w,h) 기준, 기울이기 전. */
function digitSegments(width, height) {
  const thickness = height * STROKE_RATIO;
  const gap = height * INNER_GAP_RATIO;
  const inner = thickness / 2;
  const mid = height / 2;
  const top = inner;
  const bottom = height - inner;
  const left = inner;
  const right = width - inner;
  const a = barPolygon(left + gap, top, right - gap, top, thickness);
  const d = barPolygon(left + gap, bottom, right - gap, bottom, thickness);
  const g = barPolygon(left + gap, mid, right - gap, mid, thickness);
  const f = barPolygon(left, top + gap, left, mid - gap, thickness);
  const b = barPolygon(right, top + gap, right, mid - gap, thickness);
  const e = barPolygon(left, mid + gap, left, bottom - gap, thickness);
  const c = barPolygon(right, mid + gap, right, bottom - gap, thickness);
  return { a, b, c, d, e, f, g };
}

/** 쉼표 — 아래쪽에 기울어진 짧은 토막. */
function commaPolygon(width, height) {
  const cx = width / 2;
  const half = width * 0.42;
  return [
    [cx - half, height * 0.80], [cx + half, height * 0.785],
    [cx + half, height * 0.985], [cx - half, height * 0.99],
  ];
}

function addSheared(path, points, shiftX, originY, height) {
  points.forEach(([x, y], index) => {
    const px = shiftX + x + (height - y) * SKEW;
    const py = originY + y;
    if (index === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  });
  path.closePath();
}

/** 글자 하나의 폭과 앞 간격(높이에 대한 비율). 쉼표는 좁게 붙는다. */
function cellMetrics(char) {
  if (char === ',') return { width: COMMA_WIDTH_RATIO, gap: COMMA_GAP_RATIO };
  return { width: DIGIT_WIDTH_RATIO, gap: DIGIT_GAP_RATIO };
}

/** 글자 배열 전체의 폭(높이 1 기준) — 기울어져 늘어난 폭까지 더한다. */
function totalWidthUnits(chars) {
  let total = SKEW;
  chars.forEach((char, index) => {
    const cell = cellMetrics(char);
    if (index > 0) total += cell.gap;
    total += cell.width;
  });
  return total;
}

export function createLedPanel(canvas) {
  const ctx2d = canvas.getContext('2d');
  let cssWidth = 0;
  let cssHeight = 0;
  let ratio = 1;
  let current = '';
  let layout = { height: 0, width: 0, cssWidth: 0, cssHeight: 0, chars: 0 };

  function paint(text) {
    if (!ctx2d || !cssWidth || !cssHeight) return;
    ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx2d.clearRect(0, 0, cssWidth, cssHeight);

    const chars = String(text || '0').split('');
    if (!chars.length) return;

    // 글자 수에 맞춰 판 높이·폭 안에 들어가는 가장 큰 글자를 고른다(가변 길이).
    const units = totalWidthUnits(chars);
    const widthLimit = cssWidth * 0.97;
    const heightLimit = cssHeight * 0.93;
    const height = Math.min(heightLimit, widthLimit / units);
    const width = height * DIGIT_WIDTH_RATIO;
    const totalWidth = units * height;
    // 획이 판 좌우에서 살짝 들어가므로(두께의 절반) 그만큼 당겨 시각적으로 가운데에 둔다.
    const originX = (cssWidth - totalWidth) / 2 - (height * STROKE_RATIO) / 4;
    const originY = (cssHeight - height) / 2;
    layout = { height, width, totalWidth, cssWidth, cssHeight, chars: chars.length };

    // 경로는 채울 때의 변환과 무관하게 좌표를 그대로 쓰므로, 칸 위치를 좌표에 직접 더한다.
    const lit = new Path2D();
    const off = new Path2D();
    let cursorX = originX;

    chars.forEach((char, index) => {
      const cell = cellMetrics(char);
      if (index > 0) cursorX += cell.gap * height;
      if (char === ',') {
        const comma = new Path2D();
        addSheared(comma, commaPolygon(cell.width * height, height), cursorX, originY, height);
        lit.addPath(comma);
      } else {
        const shapes = digitSegments(width, height);
        const on = DIGIT_SEGMENTS[char] || '';
        ALL_SEGMENTS.split('').forEach((key) => {
          const path = new Path2D();
          addSheared(path, shapes[key], cursorX, originY, height);
          (on.includes(key) ? lit : off).addPath(path);
        });
      }
      cursorX += cell.width * height;
    });

    // 꺼진 획 — 아주 은은하게 남겨 전광판의 판이 보이게.
    ctx2d.fillStyle = 'rgba(255, 59, 48, 0.065)';
    ctx2d.fill(off);

    // 켜진 획 — 번짐을 얹은 뒤 다시 선명하게 채운다.
    ctx2d.save();
    ctx2d.shadowColor = 'rgba(255, 59, 48, 0.55)';
    ctx2d.shadowBlur = Math.max(4, height * 0.085);
    ctx2d.fillStyle = 'rgba(255, 59, 48, 0.92)';
    ctx2d.fill(lit);
    ctx2d.restore();
    ctx2d.fillStyle = '#FF3B30';
    ctx2d.fill(lit);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(60, Math.round(rect.width));
    const nextHeight = Math.max(30, Math.round(rect.height));
    ratio = Math.min(3, window.devicePixelRatio || 1);
    if (nextWidth === cssWidth && nextHeight === cssHeight && canvas.width === Math.round(nextWidth * ratio)) return;
    cssWidth = nextWidth;
    cssHeight = nextHeight;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    paint(current);
  }

  return {
    set(text) {
      if (String(text) === current) return;
      current = String(text);
      paint(current);
    },
    resize,
    redraw: () => paint(current),
    get text() { return current; },
    /** 마지막으로 그린 배치 — 검사 도구가 잘림·확대 비율을 확인할 때 쓴다. */
    get layout() { return { ...layout, text: current }; },
  };
}

/* ------------------------------ 도트 매트릭스 말 ------------------------------ */

function insideEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let index = 0, before = points.length - 1; index < points.length; before = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[before];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// 말 실루엣 — 옆에서 본 모습. 1.0 이 몸통 길이, 발굽이 y=0.
const BODY = [0.0, 0.70, 0.44, 0.155];
const RUMP = [-0.32, 0.71, 0.16, 0.17];
const CHEST = [0.30, 0.69, 0.14, 0.17];
const NECK = [[0.23, 0.82], [0.43, 1.19], [0.57, 1.12], [0.42, 0.73]];
const HEAD = [[0.43, 1.16], [0.46, 1.26], [0.57, 1.22], [0.73, 1.06], [0.67, 0.94], [0.49, 1.05]];
const EAR = [[0.458, 1.21], [0.474, 1.33], [0.512, 1.20]];
const MANE = [[0.34, 0.92], [0.46, 1.21]];

/** 다리 마디 — 엉덩이에서 무릎, 무릎에서 발굽. */
function legJoints(hipX, hipY, angle, bend) {
  const upper = 0.31;
  const lower = 0.31;
  const kneeX = hipX + Math.sin(angle) * upper;
  const kneeY = hipY - Math.cos(angle) * upper;
  const hoofX = kneeX + Math.sin(angle - bend) * lower;
  const hoofY = kneeY - Math.cos(angle - bend) * lower;
  return [[hipX, hipY], [kneeX, kneeY], [hoofX, hoofY]];
}

function legsAt(phase) {
  return [
    legJoints(0.32, 0.64, Math.sin(phase) * 0.34, 0.22),
    legJoints(0.20, 0.64, Math.sin(phase + 0.6) * 0.32, 0.3),
    legJoints(-0.26, 0.65, Math.sin(phase + Math.PI) * 0.32, 0.36),
    legJoints(-0.40, 0.65, Math.sin(phase + Math.PI + 0.6) * 0.34, 0.26),
  ];
}

function tailPoints(phase) {
  const wave = Math.sin(phase * 0.8) * 0.025;
  return [
    [-0.46, 0.92 + wave], [-0.53, 0.86 - wave], [-0.60, 0.73 + wave],
    [-0.66, 0.58 - wave], [-0.70, 0.44 + wave],
  ];
}

function tailStrands(phase) {
  const wave = Math.sin(phase * 0.8) * 0.025;
  return [
    tailPoints(phase),
    [
      [-0.47, 0.90 + wave], [-0.55, 0.82 - wave], [-0.62, 0.68 + wave],
      [-0.67, 0.54 - wave], [-0.71, 0.41 + wave],
    ],
  ];
}

export function createDotHorse(canvas) {
  const ctx2d = canvas.getContext('2d');
  let cssWidth = 0;
  let cssHeight = 0;
  let ratio = 1;
  let dots = [];
  let scale = 1;
  let baseX = 0;
  let baseY = 0;

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(120, Math.round(rect.width));
    const nextHeight = Math.max(60, Math.round(rect.height));
    ratio = Math.min(3, window.devicePixelRatio || 1);
    if (nextWidth === cssWidth && nextHeight === cssHeight) return false;
    cssWidth = nextWidth;
    cssHeight = nextHeight;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);

    scale = Math.min(cssWidth / 1.66, cssHeight / 1.36);
    baseX = cssWidth / 2;
    // 말을 영역 가운데에 둔다. 높이에 맞춰 그릴 때(좁은 판)는 예전처럼 아래에 붙는다.
    baseY = Math.min(cssHeight * 0.98, cssHeight / 2 + scale * 0.62);
    const step = Math.max(5, Math.min(8, scale * 0.055));
    const list = [];
    for (let y = -0.02; y <= 1.32; y += step / scale) {
      for (let x = -0.84; x <= 0.74; x += step / scale) {
        // 격자를 살짝 엇갈리게 해 점이 규칙적으로 줄 서 보이지 않게
        const wobble = Math.round(y * 40) % 2 ? (step / scale) / 2 : 0;
        const px = x + wobble;
        if (px > 0.76) continue;
        list.push({ x: px, y, tint: 0.55 + (((Math.round(px * 97) * 31 + Math.round(y * 89)) % 45) / 100) });
      }
    }
    dots = list;
    return true;
  }

  function draw({ speed = 0, phase = 0 } = {}) {
    if (!ctx2d || !cssWidth) return;
    ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx2d.clearRect(0, 0, cssWidth, cssHeight);

    const legs = legsAt(phase);
    const moving = Math.min(1, Math.max(0, speed / 30));
    const tails = tailStrands(phase);
    const inHorse = (x, y) => {
      if (insideEllipse(x, y, BODY[0], BODY[1], BODY[2], BODY[3])) return true;
      if (insideEllipse(x, y, RUMP[0], RUMP[1], RUMP[2], RUMP[3])) return true;
      if (insideEllipse(x, y, CHEST[0], CHEST[1], CHEST[2], CHEST[3])) return true;
      if (insidePolygon(x, y, NECK)) return true;
      if (insidePolygon(x, y, HEAD)) return true;
      if (insidePolygon(x, y, EAR)) return true;
      if (distanceToSegment(x, y, MANE[0][0], MANE[0][1], MANE[1][0], MANE[1][1]) < 0.022) return true;
      for (const leg of legs) {
        const [a, b, c] = leg;
        if (distanceToSegment(x, y, a[0], a[1], b[0], b[1]) < 0.034) return true;
        if (distanceToSegment(x, y, b[0], b[1], c[0], c[1]) < 0.03) return true;
      }
      for (const tail of tails) {
        for (let index = 1; index < tail.length; index += 1) {
          if (distanceToSegment(x, y, tail[index - 1][0], tail[index - 1][1], tail[index][0], tail[index][1]) < 0.024) return true;
        }
      }
      return false;
    };

    const lit = new Path2D();
    const radius = Math.max(1.2, scale * 0.0195);
    for (const dot of dots) {
      if (!inHorse(dot.x, dot.y)) continue;
      const sx = baseX + dot.x * scale;
      const sy = baseY - dot.y * scale;
      lit.moveTo(sx + radius, sy);
      lit.arc(sx, sy, radius, 0, Math.PI * 2);
    }

    // 달릴 때 뒤로 흩날리는 먼지 — 점 몇 개를 위상에 맞춰 흘린다.
    if (moving > 0.05) {
      const puffs = Math.round(8 * moving);
      for (let index = 0; index < puffs; index += 1) {
        const cycle = (phase / (Math.PI * 2) + index / puffs) % 1;
        const sx = baseX + (-0.52 - cycle * 0.42) * scale;
        const sy = baseY - (0.03 + Math.abs(Math.sin(cycle * Math.PI)) * 0.085) * scale;
        const r = radius * (0.45 + (1 - cycle) * 0.7);
        lit.moveTo(sx + r, sy);
        lit.arc(sx, sy, r, 0, Math.PI * 2);
      }
    }

    ctx2d.save();
    ctx2d.shadowColor = 'rgba(255, 168, 40, 0.5)';
    ctx2d.shadowBlur = Math.max(4, scale * 0.08);
    ctx2d.fillStyle = 'rgba(255, 176, 48, 0.92)';
    ctx2d.fill(lit);
    ctx2d.restore();
    ctx2d.fillStyle = 'rgba(255, 214, 120, 0.95)';
    ctx2d.fill(lit);
  }

  return {
    resize() {
      const changed = measure();
      if (changed) draw({ speed: 0, phase: 0 });
      return changed;
    },
    draw,
  };
}
