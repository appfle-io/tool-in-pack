/**
 * TIP · 영상 편집 모델 (v1.25.0)
 *
 * 화면(module.js)과 계산을 나눠 둔다 — 타임라인 배치·전환 겹침·시간 계산이 한곳에 모여야
 * 미리보기와 내보내기의 시각이 어긋나지 않는다.
 *
 * 규칙
 *  · 클립은 이어 붙인다. 경계의 전환은 앞 클립의 끝과 뒤 클립의 시작이 겹치는 시간이다.
 *  · 전환이 없는 경계도 아주 짧은(0.04초) 페이드로 붙인다 — 내보내기의 xfade 가 모든 경계를
 *    같은 방식으로 처리하므로, 화면도 같은 값을 써야 자막 시각이 밀리지 않는다.
 *  · 길이는 모두 초(실수)다.
 *
 * v1.24.0 — 오버레이(PIP) 트랙 · 클립 줌/팬 · 자막 프리셋·등장 애니메이션 · 자석 스냅 ·
 *           프로젝트 복제를 여기에 모아 두었다(화면과 내보내기가 같은 값을 쓴다).
 * v1.25.0 — 맞춤/채움/블러 배경 · 회전·반전 · 무음(음소거) · 역재생 · 색감 세부 보정(색온도·
 *           선명도·비네트) · 오디오 노이즈 제거·음성 변조 · 자막 정렬·줄간격 · 부분 모자이크·
 *           블러 영역 · 도형/말풍선/이모지 스티커 · 무음 구간 자동 컷을 더했다. 화면과
 *           ffmpeg 내보내기가 같은 값을 쓰도록 계산은 모두 이 파일에 둔다.
 */

/** 전환이 없는 경계에 쓰는 겹침 — 한 프레임 남짓(내보내기의 xfade 와 같은 값). */
export const CUT = 0.04;

/** 한 프레임(1/30초) — ←/→ 미세 이동과 스냅 판정에 쓴다. */
export const FRAME_STEP = 1 / 30;

/** 자석 스냅이 붙는 거리(화면 픽셀). */
export const SNAP_PIXELS = 8;

/** 화면 가운데 자석 스냅 거리(미리보기 픽셀) — 자막·PIP·모자이크·스티커를 끌 때. */
export const CENTER_SNAP_PIXELS = 6;

/** 쇼츠/릴스 안전영역 — 플랫폼 UI 가 가리는 비율(세로 영상 기준). */
export const SAFE_AREA = { top: 0.13, bottom: 0.2, right: 0.15, label: '쇼츠 안전영역' };

export const ASPECTS = [
  { id: '16:9', label: '16:9', value: 16 / 9 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '1:1', label: '1:1', value: 1 },
];

/** 해상도 — 높이 기준. 2K·4K 는 Mac 앱(ffmpeg)에서만 고른다(웹은 최대 FHD). */
export const RESOLUTIONS = [
  { id: 'hd', label: 'HD (720p)', height: 720, macOnly: false },
  { id: 'fhd', label: 'FHD (1080p)', height: 1080, macOnly: false },
  { id: '2k', label: '2K (1440p)', height: 1440, macOnly: true },
  { id: '4k', label: '4K (2160p)', height: 2160, macOnly: true },
];

export const FPS_OPTIONS = [24, 30, 60];

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

/**
 * 전환 30종 — id 는 ffmpeg 의 xfade transition 이름과 같다(Mac 내보내기에서 그대로 쓴다).
 * family 는 브라우저 미리보기가 어떤 방식으로 흉내 낼지 정한다.
 */
export const TRANSITIONS = [
  { id: 'fade', label: '페이드', family: 'fade' },
  { id: 'fadeblack', label: '검정 페이드', family: 'fadeblack' },
  { id: 'fadewhite', label: '흰색 페이드', family: 'fadewhite' },
  { id: 'dissolve', label: '디졸브', family: 'dissolve' },
  { id: 'pixelize', label: '픽셀', family: 'pixelize' },
  { id: 'radial', label: '방사형', family: 'radial' },
  { id: 'wipeleft', label: '왼쪽 와이프', family: 'wipe', dir: 'left' },
  { id: 'wiperight', label: '오른쪽 와이프', family: 'wipe', dir: 'right' },
  { id: 'wipeup', label: '위 와이프', family: 'wipe', dir: 'up' },
  { id: 'wipedown', label: '아래 와이프', family: 'wipe', dir: 'down' },
  { id: 'wipetl', label: '대각 와이프 ↖', family: 'diag', dir: 'tl' },
  { id: 'wipetr', label: '대각 와이프 ↗', family: 'diag', dir: 'tr' },
  { id: 'wipebl', label: '대각 와이프 ↙', family: 'diag', dir: 'bl' },
  { id: 'wipebr', label: '대각 와이프 ↘', family: 'diag', dir: 'br' },
  { id: 'slideleft', label: '왼쪽 슬라이드', family: 'slide', dir: 'left' },
  { id: 'slideright', label: '오른쪽 슬라이드', family: 'slide', dir: 'right' },
  { id: 'slideup', label: '위 슬라이드', family: 'slide', dir: 'up' },
  { id: 'slidedown', label: '아래 슬라이드', family: 'slide', dir: 'down' },
  { id: 'circleopen', label: '원 열기', family: 'circleopen' },
  { id: 'circleclose', label: '원 닫기', family: 'circleclose' },
  { id: 'vertopen', label: '세로 열기', family: 'split', dir: 'vert-open' },
  { id: 'vertclose', label: '세로 닫기', family: 'split', dir: 'vert-close' },
  { id: 'horzopen', label: '가로 열기', family: 'split', dir: 'horz-open' },
  { id: 'horzclose', label: '가로 닫기', family: 'split', dir: 'horz-close' },
  { id: 'diagtl', label: '대각선 ↖', family: 'diag', dir: 'tl' },
  { id: 'diagtr', label: '대각선 ↗', family: 'diag', dir: 'tr' },
  { id: 'diagbl', label: '대각선 ↙', family: 'diag', dir: 'bl' },
  { id: 'diagbr', label: '대각선 ↘', family: 'diag', dir: 'br' },
  { id: 'zoomin', label: '줌인', family: 'zoom' },
  { id: 'squeezeh', label: '가로 압축', family: 'squeeze' },
];

export function transitionById(id) {
  return TRANSITIONS.find((item) => item.id === id) || TRANSITIONS[0];
}

/** 화면 맞춤 — 검정 여백(Fit) · 잘라서 채움(Fill) · 블러 배경. */
export const FIT_MODES = [
  { id: 'fit', label: '맞춤 (여백 검정)' },
  { id: 'fill', label: '채움 (잘라서 가득)' },
  { id: 'blur', label: '블러 배경' },
];

export function fitById(id) {
  return FIT_MODES.find((item) => item.id === id) || FIT_MODES[0];
}

/** 회전 — 90° 단위 프리셋과 미세 회전(-180~180)을 함께 쓴다. */
export const ROTATIONS = [0, 90, 180, 270];
export const ROTATE_FREE_MIN = -180;
export const ROTATE_FREE_MAX = 180;

/** 색감 세부 보정 기본값 — 배율은 1이 원본, 색온도·선명도·비네트는 0이 원본. */
export const COLOR_DEFAULTS = { brightness: 1, contrast: 1, saturation: 1, temperature: 0, sharpen: 0, vignette: 0 };

/** 오디오 노이즈 제거 — 미리보기(Web Audio highpass/lowpass)와 내보내기(afftdn)가 같은 단계. */
export const DENOISE_LEVELS = [
  { id: 'off', label: '끄기', strength: 0, nr: 0 },
  { id: 'light', label: '약하게', strength: 0.4, nr: 12 },
  { id: 'strong', label: '강하게', strength: 0.85, nr: 24 },
];

export function denoiseById(id) {
  return DENOISE_LEVELS.find((item) => item.id === id) || DENOISE_LEVELS[0];
}

/** 음성 변조 — 미리보기는 Web Audio(재생 속도·딜레이·진동), 내보내기는 ffmpeg 필터. */
export const VOICE_PRESETS = [
  { id: 'original', label: '원본', pitch: 1, filter: '' },
  { id: 'helium', label: '고음 (헬륨)', pitch: 1.28, filter: 'asetrate=48000*1.28,aresample=48000,atempo=0.7813' },
  { id: 'deep', label: '저음', pitch: 0.82, filter: 'asetrate=48000*0.82,aresample=48000,atempo=1.2195' },
  { id: 'robot', label: '로봇', pitch: 1, filter: 'tremolo=f=32:d=0.92' },
  { id: 'echo', label: '에코', pitch: 1, filter: 'aecho=0.8:0.9:60|120:0.38|0.24' },
];

export function voiceById(id) {
  return VOICE_PRESETS.find((item) => item.id === id) || VOICE_PRESETS[0];
}

/** 부분 모자이크/블러 영역 — 시간 구간과 사각형·원형 모양, 세기. */
export const MASK_KINDS = [
  { id: 'mosaic', label: '모자이크' },
  { id: 'blur', label: '가우시안 블러' },
];

export const MASK_SHAPES = [
  { id: 'rect', label: '사각형' },
  { id: 'ellipse', label: '원형' },
];

/** 도형·말풍선·이모지 스티커 — 내보내기는 화면(Canvas)에서 그린 PNG 를 얹는다. */
export const SHAPE_KINDS = [
  { id: 'arrow', label: '화살표' },
  { id: 'rect', label: '사각형 강조' },
  { id: 'ellipse', label: '원형 강조' },
  { id: 'bubble', label: '말풍선' },
  { id: 'emoji', label: '이모지 스티커' },
];

export const SHAPE_EMOJIS = ['👉', '🔥', '⭐', '❤️', '😂', '✅', '❗', '🎉'];

export function shapeKindById(id) {
  return SHAPE_KINDS.find((item) => item.id === id) || SHAPE_KINDS[0];
}

/** 필터 프리셋 — 밝기(0.5~1.5) · 대비(0.5~1.5) · 채도(0~2) 배율. */
export const FILTER_PRESETS = [
  { id: 'none', label: '원본', brightness: 1, contrast: 1, saturation: 1 },
  { id: 'bright', label: '밝게', brightness: 1.12, contrast: 1.02, saturation: 1.02 },
  { id: 'warm', label: '따뜻하게', brightness: 1.04, contrast: 1.04, saturation: 1.18 },
  { id: 'cool', label: '차갑게', brightness: 1.0, contrast: 1.06, saturation: 0.88 },
  { id: 'cinema', label: '시네마', brightness: 0.96, contrast: 1.18, saturation: 0.92 },
  { id: 'mono', label: '흑백', brightness: 1.02, contrast: 1.1, saturation: 0 },
  { id: 'vivid', label: '선명하게', brightness: 1.04, contrast: 1.12, saturation: 1.35 },
  { id: 'fade', label: '옅게', brightness: 1.08, contrast: 0.92, saturation: 0.82 },
];

/** 자막 글꼴 — Mac 은 시스템 글꼴 파일을 찾아 쓰고, 없으면 앱에 담은 Pretendard 로 그린다. */
export const FONTS = [
  { id: 'pretendard', label: 'Pretendard', family: 'Pretendard', file: null },
  { id: 'helvetica', label: 'Helvetica', family: 'Helvetica', file: '/System/Library/Fonts/Helvetica.ttc' },
  { id: 'helvetica-neue', label: 'Helvetica Neue', family: '"Helvetica Neue"', file: '/System/Library/Fonts/HelveticaNeue.ttc' },
  { id: 'arial', label: 'Arial', family: 'Arial', file: '/System/Library/Fonts/Supplemental/Arial.ttf' },
  { id: 'georgia', label: 'Georgia', family: 'Georgia', file: '/System/Library/Fonts/Supplemental/Georgia.ttf' },
  { id: 'impact', label: 'Impact', family: 'Impact', file: '/System/Library/Fonts/Supplemental/Impact.ttf' },
  { id: 'apple-gothic', label: 'AppleGothic', family: 'AppleGothic', file: '/System/Library/Fonts/Supplemental/AppleGothic.ttf' },
  { id: 'menlo', label: 'Menlo', family: 'Menlo', file: '/System/Library/Fonts/Menlo.ttc' },
];

export function fontById(id) {
  return FONTS.find((item) => item.id === id) || FONTS[0];
}

/**
 * 자막 스타일 프리셋 5종 — 원클릭으로 글꼴·크기·색·외곽선·배경·세로 위치·등장 애니메이션을
 * 한꺼번에 바꾼다. 값은 1080p 기준 픽셀(미리보기는 캔버스 높이에 맞춰 줄여 그린다).
 */
export const SUBTITLE_PRESETS = [
  {
    id: 'basic', label: '기본',
    size: 54, color: '#FFFFFF', outlineColor: '#000000', outlineWidth: 3,
    background: 0.35, y: 0.82, animation: 'none', font: 'pretendard',
  },
  {
    id: 'variety', label: '예능',
    size: 62, color: '#FFE24A', outlineColor: '#141414', outlineWidth: 5,
    background: 0, y: 0.76, animation: 'pop', font: 'pretendard',
  },
  {
    id: 'shorts', label: '쇼츠 강조',
    size: 72, color: '#FFFFFF', outlineColor: '#1A1A1A', outlineWidth: 6,
    background: 0, y: 0.64, animation: 'pop', font: 'pretendard',
  },
  {
    id: 'docu', label: '다큐',
    size: 40, color: '#F2F2F2', outlineColor: '#000000', outlineWidth: 0,
    background: 0.18, y: 0.9, animation: 'fade', font: 'pretendard',
  },
  {
    id: 'neon', label: '네온',
    size: 58, color: '#8BF7E4', outlineColor: '#0A3F44', outlineWidth: 6,
    background: 0, y: 0.8, animation: 'fade', font: 'pretendard',
  },
];

export function subtitlePresetById(id) {
  return SUBTITLE_PRESETS.find((item) => item.id === id) || SUBTITLE_PRESETS[0];
}

/** 자막 등장 애니메이션 — 미리보기(Canvas)와 내보내기(drawtext alpha·y·fontsize)가 같은 값을 쓴다. */
export const SUBTITLE_ANIMATIONS = [
  { id: 'none', label: '없음' },
  { id: 'fade', label: '페이드 인' },
  { id: 'pop', label: '팝' },
  { id: 'slideup', label: '아래서 위로' },
];

/** 애니메이션 길이(초) — 세 종류가 같은 값을 쓴다. */
export const ANIMATION_SECONDS = 0.3;
export const FADE_SECONDS = 0.25;

/** 클립 줌/팬 — 프리셋을 고르면 시작·끝 배율과 중심점이 함께 채워진다. */
export const MOTIONS = [
  { id: 'none', label: '없음', startScale: 1, endScale: 1, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 },
  { id: 'zoomin', label: '줌인', startScale: 1, endScale: 1.22, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 },
  { id: 'zoomout', label: '줌아웃', startScale: 1.22, endScale: 1, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 },
  { id: 'panright', label: '좌→우 팬', startScale: 1.18, endScale: 1.18, startX: 0.36, startY: 0.5, endX: 0.64, endY: 0.5 },
  { id: 'panleft', label: '우→좌 팬', startScale: 1.18, endScale: 1.18, startX: 0.64, startY: 0.5, endX: 0.36, endY: 0.5 },
  { id: 'custom', label: '직접 설정', startScale: 1, endScale: 1.1, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 },
];

export function motionById(id) {
  return MOTIONS.find((item) => item.id === id) || MOTIONS[0];
}

/** 클립 기본 줌/팬 — 없음. */
export function createMotion() {
  return { kind: 'none', startScale: 1, endScale: 1, startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 };
}

/** 프리셋을 클립 motion 에 채운다(값을 복사해 두어 내보내기가 그대로 쓸 수 있게). */
export function applyMotionPreset(motion, id) {
  const preset = motionById(id);
  const next = {
    kind: preset.id,
    startScale: preset.startScale,
    endScale: preset.endScale,
    startX: preset.startX,
    startY: preset.startY,
    endX: preset.endX,
    endY: preset.endY,
  };
  if (motion && typeof motion === 'object') Object.assign(motion, next);
  return next;
}

/** 진행률(0~1)에서의 배율·중심 — 없음이면 그대로. */
export function motionAt(motion, progress) {
  const start = motion || createMotion();
  if (!start.kind || start.kind === 'none') return { scale: 1, cx: 0.5, cy: 0.5 };
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  const scale = Number(start.startScale || 1) + (Number(start.endScale || 1) - Number(start.startScale || 1)) * t;
  const cx = Number(start.startX ?? 0.5) + (Number(start.endX ?? 0.5) - Number(start.startX ?? 0.5)) * t;
  const cy = Number(start.startY ?? 0.5) + (Number(start.endY ?? 0.5) - Number(start.startY ?? 0.5)) * t;
  return { scale: Math.max(1, scale), cx: Math.min(1, Math.max(0, cx)), cy: Math.min(1, Math.max(0, cy)) };
}

let counter = 0;
export function newId(prefix = 'id') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** 프로젝트 기본값. */
export function createProject() {
  return {
    aspect: '16:9',
    clips: [],
    subtitles: [],
    audios: [],
    overlays: [],
    masks: [],
    shapes: [],
  };
}

/** 부분 모자이크/블러 기본값 — 플레이헤드 위치에 30%×20% 크기로. */
export function createMask(kind, start, end) {
  return {
    id: newId('mask'),
    kind: kind === 'blur' ? 'blur' : 'mosaic',
    shape: 'rect',
    x: 0.5,
    y: 0.5,
    w: 0.3,
    h: 0.2,
    strength: 0.5,
    start,
    end,
  };
}

/** 도형·말풍선·이모지 기본값 — x·y·w·h 는 화면 비율(0~1). */
export function createShape(kind, start, end, text) {
  const base = {
    id: newId('shape'),
    kind,
    x: 0.5,
    y: 0.45,
    w: 0.22,
    h: 0.16,
    rotation: 0,
    opacity: 1,
    color: '#FFE24A',
    stroke: 0.012,
    text: text || '👉',
    start,
    end,
  };
  if (kind === 'arrow') { base.w = 0.24; base.h = 0.14; }
  if (kind === 'rect' || kind === 'ellipse') { base.w = 0.3; base.h = 0.2; }
  if (kind === 'bubble') { base.w = 0.34; base.h = 0.18; base.color = '#FFFFFF'; }
  if (kind === 'emoji') { base.w = 0.16; base.h = 0.16; }
  return base;
}

/** 자막 기본 스타일 — 1080p 기준 픽셀. 화면에서는 캔버스 높이에 맞춰 줄여 그린다. */
export function createSubtitle(text, start, end) {
  return {
    id: newId('sub'),
    text,
    start,
    end,
    font: 'pretendard',
    fontFile: null,
    fontLabel: 'Pretendard',
    size: 54,
    color: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 3,
    background: 0.35,
    preset: 'basic',
    animation: 'none',
    align: 'center',
    lineHeight: 1.28,
    x: 0.5,
    y: 0.82,
  };
}

/** 새 클립의 화면 설정 기본값 — 맞춤·회전·반전·음소거·역재생·색감·오디오 효과. */
export function createClipLook() {
  return {
    fit: 'fit',
    rotate: 0,
    flipH: false,
    flipV: false,
    muted: false,
    reverse: false,
    denoise: 'off',
    voice: 'original',
    color: { ...COLOR_DEFAULTS },
  };
}

/**
 * 클립 안에서의 원본 시각 — 역재생이면 뒤에서부터 센다.
 * 화면 미리보기와 ffmpeg(reverse)가 같은 프레임을 가리키게 하는 식이다.
 */
export function localTimeOf(clip, start, elapsed) {
  const speed = clip.kind === 'image' ? 1 : Math.max(SPEED_MIN, Number(clip.speed) || 1);
  const trimStart = Number(clip.trimStart) || 0;
  const trimEnd = Number(clip.trimEnd) || trimStart;
  const span = Math.max(0, (elapsed - (Number(start) || 0)) * speed);
  if (clip.reverse && clip.kind !== 'image') {
    return Math.max(trimStart, trimEnd - span);
  }
  return Math.min(trimEnd, trimStart + span);
}

/** 오버레이(PIP) 기본값 — x·y 는 화면 안 중심 비율, scale 은 출력 폭 대비 비율. */
export function createOverlay(mediaId, name, kind, start, end) {
  return {
    id: newId('ov'),
    mediaId,
    name,
    kind,
    start,
    end,
    x: 0.5,
    y: 0.5,
    scale: 0.32,
    opacity: 1,
  };
}

/** 클립의 타임라인 길이(초) — 배속을 반영한다. */
export function clipDuration(clip) {
  const span = Math.max(0.05, Number(clip.trimEnd) - Number(clip.trimStart));
  if (clip.kind === 'image') return span;
  const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(clip.speed) || 1));
  return span / speed;
}

/** 경계 전환의 실제 겹침 — 양쪽 클립 길이의 절반을 넘지 않고, 최소 0.04초. */
export function boundaryDuration(clip, previous) {
  const asked = Number(clip.transition && clip.transition.duration) || 0;
  const want = asked > 0 ? asked : CUT;
  return Math.max(CUT, Math.min(want, previous * 0.5, clipDuration(clip) * 0.5));
}

/**
 * 클립 배치 — [{ start, end, duration, transition }].
 * 첫 클립의 start 는 0, 다음 클립의 start 는 앞 클립 end 에서 겹침만큼 당긴 값이다.
 */
export function layout(clips) {
  const out = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    const duration = clipDuration(clip);
    let start = cursor;
    let transition = null;
    if (index > 0) {
      const previous = clipDuration(clips[index - 1]);
      const overlap = boundaryDuration(clip, previous);
      start = Math.max(0, cursor - overlap);
      transition = {
        kind: (clip.transition && clip.transition.kind) || 'fade',
        duration: overlap,
        hidden: !(Number(clip.transition && clip.transition.duration) > 0),
      };
    }
    out.push({ start, end: start + duration, duration, transition });
    cursor = start + duration;
  });
  return out;
}

export function totalDuration(clips) {
  const items = layout(clips);
  return items.length ? items[items.length - 1].end : 0;
}

/**
 * t 시각에 보이는 그림 — [{ index, sourceTime, alpha, ... }] 를 돌려준다.
 * 전환 구간이면 앞 클립과 뒤 클립이 함께 나온다.
 */
export function frameAt(clips, t) {
  const items = layout(clips);
  if (!items.length) return null;
  const time = Math.max(0, Math.min(t, items[items.length - 1].end));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (time >= item.start && time < item.end) {
      const clip = clips[index];
      const next = items[index + 1];
      if (next && next.transition && time >= next.start) {
        const progress = Math.min(1, (time - next.start) / Math.max(0.001, next.transition.duration));
        return {
          kind: 'transition',
          from: { index, local: (time - item.start) * (clip.kind === 'image' ? 1 : (Number(clip.speed) || 1)) + Number(clip.trimStart) },
          to: {
            index: index + 1,
            local: (time - next.start) * (clips[index + 1].kind === 'image' ? 1 : (Number(clips[index + 1].speed) || 1)) + Number(clips[index + 1].trimStart),
          },
          transition: next.transition,
          progress,
        };
      }
      const speed = clip.kind === 'image' ? 1 : (Number(clip.speed) || 1);
      return {
        kind: 'single',
        index,
        local: (time - item.start) * speed + Number(clip.trimStart),
        progress: 0,
        /** 클립 안에서의 진행률(0~1) — 줌/팬 보간에 쓴다. */
        ratio: Math.min(1, Math.max(0, (time - item.start) / Math.max(0.001, item.duration))),
      };
    }
  }
  const last = items.length - 1;
  const clip = clips[last];
  return {
    kind: 'single',
    index: last,
    local: Number(clip.trimEnd),
    progress: 0,
    ratio: 1,
  };
}

/** 타임라인의 t 에 있는 클립 index — 선택·분할에 쓴다. */
export function indexAt(clips, t) {
  const items = layout(clips);
  for (let index = 0; index < items.length; index += 1) {
    if (t >= items[index].start && t < items[index].end) return index;
  }
  return items.length ? items.length - 1 : -1;
}

/** 출력 해상도 — 비율과 높이로 정하고 짝수로 맞춘다(인코더 제약). */
export function outputSize(aspectId, height) {
  const aspect = (ASPECTS.find((item) => item.id === aspectId) || ASPECTS[0]).value;
  const h = Math.round(height);
  let w = Math.round(h * aspect);
  if (w % 2) w += 1;
  return { width: w, height: h % 2 ? h + 1 : h };
}

/** 00:00.0 꼴 타임코드. */
export function timecode(seconds, withTenths = true) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  const whole = Math.floor(rest);
  const tenths = Math.floor((rest - whole) * 10);
  const base = `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}`;
  return withTenths ? `${base}.${tenths}` : base;
}

/** 화면 문구용 — 3.4초 / 1분 12초. */
export function friendlyDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${value.toFixed(1)}초`;
  const minutes = Math.floor(value / 60);
  const rest = Math.round(value - minutes * 60);
  return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
}

/* ------------------------------ 무음 구간 자동 컷 ------------------------------ */

/**
 * 원본(소스) 시각의 무음 구간을 타임라인 시각으로 옮긴다.
 * 클립의 자르기 구간 밖은 버리고, 배속이 있으면 그만큼 나눈다(내보내기의 atempo 와 같은 뜻).
 */
export function mapSilence(clip, item, silence) {
  if (!clip || !item || !silence) return null;
  const speed = clip.kind === 'image' ? 1 : Math.max(SPEED_MIN, Number(clip.speed) || 1);
  const trimStart = Number(clip.trimStart) || 0;
  const trimEnd = Number(clip.trimEnd) || trimStart;
  const from = Math.max(trimStart, Math.min(trimEnd, Number(silence.start) || 0));
  const to = Math.min(trimEnd, Math.max(trimStart, Number(silence.end) || 0));
  if (to - from < 0.05) return null;
  return {
    start: (Number(item.start) || 0) + (from - trimStart) / speed,
    end: (Number(item.start) || 0) + (to - trimStart) / speed,
  };
}

/**
 * 무음을 빼고 클립을 다시 만든다 — 잘라 낸 조각마다 trimStart/trimEnd 를 옮긴다.
 * ranges 는 { [clipId]: [{ start, end }] } (타임라인 초). ⌘Z 한 번으로 되돌리도록 배열만 돌려준다.
 */
export function cutSilence(clips, ranges) {
  const out = [];
  let removed = 0;
  let pieces = 0;
  clips.forEach((clip, index) => {
    const items = layout(clips);
    const item = items[index];
    const spans = (ranges[clip.id] || [])
      .map((range) => ({
        start: Math.max(item.start, Number(range.start) || 0),
        end: Math.min(item.end, Number(range.end) || 0),
      }))
      .filter((range) => range.end - range.start > 0.02)
      .sort((a, b) => a.start - b.start);
    if (!spans.length) { out.push(clip); return; }

    const speed = clip.kind === 'image' ? 1 : Math.max(SPEED_MIN, Number(clip.speed) || 1);
    const trimStart = Number(clip.trimStart) || 0;
    const keep = [];
    let cursor = item.start;
    spans.forEach((span) => {
      if (span.start - cursor > 0.05) keep.push({ from: cursor, to: span.start });
      cursor = Math.max(cursor, span.end);
      removed += span.end - span.start;
    });
    if (item.end - cursor > 0.05) keep.push({ from: cursor, to: item.end });
    if (!keep.length) { pieces += 1; return; }

    keep.forEach((part, partIndex) => {
      const piece = JSON.parse(JSON.stringify(clip));
      if (partIndex > 0) piece.id = newId('clip');
      piece.trimStart = trimStart + (part.from - item.start) * speed;
      piece.trimEnd = trimStart + (part.to - item.start) * speed;
      if (partIndex > 0) piece.transition = { kind: (clip.transition && clip.transition.kind) || 'fade', duration: 0 };
      if (partIndex === 0) {
        // 첫 조각만 원래 앞 경계의 전환을 그대로 쓴다.
        piece.transition = clip.transition ? { ...clip.transition } : null;
      }
      out.push(piece);
      pieces += 1;
    });
  });
  return { clips: out, removed, pieces };
}

/* ------------------------------ 자막 스타일 ------------------------------ */

/** 자막의 '스타일'만 뽑는다 — 복사·붙여넣기와 일괄 적용이 글자·시간은 건드리지 않게. */
export function subtitleStyle(subtitle) {
  return {
    align: subtitle.align || 'center',
    lineHeight: Number(subtitle.lineHeight) || 1.28,
    font: subtitle.font,
    fontFile: subtitle.fontFile || null,
    fontLabel: subtitle.fontLabel || fontById(subtitle.font).label,
    size: subtitle.size,
    color: subtitle.color,
    outlineColor: subtitle.outlineColor,
    outlineWidth: subtitle.outlineWidth,
    background: subtitle.background,
    preset: subtitle.preset || 'basic',
    animation: subtitle.animation || 'none',
    y: subtitle.y,
  };
}

/**
 * 스타일을 자막에 입힌다. 위치 x 는 자막마다 다를 수 있어 그대로 둔다(요청: y 까지 일괄).
 */
export function applySubtitleStyle(subtitle, style) {
  subtitle.align = style.align || subtitle.align || 'center';
  subtitle.lineHeight = Number(style.lineHeight) || Number(subtitle.lineHeight) || 1.28;
  subtitle.font = style.font;
  subtitle.fontFile = style.fontFile || null;
  subtitle.fontLabel = style.fontLabel || fontById(style.font).label;
  subtitle.size = style.size;
  subtitle.color = style.color;
  subtitle.outlineColor = style.outlineColor;
  subtitle.outlineWidth = style.outlineWidth;
  subtitle.background = style.background;
  subtitle.preset = style.preset || 'basic';
  subtitle.animation = style.animation || 'none';
  subtitle.y = style.y;
  return subtitle;
}

/** 프리셋 하나를 자막에 — 글꼴·크기·색·외곽선·배경·세로 위치·애니메이션을 함께 바꾼다. */
export function applySubtitlePreset(subtitle, presetId) {
  const preset = subtitlePresetById(presetId);
  subtitle.font = preset.font;
  subtitle.fontFile = null;
  subtitle.fontLabel = fontById(preset.font).label;
  subtitle.size = preset.size;
  subtitle.color = preset.color;
  subtitle.outlineColor = preset.outlineColor;
  subtitle.outlineWidth = preset.outlineWidth;
  subtitle.background = preset.background;
  subtitle.y = preset.y;
  subtitle.animation = preset.animation;
  subtitle.preset = preset.id;
  return subtitle;
}

/** 어떤 프리셋과 같은 모양인지 — 없으면 null. */
export function matchSubtitlePreset(subtitle) {
  const found = SUBTITLE_PRESETS.find((preset) => preset.id === subtitle.preset
    && Math.abs(Number(subtitle.size) - preset.size) < 0.5
    && String(subtitle.color).toUpperCase() === preset.color.toUpperCase());
  return found ? found.id : null;
}

/**
 * 등장 애니메이션의 한 순간 — { alpha, scale, offsetY } (offsetY 는 1080p 기준 픽셀).
 * 내보내기의 drawtext 가 쓰는 식과 같은 모양이다.
 */
export function animationAt(animation, local, size) {
  const t = Math.max(0, Number(local) || 0);
  switch (animation) {
    case 'fade': {
      const alpha = Math.min(1, t / FADE_SECONDS);
      return { alpha, scale: 1, offsetY: 0 };
    }
    case 'pop': {
      const p = Math.min(1, t / ANIMATION_SECONDS);
      const eased = 1 - Math.pow(1 - p, 3);
      return { alpha: Math.min(1, t / 0.12), scale: 0.86 + 0.14 * eased, offsetY: 0 };
    }
    case 'slideup': {
      const p = Math.min(1, t / ANIMATION_SECONDS);
      const eased = 1 - Math.pow(1 - p, 3);
      return { alpha: Math.min(1, t / FADE_SECONDS), scale: 1, offsetY: (1 - eased) * (Number(size) || 54) * 0.5 };
    }
    default:
      return { alpha: 1, scale: 1, offsetY: 0 };
  }
}

/* ------------------------------ 복제 ------------------------------ */

/** 클립의 '포맷'만 뽑는다 — 필터·배속·볼륨·페이드·줌/팬. 소스와 트림 구간은 건드리지 않는다. */
export function clipFormat(clip) {
  return {
    speed: Number(clip.speed) || 1,
    volume: Number(clip.volume) || 1,
    fadeIn: Number(clip.fadeIn) || 0,
    fadeOut: Number(clip.fadeOut) || 0,
    filter: {
      brightness: Number(clip.filter && clip.filter.brightness) || 1,
      contrast: Number(clip.filter && clip.filter.contrast) || 1,
      saturation: clip.filter && clip.filter.saturation === undefined ? 1 : Number(clip.filter.saturation),
    },
    color: JSON.parse(JSON.stringify({ ...COLOR_DEFAULTS, ...(clip.color || {}) })),
    fit: clip.fit || 'fit',
    rotate: Number(clip.rotate) || 0,
    flipH: !!clip.flipH,
    flipV: !!clip.flipV,
    denoise: clip.denoise || 'off',
    voice: clip.voice || 'original',
    motion: JSON.parse(JSON.stringify(clip.motion || createMotion())),
  };
}

export function applyClipFormat(clip, format) {
  clip.speed = format.speed;
  clip.volume = format.volume;
  clip.fadeIn = format.fadeIn;
  clip.fadeOut = format.fadeOut;
  clip.filter = { ...format.filter };
  clip.color = JSON.parse(JSON.stringify({ ...COLOR_DEFAULTS, ...(format.color || {}) }));
  clip.fit = format.fit || 'fit';
  clip.rotate = Number(format.rotate) || 0;
  clip.flipH = !!format.flipH;
  clip.flipV = !!format.flipV;
  clip.denoise = format.denoise || 'off';
  clip.voice = format.voice || 'original';
  clip.motion = JSON.parse(JSON.stringify(format.motion));
  return clip;
}

const clone = (item) => JSON.parse(JSON.stringify(item));

/** 자막 복제 — 스타일 그대로, 시작 시각만 옮긴다. */
export function cloneSubtitle(subtitle, start) {
  const span = Math.max(0.2, Number(subtitle.end) - Number(subtitle.start));
  return {
    ...clone(subtitle),
    id: newId('sub'),
    start,
    end: start + span,
  };
}

/** 클립 복제 — 트림·배속·필터·줌/팬 그대로. */
export function cloneClip(clip) {
  return { ...clone(clip), id: newId('clip') };
}

/** 오디오 복제. */
export function cloneAudio(audio, start) {
  return { ...clone(audio), id: newId('audio'), start };
}

/** 오버레이 복제. */
export function cloneOverlay(overlay, start) {
  const span = Math.max(0.2, Number(overlay.end) - Number(overlay.start));
  return { ...clone(overlay), id: newId('ov'), start, end: start + span };
}

/** 모자이크/블러 영역 복제. */
export function cloneMask(mask, start) {
  const span = Math.max(0.2, Number(mask.end) - Number(mask.start));
  return { ...clone(mask), id: newId('mask'), start, end: start + span };
}

/** 도형·스티커 복제. */
export function cloneShape(shape, start) {
  const span = Math.max(0.2, Number(shape.end) - Number(shape.start));
  return { ...clone(shape), id: newId('shape'), start, end: start + span };
}

/* ------------------------------ 자석 스냅 ------------------------------ */

/**
 * 자석 스냅 후보 시각 — 클립 경계, 자막·오디오·오버레이의 시작·끝, 플레이헤드.
 * excludeId 를 주면 그 항목 자신은 뺀다(끌고 있는 것이 자기 끝에 붙지 않게).
 */
export function snapTargets(project, playhead, excludeId) {
  const out = [];
  const push = (value) => {
    const time = Number(value);
    if (Number.isFinite(time) && time >= 0) out.push(time);
  };
  layout(project.clips || []).forEach((item) => {
    push(item.start);
    push(item.end);
  });
  (project.subtitles || []).forEach((item) => {
    if (item.id === excludeId) return;
    push(item.start);
    push(item.end);
  });
  (project.audios || []).forEach((item) => {
    if (item.id === excludeId) return;
    push(item.start);
    push(item.start + Number(item.duration || 0));
  });
  (project.overlays || []).forEach((item) => {
    if (item.id === excludeId) return;
    push(item.start);
    push(item.end);
  });
  (project.masks || []).forEach((item) => {
    if (item.id === excludeId) return;
    push(item.start);
    push(item.end);
  });
  (project.shapes || []).forEach((item) => {
    if (item.id === excludeId) return;
    push(item.start);
    push(item.end);
  });
  push(playhead);
  return out;
}

/**
 * value 를 후보 중 tolerance 안에서 가장 가까운 시각으로 붙인다.
 * 붙지 않으면 value 그대로. 붙었는지는 returned.snapped 로 알린다.
 */
export function snapTime(value, targets, tolerance) {
  let best = null;
  for (const target of targets || []) {
    const distance = Math.abs(Number(value) - target);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { distance, value: target };
  }
  if (best) return { value: best.value, snapped: true };
  return { value, snapped: false };
}

/** 시작·끝 중 더 가까운 쪽을 붙인다 — 자막·오버레이를 끌 때 쓴다. */
export function snapRange(start, end, targets, tolerance) {
  const left = snapTime(start, targets, tolerance);
  const right = snapTime(end, targets, tolerance);
  if (left.snapped && right.snapped) {
    return Math.abs(start - left.value) <= Math.abs(end - right.value)
      ? { start: left.value, end: left.value + (end - start), snapped: left.value }
      : { start: start - (right.value - end), end: right.value, snapped: right.value };
  }
  if (left.snapped) return { start: left.value, end: left.value + (end - start), snapped: left.value };
  if (right.snapped) return { start: start - (right.value - end), end: right.value, snapped: right.value };
  return { start, end, snapped: null };
}

/**
 * 겹치지 않는 자리를 찾는다 — 원하는 시각에 이미 무언가 있으면 그 뒤로 밀어 붙인다.
 * items 는 [{ start, end }] (자막·오버레이·오디오 공통).
 */
export function freeSpan(items, wanted, span, max) {
  let start = Math.max(0, Number(wanted) || 0);
  const list = (items || [])
    .map((item) => ({ start: Number(item.start) || 0, end: Number(item.end) || 0 }))
    .sort((a, b) => a.start - b.start);
  let moved = true;
  let guard = 0;
  while (moved && guard < 200) {
    moved = false;
    guard += 1;
    for (const item of list) {
      if (start < item.end - 0.001 && start + span > item.start + 0.001) {
        start = item.end;
        moved = true;
      }
    }
  }
  if (max && start + span > max) {
    // 끝을 넘으면 마지막 항목 뒤로 — 그래도 넘으면 있는 그대로 둔다.
    const last = list.length ? list[list.length - 1].end : 0;
    start = Math.max(0, last);
  }
  return start;
}

/** 오버레이·자막이 t 에 보이는지. */
export function isVisibleAt(item, t) {
  return t >= Number(item.start) - 0.001 && t < Number(item.end);
}
