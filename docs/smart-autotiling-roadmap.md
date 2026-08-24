# Reference-driven Smart auto-tiling roadmap

## Outcome and current focus

The existing Smart V1 foundation remains the safety-proven baseline for Forest,
Desert, Cave, and Gothic terrain. The **Cyber** engine and brush milestone is
implemented and is at its preview-only visual gate. Desert cactus/bridge, Cave
rail, Gothic fence/columns, WampOS windows, and Backrooms structures remain
gated until the rule tier they need has been approved in an earlier set.

The central design rule is to learn *authored structure* from strong published
examples without cloning a single room. A reference tells us which atlas cells,
transforms, layers, and repetitions form a visual grammar. The shipped solver
must then express that grammar deterministically for new shapes and retain the
existing manual-lock, history, erase, and copy/paste guarantees.

## Frozen evidence set

The production site serves room pages from `https://wamp.land/r/{x}/{y}`. The
corresponding published JSON is
`https://api.wamp.land/api/rooms/{encoded "x,y"}/published?x={x}&y={y}`; GID
ranges come from `https://api.wamp.land/api/tilesets`.

These exact versions are checked in under
`test/fixtures/smart-autotiling/references/`. Every fixture contains the full
snapshot and records both the raw response SHA-256 and a stable canonical JSON
SHA-256. The default analyzer path is offline; a corpus update requires an
intentional `--refresh` and review of version, checksum, and behavior diffs.

| Set | Published room | Version | Canonical snapshot SHA-256 | What it demonstrates |
| --- | --- | ---: | --- | --- |
| Desert | `-7,-3` — Yee the Last Haw | 9 | `288e5770e2013d6edf2c1076fec2cbee4ac9dac4fbf58725ae33098f6b6532f6` | Cactus assemblies and a bridge/span language alongside ordinary terrain |
| Cave | `-3,-2` — All that glitters | 8 | `2bc3efd9f33315cd519c1220e2e5ae4f08b8bd39ebb46a1b454b92ba6631c382` | Rails assembled across layers with endpoint/orientation changes |
| Gothic | `-11,8` — New Tile Lair | 7 | `b620ded829df4c408c04f41e0c2887adf4081ec72f162679d0097b53a512e5fc` | Fence runs and capped vertical columns mixed with existing terrain |
| WampOS | `-11,10` — WampOS95 Demo | 6 | `29cd7c5a7b4e256d52e3f36a62a0672415b6b2125e4503e90cee7485b341d114` | Rectangular window chrome, repeated interiors, and text/decorative overlays |
| Backrooms | `-11,9` — Back Room | 12 | `9fd67a0eb9b89ca3a08b7c26d1b3ea7f8fd8a9beb887387f94d3e955326a280e` | Coupled wall/corridor surfaces, openings, pillars, stairs, and elevator-like macros |
| Cyber | `-10,10` — Cyber City | 13 | `84add9b8e02afe00736ff59f54b07b9ca61237b8866e0815e3a2b978224a41ec` | Transform-heavy structural edges, palette accents, supports, rubble, panels, and neon strips |

Run the corpus analyzer with:

```sh
node scripts/analyze_smart_tile_reference.mjs --all
node scripts/analyze_smart_tile_reference.mjs \
  --fixture test/fixtures/smart-autotiling/references/cyber-x-10-y10.room.json
node scripts/analyze_smart_tile_reference.mjs \
  --fixture test/fixtures/smart-autotiling/references/cyber-x-10-y10.room.json \
  --render-dir output/smart-autotiling-reference/cyber
```

It decodes the persisted X/Y flags, resolves each base GID to a catalog range
and local index, and summarizes layer occupancy, transform use, connected
components, exact runs, and repeated 2x2/3x3 patches. `--render-dir` uses the
checked-in local atlases to write transparent Background, Terrain, Foreground,
and composite PNGs while preserving X/Y transforms. `--url` can inspect a
published API URL or a `wamp.land/r/x/y` page explicitly without writing it.
Files are written only with `--output`, `--render-dir`, or `--refresh`.

## Rule tiers

### Tier 1 — transform-aware topology profiles

This tier extends the current neighbor solver while keeping a structural cell as
the unit of authoring. A profile may choose a base local index, X/Y transform,
layer, and color variant from cardinal/diagonal topology plus a stable detail
seed. Cyber is the proving set because transforms are not optional decoration:
the same base atlas cells routinely carry normal, X, Y, and XY forms.

Profile output uses symbolic values such as
`{ tilesetKey, localIndex, flipX, flipY, layer }`, with absolute GIDs resolved
only at the catalog boundary. This prevents Yellow and Pink from becoming two
copied rule tables and makes atlas-range changes auditable.

### Tier 2 — path and span motifs

Some assets describe an ordered path rather than the boundary of a filled cell
set. A path solver owns endpoints, straight segments, corners, junctions, and
optional supports. A span solver additionally knows its length and may place
caps, a repeating deck/body, and periodic or terminal supports. These primitives
unlock Cave rail and Gothic fence first, then Gothic columns, Desert bridge, and
vertical cactus assemblies.

The motif must retain a stable semantic identity so an adjacent Smart edit can
repair only affected endpoints/corners instead of rerolling the whole object.
Partial manual replacement turns that cell into an existing manual lock.

### Tier 3 — rectangular and multi-layer macros

WampOS windows and major Backrooms structures need an authored rectangle or
macro that owns several coordinated layers. The macro resolver receives bounds,
selects corners/edges/interior repeats, and emits a single history transaction
across terrain, background, and foreground. Resize, erase, copy/paste, and clear
must operate on the semantic macro while still honoring per-cell manual locks.

WampOS is the first controlled test because its frozen example uses no tile
flips: the difficulty is rectangle grammar and layer ownership, not transform
selection. Backrooms follows only after both path/span and rectangle/macro
ownership are stable.

## Cyber: first implementation track (preview gate)

The frozen Cyber room makes the extension seam concrete:

- Terrain contains 531 occupied cells: 510 Cyber Yellow, 13 Cyber Pink, and 8
  Cyber Text. Its transforms are 346 normal, 99 X, 71 Y, and 15 XY.
- Background contains 28 Yellow and 20 Pink cells; foreground contains 105
  Yellow, 33 Pink, and 17 Cyber Text cells. Structural output therefore cannot
  assume one tileset or one layer.
- Identical Yellow base indices appear in several orientations. For example,
  local 64 appears 39 times with X and 17 with Y; local 15 appears 18 times
  normal and 16 with Y. The transform is part of the recipe, not an editor-only
  afterthought.
- A clean right-hand tower at `x=32..39, y=2..17` demonstrates mirrored side
  caps, alternating body rows, transformed accents, a Pink interior strip,
  background supports, and foreground trim. Its exact matrix is suitable for a
  golden solver fixture.
- The live atlas language also has a clean three-cell neon strip
  `[49, 50, 51]`, floating platforms using mirrored `71` end caps with
  `68/69/70` interiors, and two-row framed panels using `44..46` over
  `56..58`. These are named rules, not chance decorations.

Implemented brush registry:

| Brush | Rule kind / algorithm | Required output | Accepted authoring |
| --- | --- | --- | --- |
| Structure | Terrain / eight-way blob | Colliding Terrain | Pencil, Fill, Rectangle, Ellipse |
| Platform | Path / horizontal strip | Colliding Terrain | Horizontal Pencil and Rectangle; minimum width 2 |
| Rubble | Stamp / area recipe | Colliding Terrain plus optional owned Foreground fragments | Pencil, Fill, Rectangle, Ellipse |
| Support | Span / vertical strip | Non-colliding Background | Vertical Pencil or multi-column Rectangle bank |
| Neon Strip | Path / horizontal strip | Colliding Terrain | Horizontal Pencil and Rectangle; minimum width 3 |
| Framed Panel | Rectangle section | Non-colliding Foreground | Horizontal Pencil or Rectangle; fixed height 2 and minimum width 3 |

Completed implementation sequence:

1. Introduced catalog-relative, transform-aware Cyber recipe output and exact
   decode/encode tests for none/X/Y/XY.
2. Matched the structural vocabulary: top/bottom caps, left/right walls,
   corner transitions, alternating interiors, rubble/foundation, and supports.
3. Added deterministic optional recipes for the neon strip and framed panel.
   Yellow remains the default structure; Pink is a stable accent/style choice,
   not a random competing topology.
4. Added coordinated background/foreground emissions while preserving terrain
   collision semantics and existing layer-specific manual locks.
5. Proved the right-tower geometry/local-index/transform matrix plus filled
   regions, holes, stairs, diagonals, irregular notches, thin runs, isolated
   cells, erasure, undo/redo, and semantic copy/paste.
6. Visually inspected the frozen Cyber reconstruction and newly authored
   fixtures in both Canvas and WebGL before opening the safety preview gate.

The reference is evidence, not a universal rule. A second set of deliberately
constructed small shapes must accompany the reference-shaped fixture so the
solver does not merely memorize one skyline.

### Cyber acceptance evidence

- The v13 right tower drives the exact boundary, local-index, X/Y/XY, and
  coordinate-phased façade golden. Yellow/Pink connectivity, irregular inset
  edges, holes, stairs, and diagonal repair have separate novel-shape cases.
- Yellow and Pink platform fixtures match the frozen room. Support short forms
  are `36`, `36/60`, `36/60/72`, then `36/48…/60/72`; normalized support banks
  reproduce the observed normal/X body pairs and alternating cap phase.
- Framed Panel tests cover complete and partial clipboard selections, stable
  owner IDs, per-part manual suppression, repaint/merge cleanup, cross-style
  replacement, whole-recipe Smart erase, and anchor-relative local-59 detail.
- Model tests cover v1 to v2 migration, canonical IDs such as `desert.ground`,
  unknown-future preservation, invalid brush/style/layer filtering, encoded
  locks, and configured 84/120/324-tile profiles.
- The focused Cyber/model/editor/clipboard gate passes 107 tests. The full gate
  passes 209 files / 1,413 tests, ESLint, TypeScript, generated-binding checks,
  and the production build.
- The expanded Smart browser gate passes in Canvas and WebGL with Fill, shapes,
  minimums, transformed Support banks, erase/repair, layer switching,
  copy/paste, undo/redo, macro suppression, serialized reload, Course Editor,
  and zero console/page errors. The official client reports a healthy render
  loop in both renderers.

### Intentional Cyber art boundaries

- The room format supports X and Y flips, not 90-degree rotation. Every
  structural mask therefore uses validated existing art or a neutral colliding
  fallback.
- The one-cell Support cap is a documented safe fallback; it is not present in
  the frozen room. Multi-column transform phase is normalized to the authored
  Support bank rather than guessed from absolute room coordinates.
- Yellow and Pink are explicit styles. Smart never invents random CyberText or
  recreates the reference tower's hand-placed Pink writing/accent strip.
- Framed Panels resize by extending/repainting their source row; there is no
  separate drag-handle resize UI in this milestone.

Safety preview: `https://safety-codex-smart-autotiling-cyber-2026-08-24.wampland.pages.dev`.
Production remains a separate approval.

## Gated set tracks

| Track | Required primitive | Gate to start | Initial acceptance target |
| --- | --- | --- | --- |
| Cave rail | Path | Cyber transform contract complete | Straight, endpoint, corner, and interrupted rail repair across the correct layers |
| Gothic fence | Path | Cave path semantics stable | Runs grow/shrink without changing untouched segments; mirrored ends are exact |
| Gothic columns | Vertical span | Path ownership stable | Top, repeating shaft, base, and one-cell minimum variants survive resize/erase |
| Desert bridge | Horizontal span | Span ownership stable | Both end caps, repeating deck, and supports resolve from span length |
| Desert cactus | Branched vertical motif | Span plus junction semantics stable | Trunk caps, arms/junctions, and mirrored variants remain deterministic |
| WampOS windows | Rectangle/multi-layer macro | Cyber layer transaction contract complete | Drag bounds create coherent corners, chrome, fill, and optional overlay content |
| Backrooms | Paths plus multi-layer macros | WampOS macro editing and earlier path rules complete | Corridor wall first; then openings/pillars; stairs/elevator macros last |

Backrooms stays last. Its reference has 1,016 occupied layer-cells, including 472
on background and 522 on terrain, with one giant connected terrain component and
several borrowed Gothic/Forest cells. Treating all of that as one neighbor mask
would make the rule table opaque. It should be decomposed into independently
testable corridor/wall, opening/pillar, stair, and elevator grammars.

## Release gates for every profile

A set moves from gated/in progress to complete only when all of these pass:

- Frozen, checksum-verified reference fixtures drive all tests; tests make no
  live network calls.
- Same semantic input and seed produce byte-identical output, including layer,
  tileset variant, local index, and transforms.
- Paint, resize, carve, erase, undo/redo, clear, and semantic copy/paste repair
  only the intended ownership bounds.
- Existing manual locks always win, including separate locks on background and
  foreground emissions.
- No generated decorative tile accidentally gains collision, and multi-layer
  output commits as one history action.
- Existing Forest/Desert/Cave/Gothic Smart coverage remains green.
- Reference-shaped and novel-shape fixtures receive visual review in Canvas and
  WebGL; atlas corrections are recorded as exact local-index recipes.

## Status ledger

| Milestone | Status |
| --- | --- |
| Existing Smart V1 safety foundation | Complete / safety-proven |
| Frozen six-room reference corpus and offline analyzer/renderer | Complete |
| Cyber transform-aware profile and golden fixtures | Implemented / safety preview gate |
| Cave rail and Gothic fence/columns | Gated on Tier 2 |
| Desert cactus and bridge | Gated on Tier 2 span/junction proof |
| WampOS window macros | Gated on Tier 3 layer ownership |
| Backrooms grammar set | Gated on Tier 2 + Tier 3 completion |
