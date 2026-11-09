#!/usr/bin/env python3
"""emu.py -- headless SNES runner for tests, built on libretro.py.

No window, no audio device: video frames are captured into memory, audio
samples are discarded, input comes from a script or from Python.

Library use
-----------
    from emu import Emu
    with Emu("build/sneswamp.sfc", core="snes9x") as emu:
        emu.step(60)                       # run 60 frames
        emu.press("RIGHT")                 # hold RIGHT from now on
        emu.step(30)
        emu.release("RIGHT")
        emu.run(100, script="10:+B; 20:-B", shots={99: "out.png"})
        x = emu.peek16("sprite_x")         # label from build/sneswamp.lbl
        emu.assert_eq("frame_counter", 186, size=2)
        emu.save_screenshot("shot.png", scale=3)
        emu.dump_wram("wram.bin")

Frame numbering
---------------
`emu.frame` is the number of frames run so far (retro_run calls).  A script
event "N: +RIGHT" is applied just before frame index N runs, i.e. when
emu.frame == N.  A screenshot "N:path" is taken just after frame index N has
run (emu.frame == N+1), so `--frames 300 --shot 299:x.png` shows the last frame.

Input script format
-------------------
    "60: +RIGHT; 90: +B; 100: -B; 200: -RIGHT"
Events are separated by ';' or newlines.  Each is "FRAME: OPS" where OPS is one
or more of +BTN (hold), -BTN (release), separated by spaces or commas.
"-ALL" releases everything.  Append "@2" for controller 2 ("+A@2").
Buttons: B Y SELECT START UP DOWN LEFT RIGHT A X L R.

CLI
---
    python3 tools/emu.py build/sneswamp.sfc --frames 300 \
        --input "60:+RIGHT;120:-RIGHT" --shot 299:out.png --peek frame_counter
"""
from __future__ import annotations

import argparse
import logging
import operator
import os
import re
import sys
from pathlib import Path
from typing import Callable, Iterable, Mapping

from libretro import Session
from libretro.api.input import DeviceIdJoypad, InputDevice
from libretro.api.video import PixelFormat
from libretro.drivers.audio.array import ArrayAudioDriver
from libretro.drivers.input.iterable import IterableInputDriver
from libretro.drivers.log.unformatted import UnformattedLogDriver
from libretro.drivers.message.logger import LoggerMessageDriver
from libretro.drivers.video.driver import FrameBufferSpecial
from libretro.drivers.video.software.array import ArrayVideoDriver

__all__ = [
    "Emu", "EmuAssertionError", "BUTTONS", "CORES", "SNES_WIDTH", "SNES_HEIGHT",
    "parse_input_script", "load_labels", "find_core", "wram_offset",
]

SNES_WIDTH = 256
SNES_HEIGHT = 224

RETRO_MEMORY_SAVE_RAM = 0
RETRO_MEMORY_SYSTEM_RAM = 2
RETRO_MEMORY_VIDEO_RAM = 3

# libretro joypad ids are named after the SNES pad, so this is 1:1.
BUTTONS: dict[str, int] = {
    "B": 0, "Y": 1, "SELECT": 2, "START": 3, "UP": 4, "DOWN": 5,
    "LEFT": 6, "RIGHT": 7, "A": 8, "X": 9, "L": 10, "R": 11,
}

CORES: dict[str, str] = {
    "snes9x": "snes9x_libretro.so",
    "bsnes": "bsnes_mercury_accuracy_libretro.so",
    "bsnes-mercury": "bsnes_mercury_accuracy_libretro.so",
}

CORE_DIRS = [
    "/usr/lib/x86_64-linux-gnu/libretro",
    "/usr/lib/aarch64-linux-gnu/libretro",
    "/usr/lib/libretro",
    "/usr/local/lib/libretro",
    str(Path.home() / ".config/retroarch/cores"),
]


class EmuAssertionError(AssertionError):
    """Raised by the Emu.assert_* helpers."""


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def find_core(core: str) -> str:
    """Resolve a core name ("snes9x", "bsnes") or path to a .so path."""
    if os.sep in core or core.endswith(".so"):
        if not os.path.exists(core):
            raise FileNotFoundError(f"libretro core not found: {core}")
        return core
    try:
        fname = CORES[core.lower()]
    except KeyError:
        raise ValueError(f"unknown core {core!r}; known: {sorted(CORES)} (or pass a .so path)")
    dirs = [d for d in os.environ.get("LIBRETRO_CORE_DIR", "").split(os.pathsep) if d] + CORE_DIRS
    for d in dirs:
        p = os.path.join(d, fname)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(f"{fname} not found in {dirs} (set LIBRETRO_CORE_DIR)")


def load_labels(path: str | os.PathLike) -> dict[str, int]:
    """Parse an ld65 -Ln (VICE) label file: lines of 'al 00ABCD .name'."""
    labels: dict[str, int] = {}
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 3 and parts[0] == "al":
                name = parts[2].lstrip(".")
                if name.startswith("@"):
                    continue            # cheap local labels are not unique
                labels.setdefault(name, int(parts[1], 16))
    return labels


def wram_offset(addr: int) -> int:
    """Map a 24-bit CPU address to an offset into the 128 KiB WRAM."""
    bank, lo = addr >> 16, addr & 0xFFFF
    if bank in (0x7E, 0x7F):
        return addr - 0x7E0000
    if (bank < 0x40 or 0x80 <= bank < 0xC0) and lo < 0x2000:
        return lo                       # low-RAM mirror
    raise ValueError(f"${addr:06X} is not a WRAM address")


_EVENT_RE = re.compile(r"^\s*(\d+)\s*:\s*(.*?)\s*$")
_OP_RE = re.compile(r"^([+-])([A-Za-z]+)(?:@(\d))?$")


def parse_input_script(script: str) -> dict[int, list[tuple[str, str, int]]]:
    """Parse "60: +RIGHT; 90: +B; 100: -B" -> {frame: [(op, button, port), ...]}.

    op is '+' or '-', button an upper-case BUTTONS key or 'ALL', port 0-based.
    """
    events: dict[int, list[tuple[str, str, int]]] = {}
    for chunk in re.split(r"[;\n]", script or ""):
        if not chunk.strip():
            continue
        m = _EVENT_RE.match(chunk)
        if not m:
            raise ValueError(f"bad input event {chunk.strip()!r} (want 'FRAME: +BTN -BTN')")
        frame = int(m.group(1))
        ops = [t for t in re.split(r"[\s,]+", m.group(2)) if t]
        if not ops:
            raise ValueError(f"input event {chunk.strip()!r} has no buttons")
        for tok in ops:
            om = _OP_RE.match(tok)
            if not om:
                raise ValueError(f"bad button op {tok!r} in {chunk.strip()!r}")
            name = om.group(2).upper()
            if name != "ALL" and name not in BUTTONS:
                raise ValueError(f"unknown button {name!r}; known: {list(BUTTONS)}")
            if name == "ALL" and om.group(1) == "+":
                raise ValueError("+ALL is not supported")
            port = int(om.group(3)) - 1 if om.group(3) else 0
            events.setdefault(frame, []).append((om.group(1), name, port))
    return events


# ---------------------------------------------------------------------------
# libretro.py drivers
# ---------------------------------------------------------------------------

class _CaptureVideo(ArrayVideoDriver):
    """Software video driver that keeps a copy of the last frame."""

    def __init__(self):
        super().__init__()
        self.last: tuple[bytes, int, int, int, PixelFormat] | None = None
        self.refresh_count = 0

    def refresh(self, data, width, height, pitch):
        self.refresh_count += 1
        if isinstance(data, memoryview):
            self.last = (bytes(data), width, height, pitch, self._pixel_format)
        elif data is FrameBufferSpecial.DUPE:
            pass                        # core repeated the previous frame

    @property
    def needs_reinit(self) -> bool:
        return False

    def reinit(self) -> None:
        pass


class _NullAudio(ArrayAudioDriver):
    """Discards audio (the stock driver buffers every sample forever)."""

    def sample(self, left, right):
        pass

    def sample_batch(self, frames):
        return len(frames) // 2


class _HeldInput(IterableInputDriver):
    """Input driver that reports whatever buttons are currently held."""

    def __init__(self):
        super().__init__()
        self.masks = [0] * 8            # per port, bit n = libretro joypad id n
        self.poll_count = 0

    def poll(self) -> None:
        self.poll_count += 1

    def state(self, port, device, index, id) -> int:
        if device != InputDevice.JOYPAD or not 0 <= port < len(self.masks):
            return 0
        mask = self.masks[port]
        if id == DeviceIdJoypad.MASK:
            return mask
        return (mask >> id) & 1 if 0 <= id < 16 else 0


class _stdout_to_stderr:
    """Send C-level stdout to stderr for a while: snes9x printf()s things like
    "Map_LoROMMap" while loading, which would pollute the CLI's stdout."""

    def __enter__(self):
        sys.stdout.flush()
        self._saved = os.dup(1)
        os.dup2(2, 1)

    def __exit__(self, *exc):
        os.dup2(self._saved, 1)
        os.close(self._saved)


def _quiet_logger() -> logging.Logger:
    """Logger for core log/message output: silent unless EMU_CORE_LOG is set."""
    log = logging.getLogger("sneswamp.emu.core")
    if not log.handlers:
        if os.environ.get("EMU_CORE_LOG"):
            log.addHandler(logging.StreamHandler(sys.stderr))
            log.setLevel(logging.DEBUG)
        else:
            log.addHandler(logging.NullHandler())
        log.propagate = False
    return log


# ---------------------------------------------------------------------------
# Emu
# ---------------------------------------------------------------------------

class Emu:
    """A running SNES core with a ROM loaded.  Use as a context manager."""

    def __init__(self, rom: str | os.PathLike, core: str = "snes9x",
                 labels: str | os.PathLike | Mapping[str, int] | None = None):
        """rom: path to .sfc.  core: "snes9x" | "bsnes" | path to a libretro .so.
        labels: ld65 -Ln file or dict; default is the ROM path with .lbl suffix."""
        self.rom = str(rom)
        self.core_name = core
        self.core_path = find_core(core)
        if not os.path.exists(self.rom):
            raise FileNotFoundError(self.rom)
        if labels is None:
            guess = Path(self.rom).with_suffix(".lbl")
            self.labels: dict[str, int] = load_labels(guess) if guess.exists() else {}
        elif isinstance(labels, Mapping):
            self.labels = dict(labels)
        else:
            self.labels = load_labels(labels)

        self.frame = 0
        self._video = _CaptureVideo()
        self._input = _HeldInput()
        self._session = Session(
            self.core_path, self.rom,
            video=self._video, input=self._input, audio=_NullAudio(),
            # NB: wrap the Logger ourselves.  Session(log=<Logger>) mis-detects
            # a Logger as a LogDriver (it has a .log method) and every core log
            # line is then dropped.
            log=UnformattedLogDriver(_quiet_logger()),
            message=LoggerMessageDriver(logger=_quiet_logger()),
        )
        with _stdout_to_stderr():
            self._session.__enter__()
        self._open = True
        self._wram = None

    # -- lifecycle ----------------------------------------------------------
    def close(self) -> None:
        if self._open:
            self._open = False
            self._wram = None
            self._session.__exit__(None, None, None)

    def __enter__(self) -> "Emu":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def reset(self) -> None:
        """Soft-reset the console (frame count is not reset)."""
        self._session.reset()

    # -- input --------------------------------------------------------------
    @staticmethod
    def _mask(buttons: Iterable[str] | str) -> int:
        if isinstance(buttons, str):
            buttons = [b for b in re.split(r"[\s,+|]+", buttons) if b]
        mask = 0
        for b in buttons:
            try:
                mask |= 1 << BUTTONS[b.upper()]
            except KeyError:
                raise ValueError(f"unknown button {b!r}; known: {list(BUTTONS)}") from None
        return mask

    def press(self, *buttons: str, port: int = 0) -> None:
        """Start holding buttons (stay held until released)."""
        self._input.masks[port] |= self._mask(buttons)

    def release(self, *buttons: str, port: int = 0) -> None:
        """Release buttons; with no arguments release everything on the port."""
        if buttons:
            self._input.masks[port] &= ~self._mask(buttons)
        else:
            self._input.masks[port] = 0

    def set_buttons(self, buttons: Iterable[str] | str = (), port: int = 0) -> None:
        """Set exactly this set of held buttons, e.g. ["A", "RIGHT"] or "A+RIGHT"."""
        self._input.masks[port] = self._mask(buttons)

    def held(self, port: int = 0) -> list[str]:
        """Names of the buttons currently held on a port."""
        return [n for n, i in BUTTONS.items() if self._input.masks[port] >> i & 1]

    def _apply(self, events: list[tuple[str, str, int]]) -> None:
        for op, name, port in events:
            if name == "ALL":
                self.release(port=port)
            elif op == "+":
                self.press(name, port=port)
            else:
                self.release(name, port=port)

    # -- running ------------------------------------------------------------
    def step(self, frames: int = 1, buttons: Iterable[str] | str | None = None) -> "Emu":
        """Run `frames` frames.  If `buttons` is given, hold exactly those
        (port 1) for the duration and restore the previous state afterwards."""
        saved = None
        if buttons is not None:
            saved = self._input.masks[0]
            self.set_buttons(buttons)
        for _ in range(frames):
            self._session.run()
            self.frame += 1
        if saved is not None:
            self._input.masks[0] = saved
        return self

    def run(self, frames: int,
            script: str | Mapping[int, list] | None = None,
            shots: Mapping[int, str | os.PathLike] | None = None,
            scale: int = 1,
            on_frame: Callable[["Emu"], object] | None = None,
            relative: bool = False) -> "Emu":
        """Run `frames` frames with scripted input and screenshots.

        script:   input script string (see module doc) or parse_input_script() dict.
        shots:    {frame_index: png_path}; saved right after that frame has run.
        on_frame: called as on_frame(emu) after every frame (programmatic input,
                  per-frame asserts...).  Return False to stop early.
        relative: frame numbers in script/shots count from the current frame
                  instead of from power-on.
        """
        events = parse_input_script(script) if isinstance(script, str) else dict(script or {})
        shots = dict(shots or {})
        base = self.frame if relative else 0
        for _ in range(frames):
            idx = self.frame - base
            if idx in events:
                self._apply(events[idx])
            self._session.run()
            self.frame += 1
            if idx in shots:
                self.save_screenshot(shots[idx], scale=scale)
            if on_frame is not None and on_frame(self) is False:
                break
        return self

    def run_until(self, predicate: Callable[["Emu"], bool], max_frames: int = 600) -> int:
        """Step until predicate(emu) is true; return frames taken.
        Raises EmuAssertionError after max_frames."""
        for n in range(max_frames + 1):
            if predicate(self):
                return n
            self.step()
        raise EmuAssertionError(f"condition not met within {max_frames} frames")

    # -- video --------------------------------------------------------------
    @property
    def has_video(self) -> bool:
        return self._video.last is not None

    def frame_info(self) -> dict:
        """Raw geometry/pixel format of the last frame the core produced."""
        if self._video.last is None:
            raise RuntimeError("no video frame yet; run at least one frame")
        _, w, h, pitch, fmt = self._video.last
        return {"width": w, "height": h, "pitch": pitch, "pixel_format": fmt.name}

    def screenshot(self, scale: int = 1, native: bool = False):
        """Last frame as a PIL RGB image.

        Normalised to 256x224 (bsnes always outputs 512 wide; pixel-doubled
        output is decimated) unless native=True.  scale = integer upscale."""
        from PIL import Image
        if self._video.last is None:
            raise RuntimeError("no video frame yet; run at least one frame")
        data, w, h, pitch, fmt = self._video.last
        if fmt == PixelFormat.XRGB8888:
            img = Image.frombuffer("RGB", (w, h), data, "raw", "BGRX", pitch, 1)
        elif fmt == PixelFormat.RGB565:
            img = Image.frombuffer("RGB", (w, h), data, "raw", "BGR;16", pitch, 1)
        else:  # 0RGB1555
            img = Image.frombuffer("RGB", (w, h), data, "raw", "BGR;15", pitch, 1)
        img = img.copy()
        if not native:
            if w >= 2 * SNES_WIDTH or h > 240:
                img = img.resize((w // 2 if w >= 2 * SNES_WIDTH else w,
                                  h // 2 if h > 240 else h), Image.NEAREST)
        if scale and scale > 1:
            img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        return img

    def save_screenshot(self, path: str | os.PathLike, scale: int = 1, native: bool = False) -> str:
        """Save the last frame as PNG (creates parent directories)."""
        path = str(path)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.screenshot(scale=scale, native=native).save(path)
        return path

    def pixel(self, x: int, y: int) -> tuple[int, int, int]:
        """RGB of a pixel in the normalised 256x224 frame."""
        return self.screenshot().getpixel((x, y))

    # -- memory -------------------------------------------------------------
    @property
    def wram(self) -> memoryview:
        """Live, writable view of the 128 KiB WRAM ($7E0000-$7FFFFF)."""
        if self._wram is None:
            mem = self._session.core.get_memory(RETRO_MEMORY_SYSTEM_RAM)
            if mem is None or len(mem) < 0x20000:
                raise RuntimeError("core does not expose SYSTEM_RAM")
            self._wram = mem
        return self._wram

    @property
    def vram(self) -> memoryview:
        """Live view of the 64 KiB VRAM (byte-addressed: word address * 2)."""
        mem = self._session.core.get_memory(RETRO_MEMORY_VIDEO_RAM)
        if mem is None:
            raise RuntimeError("core does not expose VIDEO_RAM")
        return mem

    def addr(self, where: int | str) -> int:
        """Resolve a label name, "$7E0010"/"0x10" string, or int to a CPU address.
        "label+N" offsets are allowed."""
        if isinstance(where, int):
            return where
        s = where.strip()
        off = 0
        if "+" in s:
            s, o = s.split("+", 1)
            off = int(o.strip().replace("$", "0x"), 0)
            s = s.strip()
        if s in self.labels:
            return self.labels[s] + off
        try:
            return int(s.replace("$", "0x"), 0) + off
        except ValueError:
            raise KeyError(f"unknown label {s!r} (labels loaded: {len(self.labels)})") from None

    def _span(self, where: int | str, length: int) -> int:
        """WRAM offset of `where`, checking that `length` bytes fit."""
        o = wram_offset(self.addr(where))
        if length < 0 or o + length > len(self.wram):
            raise ValueError(f"{self._name(where)} + {length} bytes runs past the end of WRAM")
        return o

    def read(self, where: int | str, length: int) -> bytes:
        """Read `length` bytes of WRAM at an address or label."""
        o = self._span(where, length)
        return bytes(self.wram[o:o + length])

    def peek(self, where: int | str, size: int = 1) -> int:
        """Read a little-endian unsigned value of `size` bytes."""
        return int.from_bytes(self.read(where, size), "little")

    def peek8(self, where: int | str) -> int:
        return self.peek(where, 1)

    def peek16(self, where: int | str) -> int:
        return self.peek(where, 2)

    def peek24(self, where: int | str) -> int:
        return self.peek(where, 3)

    def poke(self, where: int | str, value: int, size: int = 1) -> None:
        """Write a little-endian value into WRAM."""
        o = self._span(where, size)
        self.wram[o:o + size] = value.to_bytes(size, "little")

    def poke8(self, where: int | str, value: int) -> None:
        self.poke(where, value, 1)

    def poke16(self, where: int | str, value: int) -> None:
        self.poke(where, value, 2)

    def wram_bytes(self) -> bytes:
        """Snapshot of all 128 KiB of WRAM."""
        return bytes(self.wram)

    def dump_wram(self, path: str | os.PathLike) -> str:
        """Write all of WRAM to a file (offset 0 = $7E0000)."""
        path = str(path)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "wb") as f:
            f.write(self.wram_bytes())
        return path

    # -- savestates ---------------------------------------------------------
    def save_state(self) -> bytes:
        size = self._session.core.serialize_size()
        buf = bytearray(size)
        if not self._session.core.serialize(buf):
            raise RuntimeError("core failed to serialize state")
        return bytes(buf)

    def load_state(self, state: bytes) -> None:
        if not self._session.core.unserialize(state):
            raise RuntimeError("core failed to load state")
        self._wram = None

    # -- assertions ---------------------------------------------------------
    def _fail(self, text: str, msg: str | None) -> None:
        raise EmuAssertionError(f"[{self.core_name} frame {self.frame}] {text}"
                                + (f": {msg}" if msg else ""))

    def _name(self, where: int | str) -> str:
        return where if isinstance(where, str) else f"${where:06X}"

    def assert_eq(self, where: int | str, expected: int, size: int = 1, msg: str | None = None) -> int:
        v = self.peek(where, size)
        if v != expected:
            self._fail(f"{self._name(where)} = {v} (${v:X}), expected {expected} (${expected:X})", msg)
        return v

    def assert_ne(self, where: int | str, unexpected: int, size: int = 1, msg: str | None = None) -> int:
        v = self.peek(where, size)
        if v == unexpected:
            self._fail(f"{self._name(where)} = {v} (${v:X}), expected anything else", msg)
        return v

    def assert_range(self, where: int | str, lo: int, hi: int, size: int = 1, msg: str | None = None) -> int:
        """Assert lo <= value <= hi."""
        v = self.peek(where, size)
        if not lo <= v <= hi:
            self._fail(f"{self._name(where)} = {v}, expected {lo}..{hi}", msg)
        return v

    def assert_bytes(self, where: int | str, expected: bytes, msg: str | None = None) -> None:
        got = self.read(where, len(expected))
        if got != bytes(expected):
            self._fail(f"{self._name(where)} = {got.hex()}, expected {bytes(expected).hex()}", msg)

    def assert_pixel(self, x: int, y: int, rgb: tuple[int, int, int], tol: int = 8,
                     msg: str | None = None) -> None:
        """Assert a pixel colour, within `tol` per channel (cores differ in
        how they expand 5-bit colour to 8 bits)."""
        got = self.pixel(x, y)
        if any(abs(a - b) > tol for a, b in zip(got, rgb)):
            self._fail(f"pixel ({x},{y}) = {got}, expected {tuple(rgb)} +-{tol}", msg)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

_OPS = {"==": operator.eq, "!=": operator.ne, ">=": operator.ge,
        "<=": operator.le, ">": operator.gt, "<": operator.lt}


def _split_spec(spec: str) -> tuple[str, int]:
    """'label', 'label:2', '$7E0010:1' -> (where, size)."""
    if ":" in spec:
        where, size = spec.rsplit(":", 1)
        return where.strip(), int(size)
    return spec.strip(), 1


def _num(text: str) -> int:
    return int(text.strip().replace("$", "0x"), 0)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Run a SNES ROM headlessly (libretro) with scripted input.",
        epilog='example: emu.py build/sneswamp.sfc --frames 300 '
               '--input "60:+RIGHT;120:-RIGHT" --shot 299:out.png --peek frame_counter:2')
    ap.add_argument("rom")
    ap.add_argument("--core", default="snes9x", help="snes9x (default), bsnes, or path to a libretro .so")
    ap.add_argument("--frames", type=int, default=60, help="frames to run (default 60)")
    ap.add_argument("--input", default="", help='input script, e.g. "60:+RIGHT; 90:+B; 100:-B"')
    ap.add_argument("--input-file", help="read the input script from a file")
    ap.add_argument("--shot", action="append", default=[], metavar="FRAME:PATH",
                    help="save a PNG after frame FRAME (repeatable)")
    ap.add_argument("--scale", type=int, default=1, help="integer upscale for screenshots")
    ap.add_argument("--peek", action="append", default=[], metavar="ADDR[:SIZE]",
                    help="print WRAM value at label or address after the run (repeatable; size in bytes, default 1)")
    ap.add_argument("--expect", action="append", default=[], metavar="'ADDR[:SIZE] OP VALUE'",
                    help='assert after the run, e.g. "sprite_x:2 > 120" (ops == != >= <= > <)')
    ap.add_argument("--dump-wram", metavar="PATH", help="write the 128 KiB WRAM after the run")
    ap.add_argument("--labels", help="ld65 -Ln label file (default: ROM path with .lbl)")
    a = ap.parse_args(argv)

    script = a.input
    if a.input_file:
        with open(a.input_file) as f:
            script = f.read() + ";" + script
    shots = {}
    for s in a.shot:
        frame, _, path = s.partition(":")
        if not path:
            ap.error(f"--shot wants FRAME:PATH, got {s!r}")
        shots[int(frame)] = path
        if int(frame) >= a.frames:
            ap.error(f"--shot frame {frame} is never reached with --frames {a.frames}")

    status = 0
    with Emu(a.rom, core=a.core, labels=a.labels) as emu:
        emu.run(a.frames, script=script, shots=shots, scale=a.scale)
        for path in shots.values():
            print(f"shot {path}")
        for spec in a.peek:
            where, size = _split_spec(spec)
            v = emu.peek(where, size)
            print(f"{where} = {v} (${v:0{size * 2}X})")
        for exp in a.expect:
            m = re.match(r"^(.*?)\s*(==|!=|>=|<=|>|<)\s*(\S+)$", exp.strip())
            if not m:
                ap.error(f"bad --expect {exp!r}")
            where, size = _split_spec(m.group(1))
            v, want = emu.peek(where, size), _num(m.group(3))
            ok = _OPS[m.group(2)](v, want)
            print(f"{'PASS' if ok else 'FAIL'} {where} = {v} (want {m.group(2)} {want})")
            status |= not ok
        if a.dump_wram:
            print(f"wram {emu.dump_wram(a.dump_wram)}")
    return int(status)


if __name__ == "__main__":
    sys.exit(main())
