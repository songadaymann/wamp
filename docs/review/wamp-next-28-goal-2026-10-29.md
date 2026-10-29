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
- [x] F274 — shared workspace input/camera controllers; PR #336, 244 browser scenarios, all CI and live rollout verified.
- [x] F275 — shared inspector action/overlay core; PR #337, all CI and live rollout verified.
- [x] F334 — cached map artwork for API/Pages shares and Expanded composites; PR #338, all CI and live rollout verified.
- [x] F269 — real-art Expanded Room and Wamp-O-Gram previews.
- [x] F389 — correct standalone share-image backgrounds, custom art and geometry.
- [ ] F436 — automatic weekly event scheduling with overrides.
- [x] F428 — ghost challenge links carrying the shared run; PR #342, all CI and live rollout verified.
- [x] F429 — Keep Playing to another unbeaten room; PR #343, all CI and live rollout verified.
- [x] F435 — cleared-room markers on the world map; PR #344, all CI and live rollout verified.
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

Baseline: main `417f0ca7`, Round 2 72/248. F263(PR334), F273(PR335), F274(PR336),
F275(PR337) and F334(PR338, merged `a1470b35`) are verified delivered.
This goal is **10/28 delivered**, and Round 2 is **82/248**.

F334 passed all 18 GitHub jobs, full 722-file/6,154-test check and native
workerd/D1/R2 probes. Guarded full rollout and production smoke passed. Worker
`301ccc79-d40d-4fa0-92a6-99bbf9004902` serves 100%; production entry and editor
bundles match release bytes. Live API/Pages/image checks cover a map leaf,
two Expanded composites and two exact-version fallbacks. Migration 0076 remains
current. Receipt: `docs/review/wamp-f334-cached-share-artwork-2026-10-29.md`.

F269/F389 are delivered through PR339 (91432ef3) and PR340 (0e63c3a8).
Both passed all 18 GitHub jobs. The guarded rollout and production smoke passed;
Worker37075601-f3e9-437c-b0dd-8f70568db9ba serves 100%, Pages028aee15 and live
entry/editor/runtime bytes match the release. Existing Expanded fallback links
use renderer=assets-v6 and return real-art pixels; cached composites retain their
exact bytes. Native workerd/D1/ASSETS verification covers share/Gram pixel parity,
moderation cache policy, deletion and HEAD. Migration0076 remains current.
Receipt: `docs/review/wamp-f269-f389-shared-real-art-previews-2026-10-29.md`.

F428 is delivered through PR342 (a36493f9): all18 GitHub jobs, full722-file/
6158-test check, native workerd/D1 and real browser challenge/restart flows pass.
Guarded rollout/production smoke passed; Worker2eefd05a-072e-4dc8-af7e-1532e2314e00
serves100%, Pages1207b5b3 and live browser assets match the release. Three existing
public run invitations return their exact ghosts, personal ghosts remain private,
and the public invitation retains its challenge parameter. No migration or
production player/room writes. Receipt: `docs/review/wamp-f428-ghost-challenge-links-2026-10-29.md`.

F436 automatic weekly events remains a draft (PR341) pending prompt-content
approval. F429 Keep Playing is delivered through PR343 (a4ac21ea): all CI, full725-file/
6171-test check, six keyboard scenarios and native desktop/phone flows pass.
Worker c0ad084a serves100%, Pages60aa95e9 and live assets match the release.
Production smoke passes. F435 cleared-map markers are delivered through PR344 (2bd76733): all20 checks,
full728-file/6186-test check and native account/phone/history flows pass. Worker
e6f01c31 serves100%, Pages5c0b2569 and live assets match the release. Private
progress is session-owned; public historical geometry exposes no personal state.
Production smoke passes. F447 recognition notices and republish warnings are
in progress. The remaining18 items stay open.
