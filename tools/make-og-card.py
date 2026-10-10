#!/usr/bin/env python3
"""
Build the link-preview card (1200x630, the size X/Discord/Slack crop to).

Written with PIL and no external assets, so it can be regenerated any time:
    python tools/make-og-card.py
Output: public/og.png

Design notes learned from a first pass: X shows this at roughly 40-50% scale, so anything
under ~28px turns to texture. Keep the supporting lines short and few, and avoid blend
tricks that band.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (11, 13, 15)
CARD = (17, 19, 22)
LIME = (223, 249, 2)
TEXT = (233, 236, 239)
MUTED = (150, 158, 168)

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og.png"

FONT_DIR = pathlib.Path("C:/Windows/Fonts")


def font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for name in candidates:
        path = FONT_DIR / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


BOLD = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"]
REG = ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]
MONO = ["consola.ttf", "cour.ttf", "DejaVuSansMono.ttf"]

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# Smooth vertical wash instead of a blended ellipse: no banding, no seam.
for y in range(H):
    t = y / H
    shade = tuple(int(BG[i] + (14 if i == 1 else 10) * (1 - t) ** 2) for i in range(3))
    d.line([(0, y), (W, y)], fill=shade)

# badge mark: the same lime tile with an L that the site uses as its logo
d.rounded_rectangle([80, 74, 150, 144], radius=16, fill=LIME)
d.text((101, 89), "L", font=font(MONO, 42), fill=(0, 0, 0))

d.text((174, 80), "Launch Lab", font=font(BOLD, 54), fill=TEXT)
d.text((176, 146), "unofficial analytics + curve simulator", font=font(REG, 26), fill=MUTED)

# headline
d.text((80, 226), "Every launch on the vibe/vibe", font=font(BOLD, 60), fill=TEXT)
d.text((80, 297), "testnet, read off the chain", font=font(BOLD, 60), fill=LIME)

# three short claims, sized to survive being shown at ~45%
lines = [
    "all four factory generations, V6 included",
    "curve math checked against each contract",
    "simulate a launch before you commit it",
]
y = 410
for line in lines:
    d.ellipse([84, y + 13, 94, y + 23], fill=LIME)
    d.text((112, y), line, font=font(REG, 30), fill=(206, 212, 220))
    y += 46

# right side: a small echo of the app's hourly activity strip, so the space is not dead
bars = [18, 42, 96, 64, 128, 38, 74, 52]
bx, by, bw, gap = 820, 250, 26, 18
for i, h in enumerate(bars):
    x = bx + i * (bw + gap)
    d.rounded_rectangle([x, by + (150 - h), x + bw, by + 150], radius=6, fill=LIME if i == 4 else (46, 52, 58))
d.text((bx, by + 168), "launches per hour", font=font(MONO, 22), fill=MUTED)

# footer strip, so the card reads as a product and not a screenshot
d.rectangle([0, H - 76, W, H], fill=CARD)
d.line([(0, H - 76), (W, H - 76)], fill=(38, 42, 48), width=1)
d.text((80, H - 52), "testnet only", font=font(MONO, 24), fill=MUTED)
d.text((266, H - 52), "no wallet needed", font=font(MONO, 24), fill=MUTED)
d.text((528, H - 52), "no API key", font=font(MONO, 24), fill=MUTED)
d.text((860, H - 52), "Robinhood Chain Testnet", font=font(MONO, 24), fill=LIME)

OUT.parent.mkdir(parents=True, exist_ok=True)
img.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {img.size[0]}x{img.size[1]})")
