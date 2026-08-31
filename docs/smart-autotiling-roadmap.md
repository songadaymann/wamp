# Reference-driven Smart auto-tiling roadmap

## Outcome and current focus

The canonical Smart V2 implementation is now live on `main`, merged from
`codex/smart-autotiling-consolidated-2026-08-26` at `981fb05`. It combines the
safety-proven Forest, Desert, Cave, and Gothic behavior with the Cyber recipe
engine and the current editor's filled/outline Rectangle, Ellipse, Line, and
Curve tools. The **Cyber** neutral-art foundation is live; further Cyber visual
correction remains the current tileset focus. Desert cactus/bridge, Cave rail,
Gothic fence/columns, WampOS windows, and Backrooms structures remain gated
until the rule tier they need has been approved in an earlier set.

The production asset contract is
`authoring-catalog-v1:4b122cb7accc8026`. Renderer
`production-2026-08-31-smart-autotiling-4b122cb7` was activated only after all
797 objects, 546 published leaves, and every ancestor level passed readiness,
object, and parity checks with no pending, failed, missing, or stale work.

The artist's `rr_extras` v2 ledge delivery (SHA-256
`0d03e27847884bf17f2d42c1ca66c00180dd848af6d78868303c75728b5ff334`) is active in the existing
colliding Ground solver for Cave A1/A2, Forest B1/B2, and Desert C1/C2. Each
row supplies distinct right- and left-facing transition cells, used without
transforms. The transition connects to a complete base-platform subsection:
transition/D9/D10.../D11 when protruding right, or D9/D10.../D11/transition
when protruding left. Water D1/D2, Lava E1/E2, and Snow F1/F2 remain reserved
rather than being forced into a different or not-yet-built rule.

The central design rule is to learn *authored structure* from strong published
examples without cloning a single room. A reference tells us which atlas cells,
transforms, layers, and repetitions form a visual grammar. The shipped solver
must then express that grammar deterministically for new shapes and retain the
existing manual-lock, history, erase, and copy/paste guarantees.

The editor boundary is now registry-driven. Each brush declares its solver
engine, stroke axis, and Rectangle normalization alongside its rule kind,
supported tools, layers, and styles. `SmartTileController` consumes that
contract for paint/erase/outline gestures and semantic clipboard restoration;
the general editor runtime no longer branches on Cyber versus legacy brush
IDs. The generic `recipeSolver.ts` is now an engine-adapter coordinator and
owns family-neutral locks, suppression, layer clearing, and output ownership.
It is also the single recipe-engine registry: `brushEngine.ts` only bridges the
legacy terrain solver, and editor layer clearing consumes the owning engine's
exact clear plan instead of recognizing Cyber owner IDs. Cyber resolution is
split by responsibility: `cyberRecipeDocument.ts` coordinates public editing
operations, `cyberRecipeState.ts` owns canonical state and output ownership,
`cyberSemanticResolver.ts` owns connected topology and structural overlays,
and `cyberRecipeRenderer.ts` renders spans, supports, and panels. Family
classification, individual span/rubble rules, structure profiles, and
letter-edge matching remain in their focused modules. New recipe families
should add a registered engine adapter and their own document/family resolvers
rather than widening the editor runtime or inheriting a Cyber owner namespace.

Layer authoring is mode-aware. Beginner treats each registry `defaultLayer` as
the brush's required source layer and disables the other layer controls.
Advanced leaves all three layer controls available and persists the selected
Background, Gameplay, or Front layer on each semantic cell or recipe. Primary
art follows that source layer. Coordinated same-cell overlays retain a separate
companion layer through a deterministic layer swap, so moving a multi-output
brush never causes one owned part to overwrite another.

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

## Cyber: first implementation track (live foundation)

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
- A clean right-hand tower at `x=32..39, y=2..17` remains useful evidence for
  transforms, supports, and authored accents. It is no longer copied as the
  default Ground facade: the neutral atlas audit below is authoritative for
  automatic Ground output.
- The live atlas language also has a clean three-cell neon strip
  `[49, 50, 51]`, floating platforms using mirrored `71` end caps with
  `68/69/70` authored interiors, and two-row framed panels using `44..46` over
  `56..58`. These are named rules, not chance decorations.

Implemented brush registry:

| Brush | Rule kind / algorithm | Beginner default output | Accepted authoring |
| --- | --- | --- | --- |
| Ground (`cyber.structure` persisted ID) | Terrain / eight-way blob | Colliding Terrain plus owned Foreground tunnel ceiling | Pencil, Fill, Rectangle, Ellipse |
| Platform | Path / horizontal strip | Colliding Terrain | Horizontal Pencil and Rectangle; minimum width 2; automatic middle is neutral F9 only |
| Rubble | Stamp / area recipe | Colliding Terrain plus Feature-style owned Foreground/Background outline | Pencil, Fill, Rectangle, Ellipse |
| Support | Span / vertical strip | Non-colliding Background | Vertical Pencil or multi-column Rectangle bank |
| Neon Strip | Path / horizontal strip | Colliding Terrain | Horizontal Pencil and Rectangle; minimum width 3 |
| Framed Panel | Rectangle section | Non-colliding Foreground | Horizontal Pencil or Rectangle; fixed height 2 and minimum width 3 |

Completed implementation sequence:

1. Introduced catalog-relative, transform-aware Cyber recipe output and exact
   decode/encode tests for none/X/Y/XY.
2. Replaced the reference-tower facade with the reviewed neutral Ground
   vocabulary: B3/B3X and repeated B4 tops, B10X/B12X sides, C2Y/C7Y lower
   corners, repeated F3 lower edges, mirrored F12 one-cell stair ends, and
   F5/G11/G12 underground fill. Diagonal joints retain that cardinal Terrain
   art and add transformed transparent A10 ties on Foreground.
3. Added deterministic optional recipes for the neon strip and framed panel.
   Yellow remains the default structure; Pink is a stable accent/style choice,
   not a random competing topology.
4. Added coordinated background/foreground emissions while preserving terrain
   collision semantics and existing layer-specific manual locks.
5. Proved filled regions, holes, stairs, diagonals, irregular notches, thin
   runs, isolated cells, erasure, undo/redo, and semantic copy/paste. Enclosed
   holes use transformed A10 Foreground corner ties over colliding fill,
   B10/B12 side walls, and C11Y/C11 Terrain ceiling/floor middles.
6. Visually inspected the frozen Cyber reconstruction and newly authored
   fixtures in both Canvas and WebGL before opening the safety preview gate.
7. Added Advanced source-layer overrides for every Cyber brush and the existing
   Forest/Desert/Cave/Gothic/Water brushes. The selected layer survives
   persistence, clipboard, manual locks/suppression, erase/repair, and exact
   undo/redo; Beginner retains automatic layer routing.
8. Integrated the artist's three-commit `origin/cyber-v3` safety-preview stack
   (`857fd8de`, `94b58033`, `0a2ace7e`) into the split Cyber modules. Concrete
   now uses letter-validated neutral edge variety, A-facing-void constraints,
   and socket-driven A10 overlays rather than a generic diagonal mask. Stacked
   Window strokes merge into pane tile 38 with tile 37 at every row end.

The reference is evidence, not a universal rule. A second set of deliberately
constructed small shapes must accompany the reference-shaped fixture so the
solver does not merely memorize one skyline.

### Cyber acceptance evidence

- The v13 right tower remains a transform/reference fixture, while the neutral
  coordinate contract drives automatic Ground. Yellow/Pink connectivity,
  irregular inset edges, layered holes, stairs, and diagonal repair have
  separate novel-shape cases.
- A10 appears on Foreground only at a validated ZBBZ corner socket, transformed
  toward the missing diagonal. Thin frames, one-cell nubs, and ordinary side,
  top, or bottom notches do not receive an errant overlay; true interior-hole,
  stepped-hole, and U-notch corners retain the needed A10. Terrain remains
  independently letter-matched beneath it.
- Concrete tests assert shared edge-letter agreement and A-facing-void behavior
  across rings, tunnels, cut-outs, T-junctions, crosses, concave/convex corners,
  and coordinate-stable neutral variations. Window acceptance includes a
  four-row band whose left/right cells are 37 and whose stacked panes are 38.
- Yellow and Pink platforms generate `F12X, F9…, F12`; the F10 paint spill and
  F11 open-bottom pieces remain available for manual accenting. Support short forms
  are `36`, `36/60`, `36/60/72`, then `36/48…/60/72`; normalized support banks
  reproduce the observed normal/X body pairs and alternating cap phase.
- Framed Panel tests cover complete and partial clipboard selections, stable
  owner IDs, per-part manual suppression, repaint/merge cleanup, cross-style
  replacement, and whole-recipe Smart erase. Its rows remain neutral while
  optional Cyber decoration is disabled.
- Platform, Support, and Neon Strip are persisted span recipes with stable
  owner IDs, canonical anchors, explicit bounds, deterministic split/merge,
  suppression cleanup, and complete-versus-partial clipboard behavior.
- Model tests cover v1 to v2 migration, canonical IDs such as `desert.ground`,
  unknown-future preservation, invalid brush/style/layer filtering, encoded
  locks, and configured 84/120/324-tile profiles.
- The focused Cyber edge/recipe gate passes 5 files / 86 tests. The full gate
  passes 219 files / 1,550 tests, ESLint, TypeScript, generated-binding checks,
  and the production build.
- The expanded Smart browser gate passes in Canvas and WebGL with Fill, shapes,
  minimums, transformed Support banks, erase/repair, layer switching,
  copy/paste, undo/redo, macro suppression, local-repository save followed by a
  hard page reload and reopen, Course Editor, zero mutation requests, and zero
  console/page errors. Each run asserts that its requested Canvas or WebGL
  renderer is actually active. The browser gate also paints and captures a
  stacked Window band and checks its 37/38 contract in both renderers.
- Rubble repeats B1 as its colliding fill and always uses the same deterministic
  A1/C1/A2/B2/A11/B11 structural outline grammar as legacy Feature.
- Optional Cyber vents, lights, graffiti, and Framed Panel accents are disabled
  while the base topology is being tuned. The editor hides the decoration toggle
  for Cyber; the dormant curated pools can be reviewed again in a later pass.
- Forest, Desert, Cave, and Gothic Ground decorations remain on the middle
  Terrain layer with non-colliding per-tile profiles. Replacing a legacy Smart
  owner with a Cyber brush discards every owned decoration output across
  Terrain, Background, and Foreground; Undo restores them and Redo removes them
  again. Higher-layer structural ties remain intentionally separate.

### Intentional Cyber art boundaries

- The room format supports X and Y flips, not 90-degree rotation. Every
  structural mask therefore uses validated existing art or a neutral colliding
  fallback.
- The one-cell Support cap is a documented safe fallback; it is not present in
  the frozen room. Multi-column transform phase is normalized to the authored
  Support bank rather than guessed from absolute room coordinates.
- Yellow and Pink are explicit styles. Smart never invents random CyberText,
  F10/F11 platform accents, or the reference tower's hand-placed Pink
  writing/accent strip.
- Framed Panels resize by extending/repainting their source row; there is no
  separate drag-handle resize UI in this milestone.

The earlier Cyber-only safety build remains available at
`https://safety-cyber-smart-tiles.wampland.pages.dev` (immutable deployment
`ed514749`, feature commit `2188b8a`) as historical comparison evidence. It is
superseded for new work by the consolidated branch and does not contain the
complete original-four/editor reconciliation. The consolidated candidate has
passed local Canvas and WebGL preview gates but has not been deployed. Production
remains a separate approval.

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
| Consolidated Smart V2 preview candidate | Complete locally on `codex/smart-autotiling-consolidated-2026-08-26`; Canvas/WebGL and full repository gates pass; safety deployment pending |
| Existing Smart V1 safety foundation | Complete / safety-proven and incorporated into the consolidated candidate |
| Frozen six-room reference corpus and offline analyzer/renderer | Complete |
| Cyber transform-aware profile and golden fixtures | Complete locally in the consolidated candidate; prior Cyber-only safety preview retained as historical comparison |
| Artist `rr_extras` Ground ledges | The 2026-08-29 v2 delivery is integrated locally for Cave A1/A2, Forest B1/B2, and Desert C1/C2; exact source hash, directional transition plus complete D9/D10/D11 platform-subsection fixtures, short-run fallbacks, Advanced-layer ownership, and Canvas/WebGL visual checks pass. Water/Lava/Snow rows remain reserved |
| Cave rail and Gothic fence/columns | Gated on Tier 2 |
| Desert cactus and bridge | Gated on Tier 2 span/junction proof |
| WampOS window macros | Gated on Tier 3 layer ownership |
| Backrooms grammar set | Gated on Tier 2 + Tier 3 completion |
