from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def load_mapping(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("parts"), list):
        raise ValueError(f"Mapping file must be an object with a parts array: {path}")
    return data


def _normalize(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def _needle_score(name: str, needle: str) -> int:
    if not needle:
        return 0
    lowered = name.lower()
    raw = needle.lower()
    compact_name = _normalize(name)
    compact_needle = _normalize(needle)
    if lowered == raw or compact_name == compact_needle:
        return 1000 + len(compact_needle)
    if raw and raw in lowered:
        return 100 + len(raw)
    # Compact contains is only used when the needle is a full token-ish alias
    # (avoids "leg_l" stealing "UpperLeg_L").
    if compact_needle and len(compact_needle) >= 6 and compact_needle in compact_name:
        return 50 + len(compact_needle)
    return 0


def match_score(mesh_name: str, part: dict[str, Any]) -> int:
    match = part.get("match") or {}
    if not isinstance(match, dict):
        return 0

    exact = match.get("exact") or match.get("nameEquals")
    if exact is not None:
        values = exact if isinstance(exact, list) else [exact]
        best = 0
        for value in values:
            best = max(best, _needle_score(mesh_name, str(value)))
        return best

    pattern = match.get("regex")
    if pattern:
        found = re.search(pattern, mesh_name, re.IGNORECASE)
        return 80 + len(found.group(0)) if found else 0

    contains = match.get("nameContains") or []
    if isinstance(contains, str):
        contains = [contains]
    return max((_needle_score(mesh_name, str(item)) for item in contains), default=0)


def part_matches(mesh_name: str, part: dict[str, Any]) -> bool:
    return match_score(mesh_name, part) > 0


def resolve_mesh(mesh_name: str, mapping: dict[str, Any]) -> dict[str, Any] | None:
    best_part = None
    best_score = 0
    for part in mapping.get("parts") or []:
        if not isinstance(part, dict):
            continue
        score = match_score(mesh_name, part)
        if score > best_score:
            best_score = score
            best_part = part
    return best_part


def summarize_mappings(
    mesh_names: list[str],
    mapping: dict[str, Any],
) -> dict[str, Any]:
    mapped: list[dict[str, str]] = []
    unmapped: list[str] = []
    for name in mesh_names:
        part = resolve_mesh(name, mapping)
        if part is None:
            unmapped.append(name)
            continue
        mapped.append(
            {
                "mesh": name,
                "partId": str(part.get("id") or part.get("bone") or ""),
                "bone": str(part.get("bone") or ""),
            }
        )
    return {
        "mapped": mapped,
        "unmapped": unmapped,
        "mappedCount": len(mapped),
        "unmappedCount": len(unmapped),
        "draft": bool(mapping.get("draft")),
    }


def write_mml(glb_filename: str, output_path: str | Path) -> None:
    name = Path(glb_filename).name
    Path(output_path).write_text(
        f'<m-character src="{name}"></m-character>\n',
        encoding="utf-8",
    )
