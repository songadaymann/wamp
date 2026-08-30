from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from converter.jobs import collect_avatar_files
from converter.paths import FIXTURES_DIR, PACKAGE_ROOT


def test_collect_avatar_files_from_folder() -> None:
    files = collect_avatar_files([str(FIXTURES_DIR)])
    names = {path.name for path in files}
    assert "sandbox_voxel_parts.gltf" in names


def test_app_inspect_cli() -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(PACKAGE_ROOT / "app.py"),
            "inspect",
            str(FIXTURES_DIR / "sandbox_voxel_parts.gltf"),
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["meshCount"] == 15
    assert payload["unmapped"] == []
    assert Path(payload["path"]).name == "sandbox_voxel_parts.gltf"
