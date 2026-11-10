#!/usr/bin/env python3
"""Tests of the SNESWAMP room pipeline (tools/mkrooms.py, rooms/*.json, tools/roomsim.py).

Needs python3 + Pillow only (no emulator, no cc65):
    python3 tests/test_rooms.py
    python3 -m pytest tests/test_rooms.py -v

What is covered:
  * RLE1 encoder/decoder (contract example, random data, run/literal limits)
  * every room of rooms/world.json compiles and the decoded blob equals the source snapshot:
    tiles (independent re-derivation of library ids, flips, priority), collision classes
    (independent re-derivation from tools/tilemeta.json), objects, goal, header fields
  * limits (N <= 255, M <= 64, strip rows <= 28, sizes) and every documented converter error
  * world index bytes, rooms.inc / rooms.json
  * world layout: neighbours' edge openings line up, edges without a neighbour are closed,
    the world is connected
  * every world room is beatable and traversable under the contract physics (tools/roomsim.py)
  * the test rooms contain what ARCHITECTURE.md 7.2 asks for
  * --dump / --render command line
"""
import copy
import io
import json
import os
import random
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

SNES = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SNES / "tools"))

import mkrooms  # noqa: E402
import roomsim  # noqa: E402
from mkrooms import RoomError, TC  # noqa: E402

ROOMS = SNES / "rooms"
GEN = SNES / "build" / "gen"
W, H = 40, 22

_cache = {}


def ctx(strict=False):
    return mkrooms.Context(str(GEN), strict=strict, quiet=True)


def world():
    """(manifest, start index, entries with blob/info, decoded blobs by name, snapshots by name)"""
    if "world" not in _cache:
        man, start = mkrooms.load_manifest(str(ROOMS))
        c = ctx()
        entries, start2 = mkrooms.build_world(str(ROOMS), c)
        assert start == start2
        snaps, decoded = {}, {}
        for e in entries:
            with open(ROOMS / e["file"]) as f:
                snaps[e["name"]] = json.load(f)
            decoded[e["name"]] = mkrooms.decode_blob(e["blob"])
        _cache["world"] = (man, start, entries, decoded, snaps, c)
    return _cache["world"]


def world_rooms():
    """entries of the playable world (test rooms live at x >= 100)"""
    return [e for e in world()[2] if e["x"] < 100]


def by_xy():
    return {(e["x"], e["y"]): e for e in world()[2]}


def tilemeta():
    with open(SNES / "tools" / "tilemeta.json") as f:
        return {int(k): v for k, v in json.load(f).items()}


def library():
    """gid -> (library id, blank) from the same file the compiler uses"""
    c = world()[5]
    return {g: (i, g in c.blank_gids) for g, i in c.gid_to_id.items()}


def base_snapshot():
    """A small valid snapshot for the error tests."""
    return copy.deepcopy(world()[4]["test_flat"])


# ---------------------------------------------------------------------------------------------
# RLE1
# ---------------------------------------------------------------------------------------------
def test_rle_contract_example():
    data = bytes.fromhex("83 00 01 05 09 FF 11")
    out, end = mkrooms.rle1_decode(data, 0, count=5 + 2 + 129)
    assert out == b"\x00" * 5 + b"\x05\x09" + b"\x11" * 129 and end == len(data)


def test_rle_roundtrip():
    rnd = random.Random(1234)
    cases = [bytes(880), bytes([7]) * 880, bytes(range(256)) * 3 + bytes(112),
             bytes([1, 1, 2, 2, 3, 3] * 146 + [9, 9, 9, 9])]
    for _ in range(200):
        n_vals = rnd.choice([1, 2, 3, 8, 255])
        buf = bytearray()
        while len(buf) < 880:
            buf += bytes([rnd.randrange(n_vals)]) * rnd.choice([1, 1, 2, 3, 5, 40, 130, 300])
        cases.append(bytes(buf[:880]))
    for data in cases:
        enc = mkrooms.rle1_encode(data)
        out, end = mkrooms.rle1_decode(enc, 0)
        assert out == data and end == len(enc)
        assert len(enc) <= 880 + 7                       # worst case: literals of 128
    assert len(mkrooms.rle1_encode(bytes(880))) == 14     # 6 runs of 129 + 1 of 106
    # runs are only emitted for >= 3 equal bytes
    assert mkrooms.rle1_encode(b"\x01\x01\x02") == b"\x02\x01\x01\x02"
    assert mkrooms.rle1_encode(b"\x01\x01\x01") == b"\x81\x01"


def test_rle_decoder_traps():
    for bad in (b"\xff\x00" * 7, b"\x05\x01\x02", b"\x80"):
        try:
            mkrooms.rle1_decode(bad, 0)
        except RoomError:
            continue
        raise AssertionError("decoder accepted %r" % bad)


# ---------------------------------------------------------------------------------------------
# Round trip: source snapshot == decoded blob
# ---------------------------------------------------------------------------------------------
def expected_planes(snap):
    """Independent re-derivation of the visual planes as (library id, attr) per cell."""
    lib = library()

    def cell(v):
        if v <= 0:
            return 0, 0, 0
        gid = v & 0xFFFFF
        fx, fy = (v >> 20) & 1, (v >> 21) & 1
        if 669 <= gid <= 732:
            fx = fy = 0
        lid, blank = lib[gid]
        return gid, (0 if blank else lid), (0x40 if fx else 0) | (0x80 if fy else 0)

    td = snap["tileData"]
    bg1, bg2 = [], []
    for y in range(H):
        for x in range(W):
            _tg, tl, ta = cell(td["terrain"][y][x])
            fg, fl, fa = cell(td["foreground"][y][x])
            if fg and fl:
                bg1.append((fl, fa | 0x20))
            else:
                bg1.append((tl, ta if tl else 0))
            _bg, bl, ba = cell(td["background"][y][x])
            bg2.append((bl, ba if bl else 0))
    return bg1, bg2


def expected_collision(snap):
    meta = tilemeta()
    surf = {"ice": "TC_ICE", "bounce": "TC_BOUNCE", "crumbling": "TC_CRUMBLE",
            "conveyorLeft": "TC_CONV_L", "conveyorRight": "TC_CONV_R"}
    td = snap["tileData"]
    out = []
    for y in range(H):
        for x in range(W):
            gids = {layer: (td[layer][y][x] & 0xFFFFF if td[layer][y][x] > 0 else 0)
                    for layer in ("background", "terrain", "foreground")}
            t = gids["terrain"]
            dmg, wat = 677 in gids.values(), 682 in gids.values()
            kind = meta[t]["kind"] if t else None
            if kind in surf:
                name = surf[kind]
            elif t == 670:
                name = "TC_DAMAGE" if dmg else "TC_ONEWAY_WATER" if wat else "TC_ONEWAY"
            elif t and meta[t]["solid"]:
                name = "TC_SOLID_DAMAGE" if dmg else "TC_SOLID"
            else:
                name = "TC_DAMAGE" if dmg else "TC_WATER" if wat else "TC_EMPTY"
            out.append(TC[name])
    return bytes(out)


def test_all_rooms_compile():
    man, start, entries, decoded, snaps, c = world()
    assert len(entries) == len(man["rooms"]) >= 12
    assert man["rooms"][start]["file"] == man["start"]
    assert (entries[start]["x"], entries[start]["y"]) == (0, 0)
    assert not c.warnings, c.warnings
    names = [e["name"] for e in entries]
    assert len(set(names)) == len(names)
    for want in ("test_flat", "test_walls", "test_tiles", "test_objects_a", "test_objects_b",
                 "test_edge_a", "test_edge_b"):
        assert want in names, want
    assert len(world_rooms()) == 12


def test_roundtrip_tiles():
    _man, _start, entries, decoded, snaps, _c = world()
    for e in entries:
        d, snap = decoded[e["name"]], snaps[e["name"]]
        bg1, bg2 = expected_planes(snap)
        tiles = d["tiles"]
        assert len(tiles) == len(set(tiles)) and 0 not in tiles
        for plane_t, plane_a, exp, what in ((d["bg1_tile"], d["bg1_attr"], bg1, "BG1"),
                                             (d["bg2_tile"], d["bg2_attr"], bg2, "BG2")):
            for i in range(W * H):
                s = plane_t[i]
                got = (tiles[s - 1] if s else 0, plane_a[i])
                assert got == exp[i], "%s %s cell %d,%d: blob %r, source %r" % (e["name"], what, i % W, i // W, got, exp[i])
        # every listed tile is used, slots are numbered in first-use order
        used = [s for s in list(d["bg1_tile"]) + list(d["bg2_tile"]) if s]
        assert set(used) == set(range(1, len(tiles) + 1)), e["name"]
        first = []
        for s in used:
            if s not in first:
                first.append(s)
        assert first == sorted(first), e["name"]
        # BG2 never carries the priority bit
        assert not any(a & 0x20 for a in d["bg2_attr"]), e["name"]


def test_roundtrip_collision():
    _man, _start, entries, decoded, snaps, _c = world()
    for e in entries:
        d = decoded[e["name"]]
        exp = expected_collision(snaps[e["name"]])
        assert d["coll"] == exp, "%s: collision plane differs at cell %s" % (
            e["name"], next(i for i in range(880) if d["coll"][i] != exp[i]))
        assert e["checksum"] == sum(exp) & 0xFFFF == d["checksum"]


ANCHOR = {"coin_gold": (1, 0, 6), "coin_silver": (2, 0, 6), "gem": (3, 0, 6), "heart": (4, 0, 6), "key": (5, 0, 6),
          "star": (6, 0, 6), "spikes": (7, 0, 8), "saw": (8, 0, 12), "fire": (9, 0, 7), "bounce_pad": (10, 0, 16),
          "ladder": (11, 0, 32), "checkpoint_flag": (12, 0, 16), "door_locked": (13, 2, 28),
          "slime_blue": (15, 0, 8), "slime_red": (16, 0, 8), "bat": (17, 0, 10), "crab": (18, 0, 8), "frog": (19, 0, 16)}


def test_roundtrip_objects_and_goal():
    _man, _start, entries, decoded, snaps, _c = world()
    goal_ids = {None: 0, "reach_exit": 1, "collect_target": 2, "defeat_all": 3, "checkpoint_sprint": 4}
    for e in entries:
        d, snap = decoded[e["name"]], snaps[e["name"]]
        exp = []
        for po in snap["placedObjects"]:
            t, ax, ay = ANCHOR[po["id"]]
            facing = po.get("facing") or ("right" if po["x"] <= 320 else "left")
            exp.append({"type": t, "x": po["x"] + ax, "y": po["y"] + ay, "layer": po.get("layer") or "terrain",
                        "left": facing == "left", "param": 0})
        goal = snap["goal"]
        gtype = goal_ids[goal["type"] if goal else None]
        param, limit = 0, 0
        if goal:
            limit = -(-(goal.get("timeLimitMs") or 0) // 1000)
            if goal["type"] == "reach_exit":
                exp.append({"type": 20, "x": goal["exit"]["x"], "y": goal["exit"]["y"], "layer": "terrain", "left": False, "param": 0})
            elif goal["type"] == "collect_target":
                param = goal["requiredCount"]
            elif goal["type"] == "defeat_all":
                param = sum(1 for o in exp if 15 <= o["type"] <= 19)
                assert param >= 1
            elif goal["type"] == "checkpoint_sprint":
                param = len(goal["checkpoints"])
                for k, p in enumerate(goal["checkpoints"]):
                    exp.append({"type": 21, "x": p["x"], "y": p["y"], "layer": "terrain", "left": False, "param": k})
                exp.append({"type": 20, "x": goal["finish"]["x"], "y": goal["finish"]["y"], "layer": "terrain", "left": False, "param": 1})
        got = [{k: o[k] for k in ("type", "x", "y", "layer", "left", "param")} for o in d["objects"]]
        assert got == exp, "%s: objects differ" % e["name"]
        assert (d["goal_type"], d["goal_param"], d["time_s"]) == (gtype, param, limit), e["name"]
        # header
        assert (d["x"], d["y"]) == (e["x"], e["y"])
        assert d["title"].rstrip() == snap["title"][:24]
        assert d["pits_deadly"] == bool(snap.get("pitsAreDeadly")) and not d["camera_room"]
        assert d["hearts"] == (snap.get("playerHearts") or 1)
        assert d["spawn"] == (snap["spawnPoint"]["x"], snap["spawnPoint"]["y"])
        assert d["lib_version"] == 1 and d["version"] == 1 and d["ruleset"] == 0
        assert d["backdrop"] == mkrooms.bgr555(mkrooms.BACKDROPS[snap["background"]])


def test_blob_layout():
    """Header offsets, section order and sizes exactly as contract 3.1 / 3.2."""
    for e in world()[2]:
        b = e["blob"]
        assert b[:4] == b"WSR1" and b[4] == 1 and b[5] == 0
        assert struct.unpack_from("<H", b, 6)[0] == len(b) == e["size"]
        n, m = b[0x16], b[0x17]
        assert b[0x18] == 1 and b[0x19] == 0
        offs = struct.unpack_from("<7H", b, 0x1A)
        o_tiles, o_b1t, o_b1a, o_b2t, o_b2a, o_coll, o_objs = offs
        assert o_tiles == 0x40 and o_b1t == o_tiles + 2 * n
        present = [o for o in offs if o]
        assert present == sorted(present) and len(set(present)) == len(present)
        assert o_b1t and o_coll and o_objs
        if not o_b2t:
            assert not o_b2a
        assert o_objs + 6 * m == len(b)
        # every plane decodes to exactly 880 bytes and ends where the next section starts
        order = [o for o in (o_b1t, o_b1a, o_b2t, o_b2a, o_coll) if o] + [o_objs]
        for a, nxt in zip(order, order[1:]):
            out, end = mkrooms.rle1_decode(b, a)
            assert len(out) == 880 and end == nxt, (e["name"], hex(a))
        assert all(0x20 <= c <= 0x7E for c in b[0x28:0x40])


def test_size_limits():
    entries = world()[2]
    total = 0
    for e in entries:
        assert e["tiles"] <= 255 and e["objects"] <= 64 and e["strip_rows"] <= 28, e["name"]
        assert e["size"] <= 5600, e["name"]
        total += e["size"]
    for e in world_rooms():
        assert e["size"] <= 1536, "%s is %d bytes (typical budget 0.6-1.5 KB)" % (e["name"], e["size"])
    assert total <= 0x8000 and all(e["bank"] == 0x0C for e in entries)
    addr = 0x8000
    for e in entries:
        assert e["addr"] == addr
        addr += e["size"]


# ---------------------------------------------------------------------------------------------
# Converter errors
# ---------------------------------------------------------------------------------------------
def expect_error(snap, *needles, strict=False, x=0, y=0):
    try:
        mkrooms.compile_room(snap, x, y, ctx(strict), "bad")
    except RoomError as e:
        for n in needles:
            assert n in str(e), "error %r does not mention %r" % (str(e), n)
        return str(e)
    raise AssertionError("compile_room accepted an invalid room (expected %r)" % (needles,))


def test_error_unknown_gid():
    for gid in (150, 460, 733, 1900, 10000):          # cave, smb, gothic, unused, custom tile
        s = base_snapshot()
        s["tileData"]["terrain"][5][7] = gid
        expect_error(s, "gid %d" % gid, "7,5", "terrain")
    s = base_snapshot()
    s["tileData"]["background"][0][0] = 805 | (1 << 20)   # backrooms, flipped
    expect_error(s, "gid 805", "background")


def test_error_special_outside_ruleset():
    for gid, kind in ((669, "breakableBrick"), (675, "sticky"), (678, "gravityUp"), (683, "windLeft")):
        s = base_snapshot()
        s["tileData"]["terrain"][3][3] = gid
        expect_error(s, str(gid), kind)


def test_error_unknown_object():
    s = base_snapshot()
    s["placedObjects"].append({"id": "moving_platform", "x": 100, "y": 100, "instanceId": "obj_x"})
    expect_error(s, "moving_platform", strict=True)
    c = ctx()
    blob, info = mkrooms.compile_room(s, 0, 0, c, "warn")          # default: dropped with a warning
    assert info["objects"] == 0 and any("moving_platform" in w for w in c.warnings)
    # ... but an error when the goal depends on it
    s["goal"] = {"type": "defeat_all", "timeLimitMs": None}
    expect_error(s, "defeat_all", "moving_platform")
    s["goal"] = {"type": "collect_target", "requiredCount": 1, "timeLimitMs": None}
    s["placedObjects"] = [{"id": "coin_small_gold", "x": 100, "y": 100, "instanceId": "obj_y"}]
    expect_error(s, "collect_target", "1 collectibles")


def test_error_unknown_goal():
    for goal in ({"type": "survival", "durationMs": 30000}, {"type": "collect_race", "timeLimitMs": None},
                 {"type": "npc_quest"}, {"type": "bogus"}):
        s = base_snapshot()
        s["goal"] = goal
        expect_error(s, "goal type", repr(goal["type"]))
    s = base_snapshot()
    s["goal"] = {"type": "reach_exit", "exit": None, "timeLimitMs": None}
    expect_error(s, "exit")
    s["goal"] = {"type": "reach_exit", "exit": {"x": 100, "y": 320}, "timeLimitMs": 1093000}
    expect_error(s, "time limit")
    s["goal"]["timeLimitMs"] = 59001
    blob, _ = mkrooms.compile_room(s, 0, 0, ctx(), "t")
    assert mkrooms.decode_blob(blob)["time_s"] == 60


def test_error_too_many_tiles():
    s = base_snapshot()
    lib = library()
    gids = [g for g, (_i, blank) in sorted(lib.items()) if not blank and not 669 <= g <= 732]
    assert len(gids) >= 256
    flat = gids[:256]
    for i, g in enumerate(flat):
        s["tileData"]["background"][i // W][i % W] = g
    expect_error(s, "distinct library tiles", "255")
    s["tileData"]["background"][255 // W][255 % W] = -1      # 255 distinct (+ those of the room itself?)
    s["tileData"]["terrain"] = [[-1] * W for _ in range(H)]
    s["tileData"]["foreground"] = [[-1] * W for _ in range(H)]
    blob, info = mkrooms.compile_room(s, 0, 0, ctx(), "max")
    assert info["tiles"] == 255
    d = mkrooms.decode_blob(blob)
    assert max(d["bg2_tile"]) == 255 and d["offsets"]["bg1_attr"] == 0


def test_error_objects():
    s = base_snapshot()
    s["placedObjects"] = [{"id": "coin_gold", "x": 20 + 8 * i, "y": 300, "instanceId": "obj_%d" % i} for i in range(65)]
    expect_error(s, "65 objects", "64")
    s["placedObjects"] = s["placedObjects"][:64]
    assert mkrooms.compile_room(s, 0, 0, ctx(), "ok")[1]["objects"] == 64
    s["goal"] = {"type": "reach_exit", "exit": {"x": 100, "y": 320}, "timeLimitMs": None}
    expect_error(s, "65 objects")                           # the goal marker counts
    for x, y in ((-20, 100), (700, 600), (100, -140)):
        s = base_snapshot()
        s["placedObjects"] = [{"id": "gem", "x": x, "y": y, "instanceId": "obj_a"}]
        expect_error(s, "anchor")
    s = base_snapshot()                                     # every strip type at once: 46 rows
    s["placedObjects"] = [{"id": k, "x": 100, "y": 100, "instanceId": "obj_%s" % k} for k in ANCHOR]
    expect_error(s, "strip rows", "28")


def test_error_misc():
    s = base_snapshot()
    s["smartTerrain"]["semanticCells"]["background:3,4"] = {"styleId": "forest", "brushId": "forest.ground"}
    expect_error(s, "background")
    s = base_snapshot()
    s["tileData"]["terrain"] = s["tileData"]["terrain"][:21]
    expect_error(s, "22 rows")
    s = base_snapshot()
    s["playerHearts"] = 5
    expect_error(s, "playerHearts")
    expect_error(base_snapshot(), "coordinates", x=200)
    s = base_snapshot()
    s["tileData"]["terrain"][0][0] = 1.5
    expect_error(s, "integer")


def test_spawn_resolution_and_defaults():
    s = base_snapshot()
    s["spawnPoint"] = None
    s["title"] = None
    s["background"] = "solid:#ff8000"
    s["cameraMode"] = "room"
    blob, _ = mkrooms.compile_room(s, -3, 7, ctx(), "t")
    d = mkrooms.decode_blob(blob)
    # column 20 is the 1-tile hole of test_flat: its lowest solid tile is row 21 with clear headroom
    assert d["spawn"] == (20 * 16 + 8, 21 * 16)
    assert d["title"].rstrip() == "ROOM -3,7" and (d["x"], d["y"]) == (-3, 7)
    assert d["backdrop"] == (31 | (16 << 5)) and d["camera_room"]
    s["tileData"]["terrain"] = [[-1] * W for _ in range(H)]
    d = mkrooms.decode_blob(mkrooms.compile_room(s, 0, 0, ctx(), "t")[0])
    assert d["spawn"] == (320, 39)


def test_collision_merge_rules():
    """Contract 3.2 table, cell by cell, on a synthetic room."""
    s = base_snapshot()
    for layer in s["tileData"]:
        s["tileData"][layer] = [[-1] * W for _ in range(H)]
    s["smartTerrain"] = None
    t, b, f = s["tileData"]["terrain"], s["tileData"]["background"], s["tileData"]["foreground"]
    cases = []

    def case(x, terrain, background, foreground, want):
        t[0][x], b[0][x], f[0][x] = terrain, background, foreground
        cases.append((x, want))

    case(0, 16, -1, -1, "TC_SOLID")
    case(1, 16, 677, -1, "TC_SOLID_DAMAGE")
    case(2, 16, -1, 677, "TC_SOLID_DAMAGE")
    case(3, 16, 682, -1, "TC_SOLID")
    case(4, 3, -1, -1, "TC_EMPTY")                 # forest decoration: non-solid
    case(5, 677, -1, -1, "TC_DAMAGE")
    case(6, -1, 677, -1, "TC_DAMAGE")
    case(7, -1, -1, 682, "TC_WATER")
    case(8, 682, 677, -1, "TC_DAMAGE")
    case(9, 670, -1, -1, "TC_ONEWAY")
    case(10, 670, 682, -1, "TC_ONEWAY_WATER")
    case(11, 674, -1, -1, "TC_ICE")
    case(12, 676, -1, -1, "TC_BOUNCE")
    case(13, 687, -1, -1, "TC_CRUMBLE")
    case(14, 672, -1, -1, "TC_CONV_L")
    case(15, 673, -1, -1, "TC_CONV_R")
    case(16, -1, 16, 16, "TC_EMPTY")               # background / foreground never collide
    case(17, 16 | (1 << 20) | (1 << 21), -1, -1, "TC_SOLID")
    case(18, 500, -1, -1, "TC_SOLID")              # essentials: solid by default
    c = ctx()
    d = mkrooms.decode_blob(mkrooms.compile_room(s, 0, 0, c, "merge")[0])
    for x, want in cases:
        assert d["coll"][x] == TC[want], "case %d: %s, want %s" % (x, mkrooms.TC_NAMES[d["coll"][x]], want)
    assert not c.warnings
    # visual merge: foreground wins and gets the priority bit; flips map to the attr bits
    assert d["bg1_attr"][2] == 0x20 and d["tiles"][d["bg1_tile"][2] - 1] == library()[677][0]
    assert d["bg1_attr"][17] == 0xC0 and d["bg1_attr"][0] == 0
    assert d["bg1_attr"][16] == 0x20 and d["bg2_attr"][16] == 0
    # dropped combinations warn
    t[0][20], b[0][20] = 674, 677
    t[0][21], b[0][21] = 670, 677
    c = ctx()
    d = mkrooms.decode_blob(mkrooms.compile_room(s, 0, 0, c, "merge")[0])
    assert d["coll"][20] == TC["TC_ICE"] and d["coll"][21] == TC["TC_DAMAGE"] and len(c.warnings) == 2


# ---------------------------------------------------------------------------------------------
# World index and generated files
# ---------------------------------------------------------------------------------------------
def test_world_index():
    _man, start, entries, _d, _s, _c = world()
    wi = mkrooms.world_index_bytes(entries, start)
    assert wi[:4] == b"WSW1" and wi[4] == len(entries) and wi[5] == start and wi[6:8] == b"\0\0"
    assert len(wi) == 8 + 6 * len(entries)
    for i, e in enumerate(entries):
        x, y, addr, bank, flags = struct.unpack_from("<bbHBB", wi, 8 + 6 * i)
        assert (x, y, addr, bank, flags) == (e["x"], e["y"], e["addr"], e["bank"], 0)
        assert 0x8000 <= addr and addr + e["size"] <= 0x10000 and 0x0C <= bank <= 0x0F
    coords = [(e["x"], e["y"]) for e in entries]
    assert len(set(coords)) == len(coords)


def test_generated_files():
    """write_outputs(): rooms.inc, rooms.json, one .bin per room (in a temp dir; build/gen if present too)."""
    _man, start, entries, decoded, _s, _c = world()
    with tempfile.TemporaryDirectory() as tmp:
        mkrooms.write_outputs([dict(e) for e in entries], start, tmp)
        inc = open(os.path.join(tmp, "rooms.inc")).read()
        listing = json.load(open(os.path.join(tmp, "rooms.json")))
        assert "ROOM_COUNT      = %d" % len(entries) in inc and "WorldIndex:" in inc
        assert '.segment "ROOMS0"' in inc and '.segment "DATA1"' in inc
        for e, row in zip(entries, listing):
            assert "Room_%d:" % e["index"] in inc
            for key in ("index", "name", "x", "y", "file", "checksum"):
                assert row[key] == e[key]
            assert open(os.path.join(tmp, row["bin"]), "rb").read() == e["blob"]
            assert '.incbin "gen/%s"' % row["bin"] in inc
        assert sum(1 for r in listing if r["start"]) == 1 and listing[start]["start"]
    if (GEN / "rooms.json").exists():                      # `make` output must match the sources
        listing = json.load(open(GEN / "rooms.json"))
        assert [r["name"] for r in listing] == [e["name"] for e in entries], "build/gen/rooms.json is stale: run make"
        for e, row in zip(entries, listing):
            assert (GEN / row["bin"]).read_bytes() == e["blob"], "build/gen/%s is stale: run make" % row["bin"]


def test_rooms_inc_assembles_and_links():
    """gen/rooms.inc through ca65/ld65 with the project's lorom.cfg: the ROM image holds the world index
    and every blob exactly where the index points (skipped when cc65 is not installed)."""
    import re
    import shutil
    if not shutil.which("ca65") or not shutil.which("ld65"):
        print("     (cc65 not found, skipped)")
        return
    _man, start, entries, _d, _s, _c = world()
    with tempfile.TemporaryDirectory() as tmp:
        gen = os.path.join(tmp, "gen")
        mkrooms.write_outputs([dict(e) for e in entries], start, gen)
        src = os.path.join(tmp, "t.s")
        open(src, "w").write('.p816\n.include "gen/rooms.inc"\n.export WorldIndex\n')
        obj, rom, lbl = (os.path.join(tmp, n) for n in ("t.o", "t.sfc", "t.lbl"))
        subprocess.run(["ca65", "--cpu", "65816", "-g", "-I", tmp, "--bin-include-dir", tmp, "-o", obj, src], check=True)
        r = subprocess.run(["ld65", "-C", str(SNES / "lorom.cfg"), "-o", rom, "-Ln", lbl, obj], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        image = open(rom, "rb").read()
        labels = {m.group(2): int(m.group(1), 16) for m in re.finditer(r"al ([0-9A-Fa-f]+) \.(\w+)", open(lbl).read())}

        def off(a):
            return ((a >> 16) & 0x7F) * 0x8000 + (a & 0x7FFF)

        wi = off(labels["WorldIndex"])
        assert labels["WorldIndex"] >> 16 == 0x01                      # DATA1
        want = mkrooms.world_index_bytes(entries, start)
        assert image[wi:wi + len(want)] == want
        for e in entries:
            a = off((e["bank"] << 16) | e["addr"])
            assert image[a:a + e["size"]] == e["blob"], e["name"]
            assert labels["Room_%d" % e["index"]] == (e["bank"] << 16) | e["addr"]


def test_cli_dump_and_render():
    e = world()[2][0]
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "room.bin")
        open(path, "wb").write(e["blob"])
        tool = str(SNES / "tools" / "mkrooms.py")
        r = subprocess.run([sys.executable, tool, "--dump", path], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        assert "Wamp Woods" in r.stdout and "collect_target" in r.stdout and "coin_gold" in r.stdout
        assert r.stdout.count("#" * 40) >= 3               # the solid ground rows of the collision dump
        png = os.path.join(tmp, "room.png")
        r = subprocess.run([sys.executable, tool, "--render", path, "-o", png, "--gen", str(GEN)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
        from PIL import Image
        im = Image.open(png)
        assert im.size == (1280, 704) and len(im.getcolors(1 << 20)) > 8
        open(path, "wb").write(e["blob"][:100])
        r = subprocess.run([sys.executable, tool, "--dump", path], capture_output=True, text=True)
        assert r.returncode == 1 and "error" in r.stderr
    out = io.StringIO()
    mkrooms.dump_blob(e["blob"], out)
    assert "spawn    (56,288)" in out.getvalue()


# ---------------------------------------------------------------------------------------------
# World layout
# ---------------------------------------------------------------------------------------------
def solid(d, x, y):
    return bool(d["coll"][y * W + x] & 0x80)


def passable_kind(d, x, y):
    """'solid' / 'open' (one-way cells are open for seam purposes)"""
    return "solid" if solid(d, x, y) else "open"


def test_world_shape():
    rooms = world_rooms()
    coords = {(e["x"], e["y"]) for e in rooms}
    assert (0, 0) in coords and len(coords) == 12
    xs, ys = [c[0] for c in coords], [c[1] for c in coords]
    assert max(xs) - min(xs) <= 5 and max(ys) - min(ys) == 2
    titles = [e["title"] for e in rooms]
    assert len(set(titles)) == 12 and all(titles)
    goals = [e["goal"] for e in rooms]
    for g in ("reach_exit", "collect_target", "defeat_all", "checkpoint_sprint"):
        assert goals.count(g) >= 2, "goal mix: %s" % goals
    # test rooms are isolated from the world and from each other, except the edge pair
    all_xy = by_xy()
    for e in world()[2]:
        if e["x"] >= 100:
            nb = [n for n in ((e["x"] - 1, e["y"]), (e["x"] + 1, e["y"]), (e["x"], e["y"] - 1), (e["x"], e["y"] + 1)) if n in all_xy]
            want = {"test_edge_a": ["test_edge_b"], "test_edge_b": ["test_edge_a"]}.get(e["name"], [])
            assert [all_xy[n]["name"] for n in nb] == want, e["name"]


def test_neighbour_edges_align():
    """Every cell of a shared edge has the same solidity on both sides, each seam that is open is open
    for at least 2 rows (the standing body is 26 px tall), and the world is connected through them."""
    _man, _start, _entries, decoded, _s, _c = world()
    xy = {(e["x"], e["y"]): e for e in world_rooms()}
    links = {c: set() for c in xy}
    for (x, y), e in xy.items():
        d = decoded[e["name"]]
        right, below = xy.get((x + 1, y)), xy.get((x, y + 1))
        if right:
            dr = decoded[right["name"]]
            col_a = [passable_kind(d, W - 1, r) for r in range(H)]
            col_b = [passable_kind(dr, 0, r) for r in range(H)]
            assert col_a == col_b, "seam %s | %s: column 39 %s vs column 0 %s" % (
                e["name"], right["name"], "".join(c[0] for c in col_a), "".join(c[0] for c in col_b))
            opening = [r for r in range(H) if col_a[r] == "open"]
            if opening:
                # walkable: an open cell with ground under it and one more open cell above, same on both sides
                floors = [r for r in opening if r + 1 < H and col_a[r + 1] == "solid" and r - 1 in opening]
                assert floors, "seam %s | %s is open but has no walkable floor" % (e["name"], right["name"])
                links[(x, y)].add((x + 1, y))
                links[(x + 1, y)].add((x, y))
        if below:
            db = decoded[below["name"]]
            row_a = [passable_kind(d, c, H - 1) for c in range(W)]
            row_b = [passable_kind(db, c, 0) for c in range(W)]
            assert row_a == row_b, "seam %s / %s: row 21 %s vs row 0 %s" % (
                e["name"], below["name"], "".join(c[0] for c in row_a), "".join(c[0] for c in row_b))
            hatch = [c for c in range(W) if row_a[c] == "open"]
            if hatch:
                # vertical links are one-way hatches: never a bare hole (the player would fall through
                # and could not come back), and the lower room needs a foothold at y = 16 under it
                assert all(d["coll"][(H - 1) * W + c] == TC["TC_ONEWAY"] for c in hatch), \
                    "vertical seam %s / %s has an open cell that is not a one-way hatch" % (e["name"], below["name"])
                # foothold: under every hatch cell the lower room has a ladder top (support at y = 15)
                # or a solid block top at y = 16, so a 53 px jump lands on the hatch (top = y 336 above)
                for c in hatch:
                    ladder = any(o["type"] == 11 and o["x"] >> 4 == c and o["y"] - 51 + 2 <= 16 for o in db["objects"])
                    assert ladder or solid(db, c, 1), \
                        "hatch %s / %s: no foothold under column %d" % (e["name"], below["name"], c)
                links[(x, y)].add((x, y + 1))
                links[(x, y + 1)].add((x, y))
    seen, todo = {(0, 0)}, [(0, 0)]
    while todo:
        for n in links[todo.pop()]:
            if n not in seen:
                seen.add(n)
                todo.append(n)
    assert seen == set(xy), "rooms not connected to the start: %s" % sorted(set(xy) - seen)
    assert sum(len(v) for v in links.values()) // 2 >= 11


def test_edges_without_neighbour_are_closed():
    """Left/right edges with no neighbour are a visible solid wall; the bottom is solid ground unless
    the room has deadly pits; the top may be open sky (the engine's ceiling is 12 px inside)."""
    _man, _start, _entries, decoded, _s, _c = world()
    xy = {(e["x"], e["y"]): e for e in world_rooms()}
    for (x, y), e in xy.items():
        d = decoded[e["name"]]
        if (x - 1, y) not in xy:
            assert all(solid(d, 0, r) for r in range(H)), "%s: west edge has no neighbour but is open" % e["name"]
        if (x + 1, y) not in xy:
            assert all(solid(d, W - 1, r) for r in range(H)), "%s: east edge has no neighbour but is open" % e["name"]
        if (x, y + 1) not in xy and not d["pits_deadly"]:
            assert all(solid(d, c, H - 1) for c in range(W)), "%s: bottom edge has no neighbour but is open" % e["name"]
        if (x, y - 1) in xy:
            up = decoded[xy[(x, y - 1)]["name"]]
            assert not up["pits_deadly"], "%s has deadly pits above a neighbour" % xy[(x, y - 1)]["name"]


def test_oneway_cells_do_not_touch_solid_cells():
    """Web-game quirk (ARCHITECTURE.md, golden traces item 3): a one-way tile hides the facing side of
    an orthogonally adjacent solid tile, which the port does not reproduce.  World rooms keep one-way
    platforms free-standing; the only exception are the row-21 hatch cells (documented deviation)."""
    for e in world_rooms():
        c = world()[3][e["name"]]["coll"]
        for i in range(W * H):
            if c[i] in (TC["TC_ONEWAY"], TC["TC_ONEWAY_WATER"]):
                x, y = i % W, i // W
                if y == H - 1:
                    continue
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y + 1)):
                    assert not (0 <= nx < W and c[ny * W + nx] & 0x80), \
                        "%s: one-way cell %d,%d touches solid cell %d,%d" % (e["name"], x, y, nx, ny)


def enemy_zone(d, o):
    """Columns a floor enemy can get to (contract 6.2): slimes and crabs walk on their floor and turn
    at walls, curbs and ledges; a frog hop peaks at 39 px, so frogs climb up to 2 tiles and drop off
    ledges.  One-way cells are ground.  The locked door is a wall."""
    c = d["coll"]
    frog = o["type"] == 19

    def is_solid(x, y):
        if not (0 <= x < W and 0 <= y < H):
            return True
        for p in d["objects"]:
            if p["type"] == 13 and p["x"] - 16 <= x * 16 + 8 < p["x"] + 16 and p["y"] - 48 <= y * 16 + 8 < p["y"]:
                return True
        return bool(c[y * W + x] & 0x80)

    def ground(x, y):
        return is_solid(x, y) or (0 <= x < W and 0 <= y < H and c[y * W + x] in (TC["TC_ONEWAY"], TC["TC_ONEWAY_WATER"]))

    start = (o["x"] >> 4, o["y"] >> 4)          # (column, row of the floor cell under the feet)
    assert ground(*start), "%s does not stand on ground" % o["name"]
    seen, todo = {start}, [start]
    while todo:
        x, r = todo.pop()
        for nx in (x - 1, x + 1):
            if not 0 <= nx < W:
                continue
            nxt = None
            if not is_solid(nx, r - 1):
                if ground(nx, r):
                    nxt = (nx, r)
                elif frog:                         # hops off the ledge and lands below
                    rr = r
                    while rr < H and not ground(nx, rr):
                        rr += 1
                    nxt = (nx, rr) if rr < H else None
            elif frog:
                for up in (1, 2):                  # 16 / 32 px steps are inside a 39 px hop
                    if not is_solid(nx, r - 1 - up) and is_solid(nx, r - up) and not is_solid(x, r - 1 - up):
                        nxt = (nx, r - up)
                        break
            if nxt and nxt not in seen:
                seen.add(nxt)
                todo.append(nxt)
    return {x for x, _r in seen}


def test_floor_enemies_are_fenced_off_the_seams():
    """A slime, crab or frog must not be able to reach the 3 columns next to an edge that has a
    neighbour: the player walks in there and would be hit before he can react."""
    _man, _start, _entries, decoded, _s, _c = world()
    xy = {(e["x"], e["y"]): e for e in world_rooms()}
    for (x, y), e in xy.items():
        d = decoded[e["name"]]
        for o in d["objects"]:
            if o["type"] in (15, 16, 18, 19):
                zone = enemy_zone(d, o)
                if (x - 1, y) in xy:
                    assert min(zone) >= 3, "%s: %s can walk to the west seam (columns %d..%d)" % (
                        e["name"], o["name"], min(zone), max(zone))
                if (x + 1, y) in xy:
                    assert max(zone) <= W - 4, "%s: %s can walk to the east seam (columns %d..%d)" % (
                        e["name"], o["name"], min(zone), max(zone))


def test_spawns_are_safe():
    for e in world()[2]:
        d = world()[3][e["name"]]
        sx, sy = d["spawn"]
        assert sy % 16 == 0 and solid(d, sx >> 4, sy >> 4), "%s: spawn is not on solid ground" % e["name"]
        for r in ((sy - 1) >> 4, (sy - 26) >> 4):
            assert d["coll"][r * W + (sx >> 4)] == 0, "%s: spawn body is not in free space" % e["name"]
        for o in d["objects"]:
            if o["type"] in (7, 8, 9) or 15 <= o["type"] <= 19:
                assert abs(o["x"] - sx) >= 40 or abs(o["y"] - sy) >= 48, "%s: %s on top of the spawn" % (e["name"], o["name"])


def test_world_rooms_are_beatable():
    """tools/roomsim.py: from the spawn the goal can be completed without touching a hazard, and from
    every way into a room (spawn, each seam, each hatch) every way out can be reached, with plain
    run + jump (apex 53 px) + ladders + bounce + swimming under the contract's 8.8 physics."""
    listing = [{"name": e["name"], "x": e["x"], "y": e["y"]} for e in world()[2]]
    decoded = {(e["x"], e["y"]): world()[3][e["name"]] for e in world()[2]}
    report = []
    for e in listing:
        if e["x"] >= 100:
            continue
        x, y = e["x"], e["y"]
        nbr = {"L": decoded.get((x - 1, y)), "R": decoded.get((x + 1, y)),
               "U": decoded.get((x, y - 1)), "D": decoded.get((x, y + 1))}
        room = roomsim.Room(decoded[(x, y)], nbr)
        problems, _lines = roomsim.analyse(room)
        # every seam the layout test found must exist as a portal
        ports = room.portals()
        for side, n in nbr.items():
            if n is None:
                assert side not in ports
        report += ["%s: %s" % (e["name"], p) for p in problems]
    assert not report, "\n".join(report)


def test_jump_model_matches_contract():
    """The simulator reproduces the golden numbers of ARCHITECTURE.md 7.3 (so its verdicts mean something)."""
    flat = roomsim.Room(world()[3]["test_flat"], {})
    y0 = 320
    # full held jump straight up: apex 53.46 px -> minimum feet y = start - 54 (floor), ~47 frames airborne
    ys, vy, y, frames, min_y = y0 << 8, -roomsim.JUMP, y0, 0, y0
    while True:
        vy = min(vy + roomsim.G, roomsim.VMAX)
        ys += vy
        y = ys >> 8
        frames += 1
        min_y = min(min_y, y)
        if y >= y0:
            break
    assert min_y == y0 - 54 and 46 <= frames <= 48
    res, _ = flat.fly(100, y0, -roomsim.JUMP, (1, 999, 1, 999))
    assert res[0] == "land" and res[2] == y0 and 114 <= res[1] - 100 <= 121      # 117.5 px +- 3
    res, _ = flat.fly(100, y0, -roomsim.JUMP, (0, 999, 0, 1))                     # tap jump comes back
    assert res == ("land", 100, y0)
    # from the floor a 3-tile step is reachable, a 4-tile step is not (test_flat: cols 24-26 and 30-32)
    def tops_from(x0, x1):
        out = set()
        for x in range(x0, x1, 4):
            for prog in roomsim.PROGRAMS:
                res, _ = flat.fly(x, y0, -roomsim.JUMP, prog)
                if res and res[0] == "land":
                    out.add(res[2])
        return out
    assert 17 * 16 in tops_from(21 * 16 + 8, 24 * 16 - 5)
    assert tops_from(27 * 16 + 8, 30 * 16 - 5) <= {y0, 17 * 16}
    spots = flat.explore(flat.settle(56, 320)[0])["spots"]
    assert {y for (_x, y) in spots} == {320, 336, 272, 256}       # floor, hole, 3-step, 4-step via the 3-step


# ---------------------------------------------------------------------------------------------
# Test rooms (ARCHITECTURE.md 7.2)
# ---------------------------------------------------------------------------------------------
def test_test_rooms_content():
    dec = world()[3]
    xy = {e["name"]: (e["x"], e["y"]) for e in world()[2]}

    def cls(name, x, y):
        return mkrooms.TC_NAMES[dec[name]["coll"][y * W + x]]

    def types(name):
        return sorted(o["name"] for o in dec[name]["objects"])

    # test_flat: floor row 20, walls, 3- and 4-tile steps, ledge, 1-tile hole
    assert all(cls("test_flat", x, 20) == "TC_SOLID" for x in range(W) if x != 20)
    assert cls("test_flat", 20, 20) == "TC_EMPTY" and cls("test_flat", 20, 21) == "TC_SOLID"
    assert all(cls("test_flat", x, r) == "TC_SOLID" for x in (0, 39) for r in range(H))
    assert cls("test_flat", 24, 17) == "TC_SOLID" and cls("test_flat", 24, 16) == "TC_EMPTY"
    assert cls("test_flat", 30, 16) == "TC_SOLID" and cls("test_flat", 30, 15) == "TC_EMPTY"
    assert dec["test_flat"]["goal"] == "none" and dec["test_flat"]["spawn"] == (56, 320)
    assert all(cls("test_flat", x, r) == "TC_EMPTY" for x in range(1, 20) for r in range(0, 20))
    # test_walls: 3-wide shaft, ceiling notch, 1-tile-high tunnel
    assert all(cls("test_walls", 8, r) == "TC_SOLID" and cls("test_walls", 12, r) == "TC_SOLID" for r in range(4, 17))
    assert all(cls("test_walls", x, r) == "TC_EMPTY" for x in (9, 10, 11) for r in range(0, 20))
    assert cls("test_walls", 22, 16) == "TC_EMPTY" and cls("test_walls", 21, 16) == cls("test_walls", 23, 16) == "TC_SOLID"
    assert all(cls("test_walls", x, 18) == "TC_SOLID" and cls("test_walls", x, 19) == "TC_EMPTY" for x in range(30, 37))
    # test_tiles: every class
    classes = {mkrooms.TC_NAMES[c] for c in dec["test_tiles"]["coll"]}
    assert classes == set(TC), sorted(set(TC) - classes)
    assert cls("test_tiles", 16, 20) == "TC_SOLID_DAMAGE"
    assert [cls("test_tiles", x, 20) for x in range(26, 36)] == ["TC_CRUMBLE"] * 10
    # objects
    a = types("test_objects_a")
    assert set(a) == {"coin_gold", "coin_silver", "gem", "heart", "key", "star", "spikes", "fire", "bounce_pad",
                      "ladder", "slime_blue", "slime_red", "crab"}
    assert dec["test_objects_a"]["goal"] == "collect_target"
    b = types("test_objects_b")
    assert set(b) == {"saw", "checkpoint_flag", "door_locked", "key", "bat", "frog", "exit"}
    assert dec["test_objects_b"]["goal"] == "reach_exit"
    rows = {e["name"]: e["strip_rows"] for e in world()[2]}
    assert rows["test_objects_a"] == 26 and rows["test_objects_b"] == 26
    # edge pair
    assert xy["test_edge_b"] == (xy["test_edge_a"][0] + 1, xy["test_edge_a"][1])
    ea, eb = dec["test_edge_a"], dec["test_edge_b"]
    assert ea["goal"] == "defeat_all" and ea["goal_param"] == 2 and sorted(types("test_edge_a")) == ["slime_blue", "slime_red"]
    assert eb["goal"] == "checkpoint_sprint" and eb["goal_param"] == 2 and eb["pits_deadly"] and not ea["pits_deadly"]
    assert all(cls("test_edge_a", 39, r) == "TC_EMPTY" for r in range(0, 20)) and cls("test_edge_a", 39, 20) == "TC_SOLID"
    assert cls("test_edge_b", 0, 19) == "TC_SOLID" and cls("test_edge_b", 0, 18) == "TC_EMPTY"
    assert any(cls("test_edge_b", x, 21) == "TC_EMPTY" for x in range(W))


def test_checked_in_json_is_normalised_wamp():
    """The snapshots have the full RoomSnapshot shape the WAMP validators produce."""
    for name, snap in world()[4].items():
        for key in ("id", "coordinates", "title", "background", "goal", "spawnPoint", "tileData",
                    "placedObjects", "version", "status", "lighting", "weather"):
            assert key in snap, "%s lacks %s" % (name, key)
        assert snap["id"] == "%d,%d" % (snap["coordinates"]["x"], snap["coordinates"]["y"])
        assert set(snap["tileData"]) == {"background", "terrain", "foreground"}
        ids = [o["instanceId"] for o in snap["placedObjects"]]
        assert len(set(ids)) == len(ids) and all(i.startswith("obj_") for i in ids)
    for e in world_rooms():
        assert e["file"] == "world/%d,%d.json" % (e["x"], e["y"])
        snap = world()[4][e["name"]]
        assert (snap["coordinates"]["x"], snap["coordinates"]["y"]) == (e["x"], e["y"])
        assert any(v > 0 for row in snap["tileData"]["background"] for v in row), "%s has no background layer" % e["name"]
        assert any(v > 0 for row in snap["tileData"]["foreground"] for v in row), "%s has no foreground tiles" % e["name"]


def test_ruleset_coverage():
    """Across the world every ruleset-v0 object, special tile and tileset theme is used at least once."""
    dec = world()[3]
    types, classes, libs = set(), set(), set()
    for e in world_rooms():
        d = dec[e["name"]]
        types |= {o["name"] for o in d["objects"]}
        classes |= {mkrooms.TC_NAMES[c] for c in d["coll"]}
        libs |= set(d["tiles"])
    assert types >= set(ANCHOR) | {"exit", "sprint_cp"}, sorted((set(ANCHOR) | {"exit", "sprint_cp"}) - types)
    assert classes >= set(TC) - {"TC_SOLID_DAMAGE"}, sorted(set(TC) - classes)
    for first, last, first_id, tileset in mkrooms.LIB_RANGES[:5]:
        assert any(first_id <= t <= first_id + last - first for t in libs), "tileset %s is unused" % tileset


# ---------------------------------------------------------------------------------------------
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
