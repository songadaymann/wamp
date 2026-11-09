#!/usr/bin/env python3
"""End-to-end test of the SNESWAMP build + headless emulator harness.

Builds the ROM with make, then runs it in both snes9x and bsnes-mercury and
checks RAM state and the rendered picture.  Screenshots go to build/shots/.

Run either way:
    python3 tests/test_harness.py
    python3 -m pytest tests -v
"""
import os
import subprocess
import sys
from pathlib import Path

SNES = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SNES / "tools"))

import emu as emulib  # noqa: E402
import mkfont  # noqa: E402
from emu import Emu, parse_input_script  # noqa: E402

ROM = SNES / "build" / "sneswamp.sfc"
SHOTS = SNES / "build" / "shots"
CORES = ["snes9x", "bsnes"]

TITLE = "SNESWAMP HARNESS OK"
TITLE_COL, TITLE_ROW = 6, 3          # must match src/main.s
WARMUP = 30                          # frames before the demo is surely running

_built = False


def build():
    global _built
    if not _built:
        subprocess.run(["make", "-C", str(SNES)], check=True, stdout=subprocess.DEVNULL)
        _built = True
    return ROM


def is_white(rgb):
    return min(rgb) >= 240


# ---------------------------------------------------------------------------
# ROM image
# ---------------------------------------------------------------------------

def test_rom_header():
    rom = build().read_bytes()
    assert len(rom) == 1024 * 1024
    hdr = rom[0x7FC0:0x8000]
    assert hdr[:21] == b"SNESWAMP".ljust(21)
    assert hdr[0x15] == 0x20, "map mode LoROM"
    assert hdr[0x17] == 0x0A, "ROM size 1 MiB"
    comp = int.from_bytes(hdr[0x1C:0x1E], "little")
    csum = int.from_bytes(hdr[0x1E:0x20], "little")
    assert csum ^ comp == 0xFFFF
    assert sum(rom) & 0xFFFF == csum, "header checksum matches ROM contents"
    reset = int.from_bytes(hdr[0x3C:0x3E], "little")
    assert reset >= 0x8000
    subprocess.run([sys.executable, str(SNES / "tools" / "fixsum.py"), "--check", str(ROM)],
                   check=True, stdout=subprocess.DEVNULL)


def test_labels():
    build()
    labels = emulib.load_labels(ROM.with_suffix(".lbl"))
    for name in ("frame_counter", "joy1", "sprite_x", "sprite_y", "oam_shadow", "Reset", "NMI"):
        assert name in labels, name
    assert emulib.wram_offset(labels["frame_counter"]) < 0x2000
    assert emulib.wram_offset(0x7F0010) == 0x10010


def test_input_script_parser():
    ev = parse_input_script("60: +RIGHT; 90: +B; 100: -B; 200: -RIGHT")
    assert ev == {60: [("+", "RIGHT", 0)], 90: [("+", "B", 0)],
                  100: [("-", "B", 0)], 200: [("-", "RIGHT", 0)]}
    ev = parse_input_script("5:+a,+left  +X@2\n9:-ALL")
    assert ev == {5: [("+", "A", 0), ("+", "LEFT", 0), ("+", "X", 1)], 9: [("-", "ALL", 0)]}
    for bad in ("x:+A", "5:+FIRE", "5:A", "5:"):
        try:
            parse_input_script(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"{bad!r} should be rejected")


# ---------------------------------------------------------------------------
# per-core behaviour
# ---------------------------------------------------------------------------

def check_frame_counter(core):
    with Emu(build(), core=core) as emu:
        emu.step(WARMUP)
        start = emu.peek16("frame_counter")
        assert 0 < start <= WARMUP, f"{core}: frame_counter={start} after {WARMUP} frames"
        # exactly +1 on every single frame
        prev = start
        for _ in range(120):
            emu.step()
            cur = emu.peek16("frame_counter")
            assert cur == prev + 1, f"{core}: frame {emu.frame}: counter {prev} -> {cur}"
            prev = cur
        emu.assert_eq("frame_counter", start + 120, size=2)
        # no input: nothing held, sprite at its start position
        emu.assert_eq("joy1", 0, size=2)
        emu.assert_eq("sprite_x", 120, size=2)
        emu.assert_eq("sprite_y", 104, size=2)


def check_sprite_moves(core):
    with Emu(build(), core=core) as emu:
        emu.step(WARMUP)
        x0 = emu.assert_eq("sprite_x", 120, size=2)
        y0 = emu.peek16("sprite_y")

        # programmatic input: hold RIGHT, sample every frame
        emu.press("RIGHT")
        xs = []
        for _ in range(40):
            emu.step()
            xs.append(emu.peek16("sprite_x"))
        assert all(b >= a for a, b in zip(xs, xs[1:])), f"{core}: x not monotonic: {xs}"
        assert all(b - a == 1 for a, b in zip(xs[4:], xs[5:])), f"{core}: not 1 px/frame: {xs}"
        assert 36 <= xs[-1] - x0 <= 40, f"{core}: x moved {xs[-1] - x0} px in 40 frames"
        assert emu.peek16("joy1") == 0x0100, f"{core}: joy1=${emu.peek16('joy1'):04X}"
        emu.assert_eq("sprite_y", y0, size=2, msg="RIGHT must not move Y")

        emu.release("RIGHT")
        emu.step(4)
        x1 = emu.peek16("sprite_x")
        emu.step(20)
        emu.assert_eq("sprite_x", x1, size=2, msg="sprite keeps moving after release")
        assert 38 <= x1 - x0 <= 41

        # scripted input, frame numbers relative to now
        emu.run(60, script="0:+LEFT,+DOWN; 30:-LEFT; 40:-ALL", relative=True)
        emu.assert_eq("sprite_x", x1 - 30, size=2)
        emu.assert_eq("sprite_y", y0 + 40, size=2)

        # step(buttons=...) holds for exactly that call
        emu.step(10, buttons="UP")
        emu.step(4)
        emu.assert_eq("sprite_y", y0 + 30, size=2)
        assert emu.held() == []

        # right edge clamp
        emu.step(300, buttons=["RIGHT"])
        emu.step(4)
        emu.assert_eq("sprite_x", 240, size=2)

        # the OAM shadow follows the variables
        emu.assert_bytes("oam_shadow", bytes([240, y0 + 30, 0, 0x30]))
        emu.assert_eq("oam_shadow+512", 0x02)


def check_picture(core):
    SHOTS.mkdir(parents=True, exist_ok=True)
    shots = {WARMUP: SHOTS / f"{core}_idle.png", 149: SHOTS / f"{core}_moved.png"}
    with Emu(build(), core=core) as emu:
        emu.run(150, script="40:+RIGHT,+UP; 90:-ALL", shots=shots)
        emu.save_screenshot(SHOTS / f"{core}_moved_x3.png", scale=3)
        for p in shots.values():
            assert p.exists() and p.stat().st_size > 500, p

        img = emu.screenshot()
        assert img.size == (256, 224), f"{core}: {img.size} raw {emu.frame_info()}"
        assert emu.screenshot(scale=3).size == (768, 672)

        # --- BG3 text: every pixel of the title must match the font exactly --
        for i, ch in enumerate(TITLE):
            rows = mkfont.glyph_rows(ord(ch) - 0x20)
            for gy in range(8):
                for gx in range(8):
                    want = bool(rows[gy] & (0x80 >> gx))
                    x, y = (TITLE_COL + i) * 8 + gx, TITLE_ROW * 8 + gy
                    got = is_white(img.getpixel((x, y)))
                    assert got == want, (f"{core}: title char {i} {ch!r} pixel ({gx},{gy}) "
                                         f"at ({x},{y}) is {img.getpixel((x, y))}")

        # --- BG1: 2x2-tile checkerboard of two different 4bpp tiles ----------
        def tile(tx, ty):
            return img.crop((tx * 8, ty * 8, tx * 8 + 8, ty * 8 + 8)).tobytes()
        a, b = tile(0, 10), tile(2, 10)             # rows 10/11 have no text
        assert a != b, f"{core}: BG1 tiles are identical"
        assert len(set(a)) > 2 and len(set(b)) > 2, f"{core}: BG1 tiles are flat"
        for ty in (10, 11, 12, 13):
            for tx in range(0, 12):
                want = a if ((tx >> 1) ^ (ty >> 1) ^ (10 >> 1)) & 1 == 0 else b
                assert tile(tx, ty) == want, f"{core}: BG1 tile ({tx},{ty}) breaks the checkerboard"
        emu.assert_pixel(1, 10 * 8 + 1, (136, 48, 32), tol=10)    # brick tile, colour 5
        emu.assert_pixel(1, 12 * 8 + 1, (16, 32, 96), tol=10)     # diamond tile, colour 1

        # --- OBJ: yellow 16x16 sprite at (sprite_x, sprite_y) ----------------
        sx, sy = emu.peek16("sprite_x"), emu.peek16("sprite_y")
        assert (sx, sy) != (120, 104), f"{core}: sprite did not move"
        emu.assert_pixel(sx + 8, sy + 2, (248, 216, 24), tol=10, msg="sprite body")
        emu.assert_pixel(sx + 8, sy, (8, 8, 8), tol=10, msg="sprite outline, top row")
        emu.assert_pixel(sx + 8, sy + 15, (8, 8, 8), tol=10, msg="sprite outline, bottom row")

        # --- WRAM dump + savestate round trip --------------------------------
        dump = emu.dump_wram(SNES / "build" / f"wram_{core}.bin")
        data = Path(dump).read_bytes()
        assert len(data) == 0x20000
        assert int.from_bytes(data[0:2], "little") == emu.peek16("frame_counter")
        state = emu.save_state()
        fc = emu.peek16("frame_counter")
        emu.step(25, buttons="LEFT")
        assert emu.peek16("sprite_x") < sx
        emu.load_state(state)
        emu.assert_eq("frame_counter", fc, size=2, msg="after load_state")
        emu.assert_eq("sprite_x", sx, size=2, msg="after load_state")

        # poke works too
        emu.poke16("sprite_x", 10)
        emu.step(2)
        emu.assert_eq("sprite_x", 10, size=2)
        emu.assert_eq("oam_shadow", 10)
        return img


def test_frame_counter_snes9x():
    check_frame_counter("snes9x")


def test_frame_counter_bsnes():
    check_frame_counter("bsnes")


def test_sprite_moves_snes9x():
    check_sprite_moves("snes9x")


def test_sprite_moves_bsnes():
    check_sprite_moves("bsnes")


def test_picture_snes9x():
    check_picture("snes9x")


def test_picture_bsnes():
    check_picture("bsnes")


def test_cores_agree():
    """Both cores must draw the same picture (allowing for 5->8 bit colour
    expansion differences) for the same input."""
    imgs = {}
    for core in CORES:
        with Emu(build(), core=core) as emu:
            emu.run(100, script="40:+LEFT,+DOWN; 70:-ALL")
            imgs[core] = (emu.screenshot(), emu.peek16("sprite_x"), emu.peek16("sprite_y"))
    (a, ax, ay), (b, bx, by) = imgs["snes9x"], imgs["bsnes"]
    assert (ax, ay) == (bx, by), f"sprite position differs: {(ax, ay)} vs {(bx, by)}"
    assert a.size == b.size
    worst = max(abs(p - q) for p, q in zip(a.tobytes(), b.tobytes()))
    assert worst <= 8, f"screenshots differ by up to {worst}/255"


def test_cli():
    build()
    out = SHOTS / "cli.png"
    if out.exists():
        out.unlink()
    r = subprocess.run(
        [sys.executable, str(SNES / "tools" / "emu.py"), str(ROM), "--frames", "300",
         "--input", "60:+RIGHT;120:-RIGHT", "--shot", f"299:{out}", "--scale", "2",
         "--peek", "frame_counter:2", "--peek", "sprite_x:2",
         "--expect", "sprite_x:2 == 180", "--expect", "frame_counter:2 >= 290"],
        capture_output=True, text=True, cwd=SNES)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "sprite_x = 180" in r.stdout, r.stdout
    assert out.exists()
    r = subprocess.run(
        [sys.executable, str(SNES / "tools" / "emu.py"), str(ROM), "--core", "bsnes",
         "--frames", "40", "--expect", "sprite_x:2 == 999"],
        capture_output=True, text=True, cwd=SNES)
    assert r.returncode == 1 and "FAIL" in r.stdout, r.stdout + r.stderr


# ---------------------------------------------------------------------------

def main():
    tests = [(n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}: {type(e).__name__}: {e}")
        else:
            print(f"ok   {name}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed; screenshots in {SHOTS}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
