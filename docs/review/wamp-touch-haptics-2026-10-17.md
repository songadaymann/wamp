# F090 — Touch gameplay vibration

Source base: `178b568773fc48b947ad811dfa1dce27d5e1ebd0` (delivered F113/PR232). Canonical branch: `codex/wamp-touch-haptics-2026-10-17`.

## Result

Supported, top-level coarse-pointer browsers get brief feedback for local jumps (5ms), pickups (8ms), confirmed hits/stomps (15ms), damage (20/30/20ms), and clears (30/40/60ms). The Vibration switch is in Settings → Comfort, with a 44px label target. Its default-on preference is stored on the device with the existing comfort preferences; account sync and server settings do not change.

Feedback is independent of music/SFX volume. An 80ms minimum interval coalesces bursts, stronger cues replace weaker ones, and a clear’s 130ms pattern is protected from lighter cues. Hidden/unfocused pages, menus/dialogs, editing, unactivated documents and embedded contexts do not request new vibration. Hide, blur, pagehide, leaving Play and the off switch cancel active feedback. Browser rejection or exceptions are harmless. Unsupported devices keep the switch hidden.

The small controller owns capability checks, pacing and cancellation. Existing local-effect owners provide gameplay cues. Shared enemy/explosion/bounce/projectile presentation stays quiet so remote events and ambient effects cannot impersonate a local hit. The two added scene lines only connect the existing confirmed local PvP stomp to the helper. The [Vibration API specification](https://www.w3.org/TR/vibration/) documents activation, visibility and browser refusal; API availability does not establish that a device has working vibration hardware.

## Verification

- Full quality: 524 files / 3,846 tests, typecheck, lint, DOM contract, generated bindings, build and all asset checks pass. Startup JavaScript: 638.4 KB brotli / 670 KB budget.
- Tests cover burst coalescing, stronger-cue protection, missing capability, browser refusal/exception, preference persistence and blocked storage, hide/blur/Stop/off cancellation, listener cleanup, activation/focus/modal guards, shared-effect isolation, protected health contacts and once-per-swing confirmed hits. An actual local stomp is distinguished from shared defeat presentation.
- Native Chrome 390px/320px and desktop WebKit 390px each pass real touch jump, two-pickup clear, quiet intro, muted on/off, preference reload and missing-API behavior. All six scenarios have zero final application errors or fixture misses. The polished 320px Settings target is inspected separately.
- The production build passes four phone/WebKit settings/clear scenarios. Two installed develop-web-game movement/jump iterations pass with inspected screenshots/text and no error files.
- Two new phone scenarios in both engines expand hosted mobile coverage from 54 to 58 cases. All four targeted production-test-build cases pass locally, with no application errors or fixture misses.

Browser tests record requests to the vibration method; they do not simulate a physical motor. A physical Android feel check remains manual. Existing F089 physical iOS follow-ups remain separate.

Ignored evidence: `output/f090-2026-10-17/`. Early probe setup made the method read-only, which blocked Phaser’s existing normalization; the probe is now writable. A test fixture’s private-method intersection and dynamic getter were corrected. New mobile cases exposed four missing diagonal-room reads; they now reuse the existing isolated neighbor fixtures. Desktop WebKit reports aborted image/audio decodes as CORS errors during reload; unchanged main reproduces this. The first hosted run passed all 58 scenario assertions but WebKit reported 15 aborted image-decode errors during the reload case. Reload audits now wait for the existing delayed sound warmer, network requests, actual image-decode promises and map queues to settle; network-idle alone did not cover blob decoding. These synthetic haptic scenarios also opt out of unrelated session-replay uploads, whose unload request can be aborted by reload. Errors are not filtered or ignored.

## Delivery boundary

Source acceptance is complete. Public-source scan, exact-source and merged-main hosted checks, approved merge, guarded Pages-only release, canonical/immutable asset proof and final live checks follow; their final PR description and ignored receipt supersede this source-time pending note.

No API Worker, D1 migration, PartyKit, room data, world renderer, money flow, selected animation or decision-gated work changes. Browser checks keep API writes intercepted and do not submit publishing, sign-in or destructive actions. The dirty primary checkout is preserved. The overnight goal remains closed and its cutoff heartbeat paused.
