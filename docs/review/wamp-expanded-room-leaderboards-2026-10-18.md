# Expanded Room leaderboards — F250

October 18, 2026. Source accepted; push, merge and guarded production delivery pending.

## What was missing

The existing Leaderboard action preferred the individual cell board over the whole Expanded Room board. Native identities were not recognized without an old course identifier, and the general Leaderboards footer disappears during Play. This made populated whole-room boards appear missing. Goal-less rooms also looked like unavailable or empty rankings.

The selected-cell context now carries native identity and goal metadata. Any published Expanded Room cell opens its whole-room board and disables the ordinary-cell tab. A Room Leaderboard menu action works during Play, including the first lazy load. Ordinary standalone aliases retain their ordinary room board. Active play keeps the exact whole-room version; Browse loads the latest published version. No cell-version number is substituted for a whole-room version.

Refresh and open bypass the client and browser leaderboard caches. Post-clear refresh does the same. Old requests cannot replace a reopened Expanded Room board. A failed read has a retry and does not claim the board is empty. Rooms without goals explicitly explain why clears are unranked. Empty boards explain that signed-in solo clears rank; guest progress continues to save through its existing system.

The existing modal owns its tab/loading/render lifecycle; a small target collaborator owns identity and repository routing. Existing ranking, verification, guest progress and data schemas remain unchanged. There is no background polling or presence change. Release scope is Pages only.

## Verification

- Full local check:538 files /3,973 tests pass, plus styles, lint, types, DOM contract, generated bindings, production build, bundle budgets and asset manifests.
- New SQLite checks use the actual ranking SQL: one best valid completed clear per player; whole-room/version isolation; invalid, active, failed and timed-out runs excluded; deterministic time/score/death ordering; saved best and viewer rank update.
- Target/context/cache tests cover native and old identities, nonentry cells, playing-version preservation after republish, standalone aliases, no-goal eligibility, errors and fresh results replacing an empty cached board.
- Nine browser scenarios: native/legacy/no-goal on desktop Chrome, phone Chrome and phone WebKit. Real Browse Warp from the nonentry cell, whole-room board default, Play menu access from the entry cell, exact v4 rather than cell v12, refresh/empty/error/recovery, and close/reopen with a delayed stale response. No application errors or missing fixtures. Screenshots inspected.
- Production read-only audit:all27 boards,125 published cells.23 goal boards return200;4 no-goal boards return their expected404.21 boards already have ranked clears and2 are empty. Native/legacy distribution20/7;zero completed old-course attempts are missing from the Expanded Room run store. All cells resolve to their whole-room identity. No test clears written to production.
- Installed web-game client:two movement/action iterations with inspected screenshots and captured game state. Initial harness fixture/selector diagnostics retained separately in ignored output.

Evidence:ignored `output/f250-expanded-leaderboards-2026-10-18/`. Primary checkouts, selected animated background and user TAS lab are preserved. Source/main hosted gates and final live receipt will be recorded on the pull request.
