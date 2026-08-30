#!/usr/bin/env python3
"""Write a tiny synthetic Sandbox-style voxel avatar GLTF (separate rigid parts, no skin)."""

from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

PARTS = (
    ("Head", [0.0, 1.62, 0.0], [0.22, 0.22, 0.22], [240, 196, 158]),
    ("Torso", [0.0, 1.28, 0.0], [0.34, 0.36, 0.18], [70, 140, 210]),
    ("Hip", [0.0, 0.98, 0.0], [0.28, 0.16, 0.16], [50, 100, 180]),
    ("UpperArm_L", [0.32, 1.38, 0.0], [0.26, 0.10, 0.10], [240, 140, 60]),
    ("ForeArm_L", [0.56, 1.36, 0.0], [0.24, 0.08, 0.08], [250, 180, 80]),
    ("Hand_L", [0.74, 1.35, 0.0], [0.10, 0.08, 0.06], [240, 196, 158]),
    ("UpperArm_R", [-0.32, 1.38, 0.0], [0.26, 0.10, 0.10], [240, 140, 60]),
    ("ForeArm_R", [-0.56, 1.36, 0.0], [0.24, 0.08, 0.08], [250, 180, 80]),
    ("Hand_R", [-0.74, 1.35, 0.0], [0.10, 0.08, 0.06], [240, 196, 158]),
    ("UpperLeg_L", [0.10, 0.70, 0.0], [0.12, 0.40, 0.12], [90, 170, 90]),
    ("LowerLeg_L", [0.10, 0.30, 0.0], [0.10, 0.36, 0.10], [60, 130, 70]),
    ("Foot_L", [0.10, 0.05, 0.06], [0.12, 0.08, 0.22], [80, 60, 45]),
    ("UpperLeg_R", [-0.10, 0.70, 0.0], [0.12, 0.40, 0.12], [90, 170, 90]),
    ("LowerLeg_R", [-0.10, 0.30, 0.0], [0.10, 0.36, 0.10], [60, 130, 70]),
    ("Foot_R", [-0.10, 0.05, 0.06], [0.12, 0.08, 0.22], [80, 60, 45]),
)


def _cube_vertices(center, size) -> list[tuple[float, float, float]]:
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    cx, cy, cz = center
    return [
        (cx - hx, cy - hy, cz - hz),
        (cx + hx, cy - hy, cz - hz),
        (cx + hx, cy + hy, cz - hz),
        (cx - hx, cy + hy, cz - hz),
        (cx - hx, cy - hy, cz + hz),
        (cx + hx, cy - hy, cz + hz),
        (cx + hx, cy + hy, cz + hz),
        (cx - hx, cy + hy, cz + hz),
    ]


FACES = (
    (0, 1, 2, 3),
    (4, 7, 6, 5),
    (0, 4, 5, 1),
    (2, 6, 7, 3),
    (0, 3, 7, 4),
    (1, 5, 6, 2),
)


def _pack_mesh(center, size, color) -> tuple[bytes, bytes, bytes, bytes]:
    corners = _cube_vertices(center, size)
    positions: list[float] = []
    normals: list[float] = []
    colors: list[float] = []
    indices: list[int] = []
    r, g, b = (channel / 255.0 for channel in color)
    for face in FACES:
        a, b_i, c, d = (corners[i] for i in face)
        ux, uy, uz = (b_i[0] - a[0], b_i[1] - a[1], b_i[2] - a[2])
        vx, vy, vz = (d[0] - a[0], d[1] - a[1], d[2] - a[2])
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
        normal = (nx / length, ny / length, nz / length)
        base = len(positions) // 3
        for point in (a, b_i, c, d):
            positions.extend(point)
            normals.extend(normal)
            colors.extend((r, g, b))
        indices.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    return (
        struct.pack("<" + "f" * len(positions), *positions),
        struct.pack("<" + "f" * len(normals), *normals),
        struct.pack("<" + "f" * len(colors), *colors),
        struct.pack("<" + "H" * len(indices), *indices),
    )


def build_document() -> dict:
    buffer = bytearray()
    buffer_views = []
    accessors = []
    meshes = []
    nodes = []
    materials = []

    def add_view(blob: bytes, target: int) -> int:
        while len(buffer) % 4:
            buffer.append(0)
        view_index = len(buffer_views)
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": len(buffer),
                "byteLength": len(blob),
                "target": target,
            }
        )
        buffer.extend(blob)
        return view_index

    for name, center, size, color in PARTS:
        pos, nrm, col, idx = _pack_mesh(center, size, color)
        pos_view = add_view(pos, 34962)
        nrm_view = add_view(nrm, 34962)
        col_view = add_view(col, 34962)
        idx_view = add_view(idx, 34963)
        pos_acc = len(accessors)
        accessors.append(
            {
                "bufferView": pos_view,
                "componentType": 5126,
                "count": 24,
                "type": "VEC3",
                "min": [center[i] - size[i] / 2 for i in range(3)],
                "max": [center[i] + size[i] / 2 for i in range(3)],
            }
        )
        nrm_acc = len(accessors)
        accessors.append({"bufferView": nrm_view, "componentType": 5126, "count": 24, "type": "VEC3"})
        col_acc = len(accessors)
        accessors.append({"bufferView": col_view, "componentType": 5126, "count": 24, "type": "VEC3"})
        idx_acc = len(accessors)
        accessors.append({"bufferView": idx_view, "componentType": 5123, "count": 36, "type": "SCALAR"})
        mat_index = len(materials)
        materials.append(
            {
                "name": f"{name}_mat",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [color[0] / 255.0, color[1] / 255.0, color[2] / 255.0, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.7,
                },
            }
        )
        mesh_index = len(meshes)
        meshes.append(
            {
                "name": name,
                "primitives": [
                    {
                        "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc, "COLOR_0": col_acc},
                        "indices": idx_acc,
                        "material": mat_index,
                    }
                ],
            }
        )
        nodes.append({"name": name, "mesh": mesh_index})

    return {
        "asset": {"version": "2.0", "generator": "sandbox-otherside-converter-fixture"},
        "scene": 0,
        "scenes": [{"name": "SandboxVoxelParts", "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [
            {
                "byteLength": len(buffer),
                "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(buffer)).decode("ascii"),
            }
        ],
    }


def main() -> None:
    here = Path(__file__).resolve().parent
    document = build_document()
    (here / "sandbox_voxel_parts.gltf").write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    leftover_bin = here / "sandbox_voxel_parts.bin"
    if leftover_bin.exists():
        leftover_bin.unlink()
    print(f"Wrote {here / 'sandbox_voxel_parts.gltf'} ({len(document['meshes'])} self-contained parts)")


if __name__ == "__main__":
    main()
