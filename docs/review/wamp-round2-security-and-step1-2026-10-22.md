# Round 2: same-day fixes and the security batch — 2026-10-22

Delivers round-2 items F374, F485, F388 and F251 (step 1 of the suggested order) and sixteen security items: F407, F408, F409, F410, F411, F413, F415, F417, F419, F420, F421, F422, F425, F426, F427 and F382. The other round-2 security items stay withheld; most need a decision from Jonathan.

## Step 1

- **F374, stale tabs after a release** ([PR #288](https://github.com/songadaymann/wamp/pull/288)). When a tab can't download a file it needs, it checks whether its own build is gone. If it is, a "WAMP was updated" card offers Reload. The card waits until no save or question is on screen, and the tab never reloads by itself. The Room Rush result dialog now downloads together with the Rush dialog, so a finished Rush can always send its score.
- **F485, Node 22** ([PR #289](https://github.com/songadaymann/wamp/pull/289)). `.nvmrc` is 22.22.0, `package.json` requires Node 22.13 or later, and every CI job reads `.nvmrc`. Cloudflare Pages now builds on Node 22.
- **F388, logs** ([PR #290](https://github.com/songadaymann/wamp/pull/290)). Every line the Worker's code writes is kept again. Cloudflare's automatic per-request records stay off; they were the cost the 1% sampling was meant to cut.
- **F251, dead fetch** ([PR #291](https://github.com/songadaymann/wamp/pull/291)). Entering a goal room no longer loads the unused global top 5. 197 lines of dead summary code are gone with it.
- **F379** (Expanded Room cells changed in another tab) is not done yet. The first version could block Publish, so it was reworked and is being reviewed again ([PR #292](https://github.com/songadaymann/wamp/pull/292), draft).
- **F483** (branch protection on main) needs Jonathan to approve a GitHub setting.

## Security batch

[PR #294](https://github.com/songadaymann/wamp/pull/294), one commit per item plus seven follow-ups from review. The fixes went live with API Worker `1f46f6bf`, deployed from the branch before the PR opened. API Worker `073f68a2` was then deployed from main after all six PRs merged, which also applied F388's log settings. No migration. Each item's line in the round-2 checklist says what changed and what's left.

Two adversarial reviews ran before release. They found eleven problems, all fixed before the PR. The most important was in F420 itself: its new chain-read budget would have let a room's previous owner keep editing it after a sale. That case now gets a 429 instead of falling back to the stored owner.

## CI

From Oct 21, GitHub's Ubuntu package mirror took 8 to 30 minutes to install Playwright's system packages. Every browser check was cancelled before it ran a test. [PR #293](https://github.com/songadaymann/wamp/pull/293) runs those 14 jobs inside Microsoft's Playwright 1.59.1 image instead. Setup now takes seconds, and the jobs finish in 2 to 8 minutes. The map-capture smoke checks its zip with Node, because the image has no `unzip`.

## Checks

- `npm run check` on the security branch: 626 files, 5,359 tests, boot JavaScript 662.5 KB brotli.
- Step-1 branches together: 5,283 tests.
- Live probes after the deploy: the sprite usage check works, an oversized error report gets 413, and PvP result and Wamp-O-Gram posts without sign-in get 401.

## Only Jonathan can check

- Play one real PvP match between two accounts.
- Sign the guestbook once (Turnstile).
- Send a Wamp-O-Gram of your own published room.
- Keep a tab open across a release, then click Build; the update card should appear.
- Look at Worker log volume in the Cloudflare dashboard after a few days.
