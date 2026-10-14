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
- F038: inspecting the hourly cleanup, replay ingestion/admin viewer, bucket bindings and expiry boundaries before implementation.

## Morning audit

At the deadline record the final checklist count, source/merge/release IDs, test and live proof for each delivered slice, remaining review candidates, blockers and pending decisions. Completion means the selection is recorded and the requested overnight work window has been carried out and audited; it does not mean all 215 checklist items are complete.
