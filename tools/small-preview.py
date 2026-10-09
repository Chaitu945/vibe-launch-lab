"""Downscale the generated logo to 64px so small-size legibility can be eyeballed.

    python tools/small-preview.py

Reads submission/logo-512.png (stdlib PNG decode: all five filter types) and writes
submission/logo-64-preview.png using a box filter.
"""

import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "submission"


def read_png(path: Path):
    d = path.read_bytes()
    pos, w, h, idat = 8, 0, 0, b""
    while pos < len(d):
        ln = int.from_bytes(d[pos : pos + 4], "big")
        tag = d[pos + 4 : pos + 8]
        data = d[pos + 8 : pos + 8 + ln]
        if tag == b"IHDR":
            w, h = int.from_bytes(data[0:4], "big"), int.from_bytes(data[4:8], "big")
        elif tag == b"IDAT":
            idat += data
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 3
    rows, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[p]
        line = bytearray(raw[p + 1 : p + 1 + stride])
        p += 1 + stride
        if f == 1:
            for i in range(3, stride):
                line[i] = (line[i] + line[i - 3]) % 256
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) % 256
        elif f == 3:
            for i in range(stride):
                line[i] = (line[i] + (((line[i - 3] if i >= 3 else 0) + prev[i]) // 2)) % 256
        elif f == 4:
            def paeth(a, b, c):
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                return a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)

            for i in range(stride):
                line[i] = (
                    line[i]
                    + paeth(line[i - 3] if i >= 3 else 0, prev[i], prev[i - 3] if i >= 3 else 0)
                ) % 256
        rows.append(bytes(line))
        prev = line
    return w, h, rows


def png(raw: bytes, size: int, path: Path):
    def chunk(tag: bytes, data: bytes):
        return (
            len(data).to_bytes(4, "big")
            + tag
            + data
            + (zlib.crc32(tag + data) % (2**32)).to_bytes(4, "big")
        )

    header = size.to_bytes(4, "big") * 2 + bytes((8, 2, 0, 0, 0))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def box_downscale(rows, w, target):
    n = w // target
    out = bytearray()
    for y in range(target):
        out.append(0)
        for x in range(target):
            r = g = b = 0
            for dy in range(n):
                row = rows[y * n + dy]
                for dx in range(n):
                    i = (x * n + dx) * 3
                    r += row[i]
                    g += row[i + 1]
                    b += row[i + 2]
            k = n * n
            out += bytes((r // k, g // k, b // k))
    return bytes(out)


if __name__ == "__main__":
    w, h, rows = read_png(ROOT / "logo-512.png")
    for size in (64, 32):
        png(box_downscale(rows, w, size), size, ROOT / f"logo-{size}-preview.png")
        print("wrote", ROOT / f"logo-{size}-preview.png")
