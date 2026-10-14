# F173 — Comfort settings and a remembered camera choice

Candidate prepared during the approved overnight checklist. Publication and live verification are pending.

Settings now starts with a Comfort section. **Reduce motion and flashes** offers **Use system setting**, **On** and **Off**; **Camera** offers **Follow player** and **Whole room**. Choices are remembered on this device, like its performance and frame-rate settings. The default follows the system's reduced-motion preference and keeps the player-follow camera. Account settings and authentication are unchanged.

The motion choice controls the existing gameplay gates for combat/stomp shake, PvP full-screen flash/shake, flickering lights, comment motion and reward/XP animation. System changes update the effective choice without a reload. CSS and gameplay share the same preference; Off can override a system motion reduction. Room-camera transitions snap immediately with reduced motion enabled.

Whole room uses the existing room-centered camera framing. It stays steady while the player moves and fits the current room on portrait screens. Follow restores tracking. Rooms authored with a fixed camera keep their framing; this preference does not rewrite room data or turn the stationary Inspect mode into a user setting. Camera settings use scalar getters in the play loop.

![Comfort on phone](assets/wamp-comfort-phone-2026-10-13.png)

Verification: all 3,538 tests and full quality gates pass. Native desktop/Chromium phone/WebKit phone checks cover real settings controls, 44px targets, no horizontal overflow, saved choices after reload, live system changes, whole-room movement, restored Follow, and PvP/reward effects with On/Off. Screenshots were inspected; Camera label contrast and Safari's short native menu were corrected. The installed game client exercised movement/jump in a published safety room without runtime error files. The existing authored-room camera smoke also passes editor save/reload, framing during movement/zoom input, portrait resizing, neighboring-room transition and respawn. Evidence: `/tmp/wamp-f173-2026-10-13/`.

These are browser/device-emulation checks, not a new hands-on iPhone check. The safety welcome room is absent, so the game client used published room `1,-14`; controlled camera checks used an isolated synthetic editor room and blocked API mutations/socket traffic. Startup JavaScript remains below the 670KB brotli gate (649.6KB in the first full build; final receipt follows publication).
