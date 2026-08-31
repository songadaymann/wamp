# Smart auto-tiling reference fixtures

These fixtures freeze the published room snapshots used to design and test the
reference-driven Smart profiles. Normal analysis is offline:

```sh
node scripts/analyze_smart_tile_reference.mjs --all
node scripts/analyze_smart_tile_reference.mjs \
  --fixture test/fixtures/smart-autotiling/references/cyber-x-10-y10.room.json
```

Rendering is also offline and must be requested with an explicit write flag:

```sh
node scripts/analyze_smart_tile_reference.mjs \
  --fixture test/fixtures/smart-autotiling/references/cyber-x-10-y10.room.json \
  --render-dir /tmp/smart-autotiling-cyber-render \
  --output /tmp/smart-autotiling-cyber-report.json
```

`--render-dir` reads the checked-in atlases under `public/assets/tilesets` and
writes one transparent, native-resolution PNG per tile layer plus a composite
in background/terrain/foreground order. It honors the room's horizontal and
vertical tile flip flags. These images intentionally contain tile layers only;
room backgrounds and placed objects are outside the reference analyzer's scope.

Each room envelope preserves the complete published snapshot, including
`tileData`, `tilesetHint`, room metadata, custom content, and placed objects. Its
provenance records the exact API URL, room version, fetch time, raw-response
SHA-256, and canonical-snapshot SHA-256. The catalog envelope applies the same
scheme to the GID catalog used to resolve base GIDs and local indices.

Refreshing is intentionally explicit and replaces all six rooms and the catalog
only after every response validates:

```sh
node scripts/analyze_smart_tile_reference.mjs --refresh
```

Review fixture, version, and checksum diffs together. Tests and ordinary
analysis must not refresh or depend on the live service. Without `--output`,
`--render-dir`, or `--refresh`, the analyzer does not write files.
