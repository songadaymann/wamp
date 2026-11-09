#!/usr/bin/env python3
"""mkfont.py -- emit the 8x8 ASCII font (chars $20-$7F) as SNES 2bpp tiles.

Glyphs are the classic 5x7 column font: 5 bytes per glyph, one byte per column,
bit 0 = top row.  Each glyph sits in columns 1-5, rows 0-6 of its 8x8 cell.
Output tile N is ASCII character N+$20, so tile 0 (space) is blank.
Pixels use colour 1 (bitplane 0 only).

usage: mkfont.py out.bin [--bpp 2|4] [--png preview.png]
"""
import argparse
import sys

FONT5X7 = bytes.fromhex(
    "0000000000" "00005F0000" "0007000700" "147F147F14"  #  !"#
    "242A7F2A12" "2313086462" "3649552250" "0005030000"  # $%&'
    "001C224100" "0041221C00" "14083E0814" "08083E0808"  # ()*+
    "0050300000" "0808080808" "0060600000" "2010080402"  # ,-./
    "3E5149453E" "00427F4000" "4261514946" "2141454B31"  # 0123
    "1814127F10" "2745454539" "3C4A494930" "0171090503"  # 4567
    "3649494936" "064949291E" "0036360000" "0056360000"  # 89:;
    "0814224100" "1414141414" "0041221408" "0201510906"  # <=>?
    "324979413E" "7E1111117E" "7F49494936" "3E41414122"  # @ABC
    "7F4141221C" "7F49494941" "7F09090901" "3E4149497A"  # DEFG
    "7F0808087F" "00417F4100" "2040413F01" "7F08142241"  # HIJK
    "7F40404040" "7F020C027F" "7F0408107F" "3E4141413E"  # LMNO
    "7F09090906" "3E4151215E" "7F09192946" "4649494931"  # PQRS
    "01017F0101" "3F4040403F" "1F2040201F" "3F4038403F"  # TUVW
    "6314081463" "0708700807" "6151494543" "007F414100"  # XYZ[
    "0204081020" "0041417F00" "0402010204" "4040404040"  # \]^_
    "0001020400" "2054545478" "7F48444438" "3844444420"  # `abc
    "384444487F" "3854545418" "087E090102" "0C5252523E"  # defg
    "7F08040478" "00447D4000" "2040443D00" "7F10284400"  # hijk
    "00417F4000" "7C04180478" "7C08040478" "3844444438"  # lmno
    "7C14141408" "081414187C" "7C08040408" "4854545420"  # pqrs
    "043F444020" "3C4040207C" "1C2040201C" "3C4030403C"  # tuvw
    "4428102844" "0C5050503C" "4464544C44" "0008364100"  # xyz{
    "00007F0000" "0041360800" "08082A1C08" "081C2A0808"  # |}~ DEL
)
assert len(FONT5X7) == 96 * 5

FIRST_CHAR = 0x20
NUM_CHARS = 96


def glyph_rows(index):
    """8 bytes, one per pixel row, bit 7 = leftmost pixel."""
    cols = FONT5X7[index * 5:index * 5 + 5]
    rows = []
    for y in range(8):
        b = 0
        for x, col in enumerate(cols):
            if (col >> y) & 1:
                b |= 0x80 >> (x + 1)
        rows.append(b)
    return rows


def build(bpp=2):
    out = bytearray()
    for i in range(NUM_CHARS):
        for r in glyph_rows(i):
            out += bytes((r, 0))
        out += bytes(16 * (bpp // 2 - 1))
    return bytes(out)


def preview(path, scale=4):
    from PIL import Image
    img = Image.new("L", (16 * 8, 6 * 8), 0)
    for i in range(NUM_CHARS):
        for y, r in enumerate(glyph_rows(i)):
            for x in range(8):
                if r & (0x80 >> x):
                    img.putpixel(((i % 16) * 8 + x, (i // 16) * 8 + y), 255)
    img.resize((img.width * scale, img.height * scale), Image.NEAREST).save(path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("dst")
    ap.add_argument("--bpp", type=int, default=2, choices=(2, 4))
    ap.add_argument("--png", help="also write a preview sheet")
    a = ap.parse_args(argv)
    with open(a.dst, "wb") as f:
        f.write(build(a.bpp))
    if a.png:
        preview(a.png)
    return 0


if __name__ == "__main__":
    sys.exit(main())
