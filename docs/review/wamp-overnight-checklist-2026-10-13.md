# WAMP overnight checklist — October 13–14, 2026

Original prompt: "i think the 240px one works pretty good! Let's record that as our choice for now but I am going to bed so let's make a goal to just work through the checklist overnight until 5am."

## Window and plan

Work begins October 13 at 8:07pm America/New_York and ends October 14 at 5:00am (09:00 UTC). Goal is active. A one-shot heartbeat records the 5am cutoff. Preserve the primary dirty checkout and decision-gated/withheld items. Work from main `f009b55f` in the attached clean checkout, branch `codex/wamp-overnight-checklist-2026-10-13`. Start with approved F038 (expired auth/outbox cleanup and new replay frames in R2), then F173 (Comfort settings and remembered room-camera preference), then other actionable checklist items within the remaining time. Make each slice concrete, tested and reviewable; merge and verify deliveries that meet their gates.

## Selected animation

Jonathan selected **240 pixels wide, 32 colors, ordered dithering**, as the current choice for F094. Keep the animation: the earlier still-image replacement plan is superseded. The comparison encodes the whole 5.9-second / 59-frame / 10fps loop as lossless animated WebP after palette reduction, at 240×135 and 917,468 bytes. This is 89.0% smaller than the 8,337,652-byte GIF and 66.8% smaller than the currently served 2,761,006-byte animated WebP. One palette covers the entire animation. Source ID: `59f7f031-fba7-4447-550d-4f8b96bf4000` (`IMG_1667 - Copy.png`).

![Selected 240px animation](assets/wamp-background-choice-240px-32colors-2026-10-13.webp)

SHA-256: `0ef66e862b4a83d5db1df88655a140ba39c5f77858c45ff7eba884bec185ed26`.

This records the choice; animated in-game playback and upload conversion remain separate implementation work. Account-setting changes still need the coordination specified in the handoff. Other 23 approved uploaded backgrounds currently serve at 1–302 KB (median 32 KB, total 1.36 MB); the full comparison and measurements remain in ignored `output/background-review-2026-10-13/`.

## Work record

- Setup: inspected current main, preserved unrelated work, recorded the selected asset and the deadline. Previous F023 is verified live, final main `f009b55f`, Pages `26d150cc`, with all hosted checks green.
- F038 candidate: extracted hourly maintenance; indexed, bounded deletion of expired sessions/magic-link tokens and dispatched outbox rows older than seven days. New replay JPEGs go to private R2; D1 stores only metadata and a frame key. Protected admin detail reads hydrate new images and keep legacy inline images working. Removed request-time purges; expired recordings stay hidden. Retry, conflicting-upload, opt-out race, storage-failure, expiry-boundary and scheduled-handler checks pass. Production read-only inventory: 307 expired sessions, 472 expired magic links, 16,772 old dispatched outbox rows, no expired replays (20:18 New York). Production/safety replay buckets created with seven-day lifecycle rules. Safety database caught up through migration 0065; full quality gates and live safety proof are in progress.

## Morning audit

At the deadline record the final checklist count, source/merge/release IDs, test and live proof for each delivered slice, remaining review candidates, blockers and pending decisions. Completion means the selection is recorded and the requested overnight work window has been carried out and audited; it does not mean all 215 checklist items are complete.

### 8:40pm checkpoint

- F038 API delivery: PR #192, merge `1352cb94`, Worker `5416ed6f`, migration 0065. Full 3,533-test gates, clean release checks, source/merge four hosted checks, guarded production smoke and health pass. Real production image hydration plus desktop/phone playback/scrubbing pass. Synthetic production recording removed and its R2 object confirmed absent. The checklist stays unticked until the 9:17pm hourly tick is observed. Safety's owned synthetic recording `de221bb2-1684-4984-b3c8-68f3e500c006` is expired; verify its DB rows and R2 frame are removed after that tick. Read-only production expiry/outbox inventory will prove the bounded sweep.
- F173 implementation: device-local Comfort preferences like performance settings, System/On/Off reduced motion, Follow player/Whole room camera. Typed preference persistence, system changes, explicit overrides and camera framing tests pass. No account-settings API or auth work is changed. Full gates and real desktop/phone gameplay verification are in progress on `codex/wamp-comfort-settings-2026-10-13`.

### 9:20pm checkpoint

- F038 production's first hourly sweep left zero expired sessions and zero expired magic links. Old dispatched outbox rows fell from 16,772 to 11,772, exactly one 5,000-row batch. A transient Cloudflare D1 7403 affected the immediate pre-tick inventory; the earlier successful baseline and post-tick counts are preserved. The expired owned safety recording remains, so safety schedule diagnostics and real R2 expiry proof are still open. Do not tick F038 until resolved.
- F173 candidate is complete: full 3,538-test gates; native desktop/Chromium phone/WebKit phone settings, gameplay/effects, system changes and reload persistence pass; authored-room camera smoke and installed-client gameplay pass. Safari menu sizing and Camera label contrast are fixed. See `wamp-comfort-settings-2026-10-13.md`. Publication and custom-domain proof are next; the master remains 136/215 until delivery.

### 10:10pm checkpoint

- F173 complete and live; master 137/215. PR #193 source `08ebdc8b`, main `c949c360`, Pages `f185351c`, API Worker `09f01495` (required by independently merged Room video shared schema). Combined-main 3,545 tests, all hosted checks, guarded releases/health/renderer contract, matching entry assets and native live keyboard/touch/reload checks pass. No room edits.
- F038: production auth/outbox hourly sweep verified. Both safety schedules are registered and the deployed script advertises `scheduled`, but no scheduled safety invocation has been observed in the tail and the owned expired record remains. Production test recording `130448b5-60ee-4d58-82a7-e3dd27066de6` was deliberately expired; verify session/sample/object removal after 10:17pm NY. Frame key and metadata are in `/tmp/wamp-f038-2026-10-13/production-expiry-storage.json`. F038 remains unticked until R2 cron expiry proof.
- New mobile finding: recording notice overlays the phone Jump target. Next narrow fix under mobile checks; then continue F019 lazy rare popups and stable chunks.

### Recording notice candidate

Phone play now places the recording notice above the movement/action deck and sizes the opt-out target to 44px. The new CI scenario checks real hit targets and non-overlap; all 13 phone/tablet scenarios pass, with zero errors/missing fixtures. Full quality gates pass. F089 remains partial; publication/live verification is next. Receipt: `wamp-recording-notice-phone-2026-10-13.md`.

### 10:25pm checkpoint

- F038 complete: master 138/215. At the second real production tick the expired owned specimen disappeared from both D1 tables and R2; no manual production deletion. Production auth/outbox cleanup already verified. Safety schedules/handler are registered but no schedule invocation was observed; only the owned expired safety specimen was cleaned manually. The tail was stopped.
- Phone notice fix: PR #194 source `4bdb0dca`, main `dd866ceb`, Pages `b1e7c86d`. Full 3,545 tests, 13 mobile scenarios, source/merge hosted checks and guarded release pass. A release fetched just before merge and initially published the preceding docs-only commit; rerun verified `dd866ceb`. Live un-dismissed notice/touch verification and installed-client proof pass. All six controls stay clickable; actual touch jump lifts the player without moving whole-room framing. The outbox backlog is now 6,772 after the second 5,000-row sweep. F089 remains partial.
- Next: F019 lazy rare modals, preserving first-use triggers and close behavior; then stable model chunks after graph verification.

### 10:52pm checkpoint

F019 candidate: seven more dialogs load on first use, eleven in total; stable room data is self-contained and unchanged across a real guestbook copy rebuild. Startup 650.8 → 641.0 KB brotli. Full 3,553-test gates, thirteen mobile cases, three native browser/device cases and two shared-link starts pass. Pending-close cancellation, multiple queued results and guest acknowledgements are verified. Receipt `wamp-lazy-dialogs-cache-2026-10-13.md`. Publish and verify this slice next; F019 remains partial and master stays 138/215. The app goal tracker unexpectedly reports blocked despite active progress; the human's overnight instruction and 5am cutoff remain in force.

### 11:10pm checkpoint

F019 slice live: PR #195 / main `189a2153`, Pages `c9e761fb`. All source/reported merge checks, clean-main 3,553-test gates, guarded delivery/health and 22 exact startup/menu file hashes pass. Live desktop/phone Chrome and WebKit phone download About/Controls/Guestbook only once across repeated opens; no application errors. WebKit challenge-only cross-frame errors also reproduce on the prior release, documented as a separate real-iOS follow-up. Installed client completes Welcome with a verified guest clear; screenshot inspected, software-renderer suggestion is not an FPS claim. F019 stays partial; master 138/215. Next F006: cached special-tile cell map and reusable scan results. Controlled native scan baseline is 3.3 ms per 1,600 scans (64 synthetic bodies); this measures the scan loop, not game FPS.

### 11:42pm F006 candidate

Cached room-cell bitmap, reusable scan results/origins, shared empty decoding, safe conveyor sample reuse and hazard-only idle NPC queries are implemented. Constructor callbacks and conveyor application are extracted; existing size caps shrink. Controlled scan median 3.3 → 1.5 ms for 1,600 queries, 64 environment results identical; cold pass 1 ms. All initial 63 full-scene cadence comparisons pass; local-storage backend corrected the synthetic test setup. Final matrix after the collaborator extraction, full gates, phone smoke and publication are next. F006 stays unchecked and master remains 138/215.

### 12:30am checkpoint

F006 complete/live; master 139/215. PR #196 source `aafc986e`, main `51b23461`, Pages `f1e31bd8`, Worker `56a638d4`. All source/merge hosted checks and clean-main 3,571-test gates pass. Full guarded release/health/renderer checks, 22 custom/immutable file comparisons, native Chrome desktop/phone and phone WebKit movement in published gravity room `1,-1`, and installed-client gameplay (326 live objects) pass. Screenshots inspected. No overall FPS claim; the controlled scan gain is 3.3 → 1.5 ms / 1,600 calls with identical results. Phone Stop smoke now waits for readiness and taps the real control. Next F008 category-group collisions, preserving existing bodies, sleeping state, pair filters and callbacks; baseline/measured improvement must precede delivery.
