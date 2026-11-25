/* TIP · 모자이크(픽셀화) 공용 코드 (v1.16.0)
 *
 * 사진 모자이크(photo-privacy)와 스크린샷 표시(screenshot-annotate)가 같이 쓴다.
 * 캔버스 밖으로 나가지 않게 영역을 자르고, 영역을 작게 줄였다가 확대해 픽셀 블록으로 만든다.
 */

export function clampRect(x, y, w, h, maxW, maxH) {
  const left = Math.max(0, Math.min(Math.floor(x), maxW - 1));
  const top = Math.max(0, Math.min(Math.floor(y), maxH - 1));
  const right = Math.max(left + 1, Math.min(Math.ceil(x + w), maxW));
  const bottom = Math.max(top + 1, Math.min(Math.ceil(y + h), maxH));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** 모자이크(픽셀화) — 영역을 작게 줄였다가 확대해 픽셀 블록으로 만든다. */
export function pixelate(ctx, scratch, canvas, rect, block) {
  const area = clampRect(rect.x, rect.y, rect.w, rect.h, canvas.width, canvas.height);
  const size = Math.max(2, Math.round(block));
  const bw = Math.max(1, Math.ceil(area.w / size));
  const bh = Math.max(1, Math.ceil(area.h / size));
  if (scratch.width !== bw || scratch.height !== bh) {
    scratch.width = bw;
    scratch.height = bh;
  }
  const sctx = scratch.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.clearRect(0, 0, bw, bh);
  sctx.drawImage(canvas, area.x, area.y, area.w, area.h, 0, 0, bw, bh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, bw, bh, area.x, area.y, bw * size, bh * size);
  ctx.imageSmoothingEnabled = true;
}
