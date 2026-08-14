# Refactor manual QA guide

Last updated: 2026-08-14

This is the single manual-test index for the frozen T00-T17 refactor builds on
`codex/refactor-foundation-2026-08-13`. It records what each tranche changed, its immutable
candidate commit, the local link to open, and the exact manual checks.

No production deployment or production-data mutation is included. Unless a section says
otherwise, use a logged-out or incognito window against the safety backend.

## Current status

| Tranche | Focus | Status | Candidate | Primary link |
| --- | --- | --- | --- | --- |
| T00 | Quicksand state | PASS | `000741f` | [Quicksand room](http://127.0.0.1:4600/r/-2/3?renderer=canvas) |
| T01 | Room-music synchronization | PASS | `8909001` | [Music room](http://127.0.0.1:4601/r/1/0?renderer=canvas) |
| T02 | Entry guard and legacy composer cleanup | PASS | `7a5336c` | [Expanded Room Builder fixture](http://127.0.0.1:4602/r/11/-12?renderer=canvas) |
| T03 | Live-object model and spatial index | PASS | `3d93c4e` | [Object-rich room](http://127.0.0.1:4603/r/1/-1?renderer=canvas) |
| T04 | Live-object lifecycle | PASS | `1244099` | [Object-rich room](http://127.0.0.1:4604/r/1/-1?renderer=canvas) |
| T05 | Movement-state ownership | PASS | `9f8f752` | [Movement fixture](http://127.0.0.1:4605/r/1/-1?renderer=canvas) |
| T06 | Movement and swordsman state machines | PASS | `d730e31` | [Sword Hunter fixture](http://127.0.0.1:4606/r/1/-2?renderer=canvas) |
| T07 | Backdrop and camera ownership | PASS | `a811551` | [Backdrop fixture](http://127.0.0.1:4607/r/1/-2?renderer=canvas) |
| T08 | Room-comments architecture | PASS | `aaef66f` | [Commented room](http://127.0.0.1:4608/r/11/-12?renderer=canvas) |
| T09 | Editor document/history/presentation | PASS | `fd1c070` | [Ordinary editor fixture](http://127.0.0.1:4609/r/11/-13?renderer=canvas) |
| T10 | Streaming model/selection/readiness | PENDING | `229b3ab` | [Streaming fixture](http://127.0.0.1:4610/r/0/0?renderer=canvas) |
| T11 | Streaming preparation/teardown | PENDING | `848eda8` | [Transition fixture](http://127.0.0.1:4611/r/0/0?renderer=canvas) |
| T12 | PvP combat ownership | PENDING | `212d54a` | [Two-client PvP fixture](http://127.0.0.1:4612/r/0/0?renderer=canvas) |
| T13 | Typed Pages Worker | PASS | `68b362b` | [Typed Pages root](http://127.0.0.1:4613/) |
| T14 | Worker analysis/admin modules | PENDING | `4d024d3` | [Read-only client](http://127.0.0.1:4614/?renderer=canvas) |
| T15 | Admin UI entries | PENDING | `802ce11` | [Launch Admin](http://127.0.0.1:4615/launch-admin.html) |
| T16 | PartyKit server decomposition | PENDING | `d3ba27a` | [Two-client presence fixture](http://127.0.0.1:4616/r/0/0?renderer=canvas) |
| T17 | Performance/dead-code closeout | PENDING | `2fe3548` | [T17 dense room](http://127.0.0.1:4617/r/5/7?renderer=canvas) |

The localhost servers are temporary. A connection-refused response means the exact frozen server
needs restarting; it is not a test failure. Do not substitute a different tranche's port. The
immutable artifacts live under `/private/tmp/everybodys-platformer-refactor-qa/`.

## Test and reporting rules

- Prefer Mac Chrome first and keep the renderer shown in the link.
- Dismiss the fresh-storage Welcome and room-goal dialogs before testing controls.
- For audio checks, make one movement/jump gesture and confirm Settings music volume is above zero;
  browsers may suspend Web Audio until a gesture.
- `PASS` accepts a tranche. `PASS WITH NOTES` is only for cosmetic or nonbehavioral observations.
- Use `STOP` for any structural or behavioral regression. Stop that test before making more writes.

Short success report:

```text
PASS — T10 Streaming — Mac Chrome — /r/0/0 — five crossings
```

Failure report:

```text
Tranche: T10 Streaming
Build: 229b3ab or http://127.0.0.1:4610
Result: STOP
Device: Mac Chrome
Route: /r/0/0
Step: Play → cross right → jump
Expected: continuous movement and collision
Actual: player stuck at seam
Frequency: 2/2
Evidence: screenshot/video
```

## Short client regression sweep

Run this after every client-affecting tranche unless its section replaces a step:

1. Open `/`, then refresh the supplied direct `/r/x/y` link.
2. Browse: pan, zoom, use Fit, and select another room.
3. Play: move, jump, cross one room seam, then Stop.
4. Open a designated safety scratch-room editor and return without saving.
5. Check for blank screens, stuck loaders, lost input, duplicate audio, stale overlays, doubled or
   missing objects, invisible collision, and visible errors.

## T00 — Quicksand foundation

- Status: **PASS** at `000741f`
- Open: [Across the desert, room -2,3](http://127.0.0.1:4600/r/-2/3?renderer=canvas)
- Account/writes: none; stay logged out.

1. Enter and leave the nearby quicksand pool three times.
2. Confirm horizontal movement and jumping slow, and the player sinks only while touching it.
3. Confirm full recovery promptly after exiting and only one warning within the cooldown window.
4. Die or Restart, re-enter, and confirm there is no stale sinking or cooldown state.
5. Touch another hazard and confirm its behavior is unchanged.

Optional: repeat with touch controls.

## T01 — Room-music synchronization

- Status: **PASS** at `8909001`
- Account/writes: none for the required test.

Fixtures:

- [Normal music: 1,0](http://127.0.0.1:4601/r/1/0?renderer=canvas)
- [Alternate music: 1,-1](http://127.0.0.1:4601/r/1/-1?renderer=canvas)
- [Empty music: 0,0](http://127.0.0.1:4601/r/0/0?renderer=canvas)
- [Expanded Room/Course continuity: 1,-8](http://127.0.0.1:4601/r/1/-8?renderer=canvas)

1. Move west from `1,0` into silent `0,0`; music should stop at the intended bar boundary.
2. Return east; the original arrangement should start once, without overlap.
3. Move north from `1,0` into `1,-1`; the alternate arrangement should replace it once.
4. Stop to Browse and Play again; no arrangement should persist or double.
5. Repeat one seam twice and listen for unwanted restarts.
6. In `1,-8` (`Race To The Top`), traverse north through its silent internal cells. The starting
   arrangement should continue without restarting or stacking; stopping the Expanded Room should
   stop it immediately.

Optional: edit music only in a designated safety scratch draft, save/reload, and Test. Do not
Publish.

## T02 — Executable-entry guard and legacy course-composer cleanup

- Status: **PASS** at repair candidate `7a5336c`
- Open: [So many doors, 11,-12](http://127.0.0.1:4602/r/11/-12?renderer=canvas)
- Account/writes: sign into the safety backend as `jonathan`. Add/Remove perform two safety draft
writes. Never click Save Setup, Publish, Unpublish, or edit room content.

1. Confirm the builder initially shows the published four-cell footprint and `4/16`. If not, STOP.
2. Open Expanded Room Builder, select `11,-13`, and Add Cell.
3. Open the new cell, make no edits, and return to the builder.
4. Remove `11,-13`; confirm the footprint returns exactly to `11,-12`, `12,-12`, `11,-11`, and
   `12,-11`, showing `4/16`.
5. Test Draft, Stop, return to the builder, then return to World.
6. Confirm no Saving overlay remains stuck, the active panel is usable, and the removed legacy
   modal never appears.

## T03 — Live-object model and spatial index

- Status: **PASS** at `3d93c4e`
- Open: [Learn2WAMP 2, 1,-1](http://127.0.0.1:4603/r/1/-1?renderer=canvas)
- Account/writes: none; stay logged out.

1. Collect a loose key or the key in the treasure chest, then open a locked door or trapdoor.
2. Trigger the block switch and confirm its blocks change once.
3. Ride both moving platforms far enough to see their paths.
4. Push/pull both crates; collision should track each visible crate.
5. Cross a seam and return; nothing should duplicate, disappear, or remain invisibly collidable.
6. Restart and repeat one key/door, switch, platform, and crate interaction. State should reset
   exactly once.

## T04 — Complete live-object lifecycle split

- Status: **PASS** at `1244099`
- Open: [Object fixture 1,-1](http://127.0.0.1:4604/r/1/-1?renderer=canvas) and
[enemy fixture 1,-2](http://127.0.0.1:4604/r/1/-2?renderer=canvas)
- Account/writes: none; stay logged out.

1. Repeat T03's pickup, switch, moving-platform, crate, seam-return, and Restart checks.
2. In `1,-2`, defeat one enemy using its normal interaction, then touch an enemy or hazard.
3. Restart and repeat against the same targets.
4. Confirm kill/removal FX, collision removal, death/respawn, switch state, and restoration each
   happen once—never doubled or missing.

## T05 — Movement-state ownership

- Status: **PASS** at `9f8f752`
- Open: [Movement fixture 1,-1](http://127.0.0.1:4605/r/1/-1?renderer=canvas)
- Account/writes: none; stay logged out.

1. Run, jump, crouch/crawl, and land repeatedly.
2. Climb a ladder, stop, then jump or walk off; gravity and normal movement must resume.
3. Fall against a wall and wall-jump away; sliding, facing, and input must recover.
4. Butt stomp from a jump and confirm one flip, fast fall, impact, and rebound.
5. Push/pull a crate and release it; pose and hitbox must recover.
6. Die or Restart and repeat all states; nothing may survive reset.

Optional: repeat with touch controls and a sideways/upward-gravity fixture.

## T06 — Movement and swordsman state-machine decomposition

- Status: **PASS** at `d730e31`
- Open: [Sword Hunter fixture 1,-2](http://127.0.0.1:4606/r/1/-2?renderer=canvas)
- Account/writes: none; stay logged out.

1. Repeat the T05 run/jump/crouch/ladder/wall/butt-stomp/crate sequence.
2. Observe the Sword Hunter through patrol, chase, windup, slash, recovery, and traversal.
3. Let it attack; facing, timing, hit range, damage, and route choice should feel unchanged.
4. Defeat it using the intended attack mode.
5. Restart and repeat; no attack, navigation, or ladder state may remain.
6. Cross away and back; the enemy should appear and behave exactly once.

## T07 — Backdrop and camera ownership

- Status: **PASS** at `a811551`
- Open: [Backdrop fixture 1,-2](http://127.0.0.1:4607/r/1/-2?renderer=canvas)
- Account/writes: none; stay logged out.

1. Stop to Browse; pan horizontally/vertically, zoom far out/in, and press Fit.
2. Confirm the two starfield layers move at different subtle parallax rates without seams or jumps.
3. Enter Play and cross one seam; terrain, background, player, and HUD must transition together.
4. Resize narrow → wide → narrow; the backdrop must fill without blank strips or stretching.
5. Repeat Play → Browse three times.
6. Confirm player, terrain, ghosts, comments, weather/lighting, projectiles, and HUD each render
   once and above the backdrop.

Optional: repeat with `?renderer=webgl`.

## T08 — Room-comments architecture

- Status: **PASS** at `aaef66f`
- Open: [Commented room 11,-12](http://127.0.0.1:4608/r/11/-12?renderer=canvas)
- Account/writes: required checks are read-only. Sign in only if needed to open/type in the composer;
cancel with Escape and do not submit.

1. Enable Comments and select three rooms rapidly.
2. Pan/zoom and confirm pins stay attached to the correct rooms.
3. Toggle visibility off/on, reload, and confirm the setting persists.
4. Open the composer, type without submitting, cancel with Escape, and reopen it.
5. Enter Play and return to Browse; no stale composer, marker, pin, or danmaku should remain.

## T09 — Editor document, history, and presentation core

- Status: **PASS** at `fd1c070`
- Open: [Ordinary room 11,-13](http://127.0.0.1:4609/r/11/-13?renderer=canvas) and
[Expanded Room 11,-12](http://127.0.0.1:4609/r/11/-12?renderer=canvas)
- Account/writes: sign into safety as `jonathan`. Safety draft writes are expected. Do not Publish or
Unpublish.

Ordinary room:

1. Place a tile and object; select, configure, move, and delete them.
2. Undo and Redo every operation; confirm dirty/save indicators.
3. Save Draft, reload, reopen, and Test Play.

Expanded Room:

1. Edit two cells and make one placement plus Undo/Redo in each.
2. Save each safety draft, Test Draft, and return.
3. Confirm document, history, selection, and presentation state never leaks between cells.

## T10 — World-streaming model, selection, and readiness

- Status: **PENDING** at `229b3ab`
- Open: [Streaming fixture 0,0](http://127.0.0.1:4610/r/0/0?renderer=canvas)
- Account/writes: none; stay logged out.

1. In Play, cross right/left and down/up, backtracking after every crossing.
2. Stop to Browse; zoom far out/in, pan away, press Fit, select another room, Warp, and Play.
3. Refresh the direct route and repeat one seam.
4. Confirm room, collision, camera, player, objects, background, and HUD transition together.
5. STOP on a freeze, invisible wall, fall-through, missing player, blank world tile, stale overlay,
   doubled room, or visible error.

Optional: repeat with Settings → Performance → Battery Saver, then restore the original setting.

## T11 — World-streaming preparation and teardown

- Status: **PENDING** at `848eda8`
- Open: [Repeated-transition fixture 0,0](http://127.0.0.1:4611/r/0/0?renderer=canvas) and
[custom-background fixture -2,8](http://127.0.0.1:4611/r/-2/8?renderer=canvas)
- Account/writes: none; use published content logged out.

1. Cross one horizontal seam in both directions five times, then a vertical seam both ways five
   times. Repeat once after the rooms are warm.
2. Stop to Browse, then Play again; terrain, player, collision, objects, background, camera, and
   HUD should transition together exactly once.
3. In `-2,8`, cross to an adjacent playable room and back several times, then Stop and Play again.
4. Use a known published safety portal, let the destination settle, return or Browse, and Play
   again. Origin and destination must each activate/clean up once.
5. STOP on a freeze, invisible wall, fall-through, missing player, stale preview/background,
   doubled object, or collision mismatch.

Optional: repeat in Canvas and WebGL.

## T12 — PvP combat ownership

- Status: **PENDING** at `212d54a`
- Open in both windows: [PvP fixture 0,0](http://127.0.0.1:4612/r/0/0?renderer=canvas)
- Account/writes: two different safety accounts in separate browser profiles/windows. Completing a
match may create safety-only PvP result rows.

1. From the same room, decline one invite, invite again, and accept.
2. Confirm both windows show the same countdown.
3. From both sides, exercise sword, gun, stomp, misses, and rapid repeated hits.
4. Walk/jump into each other; neither player should remain stuck.
5. Confirm hearts, invulnerability blink, sound/flash, and knockback occur once per accepted hit.
6. Complete death, respawn, winner/result, and leave flows.
7. Refresh one window; there must be no duplicate opponent, stale match, or cross-match hit.

Optional: reconnect during countdown and repeat with a third observer.

## T13 — Typed Pages Worker

- Status: **PASS** at `68b362b`
- Account/writes: none; all fixtures are public/read-only.

Open and refresh each link:

1. [App root](http://127.0.0.1:4613/)
2. [Room share page](http://127.0.0.1:4613/r/0/0) — title should include
   `Hello World - WAMP room 0,0`.
3. [Room share image](http://127.0.0.1:4613/r/0/0/image.png) — real 1200×630 PNG, never HTML.
4. [Jonathan profile](http://127.0.0.1:4613/player-f76e0baf8042) — title should identify
   `jonathan (@player-f76e0baf8042)`.
5. [Playlist](http://127.0.0.1:4613/playlist/jonathans-levels) — title should identify
   `lelvels I made!`.
6. [Wamp-O-Gram](http://127.0.0.1:4613/wamp-o-gram/e8a24599b43bc1ea9a727dbd040329edec3a) —
   should identify `Lost in the Rooms` and still open the playable postcard.

STOP for wrong metadata, HTML from the PNG URL, blank shells, failed direct refresh, missing share
content, or route-specific 404/500 responses.

## T14 — Cloudflare Worker analysis/admin modules

- Status: **PENDING** at `4d024d3`
- Open: [Safety-backed client](http://127.0.0.1:4614/?renderer=canvas)
- Account/writes: public Explore/leaderboards need no account; a safety account helps with Profile
views. Read-only only—do not rate, comment, approve, invalidate, edit, or publish.

1. Open Explore and switch among Featured, Quality, Newest, and Builder sorts.
2. Open Leaderboards; inspect one room leaderboard and a user/profile detail.
3. Open a Profile, then a room's History and Comments.
4. Confirm counts, order, filters, cursor/load-more behavior, and detail panels.
5. Refresh each surface directly and check for missing or stale data.
6. With safety admin access, optionally inspect Launch/Suspicious totals and lists without using
   mutation controls.

## T15 — Admin UI entries

- Status: **PENDING** at `802ce11`
- Open: [Launch Admin](http://127.0.0.1:4615/launch-admin.html) and
[Suspicious Admin](http://127.0.0.1:4615/suspicious-admin.html)
- Account/writes: safety admin key required. Read-only only—do not approve, reject, invalidate, hide,
delete, edit, save caps, or otherwise mutate records.

1. Open both pages and enter the safety admin key.
2. Launch Admin: change section tabs, activity range/filter, Game Jam selection, and user search.
3. Open one detail and refresh; section hash, activity range/filter, and Game Jam preference should
   persist.
4. Suspicious Admin: change queue tab and filters/search, then open one user detail.
5. Refresh. The URL must remain stable; the Suspicious queue intentionally resets to All.
6. Confirm tables, counts, loading/empty/error states, sorting, search, and visible controls.

Optional: repeat at phone width and confirm no functional controls disappear.

## T16 — PartyKit server decomposition

- Status: **PENDING** at `d3ba27a`
- Open in both windows: [Presence fixture 0,0](http://127.0.0.1:4616/r/0/0?renderer=canvas)
- Account/writes: two safety accounts; a guest third window is optional. One uniquely labeled safety
chat message and ordinary safety PvP rows are allowed.

Important: the frozen client uses the already-deployed safety PartyKit. The refactored T16 server
was not deployed; automated tests and the local 48-client probe exercise the candidate server.
Manual QA checks compatibility of the unchanged client/wire contract.

1. Join the same room in both windows; each must show exactly one ghost for the other player and
   the correct online count.
2. Move/jump in both; remote animation and facing should follow without doubling.
3. Move one player to an adjacent room and return; visibility and counts should update once.
4. Open and close an editor; editor count/preview must appear and clear without going stale.
5. Close/reopen one window; no duplicate ghost or inflated count.
6. Send one uniquely labeled message such as `T16 QA <time>`; it should appear once in that room.
7. Invite to PvP, reconnect one window, invite/accept again, and verify delivery, countdown,
   movement, one hit, and leave.

Optional: repeat with a guest third window and across a chunk boundary.

## T17 — Measured performance and dead-code closeout

- Status: **PENDING** at `2fe3548`
- Open: [T00 baseline](http://127.0.0.1:4600/r/5/7?renderer=canvas) and
[T17 candidate](http://127.0.0.1:4617/r/5/7?renderer=canvas)
- Account/writes: none; stay logged out and do not finish a ranked goal.

Use the same browser, renderer, window size, and actions for both builds:

1. On T00, spend two minutes in Browse using pan, zoom, and Fit. Repeat on T17.
2. On T00, Play `5,7`, move/jump, and cross the same seam repeatedly for two minutes. Repeat on
   T17.
3. On each build, open and close Comments once.
4. On each build, open the editor and return without changing or saving.
5. Report `better`, `same`, or `worse`, plus the exact action associated with any hitch.

Automated reference: traversal p95 was 7.4 ms; repeated-transition median p95 was 19.5 ms with
5/5 correct crossings, zero seam hold, and no errors. Initial JS fell 75.3% for minted-room,
89.8% for room-preview, and 89.7% for the world-tile renderer. Knip remains report-only.

## Final acceptance after the pending tranches pass

After T10-T12 and T14-T17 are accepted:

1. Merge current `origin/main` without rewriting any accepted tranche SHA.
2. Rerun the complete test/build gate, DOM and Worker safety smokes, PartyKit identity/load probes,
   Canvas/WebGL gameplay smokes, streaming performance probes, and `git diff --check`.
3. Run one final manual sweep across Play/Browse, editor, Expanded Room, comments, PvP, admin, and
   reconnect behavior.
4. Leave the branch clean, local, and undeployed until a separate push/deploy request.
