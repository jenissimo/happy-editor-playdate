"""Compose editor screenshot into a stylized macOS browser window for README."""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

capture = Image.open(r"C:\Users\jenis\.playwright-mcp\editor-capture.png").convert("RGBA")
cw, ch = capture.size

title_h = 44
pad = 1
radius = 12
outer_pad_x = 72
outer_pad_y = 64
shadow_blur = 28
shadow_offset = 10

win_w = cw + pad * 2
win_h = ch + title_h + pad
canvas_w = win_w + outer_pad_x * 2
canvas_h = win_h + outer_pad_y * 2 + shadow_offset

canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
bg = Image.new("RGB", (canvas_w, canvas_h))
bg_px = bg.load()
assert bg_px is not None
for y in range(canvas_h):
    t = y / max(1, canvas_h - 1)
    r = int(28 + (18 - 28) * t)
    g = int(30 + (20 - 30) * t)
    b = int(32 + (24 - 32) * t)
    g = min(255, g + int(4 * (1 - abs(t - 0.45) * 2)))
    for x in range(canvas_w):
        vx = abs(x / canvas_w - 0.5) * 2
        vy = abs(y / canvas_h - 0.5) * 2
        v = 1 - 0.18 * (vx * vx + vy * vy)
        bg_px[x, y] = (int(r * v), int(g * v), int(b * v))

for y in range(0, canvas_h, 8):
    for x in range(0, canvas_w, 8):
        if (x // 8 + y // 8) % 7 == 0:
            c = bg_px[x, y]
            bg_px[x, y] = (
                min(255, c[0] + 6),
                min(255, c[1] + 7),
                min(255, c[2] + 6),
            )

canvas.paste(bg.convert("RGBA"))

win_x = outer_pad_x
win_y = outer_pad_y

shadow = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle(
    [
        win_x + 4,
        win_y + shadow_offset,
        win_x + win_w + 4,
        win_y + win_h + shadow_offset,
    ],
    radius=radius + 2,
    fill=(0, 0, 0, 160),
)
shadow = shadow.filter(ImageFilter.GaussianBlur(shadow_blur))
canvas = Image.alpha_composite(canvas, shadow)

window = Image.new("RGBA", (win_w, win_h), (0, 0, 0, 0))
wd = ImageDraw.Draw(window)
wd.rounded_rectangle(
    [0, 0, win_w - 1, win_h - 1], radius=radius, fill=(38, 38, 40, 255)
)
wd.rounded_rectangle(
    [0, 0, win_w - 1, title_h + radius], radius=radius, fill=(52, 52, 54, 255)
)
wd.rectangle([0, title_h - 4, win_w, title_h], fill=(52, 52, 54, 255))
wd.line([(0, title_h - 1), (win_w, title_h - 1)], fill=(20, 20, 22, 255), width=1)

lights = [(14, 22, (255, 95, 86)), (34, 22, (255, 189, 46)), (54, 22, (39, 201, 63))]
for cx, cy, color in lights:
    wd.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=(30, 30, 32, 255))
    wd.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=color)

pill_w = 300
pill_h = 22
pill_x = (win_w - pill_w) // 2
pill_y = (title_h - pill_h) // 2
wd.rounded_rectangle(
    [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
    radius=6,
    fill=(42, 42, 44, 255),
)

font = None
for path in [
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
]:
    if os.path.exists(path):
        try:
            font = ImageFont.truetype(path, 12)
            break
        except Exception:
            pass

label = "localhost:5173  ·  demo-title"
if font:
    bbox = wd.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
else:
    tw, th = len(label) * 6, 10
tx = pill_x + (pill_w - tw) // 2
ty = pill_y + (pill_h - th) // 2 - 1
wd.text((tx, ty), label, fill=(180, 180, 182, 255), font=font)

window.paste(capture, (pad, title_h))

mask = Image.new("L", (win_w, win_h), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, win_w - 1, win_h - 1], radius=radius, fill=255)
rounded = Image.new("RGBA", (win_w, win_h), (0, 0, 0, 0))
rounded.paste(window, (0, 0))
rounded.putalpha(mask)

canvas.paste(rounded, (win_x, win_y), rounded)

od = ImageDraw.Draw(canvas)
od.rounded_rectangle(
    [win_x, win_y, win_x + win_w - 1, win_y + win_h - 1],
    radius=radius,
    outline=(70, 70, 74, 220),
    width=1,
)

out = r"C:\Projects\playdate-editor\docs\images\happy-editor-window.png"
os.makedirs(os.path.dirname(out), exist_ok=True)
final = Image.new("RGB", canvas.size, (22, 24, 26))
final.paste(canvas, mask=canvas.split()[-1])

# README-friendly width (~1280) while keeping sharpness
max_w = 1280
if final.width > max_w:
    ratio = max_w / final.width
    final = final.resize(
        (max_w, int(final.height * ratio)),
        Image.Resampling.LANCZOS,
    )

final.save(out, "PNG", optimize=True)
print("wrote", out, final.size, os.path.getsize(out))
