# Autotile edge-case source tiles

These are authored 16 x 16 RGBA source tiles for structural cases that the base
theme sheet does not contain. Keep one folder per theme and reuse the same
semantic filenames across themes so matching Forest, Cave, Desert, and Gothic
art can be reviewed side by side.

For the horizontal one-cell ledge attached to a thicker body, each theme folder
contains:

- `horizontal-ledge-middle-b4.png`: finished replacement for that theme's B4
  middle artwork.
- `horizontal-ledge-middle-b5.png`: finished replacement for that theme's B5
  middle artwork.

Do not edit the packed `autotile-edge-cases-<theme>.png` files directly. They
are hidden runtime atlases rebuilt by `scripts/generate_autotile_edge_case_tiles.mjs`.
