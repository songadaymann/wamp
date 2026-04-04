# Feature Ledger

Purpose: keep one repo-level map of active, reverted, and testing features so future work can start from `main` without guessing which old branch is the real source of truth.

Audit scope: this ledger currently reflects the recent non-merged branch inventory plus matching notes in `progress.md`, mainly covering March 19, 2026 through April 4, 2026. It is an operational cleanup map, not a perfect historical record.

## Working Rules

- Branch new work from `main` unless a ledger entry explicitly says a different branch is the clean continuation line.
- Give each feature one canonical branch or one explicit reference branch set. Do not keep switching bases mid-feature.
- Treat old `safety/...` branches as reference material unless the ledger says they are the clean branch to continue from.
- Update this file when a feature changes status, gets reverted, gets a new preview deploy, or gets a new canonical branch.

## Status Legend

- `testing`: deployed or actively being QAed
- `ready-for-merge`: user-assessed as ready or nearly ready to land, even if the underlying history is not perfectly rebased yet
- `continue-from-branch`: existing branch is clean enough to keep using as the feature line
- `needs-more-work`: directionally correct, but not yet ready to land
- `needs-port`: old branch is reference-only; re-cut from `main`
- `needs-extraction`: useful work exists, but only inside a broad snapshot or dirty-branch lineage
- `rework-from-main`: prior implementation should not be revived directly
- `merge-candidate`: narrow enough to port or cherry-pick once someone decides it still matters
- `live-on-main`: branch lingers, but equivalent product behavior is already considered live on `main`
- `merged`: on `main`
- `parked`: not actively moving
- `preview-only`: deploy/test branch, not a feature branch to continue from

## Current Feature Families

| Feature | Status | Canonical / Reference Branches | Preview Deploy | Notes | Next Clean Action |
| --- | --- | --- | --- | --- | --- |
| Lighting system | `continue-from-branch` | Canonical: `feature/lighting-followups-2026-04-04` -> `f90eebc` base from current `main`. Reference-only history: `safety/room-lighting-tuning-v2-2026-04-02` (`ba7e971`), `safety/room-lighting-retry-2026-04-01` (`6794a3c`), `safety/room-lighting-v1-2026-04-01` (`e1d771f`) | None recorded | Current `main` already contains the meaningful room-lighting functionality. The older safety branches are now historical snapshots rather than clean continuation lines. New lighting work should happen on the fresh main-based branch. Latest follow-up on this branch adds client-local ambient darkening for the surrounding room ring during live play. | Continue new lighting work on `feature/lighting-followups-2026-04-04`. Keep the old safety branches only as archive/reference until someone explicitly decides to delete them. |
| Music system | `needs-more-work` | Canonical: `feature/music-sequencer` -> `1aa6d98` (`safety/main-based-room-sequencer-2026-04-02`). Reference only: `safety/advanced-room-sequencer-2026-04-02` (`146f5a6`), `safety/advanced-room-sequencer-followup-2026-04-02` (`acc9a9c`), `safety/advanced-room-sequencer-save-recovery-2026-04-02` (`8ec87e6`), `safety/room-music-followup-snapshot-2026-04-01` (`37c1687`) | None recorded | Current team read is that music is directionally correct but still needs more work. `feature/music-sequencer` is now the stable continuation name. | Continue new music work on `feature/music-sequencer` and cherry-pick only truly music-scoped follow-ups into it. |
| Room boundary object gates / cross-room movement rules | `rework-from-main` | Reference: `safety/room-boundary-object-gates-2026-04-02` (`3e182c4`) | None recorded | This feature already hit `main` and was reverted by `f78b62a` after the implementation caused bad frame-rate drops. The old branch is useful only as design/reference material. | Start a fresh `feature/room-boundary-gates-rework` from `main`, put the behavior behind a feature flag, and add perf instrumentation before reviving any cross-room object logic. |
| Profile ownership + online roster join | `merged` | Landed on `main` as `1cff00f`. Former local feature branch deleted: `feature/profile-owned-rooms-roster-join`. Older profile base reference remains `safety/profile-hub-2026-03-23` (`3a7c006`) only as history. | `https://wamp-safety-profile-online-join-20260403.novox-robot.workers.dev` | The final merge was a selective port onto current `main`: owner-only profile room sourcing, profile copy/stat updates, and clickable roster joins. | No further action unless QA finds a regression. |
| Adjoining-room world audio bleed / low-pass | `merged` | Landed on `main` as `e080fe5`. Former local branches deleted: `feature/adjoining-room-audio`, `safety/adjoining-room-audio-2026-03-31`. | None recorded | Main already contained the core adjoining-room audio system; the final merge pass lifted the later low-pass tuning values onto `main`. | No further action unless new tuning feedback appears. |
| In-room PartyKit chat MVP | `merged` | Functionally already present on `main` (`18f6706` after the course branch closure pass). Former local feature branch deleted: `feature/room-chat-mvp`. | None recorded | The dedicated room-chat files on `main` matched the feature branch directly, and `progress.md` already recorded the feature as landed. | No further action unless a new chat regression appears. |
| Course cross-room pressure-plate links | `merged` | Effectively present on `main`; replaying the branch onto current `main` only produced whitespace-level cleanup commits (`31eb202`, `18f6706`). Former local branches deleted: `feature/course-pressure-plates`, `safety/course-cross-room-pressure-plates-2026-03-28`. | None recorded | This feature line turned out to be functionally on `main` already. The branch closure pass confirmed the code path and left only trivial deletions in `CourseEditorScene`. | No further action unless a real course pressure-plate bug still reproduces. |

## Smaller Merge Candidates And Hardening Lines

| Feature | Status | Canonical / Reference Branches | Preview Deploy | Notes | Next Clean Action |
| --- | --- | --- | --- | --- | --- |
| Play.fun-only identity gate | `testing` | `safety/playfun-identity-gate-2026-04-04` (`c01494d`) | `https://safety-playfun-identity-gate.wampland.pages.dev` | Narrow backend/client hardening line that replaces the old `display_name LIKE 'playfun-%'` heuristic with an account-based rule: user is linked in `playfun_user_links` and still has no email or wallet. This closes the hole where renamed Play.fun-only burner accounts like `2fc7a5aa-84b` and the other `xxxxxxxx-xxx` names were bypassing WAMP-side exclusion. Safety Worker deploy for this branch is `https://everybodys-platformer-safety.novox-robot.workers.dev` at version `be3604fe-9587-496d-aa99-1c5b12dfb8af`. | QA on the safety preview, then merge or fast-port this onto `main` before doing more Play.fun leaderboard cleanup or anti-cheat follow-up. |
| Presence identity auth-refresh | `merge-candidate` | `safety/presence-auth-refresh` (`e596584`) | None recorded | Narrow client-side presence rebind fix with targeted verification. Not obviously part of any other active feature, but still out of `main`. | If users still hit guest-name / wrong-presence identity issues, port this onto `main` as a small standalone fix. |
| Creator reward hardening | `merge-candidate` | `safety/creator-reward-hardening` (`9c96fb2`) | None recorded | Small backend reward-rule tightening branch. The ledger treats it as a candidate because it is narrow and has verification notes, but it has not come up in the latest user priorities. | Keep parked unless creator-reward abuse becomes urgent again, then port as a small backend-only branch. |
| Object stack guard + repair tooling | `merge-candidate` | `safety/object-stack-guard-2026-03-27` (`7111a6c`), `safety/object-stack-guard-followup-2026-03-28` (`65a982f`) | None recorded | Looks like a self-contained editor/data-integrity hardening line with repair tooling. No recent user request points at it, but it is cleanly separable. | Leave parked unless object stacking becomes a live problem again; if it does, port both commits together from a fresh `main` branch. |
| Wall-jump feel follow-up | `merge-candidate` | `fix/wall-jump-chain-2026-03-29` (`becdedd`) | None recorded | Small movement tweak with verification notes in `progress.md`. Not part of the current feature cluster, but still outstanding relative to `main`. | If movement feel is still on the table, port this as a narrow gameplay fix instead of leaving it buried. |
| Course respawn to authored start | `merge-candidate` | `fix/course-respawn-start-2026-03-31` (`3bfc4ab`) | None recorded | Single-file gameplay fix branch. Lightweight enough to land independently if the bug still matters. | Verify whether the live bug still reproduces. If yes, port it as a dedicated fix branch. |
| NFT metadata refresh flow | `merge-candidate` | `safety/live-metadata-refresh` (`88584f3`) | None recorded | Larger mint/NFT metadata feature with migration and rendering helpers. It is isolated enough to track, but it is not part of the current gameplay/UI cleanup cluster. | Decide whether mint metadata refresh is still an active product goal. If yes, move it to its own dedicated feature branch and retest end-to-end before landing. |

## Parked / Experimental / Historical Lines

| Feature | Status | Canonical / Reference Branches | Preview Deploy | Notes | Next Clean Action |
| --- | --- | --- | --- | --- | --- |
| Avatar experiments | `parked` | `feat/punk-avatar-stage1-2026-03-30` (`faf7740`), `codex/punk-avatar-safety-20260326` (`e78dc2a`), `safety/chonk-avatar-animation-2026-04-01` (`c9a0a4c`) | None recorded | There are multiple avatar-related branches, but `progress.md` explicitly says punk avatar work was tested on a safety branch and not promoted. Chonk motion art also exists as a separate branch. | Do not continue from any of these by default. If avatar work resumes, split runtime avatar-system work from specific art-pack experiments. |
| Viral text prototype | `parked` | `feat/viral-text-prototype-2026-03-29` (`4635f98`) | None recorded | Separate prototype surface, not part of core WAMP cleanup. | Leave parked unless the prototype becomes an explicit priority again. |
| Play.fun room guardrails branch | `merged` | Already live on `main`. Former local branches deleted: `safety/playfun-room-guardrails-2026-03-28`, `release/playfun-room-guardrails-main`. | None recorded | This branch family was just leftover history for a feature already called live in `progress.md`. | No further action unless a new Play.fun regression appears. |
| Course builder room-selection reset branch | `live-on-main` | `safety/course-builder-room-copy-fix-origin-main-2026-03-28` (`1a1af6c`), `safety/course-builder-room-copy-fix` (`9f063f8`) | None recorded | The course-builder reset fix is already called out as promoted. The lingering branches are historical leftovers, not current work. | Do not branch from these. Keep only as historical reference if needed. |
| Preview / deployment-only branches | `preview-only` | `preview/chunk-preview-clip-fix`, `preview/endless-overworld-live-test`, `preview/endless-overworld-live-test-deploy` | None recorded | These look like temporary deployment/test lines rather than canonical feature branches. | Treat as disposable preview history, not as bases for new work. |

## Cleanup Path

1. Treat `main` as the only trusted default base.
2. Keep testing on existing preview branches when useful, but do not branch new work from those snapshots.
3. For each active feature, either:
   - continue from the one canonical clean branch, or
   - re-cut from `main` and port only the needed commits.
4. Use `integration/...` branches only when intentionally testing combinations like `lighting + music`.
5. Prefer promoting narrow `merge-candidate` fixes separately instead of batching them into a large safety snapshot.
6. When something gets rolled back, update this file immediately so the next agent does not assume the reverted branch is still safe to build on.

## Open Slots

- Add rows here as more active feature lines resurface.
