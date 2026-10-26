# F333: faster run finishes — 2026-10-24

Implemented on `codex/f333-finish-waits-2026-10-24`, based on current main `b2509e99`. The change is awaiting review, merge and an API Worker release. No migration is needed. F333 stays unchecked until delivery.

## What changed

Independent reads now run together: sign-in and the run lookup; the three leaderboard queries; progress and trust checks; and the finalized run and earlier clears. The finalized run carries its stored commit order, so rewards still use the order runs committed rather than the order requests arrived.

The verification audit and settlement run together, as do the personal-best ghost and daily-clear work. The reply waits for these steps, and concurrent failures keep the original error priority. Existing reward work still continues through `waitUntil`, and retries keep the same result and award each event once.

Room Rush loads its start and saved result in one database batch. A duplicate submission sees both from the same transaction; a used start also gets a saved-result recheck before a conflict. Guest finishes read their final row inside their update batch. Course records and versions also load in one batch.

Requests without credentials still return 401 without a database read. Earlier validation errors retain priority over failures from reads started beside them. A new player's progress row still exists before a daily clear adds to its totals.

## Measured database waits

The same five cases ran against unchanged main and this branch. They count dependent database waits before the reply, with independent operations sharing one round. These are local dependency counts, not production response-time measurements. The player already has a progress row and the room's ranking facts are cached.

| Finish | Main `b2509e99` | F333 |
|---|---:|---:|
| Verified room clear | 17 | 7 |
| Resend of a counted room clear | 4 | 3 |
| Verified Expanded Room clear | 23 | 11 |
| Room Rush save | 9 | 5 |
| Verified guest clear | 5 | 4 |

The run reload and post-finalize earlier-clear queries remain: dropping them would weaken F351's race and first-clear guarantees. The redundant generated-account gate identified in the original finding was already removed from these paths on main.

## Checked

- All five baseline timing cases passed against unchanged main.
- The focused finish, retry and deferral suites passed: 4 files, 38 tests. The 19 F333 cases include delayed duplicate Room Rush requests, competing guest finishes, failed audit writes, ordered errors, signed-out requests and daily-clear totals for a new player.
- The compiled API Worker passed eight isolated checks in workerd with native D1: normal and guest clears, their resends, signed-out finishes, four concurrent Room Rush submissions saving once, and a later duplicate returning the saved result. No production requests or outbound calls were made.
- `wrangler deploy --dry-run --outdir output/f333/api` passed using the installed Wrangler 4.71.0; nothing was uploaded.
- The public-repo check passed with zero blockers and zero warnings.
- A muted Chromium boot and short movement check passed on a local build using recorded API responses. The screenshot and game state were inspected; graphics were healthy, with no console errors or missing fixture requests. This check covers the game UI; the native Worker checks above cover finish requests.
- `npm run check` passed: 704 test files, 6,021 passing tests, 9 expected failures, 2 skipped tests and 1 todo. Lint, dead-code, type, DOM, generated-binding, production-build, size and asset checks passed. Boot JavaScript is 665.7 KB brotli against the 670 KB limit.

Local evidence is in ignored `output/f333/`. The source commit `da3eca94` and the parked review patch were recovered into this worktree; the original worktrees were left intact.

## Delivery still needed

After review and green CI, merge and deploy the API Worker from clean main, then run the production smoke and health check. Check F333 off, update the round-2 progress count, and add its delivery ledger entry with the PR and release receipt.

## Resumed verification — 2026-10-26

Dropbox's `codex/f333-finish-waits-2026-10-24` still points to `d6c989b3`,
the review-fix commit after the handoff. Both it and its source commit were
already present under the recovered Git refs. They were cherry-picked onto
current main `67435449`, preserving the Cloudflare email migration.

Current verification:

- `npm run check` passed: 705 test files, 6,028 passing tests, 9 expected failures,
  2 skipped tests and 1 todo. The five measured dependency counts remain 7, 3,
  11, 5 and 4 respectively.
- `npm run smoke:worker-safety` initially exposed an outdated fake that discarded
  batch SELECT results. The fake now returns those results in D1's shape, and
  the probe also checks that a duplicate Room Rush submission returns the saved
  attempt without adding a second run. The updated probe passes.
- The production Worker dry-run passed with the Cloudflare email binding intact.
- Fresh isolated workerd/native-D1 checks passed for a verified room clear and
  retry, signed-out finish rejection, four concurrent Room Rush submissions
  saving once, and a later duplicate replaying that saved result. All data was
  local; no production writes or email sends were used. The unused optional
  Resend React renderer was stubbed in this local harness.

Fresh local evidence is in ignored `output/f333-current/`. Delivery remains
pending until the current PR's checks pass, it is merged and the API Worker is
released.
