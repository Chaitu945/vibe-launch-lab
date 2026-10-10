"""Generate the Launch Lab token image (512x512 PNG) and an SVG twin.

Pure stdlib: the PNG is written by hand (zlib + struct) with 2x supersampling for
antialiasing. The curve drawn is literally the protocol's own price curve
(price = (E0 + real)^2 / (E0 * X0)), normalised, so the logo is the product.

    python tools/make-logo.py
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "submission"
SS = 2  # supersample factor
SIZE = 512
W = SIZE * SS

BG_TOP = (10, 12, 13)
BG_BOTTOM = (17, 20, 22)
GRID = (28, 32, 35)
ACCENT = (223, 249, 2)
ACCENT_DIM = (128, 145, 4)
MARKER = (127, 178, 255)

E0 = 1.764594628672298575
TARGET = 5.0


def curve_y(p: float) -> float:
    """Normalised price at progress p along the curve (0..1)."""
    return ((1.0 + p * (TARGET / E0)) / (1.0 + TARGET / E0)) ** 2


Y0 = curve_y(0.0)
Y1 = curve_y(1.0)


def norm(p: float) -> float:
    return (curve_y(p) - Y0) / (Y1 - Y0)


def blend(dst, src, alpha):
    return tuple(int(round(d * (1 - alpha) + s * alpha)) for d, s in zip(dst, src))


def build():
    px = [[(0, 0, 0)] * W for _ in range(W)]
    for y in range(W):
        t = y / (W - 1)
        row_bg = tuple(int(round(a + (b - a) * t)) for a, b in zip(BG_TOP, BG_BOTTOM))
        for x in range(W):
            px[y][x] = row_bg

    # ---- badge: rounded-square frame ----
    m = 40
    rad = 110
    half = 17  # 34px stroke at 2x -> 17px final

    def round_rect_sd(x: float, y: float) -> float:
        cx = min(max(x, m + rad), W - m - rad)
        cy = min(max(y, m + rad), W - m - rad)
        return math.hypot(x - cx, y - cy) - rad

    for y in range(W):
        for x in range(W):
            d = abs(round_rect_sd(x + 0.5, y + 0.5))
            if d <= half:
                a = 1.0 if d <= half - 1.4 else (half - d) / 1.4
                px[y][x] = blend(px[y][x], ACCENT, min(1.0, max(0.0, a)))

    # ---- chart region inside the badge ----
    left, right = 205, 790
    top, bottom = 268, 780
    span_x, span_y = right - left, bottom - top

    def point(p: float):
        return left + p * span_x, bottom - norm(p) * span_y

    # The ring is drawn BEFORE the curve so the curve visibly runs into its centre:
    # a target the line reaches, not a shape stuck on the end of it.
    ex, ey = point(1.0)
    ring_outer, ring_inner = 62.0, 32.0
    for y_px in range(int(ey - ring_outer) - 2, int(ey + ring_outer) + 3):
        for x_px in range(int(ex - ring_outer) - 2, int(ex + ring_outer) + 3):
            if 0 <= x_px < W and 0 <= y_px < W:
                d = math.hypot(x_px - ex, y_px - ey)
                if d <= ring_outer:
                    if d < ring_inner:
                        px[y_px][x_px] = row_colour(y_px)
                    else:
                        a = 1.0 if d < ring_outer - 1.6 else max(0.0, (ring_outer - d) / 1.6)
                        px[y_px][x_px] = blend(px[y_px][x_px], ACCENT, a)

    # ---- bold curve, no fill, no hairlines ----
    pts = [point(i / 900) for i in range(901)]
    for width, colour, alpha in ((34, ACCENT_DIM, 0.16), (17.0, ACCENT, 1.0)):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            steps = max(1, int(math.hypot(x1 - x0, y1 - y0) * 2))
            for s in range(steps + 1):
                f = s / steps
                cx, cy = x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
                r = width / 2
                for y_px in range(int(cy - r - 1), int(cy + r + 2)):
                    for x_px in range(int(cx - r - 1), int(cx + r + 2)):
                        if 0 <= x_px < W and 0 <= y_px < W:
                            d = math.hypot(x_px - cx, y_px - cy)
                            if d <= r:
                                a = alpha * (1.0 - max(0.0, (d - (r - 1.6)) / 1.6))
                                if a > 0:
                                    px[y_px][x_px] = blend(px[y_px][x_px], colour, min(1.0, a))

    # small origin dot for balance
    sx, sy = point(0.0)
    for y_px in range(int(sy - 16), int(sy + 17)):
        for x_px in range(int(sx - 16), int(sx + 17)):
            if 0 <= x_px < W and 0 <= y_px < W and math.hypot(x_px - sx, y_px - sy) <= 15:
                px[y_px][x_px] = ACCENT

    # downsample
    out = bytearray()
    for y in range(SIZE):
        out.append(0)
        for x in range(SIZE):
            r = g = b = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb = px[y * SS + dy][x * SS + dx]
                    r += pr
                    g += pg
                    b += pb
            n = SS * SS
            out += bytes((r // n, g // n, b // n))
    return bytes(out)


def row_colour(y: int):
    t = y / (W - 1)
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(BG_TOP, BG_BOTTOM))


def write_png(path: Path, raw: bytes, size: int):
    def chunk(tag: bytes, data: bytes):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def svg():
    left, right, top, bottom = 205, 790, 268, 780
    pts = []
    for i in range(101):
        p = i / 100
        x = left + p * (right - left)
        y = bottom - norm(p) * (bottom - top)
        pts.append(f"{x:.1f},{y:.1f}")
    polyline = " ".join(pts)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0a0c0d"/>
      <stop offset="1" stop-color="#111416"/>
    </linearGradient>
    <linearGradient id="fill" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#dff902" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#dff902" stop-opacity="0.16"/>
    </linearGradient>
    <clipPath id="ring"><circle cx="{right}" cy="{top}" r="30"/></clipPath>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect x="57" y="57" width="910" height="910" rx="93" fill="none" stroke="#dff902" stroke-width="34"/>
  <circle cx="{right}" cy="{top}" r="47" fill="none" stroke="#dff902" stroke-width="30"/>
  <polyline points="{polyline}" fill="none" stroke="#dff902" stroke-width="17" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="{left}" cy="{bottom}" r="15" fill="#dff902"/>
</svg>
"""


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write_png(OUT / "logo-512.png", build(), SIZE)
    (OUT / "logo.svg").write_text(svg(), encoding="utf-8")
    print("wrote", OUT / "logo-512.png", (OUT / "logo-512.png").stat().st_size, "bytes")
    print("wrote", OUT / "logo.svg")
