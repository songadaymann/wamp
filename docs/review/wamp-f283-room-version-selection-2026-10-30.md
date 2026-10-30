# F283 — consistent room versions after first publish

A lingering live construction preview could outrank a newly published room in the runtime snapshot accessor, while playable selection already preferred the published copy. This briefly exposed draft status/version to HUD and run readers until presence cleared the preview.

The runtime view now prefers optimistic published content over presence and ignores presence when the summary is published. Transient course overrides and local drafts keep their existing precedence; unpublished live previews, loaded-room and preview-cache fallbacks retain their behavior. This follows the finding's narrower fact-checked recommendation. Async rendering and metrics selection have different requirements and are not folded into a universal resolver.

## Verification

- Before the fix, three regression assertions fail: optimistic-before-presence, published loaded content and published cache content.
- After the fix, focused snapshot and transition hydration tests pass (30 tests). Tests retain stable identities and zero deep-clone allocations.
- An isolated Chromium fixture imports the actual browser modules: view and playable readers agree before publish, with the optimistic publication, while the stale presence preview remains after the published summary arrives, and after preview removal. Published status, v2 and publication timestamp survive throughout the publication window. This is fixture state, not a real production publish or leaderboard submission.
- The maintained Chromium room-entry smoke passes six mouse/keyboard entry cases and 18 repeated restart cases with movement, jumping and zero page errors. API content uses recorded replay fixtures; this makes no production player or room writes.
- Full checks, CI and release evidence will be added before delivery. Checklist remains unticked until delivery.
