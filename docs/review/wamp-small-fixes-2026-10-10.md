# F101, F121, F140 and F039

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F101 boot inside zero-size embeds | [#129](https://github.com/songadaymann/wamp/pull/129) | `7adcc0fc` | Pages (loader `main-D9mh5SEX.js`) |
| F121 phone More+ labels centred | [#129](https://github.com/songadaymann/wamp/pull/129) | `7adcc0fc` | Pages |
| F140 touch stomp needs a fresh push | [#130](https://github.com/songadaymann/wamp/pull/130) | `0107ad2b` | Pages |
| F039 outbox check only after tile-queuing writes | [#131](https://github.com/songadaymann/wamp/pull/131) | `90dc6ee0` | API Worker `1937c469-d2c5-421b-a698-b5445fe057e4` |

## F101
The Phaser config clamps the initial size to 1×1 and sets `scale.min` to 1×1, so a hidden or not-yet-laid-out embed no longer throws `Framebuffer status: Incomplete Attachment` and hangs. In a 0×0 iframe resized after 10 s, the old code never became ready; the new code does. This matters for the Reddit Devvit port and other embeds.

## F121
On phones, the More+ Room Rush and Expand Room labels sat in the top-left corner of their buttons. They are now centred: the label centre is 0/−1 px from the button centre, down from −16/−7.

## F140
On touch, holding the stick slightly down in mid-air started a butt stomp. That happened when walking off a ledge, dropping through a one-way platform, or with a drifting thumb, and the slam breaks crates. Now a stomp needs the stick to go from not-down to down while airborne, matching the keyboard's Down press. Unit tests cover the held stick, the fresh push and the keyboard path.

## F039
Every non-GET API request, from heartbeats and chat to replays and CORS preflights, ran a world-tile outbox query, because tile generation is on in production. The check now runs only after writes under the room, course, Expanded Room, background, world, guest-draft, agent, admin and test-reset areas. Publishing still wakes the renderer at once, and its one-minute cron covers the rest.

## Evidence
- `npm run check` on Node 22 for each PR (F101: 430 files / 3,370 tests; F140: 430 / 3,372; F039: 431 / 3,372).
- Browser checks: the zero-size iframe repro and the phone label offsets (above).
- Live: `touchDownHeld` and `min:{width:1,height:1}` in `main-4tzZ2H-C.js`, and the centring rule in the live CSS.

## Left
- F101: asset loading in a hidden background tab.
- F140: the held-stick jump in up-gravity zones; the real-phone feel.
- F039: skipping error responses.
