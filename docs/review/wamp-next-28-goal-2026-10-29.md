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
- [x] F447 — builder recognition notifications and republish warnings; PR #345, migration/CI/live rollout verified.
- [x] F451 — matching-version insights, layout comparison and map switching; PRs #346/#347, CI/live latency verified.
- [x] F381 — World review statuses/reasons, saved-draft synchronization and decision emails; PR #348, CI/live verified.
- [x] F253 — accessible Clear Layer and retire hidden editor UI; PR #349, CI/native/live frontend verified.
- [x] F479 — wallet-only Protected sort and appropriate non-wallet payloads; PR #350, CI/native/live verified.
- [x] F439 — fixed guest/classroom emotes; PR #351, native/CI/live verified.
- [x] F262 — idle/gate hidden Camera Tuner while preserving CI coverage.
- [x] F264 — remove retired difficulty-vote, Play.fun sync and attribution tables.
- [x] F265 — retire unused admin APIs/reporting and avoid server self-fetch.
- [x] F261 — remove unused render helpers and retire obsolete share page.
- [x] F259 — remove production clutter and keep developer/source assets appropriately.
- [x] F263 — retire obsolete Mac avatar queue; PR #334 merged, all 18 CI jobs passed.
- [x] F257 — unused-helper cleanup and complete boot diagnostics correctly.
- [x] F255 — retire unused Cyber resolver while preserving live pieces/tests.
- [x] F260 — unused music-code cleanup, preserving planned/live helpers.
- [x] F258 — unused streaming APIs and aliases, with caller updates.
- [x] F266 — remove unused map coverage helpers/tests.
- [x] F254 — obsolete CSS cleanup and regression guard.

## Current boundary

Baseline: main `417f0ca7`, Round 2 72/248. F263(PR334), F273(PR335), F274(PR336),
F275(PR337) and F334(PR338, merged `a1470b35`) are verified delivered.
This goal is **27/28 delivered**, and Round 2 is **99/248**.

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
Production smoke passes. F447 recognition notices and republish warnings are delivered through PR345
(f5ae30a8): all20 checks, full732-file/6210-test check and native desktop/phone/
new-tab flows pass. Migration0077 retained all1748 old Activity rows and their
sequence; Worker0bada192 serves100%, finalPagesc8dc1091 and live assets match.
Production smoke/private-read/public-feed checks pass.

F451 is delivered through PR346/e49bc683 and the indexed-query correction
PR347/24c6e51a. Both passed all20 checks; final full734-file/6223-test check,
native desktop/phone comparisons and map switching, and215-version cold history
pass. Initial live latency exposed a global facts scan; the prior Worker was
restored while the primary-key correction passed CI. Final Worker605d12f7 is100%,
Pages7dc29d78 and live assets match. Warm reads take0.24–1.02s; grouped summaries,
prior layouts, Expanded exact versions and Explore counts pass. No migration or
production room/player/email writes.

F381 is delivered through PR348/e13d607a: tested412a7ecc passed all20 checks;
full738files/6238tests/allstages, boot669.2/670KB. Native desktop/phone builders
and a phone touch reviewer pass submit/edit/resubmit/reject-reason/approve with
zero page errors. Worker89464588 serves100%; Pagesbc16366a and live entry/runtime/
editors/lazy status module/styles match release bytes. Production smoke and
signed-out/private-directory checks pass; prior Insights grouping remains fast.
No schema change or production room/player/email tests.

F253 is delivered through PR349/bbc82248: tested a1c1a51d passed all20 checks,
full738files/6238tests/all stages, boot668.8/670KB. Clear Layer has a live desktop/
phone Erase-menu home; Cancel/clear/Undo, native Enter/Space and selected Expanded
cell isolation pass. Retired editor markup/CSS/state is removed; More Fit uses the
live control. Durable dock and six final phone scenarios pass with zero errors.
Guarded Pages-only release8b269a01, entrymain-C6zlHlcy/editor/runtime/styles byte
matches and production smoke pass. No Worker/schema/production room/player/email
writes. F479 wallet-only Protected sort and non-wallet payload hygiene are next.
The remaining14 items stay open.

F479 delivered through PR350, tested c183e346/all20 CI40983194176 and merged
08d0e589. Full742files/6262tests/all stages, boot669.2/670KB. Frontend-first guarded
Pages0e82901e then Worker eb81b606 at100%; production smoke and exact assets pass
(entry main-R5bSOI_g). Live default/crypto=1 record, summary and current views retain
protection/permissions and separate cached summaries; desktop/phone Explore has no
Protected sort while disconnected, zero page errors. Older tabs need a refresh.
No migration or production player/room/email/transaction tests. Goal15/28 and
Round2 87/248. F439 classroom emotes are next; F436 content approval remains pending.

F439 delivered through PR351, tested a212bcbf, merge31cd727e. All28 reported
checks pass: Quality40988214787 and Nightly40988214844 attempt2. A transient
Vines scroll timeout passed unchanged locally and on the failed-job rerun; no
assertions were relaxed. Guarded full release Pages6487d3e9, Worker c36fbaed at100%,
production smoke/health and exact entrymain-tuvoKYGL/editor/runtime/styles pass.
Live desktop/phone generated controls and guest text state verify with presence
transport blocked; no emotes sent to production players. Native classroom/public
isolation, real session tokens, ban/suspension/reconnect and all8 browser cases
prove the sending/receiving flows. No migration or production room/player/email/tx
writes. Goal16/28; Round2 88/248. F262/F264/F265/F261 are prepared separately for
the next cleanup PR; all12 remaining items stay open. F436 content approval pending.

PR #352 delivered F262/F264/F265/F261 after all20 exact-head checks passed.
Merge8cc89f21; guarded migration0078/API/Pages release and renderer release pass.
Live retired tables absent, health0078, canonical GET/HEAD301 and PNG/meta intact;
renderer health200/admin404 and renderer-only admin secret removed. Exact frontend
assets verified after Pages reconciliation. Goal20/28; Round2 92/248.

F259 delivered through PR353, testedcc46d419/all20checks, mergef3b8d780.
Guarded Pages-only rollout/smoke passed; exact frontend and default/red runtime
atlas bytes verified live, retired sample assets404, preview no longer deployed.
Local developer preview and all53 byte-preserving archives verified. Goal21/28,
Round2 93/248. F257 PR354 awaits CI/live; F255 remains local and uncounted.

F257 delivered through PR354, tested97bf1712/all20checks, merge8fac31e5.
Guarded Pages-only rollout/smoke passed. Live exact frontend assets and real-browser
boot diagnostics inactive/one ready entry/stable logs/zero page errors verified.
Goal22/28; Round2 94/248. Remaining6 F436,F255,F260,F258,F266,F254.

PR356 delivered F255/F260/F258/F266/F254 on2026-10-30. All20 checks passed on
18446370; merge067726eb. Guarded Pages-only rollout/smoke, exact frontend bytes,
live desktop/phone menu/About/sound/no-footstep/boot and public map image checks
pass; API remains healthy at0078. Goal27/28, Round2 99/248. Only F436 remains:
refreshed draftPR341 cc742769, migration0079 NOT applied, full/native proofs pass,
fresh CI and the previously pending26-prompt content decision still required.
