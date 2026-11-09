#!/usr/bin/env python3
"""fixsum.py -- write the SNES internal-header checksum into a ROM image.

The checksum is the 16-bit sum of every byte in the ROM, computed with the
checksum field as $0000 and the complement field as $FFFF (their bytes then
always add up to $1FE, whatever the final values are).  Complement = sum^$FFFF.

usage: fixsum.py rom.sfc [--hirom] [--check]
"""
import argparse
import sys


def compute(rom: bytes, hdr: int) -> int:
    size = len(rom)
    if size & (size - 1) or size < 0x8000:
        raise ValueError(f"ROM size {size} is not a power of two >= 32 KiB")
    b = bytearray(rom)
    b[hdr + 0x1C:hdr + 0x20] = b"\xff\xff\x00\x00"
    return sum(b) & 0xFFFF


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rom")
    ap.add_argument("--hirom", action="store_true", help="header at $FFC0 file offset")
    ap.add_argument("--check", action="store_true", help="verify only, do not write")
    a = ap.parse_args(argv)

    hdr = 0xFFC0 if a.hirom else 0x7FC0
    with open(a.rom, "rb") as f:
        rom = bytearray(f.read())
    csum = compute(rom, hdr)
    comp = csum ^ 0xFFFF
    want = comp.to_bytes(2, "little") + csum.to_bytes(2, "little")
    have = bytes(rom[hdr + 0x1C:hdr + 0x20])
    title = rom[hdr:hdr + 21].decode("ascii", "replace").rstrip()
    if a.check:
        ok = have == want
        print(f"{a.rom}: '{title}' checksum ${csum:04X} complement ${comp:04X} "
              f"{'OK' if ok else 'MISMATCH (header has ' + have.hex() + ')'}")
        return 0 if ok else 1
    rom[hdr + 0x1C:hdr + 0x20] = want
    with open(a.rom, "wb") as f:
        f.write(rom)
    print(f"{a.rom}: '{title}' {len(rom)} bytes, checksum ${csum:04X}, complement ${comp:04X}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
