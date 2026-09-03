# Autotile edge-case source tiles

These are authored 16 x 16 RGBA source tiles for structural cases that the base
theme sheet does not contain. Keep one folder per theme and reuse the same
semantic filenames across themes so matching Forest, Cave, Desert, and Gothic
art can be reviewed side by side.

The artist's 2026-08-29 `rr_extras_v2.zip` delivery is kept byte-for-byte as
`public/assets/tilesets/rr_extras.png` (SHA-256
`0d03e27847884bf17f2d42c1ca66c00180dd848af6d78868303c75728b5ff334`). It
follows the normal 12 x 6 coordinate grid and contains separate right- and
left-facing transition cells:

- Cave A1/A2
- Forest B1/B2
- Desert C1/C2
- Water D1/D2 (reserved; not active in the colliding Ground solver)
- Lava E1/E2 (reserved until Lava Smart Ground exists)
- Snow F1/F2 (reserved until Snow Smart Ground exists)

For each row, the first cell transitions from a thick Ground body into a ledge
that protrudes right, and the second transitions into a ledge that protrudes
left. These cells are used without transforms. The matching base tileset then
retains its complete platform sequence: a right protrusion is transition, D9,
D10 as needed, D11; a left protrusion is D9, D10 as needed, D11, transition.
A one-cell protrusion uses only the matching transition. A two-cell protrusion
keeps the transition plus the exposed-end cap, because there is not room for
both D9 and D11.

The older Desert-only source folder is retained for its alpha-isolated C3/C6
seam overlays and historical fixtures. It contains:

- `horizontal-ledge-middle-b4.png`: finished replacement for that theme's B4
  middle artwork.
- `horizontal-ledge-middle-b5.png`: finished replacement for that theme's B5
  middle artwork.

Do not edit the packed `autotile-edge-cases-<theme>.png` files directly. They
are hidden runtime atlases rebuilt by `scripts/generate_autotile_edge_case_tiles.mjs`.
