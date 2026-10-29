# Next 28 Round 2 items — active goal, 2026-10-29

Scope: complete and verify all 28 items discussed with Jonathan. Use the fact-checked
findings and current code, preserve real per-kind behavior, and record delivery
receipts in the main Round 2 checklist. An implementation or green local test alone
is not delivered completion. This tracker remains active until all 28 are verified.

Jonathan explicitly approved:

- F479: Protected Explore sort is for wallet-connected visitors only. Keep
  permission/protection behavior while removing unnecessary crypto payloads for others.
- F263: retire the old Mac avatar queue, including its manual queue processor.
  The Cloudflare queue and avatar feature continue.
- F436: automatic weekly Room Rush/Build Prompt scheduling, with manual overrides.
- F253: give Clear Layer an accessible home on phone and desktop, then remove old UI.
- F264: drop all three retired tables through the migration workflow.
- F439: guests get fixed emotes; students may emote within their own classroom.

Do not ask again for these decisions. Keep Featured version pins unless a separate
carry-over policy is approved (F447's corrected scope is notifications and warnings).
Retain music helpers needed by planned neighbor matching; preserve useful avatar
source assets outside production rather than discarding them blindly.

## Delivery tracker

F263 is first because Jonathan specifically requested it now. Then resume the
suggested order below. No item is checked until its actual delivery is verified.

- [x] F273 — shared progression/rating/verification core; PR #335, all CI and live rollout verified.
- [ ] F274 — share editor input and camera behavior.
- [ ] F275 — share object-inspector controllers and correct drift.
- [ ] F334 — reuse cached map artwork for share previews, with fallback.
- [ ] F269 — real-art Expanded Room and Wamp-O-Gram previews.
- [ ] F389 — correct standalone share-image backgrounds, custom art and geometry.
- [ ] F436 — automatic weekly event scheduling with overrides.
- [ ] F428 — ghost challenge links carrying the shared run.
- [ ] F429 — Keep Playing to another unbeaten room.
- [ ] F435 — cleared-room markers on the world map.
- [ ] F447 — builder recognition notifications and republish warnings.
- [ ] F451 — preserve equivalent-version insights and compare gameplay changes.
- [ ] F381 — builder-visible World approval state, results and reasons.
- [ ] F253 — accessible Clear Layer and retire hidden editor UI.
- [ ] F479 — wallet-only Protected sort and appropriate non-wallet payloads.
- [ ] F439 — fixed guest emotes and classroom-scoped student emotes.
- [ ] F262 — idle/gate hidden Camera Tuner while preserving CI coverage.
- [ ] F264 — remove retired difficulty-vote, Play.fun sync and attribution tables.
- [ ] F265 — retire unused admin APIs/reporting and avoid server self-fetch.
- [ ] F261 — remove unused render helpers and retire obsolete share page.
- [ ] F259 — remove production clutter and keep developer/source assets appropriately.
- [x] F263 — retire obsolete Mac avatar queue; PR #334 merged, all 18 CI jobs passed.
- [ ] F257 — unused-helper cleanup and complete boot diagnostics correctly.
- [ ] F255 — retire unused Cyber resolver while preserving live pieces/tests.
- [ ] F260 — unused music-code cleanup, preserving planned/live helpers.
- [ ] F258 — unused streaming APIs and aliases, with caller updates.
- [ ] F266 — remove unused map coverage helpers/tests.
- [ ] F254 — obsolete CSS cleanup and regression guard.

## Current boundary

Baseline: main `417f0ca7`, Round 2 72/248. F263 delivered in PR #334
(merged `b27f2ca9`), so this goal is **2/28 delivered** and Round 2 is **74/248**.
F273 delivered in PR #335 (merged `229df2c6`), all 18 CI jobs passed. API Worker
`29b0b3e2-41b8-425d-97e6-78f64c875473` serves 100%; production smoke passed,
migration 0076 verified. F274 is in progress; the other 25 goal items remain pending.
