# F177 — Custom keyboard controls

Canonical branch: `codex/wamp-keyboard-controls-2026-10-19`, from delivered F172/PR247/main `5a187380`.

The active checklist goal authorizes implementation, verification and deployment one item at a time. The former October15–16 cutoff remains closed and paused.

## Plan and behavior

- Use physical `KeyboardEvent.code` for movement, jumping, combat and camera input. Preserve Arrows/WASD/Space/Q/E/9 and add Z jump / X slash. Up remains the existing combined climb/jump action, including directional gravity mechanics; dedicated Jump remains separately configurable.
- Offer Change for all ten actions, including Restart run and Return to browse, in the existing Controls dialog. Changing an action replaces its aliases; conflicts are explained without silently changing another action. Restore defaults recovers the complete map. Escape always remains available to leave play or close a dialog; during key capture it cancels capture first. Tab cancels capture and continues navigation. T/C remain chat/comments and 0 fits the map; browser/system shortcuts and focus navigation are reserved.
- Store complete normalized maps on this device, independently of account settings. Corrupt, partial or conflicting stored maps fall back atomically to defaults; blocked storage retains session settings. Labels use the browser's keyboard layout map where available, with explicit physical-position wording otherwise. Intro hints use the same current map.
- Keep command actions at the existing HUD command bridge and collect gameplay separately. Observe releases while inactive; clear held and pending input on remapping, window blur, scene pause/sleep, hidden tabs, lost keyboard ownership and shutdown. Native text/forms/dialogs keep their keys. Preserve abstract ranked traces, touch and gamepad input.
- Verify default/physical AZERTY and remapped keys, all ten actions, conflicts/cancel, local persistence/reset, focus/blur/lifecycle, ordinary/Expanded Room flows, narrow Readable/Large layouts and Safari. Run full quality, native/installed-client checks, hosted source/main gates, public-source scan, guarded clean-main Pages-only release and actual-domain proof.

Local source acceptance is complete. Hosted source/main gates and production delivery are pending; no F177 push, merge or deployment is claimed. Master is163/216 at source acceptance. Worker/schema/presence/renderer and the chosen background remain unchanged; preserve the unrelated primary checkout and TAS lab.

## Delivery of the previous item

F172 is fully delivered through PR247/main `5a187380`, production Pages `91fa1632`. All seven source/main hosted checks,4,017 full tests,66 mobile cases, nine maintained Assist cases, eleven strict native/live Assist cases,27 exact matching release assets and actual published-room pause/resume pass. API Worker `cca96be2-13d7-42a2-841e-987b4e65630a` remains at100%; no migration or presence/renderer deployment was required. This supersedes F172's source-time pending delivery notes.


## Local source acceptance

- Full quality passes551 files/4,029 tests, lint, shared styles, typing, generated bindings, DOM contracts, production build and PNG/tree/audio checks. Startup is645.6KB Brotli under670KB. The scene-size guard is unchanged.
- Six strict browser scenarios pass: ordinary and Expanded Rooms on desktop Chromium,320px Chromium and390px WebKit, all with Readable/Large text. Each changes and exercises all ten actions, default Z/X, physical AZERTY movement without accidental slash, conflict/cancel, intro hints, reload persistence, restore defaults, blur release and fixed Escape. Zero application errors or fixture misses; captures were inspected.
- Focused model/input/command cases prove atomic corrupt-map fallback, storage denial, layout labels, alias consumption, modifier/native ownership, pending-input reset and complete scene lifecycle cleanup. Touch/gamepad movement and physics tests remain intact.
- The installed game client completed two movement/jump iterations using a custom jump binding, with inspected captures and no captured application errors. An additional inspected airborne capture confirms the custom B jump; a further desktop Expanded Room case explicitly proves the restart clock resets as the player respawns. Exact hosted source/main/mobile checks follow.
- Retained diagnostics are excluded from acceptance: initial narrow large-text clipping was fixed in the Controls layout; the desktop restart timeout came from replaying an unrelated negative-coordinate window and was resolved by serving the exact requested rectangle, without changing the production restart path; the new executable smoke root is registered in the existing audit configuration.
- Both unrelated dirty checkouts and the selected animated background match their preservation snapshot. Evidence is ignored under `output/f177-keyboard-2026-10-19/` with quality logs in `output/f177-*.log`.


## Hosted verification follow-up

PR248's first source run39256905685 passed quality,66 mobile cases, Expanded Room leaderboards, Assist and both Pages builds. Its two failures are retained in ignored diagnostics: a140ms wall-clock AZERTY hold moved only two pixels on the slow hosted browser, and the pause probe found native menu focus could remain after Phaser cancelled the canvas pointer's normal focus change.

Canvas clicks now explicitly blur the previous menu/form control and synchronize keyboard ownership. A focused unit case preserves other canvases' focus. The six native pause scenarios and six remapping scenarios pass with this source fix; two additional desktop cases and all six pause cases explicitly force menu focus before clicking back into gameplay. Probes now wait for actual physics progress, observe transient jump/combat actions inside the browser frame, and require a real restart clock reset. The final strengthened six-case replay and exact-head hosted gates follow.

Full follow-up quality passes551 files/4,029 tests and all existing gates, with startup645.6KB Brotli. No production release is claimed yet.
