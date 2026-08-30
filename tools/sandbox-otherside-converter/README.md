# Sandbox → Otherside Avatar Converter

Local bulk converter for [The Sandbox](https://www.sandbox.game) voxel avatars (GLTF/GLB) into the format [Otherside](https://docs.otherside.xyz/odk-docs/characters/creating-a-custom-character/technical-specifications) requires:

- Binary **GLB**, PBR, 1–2 m tall, skinned to the official **ODK / UE5** skeleton
- Sibling **MML**: `<m-character src="name.glb"></m-character>`
- **Rigid binds only** — each voxel part (head, hand, forearm, …) gets weight `1.0` on one bone so the cubes do not bend

This is a first cut. Bone mapping is a **draft**. Build the comparison `.blend`, overlay a real Sandbox GLTF, then send back the mesh → bone table and any Euler fixes.

## Requirements

- Python 3.10+
- [Blender 4.5 LTS](https://www.blender.org/download/lts/4-5/) (same version the ODK docs use)
- Optional: `pywebview` for a native window (`pip install -r requirements.txt`)

```bash
cd tools/sandbox-otherside-converter
python3 -m pip install -r requirements.txt
export BLENDER_PATH="/path/to/blender"   # if `blender` is not on PATH
```

## Drag-and-drop window

```bash
python3 app.py
```

Opens a local window (or browser tab) at `http://127.0.0.1:8765/`. Drop many `.gltf` / `.glb` files, inspect the draft map, then convert. Files never leave the machine.

## CLI

```bash
# Dump node / mesh names and the draft bone map
python3 app.py inspect fixtures/sandbox_voxel_parts.gltf --pretty

# Bulk convert a folder
python3 app.py convert --input ./in --output ./out

# Build the comparison skeleton (official FBX + placeholder cubes + height ruler)
python3 app.py build-template

# Overlay one Sandbox file beside the ODK rig
python3 app.py build-template --overlay /path/to/avatar.gltf
```

## How conversion works

1. Import `templates/ODK_Base_Skeleton.fbx` (or rebuild from `config/odk_bones.json`).
2. Import the Sandbox GLTF. Strip its armature, vertex groups, and animations. Keep materials / vertex colors.
3. Fit height to `targetHeightMeters` (default 1.8) and apply `globalRotationEulerDeg` / `globalScale`.
4. Resolve each mesh through `config/mapping.default.json`. Unmapped meshes are skipped and listed.
5. Parent **With Empty Groups** and assign every vertex to the mapped bone at weight 1.0.
6. Export GLB (skins on, animations off) and write a sibling `.mml`.

No heat skinning. No merged body. Each voxel chunk stays a rigid child of one bone.

## Mapping (edit this after you compare)

[`config/mapping.default.json`](config/mapping.default.json) is the contract:

```json
{
  "targetHeightMeters": 1.8,
  "globalRotationEulerDeg": [0, 0, 0],
  "globalScale": 1.0,
  "parts": [
    { "match": { "nameContains": ["forearm_l", "leftforearm"] }, "bone": "lowerarm_l", "rotationEulerDeg": [0, 0, 0] }
  ]
}
```

VoxEdit exports often need a 90° global or per-part Euler. Measure that in `ODK_Sandbox_Compare.blend` and update the JSON.

## After export

Otherside’s own collection pipeline runs GLBs through [mml-io/avatar-tools](https://github.com/mml-io/avatar-tools) (`gltf-avatar-exporter`) to fix bone rotations / repose. This tool leaves that as a documented next hook — it is not bundled.

Test a GLB in https://mml-io.github.io/avatar-tools/main/tools/gltf-avatar-exporter/ with **Use Sample Animation**.

## Tests

```bash
python3 -m pytest tests -q
```

Inspect / mapping tests use `fixtures/sandbox_voxel_parts.gltf` and do not need Blender. The convert smoke test runs only when Blender is on `PATH` or `BLENDER_PATH` is set.
