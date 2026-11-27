/**
 * TIP · 영상 편집 모델 (v1.23.0)
 *
 * 화면(module.js)과 계산을 나눠 둔다 — 타임라인 배치·전환 겹침·시간 계산이 한곳에 모여야
 * 미리보기와 내보내기의 시각이 어긋나지 않는다.
 *
 * 규칙
 *  · 클립은 이어 붙인다. 경계의 전환은 앞 클립의 끝과 뒤 클립의 시작이 겹치는 시간이다.
 *  · 전환이 없는 경계도 아주 짧은(0.04초) 페이드로 붙인다 — 내보내기의 xfade 가 모든 경계를
 *    같은 방식으로 처리하므로, 화면도 같은 값을 써야 자막 시각이 밀리지 않는다.
 *  · 길이는 모두 초(실수)다.
 */

/** 전환이 없는 경계에 쓰는 겹침 — 한 프레임 남짓(내보내기의 xfade 와 같은 값). */
export const CUT = 0.04;

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
  };
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
    x: 0.5,
    y: 0.82,
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
