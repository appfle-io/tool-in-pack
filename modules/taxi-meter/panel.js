/*
 * TIP · 택시 미터기 (taxi-meter) 표시판 — 7세그먼트 요금 숫자와 도트 매트릭스 말.
 *
 * 화면은 두 캔버스로 나뉜다.
 *   · createLedPanel  — 붉은 LED 숫자. 켜지지 않은 획을 아주 흐리게 남겨 실제 전광판처럼 보이게 하고,
 *                       켜진 획은 한 번에 모아 그려 그림자(번짐) 비용을 줄인다.
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

/** 가로 막대 — 끝을 비스듬히 깎은 육각형. */
function flatBar(x0, y, length, thickness) {
  const bevel = Math.min(length / 4, thickness * 0.5);
  const half = thickness / 2;
  return [
    [x0 + bevel, y - half], [x0 + length - bevel, y - half], [x0 + length, y],
    [x0 + length - bevel, y + half], [x0 + bevel, y + half], [x0, y],
  ];
}

/** 세로 막대. */
function uprightBar(x, y0, length, thickness) {
  const bevel = Math.min(length / 4, thickness * 0.5);
  const half = thickness / 2;
  return [
    [x - half, y0 + bevel], [x, y0], [x + half, y0 + bevel],
    [x + half, y0 + length - bevel], [x, y0 + length], [x - half, y0 + length - bevel],
  ];
}

function tracePolygon(ctx2d, points) {
  ctx2d.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) ctx2d.lineTo(points[index][0], points[index][1]);
  ctx2d.closePath();
}

/**
 * 한 글자(0~9) 또는 쉼표의 획 목록. 좌표는 글자 상자 (0,0)~(w,h) 기준이다.
 * 가로 막대는 글자 폭을 꽉 채우고, 세로 막대는 위아래 막대에 살짝 붙게 두어
 * 획 사이가 벌어져 보이지 않게 한다.
 */
function segmentShapes(char, width, height) {
  const thickness = height * 0.14;
  const gap = height * 0.02;
  const half = height / 2;

  const shapes = {
    a: flatBar(0, thickness / 2, width, thickness),
    d: flatBar(0, height - thickness / 2, width, thickness),
    g: flatBar(0, half, width, thickness),
    b: uprightBar(width - thickness / 2, thickness + gap, half - thickness * 1.5 - gap * 2, thickness),
    c: uprightBar(width - thickness / 2, half + thickness / 2 + gap, half - thickness * 1.5 - gap * 2, thickness),
    e: uprightBar(thickness / 2, half + thickness / 2 + gap, half - thickness * 1.5 - gap * 2, thickness),
    f: uprightBar(thickness / 2, thickness + gap, half - thickness * 1.5 - gap * 2, thickness),
  };

  if (char === ',') {
    return { comma: { x: width * 0.32, y: height - thickness * 0.15, r: thickness * 0.4 } };
  }

  const on = DIGIT_SEGMENTS[char] || '';
  return {
    segments: ALL_SEGMENTS.split('').map((key) => ({ key, points: shapes[key], on: on.includes(key) })),
  };
}

export function createLedPanel(canvas) {
  const ctx2d = canvas.getContext('2d');
  let cssWidth = 0;
  let cssHeight = 0;
  let ratio = 1;
  let current = '';

  function paint(text) {
    if (!ctx2d || !cssWidth || !cssHeight) return;
    ctx2d.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx2d.clearRect(0, 0, cssWidth, cssHeight);

    const chars = String(text || '0').split('');
    if (!chars.length) return;
    // 글자 폭(0.60h) + 사이(0.13h) 로 전체 폭을 잡고, 높이를 화면에 맞춰 줄인다.
    const widthFactor = 0.60;
    const advanceFactor = 0.73;
    const heightLimit = cssHeight * 0.94;
    const fitWidth = cssWidth / (chars.length * advanceFactor - (advanceFactor - widthFactor));
    const height = Math.min(heightLimit, fitWidth);
    const width = height * widthFactor;
    const advance = height * advanceFactor;
    const totalWidth = chars.length * advance - (advance - width);
    const originX = (cssWidth - totalWidth) / 2;
    const originY = (cssHeight - height) / 2;

    // 경로는 채울 때의 변환과 무관하게 좌표를 그대로 쓰므로, 칸 위치를 좌표에 직접 더한다.
    const lit = new Path2D();
    const off = new Path2D();

    chars.forEach((char, index) => {
      const shape = segmentShapes(char, width, height);
      const shiftX = originX + index * advance;
      if (shape.comma) {
        const dot = new Path2D();
        dot.arc(shiftX + shape.comma.x, originY + shape.comma.y, shape.comma.r, 0, Math.PI * 2);
        lit.addPath(dot);
        return;
      }
      shape.segments.forEach((segment) => {
        const path = new Path2D();
        tracePolygon(path, segment.points.map(([px, py]) => [shiftX + px, originY + py]));
        (segment.on ? lit : off).addPath(path);
      });
    });

    // 꺼진 획 — 아주 흐리게 남겨 전광판의 판이 보이게.
    ctx2d.fillStyle = 'rgba(255, 82, 70, 0.07)';
    ctx2d.fill(off);

    // 켜진 획 — 번짐을 한 번만 얹고, 다시 선명하게 채운다.
    ctx2d.save();
    ctx2d.shadowColor = 'rgba(255, 64, 48, 0.5)';
    ctx2d.shadowBlur = height * 0.08;
    ctx2d.fillStyle = 'rgba(255, 70, 54, 0.96)';
    ctx2d.fill(lit);
    ctx2d.restore();
    ctx2d.fillStyle = '#FF5A45';
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
    baseY = cssHeight * 0.965;
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
