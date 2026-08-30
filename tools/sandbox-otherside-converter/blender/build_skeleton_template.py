"""Build ODK_Sandbox_Compare.blend: official (or rebuilt) ODK rig + rigid voxel cubes + height ruler."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BLENDER_DIR = Path(__file__).resolve().parent
if str(_BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(_BLENDER_DIR))

from _common import (
    PACKAGE_ROOT,
    assign_material,
    blender_cli_args,
    import_odk_armature,
    load_json,
    reset_scene,
    rigid_bind,
    select_only,
)

if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from converter.paths import (  # noqa: E402
    default_compare_blend_path,
    default_odk_bones_path,
    default_odk_fbx_path,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the Otherside comparison skeleton .blend")
    parser.add_argument("--output")
    parser.add_argument("--fbx")
    parser.add_argument("--bones")
    parser.add_argument("--overlay")
    return parser.parse_args(blender_cli_args())


def bone_world_center(armature, bone_name: str):
    from mathutils import Vector

    bone = armature.pose.bones[bone_name]
    head = armature.matrix_world @ bone.head
    tail = armature.matrix_world @ bone.tail
    return (head + tail) * 0.5, (tail - head)


def add_placeholder_cubes(armature, spec: dict) -> list:
    import bpy

    cubes = []
    placeholders = spec.get("placeholderCubes") or {}
    bind_bones = spec.get("voxelBindBones") or list(placeholders)
    collection = bpy.data.collections.new("ODK_VoxelPlaceholders")
    bpy.context.scene.collection.children.link(collection)

    for bone_name in bind_bones:
        if bone_name not in armature.pose.bones:
            print(f"SKIP placeholder, missing bone: {bone_name}")
            continue
        meta = placeholders.get(bone_name) or {"size": [0.1, 0.1, 0.1], "color": [0.7, 0.7, 0.7]}
        center, _delta = bone_world_center(armature, bone_name)
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
        cube = bpy.context.active_object
        cube.name = f"voxel_{bone_name}"
        size = meta.get("size") or [0.1, 0.1, 0.1]
        cube.scale = (float(size[0]) / 2.0, float(size[1]) / 2.0, float(size[2]) / 2.0)
        bpy.ops.object.transform_apply(scale=True)
        color = tuple(float(channel) for channel in (meta.get("color") or [0.7, 0.7, 0.7]))
        assign_material(cube, f"mat_{bone_name}", color)
        for col in list(cube.users_collection):
            col.objects.unlink(cube)
        collection.objects.link(cube)
        rigid_bind(armature, cube, bone_name)
        cubes.append(cube)
    return cubes


def add_height_ruler() -> None:
    import bpy

    collection = bpy.data.collections.new("HeightRuler")
    bpy.context.scene.collection.children.link(collection)

    bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=2.1, location=(0.85, 0.0, 1.05))
    pole = bpy.context.active_object
    pole.name = "ruler_pole"
    assign_material(pole, "mat_ruler", (0.85, 0.85, 0.88))

    marks = (
        (1.0, "1.0m min", (0.35, 0.75, 0.45)),
        (1.8, "1.8m Voyager", (0.95, 0.78, 0.25)),
        (2.0, "2.0m max", (0.9, 0.35, 0.3)),
    )
    objects = [pole]
    for height, label, color in marks:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.78, 0.0, height))
        tick = bpy.context.active_object
        tick.name = f"ruler_{label.split()[0]}"
        tick.scale = (0.12, 0.02, 0.01)
        bpy.ops.object.transform_apply(scale=True)
        assign_material(tick, f"mat_ruler_{tick.name}", color)
        bpy.ops.object.text_add(location=(0.95, 0.0, height - 0.03))
        text = bpy.context.active_object
        text.name = f"ruler_label_{label.split()[0]}"
        text.data.body = label
        text.data.size = 0.06
        text.rotation_euler[0] = 1.57079632679
        assign_material(text, f"mat_label_{tick.name}", color)
        objects.extend([tick, text])

    for obj in objects:
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        collection.objects.link(obj)


def overlay_sandbox(path: Path) -> None:
    import bpy

    existing = {obj.name for obj in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.data.objects if obj.name not in existing]
    collection = bpy.data.collections.new("SandboxOverlay")
    bpy.context.scene.collection.children.link(collection)
    for obj in imported:
        obj.location.x -= 1.4
        for col in list(obj.users_collection):
            try:
                col.objects.unlink(obj)
            except RuntimeError:
                pass
        collection.objects.link(obj)
    print(f"OVERLAY imported {len(imported)} objects from {path}")


def main() -> int:
    args = parse_args()
    output = Path(args.output).expanduser() if args.output else default_compare_blend_path()
    fbx_path = Path(args.fbx).expanduser() if args.fbx else default_odk_fbx_path()
    bones_path = Path(args.bones).expanduser() if args.bones else default_odk_bones_path()
    overlay = Path(args.overlay).expanduser() if args.overlay else None

    reset_scene()
    armature = import_odk_armature(
        fbx_path if fbx_path.is_file() else None,
        bones_path if bones_path.is_file() else None,
    )
    spec = load_json(bones_path)
    add_placeholder_cubes(armature, spec)
    add_height_ruler()
    if overlay and overlay.is_file():
        overlay_sandbox(overlay)

    output.parent.mkdir(parents=True, exist_ok=True)
    import bpy

    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    print(f"TEMPLATE_SAVED {output}")
    print(f"ARMATURE_BONES {len(armature.data.bones)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
