from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .blender_runner import blender_log, convert_avatar
from .inspect_gltf import inspect_gltf
from .mapping import load_mapping, summarize_mappings, write_mml
from .paths import default_mapping_path, default_odk_bones_path, default_odk_fbx_path


AVATAR_SUFFIXES = {".gltf", ".glb"}


def collect_avatar_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for raw in paths:
        path = Path(raw).expanduser().resolve()
        if path.is_dir():
            candidates = sorted(
                item
                for item in path.rglob("*")
                if item.is_file() and item.suffix.lower() in AVATAR_SUFFIXES
            )
        elif path.is_file() and path.suffix.lower() in AVATAR_SUFFIXES:
            candidates = [path]
        else:
            continue
        for candidate in candidates:
            if candidate not in seen:
                seen.add(candidate)
                files.append(candidate)
    return files


def inspect_and_map(path: Path, mapping_path: Path | None = None) -> dict[str, Any]:
    mapping = load_mapping(mapping_path or default_mapping_path())
    inspection = inspect_gltf(path)
    summary = summarize_mappings(inspection["meshNames"], mapping)
    return {**inspection, **summary}


def convert_one(
    input_path: Path,
    output_dir: Path,
    *,
    mapping_path: Path | None = None,
    blender_path: str | None = None,
    target_height: float | None = None,
) -> dict[str, Any]:
    mapping_file = mapping_path or default_mapping_path()
    mapping = load_mapping(mapping_file)
    inspection = inspect_gltf(input_path)
    summary = summarize_mappings(inspection["meshNames"], mapping)

    output_dir.mkdir(parents=True, exist_ok=True)
    stem = input_path.stem
    output_glb = output_dir / f"{stem}.glb"
    output_mml = output_dir / f"{stem}.mml"
    report_path = output_dir / f"{stem}.convert.json"

    result = convert_avatar(
        input_path,
        output_glb,
        mapping_file,
        armature_path=default_odk_fbx_path() if default_odk_fbx_path().is_file() else None,
        bones_path=default_odk_bones_path(),
        target_height=target_height if target_height is not None else mapping.get("targetHeightMeters"),
        blender_path=blender_path,
    )
    log = blender_log(result)
    ok = result.returncode == 0 and output_glb.is_file()
    if ok:
        write_mml(output_glb.name, output_mml)

    report = {
        "input": str(input_path),
        "outputGlb": str(output_glb) if output_glb.is_file() else None,
        "outputMml": str(output_mml) if output_mml.is_file() else None,
        "ok": ok,
        "returncode": result.returncode,
        "log": log,
        "mapped": summary["mapped"],
        "unmapped": summary["unmapped"],
        "fileSizeBytes": output_glb.stat().st_size if output_glb.is_file() else None,
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report
