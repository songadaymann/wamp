#!/usr/bin/env python3
"""Numeric reachability check for compiled SNESWAMP rooms (used by tests/test_rooms.py).

Works on DECODED BLOBS (mkrooms.decode_blob), i.e. on exactly what the ROM will load, and moves a
player body through them with the integer 8.8 physics of docs/ARCHITECTURE.md section 5:

    per frame: vy += $32 (clamp $0855); x += vx; collide X; y += vy; collide Y (one-way rule);
    run $0280, jump -$04AB with the 0.85 release cut, bounce -$0689, body 10 x 14 airborne
    (10 x 26 needed to stand up / jump), one-way tolerances 6 / 12, edge walls 12 px inside
    edges without a neighbour, hatch jumps into the upper neighbour's row 21.

It is a conservative model: no wall jump, no corner correction, no gap assist, no damage boosting
(any hazard contact ends a trajectory), no enemy interaction.  Whatever it finds reachable is
reachable with plain run + jump + ladders + bounce + swimming; a room that passes is beatable.

    roomsim.py [--gen build/gen]        report for every world room (x < 100)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkrooms  # noqa: E402

W, H = 40, 22
G, VMAX, RUN, JUMP, BOUNCE, KICK = 0x32, 0x855, 0x280, 0x4AB, 0x689, 0x2CD
CUT = 0xDA
HW, H_AIR, H_STAND = 5, 14, 26
ONEWAY_PREV_TOL, ONEWAY_CUR_TOL = 6, 12
LADDER_TOP_INSET, LADDER_TOP_TOL, LADDER_TOP_HW = 2, 10, 9
T_DROP = 14
TC_DAMAGE, TC_WATER, TC_ONEWAY, TC_ONEWAY_WATER, TC_BOUNCE, TC_SOLID_DAMAGE = 1, 2, 3, 4, 0x82, 0x86
OT_LADDER, OT_PAD, OT_DOOR, OT_KEY, OT_EXIT, OT_CP = 11, 10, 13, 5, 20, 21
HAZARDS = (7, 8, 9)
GRID = 8                       # standing spots are keyed on x // GRID

# jump programs: (dir before the switch, switch frame, dir after, jump held frames)
PROGRAMS = []
for d in (-1, 0, 1):
    PROGRAMS.append((d, 999, d, 999))
    PROGRAMS.append((d, 999, d, 1))
for d in (-1, 1):
    for k in (10, 22):
        PROGRAMS.append((0, k, d, 999))
        PROGRAMS.append((d, k, 0, 999))
        PROGRAMS.append((d, k, -d, 999))


class Room:
    def __init__(self, d, nbr=None):
        """d = decode_blob() dict; nbr = {'L': dict|None, 'R': ..., 'U': ..., 'D': ...} decoded neighbours."""
        self.d = d
        self.coll = d["coll"]
        self.nbr = nbr or {}
        self.deadly = d["pits_deadly"]
        self.objs = d["objects"]
        self.ladders, self.pads, self.hazards, self.doors = [], [], [], []
        for i, o in enumerate(self.objs):
            hw, h = mkrooms.OT_BODY.get(o["type"], (0, 0))
            rect = (o["x"] - hw, o["y"] - h, o["x"] + hw, o["y"])
            if o["type"] == OT_LADDER:
                self.ladders.append((o["x"], o["y"] - h, o["y"]))
            elif o["type"] == OT_PAD:
                self.pads.append(rect)
            elif o["type"] in HAZARDS:
                self.hazards.append(rect)
            elif o["type"] == OT_DOOR:
                self.doors.append(rect)
        self.doors_open = False
        self.door_cells = set()
        for (x0, y0, x1, y1) in self.doors:
            for cy in range(H):
                for cx in range(W):
                    if x0 <= cx * 16 + 8 < x1 and y0 <= cy * 16 + 8 < y1:
                        self.door_cells.add((cx, cy))
        up, dn = self.nbr.get("U"), self.nbr.get("D")
        self.hatch_up = [c for c in range(W) if up and up["coll"][21 * W + c] in (TC_ONEWAY, TC_ONEWAY_WATER)
                         and not self.coll[c] & 0x80]
        self.hatch_down = [c for c in range(W) if dn and self.coll[21 * W + c] in (TC_ONEWAY, TC_ONEWAY_WATER)
                           and not dn["coll"][c] & 0x80]
        self.memo = {}

    # ---- cells -----------------------------------------------------------------------------------
    def cls(self, cx, cy):
        if 0 <= cx < W and 0 <= cy < H:
            if not self.doors_open and (cx, cy) in self.door_cells:
                return 0x80
            return self.coll[cy * W + cx]
        if cy < 0:
            if 0 <= cx < W and self.nbr.get("U"):
                # inside a hatch the shaft is open; everything else above the room is the neighbour's floor
                return 0 if cx in self.hatch_up and cy < -1 else (self.nbr["U"]["coll"][21 * W + cx] if cy == -1 else 0x80)
            return 0
        if cy >= H:
            if 0 <= cx < W and self.nbr.get("D") and cy == H:
                return self.nbr["D"]["coll"][cx]
            return 0
        side = self.nbr.get("L") if cx < 0 else self.nbr.get("R")
        if side and cx in (-1, W):
            return side["coll"][cy * W + (W - 1 if cx < 0 else 0)]
        return 0

    def solid(self, cx, cy):
        return self.cls(cx, cy) & 0x80

    def box_free(self, x, y, h):
        for cy in range((y - h) >> 4, ((y - 1) >> 4) + 1):
            for cx in range((x - HW) >> 4, ((x + HW - 1) >> 4) + 1):
                if self.solid(cx, cy):
                    return False
        return True

    def ladder_top(self, x, y, prev_ok=True):
        for (lx, top, _bot) in self.ladders:
            t = top + LADDER_TOP_INSET
            if x + HW > lx - LADDER_TOP_HW and x - HW < lx + LADDER_TOP_HW and t <= y <= t + LADDER_TOP_TOL:
                return t
        return None

    def supported(self, x, y):
        if y & 15 == 0:
            for cx in range((x - HW) >> 4, ((x + HW - 1) >> 4) + 1):
                c = self.cls(cx, y >> 4)
                if c & 0x80 or c in (TC_ONEWAY, TC_ONEWAY_WATER):
                    return True
        return self.ladder_top(x, y) == y

    def in_water(self, x, y, h):
        for cy in range((y - h + 1) >> 4, ((y - 2) >> 4) + 1):
            for cx in range((x - 4) >> 4, ((x + 3) >> 4) + 1):
                if self.cls(cx, cy) in (TC_WATER, TC_ONEWAY_WATER) and 0 <= cx < W and 0 <= cy < H:
                    return (cx, cy)
        return None

    def hazard(self, x, y, h, grounded):
        for cy in range((y - h + 1) >> 4, ((y - 2) >> 4) + 1):
            for cx in range((x - 4) >> 4, ((x + 3) >> 4) + 1):
                if self.cls(cx, cy) == TC_DAMAGE:
                    return True
        if grounded and y & 15 == 0:
            for px in (x - 3, x, x + 3):
                if self.cls(px >> 4, y >> 4) in (TC_SOLID_DAMAGE, TC_DAMAGE):
                    return True
        for (x0, y0, x1, y1) in self.hazards:
            if x - HW < x1 and x + HW > x0 and y - h < y1 and y > y0:
                return True
        return False

    def touch(self, x, y, h, out):
        """collectibles (sensor), markers (feet octagon), enemies (attack reach) -> object indices"""
        for i, o in enumerate(self.objs):
            t = o["type"]
            if 1 <= t <= 6:
                if x - HW < o["x"] + 6 and x + HW > o["x"] - 6 and y - h - 15 < o["y"] and y > o["y"] - 12:
                    out.add(i)
            elif t in (OT_EXIT, OT_CP):
                dx, dy = abs(x - o["x"]), abs(y - o["y"])
                if dx <= 18 and dy <= 18 and dx + dy <= 25:
                    out.add(i)
            elif 15 <= t <= 19:
                hw, eh = mkrooms.OT_BODY[t]
                x0, x1 = (0, 640) if t == 17 else (o["x"] - hw - 22, o["x"] + hw + 22)
                if x - HW < x1 and x + HW > x0 and y - 26 < o["y"] + 10 and y > o["y"] - eh - 30:
                    out.add(i)

    # ---- one flight --------------------------------------------------------------------------------
    def fly(self, x, y, vy, prog, drop=0, grace=0):
        """Simulate until landing / exit / death.  Returns (result, touched) with result one of
        ('land', x, y), ('bounce', x, y) (launched by a bounce tile / pad: the caller continues with
        fresh steering programs), ('exit', side), ('water', (cx, cy)), None (death or timeout)."""
        d1, k, d2, hold = prog
        xs, ys = x << 8, y << 8
        vx = d1 * RUN
        touched = set()
        min_y = y
        has = self.nbr
        for f in range(240):
            # ---- integrate
            vy = min(vy + G, VMAX)
            xs += vx
            px = xs >> 8
            if vx > 0:
                e = px + HW
                if any(self.solid(e >> 4, r) for r in range((y - H_AIR) >> 4, ((y - 1) >> 4) + 1)):
                    px = (e & ~15) - HW
                    xs = px << 8
                if not has.get("R") and px + HW > 628:
                    px = 628 - HW
                    xs = px << 8
            elif vx < 0:
                e = px - HW
                if any(self.solid(e >> 4, r) for r in range((y - H_AIR) >> 4, ((y - 1) >> 4) + 1)):
                    px = (e | 15) + 1 + HW
                    xs = px << 8
                if not has.get("L") and px - HW < 12:
                    px = 12 + HW
                    xs = px << 8
            prev_y = y
            ys += vy
            y = ys >> 8
            landed = False
            c0, c1 = (px - HW) >> 4, (px + HW - 1) >> 4
            if vy < 0:
                top = y - H_AIR
                if any(self.solid(c, top >> 4) for c in range(c0, c1 + 1)):
                    y = ((top >> 4) + 1) * 16 + H_AIR
                    ys, vy = y << 8, 0
                if not has.get("U") and y - H_AIR < 12:
                    y = 12 + H_AIR
                    ys, vy = y << 8, 0
            else:
                t = y & ~15
                for c in range(c0, c1 + 1):
                    cl = self.cls(c, y >> 4)
                    if cl & 0x80 or (cl in (TC_ONEWAY, TC_ONEWAY_WATER) and drop == 0
                                     and prev_y <= t + ONEWAY_PREV_TOL and y <= t + ONEWAY_CUR_TOL):
                        y, landed = t, True
                        ys, vy = y << 8, 0
                        break
                if not landed and drop == 0:
                    lt = self.ladder_top(px, y)
                    if lt is not None:
                        y, landed = lt, True
                        ys, vy = y << 8, 0
                if not landed and not has.get("D") and not self.deadly and y > 340:
                    y, landed = 340, True
                    ys, vy = y << 8, 0
            if drop:
                drop -= 1
            min_y = min(min_y, y)
            # ---- interactions
            if self.hazard(px, y, H_AIR, landed):
                return None, touched
            self.touch(px, y, H_AIR, touched)
            wc = self.in_water(px, y, H_AIR)
            if wc:
                return ("water", wc), touched
            if self.deadly and y >= 351 and vy >= 0:
                return None, touched
            if px < 0 and has.get("L"):
                return ("exit", "L"), touched
            if px >= 640 and has.get("R"):
                return ("exit", "R"), touched
            if y - 13 >= 352 and has.get("D"):
                return ("exit", "D"), touched
            if has.get("U") and self.hatch_up and y <= -17 and (px - HW) >> 4 in self.hatch_up and (px + HW - 1) >> 4 in self.hatch_up:
                return ("exit", "U"), touched
            if y > 352 + 64:
                return None, touched
            for (x0, y0, x1, y1) in self.pads:
                if px - HW < x1 and px + HW > x0 and y - H_AIR < y1 and y > y0 and vy >= -0x66 and y <= y0 + 12:
                    return ("bounce", px, y), touched
            if landed:
                if any(self.cls(q >> 4, y >> 4) == TC_BOUNCE for q in (px - 3, px, px + 3)):
                    return ("bounce", px, y), touched
                return ("land", px, y), touched
            # ---- control for the next frame
            vx = (d1 if f + 1 < k else d2) * RUN
            if f + 1 >= hold and vy < 0 and grace == 0:
                vy = -((-vy * CUT) >> 8)
            if grace:
                grace -= 1
        return None, touched

    # ---- successors of a standing spot ---------------------------------------------------------------
    def water_region(self, cell):
        seen, todo = {cell}, [cell]
        while todo:
            cx, cy = todo.pop()
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and self.cls(nx, ny) in (TC_WATER, TC_ONEWAY_WATER):
                    seen.add((nx, ny))
                    todo.append((nx, ny))
        return seen

    def water_exits(self, cell):
        """Standing spots a swimmer can get to + objects it can touch, for the pool containing `cell`."""
        key = ("water", min(self.water_region(cell)))
        if key in self.memo:
            return self.memo[key]
        region = self.water_region(cell)
        spots, touched = set(), set()
        for (cx, cy) in region:
            for dx in (-1, 0, 1):
                c = cx + dx
                for r in range(cy - 1, cy + 2):
                    if not 0 <= c < W or not 0 <= r < H:
                        continue
                    cl = self.cls(c, r)
                    if (cl & 0x80 or cl in (TC_ONEWAY, TC_ONEWAY_WATER)) and not self.solid(c, r - 1):
                        top = r * 16
                        if cy * 16 - 8 <= top <= (cy + 1) * 16:     # a swim kick tops out ~20 px up: flush exits only
                            x = c * 16 + 8
                            if self.box_free(x, top, H_AIR) and not self.hazard(x, top, H_AIR, True):
                                spots.add((x, top))
            for i, o in enumerate(self.objs):
                t = o["type"]
                if (1 <= t <= 6 or t in (OT_EXIT, OT_CP) or 15 <= t <= 19) and \
                        cx * 16 - 16 <= o["x"] < cx * 16 + 32 and cy * 16 - 16 <= o["y"] - 6 < cy * 16 + 32:
                    touched.add(i)
        self.memo[key] = (spots, touched)
        return self.memo[key]

    def ladder_chain(self, x, y, h):
        """Ladder positions reachable by climbing from a body at (x, y)."""
        out = []
        for (lx, top, bot) in self.ladders:
            if x - HW < lx + 8 and x + HW > lx - 8 and y - h < bot and y > top:
                # merge the vertical chain at this x
                t, b = top, bot
                changed = True
                while changed:
                    changed = False
                    for (mx, mt, mb) in self.ladders:
                        if mx == lx and mt <= b and mb >= t and (mt < t or mb > b):
                            t, b = min(t, mt), max(b, mb)
                            changed = True
                out.append((lx, t, b))
        return out

    def successors(self, spot):
        key = (spot, self.doors_open)
        if key in self.memo:
            return self.memo[key]
        x, y = spot
        results, touched = [], set()
        self.touch(x, y, H_STAND if self.box_free(x, y, H_STAND) else H_AIR, touched)

        def add(res, t):
            touched.update(t)
            if res is not None:
                results.append(res)

        on_oneway = y & 15 == 0 and any(self.cls(c, y >> 4) in (TC_ONEWAY, TC_ONEWAY_WATER)
                                        for c in range((x - HW) >> 4, ((x + HW - 1) >> 4) + 1))
        only_oneway = on_oneway and not any(self.solid(c, y >> 4) for c in range((x - HW) >> 4, ((x + HW - 1) >> 4) + 1))
        if self.hatch_down and y == 336 and only_oneway and all(c in self.hatch_down for c in range((x - HW) >> 4, ((x + HW - 1) >> 4) + 1)):
            results.append(("exit", "D"))
        # walk
        for d in (-1, 1):
            nx = x + d * GRID
            if not self.box_free(nx, y, H_AIR):
                continue
            if (d < 0 and not self.nbr.get("L") and nx - HW < 12) or (d > 0 and not self.nbr.get("R") and nx + HW > 628):
                continue
            if nx < 0 or nx >= 640:
                results.append(("exit", "L" if nx < 0 else "R"))
                continue
            if self.hazard(nx, y, H_AIR, True):
                continue
            wc = self.in_water(nx, y, H_AIR)
            if wc:
                results.append(("water", wc))
            elif self.supported(nx, y):
                results.append(("land", nx, y))
            else:
                for dd in (d, 0, -d):
                    add(*self.fly(nx, y, 0, (dd, 999, dd, 999)))
        # jump (needs room to stand up)
        if self.box_free(x, y, H_STAND):
            for prog in PROGRAMS:
                add(*self.fly(x, y, -JUMP, prog))
        # drop through a one-way platform
        if only_oneway or self.ladder_top(x, y) == y:
            for d in (-1, 0, 1):
                add(*self.fly(x, y, 0x16F, (d, 999, d, 999), drop=T_DROP))
        # ladders
        for (lx, top, bot) in self.ladder_chain(x, y, H_STAND):
            t = top + LADDER_TOP_INSET
            if self.box_free(lx, t, H_AIR):
                results.append(("land", lx, t))
            for yy in range(max(t, 14), bot + 1, 8):
                if not self.box_free(lx, yy, H_AIR):
                    continue
                self.touch(lx, yy, H_AIR, touched)
                for d in (-1, 0, 1):
                    add(*self.fly(lx, yy, -JUMP, (d, 999, d, 999)))
                    add(*self.fly(lx, yy, 0, (d, 999, d, 999)))
        self.memo[key] = (results, touched)
        return self.memo[key]

    def bounce(self, x, y):
        key = ("bounce", x, y, self.doors_open)
        if key not in self.memo:
            results, touched = [], set()
            for prog in PROGRAMS:
                res, t = self.fly(x, y, -BOUNCE, prog, grace=12)
                touched |= t
                if res is not None:
                    results.append(res)
            self.memo[key] = (results, touched)
        return self.memo[key]

    # ---- search ------------------------------------------------------------------------------------------
    def settle(self, x, y):
        """Starting position -> list of results (drop until standing)."""
        if self.box_free(x, y, H_AIR) and self.supported(x, y):
            return [("land", x, y)], set()
        res, t = self.fly(x, y, 0, (0, 999, 0, 999))
        return ([res] if res else []), t

    def explore(self, starts):
        """starts: list of results ('land', x, y) / ('water', cell).  Returns dict with reachable spots,
        exits (set of sides), touched {object index: set of spots the player can continue from}."""
        spots, exits, touched = {}, set(), {}
        spots_b = set()
        todo = []

        def push(res):
            if res[0] == "exit":
                exits.add(res[1])
            elif res[0] == "bounce":
                k = ("b", res[1] // 2, res[2])
                if k not in spots_b:
                    spots_b.add(k)
                    results, t = self.bounce(res[1], res[2])
                    cont = {(r[1], r[2]) for r in results if r[0] == "land"}
                    for i in t:
                        touched.setdefault(i, set()).update(cont)
                    for r in results:
                        push(r)
            elif res[0] == "water":
                w_spots, w_touch = self.water_exits(res[1])
                for i in w_touch:
                    touched.setdefault(i, set()).update(w_spots)
                for s in w_spots:
                    push(("land",) + s)
            else:
                k = (res[1] // GRID, res[2])
                if k not in spots:
                    spots[k] = (res[1], res[2])
                    todo.append((res[1], res[2]))

        for s in starts:
            push(s)
        while todo:
            spot = todo.pop()
            results, t = self.successors(spot)
            cont = {spot} | {(r[1], r[2]) for r in results if r[0] == "land"}
            for i in t:
                touched.setdefault(i, set()).update(cont)
            for r in results:
                push(r)
        return {"spots": set(spots.values()), "exits": exits, "touched": touched}

    # ---- portals ----------------------------------------------------------------------------------------
    def portals(self):
        """{name: list of start results} for the spawn and every seam the room has."""
        out = {}
        sx, sy = self.d["spawn"]
        out["spawn"] = self.settle(sx, sy)[0]
        for side, col, x in (("L", 0, 8), ("R", W - 1, 632)):
            n = self.nbr.get(side)
            if not n:
                continue
            starts = []
            for r in range(H - 1):
                here, below = self.coll[r * W + col], self.coll[(r + 1) * W + col]
                there = n["coll"][r * W + (W - 1 - col)]
                if not here & 0x80 and not there & 0x80 and (below & 0x80 or below in (TC_ONEWAY, TC_ONEWAY_WATER)):
                    starts.append(("land", x, (r + 1) * 16))
            if starts:
                out[side] = starts
        if self.hatch_up:
            starts = []
            for c in self.hatch_up:
                starts += self.settle(c * 16 + 8, 14)[0]
            out["U"] = starts
        if self.hatch_down:
            out["D"] = [("land", c * 16 + 8, 336) for c in self.hatch_down]
        return out


def check_goal(room, starts):
    """Returns (ok, message): can the room's goal be completed from `starts` without touching a hazard?"""
    d = room.d
    objs = d["objects"]
    room.doors_open = False
    res = room.explore(starts)
    keys = [i for i, o in enumerate(objs) if o["type"] == OT_KEY]
    if room.doors and any(i in res["touched"] for i in keys):
        room.doors_open = True
        cont = set()
        for i in keys:
            cont |= res["touched"].get(i, set())
        res2 = room.explore([("land",) + s for s in (cont | res["spots"])])
        for i, s in res["touched"].items():
            res2["touched"].setdefault(i, set()).update(s)
        res2["exits"] |= res["exits"]
        res = res2
    g = d["goal"]
    if g == "none":
        return True, "no goal", res
    if g == "collect_target":
        n = sum(1 for i, o in enumerate(objs) if 1 <= o["type"] <= 6 and i in res["touched"])
        return n >= d["goal_param"], "%d of %d needed collectibles reachable" % (n, d["goal_param"]), res
    if g == "defeat_all":
        missing = [i for i, o in enumerate(objs) if 15 <= o["type"] <= 19 and i not in res["touched"]]
        return not missing, "enemies out of reach: %s" % [objs[i]["name"] for i in missing], res
    if g == "reach_exit":
        ok = any(o["type"] == OT_EXIT and i in res["touched"] for i, o in enumerate(objs))
        return ok, "exit %sreachable" % ("" if ok else "NOT "), res
    if g == "checkpoint_sprint":
        order = sorted((o["param"], i) for i, o in enumerate(objs) if o["type"] == OT_CP)
        order.append((99, next(i for i, o in enumerate(objs) if o["type"] == OT_EXIT)))
        cur = res
        for n, (_p, i) in enumerate(order):
            if i not in cur["touched"]:
                return False, "sprint marker %d not reachable in order" % n, res
            cur = room.explore([("land",) + s for s in cur["touched"][i]])
        return True, "all %d sprint markers reachable in order" % len(order), res
    return False, "unknown goal", res


def load_world(gen):
    with open(os.path.join(gen, "rooms.json")) as f:
        listing = json.load(f)
    decoded = {}
    for e in listing:
        with open(os.path.join(gen, e["bin"]), "rb") as f:
            decoded[(e["x"], e["y"])] = mkrooms.decode_blob(f.read())
    rooms = {}
    for e in listing:
        x, y = e["x"], e["y"]
        nbr = {"L": decoded.get((x - 1, y)), "R": decoded.get((x + 1, y)),
               "U": decoded.get((x, y - 1)), "D": decoded.get((x, y + 1))}
        rooms[e["name"]] = Room(decoded[(x, y)], nbr)
    return listing, rooms


def analyse(room):
    """Goal from the spawn + portal-to-portal traversal.  Returns (problems, lines)."""
    problems, lines = [], []
    ports = room.portals()
    ok, msg, res = check_goal(room, ports["spawn"])
    lines.append("goal %s from spawn: %s (%d standing spots)" % (room.d["goal"], msg, len(res["spots"])))
    if not ok:
        problems.append("goal not completable from the spawn: " + msg)
    sides = [s for s in ports if s != "spawn"]
    for name, starts in ports.items():
        if not starts:
            problems.append("portal %s has no valid start position" % name)
            continue
        room.doors_open = bool(room.doors)       # traversal is checked with doors opened
        res = room.explore(starts)
        room.doors_open = False
        missing = [s for s in sides if s != name and s not in res["exits"]]
        lines.append("from %-5s -> exits %s%s" % (name, "".join(sorted(res["exits"])) or "-",
                                                  "   MISSING " + "".join(missing) if missing else ""))
        if missing:
            problems.append("from %s the exits %s are not reachable" % (name, missing))
    return problems, lines


def main():
    gen = os.path.join(os.path.dirname(HERE), "build", "gen")
    if "--gen" in sys.argv:
        gen = sys.argv[sys.argv.index("--gen") + 1]
    listing, rooms = load_world(gen)
    bad = 0
    for e in listing:
        if e["x"] >= 100 and "--all" not in sys.argv:
            continue
        problems, lines = analyse(rooms[e["name"]])
        print("%-8s %s" % (e["name"], e["title"]))
        for ln in lines:
            print("    " + ln)
        for p in problems:
            print("    PROBLEM: " + p)
        bad += len(problems)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
