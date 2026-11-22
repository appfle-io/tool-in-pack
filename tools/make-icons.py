#!/usr/bin/env python3
"""Generate the TIP app icons (PWA + iOS home screen).

Run:  python3 tools/make-icons.py
Writes: icons/icon-192.png, icon-512.png, icon-maskable-512.png,
        icons/apple-touch-icon-180.png, icons/favicon.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

S = 2048  # working canvas (supersampled)
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

TOP = (74, 125, 255)      # #4A7DFF
BOTTOM = (138, 92, 255)   # #8A5CFF
DARK = (11, 13, 18)       # #0B0D12


def gradient(size, c1, c2):
    """Diagonal linear gradient, built small and upscaled for smoothness."""
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_mark(img, scale=1.0):
    """2x2 module grid + TIP wordmark, centred; `scale` shrinks for maskable safe zone."""
    d = ImageDraw.Draw(img)
    cx, cy = S / 2, S / 2
    unit = S * scale

    # --- 2x2 module tiles -------------------------------------------------
    tile = unit * 0.155
    gap = unit * 0.045
    grid_w = tile * 2 + gap
    grid_top = cy - unit * 0.305
    alphas = [(255, 255, 255, 255), (255, 255, 255, 150),
              (255, 255, 255, 150), (255, 255, 255, 255)]
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    i = 0
    for row in range(2):
        for col in range(2):
            x0 = cx - grid_w / 2 + col * (tile + gap)
            y0 = grid_top + row * (tile + gap)
            ld.rounded_rectangle([x0, y0, x0 + tile, y0 + tile],
                                 radius=tile * 0.28, fill=alphas[i])
            i += 1
    img.alpha_composite(layer)

    # --- TIP wordmark -----------------------------------------------------
    size = int(unit * 0.30)
    font = ImageFont.truetype(FONT_BOLD, size)
    text = "TIP"
    tracking = size * 0.09
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    baseline_y = grid_top + grid_w + unit * 0.10
    for ch, w in zip(text, widths):
        d.text((x, baseline_y), ch, font=font, fill=(255, 255, 255, 255))
        x += w + tracking


def build(radius_ratio, pad_ratio=0.0, bg="gradient"):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    if bg == "gradient":
        base = gradient(S, TOP, BOTTOM).convert("RGBA")
    else:
        base = Image.new("RGBA", (S, S), DARK + (255,))
    radius = int(S * radius_ratio)
    img.paste(base, (0, 0), rounded_mask(S, radius))
    draw_mark(img, scale=1.0 - pad_ratio)
    return img


def save(img, name, px):
    img.resize((px, px), Image.LANCZOS).save(OUT / name, "PNG", optimize=True)
    print("wrote", OUT / name, px)


# rounded app icon (192/512 for the manifest + favicon)
app_icon = build(radius_ratio=0.225)
save(app_icon, "icon-192.png", 192)
save(app_icon, "icon-512.png", 512)
save(app_icon, "favicon.png", 64)

# iOS adds its own mask: full-bleed square, no transparency
ios = Image.new("RGBA", (S, S), DARK + (255,))
ios.paste(gradient(S, TOP, BOTTOM).convert("RGBA"), (0, 0))
draw_mark(ios, scale=0.92)
save(ios, "apple-touch-icon-180.png", 180)

# maskable: full bleed, mark kept inside the 80% safe zone
maskable = Image.new("RGBA", (S, S), DARK + (255,))
maskable.paste(gradient(S, TOP, BOTTOM).convert("RGBA"), (0, 0))
draw_mark(maskable, scale=0.78)
save(maskable, "icon-maskable-512.png", 512)
