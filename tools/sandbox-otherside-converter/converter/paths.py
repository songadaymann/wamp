from __future__ import annotations

from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PACKAGE_ROOT / "config"
TEMPLATES_DIR = PACKAGE_ROOT / "templates"
BLENDER_DIR = PACKAGE_ROOT / "blender"
UI_DIR = PACKAGE_ROOT / "ui"
FIXTURES_DIR = PACKAGE_ROOT / "fixtures"


def default_mapping_path() -> Path:
    return CONFIG_DIR / "mapping.default.json"


def default_odk_bones_path() -> Path:
    return CONFIG_DIR / "odk_bones.json"


def default_odk_fbx_path() -> Path:
    return TEMPLATES_DIR / "ODK_Base_Skeleton.fbx"


def default_compare_blend_path() -> Path:
    return TEMPLATES_DIR / "ODK_Sandbox_Compare.blend"


def convert_script_path() -> Path:
    return BLENDER_DIR / "convert.py"


def template_script_path() -> Path:
    return BLENDER_DIR / "build_skeleton_template.py"
