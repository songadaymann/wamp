from __future__ import annotations

import os

import pytest

from converter.blender_runner import blender_log, build_skeleton_template, detect_blender_path
from converter.paths import FIXTURES_DIR, default_odk_bones_path, default_odk_fbx_path


def test_build_compare_blend(tmp_path) -> None:
    blender = detect_blender_path(os.environ.get("BLENDER_PATH"))
    if not blender:
        pytest.skip("Blender is not installed; template smoke test is optional.")

    output = tmp_path / "ODK_Sandbox_Compare.blend"
    result = build_skeleton_template(
        output,
        fbx_path=default_odk_fbx_path(),
        bones_path=default_odk_bones_path(),
        overlay_path=FIXTURES_DIR / "sandbox_voxel_parts.gltf",
        blender_path=blender,
    )
    assert result.returncode == 0, blender_log(result)
    assert output.is_file()
    assert output.stat().st_size > 100_000
    assert "TEMPLATE_SAVED" in blender_log(result)
    assert "ARMATURE_BONES" in blender_log(result)
