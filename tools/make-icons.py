#!/usr/bin/env python3
"""TIP 앱 아이콘 생성 (PWA · iOS 홈 화면 · 파비콘).

아이콘 원본(마스터)은 `icons/icon-1024.png` 한 장이다.
이 스크립트는 마스터에서 필요한 사이즈를 모두 파생시킨다.

    python3 tools/make-icons.py                     # 마스터에서 파생만 다시 만들기
    python3 tools/make-icons.py --source 원본.png   # 새 시안 원본 → 마스터(1024)까지 생성

규칙
- 배경은 팩인백 브랜드 딥그린 #2E5E4E 로 맞춘다. 생성형 원본은 배경이
  #355F50 근처로 살짝 뜨므로, 초록 영역만 브랜드 값으로 되돌린다(그림자·광은 유지).
- maskable 아이콘은 안전 영역(가운데 원 지름 80%) 안에 그림이 들어오도록
  마스터를 가운데에서 80% 잘라 쓴다. 배경이 꽉 찬 단색이라 잘라도 티가 나지 않는다.
- apple-touch-icon 은 iOS 가 알파를 싫어하므로 RGB(불투명)로 저장한다.
"""
from pathlib import Path
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
MASTER = ICONS / "icon-1024.png"

BRAND = (46, 94, 78)          # #2E5E4E
GENERATED_BASE = (53, 95, 80)  # 생성형 원본의 배경색(#355F50 근처)


def normalize_background(im: Image.Image) -> Image.Image:
    """초록 배경을 브랜드 딥그린으로 되돌린다(흰 팩·회색 그림자는 그대로)."""
    arr = np.asarray(im.convert("RGB")).astype(np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    # 초록 기운이 있는 픽셀만(배경·배경 위 그림자) 골라 부드러운 마스크를 만든다
    a = np.clip(np.minimum(g - r - 6.0, g - b - 4.0) / 6.0, 0.0, 1.0)
    ratio = np.array([BRAND[i] / GENERATED_BASE[i] for i in range(3)], dtype=np.float32)
    tinted = arr * ratio
    out = arr * (1 - a[..., None]) + tinted * a[..., None]
    # 마지막 보정: 바탕(가장자리 띠)의 중간값이 정확히 브랜드 값이 되게 맞춘다
    ring = np.concatenate([out[:40].reshape(-1, 3), out[-40:].reshape(-1, 3),
                           out[:, :40].reshape(-1, 3), out[:, -40:].reshape(-1, 3)])
    residual = np.array(BRAND, dtype=np.float32) - np.median(ring, axis=0)
    out = out + residual * a[..., None]
    return Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8), "RGB")


def save(im: Image.Image, size: int, name: str, *, opaque: bool = False) -> None:
    out = im.resize((size, size), Image.LANCZOS)
    if opaque:
        out = out.convert("RGB")
    else:
        out = out.convert("RGBA")
    out.save(ICONS / name, optimize=True)
    print(f"  {name:28s} {size}x{size}")


def center_crop_zoom(im: Image.Image, keep: float) -> Image.Image:
    """가운데 기준으로 keep 비율만큼 남기고 확대한다(1.0 = 원본 그대로)."""
    if keep >= 1.0:
        return im
    w, h = im.size
    side = int(round(min(w, h) * keep))
    left = (w - side) // 2
    top = (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def main() -> int:
    if "--source" in sys.argv:
        src_path = Path(sys.argv[sys.argv.index("--source") + 1]).resolve()
        src = normalize_background(Image.open(src_path))
        ICONS.mkdir(exist_ok=True)
        src.resize((1024, 1024), Image.LANCZOS).save(MASTER, optimize=True)
        print(f"마스터 생성: icons/icon-1024.png (원본 {src_path.name})")

    master = Image.open(MASTER).convert("RGB")
    print("아이콘 생성:")

    save(master, 512, "icon-512.png")
    save(center_crop_zoom(master, 0.80), 512, "icon-maskable-512.png")
    save(master, 192, "icon-192.png")
    save(master, 180, "apple-touch-icon-180.png", opaque=True)
    save(master, 64, "favicon.png")
    save(master, 32, "favicon-32.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
