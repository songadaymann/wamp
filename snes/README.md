# SNESWAMP

A SNES (65816 assembly) build of WAMP, plus a headless emulator harness so the
ROM can be built and tested from the command line / CI with no display.

The engine contract for milestone 1 (bank layout, asset and room formats, WRAM
map, module interfaces, physics rules, test strategy) is
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), with `src/constants.inc` and
`src/wram.inc` as its machine-readable half.

Right now the ROM is a pipeline demo: Mode 1, a 4bpp checkerboard on BG1, an
8x8 font on BG3 printing `SNESWAMP HARNESS OK`, and a 16x16 sprite you move
with the D-pad.

## Prerequisites

```sh
sudo apt install cc65 make libretro-snes9x libretro-bsnes-mercury-accuracy
pip install libretro.py pillow        # python >= 3.12
pip install pytest                    # optional
```

Only `cc65`, `make` and `python3` are needed to build the ROM; the libretro
cores and Python packages are for the tests.

## Build

```sh
cd snes
make            # -> build/sneswamp.sfc (+ .lbl labels, .map, .dbg, *.lst)
make check      # verify the header checksum
make clean
```

## Test

```sh
make test                       # builds, then runs tests/test_harness.py
python3 -m pytest tests -v      # same tests through pytest
```

The tests run the ROM in both snes9x and bsnes-mercury (accuracy), check WRAM
variables by label name, compare the rendered text against the font pixel for
pixel, and write screenshots to `build/shots/`.

## Play

`build/sneswamp.sfc` is a plain headerless 1 MiB LoROM image with a valid
checksum. Open it in any SNES emulator, e.g.

```sh
retroarch -L /usr/lib/x86_64-linux-gnu/libretro/snes9x_libretro.so build/sneswamp.sfc
snes9x-gtk build/sneswamp.sfc      # or bsnes, ares, Mesen 2 ("File > Open")
```

Mesen 2 also loads `build/sneswamp.dbg` for source-level debugging. It should
run on real hardware from a flash cart too.

## Headless runner: `tools/emu.py`

```sh
python3 tools/emu.py build/sneswamp.sfc --frames 300 \
    --input "60:+RIGHT;120:-RIGHT" --shot 299:out.png --scale 3 \
    --peek frame_counter:2 --peek sprite_x:2 --expect "sprite_x:2 == 180"
```

| option | meaning |
| --- | --- |
| `--core snes9x\|bsnes\|/path/core.so` | core to use (default snes9x; `LIBRETRO_CORE_DIR` adds a search dir) |
| `--frames N` | frames to run |
| `--input SCRIPT` / `--input-file F` | scripted input (below) |
| `--shot FRAME:PATH` | PNG after frame index FRAME has run (repeatable); 256x224 times `--scale` |
| `--peek ADDR[:SIZE]` | print a WRAM value; ADDR is a label, `label+N`, `$7E1234` or `0x10`; SIZE in bytes |
| `--expect "ADDR[:SIZE] OP VALUE"` | assert (`== != >= <= > <`); exit status 1 on failure |
| `--dump-wram PATH` | write all 128 KiB of WRAM |
| `--labels FILE` | label file (default: ROM path with `.lbl`) |

Input script: `FRAME: OPS` events separated by `;` or newlines. OPS are `+BTN`
(hold) / `-BTN` (release), separated by spaces or commas; `-ALL` releases
everything; `+A@2` is controller 2. Buttons: `B Y SELECT START UP DOWN LEFT
RIGHT A X L R`. An event at frame N is applied just before frame index N runs
(frames are counted from power-on, starting at 0).

From Python:

```python
import sys; sys.path.insert(0, "tools")
from emu import Emu

with Emu("build/sneswamp.sfc", core="bsnes") as emu:
    emu.step(30)                                # run 30 frames
    emu.press("RIGHT"); emu.step(20); emu.release("RIGHT")
    emu.step(10, buttons="A+LEFT")              # held only for these 10 frames
    emu.run(120, script="0:+B; 5:-B", shots={119: "end.png"}, relative=True)
    x = emu.peek16("sprite_x")                  # label from the .lbl file
    emu.assert_range("frame_counter", 150, 180, size=2)
    emu.assert_pixel(10, 10, (136, 48, 32))
    emu.save_screenshot("big.png", scale=4)
    emu.dump_wram("wram.bin")
```

See the docstrings in `tools/emu.py` for the full API (`poke*`, `read`,
`run_until`, `save_state`/`load_state`, `vram`, `assert_*`).

## Layout

```
Makefile          build rules
lorom.cfg         ld65 config: LoROM, 32 x 32 KiB banks (segments CODE/RODATA/
                  HEADER/VECTORS in bank 0, BANK1..BANK31 for data/far code)
src/snes.inc      hardware register equates, A8/A16/I8/I16 width macros
src/header.s      internal header ($00:FFC0) + vectors
src/init.s        reset: native mode, registers, clear WRAM/VRAM/CGRAM/OAM
src/main.s        the demo, NMI handler
assets/*.txt      pixel art as text (one hex digit per pixel)
tools/mkchr.py    text art -> SNES 2/4/8bpp tiles
tools/mkfont.py   8x8 ASCII font -> 2bpp tiles
tools/fixsum.py   header checksum fix-up / check
tools/emu.py      headless libretro runner (library + CLI)
tests/            harness tests
```

## Notes for writing code and tests

- Register widths: only switch with the `A8`/`A16`/`I8`/`I16` macros so the
  assembler and the CPU always agree; routines document the widths they expect.
- WRAM variables are found by name through `build/sneswamp.lbl`. The linker
  segments are small module-private pools: `ZEROPAGE` `$0000-$001F`, `BSS`
  `$0200-$08FF`, `BSS7E` `$7E2000-$7E3FFF`; everything shared has a fixed address
  in `src/wram.inc`; the stack is `$1F00-$1FFF`.
- The 224-line picture is scanlines 1-224: BG vertical scroll is set to -1 so
  tilemap row 0 is screen row 0, while OAM Y = n already lands on screen row n.
- Reset takes about 5 frames (the RAM clears are slow DMAs) before NMIs start,
  so `frame_counter` is ~5-6 behind `emu.frame`. Let tests warm up ~30 frames,
  then expect exactly +1 per frame.
- Input latency is zero frames in the demo: a button held before frame N is
  latched by that frame's NMI and the main loop moves the sprite within the
  same emulated frame. bsnes only polls input while the game has auto-joypad
  enabled; snes9x polls every frame.
- snes9x outputs 256x224 RGB565; bsnes-mercury outputs 512x224 XRGB8888.
  `Emu.screenshot()` normalises both to 256x224 RGB (pass `native=True` for the
  raw frame). The two expand 5-bit colour slightly differently (a few /255 apart), so
  `assert_pixel` has a tolerance.
- Set `EMU_CORE_LOG=1` to see the cores' log output on stderr (format strings
  are unexpanded: libretro.py cannot format C varargs). snes9x also printf()s
  `Map_LoROMMap` at load; emu.py routes that to stderr.
