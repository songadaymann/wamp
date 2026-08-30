from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from .paths import convert_script_path, template_script_path

COMMON_BLENDER_PATHS = (
    "blender",
    "/usr/bin/blender",
    "/usr/local/bin/blender",
    "/opt/blender/blender",
    "/Applications/Blender.app/Contents/MacOS/Blender",
    r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
)


def detect_blender_path(explicit: str | None = None) -> str | None:
    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    env_path = os.environ.get("BLENDER_PATH")
    if env_path:
        candidates.append(env_path)
    which = shutil.which("blender")
    if which:
        candidates.append(which)
    candidates.extend(COMMON_BLENDER_PATHS)

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        path = Path(candidate)
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


def run_blender_script(
    script: Path,
    script_args: list[str],
    *,
    blender_path: str | None = None,
    timeout: int = 300,
) -> subprocess.CompletedProcess[str]:
    resolved = detect_blender_path(blender_path)
    if not resolved:
        raise FileNotFoundError(
            "Blender was not found. Install Blender 4.5 LTS and set BLENDER_PATH, "
            "or enter the binary path in the converter window."
        )
    command = [resolved, "--background", "--python", str(script), "--", *script_args]
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def convert_avatar(
    input_path: Path,
    output_glb: Path,
    mapping_path: Path,
    *,
    armature_path: Path | None = None,
    bones_path: Path | None = None,
    target_height: float | None = None,
    blender_path: str | None = None,
) -> subprocess.CompletedProcess[str]:
    args = [
        "--input",
        str(input_path),
        "--output",
        str(output_glb),
        "--mapping",
        str(mapping_path),
    ]
    if armature_path:
        args.extend(["--armature", str(armature_path)])
    if bones_path:
        args.extend(["--bones", str(bones_path)])
    if target_height is not None:
        args.extend(["--target-height", str(target_height)])
    return run_blender_script(convert_script_path(), args, blender_path=blender_path)


def build_skeleton_template(
    output_blend: Path,
    *,
    fbx_path: Path | None = None,
    bones_path: Path | None = None,
    overlay_path: Path | None = None,
    blender_path: str | None = None,
) -> subprocess.CompletedProcess[str]:
    args = ["--output", str(output_blend)]
    if fbx_path:
        args.extend(["--fbx", str(fbx_path)])
    if bones_path:
        args.extend(["--bones", str(bones_path)])
    if overlay_path:
        args.extend(["--overlay", str(overlay_path)])
    return run_blender_script(template_script_path(), args, blender_path=blender_path, timeout=180)


def blender_log(result: subprocess.CompletedProcess[str]) -> str:
    chunks = []
    if result.stdout:
        chunks.append(result.stdout.strip())
    if result.stderr:
        chunks.append(result.stderr.strip())
    return "\n".join(chunk for chunk in chunks if chunk)


def require_python() -> str:
    return sys.executable
