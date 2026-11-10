#!/usr/bin/env python3
"""Tests for tools/mkassets.py (contract: docs/ARCHITECTURE.md section 2).

Runs the converter into build/gen, then checks the generated binaries, tables
and JSON against the contract and against the SOURCE PNG pixels (decoded from
the generated SNES data with the generated BGR555 palettes).

    python3 tests/test_assets.py        (or: pytest tests/test_assets.py)
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

SNES = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SNES / "tools"))
import mkassets as A  # noqa: E402

GEN = SNES / "build" / "gen"
ASSETS = Path(A.DEFAULT_ASSETS)
_done = {}


def gen():
    if "r" not in _done:
        _done["r"] = A.convert(str(ASSETS), str(GEN), quiet=True)
    return _done["r"]


def rd(name):
    gen()
    return (GEN / name).read_bytes()


def js(name):
    return json.loads(rd(name))


def constants():
    """NAME = value pairs of src/constants.inc (simple numeric ones)."""
    out = {}
    for line in (SNES / "src" / "constants.inc").read_text().splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\$[0-9A-Fa-f]+|\d+)\s*(;.*)?$", line)
        if m:
            v = m.group(2)
            out[m.group(1)] = int(v[1:], 16) if v.startswith("$") else int(v)
    return out


def src_grid(rel, x0, y0, w, h):
    """Source pixels after 15-bit reduction (None = alpha < 128)."""
    return A.grab(A.load_rgba(str(ASSETS), rel), x0, y0, w, h)


def px_of(grid, ox=0, oy=0):
    return {(ox + x, oy + y): c for y, row in enumerate(grid) for x, c in enumerate(row) if c is not None}


# ---------------------------------------------------------------------------
# files and sizes
# ---------------------------------------------------------------------------
def test_files_and_sizes():
    gen()
    assert len(rd("tilelib.bin")) == 573 * 128
    assert len(rd("tilelibpal.bin")) == 573
    assert len(rd("font.bin")) == 1536
    assert len(rd("hudchr.bin")) == 256
    assert len(rd("bg3pal.bin")) == 64
    assert len(rd("bgpal.bin")) == 192
    assert len(rd("objpal.bin")) == 256
    for name in ("tilelib.inc", "gfxsys.inc", "player.inc", "objects.inc",
                 "tilelib_map.json", "tile_library.json", "player.json", "objects.json"):
        assert (GEN / name).stat().st_size > 0, name
    for k in range(4):
        p = GEN / ("player%d.bin" % k)
        if p.exists():
            assert 0 < p.stat().st_size <= 0x8000
    for k in range(2):
        p = GEN / ("objgfx%d.bin" % k)
        if p.exists():
            assert 0 < p.stat().st_size <= 0x8000 and p.stat().st_size % 512 == 0


def test_constants_match_contract():
    c = constants()
    assert A.PL_MAX_CELLS == c["PL_MAX_CELLS"] == 12
    assert A.PL_MAX_LINE_CELLS == c["PL_MAX_LINE_CELLS"] == 5
    assert A.OT_COUNT == c["OT_COUNT"]
    assert A.OG_ALIAS == c["OG_ALIAS"]
    for name, v in A.OT.items():
        assert c["OT_" + name.upper()] == v, name
    for name, v in A.TC.items():
        assert c[name] == v, name
    assert len(A.PLAYER_ANIMS) == c["PA_COUNT"]
    for i, a in enumerate(A.PLAYER_ANIMS):
        assert c["PA_" + a[0].upper()] == i, a[0]
    assert len(A.HUD_ICONS) <= c["HT_ICON_COUNT"]
    order = ["HT_HEART_FULL", "HT_HEART_EMPTY", "HT_KEY", "HT_COIN", "HT_CLOCK", "HT_ENEMY", "HT_FLAG"]
    assert [c[n] - 96 for n in order] == list(range(7))
    inc = rd("tilelib.inc").decode()
    assert "TILELIB_COUNT   = 573" in inc and "TILELIB_VERSION = 1" in inc


def test_deterministic():
    gen()
    before = {p.name: p.read_bytes() for p in GEN.iterdir() if p.is_file() and not p.name.startswith(".")}
    A.convert(str(ASSETS), str(GEN), quiet=True)
    for name, data in before.items():
        if name.startswith("rooms"):
            continue
        assert (GEN / name).read_bytes() == data, name


# ---------------------------------------------------------------------------
# palettes
# ---------------------------------------------------------------------------
def _used_indices_4bpp(data):
    used = set()
    for i in range(0, len(data), 32):
        for row in A.dec_char(data[i:i + 32]):
            used.update(row)
    return used


def test_palettes():
    bg = A.read_pals(rd("bgpal.bin"))
    ob = A.read_pals(rd("objpal.bin"))
    b3 = A.read_pals(rd("bg3pal.bin"))
    assert len(bg) == 96 and len(ob) == 128 and len(b3) == 32
    for w in bg + ob + b3:
        assert 0 <= w <= 0x7FFF
    # colour 0 of every 4bpp palette is the transparent slot: <= 15 real colours each
    for p in range(6):
        assert bg[p * 16] == 0
    for p in range(8):
        assert ob[p * 16] == 0
    # player palette: the three measured colours (RA 2.3) are present in OBJ palette 0
    assert {0x7FFF, 0x6B17, 0x5650} <= set(ob[1:16])
    # HUD text sub-palette: white, shadow #393457, yellow #ffd455
    assert b3[1:4] == [0x7FFF, 0x28C7, 0x2B5F]
    # alt palettes 6/7 differ from the originals but keep index layout (same length used)
    meta = js("objects.json")["types"]
    pe, pf = meta["exit"]["palette"], meta["checkpoint_flag"]["palette"]
    assert ob[6 * 16:7 * 16] != ob[pe * 16:(pe + 1) * 16]
    assert ob[7 * 16:8 * 16] != ob[pf * 16:(pf + 1) * 16]


def test_tile_palette_assignment():
    chr_ = rd("tilelib.bin")
    palmap = rd("tilelibpal.bin")
    bg = A.read_pals(rd("bgpal.bin"))
    assert palmap[0] == 0 and chr_[:128] == bytes(128)
    used_pals = set()
    for t in range(573):
        data = chr_[t * 128:(t + 1) * 128]
        p = palmap[t]
        if p == 0:
            assert data == bytes(128), "tile %d has pixels but palette 0" % t
            continue
        assert 2 <= p <= 7, t
        used_pals.add(p)
        idx = _used_indices_4bpp(data) - {0}
        assert idx, "tile %d has a palette but is blank" % t
        assert len(idx) <= 15
        # every used index is a defined colour slot of its palette (not padding)
        n_defined = max(i for i in range(16) if bg[(p - 2) * 16 + i] != 0 or i == 0)
        assert max(idx) <= n_defined, t
    assert len(used_pals) <= 6


# ---------------------------------------------------------------------------
# tile library mapping + round trip
# ---------------------------------------------------------------------------
RULESET_RANGES = [(1, 72), (73, 144), (217, 321), (322, 387), (388, 459), (492, 536),
                  (669, 732), (2073, 2076), (2077, 2148)]
RULESET_SPECIAL = {670: "TC_ONEWAY", 672: "TC_CONV_L", 673: "TC_CONV_R", 674: "TC_ICE",
                   676: "TC_BOUNCE", 677: "TC_DAMAGE", 682: "TC_WATER", 687: "TC_CRUMBLE"}


def test_every_ruleset_gid_mapped():
    m = js("tilelib_map.json")
    lib = js("tile_library.json")
    c = constants()
    assert lib["version"] == 1 and lib["count"] == 573
    gids = [g for a, b in RULESET_RANGES for g in range(a, b + 1)]
    assert len(gids) == 572
    assert sorted(int(g) for g in m) == gids
    assert sorted(m.values()) == list(range(1, 573))          # bijection onto ids 1..572
    palmap = rd("tilelibpal.bin")
    for g in gids:
        t = lib["tiles"][str(g)]
        assert t["id"] == m[str(g)]
        assert t["palette"] == palmap[t["id"]]
        assert t["blank"] == (t["palette"] == 0)
        if t["collision"] is not None:
            assert t["collision"] in lib["collision_classes"]
            assert lib["collision_classes"][t["collision"]] == c[t["collision"]]
    # contract table 2.1 anchors
    for gid, lid in ((1, 1), (72, 72), (73, 73), (217, 145), (322, 250), (388, 316),
                     (492, 388), (669, 433), (2073, 497), (2077, 501), (2148, 572)):
        assert m[str(gid)] == lid
    for gid, cls in RULESET_SPECIAL.items():
        t = lib["tiles"][str(gid)]
        assert t["collision"] == cls and t["ruleset_v0"] and not t["blank"], gid
    for gid in (669, 675, 678, 683):                        # brick, sticky, gravity, wind
        assert lib["tiles"][str(gid)]["ruleset_v0"] is False


def test_tile_library_collision_matches_tilemeta():
    """With tools/tilemeta.json present, every gid's kind and collision class
    agree with it (it is the collision source of truth, contract 1.3)."""
    path = SNES / "tools" / "tilemeta.json"
    if not path.exists():
        return
    meta = json.loads(path.read_text())
    lib = js("tile_library.json")
    assert lib["collision_source"] == "tools/tilemeta.json"
    special_cls = {"oneWayPlatform": "TC_ONEWAY", "conveyorLeft": "TC_CONV_L",
                   "conveyorRight": "TC_CONV_R", "ice": "TC_ICE", "bounce": "TC_BOUNCE",
                   "damage": "TC_DAMAGE", "water": "TC_WATER", "crumbling": "TC_CRUMBLE"}
    for gid, t in lib["tiles"].items():
        m = meta[gid]
        assert t["special"] == m["kind"], gid
        if m["kind"] is None:
            assert t["collision"] == ("TC_SOLID" if m["solid"] else "TC_EMPTY"), gid
        else:
            assert t["collision"] == special_cls.get(m["kind"]), gid
            assert t["ruleset_v0"] == (m["kind"] in special_cls), gid


def test_tile_round_trip_all_exact_tilesets():
    """Every non-special tile decodes to exactly the source pixels (15-bit)."""
    checked = 0
    for name, rel, g0, g1, id0 in A.TILE_RANGES:
        if name == "special":
            continue
        img = A.load_rgba(str(ASSETS), rel)
        cols = img.width // 16
        for k in range(g1 - g0 + 1):
            want = src_grid(rel, (k % cols) * 16, (k // cols) * 16, 16, 16)
            got = A.decode_tile(str(GEN), id0 + k)
            assert got == want, "%s gid %d" % (name, g0 + k)
            checked += 1
    assert checked == 572 - 64


def test_tile_round_trip_independent_decoder():
    """A few tiles decoded with a decoder written here (not mkassets')."""
    chr_ = rd("tilelib.bin")
    palmap = rd("tilelibpal.bin")
    pal = rd("bgpal.bin")
    im = Image.open(ASSETS / "tilesets" / "tileset_forest.png").convert("RGBA")
    for lid in (1, 2, 14, 30, 72):
        k = lid - 1
        base = lid * 128
        for y in range(16):
            for x in range(16):
                ch = base + ((y >> 3) * 2 + (x >> 3)) * 32        # TL, TR, BL, BR
                r, bit = y & 7, 7 - (x & 7)
                v = (((chr_[ch + r * 2] >> bit) & 1) | (((chr_[ch + r * 2 + 1] >> bit) & 1) << 1) |
                     (((chr_[ch + 16 + r * 2] >> bit) & 1) << 2) | (((chr_[ch + 17 + r * 2] >> bit) & 1) << 3))
                R, G, B, a = im.getpixel(((k % 12) * 16 + x, (k // 12) * 16 + y))
                if a < 128:
                    assert v == 0
                else:
                    o = (palmap[lid] - 2) * 32 + v * 2
                    assert v != 0 and (pal[o] | (pal[o + 1] << 8)) == ((B >> 3) << 10) | ((G >> 3) << 5) | (R >> 3)


def test_special_tiles_quantised_sanely():
    """Special atlas art is nearest-colour quantised: same opaque mask, colours close."""
    rel = "tilesets/special-traversal-v1.png"
    img = A.load_rgba(str(ASSETS), rel)
    for gid in RULESET_SPECIAL:
        k = gid - 669
        raw = A.grab(img, (k % 8) * 16, (k // 8) * 16, 16, 16, raw=True)
        got = A.decode_tile(str(GEN), 433 + k)
        err = n = 0
        for y in range(16):
            for x in range(16):
                assert (raw[y][x] is None) == (got[y][x] is None), gid
                if raw[y][x] is not None:
                    r, g, b = A.rgb_of(got[y][x])
                    err += abs(r - raw[y][x][0]) + abs(g - raw[y][x][1]) + abs(b - raw[y][x][2])
                    n += 1
        assert n > 0 and err / (3.0 * n) < 40, "gid %d mean channel error %.1f" % (gid, err / (3.0 * n))


# ---------------------------------------------------------------------------
# player
# ---------------------------------------------------------------------------
HOLDS = {"idle": 8, "run": 5, "land": 4, "wall_slide": 6, "wall_jump": 4, "stomp_flip": 2,
         "ladder": 6, "crouch": 6, "crawl": 5, "slash": 3, "slash_down": 3}
LOOPS = {"idle", "run", "jump_rise", "jump_fall", "wall_slide", "wall_jump", "ladder", "crawl"}


def test_player_tables():
    m = js("player.json")
    frames, anims = m["frames"], m["anims"]
    assert len(m["palette"]) <= 15
    assert len(anims) == 13
    total = 0
    for a in anims:
        assert a["first"] == total
        total += len(a["frames"])
        assert all(0 <= f < len(frames) for f in a["frames"])
        if a["name"] in HOLDS:
            assert a["hold"] == HOLDS[a["name"]], a["name"]
        assert a["loop"] == (1 if a["name"] in LOOPS else 0), a["name"]
    by = {a["name"]: a for a in anims}
    assert len(by["slash"]["frames"]) == 5 and len(by["slash_down"]["frames"]) == 6
    assert [frames[f]["index"] for f in by["slash"]["frames"]] == [89, 90, 91, 92, 93]
    assert [frames[f]["index"] for f in by["slash_down"]["frames"]] == [107, 108, 109, 110, 111, 112]
    assert [frames[f]["index"] for f in by["idle"]["frames"]] == list(range(7))
    # contract 2.2 measured cell counts for the slash frames
    assert [frames[f]["n"] for f in by["slash"]["frames"]] == [7, 10, 11, 8, 4]
    assert [frames[f]["n"] for f in by["slash_down"]["frames"]] == [5, 7, 12, 8, 4, 5]
    sizes = {}
    for i, f in enumerate(frames):
        n = f["n"]
        assert 1 <= n <= 12 and len(f["cells"]) == n, i
        if f["sheet"] == "base":
            assert n <= 6, i
        # at most 5 cells on any scanline (recomputed here)
        for y in range(-128, 128):
            assert sum(1 for dx, dy in f["cells"] if dy <= y < dy + 16) <= 5, i
        for dx, dy in f["cells"]:
            assert -128 <= dx <= 127 and -128 <= dy <= 127
        assert 0 <= f["bank"] <= 3 and 0x8000 <= f["addr"] and f["addr"] + n * 128 <= 0x10000
        sizes[f["bank"]] = max(sizes.get(f["bank"], 0), f["addr"] - 0x8000 + n * 128)
    for b, sz in sizes.items():
        assert sz <= len(rd("player%d.bin" % b))
    inc = rd("player.inc").decode()
    assert "PLAYER_FRAME_COUNT = %d" % len(frames) in inc
    for label in ("PlayerFrameTable:", "PlayerAnimTable:", "PlayerAnimFrames:"):
        assert label in inc


def test_player_round_trip_and_anchor():
    """Every frame decodes (via the NMI upload layout) to exactly the source canvas,
    positioned so canvas (48, 82) is the feet point (canvas row 84 = feet + 2)."""
    m = js("player.json")
    for i, f in enumerate(m["frames"]):
        rel, prefix = A.PLAYER_SHEETS[f["sheet"]]
        meta = json.loads((ASSETS / (rel + ".json")).read_text())["frames"]
        fr = meta["%s%d.aseprite" % (prefix, f["index"])]["frame"]
        want = px_of(src_grid(rel + ".png", fr["x"], fr["y"], 96, 84), -48, -82)
        got = A.decode_player_frame(str(GEN), i)
        assert got == want, "player frame %d (%s %d)" % (i, f["sheet"], f["index"])
    # idle frame 0: art x -7..+6 (canvas 41..54), top 38 px above the feet, bottom row at +1
    got = A.decode_player_frame(str(GEN), 0)
    xs = [p[0] for p in got]
    ys = [p[1] for p in got]
    assert (min(xs), max(xs), min(ys), max(ys)) == (-7, 6, -38, 1)


# ---------------------------------------------------------------------------
# objects
# ---------------------------------------------------------------------------
EXPECT_OBJ = {   # name: (rows, strip frames, hold, n pieces, seq)
    "coin_gold": (2, 8, 6, 1, list(range(8))), "coin_silver": (2, 8, 6, 1, list(range(8))),
    "gem": (2, 5, 8, 1, list(range(5))), "heart": (2, 8, 8, 1, list(range(8))),
    "key": (2, 8, 8, 1, list(range(8))), "star": (2, 8, 8, 1, list(range(8))),
    "spikes": (2, 4, 8, 1, [0, 1, 2, 3]), "saw": (4, 3, 8, 1, [0, 1, 2, 1]),
    "fire": (2, 6, 6, 1, list(range(6))), "bounce_pad": (2, 2, 0, 2, [0, 1]),
    "ladder": (2, 1, 0, 4, [0]), "checkpoint_flag": (4, 4, 15, 1, [0, 1, 2, 3]),
    "door_locked": (4, 1, 0, 3, [0]), "slime_blue": (2, 5, 10, 1, list(range(5))),
    "slime_red": (2, 5, 10, 1, list(range(5))), "bat": (4, 4, 8, 1, [0, 1, 2, 3, 2, 1]),
    "crab": (2, 3, 8, 2, [0, 1, 2, 1]), "frog": (4, 4, 10, 1, [0, 1, 2, 3]),
    "exit": (4, 4, 15, 1, [0, 1, 2, 3]), "sprint_cp": (4, 4, 15, 1, [0, 1, 2, 3]),
}


def test_object_tables():
    types = js("objects.json")["types"]
    assert set(types) == set(EXPECT_OBJ)
    assert "crate" not in types
    for name, (rows, nfr, hold, npieces, seq) in EXPECT_OBJ.items():
        t = types[name]
        assert t["id"] == A.OT[name]
        assert t["rows"] == rows and t["hold"] == hold and t["seq"] == seq, name
        assert max(t["seq"]) + 1 == nfr and 1 <= len(t["seq"]) <= 8, name
        assert len(t["pieces"]) == npieces, name
        assert 1 <= t["palette"] <= 5, name
        assert t["stride"] in (2, 4)
        width = max(p[2] % 16 + (4 if p[3] & 1 else 2) for p in t["pieces"])
        assert width + (nfr - 1) * t["stride"] <= 16, name
        for dx, dy, ch, fl in t["pieces"]:
            size = 4 if fl & 1 else 2
            assert ch // 16 + size <= rows, name                 # piece stays inside the strip rows
            assert -128 <= dx <= 127 and -128 <= dy <= 127
    assert types["sprint_cp"]["alias"] == "checkpoint_flag"
    assert (types["sprint_cp"]["bank"], types["sprint_cp"]["addr"]) == \
           (types["checkpoint_flag"]["bank"], types["checkpoint_flag"]["addr"])
    # contract 2.3 piece offsets
    assert types["saw"]["pieces"] == [[-16, -28, 0, 1]]
    assert [p[:2] for p in types["ladder"]["pieces"]] == [[-8, -51], [-8, -35], [-8, -19], [-8, -3]]
    assert types["exit"]["pieces"] == [[-16, -30, 0, 1]]
    assert types["sprint_cp"]["pieces"] == [[-16, -30, 0, 1]]
    assert [p[:2] + [p[3]] for p in types["door_locked"]["pieces"]] == [[-18, -52, 1], [-18, -20, 0], [-2, -20, 0]]
    assert types["coin_gold"]["pieces"] == [[-8, -14, 0, 0]]
    assert types["frog"]["pieces"] == [[-16, -32, 0, 1]]
    assert types["bat"]["pieces"] == [[-16, -26, 0, 1]]
    # strips do not overlap and stay inside their bank
    spans = sorted((t["bank"], t["addr"], t["addr"] + t["rows"] * 512) for n, t in types.items() if not t["alias"])
    for a, b in zip(spans, spans[1:]):
        assert a[0] != b[0] or a[2] <= b[1]
    for bank, lo, hi in spans:
        assert hi - 0x8000 <= len(rd("objgfx%d.bin" % bank))
    # contract 2.3 row budget examples
    r = {n: t["rows"] for n, t in types.items()}
    assert sum(r[n] for n in ("coin_gold", "coin_silver", "gem", "heart", "key", "star", "spikes", "fire",
                              "bounce_pad", "ladder", "slime_blue", "slime_red", "crab")) == 26
    assert sum(r[n] for n in ("saw", "checkpoint_flag", "door_locked", "bat", "frog", "exit")) == 24


def test_objgfxtable_source():
    inc = rd("objects.inc").decode()
    assert "ObjGfxTable:" in inc
    types = js("objects.json")["types"]
    rows = re.findall(r"\.byte (\d+)\n\s+\.addr (\$[0-9A-F]+|0)\n\s+\.byte (\$[0-9A-F]+|\d+), (\d+), (\d+), (\d+), (\d+)", inc)
    assert len(rows) == A.OT_COUNT
    cp = rows[A.OT["sprint_cp"]]
    assert int(cp[2][1:], 16) == (A.OG_ALIAS | A.OT["checkpoint_flag"])
    assert rows[0][2] == "0" and rows[A.OT["crate"]][2] == "0"
    for name, t in types.items():
        row = rows[t["id"]]
        assert int(row[3]) == t["palette"] and int(row[4]) == t["stride"]
        assert int(row[5]) == len(t["seq"]) and int(row[6]) == t["hold"]


def _expected_object_pixels(name, t, frame):
    """Source pixels of one strip frame, relative to the anchor, facing right."""
    k, rel, fw, fh, sf, mirror = next(s for s in t["src"] if s[0] == frame)
    img = A.load_rgba(str(ASSETS), rel)
    cols = img.width // fw
    g = A.grab(img, (sf % cols) * fw, (sf // cols) * fh, fw, fh)
    if mirror:
        g = [row[::-1] for row in g]
    if name == "saw":                       # 34x34 cropped by 1 px on each side
        g = [row[1:33] for row in g[1:33]]
        return px_of(g, -16, -28)
    if name == "ladder":                    # art rows 13..63 at dy -51
        return px_of(g[13:64], -8, -51)
    if name == "door_locked":
        return px_of(g, -18, -52)
    dx, dy = t["pieces"][0][0], t["pieces"][0][1]
    return px_of(g, dx, dy)


def test_object_round_trip():
    types = js("objects.json")["types"]
    n = 0
    for name, t in types.items():
        if t["alias"]:
            continue
        for frame in range(max(t["seq"]) + 1):
            want = _expected_object_pixels(name, t, frame)
            got = A.decode_object_frame(str(GEN), name, frame)
            assert got == want, "%s frame %d" % (name, frame)
            assert want, "%s frame %d is empty" % (name, frame)
            n += 1
    assert n >= 80
    # mirrored art really faces right: slime source is the h-flip of the strip
    src = src_grid("enemies/slime_blue.png", 0, 0, 16, 16)
    got = A.decode_object_frame(str(GEN), "slime_blue", 0)
    assert got == px_of([row[::-1] for row in src], -8, -16)
    assert src != [row[::-1] for row in src]


def test_object_anchor_geometry():
    """Art sits on / around the anchor the way contract 6.2 implies."""
    def bbox(name, fr=0):
        px = A.decode_object_frame(str(GEN), name, fr)
        xs = [p[0] for p in px]
        ys = [p[1] for p in px]
        return min(xs), min(ys), max(xs) + 1, max(ys) + 1
    assert bbox("ladder") == (-8, -51, 8, 0)
    assert bbox("door_locked")[3] == -4 and bbox("door_locked")[1] == -52
    assert bbox("spikes")[3] == 0 and bbox("slime_blue")[3] == 0
    assert bbox("frog")[3] == 0 and bbox("checkpoint_flag")[3] == 0
    x0, y0, x1, y1 = bbox("saw")
    assert (x0, y0, x1, y1) == (-16, -28, 16, 4)
    x0, y0, x1, y1 = bbox("coin_gold")
    assert -8 <= x0 and x1 <= 8 and -14 <= y0 and y1 <= 2


def test_alt_palettes_recolour():
    """OBJ palette 6 / 7 turn the exit / checkpoint strips into the gold / green sheets."""
    for name, alt_rel, pal, tol in (("exit", "objects/flag-checkered-gold.png", 6, 0.06),
                                    ("checkpoint_flag", "objects/flag-green.png", 7, 0.0)):
        bad = tot = 0
        for k, sf in enumerate((0, 2, 4, 6)):
            want = px_of(src_grid(alt_rel, sf * 32, 0, 32, 32))
            got0 = A.decode_object_frame(str(GEN), name, k, palette=pal)
            dx, dy = js("objects.json")["types"][name]["pieces"][0][:2]
            got = {(x - dx, y - dy): c for (x, y), c in got0.items()}
            assert set(got) == set(want), name
            tot += len(want)
            bad += sum(1 for p in want if want[p] != got[p])
        assert bad <= tol * tot, "%s: %d of %d recoloured pixels differ" % (name, bad, tot)


# ---------------------------------------------------------------------------
# font / HUD
# ---------------------------------------------------------------------------
def test_font_and_hud_chr():
    font = rd("font.bin")
    assert font[:16] == bytes(16)                              # space
    for ch in "AZ09!?":
        t = ord(ch) - 0x20
        assert any(font[t * 16:(t + 1) * 16]), ch
    assert font[(ord("A") - 32) * 16:(ord("A") - 31) * 16] != font[(ord("B") - 32) * 16:(ord("B") - 31) * 16]
    hud = rd("hudchr.bin")
    icons = [hud[i * 16:(i + 1) * 16] for i in range(16)]
    assert all(any(i) for i in icons[:7]) and len(set(icons[:7])) == 7
    assert all(not any(i) for i in icons[7:])


# ---------------------------------------------------------------------------
# the generated .inc files assemble and land in the contract's banks
# ---------------------------------------------------------------------------
def test_inc_files_assemble_and_link():
    gen()
    if not (shutil.which("ca65") and shutil.which("ld65")):
        print("    (skipped: cc65 not installed)")
        return
    tmp = SNES / "build" / "test_assets"
    tmp.mkdir(parents=True, exist_ok=True)
    src = tmp / "assets_test.s"
    src.write_text(
        '.p816\n.include "gen/tilelib.inc"\n.include "gen/gfxsys.inc"\n'
        '.include "gen/player.inc"\n.include "gen/objects.inc"\n'
        '.export TileLibPal, FontChr, HudChr, Bg3Palettes, BgPalettes, ObjPalettes\n'
        '.export PlayerFrameTable, PlayerAnimTable, PlayerAnimFrames, ObjGfxTable\n'
        '.exportzp T_COUNT = <TILELIB_COUNT, T_VER = TILELIB_VERSION, P_COUNT = PLAYER_FRAME_COUNT\n')
    obj = tmp / "assets_test.o"
    r = subprocess.run(["ca65", "--cpu", "65816", "-I", "src", "-I", "build", "--bin-include-dir", "build",
                        "-o", str(obj), str(src)], capture_output=True, text=True, cwd=SNES)
    assert r.returncode == 0, r.stderr
    rom, lbl = tmp / "assets_test.bin", tmp / "assets_test.lbl"
    r = subprocess.run(["ld65", "-C", "lorom.cfg", "-o", str(rom), "-Ln", str(lbl), str(obj)],
                       capture_output=True, text=True, cwd=SNES)
    assert r.returncode == 0, r.stderr
    labels = {}
    for line in lbl.read_text().splitlines():
        p = line.split()
        if len(p) == 3:
            labels[p[2].lstrip(".")] = int(p[1], 16)
    for name in ("TileLibPal", "FontChr", "HudChr", "Bg3Palettes", "BgPalettes", "ObjPalettes",
                 "PlayerFrameTable", "PlayerAnimTable", "PlayerAnimFrames", "ObjGfxTable"):
        assert name in labels, name
        assert labels[name] >> 16 == 0x01 and (labels[name] & 0xFFFF) >= 0x8000, name
    data = rom.read_bytes()

    def at(bank, addr, n):
        o = bank * 0x8000 + (addr - 0x8000)
        return data[o:o + n]
    # tile id t lives at bank 2 + (t >> 8), $8000 + (t & $FF) * 128
    lib = rd("tilelib.bin")
    for t in (1, 255, 256, 300, 511, 512, 572):
        assert at(2 + (t >> 8), 0x8000 + (t & 0xFF) * 128, 128) == lib[t * 128:(t + 1) * 128], t
    a = labels["TileLibPal"] & 0xFFFF
    assert at(1, a, 573) == rd("tilelibpal.bin")
    assert at(1, labels["BgPalettes"] & 0xFFFF, 192) == rd("bgpal.bin")
    assert at(1, labels["ObjPalettes"] & 0xFFFF, 256) == rd("objpal.bin")
    assert at(1, labels["FontChr"] & 0xFFFF, 1536) == rd("font.bin")
    # frame records and chr reachable through the tables
    m = js("player.json")
    ft = labels["PlayerFrameTable"] & 0xFFFF
    for i, f in enumerate(m["frames"]):
        rec = int.from_bytes(at(1, ft + 2 * i, 2), "little")
        hdr = at(1, rec, 4 + 2 * f["n"])
        assert hdr[0] == f["n"] and hdr[1] == f["bank"]
        assert int.from_bytes(hdr[2:4], "little") == f["addr"]
        cells = [[b - 256 if b > 127 else b for b in hdr[4 + 2 * k:6 + 2 * k]] for k in range(f["n"])]
        assert cells == f["cells"], i
        assert at(6 + f["bank"], f["addr"], f["n"] * 128) == \
            rd("player%d.bin" % f["bank"])[f["addr"] - 0x8000:f["addr"] - 0x8000 + f["n"] * 128]
    at_ = labels["PlayerAnimTable"] & 0xFFFF
    af = labels["PlayerAnimFrames"] & 0xFFFF
    for i, an in enumerate(m["anims"]):
        cnt, hold, flags, first = at(1, at_ + 4 * i, 4)
        assert (cnt, hold, flags, first) == (len(an["frames"]), an["hold"], an["loop"], an["first"])
        assert list(at(1, af + first, cnt)) == an["frames"]
    og = labels["ObjGfxTable"] & 0xFFFF
    for name, t in js("objects.json")["types"].items():
        e = at(1, og + 12 * t["id"], 12)
        assert e[0] == t["bank"] and int.from_bytes(e[1:3], "little") == t["addr"]
        seq = int.from_bytes(e[8:10], "little")
        assert list(at(1, seq, e[6])) == t["seq"], name
        pc = int.from_bytes(e[10:12], "little")
        assert at(1, pc, 1)[0] == len(t["pieces"])
        raw = at(1, pc + 1, 4 * len(t["pieces"]))
        assert [[(b - 256 if b > 127 and j < 2 else b) for j, b in enumerate(raw[4 * k:4 * k + 4])]
                for k in range(len(t["pieces"]))] == t["pieces"], name
        if not t["alias"]:
            assert e[3] == t["rows"]
            assert at(10 + t["bank"], t["addr"], 64) == rd("objgfx%d.bin" % t["bank"])[t["addr"] - 0x8000:][:64]


def test_preview_renders():
    gen()
    dst = SNES / "build" / "preview"
    paths = A.preview(str(GEN), str(dst))
    names = {Path(p).name for p in paths}
    assert {"tilelib.png", "player.png", "objects.png", "hud.png", "palettes.png"} <= names
    for p in paths:
        im = Image.open(p)
        assert im.width > 100 and im.height > 50
        assert len(im.convert("RGB").getcolors(1 << 20)) > 3, p


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
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
