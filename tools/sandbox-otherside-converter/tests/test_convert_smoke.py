from __future__ import annotations

import json
import os

import pytest

from converter.blender_runner import detect_blender_path
from converter.inspect_gltf import inspect_gltf
from converter.jobs import convert_one
from converter.paths import FIXTURES_DIR, default_mapping_path


def test_convert_smoke_on_fixture(tmp_path) -> None:
    blender = detect_blender_path(os.environ.get("BLENDER_PATH"))
    if not blender:
        pytest.skip("Blender is not installed; convert smoke test is optional.")

    report = convert_one(
        FIXTURES_DIR / "sandbox_voxel_parts.gltf",
        tmp_path,
        mapping_path=default_mapping_path(),
        blender_path=blender,
        target_height=1.8,
    )
    assert report["ok"], report.get("log")
    assert report["outputGlb"]
    assert report["outputMml"]
    glb = inspect_gltf(report["outputGlb"])
    assert glb["skinCount"] >= 1
    joint_names = {name for skin in glb["skins"] for name in skin["joints"]}
    assert "head" in joint_names
    assert "lowerarm_l" in joint_names
    sidecar = json.loads((tmp_path / "sandbox_voxel_parts.convert.json").read_text(encoding="utf-8"))
    assert sidecar["ok"] is True
    assert (tmp_path / "sandbox_voxel_parts.mml").read_text(encoding="utf-8").startswith("<m-character")
