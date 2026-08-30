from __future__ import annotations

from converter.mapping import load_mapping, resolve_mesh, summarize_mappings, write_mml
from converter.paths import default_mapping_path


EXPECTED = {
    "Head": "head",
    "Torso": "spine_03",
    "Hip": "pelvis",
    "UpperArm_L": "upperarm_l",
    "ForeArm_L": "lowerarm_l",
    "Hand_L": "hand_l",
    "UpperArm_R": "upperarm_r",
    "ForeArm_R": "lowerarm_r",
    "Hand_R": "hand_r",
    "UpperLeg_L": "thigh_l",
    "LowerLeg_L": "calf_l",
    "Foot_L": "foot_l",
    "UpperLeg_R": "thigh_r",
    "LowerLeg_R": "calf_r",
    "Foot_R": "foot_r",
}


def test_default_mapping_resolves_sandbox_style_names() -> None:
    mapping = load_mapping(default_mapping_path())
    for mesh_name, bone in EXPECTED.items():
        part = resolve_mesh(mesh_name, mapping)
        assert part is not None, mesh_name
        assert part["bone"] == bone, (mesh_name, part["bone"])


def test_longer_alias_wins_over_generic_leg() -> None:
    mapping = load_mapping(default_mapping_path())
    part = resolve_mesh("UpperLeg_L", mapping)
    assert part is not None
    assert part["bone"] == "thigh_l"


def test_unmapped_names_are_reported() -> None:
    mapping = load_mapping(default_mapping_path())
    summary = summarize_mappings(["Head", "Cape_FX", "UnknownBlob"], mapping)
    assert summary["mappedCount"] == 1
    assert summary["unmapped"] == ["Cape_FX", "UnknownBlob"]


def test_write_mml(tmp_path) -> None:
    path = tmp_path / "hero.mml"
    write_mml("hero.glb", path)
    assert path.read_text(encoding="utf-8") == '<m-character src="hero.glb"></m-character>\n'
