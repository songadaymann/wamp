# Cheat cleanup takes back what removed runs earned (F205) — 2026-10-21

Delivers the rest of withheld item **F205**. The busy-room clear fix shipped earlier in PR #174.

## What changed

Invalidating runs on the suspicious-activity page used to delete only the runs and their points, so a cheater kept their XP levels, hidden trust, badges, ratings and any trophies their ratings produced. [PR #284](https://github.com/songadaymann/wamp/pull/284) adds `src/cloudflare/worker/admin/invalidationProgress.ts`:

- **Planned before the delete, applied in the same batch.** It asks which accepted clears remain without the removed runs.
- **Rank rewards** (top 10 entry/improvement, taking #1) name the run itself and always go.
- **Clear rewards** are keyed by content and version, not by run. So first-clear XP, clear trust, the builder's unique-player XP and trust, and the player's room ratings with their rewards go only when the player has no other accepted clear of that room left, in any version, counting claimed guest clears. Personal-best and daily-room XP also need no clear left that day. This never removes a reward a legitimate clear still earns, at the cost of sometimes leaving some behind.
- **Totals** lose only the events still present when the batch runs, so two overlapping invalidations cannot subtract twice. XP seeded when a progress row was first created is not touched.
- **Badges** (play, builder and curator) are revoked only when this cleanup took them below their threshold; badges that had already lapsed for other reasons stay. Badge counts are refreshed.
- **Trophies** held up by removed ratings are recomputed.
- **Expanded Room runs** are matched to the legacy course ids their rewards use. Their ratings are left in place.
- The admin preview shows the XP, trust and ratings that will go; the result and audit keep the full list. The finish step runs last and logs instead of failing, since everything in it can be recomputed.

## Release

- No migration. API Worker `723f525c` deployed from the branch (main `5511a5ea` + this change); `/api/health` and `scripts/smoke_prod.mjs` pass.
- PR #284 merged as main `5d9d7ce0` after all 19 CI suites passed; the deployed Worker tree matches main.
- `npm run check`: 617 test files, 5,271 tests; boot JavaScript 660.8 KB brotli.
- New tests drive the real award and rating code on the migrated schema: full rollback when no clear remains (back to the player's starting totals plus the weekly rewards that stay), partial rollback when a legit clear remains, rejected runs not counting as clears, claimed guest clears, overlapping invalidations, lapsed badges left alone, and Expanded Room id matching.

## Adversarial review

Eight findings, all fixed before release: Expanded Room runs keyed under the wrong id, too many queries per run (now grouped and planned once per request), badge revocation hitting badges that lapsed for unrelated reasons, the finish step running before Expanded Room runs were removed, guest-claimed clears not counted, exact-version checks inside a shared reward window, double subtraction under overlapping invalidations, and daily-room XP not rolled back.

## Not done

- Expanded Room ratings and their rewards stay after an invalidation.
- An invalidation touching many distinct rooms runs several queries per room; very large selections may need to be split.
