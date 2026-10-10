# F229 shared audio engine

Delivered 2026-10-09 in [PR #109](https://github.com/songadaymann/wamp/pull/109), merge `60d19b4f`, live on https://wamp.land through the Pages auto-build (verified in the served chunks). Completes F229 with the first slice from [PR #101](https://github.com/songadaymann/wamp/pull/101), which disabled Phaser's unused sound engine and paused hidden audio. Frontend only.

## Behavior

- **One engine.** `src/audio/engine.ts` owns the game's only AudioContext, created the first time audio is needed. Music and routed sound effects play into their own buses, which feed one master. Music volume is the music bus; the effects bus is there for ducking music under stings later. Plain (unrouted) effects still use HTMLAudio.
- **One lifecycle.** A single set of listeners unlocks audio on the first tap or key, suspends the context while the page is hidden and resumes it on return or focus. Effects stop when the page is hidden rather than replaying on return.
- **Interruptions.** If the context suspends with no page event while the page is visible and audio was unlocked (an iPhone call, Siri, another app's audio), it resumes by itself. After three tries in ten seconds it waits for the next tap or key.
- **iPhone silent switch.** On Safari 16.4+, `navigator.audioSession.type` is `ambient` (unless the page already chose a type). Music and effects both follow the silent switch and let the player's own music keep playing, as native games do. Before, Web Audio music and HTMLAudio effects followed different rules. To make WAMP play even with the switch on, change `AUDIO_SESSION_TYPE` to `playback`.

## Evidence

- `npm run check` on Node 22: 416 files, 3,298 tests, with lint, types and build.
- Engine tests: one context, one set of listeners and both buses shared by music and effects; hidden listeners before suspend; no lifecycle resume before a gesture; recovery only while visible and unlocked, capped per window; audio session set once and a page-chosen type left alone. The existing music and effects lifecycle tests pass with their own engine per test.
- Chromium with a real AudioContext on the local dev server, zero page errors:
  - No context exists before audio is needed. Music playing plus a muffled effect makes exactly one context, running.
  - With the hidden signal, the context suspends and its clock stays at 1.55 s across 650 ms; visible resumes it.
  - A suspension made outside the page resumes by itself (`statechange-suspended`). The fourth in a row stays suspended until a key press resumes it.
- Firefox (Playwright build 1495): the same checks pass, with zero page errors.
- WebKit: `navigator.audioSession` is supported and reads `ambient`.

## Still to check by hand

A real background-tab switch (Playwright forces visibility, so the hidden signal was simulated over the real context and clock), an iPhone call or Siri interruption, and the silent switch on an iPhone.
