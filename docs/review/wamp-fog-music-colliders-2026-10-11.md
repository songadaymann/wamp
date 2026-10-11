# F002, F138, F011, F004, F078, F223, part of F008, and the phone map trim

| Item | PR | Merge | Delivery |
|---|---|---|---|
| Phone map trim (F080 follow-up) | [#166](https://github.com/songadaymann/wamp/pull/166) | `1532705e` | Pages |
| F004 fog as pooled images | [#167](https://github.com/songadaymann/wamp/pull/167) | `b3c23922` | Pages |
| F078 effects skip at zero volume | [#168](https://github.com/songadaymann/wamp/pull/168) | `4fca9d77` | Pages |
| F223 music renders in a worker | [#169](https://github.com/songadaymann/wamp/pull/169) | `cf13f8a9` | Pages |
| F008 (part) no collider rebuild for bullets | [#170](https://github.com/songadaymann/wamp/pull/170) | `01f2b134` | Pages |
| F002, F138, F011 | earlier PRs; Jonathan's phone check passed | | |

## What changed
- **Phone map:** the toolbar keeps Online, Settings and Chat; Report a bug, Guestbook and Controls open from the ☰ menu. Warp is on the room card.
- **Fog:** each fog blob is an image of one pre-drawn ellipse instead of a polygon Phaser re-cut every frame. It looks the same, with slightly smoother edges, and costs about a third less script time in the heaviest fog room.
- **Music:** room music is built in a background worker instead of on the main thread as you enter a room, so the doorway no longer stalls on it.
- **Cannons:** a bullet or fireball disappearing no longer rebuilds every collision link in the area. A 2-cannon room went from 30 full rebuilds in 15 s to none.
- **Sound volume on iPhone:** since the Web Audio change the slider works; at 0, effects are skipped entirely.
- **Signed off by phone:** 120 Hz frame pacing and refresh-rate-independent jumps (F002, F138), and Battery Saver (F011), whose editor preview already follows the setting.

## Evidence
`npm run check` on Node 22 passed for each PR.
- Trim: `scripts/mobile_smoke.mjs` 12/12 scenarios; `wamp-checkup-evidence/phone_trim_check.mjs` (iPhone 13, iPhone SE, desktop).
- F004: placement test against the old drawing; browser script time at 4× CPU throttle 659/631 → 429/428 ms per second (fog 100) and 446/448 → 376/350 (fog 50).
- F223: renders match the previous renderer bit-for-bit. The longest task after Start in PartyParty was 336/93/274 ms on live and 0/82/84 ms on the branch.
- F008: unit test, plus 0 rebuilds for 30 projectile removals in room -4,-1, with all 32 enemies keeping their colliders.

## Left
- F004: rain drops as rectangles.
- F223: pre-render on approach.
- F008: room-load rebuilds, adjacent-room scoping, category groups.
