#!/usr/bin/env python3
"""mkchr.py -- convert text pixel art into SNES planar tile data.

Input: text file, one character per pixel ('.' or '0' = colour 0, hex digits
1-f = colours 1-15).  '#' starts a comment line.  Blank lines separate images.
Each image must be a multiple of 8 pixels wide and tall; it is cut into 8x8
tiles in row-major order.

--sheet-width N pads every row of tiles to N tiles, so a WxH image keeps its
2-D layout in VRAM (use 16 for OBJ sheets: a 16x16 sprite at tile T uses tiles
T, T+1, T+16, T+17).

usage: mkchr.py [--bpp 2|4|8] [--sheet-width N] in.txt out.bin
"""
import argparse
import sys


def parse_images(text):
    images, cur = [], []
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        if not line:
            if cur:
                images.append(cur)
                cur = []
            continue
        cur.append([0 if c == "." else int(c, 16) for c in line])
    if cur:
        images.append(cur)
    for n, img in enumerate(images):
        w = len(img[0])
        if any(len(r) != w for r in img) or w % 8 or len(img) % 8:
            raise ValueError(f"image {n}: must be rectangular, multiple of 8 px "
                             f"(got {[len(r) for r in img]} x {len(img)})")
    return images


def encode_tile(px, bpp):
    """px: 8 rows of 8 colour indices -> SNES planar bytes."""
    out = bytearray()
    for pair in range(0, bpp, 2):
        for row in px:
            for plane in (pair, pair + 1):
                b = 0
                for x, c in enumerate(row):
                    b |= ((c >> plane) & 1) << (7 - x)
                out.append(b)
    return bytes(out)


def convert(text, bpp=4, sheet_width=0):
    out = bytearray()
    blank = bytes(8 * bpp)
    for img in parse_images(text):
        for ty in range(0, len(img), 8):
            ntiles = len(img[0]) // 8
            for tx in range(ntiles):
                px = [row[tx * 8:tx * 8 + 8] for row in img[ty:ty + 8]]
                if any(c >= (1 << bpp) for r in px for c in r):
                    raise ValueError(f"colour index out of range for {bpp}bpp")
                out += encode_tile(px, bpp)
            if sheet_width:
                if ntiles > sheet_width:
                    raise ValueError("image wider than sheet")
                out += blank * (sheet_width - ntiles)
    # drop trailing padding
    if sheet_width:
        while out.endswith(blank) and len(out) > len(blank):
            del out[-len(blank):]
    return bytes(out)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bpp", type=int, default=4, choices=(2, 4, 8))
    ap.add_argument("--sheet-width", type=int, default=0)
    ap.add_argument("src")
    ap.add_argument("dst")
    a = ap.parse_args(argv)
    with open(a.src) as f:
        data = convert(f.read(), a.bpp, a.sheet_width)
    with open(a.dst, "wb") as f:
        f.write(data)
    return 0


if __name__ == "__main__":
    sys.exit(main())
