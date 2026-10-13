# Room-entry keyboard freeze — 2026-10-12

Original prompt: "there seems to be a new bug that got introduced. Occasionally, when i enter a room, i cannot move at all. refreshing usually helps."

## Plan and result

- [x] Preserve the stale dirty primary; investigate current main in an attached clean worktree.
- [x] Reproduce the freeze and identify the state that persists.
- [x] Restore keyboard state for paused scenes and add lifecycle regression tests.
- [x] Verify actual movement and jumping after mouse/Enter Start and repeated room entry.
- [x] Commit the verified local candidate; production delivery awaits an explicit release request.

## Cause and fix

The October 11 dialog keyboard changes disable scene keyboards while a modal is open. A room intro also pauses its scene. When Start closes the modal, MutationObserver/focus updates can run before Phaser processes the queued resume. The active-only scene lookup therefore skips the paused scene and never re-enables its keyboard. Physics and the player continue, while movement keys have no effect.

`syncGameKeyboardFocus` now updates every scene keyboard, including paused scenes. Existing rules for dialogs, text fields and keyboard-focused controls are retained. No changes to room data, movement physics or visual design.

## Evidence

Local baseline in `output/web-game/room-entry/baseline.log`: after Start, OverworldPlayScene is active with keyboard disabled; ArrowRight leaves player x at -6952. Fixed log: keyboard enabled; same input moves x to -6917.

`npm run smoke:room-entry-keyboard` uses current published tutorial content read-only, blocking run/draft writes. Six scenarios (mouse/Enter Start, three consecutive entries each) move 30–43px and jump 20–30px, with zero page exceptions. Screenshots were inspected. Report: `output/web-game/room-entry-keyboard/report.json`.

The standard web-game client ran and observed movement; its eventual capture had an unrelated automatic performance prompt. Dedicated regression disables that automatic suggestion using the existing full-quality preference, and its gameplay captures were inspected.

The older `smoke_first_play_controls` script passes its initial movement/jump checks but stops at "Acknowledged controls interrupted repeat Play". Current scene policy shows race-capable room intros on repeated entry (`supportsGhostRace`); the new regression exercises those repeated prompts directly. This older smoke assertion was not changed.

Two new unit regressions cover both dialog-close-before-resume and pause-before-dialog-open timing; the four focused suites pass 27 tests. Targeted lint, TypeScript, full-suite and production-build results are recorded in the final validation below.

No merge, push, deploy, account change or published room write. The unrelated primary checkout remains untouched.

## Final validation

- All 457 unit-test files / 3,482 tests pass.
- Targeted ESLint, TypeScript, `git diff --check`, production build and startup bundle budget pass.
- Six browser regression scenarios pass with zero page exceptions; movement and jump screenshots inspected.
- Reusable probe: `npm run smoke:room-entry-keyboard -- http://127.0.0.1:3051`.

The initial full-suite run correctly rejected the new unregistered smoke entry. Adding its package command and Knip entry resolved the contract failure; the entire suite then passed.
