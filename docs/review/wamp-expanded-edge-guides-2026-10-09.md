# F166 Expanded Room perimeter edge guides

Delivered 2026-10-09 in [PR #106](https://github.com/songadaymann/wamp/pull/106), merge `74b839cc`, live on https://wamp.land through the Pages auto-build (verified in the served `CourseEditorScene` chunk). Completes F166 with the standalone guides from [PR #101](https://github.com/songadaymann/wamp/pull/101). Frontend only.

## Behavior

- The Expanded Room editor shows the room editor's neighbor-opening guides (green matched opening, orange X blocked on one side, blue open to empty space) on the room's outer perimeter. Internal seams between member cells get none.
- Each member cell uses the shared `EditorEdgeGuideCache` (standing-body clearance, one-way and custom tiles, solid objects), recomputed only when that cell's document revision or the neighbor set changes.
- One `loadWorldWindow` request, sized to the room's bounding box plus one cell (Expanded Rooms are at most 16 cells, well inside the API's radius limit), finds published perimeter rooms; their snapshots load with `loadPublishedRoom`. A load superseded by a newer one stops before fetching snapshots, and a failed load leaves edges unknown rather than guessing.
- Guides hide in play and music modes.

## Evidence

- `npm run check` on Node 22: 412 files, lint, types, build. DOM contract 1,003 / 242.
- Unit tests: L-shaped perimeter sides and neighbor cells, window coverage, load filtering (drafts, members, far rooms), states on the right sides only, no redraw on stable frames, hidden when disabled, stale and failed loads, exact marker coordinates and per-cell origin offset.
- Headless Chromium on the safety API: the synthetic 2×1 Expanded Room shows open-space guides on its six outer edges and none on the seam. With injected test neighbors (an open published room to the left, a sealed one above), the left edge is matched and the top of the right cell is blocked; walling off the left column turns it blocked; music mode hides all guides. The room editor's own guide overlay still draws. Zero page errors.

## Known limitation

In the synthetic standalone editor fixture, neighbor previews never finish loading because no world request is issued. This is pre-existing and unrelated; standalone drawing was exercised directly.
