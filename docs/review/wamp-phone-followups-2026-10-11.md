# Phone check follow-ups: F229, F023, F080, F076

Jonathan's first phone pass (2026-10-11) found three problems:
- On his iPhone the silent switch didn't silence music.
- Music didn't come back after the first tab switch, though it did after a second.
- Jump and land sounds felt late.
- Desktop controls crowded the phone map, and he couldn't reach Warp.

| Item | PR | Merge | Delivery |
|---|---|---|---|
| F229 / F023 effects on Web Audio buffers, resume retries | [#164](https://github.com/songadaymann/wamp/pull/164) | `eb28cbb6` | Pages |
| F080 / F076 phone map toolbar and Room of the Day chip | [#165](https://github.com/songadaymann/wamp/pull/165) | `f8831af2` | Pages |

## What changed
- **Silent switch:** sound effects used to play from `<audio>` elements. On iPhone, a playing media element puts the page in media-playback mode, which ignores the silent switch for the music too. Effects now play from decoded Web Audio buffers on the same audio context as the music, so the whole game follows the `ambient` audio session.
- **Late effects:** buffers start within the audio output's latency; media elements on iPhone start noticeably later.
  - A sound that is still downloading plays when ready only if that's still on time: 120 ms for movement, hit and click sounds, 1.5 s for fanfares.
  - The five hot cues load right after the first tap, and the other short effects load one at a time after that.
- **Music returning:** the resume when you come back to the tab isn't a tap, and Safari can refuse or ignore it while it is still ending its own interruption.
  - The engine now retries at 0.3, 1 and 3 seconds while audio isn't running.
  - It also unlocks when a tap lifts (`touchend`, `pointerup`, `click`), which is when iPhone Safari counts it as a gesture.
- **Audio readout:** `?audiodebug` on any WAMP link shows the audio state and the last page and audio events on screen, so a failing phone check can be read from a screenshot.
- **Phone map:** the bottom toolbar was wider than the screen, by 35 px on an iPhone 13 and 69 px on an iPhone SE. That widened the whole page: it clipped the ☰ menu and the edge buttons and pushed the Warp sheet off the right edge. The toolbar now scrolls sideways inside the screen. The Room of the Day chip sat over the room card's buttons; on phones it now sits just above the toolbar.

## Evidence
`npm run check` on Node 22 passed for both PRs.
- F229 / F023: unit tests for buffer playback, on-time vs late loads, format fallback, waiting for the context, the hidden and visible lifecycle, warm-up order, lifting-tap unlock and return retries. The browser script (`wamp-checkup-evidence/f229_webaudio_sfx.mjs`, Chromium and WebKit) found:
  - jump, land, collect and goal-success all play;
  - `<audio>.play()` is never called;
  - a hidden page suspends audio, and returning resumes it;
  - when the first resume on return is refused (`NotAllowedError`), the 0.3 s retry restores it.
- F080 / F076: `phone_layout_fix.mjs` at iPhone 13 and iPhone SE sizes. Page width went 425 → 390 and 389 → 320. The Warp sheet now fits, and the chip no longer overlaps the room card.

## Left
- An iPhone re-check of the silent switch, tab return, Siri or a call, effect timing and the map. The round 2 phone checklist covers them.
- Which desktop controls to hide or move on phones (Guestbook, Controls, Report a bug, the room card's size) is Jonathan's call.
- F023: drum pre-bake, stems, WAV hygiene.
