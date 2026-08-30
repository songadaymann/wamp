from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Any

GLB_MAGIC = 0x46546C67
GLB_JSON_CHUNK = 0x4E4F534A


def load_gltf_document(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(file_path)
    suffix = file_path.suffix.lower()
    if suffix == ".glb":
        return _load_glb(file_path)
    if suffix in {".gltf", ".json"}:
        return json.loads(file_path.read_text(encoding="utf-8"))
    raise ValueError(f"Unsupported avatar file type: {file_path.suffix}")


def _load_glb(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 12:
        raise ValueError(f"GLB is too small: {path}")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"Not a GLB file: {path}")
    if version != 2:
        raise ValueError(f"Unsupported GLB version {version}: {path}")
    if length > len(data):
        raise ValueError(f"GLB length header exceeds file size: {path}")
    offset = 12
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == GLB_JSON_CHUNK:
            return json.loads(chunk.decode("utf-8"))
    raise ValueError(f"GLB has no JSON chunk: {path}")


def inspect_gltf(path: str | Path) -> dict[str, Any]:
    document = load_gltf_document(path)
    nodes = document.get("nodes") or []
    meshes = document.get("meshes") or []
    skins = document.get("skins") or []
    scenes = document.get("scenes") or []

    node_records: list[dict[str, Any]] = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        children = node.get("children") or []
        node_records.append(
            {
                "index": index,
                "name": node.get("name") or f"node_{index}",
                "mesh": node.get("mesh"),
                "skin": node.get("skin"),
                "children": children,
                "parent": None,
                "translation": node.get("translation"),
                "rotation": node.get("rotation"),
                "scale": node.get("scale"),
            }
        )

    for index, record in enumerate(node_records):
        for child in record["children"]:
            if isinstance(child, int) and 0 <= child < len(node_records):
                node_records[child]["parent"] = index

    mesh_records: list[dict[str, Any]] = []
    for index, mesh in enumerate(meshes):
        if not isinstance(mesh, dict):
            continue
        primitives = mesh.get("primitives") or []
        attached_nodes = [
            node["name"]
            for node in node_records
            if node.get("mesh") == index
        ]
        mesh_records.append(
            {
                "index": index,
                "name": mesh.get("name") or (attached_nodes[0] if attached_nodes else f"mesh_{index}"),
                "nodeNames": attached_nodes,
                "primitiveCount": len(primitives),
                "hasSkin": any(
                    isinstance(primitive, dict) and primitive.get("attributes", {}).get("JOINTS_0") is not None
                    for primitive in primitives
                ),
            }
        )

    skin_records: list[dict[str, Any]] = []
    for index, skin in enumerate(skins):
        if not isinstance(skin, dict):
            continue
        joints = []
        for joint_index in skin.get("joints") or []:
            if isinstance(joint_index, int) and 0 <= joint_index < len(node_records):
                joints.append(node_records[joint_index]["name"])
            else:
                joints.append(str(joint_index))
        skin_records.append(
            {
                "index": index,
                "name": skin.get("name") or f"skin_{index}",
                "joints": joints,
                "skeleton": skin.get("skeleton"),
            }
        )

    scene_nodes: list[str] = []
    scene_index = document.get("scene", 0)
    if isinstance(scene_index, int) and 0 <= scene_index < len(scenes):
        for node_index in scenes[scene_index].get("nodes") or []:
            if isinstance(node_index, int) and 0 <= node_index < len(node_records):
                scene_nodes.append(node_records[node_index]["name"])

    mesh_names = [mesh["name"] for mesh in mesh_records]
    return {
        "path": str(Path(path)),
        "filename": Path(path).name,
        "generator": (document.get("asset") or {}).get("generator"),
        "nodeCount": len(node_records),
        "meshCount": len(mesh_records),
        "skinCount": len(skin_records),
        "sceneNodes": scene_nodes,
        "nodes": node_records,
        "meshes": mesh_records,
        "skins": skin_records,
        "meshNames": mesh_names,
    }
