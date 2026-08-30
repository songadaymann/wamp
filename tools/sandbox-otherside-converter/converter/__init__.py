"""Sandbox voxel GLTF → Otherside ODK GLB converter (library, no Blender required)."""

from .inspect_gltf import inspect_gltf, load_gltf_document
from .mapping import load_mapping, resolve_mesh, summarize_mappings
from .paths import PACKAGE_ROOT, default_mapping_path, default_odk_bones_path, default_odk_fbx_path

__all__ = [
    "PACKAGE_ROOT",
    "default_mapping_path",
    "default_odk_bones_path",
    "default_odk_fbx_path",
    "inspect_gltf",
    "load_gltf_document",
    "load_mapping",
    "resolve_mesh",
    "summarize_mappings",
]
