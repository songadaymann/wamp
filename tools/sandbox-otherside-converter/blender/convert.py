"""Headless Blender convert: Sandbox voxel GLTF → Otherside ODK GLB (rigid bind)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_BLENDER_DIR = Path(__file__).resolve().parent
if str(_BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(_BLENDER_DIR))

from _common import (
    PACKAGE_ROOT,
    apply_all_transforms,
    blender_cli_args,
    import_odk_armature,
    mesh_world_bounds,
    reset_scene,
    rigid_bind,
    select_only,
)

if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from converter.mapping import load_mapping, resolve_mesh, write_mml  # noqa: E402
from converter.paths import default_odk_bones_path, default_odk_fbx_path  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert a Sandbox avatar GLTF/GLB to an Otherside ODK GLB.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--armature")
    parser.add_argument("--bones")
    parser.add_argument("--target-height", type=float)
    return parser.parse_args(blender_cli_args())


def strip_sandbox_rig(meshes) -> list[str]:
    import bpy

    removed: list[str] = []
    for mesh in meshes:
        select_only([mesh])
        if mesh.parent:
            bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)
        mesh.vertex_groups.clear()
        if mesh.animation_data:
            mesh.animation_data_clear()

    for obj in list(bpy.data.objects):
        if obj.type == "ARMATURE" and obj.name != "ODK_Base_Skeleton":
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    if bpy.data.actions:
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
    return removed


def apply_global_and_fit(meshes, mapping: dict, target_height: float | None) -> dict:
    import bpy
    from math import radians
    from mathutils import Euler, Vector

    global_scale = float(mapping.get("globalScale") or 1.0)
    rotation = mapping.get("globalRotationEulerDeg") or [0, 0, 0]
    euler = Euler(tuple(radians(float(value)) for value in rotation), "XYZ")

    for mesh in meshes:
        mesh.rotation_euler.rotate(euler)
    for mesh in meshes:
        apply_all_transforms(mesh)

    bounds = mesh_world_bounds(meshes)
    height = None
    scale_used = global_scale
    if bounds:
        mins, maxs = bounds
        height = float(maxs.z - mins.z)
        if target_height and height > 1e-6:
            scale_used = (float(target_height) / height) * global_scale
        for mesh in meshes:
            mesh.scale *= scale_used
            mesh.location = Vector(mesh.location) * scale_used
        for mesh in meshes:
            apply_all_transforms(mesh)
        # Sit feet on z=0 after scale.
        bounds = mesh_world_bounds(meshes)
        if bounds:
            mins, maxs = bounds
            lift = -mins.z
            for mesh in meshes:
                mesh.location.z += lift
            for mesh in meshes:
                apply_all_transforms(mesh)
            height = float(maxs.z - mins.z)
    return {"heightBeforeFit": height, "scaleUsed": scale_used}


def apply_part_transform(mesh, part: dict) -> None:
    from math import radians
    from mathutils import Euler, Vector

    rotation = part.get("rotationEulerDeg") or [0, 0, 0]
    offset = part.get("offset") or [0, 0, 0]
    mesh.rotation_euler.rotate(Euler(tuple(radians(float(value)) for value in rotation), "XYZ"))
    mesh.location += Vector((float(offset[0]), float(offset[1]), float(offset[2])))
    apply_all_transforms(mesh)


def export_glb(path: Path) -> None:
    import bpy

    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_skins=True,
        export_animations=False,
        export_current_frame=True,
        export_normals=True,
        export_tangents=False,
        export_image_format="AUTO",
        use_visible=True,
        export_apply=False,
    )


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    mapping_path = Path(args.mapping).expanduser().resolve()
    armature_path = Path(args.armature).expanduser() if args.armature else default_odk_fbx_path()
    bones_path = Path(args.bones).expanduser() if args.bones else default_odk_bones_path()

    if not input_path.is_file():
        print(f"ERROR: input not found: {input_path}", file=sys.stderr)
        return 2

    mapping = load_mapping(mapping_path)
    target_height = args.target_height
    if target_height is None:
        target_height = mapping.get("targetHeightMeters")

    reset_scene()
    import bpy

    armature = import_odk_armature(
        armature_path if armature_path.is_file() else None,
        bones_path if bones_path.is_file() else None,
    )

    before_meshes = {obj.name for obj in bpy.data.objects if obj.type == "MESH"}
    suffix = input_path.suffix.lower()
    if suffix == ".glb":
        bpy.ops.import_scene.gltf(filepath=str(input_path))
    else:
        bpy.ops.import_scene.gltf(filepath=str(input_path))

    meshes = [
        obj
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.name not in before_meshes
    ]
    if not meshes:
        print("ERROR: no meshes imported from Sandbox file", file=sys.stderr)
        return 3

    removed_armatures = strip_sandbox_rig(meshes)
    fit = apply_global_and_fit(meshes, mapping, float(target_height) if target_height else None)

    mapped = []
    unmapped = []
    for mesh in meshes:
        part = resolve_mesh(mesh.name, mapping)
        if part is None:
            unmapped.append(mesh.name)
            mesh.hide_set(True)
            mesh.hide_render = True
            continue
        bone = str(part.get("bone") or "")
        apply_part_transform(mesh, part)
        rigid_bind(armature, mesh, bone)
        mapped.append({"mesh": mesh.name, "bone": bone, "partId": part.get("id")})

    if not mapped:
        print("ERROR: no meshes matched the bone map; nothing to export", file=sys.stderr)
        print("UNMAPPED " + json.dumps(unmapped))
        return 4

    select_only([armature, *[mesh for mesh in meshes if not mesh.hide_get()]])
    export_glb(output_path)
    write_mml(output_path.name, output_path.with_suffix(".mml"))

    report = {
        "ok": True,
        "input": str(input_path),
        "output": str(output_path),
        "mapped": mapped,
        "unmapped": unmapped,
        "removedArmatures": removed_armatures,
        **fit,
        "triangleHint": sum(len(mesh.data.polygons) for mesh in meshes if not mesh.hide_get()),
    }
    print("CONVERT_REPORT " + json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
