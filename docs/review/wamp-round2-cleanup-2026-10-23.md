# Round 2, step 7: clean-up sweep — 2026-10-23

Delivers round-2 items F252, F387, F256, F486 and F493, and the safe parts of F264 and F272. PartyKit is retired, a batch of dead Worker code is gone, and the run logs stop colliding. F253 (the old editor layout) waits on where Clear Layer should live. The dead-code baseline and file-size limits (F497, F498) followed in #321, once the code was smaller.

| Item | PR | What changed |
|---|---|---|
| F252 | [#318](https://github.com/songadaymann/wamp/pull/318) | Local presence types replace PartyKit's, and the 141 MB PartyKit dependency, its config and its scripts are gone (`node_modules` 1.1 GB to 991 MB). Local presence runs through `wrangler dev`. |
| F387 | [#318](https://github.com/songadaymann/wamp/pull/318) | Safety previews take their presence host from the safety Worker. The production smoke now fails if a startup script names `partykit.dev`. |
| F493 | [#317](https://github.com/songadaymann/wamp/pull/317), [#318](https://github.com/songadaymann/wamp/pull/318) | Agent docs point at the round 2 checklist, the ledger and the receipts. The round 1 checklist starts with its title again, and the presence docs describe the API Worker's Durable Object. |
| F486 | [#317](https://github.com/songadaymann/wamp/pull/317) | progress.md and the long ledger are archived in `docs/history/`. The ledger is one row per delivery, built from one file per entry in `docs/ledger/`, so parallel PRs don't conflict. |
| F256 | [#319](https://github.com/songadaymann/wamp/pull/319) | About 494 lines of uncalled Worker code are removed, mostly the retired difficulty-vote system. |
| F264 (steps 1–2) | [#319](https://github.com/songadaymann/wamp/pull/319) | Admin clears, the test reset and the safety snapshot no longer touch the two frozen tables; their rows still go through `ON DELETE CASCADE`, pinned by a test. Publishing stops writing `room_version_attribution`, which nothing reads. |
| F272 (step 1) | [#319](https://github.com/songadaymann/wamp/pull/319) | The write-side leaderboard checks for legacy Play.fun accounts are removed, saving one D1 round trip per run start and finish. They could no longer return true. A contract test pins the sign-in paths they relied on. |
| F497 | [#321](https://github.com/songadaymann/wamp/pull/321) | A committed knip baseline (786 findings). The required `quality` job fails on any new unused export, type, file or duplicate, and says how to fix it. |
| F498 | [#321](https://github.com/songadaymann/wamp/pull/321) | Max-lines pins match each file's real size, with 25 lines of slack, which removes 2,068 lines of room to regrow. A test stops pins drifting up. |

## Release

- API Worker `b5007f4b`, deployed from main `82fe23ae`. #321 (F497, F498) is CI and lint only, so it needs no deploy. The production smoke passed, including the new `partykit.dev` check. No migration.

## Checks

- #319 was reviewed adversarially. The review confirmed in code and in production that the 298 legacy accounts have no sessions, tokens or runs, and that the frozen tables cascade (foreign keys are on in production, with no orphan rows).
- `npm run check` passed on each PR: 684 files and 5,764 tests on #317, 682 and 5,755 on #318, 684 and 5,759 on #319. The 133 presence tests passed.
- #321: `npm run check` passed (688 files, 5,779 tests). It was rebased onto #320 so that PR's code is in the baseline; `npm run dead-code:check` found nothing new.
- Muted `smoke:progression-rating`, whose socket stub changed, passed against a local Worker. `smoke:wampos-window` fails on an editor tool-state check, the same way on main and before #316, so it was already out of date.

## Waiting on Jonathan

- **F497 follow-up:** whether to run the 782-item export sweep. 568 items only need `export` dropped and 214 are unused. It touches hundreds of files, so pick a quiet moment for the other lanes.

- **F264:** whether to drop the two frozen tables. Production rows: `room_difficulty_votes` 68, `playfun_point_sync` 3,713. `room_version_attribution` (3,206 rows, no longer written) could go too.
- **F272 step 2:** a policy decision on the read-side filters. Generated-only accounts still earn builder rewards when real players clear their rooms: 13 of them published 2,514 room versions. Step 2 should cover that path.
- **F253:** where Clear Layer should live.
- Update `~/.codex/skills/develop-web-game/SKILL.md` (lines 28 and 133–139) to add a `docs/ledger/` file and run `npm run ledger` instead of editing the old logs.
- Confirm `VITE_PARTYKIT_HOST` is unset in the Pages dashboard. The live build names no `partykit.dev`.
