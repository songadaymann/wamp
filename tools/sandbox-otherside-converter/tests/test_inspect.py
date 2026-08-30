from __future__ import annotations

from converter.inspect_gltf import inspect_gltf, load_gltf_document
from converter.jobs import inspect_and_map
from converter.mapping import load_mapping, summarize_mappings
from converter.paths import FIXTURES_DIR, default_mapping_path


def test_inspect_fixture_lists_all_voxel_parts() -> None:
    path = FIXTURES_DIR / "sandbox_voxel_parts.gltf"
    document = load_gltf_document(path)
    assert document["asset"]["generator"] == "sandbox-otherside-converter-fixture"
    inspection = inspect_gltf(path)
    assert inspection["meshCount"] == 15
    assert "Head" in inspection["meshNames"]
    assert "ForeArm_L" in inspection["meshNames"]
    assert inspection["skinCount"] == 0


def test_inspect_and_map_fixture_has_no_unmapped_parts() -> None:
    result = inspect_and_map(FIXTURES_DIR / "sandbox_voxel_parts.gltf", default_mapping_path())
    assert result["unmapped"] == []
    bones = {row["bone"] for row in result["mapped"]}
    assert {"head", "lowerarm_l", "hand_r", "thigh_l", "foot_r"} <= bones


def test_mapping_file_is_draft() -> None:
    mapping = load_mapping(default_mapping_path())
    assert mapping["draft"] is True
    summary = summarize_mappings(["Head"], mapping)
    assert summary["draft"] is True
