#!/usr/bin/env python3
"""mkassets.py -- SNESWAMP art converter (owner A; contract: docs/ARCHITECTURE.md section 2).

Reads the real WAMP art under /home/user/wamp/public/assets (override: --assets)
and writes everything below into build/gen (override: --out).  Output is fully
deterministic (fixed packing seed, no timestamps).

usage:
    mkassets.py [--assets DIR] [--out build/gen]       convert
    mkassets.py --preview build/preview [--out DIR]    convert, then render contact
        sheets (tilelib.png, player.png, objects.png, hud.png, palettes.png) by
        DECODING THE GENERATED BINARIES with the generated BGR555 palettes.

Generated ca65 sources (each selects its own segments, .incbin's its binaries):
    tilelib.inc   TILELIB_COUNT, TILELIB_VERSION, TileLibPal; chr in TILELIB0..3
    gfxsys.inc    FontChr, HudChr, Bg3Palettes, BgPalettes, ObjPalettes
    player.inc    PLAYER_FRAME_COUNT, PlayerFrameTable, PlayerAnimTable, PlayerAnimFrames
    objects.inc   ObjGfxTable (+ sequence and piece lists)
Binaries: tilelib.bin tilelibpal.bin font.bin hudchr.bin bg3pal.bin bgpal.bin
    objpal.bin player<k>.bin objgfx<k>.bin
Tooling JSON:
    tilelib_map.json   {"<gid>": libraryId}                  (contract, section 2)
    tile_library.json  richer per-gid table for the room compiler (schema below)
    player.json        frame/cell/animation tables (used by preview and tests)
    objects.json       per object type: id, rows, alias, palette, pieces, sequence
                       (the room compiler needs "rows"/"alias" for the 28-row check)

tile_library.json schema (defined here; the contract leaves it open):
    {
      "version": TILELIB_VERSION, "count": TILELIB_COUNT,
      "collision_classes": {"TC_EMPTY": 0, ...},            # constants.inc values
      "ranges": [{"tileset", "file", "first_gid", "last_gid", "first_id", "columns"}],
      "tiles": {
        "<gid>": {
          "id": library id (1..572),
          "palette": BG palette 2..7 (0 = blank atlas cell),
          "blank": true if the atlas cell has no opaque pixel,
          "tileset": "forest" | ... | "special" | ...,
          "quantised": true if the art was colour-reduced (special tiles only),
          "special": special-tile kind name or null,
          "ruleset_v0": false for special kinds outside ruleset v0,
          "collision": "TC_*" name or null
        }
      }
    }
  "collision": for the eight ruleset-v0 special gids it is the fixed class of
  the kind (670 TC_ONEWAY, 672/673 TC_CONV_L/R, 674 TC_ICE, 676 TC_BOUNCE,
  677 TC_DAMAGE, 682 TC_WATER, 687 TC_CRUMBLE).  For every other gid it is
  TC_SOLID / TC_EMPTY taken from tools/tilemeta.json ("solid") when that file
  exists, else null.  It is the class of the gid ON THE TERRAIN LAYER, alone in
  its cell; the per-cell merge rules of contract 3.2 stay in mkrooms.py, and
  tools/tilemeta.json remains the collision source of truth.
"""
import argparse
import json
import os
import random
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkfont  # noqa: E402  (8x8 font, contract 2: "from tools/mkfont.py")

DEFAULT_ASSETS = "/home/user/wamp/public/assets"
DEFAULT_OUT = os.path.join(os.path.dirname(HERE), "build", "gen")

TILELIB_VERSION = 1
TILELIB_COUNT = 573
BANK_SIZE = 0x8000

# (tileset, file, first gid, last gid, first library id)   -- contract 2.1
TILE_RANGES = [
    ("forest", "tilesets/tileset_forest.png", 1, 72, 1),
    ("desert", "tilesets/tileset_desert.png", 73, 144, 73),
    ("lava", "tilesets/tileset_lava.png", 217, 321, 145),
    ("snow", "tilesets/tileset_snow.png", 322, 387, 250),
    ("water", "tilesets/tileset_water.png", 388, 459, 316),
    ("essentials", "tilesets/beginner.png", 492, 536, 388),
    ("special", "tilesets/special-traversal-v1.png", 669, 732, 433),
    ("autotile-edge-cases-desert", "tilesets/autotile-edge-cases-desert.png", 2073, 2076, 497),
    ("autotile-artist-extras", "tilesets/rr_extras.png", 2077, 2148, 501),
]

TC = {"TC_EMPTY": 0x00, "TC_DAMAGE": 0x01, "TC_WATER": 0x02, "TC_ONEWAY": 0x03,
      "TC_ONEWAY_WATER": 0x04, "TC_SOLID": 0x80, "TC_ICE": 0x81, "TC_BOUNCE": 0x82,
      "TC_CRUMBLE": 0x83, "TC_CONV_L": 0x84, "TC_CONV_R": 0x85, "TC_SOLID_DAMAGE": 0x86}

# special gid -> (kind, in ruleset v0, collision class)
SPECIAL_KINDS = {
    669: ("brick", False, None), 670: ("oneWayPlatform", True, "TC_ONEWAY"),
    671: ("movingPlatformTile", False, None),
    672: ("conveyorLeft", True, "TC_CONV_L"), 673: ("conveyorRight", True, "TC_CONV_R"),
    674: ("ice", True, "TC_ICE"), 675: ("sticky", False, None),
    676: ("bounce", True, "TC_BOUNCE"), 677: ("damage", True, "TC_DAMAGE"),
    678: ("gravityUp", False, None), 679: ("gravityDown", False, None),
    680: ("gravityLeft", False, None), 681: ("gravityRight", False, None),
    682: ("water", True, "TC_WATER"), 683: ("windLeft", False, None),
    684: ("windRight", False, None), 687: ("crumbling", True, "TC_CRUMBLE"),
}
RULESET_SPECIAL_GIDS = [g for g, v in SPECIAL_KINDS.items() if v[1]]

# Object types (constants.inc OT_*)
OT = {"coin_gold": 1, "coin_silver": 2, "gem": 3, "heart": 4, "key": 5, "star": 6,
      "spikes": 7, "saw": 8, "fire": 9, "bounce_pad": 10, "ladder": 11,
      "checkpoint_flag": 12, "door_locked": 13, "crate": 14, "slime_blue": 15,
      "slime_red": 16, "bat": 17, "crab": 18, "frog": 19, "exit": 20, "sprint_cp": 21}
OT_COUNT = 22
OG_ALIAS = 0x80
PL_MAX_CELLS = 12
PL_MAX_LINE_CELLS = 5

# Player animations: PA_* order (constants.inc), (name, sheet, frames, hold, loop)
PLAYER_ANIMS = [
    ("idle", "base", list(range(0, 7)), 8, 1),
    ("run", "base", list(range(15, 23)), 5, 1),
    ("jump_rise", "base", [32], 8, 1),
    ("jump_fall", "base", [34], 8, 1),
    ("land", "base", [35, 36], 4, 0),
    ("wall_slide", "base", list(range(107, 113)), 6, 1),
    ("wall_jump", "base", list(range(113, 124)), 4, 1),
    ("stomp_flip", "base", list(range(115, 122)), 2, 0),
    ("ladder", "base", list(range(124, 132)), 6, 1),
    ("crouch", "base", list(range(51, 57)), 6, 0),
    ("crawl", "base", list(range(57, 65)), 5, 1),
    ("slash", "combat", list(range(89, 94)), 3, 0),
    ("slash_down", "combat", list(range(107, 113)), 3, 0),
]
PLAYER_SHEETS = {
    "base": ("player/default/PlayerSheet", "Player "),
    "combat": ("player/default/PlayerCombatActionsSheet", "PlayerCombat "),
}
PL_ANCHOR_X = 48          # canvas column of the body centre line
PL_ANCHOR_Y = 82          # canvas row of the feet point (canvas bottom 84 = feet + 2)
PL_GRID_X = (16, 32, 48, 64)
PL_GRID_Y = (36, 52, 68)


# ---------------------------------------------------------------------------
# pixels, colours, chars
# ---------------------------------------------------------------------------
def bgr555(r, g, b):
    return ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3)


def rgb_of(c):
    """BGR555 -> displayed RGB (5 bits expanded to 8)."""
    r, g, b = c & 31, (c >> 5) & 31, (c >> 10) & 31
    return ((r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2))


def hexcol(s):
    s = s.lstrip("#")
    return bgr555(int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


_img_cache = {}


def load_rgba(root, rel):
    key = (root, rel)
    if key not in _img_cache:
        _img_cache[key] = Image.open(os.path.join(root, rel)).convert("RGBA")
    return _img_cache[key]


def grab(img, x0, y0, w, h, raw=False):
    """Rows of BGR555 ints (None = transparent, alpha < 128).  raw: (r,g,b) tuples."""
    px = img.load()
    W, H = img.size
    out = []
    for y in range(y0, y0 + h):
        row = []
        for x in range(x0, x0 + w):
            if 0 <= x < W and 0 <= y < H:
                r, g, b, a = px[x, y]
                if a >= 128:
                    row.append((r, g, b) if raw else bgr555(r, g, b))
                    continue
            row.append(None)
        out.append(row)
    return out


def colours_of(grid):
    return frozenset(c for row in grid for c in row if c is not None)


def hmirror(grid):
    return [row[::-1] for row in grid]


def to_index(grid, pal):
    """pal: list of colours for indices 1..n."""
    lut = {c: i + 1 for i, c in enumerate(pal)}
    return [[0 if c is None else lut[c] for c in row] for row in grid]


def enc_char(idx, x0, y0, bpp=4):
    """One 8x8 char from an index grid -> SNES planar bytes."""
    out = bytearray()
    for pair in range(bpp // 2):
        for y in range(8):
            b0 = b1 = 0
            for x in range(8):
                v = idx[y0 + y][x0 + x] >> (pair * 2)
                b0 = (b0 << 1) | (v & 1)
                b1 = (b1 << 1) | ((v >> 1) & 1)
            out += bytes((b0, b1))
    return bytes(out)


def dec_char(data, bpp=4):
    """SNES planar char -> 8 rows of 8 colour indices."""
    rows = []
    for y in range(8):
        row = []
        for x in range(8):
            v = 0
            for pair in range(bpp // 2):
                b0 = data[pair * 16 + y * 2]
                b1 = data[pair * 16 + y * 2 + 1]
                v |= ((b0 >> (7 - x)) & 1) << (pair * 2)
                v |= ((b1 >> (7 - x)) & 1) << (pair * 2 + 1)
            row.append(v)
        rows.append(row)
    return rows


def enc_tile16(idx, x0=0, y0=0):
    """16x16 -> 128 bytes TL, TR, BL, BR."""
    return (enc_char(idx, x0, y0) + enc_char(idx, x0 + 8, y0) +
            enc_char(idx, x0, y0 + 8) + enc_char(idx, x0 + 8, y0 + 8))


def dec_tile16(data):
    """128 bytes TL, TR, BL, BR -> 16 rows of 16 indices."""
    tl, tr, bl, br = (dec_char(data[i * 32:(i + 1) * 32]) for i in range(4))
    return [tl[y] + tr[y] for y in range(8)] + [bl[y] + br[y] for y in range(8)]


def pal_bytes(pals, count):
    """pals: {number: [colours for index 1..]} -> count*16 little-endian words."""
    out = bytearray()
    for p in range(count):
        cols = [0] + list(pals.get(p, []))
        cols += [0] * (16 - len(cols))
        for c in cols:
            out += bytes((c & 255, c >> 8))
    return bytes(out)


def read_pals(data):
    n = len(data) // 2
    w = [data[i * 2] | (data[i * 2 + 1] << 8) for i in range(n)]
    return w


# ---------------------------------------------------------------------------
# palette packing
# ---------------------------------------------------------------------------
def pack_palettes(sets, max_pals, what, cap=15, tries=400, seed=20240521):
    """Group colour sets into <= max_pals palettes of <= cap colours.
    Returns a list of sorted colour lists.  Deterministic."""
    uniq = sorted(set(sets), key=lambda s: (-len(s), sorted(s)))
    for s in uniq:
        if len(s) > cap:
            raise SystemExit("mkassets: %s: a tile/sprite needs %d colours (max %d)"
                             % (what, len(s), cap))
    maximal = [s for s in uniq if not any(s < t for t in uniq)]
    rng = random.Random(seed)
    best = None
    for t in range(tries):
        order = list(maximal)
        if t:
            rng.shuffle(order)
            order.sort(key=lambda s: -len(s) + rng.random() * (t % 4))
        bins = []
        for s in order:
            cand = None
            for b in bins:
                grow = len(s - b)
                if len(b) + grow <= cap and (cand is None or grow < cand[0]):
                    cand = (grow, b)
            if cand:
                cand[1].update(s)
            else:
                bins.append(set(s))
        score = (len(bins), sum(len(b) for b in bins))
        if best is None or score < best[0]:
            best = (score, bins)
    bins = best[1]
    if len(bins) > max_pals:
        raise SystemExit("mkassets: %s does not pack into %d palettes (needs %d)"
                         % (what, max_pals, len(bins)))
    return [sorted(b) for b in bins]


def pal_for(cset, pals):
    """First palette number (dict order) containing the colour set."""
    for num in sorted(pals):
        if cset <= set(pals[num]):
            return num
    raise SystemExit("mkassets: internal: no palette holds a colour set")


# ---------------------------------------------------------------------------
# tile library
# ---------------------------------------------------------------------------
def nearest_quantise(raw, pal):
    """raw: grid of (r,g,b)/None -> (grid of palette colours, squared error)."""
    prgb = [(c, rgb_of(c)) for c in pal]
    out, err = [], 0
    memo = {}
    for row in raw:
        o = []
        for p in row:
            if p is None:
                o.append(None)
                continue
            if p not in memo:
                bd = None
                for c, (r, g, b) in prgb:
                    d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2
                    if bd is None or d < bd[0]:
                        bd = (d, c)
                memo[p] = bd
            err += memo[p][0]
            o.append(memo[p][1])
        out.append(o)
    return out, err


def build_tilelib(assets):
    tiles = {}          # id -> dict(gid, tileset, grid | raw)
    ranges = []
    for name, rel, g0, g1, id0 in TILE_RANGES:
        img = load_rgba(assets, rel)
        cols = img.width // 16
        n = cols * (img.height // 16)
        if n != g1 - g0 + 1:
            raise SystemExit("mkassets: %s has %d cells, contract says %d" % (rel, n, g1 - g0 + 1))
        ranges.append({"tileset": name, "file": rel, "first_gid": g0, "last_gid": g1,
                       "first_id": id0, "columns": cols})
        for k in range(n):
            x0, y0 = (k % cols) * 16, (k // cols) * 16
            t = {"gid": g0 + k, "tileset": name, "quantised": False}
            if name == "special":
                t["raw"] = grab(img, x0, y0, 16, 16, raw=True)
            else:
                t["grid"] = grab(img, x0, y0, 16, 16)
            tiles[id0 + k] = t
    if max(tiles) + 1 != TILELIB_COUNT:
        raise SystemExit("mkassets: TILELIB_COUNT mismatch")

    exact = [t for t in tiles.values() if "grid" in t]
    packed = pack_palettes([colours_of(t["grid"]) for t in exact if colours_of(t["grid"])],
                           6, "tile library")
    # number palettes 2.. in order of the lowest library id that needs them
    def first_use(p):
        ps = set(p)
        return min(i for i, t in tiles.items() if "grid" in t and colours_of(t["grid"])
                   and colours_of(t["grid"]) <= ps)
    packed.sort(key=first_use)
    pals = {2 + i: p for i, p in enumerate(packed)}

    for t in tiles.values():
        if "grid" in t:
            cs = colours_of(t["grid"])
            t["palette"] = pal_for(cs, pals) if cs else 0
        else:
            # special atlas: anti-aliased art -> nearest colours of the best BG palette
            if not any(p is not None for row in t["raw"] for p in row):
                t["grid"], t["palette"] = [[None] * 16 for _ in range(16)], 0
                continue
            best = None
            for num in sorted(pals):
                grid, err = nearest_quantise(t["raw"], pals[num])
                if best is None or err < best[0]:
                    best = (err, num, grid)
            t["grid"], t["palette"], t["quantised"] = best[2], best[1], True
            t["qerr"] = best[0]

    chr_ = bytearray(TILELIB_COUNT * 128)
    palmap = bytearray(TILELIB_COUNT)
    for i, t in tiles.items():
        if t["palette"]:
            idx = to_index(t["grid"], pals[t["palette"]])
            chr_[i * 128:(i + 1) * 128] = enc_tile16(idx)
            palmap[i] = t["palette"]
    return tiles, pals, bytes(chr_), bytes(palmap), ranges


# ---------------------------------------------------------------------------
# player
# ---------------------------------------------------------------------------
def player_cells(grid):
    """-> list of (gx, gy) canvas top-left of 16x16 cells, row-major."""
    H, W = len(grid), len(grid[0])
    opaque = [(x, y) for y in range(H) for x in range(W) if grid[y][x] is not None]
    if not opaque:
        raise SystemExit("mkassets: empty player frame")
    x0 = min(p[0] for p in opaque); x1 = max(p[0] for p in opaque) + 1
    y0 = min(p[1] for p in opaque); y1 = max(p[1] for p in opaque) + 1
    if x0 >= PL_GRID_X[0] and x1 <= PL_GRID_X[-1] + 16 and y0 >= PL_GRID_Y[0] and y1 <= PL_GRID_Y[-1] + 16:
        cells = []
        for gy in PL_GRID_Y:
            for gx in PL_GRID_X:
                if any(grid[y][x] is not None for y in range(gy, gy + 16) for x in range(gx, gx + 16)):
                    cells.append((gx, gy))
        return cells, "grid"
    # greedy row cover: best y offset, then per band cells at the first uncovered column
    best = None
    for off in range(16):
        top = y0 - off
        cells = []
        gy = top
        while gy < y1:
            colset = sorted({x for (x, y) in opaque if gy <= y < gy + 16})
            nxt = -1
            for x in colset:
                if x >= nxt:
                    cells.append((x, gy))
                    nxt = x + 16
            gy += 16
        if best is None or len(cells) < len(best):
            best = cells
    return best, "cover"


def build_player(assets):
    frames = []         # dict(sheet, index, cells, grid)
    index = {}
    anims = []
    sheets = {}
    for name, sheet, idxs, hold, loop in PLAYER_ANIMS:
        if sheet not in sheets:
            rel, prefix = PLAYER_SHEETS[sheet]
            with open(os.path.join(assets, rel + ".json")) as f:
                sheets[sheet] = (load_rgba(assets, rel + ".png"), json.load(f)["frames"], prefix)
        img, meta, prefix = sheets[sheet]
        lst = []
        for i in idxs:
            key = (sheet, i)
            if key not in index:
                fr = meta["%s%d.aseprite" % (prefix, i)]["frame"]
                if (fr["w"], fr["h"]) != (96, 84):
                    raise SystemExit("mkassets: player frame %s %d is not 96x84" % key)
                grid = grab(img, fr["x"], fr["y"], 96, 84)
                cells, mode = player_cells(grid)
                if len(cells) > PL_MAX_CELLS:
                    raise SystemExit("mkassets: player frame %s %d needs %d cells (max %d)"
                                     % (sheet, i, len(cells), PL_MAX_CELLS))
                line = max(sum(1 for (_, gy) in cells if gy <= y < gy + 16) for y in range(-32, 120))
                if line > PL_MAX_LINE_CELLS:
                    raise SystemExit("mkassets: player frame %s %d has %d cells on a scanline"
                                     % (sheet, i, line))
                index[key] = len(frames)
                frames.append({"sheet": sheet, "index": i, "cells": cells, "grid": grid,
                               "mode": mode, "line": line})
            lst.append(index[key])
        anims.append({"name": name, "frames": lst, "hold": hold, "loop": loop})

    cols = {}
    for f in frames:
        for row in f["grid"]:
            for c in row:
                if c is not None:
                    cols[c] = cols.get(c, 0) + 1
    pal = sorted(cols, key=lambda c: (-cols[c], c))
    if len(pal) > 15:
        raise SystemExit("mkassets: player needs %d colours" % len(pal))

    banks = [bytearray()]
    for f in frames:
        g = f["grid"]

        def cell_idx(gx, gy):
            sub = [[(g[y][x] if 0 <= y < 84 and 0 <= x < 96 else None)
                    for x in range(gx, gx + 16)] for y in range(gy, gy + 16)]
            return to_index(sub, pal)
        idxs = [cell_idx(gx, gy) for gx, gy in f["cells"]]
        data = bytearray()
        for grp in (idxs[:8], idxs[8:]):
            for half in (0, 8):
                for ci in grp:
                    data += enc_char(ci, 0, half) + enc_char(ci, 8, half)
        assert len(data) == len(idxs) * 128
        if len(banks[-1]) + len(data) > BANK_SIZE:
            banks.append(bytearray())
        f["bank"] = len(banks) - 1
        f["addr"] = 0x8000 + len(banks[-1])
        banks[-1] += data
        f["offsets"] = [(gx - PL_ANCHOR_X, gy - PL_ANCHOR_Y) for gx, gy in f["cells"]]
        for dx, dy in f["offsets"]:
            if not (-128 <= dx <= 127 and -128 <= dy <= 127):
                raise SystemExit("mkassets: player cell offset out of range")
    if len(banks) > 4:
        raise SystemExit("mkassets: player chr needs %d banks (max 4)" % len(banks))
    return frames, anims, pal, [bytes(b) for b in banks]


# ---------------------------------------------------------------------------
# objects
# ---------------------------------------------------------------------------
def _sheet_frame(img, fw, fh, i):
    cols = img.width // fw
    return grab(img, (i % cols) * fw, (i // cols) * fh, fw, fh)


def _blit(canvas, grid, x0, y0):
    for y, row in enumerate(grid):
        for x, c in enumerate(row):
            canvas[y0 + y][x0 + x] = c


def _crop(grid, x0, y0, w, h):
    out = []
    for y in range(y0, y0 + h):
        out.append([(grid[y][x] if 0 <= y < len(grid) and 0 <= x < len(grid[0]) else None)
                    for x in range(x0, x0 + w)])
    return out


def build_object_defs(assets):
    """-> {name: dict(rows, stride, seq, hold, pieces, canvas, src=[...])}.
    canvas = strip image: 128 px wide, rows*8 px tall, colours/None.
    src = for tests: list of (strip frame, source file, frame w, h, sheet frame, mirrored)."""
    defs = {}

    def new(name, rows, stride, seq, hold, pieces):
        d = {"rows": rows, "stride": stride, "seq": list(seq), "hold": hold,
             "pieces": pieces, "canvas": [[None] * 128 for _ in range(rows * 8)], "src": []}
        defs[name] = d
        return d

    def small(name, rel, sheet_frames, hold, dy, mirror=False, seq=None):
        img = load_rgba(assets, rel)
        d = new(name, 2, 2, seq or range(len(sheet_frames)), hold, [(-8, dy, 0, 0)])
        for k, sf in enumerate(sheet_frames):
            g = _sheet_frame(img, 16, 16, sf)
            _blit(d["canvas"], hmirror(g) if mirror else g, 16 * k, 0)
            d["src"].append((k, rel, 16, 16, sf, mirror))

    def large(name, rel, sheet_frames, hold, dx, dy, seq=None, fw=32, crop=0):
        img = load_rgba(assets, rel)
        d = new(name, 4, 4, seq or range(len(sheet_frames)), hold, [(dx, dy, 0, 1)])
        for k, sf in enumerate(sheet_frames):
            g = _sheet_frame(img, fw, fw, sf)
            if crop:
                g = _crop(g, crop, crop, 32, 32)
            _blit(d["canvas"], g, 32 * k, 0)
            d["src"].append((k, rel, fw, fw, sf, False))

    # frame top-left relative to the anchor = (-fw/2 - ax, -fh/2 - ay)   (contract 2.3 / 6.2)
    small("coin_gold", "objects/coin_gold.png", range(8), 6, -14)
    small("coin_silver", "objects/coin_silver.png", range(8), 6, -14)
    small("gem", "objects/gem.png", range(5), 8, -14)
    small("heart", "objects/heart.png", range(8), 8, -14)
    small("key", "objects/key.png", range(8), 8, -14)
    small("star", "objects/star.png", range(8), 8, -14)
    small("spikes", "enemies/spikes.png", range(4), 8, -16)
    small("fire", "enemies/fire.png", range(6), 6, -15)
    small("slime_blue", "enemies/slime_blue.png", range(5), 10, -16, mirror=True)
    small("slime_red", "enemies/slime_red.png", range(5), 10, -16, mirror=True)
    large("saw", "enemies/saw.png", [0, 2, 3], 8, -16, -28, seq=[0, 1, 2, 1], fw=34, crop=1)
    large("checkpoint_flag", "objects/flag.png", [0, 2, 4, 6], 15, -16, -32)
    large("exit", "objects/flag-checkered.png", [0, 2, 4, 6], 15, -16, -30)
    large("bat", "enemies/bat.png", [4, 5, 6, 7], 8, -16, -26, seq=[0, 1, 2, 3, 2, 1])
    large("frog", "enemies/frog.png", [0, 1, 2, 3], 10, -16, -32)

    # bounce pad: 16x32 frame, two small pieces stacked on screen, side by side in the strip
    img = load_rgba(assets, "objects/bounce_pad.png")
    d = new("bounce_pad", 2, 4, [0, 1], 0, [(-8, -32, 0, 0), (-8, -16, 2, 0)])
    for k in (0, 1):
        g = _sheet_frame(img, 16, 32, k)
        _blit(d["canvas"], g[:16], 32 * k, 0)
        _blit(d["canvas"], g[16:], 32 * k + 16, 0)
        d["src"].append((k, "objects/bounce_pad.png", 16, 32, k, False))

    # ladder: art rows 13..63, four small pieces at dy -51, -35, -19, -3
    img = load_rgba(assets, "objects/ladder.png")
    g = grab(img, 0, 0, 16, 64)
    d = new("ladder", 2, 2, [0], 0, [(-8, -51 + 16 * k, 2 * k, 0) for k in range(4)])
    for k in range(4):
        _blit(d["canvas"], _crop(g, 0, 13 + 16 * k, 16, 16), 16 * k, 0)
    d["src"].append((0, "objects/ladder.png", 16, 64, 0, False))

    # crab: 32x16 frame, mirrored to face right, two small pieces
    img = load_rgba(assets, "enemies/crab.png")
    d = new("crab", 2, 4, [0, 1, 2, 1], 8, [(-16, -16, 0, 0), (0, -16, 2, 0)])
    for k in range(3):
        g = hmirror(grab(img, 32 * k, 0, 32, 16))
        _blit(d["canvas"], g, 32 * k, 0)
        d["src"].append((k, "enemies/crab.png", 32, 16, k, True))

    # door: 32x48; large (-18,-52) = art rows 0..31, smalls (-18,-20), (-2,-20) = rows 32..47
    img = load_rgba(assets, "objects/door_locked.png")
    g = grab(img, 0, 0, 32, 48)
    d = new("door_locked", 4, 4, [0], 0, [(-18, -52, 0, 1), (-18, -20, 4, 0), (-2, -20, 6, 0)])
    _blit(d["canvas"], g[:32], 0, 0)
    _blit(d["canvas"], g[32:], 32, 0)
    d["src"].append((0, "objects/door_locked.png", 32, 48, 0, False))

    for name, d in defs.items():
        width = max(p[2] % 16 + (4 if p[3] & 1 else 2) for p in d["pieces"])
        nfr = max(d["seq"]) + 1
        if width + (nfr - 1) * d["stride"] > 16:
            raise SystemExit("mkassets: %s strip frames do not fit 16 chars" % name)
    return defs


def recolour(base_rel, alt_rel, assets, base_pal, what):
    """Palette with the same colour indices as base_pal, colours taken from the
    recoloured sheet (same shapes).  -> (list, inconsistencies)."""
    a = load_rgba(assets, base_rel)
    b = load_rgba(assets, alt_rel)
    ga = grab(a, 0, 0, a.width, a.height)
    gb = grab(b, 0, 0, b.width, b.height)
    votes = {}
    for ra, rb in zip(ga, gb):
        for ca, cb in zip(ra, rb):
            if ca is not None and cb is not None:
                votes.setdefault(ca, {})
                votes[ca][cb] = votes[ca].get(cb, 0) + 1
    out, bad = [], 0
    for c in base_pal:
        if c in votes:
            v = votes[c]
            top = max(v, key=lambda k: (v[k], -k))
            bad += sum(v.values()) - v[top]
            out.append(top)
        else:
            out.append(c)
    return out, bad


def build_objects(assets):
    defs = build_object_defs(assets)
    names = sorted(defs, key=lambda n: OT[n])
    packed = pack_palettes([colours_of(defs[n]["canvas"]) for n in names], 5, "object sprites")
    packed.sort(key=lambda p: min(OT[n] for n in names if colours_of(defs[n]["canvas"]) <= set(p)))
    pals = {1 + i: p for i, p in enumerate(packed)}
    banks = [bytearray()]
    for n in names:
        d = defs[n]
        d["palette"] = pal_for(colours_of(d["canvas"]), pals)
        idx = to_index(d["canvas"], pals[d["palette"]])
        data = bytearray()
        for cy in range(d["rows"]):
            for cx in range(16):
                data += enc_char(idx, cx * 8, cy * 8)
        if len(banks[-1]) + len(data) > BANK_SIZE:
            banks.append(bytearray())
        d["bank"] = len(banks) - 1
        d["addr"] = 0x8000 + len(banks[-1])
        d["alias"] = None
        banks[-1] += data
    if len(banks) > 2:
        raise SystemExit("mkassets: object strips need %d banks (max 2)" % len(banks))
    # sprint checkpoint: alias of checkpoint_flag with its own piece list (marker offset)
    f = defs["checkpoint_flag"]
    defs["sprint_cp"] = dict(f, alias="checkpoint_flag", pieces=[(-16, -30, 0, 1)], src=[])
    gold, bad1 = recolour("objects/flag-checkered.png", "objects/flag-checkered-gold.png",
                          assets, pals[defs["exit"]["palette"]], "gold")
    green, bad2 = recolour("objects/flag.png", "objects/flag-green.png",
                           assets, pals[f["palette"]], "green")
    pals[6], pals[7] = gold, green
    return defs, pals, [bytes(b) for b in banks], (bad1, bad2)


# ---------------------------------------------------------------------------
# HUD icons (no WAMP source: drawn here; contract 6.6) and BG3 palettes
# ---------------------------------------------------------------------------
HUD_ICONS = [
    # HT_HEART_FULL (palette HP_HEART: 1 dark red, 2 red, 3 pink)
    (".11.11..", "1231221.", "13222221", "12222221", ".122221.", "..1221..", "...11...", "........"),
    # HT_HEART_EMPTY
    (".11.11..", "1..1..1.", "1......1", "1......1", ".1....1.", "..1..1..", "...11...", "........"),
    # HT_KEY (palette HP_ICON: 1 dark, 2 orange, 3 yellow)
    (".111....", "13331...", "13.31111", "13.33333", "13.31313", "13331.1.", ".111....", "........"),
    # HT_COIN
    ("..1111..", ".133331.", "13322331", "13233231", "13233231", "13322331", ".133331.", "..1111.."),
    # HT_CLOCK
    ("..1111..", ".133331.", "13313331", "13313331", "13311131", "13333331", ".133331.", "..1111.."),
    # HT_ENEMY (slime)
    ("........", "..1111..", ".122221.", "12322321", "12122121", "12222221", "12222221", ".111111."),
    # HT_FLAG
    (".1......", ".1222...", ".122222.", ".1222...", ".1......", ".1......", ".1......", "111....."),
]


def build_hud():
    chr_ = bytearray()
    for icon in HUD_ICONS:
        idx = [[0 if ch == "." else int(ch) for ch in row] for row in icon]
        chr_ += enc_char(idx, 0, 0, bpp=2)
    chr_ += bytes(16 * (16 - len(HUD_ICONS)))
    sub = [
        ["050505", "ffffff", "393457", "ffd455"],   # HP_TEXT  (entry 0 = default backdrop)
        ["000000", "a1acbf", "393457", "606c81"],   # HP_DIM
        ["000000", "a51140", "ee1841", "ff8b97"],   # HP_HEART
        ["000000", "393457", "f99252", "f7e476"],   # HP_ICON
    ]
    pal = bytearray()
    for i in range(8):
        for h in (sub[i] if i < len(sub) else ["000000"] * 4):
            c = hexcol(h)
            pal += bytes((c & 255, c >> 8))
    return bytes(chr_), bytes(pal)


# ---------------------------------------------------------------------------
# emit
# ---------------------------------------------------------------------------
def _bytes_line(vals):
    return "    .byte " + ", ".join("$%02X" % (v & 255) for v in vals)


def write_if_changed(path, data):
    mode = "wb" if isinstance(data, (bytes, bytearray)) else "w"
    if os.path.exists(path):
        with open(path, "rb" if mode == "wb" else "r") as f:
            if f.read() == data:
                return
    with open(path, mode) as f:
        f.write(data)


HEADER = "; GENERATED by tools/mkassets.py -- do not edit.\n"


def convert(assets=DEFAULT_ASSETS, out=DEFAULT_OUT, quiet=False):
    os.makedirs(out, exist_ok=True)
    report = {}

    def put(name, data):
        write_if_changed(os.path.join(out, name), data)
        report[name] = len(data)

    # ---- tile library ----
    tiles, bgpals, chr_, palmap, ranges = build_tilelib(assets)
    put("tilelib.bin", chr_)
    put("tilelibpal.bin", palmap)
    put("bgpal.bin", pal_bytes({k - 2: v for k, v in bgpals.items()}, 6))
    s = HEADER
    s += "TILELIB_COUNT   = %d\nTILELIB_VERSION = %d\n\n" % (TILELIB_COUNT, TILELIB_VERSION)
    s += '.segment "DATA1"\nTileLibPal:\n    .incbin "gen/tilelibpal.bin"\n\n'
    for k in range((len(chr_) + BANK_SIZE - 1) // BANK_SIZE):
        size = min(BANK_SIZE, len(chr_) - k * BANK_SIZE)
        s += '.segment "TILELIB%d"\n    .incbin "gen/tilelib.bin", $%X, $%X\n' % (k, k * BANK_SIZE, size)
    put("tilelib.inc", s)

    meta = None
    meta_path = os.path.join(HERE, "tilemeta.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    tj = {}
    for i in sorted(tiles):
        t = tiles[i]
        gid = t["gid"]
        kind, inrule, cls = SPECIAL_KINDS.get(gid, (None, True, None))
        if t["tileset"] == "special" and gid not in SPECIAL_KINDS:
            inrule = False
        if cls is None and t["tileset"] != "special" and meta is not None and str(gid) in meta:
            cls = "TC_SOLID" if meta[str(gid)].get("solid") else "TC_EMPTY"
        tj[str(gid)] = {"id": i, "palette": t["palette"], "blank": t["palette"] == 0,
                        "tileset": t["tileset"], "quantised": t["quantised"],
                        "special": kind, "ruleset_v0": inrule, "collision": cls}
    put("tilelib_map.json", json.dumps({g: v["id"] for g, v in tj.items()}, indent=0) + "\n")
    put("tile_library.json", json.dumps(
        {"version": TILELIB_VERSION, "count": TILELIB_COUNT, "collision_classes": TC,
         "collision_source": "tools/tilemeta.json" if meta is not None else None,
         "ranges": ranges, "tiles": tj}, indent=1) + "\n")

    # ---- system gfx ----
    hud_chr, bg3pal = build_hud()
    put("font.bin", mkfont.build(2))
    put("hudchr.bin", hud_chr)
    put("bg3pal.bin", bg3pal)

    # ---- player ----
    frames, anims, plpal, plbanks = build_player(assets)
    for k, b in enumerate(plbanks):
        put("player%d.bin" % k, b)
    s = HEADER + "PLAYER_FRAME_COUNT = %d\n\n" % len(frames)
    s += '.segment "DATA1"\nPlayerFrameTable:\n'
    for i in range(len(frames)):
        s += "    .addr PlFrame_%d\n" % i
    for i, f in enumerate(frames):
        s += "PlFrame_%d:    ; %s %d (%s)\n" % (i, f["sheet"], f["index"], f["mode"])
        s += "    .byte %d, %d\n    .word $%04X\n" % (len(f["cells"]), f["bank"], f["addr"])
        s += _bytes_line([v for o in f["offsets"] for v in o]) + "\n"
    s += "PlayerAnimTable:\n"
    first = 0
    seq = []
    for a in anims:
        s += "    .byte %d, %d, %d, %d    ; PA %s\n" % (len(a["frames"]), a["hold"], a["loop"], first, a["name"])
        a["first"] = first
        first += len(a["frames"])
        seq += a["frames"]
    if first > 255:
        raise SystemExit("mkassets: PlayerAnimFrames too long")
    s += "PlayerAnimFrames:\n"
    for a in anims:
        s += _bytes_line(a["frames"]) + "\n"
    for k in range(len(plbanks)):
        s += '\n.segment "PLAYERGFX%d"\n    .incbin "gen/player%d.bin"\n' % (k, k)
    put("player.inc", s)
    put("player.json", json.dumps({
        "palette": plpal,
        "frames": [{"sheet": f["sheet"], "index": f["index"], "n": len(f["cells"]),
                    "bank": f["bank"], "addr": f["addr"], "mode": f["mode"],
                    "line_cells": f["line"], "cells": [list(o) for o in f["offsets"]]} for f in frames],
        "anims": [{"name": a["name"], "frames": a["frames"], "hold": a["hold"],
                   "loop": a["loop"], "first": a["first"]} for a in anims]}, indent=1) + "\n")

    # ---- objects ----
    defs, objpals, objbanks, bad = build_objects(assets)
    objpals[0] = plpal
    put("objpal.bin", pal_bytes(objpals, 8))
    for k, b in enumerate(objbanks):
        put("objgfx%d.bin" % k, b)
    byid = {OT[n]: (n, d) for n, d in defs.items()}
    s = HEADER + '.segment "DATA1"\nObjGfxTable:\n'
    tail = "ObjSeq_none:\n    .byte 0\nObjPieces_none:\n    .byte 0\n"
    for t in range(OT_COUNT):
        if t not in byid:
            s += "    .byte 0\n    .addr 0\n    .byte 0, 0, 0, 0, 0\n    .addr ObjSeq_none, ObjPieces_none    ; %d (no graphics)\n" % t
            continue
        n, d = byid[t]
        rows = d["rows"] if d["alias"] is None else (OG_ALIAS | OT[d["alias"]])
        s += "    .byte %d\n    .addr $%04X\n    .byte $%02X, %d, %d, %d, %d\n    .addr ObjSeq_%d, ObjPieces_%d    ; %d %s\n" % (
            d["bank"], d["addr"], rows, d["palette"], d["stride"], len(d["seq"]), d["hold"], t, t, t, n)
        if not 1 <= len(d["seq"]) <= 8:
            raise SystemExit("mkassets: %s seq_len out of range" % n)
        tail += "ObjSeq_%d:\n%s\n" % (t, _bytes_line(d["seq"]))
        tail += "ObjPieces_%d:\n    .byte %d\n" % (t, len(d["pieces"]))
        for p in d["pieces"]:
            tail += _bytes_line(p) + "\n"
    s += tail
    for k in range(len(objbanks)):
        s += '\n.segment "OBJGFX%d"\n    .incbin "gen/objgfx%d.bin"\n' % (k, k)
    put("objects.inc", s)
    put("objects.json", json.dumps({"types": {
        n: {"id": OT[n], "rows": d["rows"], "alias": d["alias"], "palette": d["palette"],
            "bank": d["bank"], "addr": d["addr"], "stride": d["stride"], "seq": d["seq"],
            "hold": d["hold"], "pieces": [list(p) for p in d["pieces"]],
            "src": [list(x) for x in d["src"]]}
        for n, d in sorted(defs.items(), key=lambda kv: OT[kv[0]])}}, indent=1) + "\n")

    s = HEADER + '.segment "DATA1"\n'
    for label, fn in (("FontChr", "font.bin"), ("HudChr", "hudchr.bin"), ("Bg3Palettes", "bg3pal.bin"),
                      ("BgPalettes", "bgpal.bin"), ("ObjPalettes", "objpal.bin")):
        s += '%s:\n    .incbin "gen/%s"\n' % (label, fn)
    put("gfxsys.inc", s)

    if not quiet:
        print("mkassets: wrote %d files to %s" % (len(report), out))
        for k in sorted(report):
            print("  %-20s %6d bytes" % (k, report[k]))
        print("  BG palettes: " + ", ".join("%d:%d colours" % (k, len(v)) for k, v in sorted(bgpals.items())))
        print("  OBJ palettes: " + ", ".join("%d:%d colours" % (k, len(v)) for k, v in sorted(objpals.items())))
        q = [t for t in tiles.values() if t["quantised"]]
        print("  special tiles quantised to BG palettes: %d (gids %s)" % (
            len(q), " ".join("%d>p%d" % (t["gid"], t["palette"]) for t in q)))
        print("  player: %d frames, max %d cells, %d chr bytes in %d bank(s)" % (
            len(frames), max(len(f["cells"]) for f in frames), sum(map(len, plbanks)), len(plbanks)))
        if bad[0] or bad[1]:
            print("  note: recolour palettes 6/7: %d/%d pixels did not map 1:1 (majority colour used)" % bad)
    return report


# ---------------------------------------------------------------------------
# preview: decode the generated binaries
# ---------------------------------------------------------------------------
def _rd(out, name):
    with open(os.path.join(out, name), "rb") as f:
        return f.read()


def decode_tile(out, tile_id, _cache={}):
    """-> 16x16 grid of BGR555/None decoded from tilelib.bin + bgpal.bin + tilelibpal.bin."""
    if out not in _cache:
        _cache[out] = (_rd(out, "tilelib.bin"), _rd(out, "tilelibpal.bin"), read_pals(_rd(out, "bgpal.bin")))
    chr_, palmap, pal = _cache[out]
    p = palmap[tile_id]
    idx = dec_tile16(chr_[tile_id * 128:(tile_id + 1) * 128])
    return [[None if v == 0 else pal[(p - 2) * 16 + v] for v in row] for row in idx]


def decode_player_frame(out, fi):
    """-> dict {(x, y): BGR555} relative to the feet point, facing right."""
    meta = json.loads(_rd(out, "player.json"))
    pal = read_pals(_rd(out, "objpal.bin"))[0:16]
    f = meta["frames"][fi]
    data = _rd(out, "player%d.bin" % f["bank"])[f["addr"] - 0x8000:][:f["n"] * 128]
    n = f["n"]; a = min(n, 8); b = n - a
    px = {}
    for k, (dx, dy) in enumerate(f["cells"]):
        if k < 8:
            top = data[k * 64:(k + 1) * 64]
            bot = data[a * 64 + k * 64:a * 64 + (k + 1) * 64]
        else:
            j = k - 8
            base = a * 128
            top = data[base + j * 64:base + (j + 1) * 64]
            bot = data[base + b * 64 + j * 64:base + b * 64 + (j + 1) * 64]
        idx = dec_tile16(top + bot)
        for y in range(16):
            for x in range(16):
                if idx[y][x]:
                    px[(dx + x, dy + y)] = pal[idx[y][x]]
    return px


def decode_object_frame(out, name, frame, palette=None):
    """-> dict {(x, y): BGR555} relative to the anchor, facing right."""
    meta = json.loads(_rd(out, "objects.json"))["types"][name]
    pals = read_pals(_rd(out, "objpal.bin"))
    p = meta["palette"] if palette is None else palette
    data = _rd(out, "objgfx%d.bin" % meta["bank"])[meta["addr"] - 0x8000:][:meta["rows"] * 512]
    px = {}
    for dx, dy, ch, flags in meta["pieces"]:
        c0 = ch + frame * meta["stride"]
        size = 4 if flags & 1 else 2
        for cy in range(size):
            for cx in range(size):
                c = c0 + cx + cy * 16
                idx = dec_char(data[c * 32:(c + 1) * 32])
                for y in range(8):
                    for x in range(8):
                        if idx[y][x]:
                            px[(dx + cx * 8 + x, dy + cy * 8 + y)] = pals[p * 16 + idx[y][x]]
    return px


def _checker(w, h, s=4):
    im = Image.new("RGB", (w, h))
    p = im.load()
    for y in range(h):
        for x in range(w):
            p[x, y] = (72, 72, 88) if ((x // s) + (y // s)) & 1 else (56, 56, 70)
    return im


def preview(out, dst, scale=3):
    os.makedirs(dst, exist_ok=True)
    written = []

    def save(im, name, sc=scale):
        path = os.path.join(dst, name)
        im.resize((im.width * sc, im.height * sc), Image.NEAREST).save(path)
        written.append(path)

    # tile library: 24 tiles per row, id order
    per = 24
    rows = (TILELIB_COUNT + per - 1) // per
    im = _checker(per * 17 + 1, rows * 17 + 1)
    p = im.load()
    for i in range(TILELIB_COUNT):
        g = decode_tile(out, i)
        for y in range(16):
            for x in range(16):
                if g[y][x] is not None:
                    p[1 + (i % per) * 17 + x, 1 + (i // per) * 17 + y] = rgb_of(g[y][x])
    save(im, "tilelib.png", 2)
    # special tiles alone, bigger
    im = _checker(8 * 17 + 1, 8 * 17 + 1)
    p = im.load()
    for k in range(64):
        g = decode_tile(out, 433 + k)
        for y in range(16):
            for x in range(16):
                if g[y][x] is not None:
                    p[1 + (k % 8) * 17 + x, 1 + (k // 8) * 17 + y] = rgb_of(g[y][x])
    save(im, "tilelib_special.png", 5)

    # player frames: 96x84 canvas boxes, feet line and centre line marked
    meta = json.loads(_rd(out, "player.json"))
    n = len(meta["frames"])
    per = 12
    cw, chh = 98, 100
    im = _checker(per * cw, ((n + per - 1) // per) * chh)
    p = im.load()
    for i in range(n):
        ox, oy = (i % per) * cw + 49, (i // per) * chh + 96
        for x in range(-48, 48):
            p[ox + x, oy] = (200, 60, 60)             # feet line (pl_y)
        for y in range(-90, 3):
            if (x := ox) and y % 2 == 0:
                p[ox, oy + y] = (60, 60, 200)          # body centre (pl_x)
        f = meta["frames"][i]
        for dx, dy in f["cells"]:                      # cell outlines
            for k in range(16):
                for (qx, qy) in ((dx + k, dy), (dx + k, dy + 15), (dx, dy + k), (dx + 15, dy + k)):
                    xx, yy = ox + qx, oy + qy
                    if 0 <= xx < im.width and 0 <= yy < im.height:
                        p[xx, yy] = (40, 110, 40)
        for (x, y), c in decode_player_frame(out, i).items():
            xx, yy = ox + x, oy + y
            if 0 <= xx < im.width and 0 <= yy < im.height:
                p[xx, yy] = rgb_of(c)
    save(im, "player.png", 2)

    # objects: one row per type, every strip frame, anchor marked
    ometa = json.loads(_rd(out, "objects.json"))["types"]
    names = list(ometa)
    rh, cw = 60, 44
    im = _checker(8 * cw + cw, (len(names) + 2) * rh)
    p = im.load()

    def draw(name, fr, ox, oy, palette=None):
        for x in range(-12, 13):
            p[ox + x, oy] = (200, 60, 60)
        for (x, y), c in decode_object_frame(out, name, fr, palette).items():
            xx, yy = ox + x, oy + y
            if 0 <= xx < im.width and 0 <= yy < im.height:
                p[xx, yy] = rgb_of(c)
    for r, name in enumerate(names):
        m = ometa[name]
        for fr in range(max(m["seq"]) + 1):
            draw(name, fr, 22 + fr * cw, r * rh + 55)
    for fr in range(4):
        draw("exit", fr, 22 + fr * cw, len(names) * rh + 55, 6)
        draw("sprint_cp", fr, 22 + fr * cw, (len(names) + 1) * rh + 55, 7)
    save(im, "objects.png", 2)

    # font + hud icons with BG3 palettes
    font, hud, bp = _rd(out, "font.bin"), _rd(out, "hudchr.bin"), read_pals(_rd(out, "bg3pal.bin"))
    im = Image.new("RGB", (128, 64), rgb_of(bp[0]))
    p = im.load()
    for t in range(112):
        data = (font + hud)[t * 16:(t + 1) * 16]
        sub = 0 if t < 96 else (2 if t < 98 else 3)
        idx = dec_char(data, 2)
        for y in range(8):
            for x in range(8):
                if idx[y][x]:
                    p[(t % 16) * 8 + x, (t // 16) * 8 + y] = rgb_of(bp[sub * 4 + idx[y][x]])
    save(im, "hud.png", 5)

    # palettes
    bg = read_pals(_rd(out, "bgpal.bin"))
    ob = read_pals(_rd(out, "objpal.bin"))
    im = Image.new("RGB", (16 * 8, 15 * 8), (0, 0, 0))
    p = im.load()
    for r, pal in enumerate([bg[i * 16:(i + 1) * 16] for i in range(6)] + [None] +
                            [ob[i * 16:(i + 1) * 16] for i in range(8)]):
        if pal is None:
            continue
        for i, c in enumerate(pal):
            if i == 0:
                continue
            for y in range(7):
                for x in range(7):
                    p[i * 8 + x, r * 8 + y] = rgb_of(c)
    save(im, "palettes.png", 4)
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description="SNESWAMP art converter")
    ap.add_argument("--assets", default=DEFAULT_ASSETS)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--preview", metavar="DIR", help="also render contact sheets from the generated data")
    ap.add_argument("--stamp", help="touch this file on success (Makefile)")
    ap.add_argument("-q", "--quiet", action="store_true")
    a = ap.parse_args(argv)
    convert(a.assets, a.out, a.quiet)
    if a.preview:
        for path in preview(a.out, a.preview):
            print("preview:", path)
    if a.stamp:
        with open(a.stamp, "w") as f:
            f.write("ok\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
