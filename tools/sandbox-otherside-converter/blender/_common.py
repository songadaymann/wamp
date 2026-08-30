"""Helpers shared by Blender scripts. Import only from inside Blender."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))


def blender_cli_args() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def reset_scene() -> None:
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)


def select_only(objects) -> None:
    import bpy

    bpy.ops.object.select_all(action="DESELECT")
    active = None
    for obj in objects:
        obj.select_set(True)
        active = obj
    if active is not None:
        bpy.context.view_layer.objects.active = active


def apply_all_transforms(obj) -> None:
    import bpy

    select_only([obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def create_armature_from_spec(spec: dict[str, Any], name: str = "ODK_Base_Skeleton"):
    import bpy
    from mathutils import Vector

    arm_data = bpy.data.armatures.new(name)
    arm_obj = bpy.data.objects.new(name, arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for bone in spec.get("bones") or []:
        edit = arm_data.edit_bones.new(bone["name"])
        edit.head = Vector(bone["head"])
        edit.tail = Vector(bone["tail"])
        if (edit.tail - edit.head).length < 0.001:
            edit.tail = edit.head + Vector((0.0, 0.05, 0.0))
        created[bone["name"]] = edit
    for bone in spec.get("bones") or []:
        parent_name = bone.get("parent")
        if parent_name and parent_name in created:
            created[bone["name"]].parent = created[parent_name]
            created[bone["name"]].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def import_odk_armature(fbx_path: Path | None, bones_path: Path | None):
    import bpy

    existing = {obj.name for obj in bpy.data.objects}
    imported = None
    if fbx_path and fbx_path.is_file():
        bpy.ops.import_scene.fbx(filepath=str(fbx_path), automatic_bone_orientation=False)
        armatures = [
            obj
            for obj in bpy.data.objects
            if obj.type == "ARMATURE" and obj.name not in existing
        ]
        if armatures:
            imported = armatures[0]
            apply_all_transforms(imported)
            imported.name = "ODK_Base_Skeleton"

    if imported is None:
        if bones_path is None or not bones_path.is_file():
            raise FileNotFoundError("No ODK FBX and no odk_bones.json available to build an armature.")
        imported = create_armature_from_spec(load_json(bones_path))

    # Remove leftover FBX empties, cameras, lights, and any bind-pose meshes.
    for obj in list(bpy.data.objects):
        if obj == imported:
            continue
        if obj.type in {"CAMERA", "LIGHT", "EMPTY", "MESH"}:
            bpy.data.objects.remove(obj, do_unlink=True)
    return imported


def rigid_bind(armature, mesh, bone_name: str) -> None:
    import bpy

    if bone_name not in armature.data.bones:
        raise KeyError(f"ODK armature has no bone named {bone_name!r}")

    select_only([mesh, armature])
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_NAME")

    group = mesh.vertex_groups.get(bone_name)
    if group is None:
        group = mesh.vertex_groups.new(name=bone_name)
    indices = [vertex.index for vertex in mesh.data.vertices]
    if not indices:
        return
    group.add(indices, 1.0, "REPLACE")
    for other in mesh.vertex_groups:
        if other.name != bone_name:
            other.add(indices, 0.0, "REPLACE")


def assign_material(obj, name: str, color: tuple[float, float, float]) -> None:
    import bpy

    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if principled is not None:
        principled.inputs["Base Color"].default_value = (*color, 1.0)
        principled.inputs["Roughness"].default_value = 0.7
        principled.inputs["Metallic"].default_value = 0.0
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)


def mesh_world_bounds(meshes):
    from mathutils import Vector

    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
            found = True
    if not found:
        return None
    return mins, maxs
