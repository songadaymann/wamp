#!/usr/bin/env python3
"""Turn the layout of a golden trace into a WAMP RoomSnapshot JSON that tools/mkrooms.py compiles.

    layout_to_room.py <trace.json> [-o room.json] [--x 120 --y 0]
    layout_to_room.py --check            compile every trace layout in this folder with mkrooms and
                                         assert collision map == mask and spawn == spawn_feet

'#' -> terrain gid 29 (forest, TC_SOLID), '=' -> gid 670 (one-way, TC_ONEWAY), '.' -> empty; the
spawnPoint is the trace's spawn_feet (bottom-centre of the body). The room has no objects, no goal,
no deadly pits and one heart. It is the same snapshot the generator feeds the web game (gen/
snesGolden.gen.test.ts buildRoom), so a ROM test can load it and replay `inputs`.

Importable: room_from_trace(trace, x=120, y=0) -> dict.
"""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GID = {".": -1, "#": 29, "=": 670}


def room_from_trace(trace, x=120, y=0):
    rows = trace["layout"]["rows"]
    assert len(rows) == 22 and all(len(r) == 40 for r in rows)
    empty = [[-1] * 40 for _ in range(22)]
    spawn = trace["layout"]["spawn_feet"]
    return {
        "id": "%d,%d" % (x, y), "coordinates": {"x": x, "y": y},
        "title": ("G " + trace["scenario"])[:24], "goalIntroText": None, "cameraMode": "follow",
        "pitsAreDeadly": False, "playerHearts": 1, "background": "none",
        "lighting": {"mode": "off", "darkness": 80, "radius": 50},
        "weather": {"mode": "off", "intensity": 50}, "music": None, "goal": None,
        "spawnPoint": {"x": spawn["x"], "y": spawn["y"]},
        "tileData": {"background": [r[:] for r in empty],
                     "terrain": [[GID[c] for c in row] for row in rows],
                     "foreground": [r[:] for r in empty]},
        "placedObjects": [], "customSprites": [], "customTiles": [],
        "version": 1, "status": "draft",
    }


def check():
    sys.path.insert(0, os.path.join(HERE, "..", "..", "tools"))
    import mkrooms
    ctx = mkrooms.Context(quiet=True)
    chars = {0x00: ".", 0x80: "#", 0x03: "="}
    bad = 0
    names = sorted(p for p in glob.glob(os.path.join(HERE, "*.json")) if not os.path.basename(p).startswith("_"))
    for path in names:
        with open(path) as f:
            trace = json.load(f)
        name = trace["scenario"]
        try:
            out = mkrooms.compile_room(room_from_trace(trace), 120, 0, ctx, name)
            blob = out if isinstance(out, (bytes, bytearray)) else out[0]
            dec = mkrooms.decode_blob(bytes(blob))
        except Exception as exc:                                    # noqa: BLE001
            print("FAIL %s: %s" % (name, exc))
            bad += 1
            continue
        got = ["".join(chars.get(c, "?") for c in dec["coll"][r * 40:(r + 1) * 40]) for r in range(22)]
        sp = trace["layout"]["spawn_feet"]
        if got != trace["layout"]["rows"]:
            print("FAIL %s: compiled collision map differs from the mask" % name)
            bad += 1
        elif tuple(dec["spawn"]) != (sp["x"], sp["y"]):
            print("FAIL %s: spawn %r != %r" % (name, dec["spawn"], sp))
            bad += 1
    print("%d layouts compiled with mkrooms, %d problem(s), %d warning(s)" % (len(names), bad, len(ctx.warnings)))
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trace", nargs="?")
    ap.add_argument("-o", "--out")
    ap.add_argument("--x", type=int, default=120)
    ap.add_argument("--y", type=int, default=0)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        return check()
    if not args.trace:
        ap.error("trace file required")
    with open(args.trace) as f:
        room = room_from_trace(json.load(f), args.x, args.y)
    text = json.dumps(room, separators=(",", ":")) + "\n"
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
