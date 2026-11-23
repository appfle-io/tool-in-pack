#!/usr/bin/env python3
"""TIP Mac 앱 아이콘 생성 — macOS .icns + 메뉴 막대(트레이) 아이콘.

    python3 tools/make-mac-icons.py

- `icons/icon-1024.png`(마스터)에서 macOS 번들용 `mac/src-tauri/icons/icon.icns` 와
  `tauri::generate_context!` 가 요구하는 기본 창 아이콘 `icon.png` 를 만든다.
- 메뉴 막대 아이콘은 v1.10.0 부터 **PWA 앱 아이콘과 같은 색 그대로**(`tray-icon.png`, 44×44)를 쓴다.
  `icon_as_template(false)` 로 두어야 macOS 가 흑백 실루엣으로 바꾸지 않는다.
  (이전 흑백 템플릿 `trayTemplate*.png` 도 계속 만들어 두지만 지금은 쓰지 않는다.)
- 결과물은 커밋한다(빌드 도구 없이 `tauri build` 가 바로 쓰도록).
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "icons" / "icon-1024.png"
OUT = ROOT / "mac" / "src-tauri" / "icons"

# icns 안에 넣을 (타입, 픽셀 크기) — macOS 가 해상도별로 골라 쓴다.
ICNS_SIZES = [
    (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
    (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
    (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512),
]


def build_icns(master: Image.Image, dest: Path) -> None:
    entries = []
    for kind, size in ICNS_SIZES:
        img = master.resize((size, size), Image.LANCZOS)
        tmp = dest.with_suffix(f".{size}.png")
        img.save(tmp, format="PNG")
        data = tmp.read_bytes()
        tmp.unlink()
        entries.append((kind, data))

    body = b"".join(kind + (len(data) + 8).to_bytes(4, "big") + data for kind, data in entries)
    dest.write_bytes(b"icns" + (len(body) + 8).to_bytes(4, "big") + body)


def rounded(draw: ImageDraw.ImageDraw, box, radius: int, fill) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def build_tray(size: int, dest: Path) -> None:
    """메뉴 막대용 모노크롬 마크 — 바깥 라운드 사각형 + 안쪽 2×2 모듈 그리드."""
    scale = 8                      # 크게 그린 뒤 줄여서 가장자리를 부드럽게 만든다
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    stroke = max(2, round(s * 0.075))
    pad = round(s * 0.09)
    rounded(d, (pad, pad, s - pad, s - pad), round(s * 0.24), (0, 0, 0, 255))
    # 안쪽을 비워 테두리만 남긴다.
    rounded(
        d,
        (pad + stroke, pad + stroke, s - pad - stroke, s - pad - stroke),
        round(s * 0.17),
        (0, 0, 0, 0),
    )

    # 2×2 모듈 그리드
    cell = round(s * 0.13)
    gap = round(s * 0.055)
    total = cell * 2 + gap
    start = (s - total) // 2
    for row in range(2):
        for col in range(2):
            x = start + col * (cell + gap)
            y = start + row * (cell + gap)
            rounded(d, (x, y, x + cell, y + cell), max(1, round(cell * 0.28)), (0, 0, 0, 255))

    img = img.resize((size, size), Image.LANCZOS)
    img.save(dest, format="PNG")


def build_tray_color(master: Image.Image, dest: Path, size: int = 44, inset: int = 2) -> None:
    """PWA 앱 아이콘과 같은 색의 메뉴 막대 아이콘 — 라운드 사각형으로 다듬어 투명 여백과 함께 저장.

    macOS 는 상태 막대 아이콘을 메뉴 막대 높이에 맞춰 줄여 그리므로, 2배(44px)로 넣어야 또렷하다.
    """
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = size - inset * 2
    icon = master.resize((inner, inner), Image.LANCZOS)

    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, inner - 1, inner - 1), radius=round(inner * 0.235), fill=255
    )
    canvas.paste(icon, (inset, inset), mask)
    canvas.save(dest, format="PNG", optimize=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = Image.open(MASTER).convert("RGBA")
    if master.size != (1024, 1024):
        master = master.resize((1024, 1024), Image.LANCZOS)

    build_icns(master, OUT / "icon.icns")
    # generate_context! 가 기본 창 아이콘으로 읽는 파일 — 없으면 빌드가 panic 한다.
    master.save(OUT / "icon.png", format="PNG")
    build_tray(22, OUT / "trayTemplate.png")
    build_tray(44, OUT / "trayTemplate@2x.png")
    build_tray_color(master, OUT / "tray-icon.png", 44)

    for name in ("icon.icns", "icon.png", "trayTemplate.png", "trayTemplate@2x.png", "tray-icon.png"):
        print(f"{name:22} {(OUT / name).stat().st_size:>8,} bytes")


if __name__ == "__main__":
    main()
