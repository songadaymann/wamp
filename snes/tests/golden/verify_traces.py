#!/usr/bin/env python3
"""Independent checker for the golden physics traces in this folder.

It shares no code with the generator (gen/snesGolden.gen.test.ts). Three layers:

 A. schema    - every trace has a 40x22 mask, contiguous steps, inputs == steps[].in,
                pressed == held & ~previous, step 0 == spawn.
 B. kinematics- every step of every trace obeys the integrator
                    vy' = clamp(vy + 700/60, +-500); x += vx/60; y += vy'/60
                unless the trace itself says the body was blocked on that axis, in which case
                the body must sit exactly on a 16 px tile boundary; and the body never ends a
                step inside a solid cell of the mask (q1 quirk probe excepted).
 C. model     - a from-scratch exact-rational re-implementation of the jump rules
                (gravity, floor landing, run, coyote 110 ms, buffer 120 ms, protected rise 70 ms,
                release cut x0.85) replays the stored inputs of the jump / coyote / buffer /
                fall scenarios and must reproduce x, y, vx, vy, grounded on every step.
 D. numbers   - closed-form values (apex, airtime, distance, terminal step, slide rate ...).

Usage:  python3 snes/tests/golden/verify_traces.py        (exit status 0 = all good)
"""
import glob
import json
import os
import sys
from fractions import Fraction as F

HERE = os.path.dirname(os.path.abspath(__file__))
G = F(700, 60)          # px/s gained per step
VMAX = 500
DT = F(1000, 60)        # ms per step
TOL = 2e-6              # traces are rounded to 6 decimals
errors = []


def err(name, msg):
    errors.append(f"{name}: {msg}")


def load():
    out = {}
    for path in sorted(glob.glob(os.path.join(HERE, "*.json"))):
        base = os.path.basename(path)[:-5]
        if base.startswith("_"):
            continue
        with open(path) as f:
            out[base] = json.load(f)
    return out


def solid(rows, cx, cy):
    return 0 <= cx < 40 and 0 <= cy < 22 and rows[cy][cx] == "#"


# ------------------------------------------------------------------ A. schema
def check_schema(name, t):
    rows = t["layout"]["rows"]
    if len(rows) != 22 or any(len(r) != 40 for r in rows):
        err(name, "layout is not 40x22")
    if set("".join(rows)) - set(".#="):
        err(name, "unknown layout char")
    if t["scenario"] != name:
        err(name, "scenario field != file name")
    st = t["steps"]
    if [s["step"] for s in st] != list(range(len(st))):
        err(name, "steps not contiguous from 0")
    if len(t["inputs"]) != len(st) - 1:
        err(name, "inputs length")
    sp = t["layout"]["spawn_feet"]
    if st[0]["x"] != sp["x"] or st[0]["y"] != sp["y"] or st[0]["vx"] or st[0]["vy"]:
        err(name, "step 0 is not the spawn state")
    prev = ""
    for i, s in enumerate(st[1:]):
        if s["in"] != t["inputs"][i]:
            err(name, f"step {s['step']}: in != inputs[]")
        if set(s["in"]) - set("LRUDJ"):
            err(name, f"step {s['step']}: bad button")
        want = "".join(k for k in s["in"] if k not in prev)
        if s["pressed"] != want:
            err(name, f"step {s['step']}: pressed {s['pressed']!r} != {want!r}")
        prev = s["in"]
    if any(t["inputs"][:5]):
        err(name, "lead-in is not idle")
    if "U" in "".join(t["inputs"]):
        err(name, "U used (README says never)")


# -------------------------------------------------------------- B. kinematics
def on_grid(v):
    return abs(v / 16 - round(v / 16)) < TOL


def check_kinematics(name, t):
    rows = t["layout"]["rows"]
    st = t["steps"]
    for p, s in zip(st, st[1:]):
        k = s["step"]
        hover = p["stomp"] and p["stomp_flip_ms"] > 0          # gravity off during the flip pause
        v_int = p["vy"] if hover else max(-VMAX, min(VMAX, p["vy"] + float(G)))
        pb = s["pre_blocked"]
        shift = s["corner_shift"] if s["corner_n"] != p["corner_n"] else 0
        # ---- x
        if "l" in pb or "r" in pb:
            edge = s["x"] - shift + (5 if "r" in pb else -5)
            if not on_grid(edge):
                err(name, f"step {k}: blocked {pb} but body edge {edge} not on a tile boundary")
            if s["pre_vx"] != 0:
                err(name, f"step {k}: blocked sideways but pre_vx != 0")
        else:
            want = p["x"] + p["vx"] / 60 + shift
            if abs(s["x"] - want) > TOL:
                err(name, f"step {k}: x {s['x']} != {want}")
            if abs(s["pre_vx"] - p["vx"]) > TOL:
                err(name, f"step {k}: pre_vx changed without a block")
        # ---- y
        assisted = s["grounded"] and "d" not in pb
        if "d" in pb:
            if not on_grid(s["y"]) or s["pre_vy"] != 0:
                err(name, f"step {k}: blocked down but y {s['y']} / pre_vy {s['pre_vy']}")
        elif "u" in pb:
            if not on_grid(s["y"] - p["h"]) or s["pre_vy"] != 0:
                err(name, f"step {k}: blocked up but head {s['y'] - p['h']} / pre_vy {s['pre_vy']}")
        else:
            if abs(s["pre_vy"] - v_int) > TOL:
                err(name, f"step {k}: pre_vy {s['pre_vy']} != {v_int}")
            if assisted:
                if not on_grid(s["y"]):
                    err(name, f"step {k}: gap assist y {s['y']} not on a tile top")
            elif abs(s["y"] - (p["y"] + v_int / 60)) > TOL:
                err(name, f"step {k}: y {s['y']} != {p['y'] + v_int / 60}")
        if not (17 <= s["x"] <= 623 and s["y"] <= 340 and s["y"] - s["h"] >= 0):
            err(name, f"step {k}: body leaves the room interior the port allows (x 17..623, y <= 340)")
        if s["h"] not in (14, 26):
            err(name, f"step {k}: h {s['h']}")
        # ---- no penetration of solid cells at end of step
        if name.startswith("q1"):
            continue
        x0, x1, y0, y1 = s["x"] - 5, s["x"] + 5, s["y"] - s["h"], s["y"]
        eps = 1e-4
        for cy in range(int((y0 + eps) // 16), int((y1 - eps) // 16) + 1):
            for cx in range(int((x0 + eps) // 16), int((x1 - eps) // 16) + 1):
                if solid(rows, cx, cy):
                    err(name, f"step {k}: body inside solid cell ({cx},{cy})")


# ------------------------------------------------------------------ C. model
def replay(t):
    """Exact-rational jump model. Only floors (landing from above) are modelled."""
    rows = t["layout"]["rows"]
    sp = t["layout"]["spawn_feet"]
    x, y, vx, vy = F(sp["x"]), F(sp["y"]), F(0), F(0)
    coyote = jbuf = prot = F(0)
    prev = ""
    out = [dict(x=x, y=y, vx=vx, vy=vy, grounded=False)]
    for held in t["inputs"]:
        # integrate
        vy = max(F(-VMAX), min(F(VMAX), vy + G))
        y_prev = y
        x += vx / 60
        y += vy / 60
        # land on the highest solid top that the feet crossed, in the columns the body overlaps
        down = False
        if vy > 0:
            c0 = int((x - 5) // 16)
            c1 = int(-((-(x + 5)) // 16)) - 1      # last column strictly overlapped
            tops = [r * 16 for c in range(c0, c1 + 1) for r in range(22)
                    if solid(rows, c, r) and not solid(rows, c, r - 1) and r * 16 >= y_prev - 16]
            tops = [T for T in tops if y_prev <= T + 16 and y > T]
            if tops:
                y, vy, down = F(min(tops)), F(0), True
        # controller
        jbuf, prot = max(F(0), jbuf - DT), max(F(0), prot - DT)
        grounded = down
        coyote = F(110) if grounded else max(F(0), coyote - DT)
        jump_held = "J" in held
        pressed = jump_held and "J" not in prev
        vx = F(-150) if ("L" in held and "R" not in held) else F(150) if ("R" in held and "L" not in held) else F(0)
        if pressed:
            jbuf = F(120)
        if jbuf > 0 and coyote > 0:
            prot = F(70) if (not pressed or not grounded) else F(0)
            vy, jbuf, coyote = F(-280), F(0), F(0)
        if not jump_held and prot <= 0 and vy < 0:
            vy = vy * F(85, 100)
        prev = held
        out.append(dict(x=x, y=y, vx=vx, vy=vy, grounded=grounded))
    return out


MODEL_SCENARIOS = ("01_", "02_", "03_", "04_", "05_", "08_")


def check_model(name, t):
    mine = replay(t)
    for m, s in zip(mine, t["steps"]):
        for key in ("x", "y", "vx", "vy"):
            if abs(float(m[key]) - s[key]) > TOL:
                err(name, f"model step {s['step']}: {key} trace {s[key]} != model {float(m[key])}")
                return
        if m["grounded"] != s["grounded"]:
            err(name, f"model step {s['step']}: grounded trace {s['grounded']} != model {m['grounded']}")
            return


# ---------------------------------------------------------------- D. numbers
def near(name, what, got, want, tol=1e-4):
    if got is None or abs(got - want) > tol:
        err(name, f"{what}: got {got}, expected {want}")


def check_numbers(T):
    def steps(n):
        return T[n]["steps"]

    # full held jump, closed form: y(n) = (-280 n + (700/60) n (n+1)/2) / 60
    def rise(n, v0=-280):
        return float((F(v0) * n + G * n * (n + 1) / 2) / 60)
    s = steps("01_jump_held")
    press = next(r["step"] for r in s if r["pressed"] == "J")
    near("01", "apex", 320 - min(r["y"] for r in s), -rise(23))
    near("01", "apex value", -rise(23), 53.0 + 2.0 / 3, 1e-9)
    near("01", "apex step", min(s, key=lambda r: r["y"])["step"] - press, 23, 0)
    near("01", "airborne steps", sum(1 for r in s[press + 1:] if not r["grounded"]), 47, 0)
    near("01", "y at press+47", s[press + 47]["y"], 320)
    near("01", "first moving vy", s[press + 1]["pre_vy"], -280 + 700 / 60)
    # tap jump: v(1) = -280*0.85 after the first airborne step's controller, then *0.85 each step
    v, y, best = -280.0, 0.0, 0.0
    v_list = []
    for n in range(1, 40):
        v = v + 700 / 60
        y += v / 60
        best = min(best, y)
        if v < 0:
            v *= 0.85
        v_list.append(v)
    s = steps("02_jump_tap")
    near("02", "tap apex", 320 - min(r["y"] for r in s), -best)
    near("02", "tap apex value", -best, 17.92267, 1e-5)
    for hold, want in ((2, 21.36), (3, 24.64), (4, 27.73), (6, 33.32), (8, 38.23), (12, 45.87)):
        s = steps(f"02_jump_hold_{hold:02d}")
        near("02", f"hold {hold} apex", 320 - min(r["y"] for r in s), want, 0.006)
    # running jump
    s = steps("03_jump_run_right")
    press = next(r["step"] for r in s if "J" in r["pressed"])
    near("03", "distance at launch height", s[press + 47]["x"] - s[press]["x"], 117.5)
    near("03", "y at press+47", s[press + 47]["y"], 320)
    # terminal velocity: first n with n*700/60 >= 500
    s = steps("08_fall_terminal")
    n = next(n for n in range(1, 100) if n * G >= 500)
    near("08", "terminal step (closed form)", n, 43, 0)
    near("08", "terminal step (trace)", next(r["step"] for r in s if r["vy"] == 500), 43, 0)
    # fall of 296 px: distance after n steps
    d, vv, n = F(0), F(0), 0
    while d <= 296:
        vv = min(F(500), vv + G)
        d += vv / 60
        n += 1
    near("08", "landing step", next(r["step"] for r in s if r["grounded"]), n, 0)
    # coyote / buffer frame counts from the ms constants
    near("04", "coyote frames", max(n for n in range(1, 20) if 110 - n * float(DT) > 0), 6, 0)
    near("05", "buffer frames", max(n for n in range(1, 20) if 120 - n * float(DT) > 0), 7, 0)
    for nm, want in (("04_coyote_air1", True), ("04_coyote_air6", True), ("04_coyote_air7", False)):
        ev = T[nm]["events"]
        if (steps(nm)[ev["press_step"]]["vy"] == -280) != want:
            err(nm, "coyote outcome")
        fa = next(r["step"] for r in steps(nm)[6:] if not r["grounded"])
        if ev["press_step"] - fa + 1 != ev["airborne_step_of_press"]:
            err(nm, "press is not on the stated airborne step")
    for nm, want in (("05_buffer_1_before_landing", True), ("05_buffer_7_before_landing", True),
                     ("05_buffer_8_before_landing", False)):
        s = steps(nm)
        land = next(r["step"] for r in s if "d" in r["pre_blocked"])
        press = next(r["step"] for r in s if "J" in r["pressed"])
        if land - press != T[nm]["events"]["steps_before_landing"] or (s[land]["vy"] == -280) != want:
            err(nm, "buffer outcome")
    # wall slide / wall jump
    s = steps("06_wall_slide_jump")
    slides = [b["y"] - a["y"] for a, b in zip(s, s[1:]) if a["wall_slide"] and b["wall_slide"] and a["vy"] == 70]
    if not slides or any(abs(d - (70 + 700 / 60) / 60) > TOL for d in slides):
        err("06", "slide rate != 1.3611 px/step")
    launches = [r for r in s if "J" in r["pressed"] and abs(r["vx"]) == 205]
    if len(launches) != 3 or any(r["vy"] != -265 for r in launches) or \
            [r["vx"] for r in launches] != [205, -205, 205]:
        err("06", "wall jump launches")
    s = steps("06_wall_jump_lock")
    launch = next(r["step"] for r in s if "J" in r["pressed"] and r["vx"] == 205)
    if not all(s[launch + i]["vx"] == 205 and "L" in s[launch + i]["in"] for i in range(8)) \
            or s[launch + 8]["vx"] != -150:
        err("06", "steer-back is not at launch+8")
    # corner correction
    for n in (1, 2, 3, 4):
        s = steps(f"07_corner_{n:02d}px")
        if s[-1]["corner_n"] != 1 or s[-1]["corner_shift"] != n or s[-1]["x"] != 165:
            err("07", f"{n}px not corrected to x=165")
    for n in (5, 10):
        s = steps(f"07_corner_{n:02d}px")
        if s[-1]["corner_n"] != 0 or s[-1]["x"] != 165 - n:
            err("07", f"{n}px should not be corrected")
        near("07", f"{n}px apex", 320 - min(r["y"] for r in s), 18)   # 32 px headroom - 14 px box
    # wall stop
    s = steps("09_wall_stop")
    if not any("r" in r["pre_blocked"] and r["x"] == 187 for r in s):
        err("09", "not stopped at x=187")
    # crawl speed
    s = steps("11_crouch_idle")
    d = [b["x"] - a["x"] for a, b in zip(s, s[1:]) if a["crouch"] and b["crouch"] and a["vx"] == 70]
    if not d or any(abs(v - 70 / 60) > TOL for v in d):
        err("11", "crawl rate")
    # gap assist
    s = steps("12_gap_assist")
    if any(r["y"] != 320 for r in s) or not all(r["grounded"] for r in s[1:]):
        err("12", "gap assist: y / grounded")
    # one-way
    s = steps("10_one_way")
    drop = next(r for r in s if r["in"] == "DJ")
    if drop["vy"] != 86 or drop["y"] != 272:
        err("10", "drop-through start")
    if min(r["y"] for r in s[:drop["step"]]) >= 272:
        err("10", "did not pass up through the platform")
    win = [r["step"] for r in s if r["drop_ms"] > 0]
    if len(win) != 15 or win[0] != drop["step"]:
        err("10", f"drop window is press step + 14, got {len(win)} steps")
    # butt stomp
    s = steps("13_butt_stomp")
    if sum(1 for r in s if r["stomp"] and r["vy"] == 0 and r["vx"] == 0) != 12:
        err("13", "hover steps != 12")
    # README / _summary agreement
    with open(os.path.join(HERE, "_summary.json")) as f:
        summ = json.load(f)
    for nm, t in T.items():
        if summ.get(nm) != t["events"]:
            err(nm, "_summary.json disagrees with events")
    if set(summ) != set(T):
        err("_summary", "scenario set differs from trace files")


def main():
    T = load()
    for name, t in T.items():
        check_schema(name, t)
        check_kinematics(name, t)
        if name.startswith(MODEL_SCENARIOS):
            check_model(name, t)
    check_numbers(T)
    for e in errors[:60]:
        print("FAIL", e)
    n_model = sum(1 for n in T if n.startswith(MODEL_SCENARIOS))
    print(f"{len(T)} traces, {sum(len(t['steps']) - 1 for t in T.values())} steps checked, "
          f"{n_model} replayed by the independent model, {len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
