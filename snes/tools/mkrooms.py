#!/usr/bin/env python3
"""SNESWAMP room compiler: WAMP RoomSnapshot JSON -> room blob v1 ("WSR1") + world index ("WSW1").

Contract: docs/ARCHITECTURE.md section 3 (blob, sections, RLE1, world index), 1.3 (inputs/outputs),
2.3 (object strip rows), 6.2 (object anchors), 6.4 (limits).

Build (what `make` runs):
    mkrooms.py [--rooms rooms] [--gen build/gen] [--strict]
        rooms/world.json + the snapshots it lists + tools/tilemeta.json + gen/tile_library.json
        (or gen/tilelib_map.json) + gen/objects.json
        -> gen/rooms/<name>.bin, gen/rooms.inc, gen/rooms.json
Tools:
    mkrooms.py --dump   <blob.bin>                  decode a blob and print it
    mkrooms.py --render <blob.bin> [-o out.png]     draw the compiled room from the blob
    mkrooms.py --render-all [dir]                   render every gen/rooms/*.bin (default gen/rooms/png)
    mkrooms.py --stand-in                           write a stand-in gen/tile_library.json from the
                                                    contract table 2.1 (only if mkassets has not run)

Importable: compile_room(), decode_blob(), rle1_encode(), rle1_decode(), build_world(), Context.
Errors are RoomError with the room name and the offending cell/object.
"""
import argparse
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SNES = os.path.dirname(HERE)

ROOM_W, ROOM_H, CELLS = 40, 22, 880
MAX_ROOM_TILES, MAX_OBJECTS, MAX_ROOMS, MAX_TITLE = 255, 64, 64, 24
OBJ_GFX_ROWS = 28
RB_HEADER_SIZE = 0x40
RB_VERSION, RB_RULESET = 1, 0
BANK_ROOMS, ROOM_BANKS, BANK_SIZE = 0x0C, 4, 0x8000
FLIP_X, FLIP_Y, GID_MASK = 1 << 20, 1 << 21, 0x0FFFFF
ATTR_V, ATTR_H, ATTR_PRIO = 0x80, 0x40, 0x20
LAYERS = ("background", "terrain", "foreground")

TC = {"TC_EMPTY": 0x00, "TC_DAMAGE": 0x01, "TC_WATER": 0x02, "TC_ONEWAY": 0x03, "TC_ONEWAY_WATER": 0x04,
      "TC_SOLID": 0x80, "TC_ICE": 0x81, "TC_BOUNCE": 0x82, "TC_CRUMBLE": 0x83, "TC_CONV_L": 0x84,
      "TC_CONV_R": 0x85, "TC_SOLID_DAMAGE": 0x86}
TC_NAMES = {v: k for k, v in TC.items()}
GID_ONEWAY, GID_DAMAGE, GID_WATER = 670, 677, 682
SURFACE_KINDS = {"ice": TC["TC_ICE"], "bounce": TC["TC_BOUNCE"], "crumbling": TC["TC_CRUMBLE"],
                 "conveyorLeft": TC["TC_CONV_L"], "conveyorRight": TC["TC_CONV_R"]}
RULESET_KINDS = set(SURFACE_KINDS) | {"oneWayPlatform", "damage", "water"}

# contract table 2.1: (first gid, last gid, first library id, tileset)
LIB_RANGES = [(1, 72, 1, "forest"), (73, 144, 73, "desert"), (217, 321, 145, "lava"), (322, 387, 250, "snow"),
              (388, 459, 316, "water"), (492, 536, 388, "essentials"), (669, 732, 433, "special"),
              (2073, 2076, 497, "autotile-edge-cases-desert"), (2077, 2148, 501, "autotile-artist-extras")]

# OT_* (constants.inc) and anchor offsets / bodies (contract 6.2): id -> (type, ax, ay, hw, h)
OBJ = {
    "coin_gold": (1, 0, 6, 6, 12), "coin_silver": (2, 0, 6, 6, 12), "gem": (3, 0, 6, 6, 12),
    "heart": (4, 0, 6, 6, 12), "key": (5, 0, 6, 6, 12), "star": (6, 0, 6, 6, 12),
    "spikes": (7, 0, 8, 7, 10), "saw": (8, 0, 12, 12, 24), "fire": (9, 0, 7, 6, 14),
    "bounce_pad": (10, 0, 16, 8, 8), "ladder": (11, 0, 32, 8, 51), "checkpoint_flag": (12, 0, 16, 6, 28),
    "door_locked": (13, 2, 28, 16, 48),
    "slime_blue": (15, 0, 8, 6, 10), "slime_red": (16, 0, 8, 6, 10), "bat": (17, 0, 10, 12, 20),
    "crab": (18, 0, 8, 12, 10), "frog": (19, 0, 16, 12, 24),
}
OT_EXIT, OT_SPRINT_CP, OT_CRATE = 20, 21, 14
OT_NAMES = {v[0]: k for k, v in OBJ.items()}
OT_NAMES.update({OT_EXIT: "exit", OT_SPRINT_CP: "sprint_cp"})
OT_BODY = {v[0]: (v[3], v[4]) for v in OBJ.values()}
COLLECTIBLES, ENEMIES = range(1, 7), range(15, 20)
# strip rows per type when gen/objects.json is missing (contract 2.3); value = rows or ("alias", type)
DEFAULT_ROWS = {1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 4, 9: 2, 10: 2, 11: 2, 12: 4, 13: 4,
                15: 2, 16: 2, 17: 4, 18: 2, 19: 4, 20: 4, 21: ("alias", 12)}

GOAL_NONE, GOAL_REACH_EXIT, GOAL_COLLECT_TARGET, GOAL_DEFEAT_ALL, GOAL_CHECKPOINT_SPRINT = range(5)
GOAL_NAMES = ["none", "reach_exit", "collect_target", "defeat_all", "checkpoint_sprint"]
MAX_TIME_S = 1092

# research-art section 4: effective backdrop colour per background id
BACKDROPS = {"none": "#050505", "forest": "#08a6d5", "dark_forest": "#8fd24c", "jungle_vines": "#d2f7bb",
             "spooky_moon": "#1c5261", "spooky_mountain": "#1c5261", "grassland": "#65bae3",
             "mountains": "#76b9e3", "meadow": "#289abc", "aurora": "#043a66", "cave": "#203138",
             "desert": "#66beef"}


class RoomError(Exception):
    pass


# ------------------------------------------------------------------------------------------------
# RLE1
# ------------------------------------------------------------------------------------------------
def rle1_encode(data):
    """Greedy: runs of >= 3 equal bytes become runs (2..129), everything else literals (1..128)."""
    out = bytearray()
    lit = bytearray()
    i, n = 0, len(data)

    def flush():
        for k in range(0, len(lit), 128):
            chunk = lit[k:k + 128]
            out.append(len(chunk) - 1)
            out.extend(chunk)
        del lit[:]

    while i < n:
        j = i
        while j < n and data[j] == data[i] and j - i < 129:
            j += 1
        if j - i >= 3:
            flush()
            out.append(0x80 | (j - i - 2))
            out.append(data[i])
            i = j
        else:
            lit.append(data[i])
            i += 1
    flush()
    return bytes(out)


def rle1_decode(blob, ofs, count=CELLS):
    """Returns (bytes, end offset).  Raises RoomError on overrun / truncated input."""
    out = bytearray()
    while len(out) < count:
        if ofs >= len(blob):
            raise RoomError("RLE1: input ends after %d of %d bytes" % (len(out), count))
        c = blob[ofs]
        ofs += 1
        if c < 0x80:
            n = c + 1
            if ofs + n > len(blob):
                raise RoomError("RLE1: literal runs past the end of the blob")
            out.extend(blob[ofs:ofs + n])
            ofs += n
        else:
            n = (c & 0x7F) + 2
            if ofs >= len(blob):
                raise RoomError("RLE1: run without a value byte")
            out.extend(blob[ofs:ofs + 1] * n)
            ofs += 1
        if len(out) > count:
            raise RoomError("RLE1: run overruns %d bytes" % count)
    return bytes(out), ofs


# ------------------------------------------------------------------------------------------------
# Context: tile library, collision metadata, object strip rows
# ------------------------------------------------------------------------------------------------
def stand_in_library():
    """tile_library.json stand-in built from the contract table (no art knowledge: nothing is blank)."""
    tiles = {}
    for first, last, first_id, tileset in LIB_RANGES:
        for gid in range(first, last + 1):
            tiles[str(gid)] = {"id": first_id + gid - first, "palette": 2, "blank": False, "tileset": tileset}
    return {"version": 1, "count": 573, "stand_in": True, "tiles": tiles}


class Context:
    """Everything the compiler needs besides the snapshot."""

    def __init__(self, gen_dir=None, tilemeta_path=None, strict=False, quiet=False):
        self.gen = gen_dir or os.path.join(SNES, "build", "gen")
        self.strict = strict
        self.quiet = quiet
        self.warnings = []
        with open(tilemeta_path or os.path.join(HERE, "tilemeta.json")) as f:
            self.meta = {int(k): v for k, v in json.load(f).items()}
        lib_path = os.path.join(self.gen, "tile_library.json")
        map_path = os.path.join(self.gen, "tilelib_map.json")
        self.lib_source = lib_path
        if os.path.exists(lib_path):
            with open(lib_path) as f:
                lib = json.load(f)
        elif os.path.exists(map_path):
            with open(map_path) as f:
                lib = {"version": 1, "tiles": {g: {"id": i, "blank": False} for g, i in json.load(f).items()}}
            self.lib_source = map_path
        else:
            lib = stand_in_library()
            self.lib_source = "(built-in stand-in of contract table 2.1)"
        self.lib_version = int(lib.get("version", 1))
        self.lib_count = int(lib.get("count", 573))
        self.gid_to_id = {int(g): int(t["id"]) for g, t in lib["tiles"].items()}
        self.blank_gids = {int(g) for g, t in lib["tiles"].items() if t.get("blank")}
        self.id_to_gid = {i: g for g, i in self.gid_to_id.items()}
        missing = [g for g in self.gid_to_id if g not in self.meta]
        if missing:
            raise RoomError("tools/tilemeta.json has no entry for library gids %s..." % missing[:5])
        self.rows = dict(DEFAULT_ROWS)
        self.pieces = {}
        obj_path = os.path.join(self.gen, "objects.json")
        if os.path.exists(obj_path):
            with open(obj_path) as f:
                types = json.load(f)["types"]
            by_name = {name: t for name, t in types.items()}
            for name, t in types.items():
                ot = int(t["id"])
                if t.get("alias"):
                    self.rows[ot] = ("alias", int(by_name[t["alias"]]["id"]))
                else:
                    self.rows[ot] = int(t["rows"])
                self.pieces[ot] = t.get("pieces") or []

    def warn(self, room, msg):
        text = "%s: %s" % (room, msg)
        if self.strict:
            raise RoomError(text + " (--strict)")
        self.warnings.append(text)
        if not self.quiet:
            print("mkrooms: warning: " + text, file=sys.stderr)


# ------------------------------------------------------------------------------------------------
# Compile one snapshot
# ------------------------------------------------------------------------------------------------
def decode_tile(value):
    """RR section 3: (gid, flipX, flipY); gid 0 = empty."""
    if not isinstance(value, int) or isinstance(value, bool):
        raise RoomError("tile value %r is not an integer" % (value,))
    if value <= 0:
        return 0, False, False
    gid = value & GID_MASK
    if 669 <= gid <= 732:
        return gid, False, False          # special tiles never flip
    return gid, bool(value & FLIP_X), bool(value & FLIP_Y)


def bgr555(colour):
    r, g, b = int(colour[1:3], 16) >> 3, int(colour[3:5], 16) >> 3, int(colour[5:7], 16) >> 3
    return r | (g << 5) | (b << 10)


def backdrop_colour(ctx, name, background):
    if isinstance(background, str) and background.startswith("solid:#") and len(background) == 13:
        try:
            return bgr555(background[6:])
        except ValueError:
            pass
    if background in BACKDROPS:
        return bgr555(BACKDROPS[background])
    ctx.warn(name, "unknown background %r, using the default backdrop" % (background,))
    return bgr555(BACKDROPS["none"])


def resolve_spawn(snap, solid_at):
    sp = snap.get("spawnPoint")
    if sp is not None:
        return int(round(sp["x"])), int(round(sp["y"]))
    cols = [20]
    for off in range(1, ROOM_W):
        if 20 - off >= 0:
            cols.append(20 - off)
        if 20 + off < ROOM_W:
            cols.append(20 + off)
    need = max(2, math.ceil(26 / 16) + 1)
    for tx in cols:
        for ty in range(ROOM_H - 1, -1, -1):
            if not solid_at(tx, ty):
                continue
            if all(not solid_at(tx, ty - k) for k in range(1, need + 1) if ty - k >= 0):
                return tx * 16 + 8, ty * 16
    return 320, 2 * 16 + 7


def strip_rows(ctx, types):
    """Rows of OBJ char strips the room needs (contract 2.3 allocation: distinct strips only)."""
    owners = set()
    for t in types:
        r = ctx.rows.get(t, 0)
        if isinstance(r, tuple):
            owners.add(r[1])
        elif r:
            owners.add(t)
    total = 0
    for t in owners:
        r = ctx.rows.get(t, 0)
        total += r if isinstance(r, int) else 0
    return total


def density_warnings(ctx, name, objs):
    """Contract 6.4: > 12 object sprites (16 px units) in any 256-px window of a 16-px row band."""
    bands = {}
    for (ot, x, y, _layer, _left, _param) in objs:
        for piece in ctx.pieces.get(ot, []):
            dx, dy, _char, flags = piece[:4]
            size = 32 if flags & 1 else 16
            units = size // 16
            for band in range((y + dy) >> 4, ((y + dy + size - 1) >> 4) + 1):
                bands.setdefault(band, []).append((x + dx, units))
    for band, items in sorted(bands.items()):
        items.sort()
        for i, (x0, _u) in enumerate(items):
            total = sum(u for (x, u) in items[i:] if x < x0 + 256)
            if total > 12:
                ctx.warn(name, "sprite density: %d sprite units within 256 px in row band %d (x >= %d): "
                               "expect flicker" % (total, band, x0))
                break


def compile_room(snap, room_x, room_y, ctx, name="room"):
    """Returns (blob bytes, info dict).  Raises RoomError on any ruleset / limit violation."""
    if not isinstance(snap, dict) or "snapshot" in snap and "tileData" not in snap:
        snap = snap.get("snapshot", snap) if isinstance(snap, dict) else snap     # fixture envelope
    td = snap.get("tileData")
    if not isinstance(td, dict):
        raise RoomError("%s: no tileData" % name)
    grids = {}
    for layer in LAYERS:
        rows = td.get(layer)
        if not isinstance(rows, list) or len(rows) != ROOM_H or any(not isinstance(r, list) or len(r) != ROOM_W for r in rows):
            raise RoomError("%s: tileData.%s is not %d rows x %d columns" % (name, layer, ROOM_H, ROOM_W))
        grid = []
        for ty, row in enumerate(rows):
            for tx, value in enumerate(row):
                try:
                    gid, fx, fy = decode_tile(value)
                except RoomError as e:
                    raise RoomError("%s: %s (%s layer, cell %d,%d)" % (name, e, layer, tx, ty))
                if gid:
                    if gid not in ctx.gid_to_id:
                        raise RoomError("%s: gid %d on the %s layer at cell %d,%d is outside SNES ruleset v0 "
                                        "(not in the tile library)" % (name, gid, layer, tx, ty))
                    kind = ctx.meta[gid].get("kind")
                    if kind is not None and kind not in RULESET_KINDS:
                        raise RoomError("%s: special tile gid %d (%s) on the %s layer at cell %d,%d is outside "
                                        "SNES ruleset v0" % (name, gid, kind, layer, tx, ty))
                grid.append((gid, fx, fy))
        grids[layer] = grid

    smart = snap.get("smartTerrain") or {}
    bad = [k for k in (smart.get("semanticCells") or {}) if str(k).startswith("background:")]
    if bad:
        raise RoomError("%s: smart-terrain background cells (%s, ...) are not supported: the smart-background "
                        "one-way rule is outside SNES ruleset v0" % (name, bad[0]))

    # ---- visual planes + tile list -------------------------------------------------------------
    tile_ids = []
    slot_of = {}

    def slot(gid):
        if gid == 0 or gid in ctx.blank_gids:
            return 0
        lib = ctx.gid_to_id[gid]
        if lib not in slot_of:
            if len(tile_ids) >= MAX_ROOM_TILES:
                raise RoomError("%s: room uses more than %d distinct library tiles (slots 1..255)" % (name, MAX_ROOM_TILES))
            tile_ids.append(lib)
            slot_of[lib] = len(tile_ids)
        return slot_of[lib]

    def attr(fx, fy, prio):
        return (ATTR_H if fx else 0) | (ATTR_V if fy else 0) | (ATTR_PRIO if prio else 0)

    bg1_slot, bg1_attr, bg2_slot, bg2_attr = bytearray(CELLS), bytearray(CELLS), bytearray(CELLS), bytearray(CELLS)
    for i in range(CELLS):
        tg, tfx, tfy = grids["terrain"][i]
        fg, ffx, ffy = grids["foreground"][i]
        if fg:
            s = slot(fg)
            bg1_slot[i], bg1_attr[i] = s, (attr(ffx, ffy, True) if s else 0)
            if not s and tg:                 # blank foreground art: the terrain cell stays visible
                s = slot(tg)
                bg1_slot[i], bg1_attr[i] = s, (attr(tfx, tfy, False) if s else 0)
        elif tg:
            s = slot(tg)
            bg1_slot[i], bg1_attr[i] = s, (attr(tfx, tfy, False) if s else 0)
    for i in range(CELLS):
        bgid, bfx, bfy = grids["background"][i]
        if bgid:
            s = slot(bgid)
            bg2_slot[i], bg2_attr[i] = s, (attr(bfx, bfy, False) if s else 0)

    # ---- collision plane (contract 3.2 table) ---------------------------------------------------
    coll = bytearray(CELLS)
    for i in range(CELLS):
        tx, ty = i % ROOM_W, i // ROOM_W
        t = grids["terrain"][i][0]
        gids = [grids[layer][i][0] for layer in LAYERS]
        d = GID_DAMAGE in gids
        w = GID_WATER in gids
        kind = ctx.meta[t].get("kind") if t else None
        solid = bool(t) and ctx.meta[t]["solid"]
        if kind in SURFACE_KINDS:
            cls = SURFACE_KINDS[kind]
            if d or w:
                ctx.warn(name, "cell %d,%d: damage/water on another layer of a %s tile is dropped" % (tx, ty, kind))
        elif t == GID_ONEWAY:
            if d:
                ctx.warn(name, "cell %d,%d: damage over a one-way tile becomes plain damage" % (tx, ty))
                cls = TC["TC_DAMAGE"]
            else:
                cls = TC["TC_ONEWAY_WATER"] if w else TC["TC_ONEWAY"]
        elif solid:
            cls = TC["TC_SOLID_DAMAGE"] if d else TC["TC_SOLID"]
            if w and not d:
                pass                              # water behind solid ground has no effect
        else:
            cls = TC["TC_DAMAGE"] if d else TC["TC_WATER"] if w else TC["TC_EMPTY"]
        coll[i] = cls

    def solid_at(tx, ty):
        t = grids["terrain"][ty * ROOM_W + tx][0]
        return bool(t) and ctx.meta[t]["solid"]

    # ---- objects ---------------------------------------------------------------------------------
    objs = []          # (type, x, y, layer, left, param)
    dropped = []
    for n, po in enumerate(snap.get("placedObjects") or []):
        oid = po.get("id")
        if oid not in OBJ:
            dropped.append(oid)
            ctx.warn(name, "object %r (#%d) is outside SNES ruleset v0 and is dropped" % (oid, n))
            continue
        ot, ax, ay, _hw, _h = OBJ[oid]
        x, y = int(round(po["x"])) + ax, int(round(po["y"])) + ay
        layer = po.get("layer") or "terrain"
        if layer not in LAYERS:
            raise RoomError("%s: object %s #%d has unknown layer %r" % (name, oid, n, layer))
        facing = po.get("facing")
        if facing not in (None, "left", "right"):
            raise RoomError("%s: object %s #%d has unknown facing %r" % (name, oid, n, facing))
        left = (facing == "left") if facing else not (po["x"] <= 320)
        objs.append((ot, x, y, LAYERS.index(layer), left, 0, "%s #%d" % (oid, n)))

    # ---- goal --------------------------------------------------------------------------------------
    goal = snap.get("goal")
    goal_type, goal_param, time_ms = GOAL_NONE, 0, None

    def marker(point, what):
        if not isinstance(point, dict) or "x" not in point or "y" not in point:
            raise RoomError("%s: goal %s has no %s point" % (name, goal.get("type"), what))
        return int(round(point["x"])), int(round(point["y"]))

    n_collect = sum(1 for o in objs if o[0] in COLLECTIBLES)
    n_enemy = sum(1 for o in objs if o[0] in ENEMIES)
    if goal is not None:
        gt = goal.get("type") if isinstance(goal, dict) else None
        if gt == "reach_exit":
            goal_type = GOAL_REACH_EXIT
            ex = marker(goal.get("exit"), "exit")
            objs.append((OT_EXIT, ex[0], ex[1], 1, False, 0, "exit marker"))
            time_ms = goal.get("timeLimitMs")
        elif gt == "collect_target":
            goal_type = GOAL_COLLECT_TARGET
            goal_param = int(goal.get("requiredCount") or 0)
            if not 1 <= goal_param <= 255:
                raise RoomError("%s: collect_target requiredCount %r is out of range 1..255" % (name, goal.get("requiredCount")))
            if n_collect < goal_param:
                raise RoomError("%s: collect_target needs %d collectibles but only %d ruleset-v0 collectibles are "
                                "placed%s" % (name, goal_param, n_collect, " (after dropping %s)" % dropped if dropped else ""))
            time_ms = goal.get("timeLimitMs")
        elif gt == "defeat_all":
            goal_type = GOAL_DEFEAT_ALL
            goal_param = n_enemy
            if n_enemy == 0 and dropped:
                raise RoomError("%s: defeat_all depends on objects outside ruleset v0 (%s)" % (name, dropped))
            time_ms = goal.get("timeLimitMs")
        elif gt == "checkpoint_sprint":
            goal_type = GOAL_CHECKPOINT_SPRINT
            cps = goal.get("checkpoints") or []
            goal_param = len(cps)
            for k, p in enumerate(cps):
                px, py = marker(p, "checkpoint %d" % k)
                objs.append((OT_SPRINT_CP, px, py, 1, False, k, "sprint checkpoint %d" % k))
            fx, fy = marker(goal.get("finish"), "finish")
            objs.append((OT_EXIT, fx, fy, 1, False, 1, "sprint finish"))
            time_ms = goal.get("timeLimitMs")
        else:
            raise RoomError("%s: goal type %r is outside SNES ruleset v0 (supported: reach_exit, collect_target, "
                            "defeat_all, checkpoint_sprint)" % (name, gt))
    time_s = 0
    if time_ms:
        time_s = int(math.ceil(time_ms / 1000.0))
        if time_s > MAX_TIME_S:
            raise RoomError("%s: time limit %d s exceeds the maximum of %d s" % (name, time_s, MAX_TIME_S))

    if len(objs) > MAX_OBJECTS:
        raise RoomError("%s: %d objects (goal markers included), the limit is %d" % (name, len(objs), MAX_OBJECTS))
    for (ot, x, y, layer, left, param, label) in objs:
        if not 0 <= x <= 1023 or not -128 <= y <= 511:
            raise RoomError("%s: %s anchor (%d,%d) is outside x 0..1023 / y -128..511" % (name, label, x, y))
    rows = strip_rows(ctx, {o[0] for o in objs})
    if rows > OBJ_GFX_ROWS:
        raise RoomError("%s: object types need %d OBJ strip rows, the limit is %d (types: %s)" % (
            name, rows, OBJ_GFX_ROWS, ", ".join(sorted(OT_NAMES[o[0]] for o in {o[:1] for o in objs}))))
    density_warnings(ctx, name, [o[:6] for o in objs])

    # ---- header fields -----------------------------------------------------------------------------
    if not -128 <= room_x <= 127 or not -128 <= room_y <= 127:
        raise RoomError("%s: room coordinates %d,%d do not fit a signed byte" % (name, room_x, room_y))
    flags = (1 if snap.get("pitsAreDeadly") else 0) | (2 if snap.get("cameraMode") == "room" else 0)
    hearts = snap.get("playerHearts") or 1
    if hearts not in (1, 2, 3):
        raise RoomError("%s: playerHearts %r is not 1..3" % (name, hearts))
    spawn_x, spawn_y = resolve_spawn(snap, solid_at)
    if not 0 <= spawn_x < 640 or not 0 <= spawn_y <= 352:
        raise RoomError("%s: spawn point (%d,%d) is outside the room" % (name, spawn_x, spawn_y))
    title = snap.get("title") or "ROOM %d,%d" % (room_x, room_y)
    title = "".join(c if 0x20 <= ord(c) <= 0x7E else "?" for c in title)[:MAX_TITLE].ljust(MAX_TITLE)

    # ---- assemble ----------------------------------------------------------------------------------
    body = bytearray()
    ofs = {}

    def section(key, data, optional=False):
        if optional and not any(data):
            ofs[key] = 0
            return
        ofs[key] = RB_HEADER_SIZE + len(body)
        body.extend(data)

    section("tiles", b"".join(struct.pack("<H", t) for t in tile_ids))
    section("bg1_tile", rle1_encode(bg1_slot))
    section("bg1_attr", rle1_encode(bg1_attr) if any(bg1_attr) else b"", optional=True)
    if any(bg2_slot):
        section("bg2_tile", rle1_encode(bg2_slot))
        section("bg2_attr", rle1_encode(bg2_attr) if any(bg2_attr) else b"", optional=True)
    else:
        ofs["bg2_tile"] = ofs["bg2_attr"] = 0
    section("coll", rle1_encode(coll))
    rec = bytearray()
    for (ot, x, y, layer, left, param, _label) in objs:
        rec += struct.pack("<BHhB", ot, x | (layer << 13) | (0x8000 if left else 0), y, param)
    section("objs", bytes(rec))

    size = RB_HEADER_SIZE + len(body)
    if size > 0xFFFF:
        raise RoomError("%s: blob is %d bytes" % (name, size))
    head = struct.pack("<4sBBHbbBBHHHBBHBBBB7H24s",
                       b"WSR1", RB_VERSION, RB_RULESET, size, room_x, room_y, flags, hearts,
                       backdrop_colour(ctx, name, snap.get("background", "none")), spawn_x, spawn_y,
                       goal_type, goal_param, time_s, len(tile_ids), len(objs), ctx.lib_version, 0,
                       ofs["tiles"], ofs["bg1_tile"], ofs["bg1_attr"], ofs["bg2_tile"], ofs["bg2_attr"],
                       ofs["coll"], ofs["objs"], title.encode("ascii"))
    assert len(head) == RB_HEADER_SIZE
    blob = bytes(head) + bytes(body)
    info = {"size": size, "tiles": len(tile_ids), "objects": len(objs), "strip_rows": rows,
            "goal": GOAL_NAMES[goal_type], "checksum": sum(coll) & 0xFFFF, "title": title.rstrip(),
            "sections": {k: v for k, v in ofs.items()}}
    return blob, info


# ------------------------------------------------------------------------------------------------
# Decode
# ------------------------------------------------------------------------------------------------
def decode_blob(blob):
    """Blob -> dict (header fields, tile list, five 880-byte planes, objects).  Validates structure."""
    if len(blob) < RB_HEADER_SIZE:
        raise RoomError("blob shorter than the 64-byte header")
    (magic, version, ruleset, size, rx, ry, flags, hearts, backdrop, sx, sy, gtype, gparam, time_s, n, m,
     libver, reserved, o_tiles, o_b1t, o_b1a, o_b2t, o_b2a, o_coll, o_objs, title) = struct.unpack(
        "<4sBBHbbBBHHHBBHBBBB7H24s", blob[:RB_HEADER_SIZE])
    if magic != b"WSR1":
        raise RoomError("bad magic %r" % magic)
    if version != RB_VERSION or ruleset != RB_RULESET:
        raise RoomError("unsupported version %d / ruleset %d" % (version, ruleset))
    if size != len(blob):
        raise RoomError("header size %d != blob length %d" % (size, len(blob)))
    if flags & 0xFC or reserved:
        raise RoomError("reserved header bits are set")
    if gtype >= len(GOAL_NAMES):
        raise RoomError("unknown goal type %d" % gtype)
    if m > MAX_OBJECTS:
        raise RoomError("%d objects" % m)
    if o_tiles + 2 * n > size or o_objs + 6 * m > size:
        raise RoomError("section runs past the end of the blob")
    tiles = list(struct.unpack_from("<%dH" % n, blob, o_tiles)) if n else []
    if len(set(tiles)) != len(tiles):
        raise RoomError("tile list has duplicate library ids")
    zero = bytes(CELLS)

    def plane(o, required=False):
        if o == 0:
            if required:
                raise RoomError("required plane is missing")
            return zero
        if not RB_HEADER_SIZE <= o < size:
            raise RoomError("plane offset $%04X is outside the blob" % o)
        return rle1_decode(blob, o)[0]

    bg1_tile, bg1_attr = plane(o_b1t, True), plane(o_b1a)
    bg2_tile, bg2_attr = plane(o_b2t), plane(o_b2a) if o_b2t else zero
    coll = plane(o_coll, True)
    for nm, p in (("BG1", bg1_tile), ("BG2", bg2_tile)):
        if p and max(p) > n:
            raise RoomError("%s slot plane uses slot %d but the room has %d tiles" % (nm, max(p), n))
    for nm, p in (("BG1", bg1_attr), ("BG2", bg2_attr)):
        if any(b & 0x1F for b in p):
            raise RoomError("%s attr plane has reserved bits set" % nm)
    if any(b not in TC_NAMES for b in coll):
        raise RoomError("collision plane has unknown classes %s" % sorted({b for b in coll if b not in TC_NAMES}))
    objects = []
    for i in range(m):
        ot, xw, y, param = struct.unpack_from("<BHhB", blob, o_objs + 6 * i)
        if ot not in OT_NAMES:
            raise RoomError("object %d has unknown type %d" % (i, ot))
        if xw & 0x1C00:
            raise RoomError("object %d has reserved x bits set" % i)
        objects.append({"type": ot, "name": OT_NAMES[ot], "x": xw & 0x3FF, "y": y,
                        "layer": LAYERS[(xw >> 13) & 3] if (xw >> 13) & 3 < 3 else "?",
                        "left": bool(xw & 0x8000), "param": param})
    return {"version": version, "ruleset": ruleset, "size": size, "x": rx, "y": ry, "flags": flags,
            "pits_deadly": bool(flags & 1), "camera_room": bool(flags & 2), "hearts": hearts,
            "backdrop": backdrop, "spawn": (sx, sy), "goal_type": gtype, "goal": GOAL_NAMES[gtype],
            "goal_param": gparam, "time_s": time_s, "lib_version": libver, "tiles": tiles,
            "title": title.decode("ascii"), "bg1_tile": bg1_tile, "bg1_attr": bg1_attr,
            "bg2_tile": bg2_tile, "bg2_attr": bg2_attr, "coll": coll, "objects": objects,
            "offsets": {"tiles": o_tiles, "bg1_tile": o_b1t, "bg1_attr": o_b1a, "bg2_tile": o_b2t,
                        "bg2_attr": o_b2a, "coll": o_coll, "objs": o_objs},
            "checksum": sum(coll) & 0xFFFF}


COLL_CHARS = {0x00: ".", 0x01: "x", 0x02: "~", 0x03: "=", 0x04: "w", 0x80: "#", 0x81: "I", 0x82: "B",
              0x83: "C", 0x84: "<", 0x85: ">", 0x86: "X"}


def dump_blob(blob, out=sys.stdout):
    d = decode_blob(blob)
    w = out.write
    w("WSR1 v%d ruleset %d  size %d bytes  library version %d\n" % (d["version"], d["ruleset"], d["size"], d["lib_version"]))
    w("title    '%s'\n" % d["title"].rstrip())
    w("room     (%d,%d)  flags $%02X%s%s  hearts %d  backdrop $%04X\n" % (
        d["x"], d["y"], d["flags"], " pitsAreDeadly" if d["pits_deadly"] else "",
        " cameraRoom" if d["camera_room"] else "", d["hearts"], d["backdrop"]))
    w("spawn    (%d,%d)\n" % d["spawn"])
    w("goal     %s  param %d  time limit %d s\n" % (d["goal"], d["goal_param"], d["time_s"]))
    w("offsets  " + "  ".join("%s=$%04X" % kv for kv in d["offsets"].items()) + "\n")
    w("tiles    N=%d: %s\n" % (len(d["tiles"]), " ".join(str(t) for t in d["tiles"])))
    for key in ("bg1_tile", "bg1_attr", "bg2_tile", "bg2_attr"):
        p = d[key]
        if not any(p):
            w("%s: empty\n" % key)
            continue
        w("%s:\n" % key)
        for r in range(ROOM_H):
            w("  " + "".join("%02X" % b if b else ".." for b in p[r * ROOM_W:(r + 1) * ROOM_W]) + "\n")
    w("collision (checksum %d):  . empty  # solid  = one-way  w one-way+water  x damage  X solid+damage  ~ water  "
      "I ice  B bounce  C crumble  < > conveyor\n" % d["checksum"])
    for r in range(ROOM_H):
        w("  " + "".join(COLL_CHARS[b] for b in d["coll"][r * ROOM_W:(r + 1) * ROOM_W]) + "\n")
    w("objects  M=%d\n" % len(d["objects"]))
    for i, o in enumerate(d["objects"]):
        w("  %2d  %-16s x=%4d y=%4d  %-10s %s param=%d\n" % (
            i, o["name"], o["x"], o["y"], o["layer"], "left " if o["left"] else "right", o["param"]))
    return d


# ------------------------------------------------------------------------------------------------
# Render (PNG from the blob; real tile art when build/gen has the tile library)
# ------------------------------------------------------------------------------------------------
COLL_COLOURS = {0x01: (255, 40, 40), 0x02: (40, 120, 255), 0x03: (255, 255, 60), 0x04: (60, 255, 200),
                0x80: (255, 255, 255), 0x81: (120, 230, 255), 0x82: (255, 120, 255), 0x83: (255, 160, 40),
                0x84: (160, 255, 60), 0x85: (60, 255, 120), 0x86: (255, 0, 160)}
OBJ_COLOURS = {"collect": (255, 220, 0), "hazard": (255, 60, 60), "enemy": (255, 0, 255),
               "marker": (0, 255, 120), "other": (120, 200, 255)}
OBJ_ABBR = {1: "Cg", 2: "Cs", 3: "Gm", 4: "Hrt", 5: "Key", 6: "Str", 7: "Spk", 8: "Saw", 9: "Fir", 10: "Pad",
            11: "Lad", 12: "Chk", 13: "Door", 15: "SlB", 16: "SlR", 17: "Bat", 18: "Crab", 19: "Frog",
            20: "EXIT", 21: "CP"}


def _load_tile_art(gen):
    try:
        with open(os.path.join(gen, "tilelib.bin"), "rb") as f:
            lib = f.read()
        with open(os.path.join(gen, "tilelibpal.bin"), "rb") as f:
            libpal = f.read()
        with open(os.path.join(gen, "bgpal.bin"), "rb") as f:
            pal = f.read()
    except OSError:
        return None
    colours = []
    for i in range(0, len(pal), 2):
        v = pal[i] | (pal[i + 1] << 8)
        colours.append(((v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3))
    return lib, libpal, colours


def _tile_image(art, lib_id, cache):
    from PIL import Image
    if lib_id in cache:
        return cache[lib_id]
    lib, libpal, colours = art
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    base = lib_id * 128
    if base + 128 <= len(lib) and lib_id < len(libpal):
        p = libpal[lib_id]
        px = img.load()
        for q in range(4):
            ch = lib[base + q * 32: base + q * 32 + 32]
            ox, oy = (q & 1) * 8, (q >> 1) * 8
            for y in range(8):
                b0, b1, b2, b3 = ch[y * 2], ch[y * 2 + 1], ch[16 + y * 2], ch[16 + y * 2 + 1]
                for x in range(8):
                    bit = 7 - x
                    c = ((b0 >> bit) & 1) | (((b1 >> bit) & 1) << 1) | (((b2 >> bit) & 1) << 2) | (((b3 >> bit) & 1) << 3)
                    if c and p >= 2:
                        idx = (p - 2) * 16 + c
                        if idx < len(colours):
                            px[ox + x, oy + y] = colours[idx] + (255,)
    cache[lib_id] = img
    return img


def render_blob(blob, out_path, gen=None, scale=2, overlay=True):
    from PIL import Image, ImageDraw
    d = decode_blob(blob)
    art = _load_tile_art(gen or os.path.join(SNES, "build", "gen"))
    bd = d["backdrop"]
    backdrop = ((bd & 31) << 3, ((bd >> 5) & 31) << 3, ((bd >> 10) & 31) << 3, 255)
    img = Image.new("RGBA", (640, 352), backdrop)
    cache = {}

    def draw_layer(slots, attrs, want_prio):
        for i in range(CELLS):
            s = slots[i]
            if not s or bool(attrs[i] & ATTR_PRIO) != want_prio:
                continue
            x, y = (i % ROOM_W) * 16, (i // ROOM_W) * 16
            lib_id = d["tiles"][s - 1]
            if art:
                t = _tile_image(art, lib_id, cache)
                if attrs[i] & ATTR_H:
                    t = t.transpose(Image.FLIP_LEFT_RIGHT)
                if attrs[i] & ATTR_V:
                    t = t.transpose(Image.FLIP_TOP_BOTTOM)
                img.paste(t, (x, y), t)
            else:
                h = (lib_id * 2654435761) & 0xFFFFFF
                ImageDraw.Draw(img).rectangle([x, y, x + 15, y + 15],
                                              fill=(64 + (h & 127), 64 + ((h >> 8) & 127), 64 + ((h >> 16) & 127), 255))

    draw_layer(d["bg2_tile"], d["bg2_attr"], False)
    draw_layer(d["bg1_tile"], d["bg1_attr"], False)
    draw_layer(d["bg1_tile"], d["bg1_attr"], True)
    img = img.resize((640 * scale, 352 * scale), Image.NEAREST)
    if overlay:
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        dr = ImageDraw.Draw(ov)
        for i in range(CELLS):
            c = d["coll"][i]
            if c == 0:
                continue
            x, y = (i % ROOM_W) * 16 * scale, (i // ROOM_W) * 16 * scale
            col = COLL_COLOURS[c]
            if c == 0x80:
                dr.rectangle([x, y, x + 16 * scale - 1, y + 16 * scale - 1], outline=col + (70,))
            else:
                dr.rectangle([x, y, x + 16 * scale - 1, y + 16 * scale - 1], fill=col + (90,), outline=col + (230,))
                dr.text((x + 3, y + 2), COLL_CHARS[c], fill=(0, 0, 0, 255))
        for o in d["objects"]:
            t = o["type"]
            kind = ("collect" if t in COLLECTIBLES else "hazard" if t in (7, 8, 9) else "enemy" if t in ENEMIES
                    else "marker" if t in (OT_EXIT, OT_SPRINT_CP) else "other")
            hw, h = OT_BODY.get(t, (8, 28))
            col = OBJ_COLOURS[kind]
            x0, y0, x1, y1 = (o["x"] - hw) * scale, (o["y"] - h) * scale, (o["x"] + hw) * scale - 1, o["y"] * scale - 1
            dr.rectangle([x0, y0, x1, y1], fill=col + (110,), outline=col + (255,))
            label = OBJ_ABBR.get(t, "?") + (str(o["param"]) if t == OT_SPRINT_CP or (t == OT_EXIT and o["param"]) else "")
            dr.text((x0 + 1, y0 - 11), label, fill=(255, 255, 255, 255), stroke_width=1, stroke_fill=(0, 0, 0, 255))
        sx, sy = d["spawn"]
        dr.rectangle([(sx - 5) * scale, (sy - 26) * scale, (sx + 5) * scale - 1, sy * scale - 1], outline=(255, 255, 255, 255), width=2)
        dr.text(((sx - 5) * scale, (sy - 26) * scale - 11), "SPAWN", fill=(255, 255, 255, 255), stroke_width=1, stroke_fill=(0, 0, 0, 255))
        dr.text((4, 2), "%s (%d,%d)  goal %s/%d  t=%ds  N=%d M=%d  %d B%s" % (
            d["title"].rstrip(), d["x"], d["y"], d["goal"], d["goal_param"], d["time_s"], len(d["tiles"]),
            len(d["objects"]), d["size"], "  pitsDeadly" if d["pits_deadly"] else ""),
            fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
        img = Image.alpha_composite(img, ov)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    img.convert("RGB").save(out_path)
    return d


# ------------------------------------------------------------------------------------------------
# World build
# ------------------------------------------------------------------------------------------------
def load_manifest(rooms_dir):
    path = os.path.join(rooms_dir, "world.json")
    with open(path) as f:
        man = json.load(f)
    rooms = man.get("rooms")
    if not isinstance(rooms, list) or not 1 <= len(rooms) <= MAX_ROOMS:
        raise RoomError("world.json: 'rooms' must list 1..%d rooms" % MAX_ROOMS)
    seen_xy, seen_file = {}, set()
    for r in rooms:
        for key in ("file", "x", "y"):
            if key not in r:
                raise RoomError("world.json: room entry %r has no %r" % (r, key))
        xy = (r["x"], r["y"])
        if xy in seen_xy:
            raise RoomError("world.json: %s and %s share coordinates %s" % (seen_xy[xy], r["file"], xy))
        if r["file"] in seen_file:
            raise RoomError("world.json: %s is listed twice" % r["file"])
        seen_xy[xy] = r["file"]
        seen_file.add(r["file"])
    files = [r["file"] for r in rooms]
    if man.get("start") not in files:
        raise RoomError("world.json: start room %r is not in the room list" % man.get("start"))
    return man, files.index(man["start"])


def room_name(file):
    return os.path.splitext(os.path.basename(file))[0]


def build_world(rooms_dir, ctx):
    """Compiles every room of the manifest.  Returns (entries, start index); entries carry blob + info."""
    man, start = load_manifest(rooms_dir)
    entries = []
    bank, used = 0, 0
    for index, r in enumerate(man["rooms"]):
        name = room_name(r["file"])
        with open(os.path.join(rooms_dir, r["file"])) as f:
            snap = json.load(f)
        blob, info = compile_room(snap, r["x"], r["y"], ctx, name)
        if used + len(blob) > BANK_SIZE:
            bank, used = bank + 1, 0
        if bank >= ROOM_BANKS:
            raise RoomError("room blobs do not fit the %d room banks" % ROOM_BANKS)
        entries.append(dict(info, index=index, name=name, file=r["file"], x=r["x"], y=r["y"], blob=blob,
                            bank=BANK_ROOMS + bank, addr=0x8000 + used))
        used += len(blob)
    return entries, start


def world_index_bytes(entries, start):
    out = bytearray(b"WSW1" + bytes([len(entries), start, 0, 0]))
    for e in entries:
        out += struct.pack("<bbHBB", e["x"], e["y"], e["addr"], e["bank"], 0)
    return bytes(out)


def bin_name(index, name):
    return "%02d_%s.bin" % (index, name.replace(",", "_").replace("-", "m"))


def write_outputs(entries, start, gen):
    out_dir = os.path.join(gen, "rooms")
    os.makedirs(out_dir, exist_ok=True)
    wanted = set()
    for e in entries:
        e["bin"] = "rooms/" + bin_name(e["index"], e["name"])
        wanted.add(os.path.basename(e["bin"]))
        _write_if_changed(os.path.join(gen, e["bin"]), e["blob"])
    for stale in os.listdir(out_dir):
        if stale.endswith(".bin") and stale not in wanted:
            os.remove(os.path.join(out_dir, stale))
    _write_if_changed(os.path.join(gen, "worldindex.bin"), world_index_bytes(entries, start))

    inc = ["; GENERATED by tools/mkrooms.py -- do not edit.",
           "; Room blobs v1 (\"WSR1\") and the world index (\"WSW1\"), ARCHITECTURE.md section 3.",
           "ROOM_COUNT      = %d" % len(entries),
           "ROOM_START      = %d" % start, ""]
    by_bank = {}
    for e in entries:
        by_bank.setdefault(e["bank"] - BANK_ROOMS, []).append(e)
    for k in sorted(by_bank):
        inc.append('.segment "ROOMS%d"' % k)
        for e in by_bank[k]:
            inc.append("Room_%d:                         ; %s  (%d,%d)  '%s'  %d bytes" % (
                e["index"], e["file"], e["x"], e["y"], e["title"], e["size"]))
            inc.append('    .incbin "gen/%s"' % e["bin"])
        inc.append("")
    inc += ['.segment "DATA1"', "WorldIndex:",
            '    .byte "WSW1"', "    .byte ROOM_COUNT, ROOM_START, 0, 0"]
    for e in entries:
        inc.append("    .byte <(%d), <(%d)" % (e["x"], e["y"]))
        inc.append("    .word .loword(Room_%d)" % e["index"])
        inc.append("    .byte ^Room_%d, 0" % e["index"])
    for e in entries:
        inc.append(".assert .loword(Room_%d) = $%04X && ^Room_%d = $%02X, error, \"room %d is not where mkrooms.py placed it\"" % (
            e["index"], e["addr"], e["index"], e["bank"], e["index"]))
    _write_if_changed(os.path.join(gen, "rooms.inc"), ("\n".join(inc) + "\n").encode())

    listing = [{"index": e["index"], "name": e["name"], "x": e["x"], "y": e["y"], "file": e["file"],
                "checksum": e["checksum"], "title": e["title"], "goal": e["goal"], "size": e["size"],
                "tiles": e["tiles"], "objects": e["objects"], "strip_rows": e["strip_rows"],
                "bin": e["bin"], "bank": e["bank"], "addr": e["addr"], "start": e["index"] == start}
               for e in entries]
    _write_if_changed(os.path.join(gen, "rooms.json"), (json.dumps(listing, indent=1) + "\n").encode())


def _write_if_changed(path, data):
    try:
        with open(path, "rb") as f:
            if f.read() == data:
                return
    except OSError:
        pass
    with open(path, "wb") as f:
        f.write(data)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--rooms", default=os.path.join(SNES, "rooms"), help="directory with world.json")
    ap.add_argument("--gen", default=os.path.join(SNES, "build", "gen"), help="generated-asset directory")
    ap.add_argument("--tilemeta", default=os.path.join(HERE, "tilemeta.json"))
    ap.add_argument("--strict", action="store_true", help="treat warnings (dropped objects, ...) as errors")
    ap.add_argument("--dump", metavar="BLOB", help="decode and print a blob")
    ap.add_argument("--render", metavar="BLOB", help="render a blob to PNG")
    ap.add_argument("--render-all", nargs="?", const="", metavar="DIR", help="render every compiled room")
    ap.add_argument("--no-overlay", action="store_true", help="render without collision/object overlay")
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("-o", "--output", help="output PNG for --render")
    ap.add_argument("--stand-in", action="store_true", help="write a stand-in gen/tile_library.json if missing")
    ap.add_argument("-q", "--quiet", action="store_true")
    args = ap.parse_args(argv)
    try:
        if args.dump:
            with open(args.dump, "rb") as f:
                dump_blob(f.read())
            return 0
        if args.render:
            out = args.output or os.path.splitext(args.render)[0] + ".png"
            with open(args.render, "rb") as f:
                render_blob(f.read(), out, args.gen, args.scale, not args.no_overlay)
            print(out)
            return 0
        if args.render_all is not None:
            src = os.path.join(args.gen, "rooms")
            dst = args.render_all or os.path.join(src, "png")
            for fn in sorted(os.listdir(src)):
                if fn.endswith(".bin"):
                    with open(os.path.join(src, fn), "rb") as f:
                        render_blob(f.read(), os.path.join(dst, fn[:-4] + ".png"), args.gen, args.scale, not args.no_overlay)
            print(dst)
            return 0
        if args.stand_in:
            path = os.path.join(args.gen, "tile_library.json")
            if os.path.exists(path):
                print("mkrooms: %s exists, not overwritten" % path)
            else:
                os.makedirs(args.gen, exist_ok=True)
                with open(path, "w") as f:
                    json.dump(stand_in_library(), f)
                print("mkrooms: wrote stand-in " + path)
            return 0
        ctx = Context(args.gen, args.tilemeta, args.strict, args.quiet)
        entries, start = build_world(args.rooms, ctx)
        write_outputs(entries, start, args.gen)
        if not args.quiet:
            for e in entries:
                print("mkrooms: %2d %-16s (%4d,%3d) %-18s %5d B  tiles %3d  objs %2d  strip rows %2d  %s" % (
                    e["index"], e["name"], e["x"], e["y"], e["title"][:18], e["size"], e["tiles"], e["objects"],
                    e["strip_rows"], e["goal"]))
            print("mkrooms: %d rooms, %d bytes of blobs, library %s" % (
                len(entries), sum(e["size"] for e in entries), os.path.relpath(ctx.lib_source, SNES)
                if os.path.exists(ctx.lib_source) else ctx.lib_source))
        return 0
    except RoomError as e:
        print("mkrooms: error: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
