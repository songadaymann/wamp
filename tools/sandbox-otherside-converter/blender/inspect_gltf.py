"""CLI / Blender-friendly inspector. Parsing does not require Blender."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from converter.inspect_gltf import inspect_gltf
from converter.mapping import load_mapping, summarize_mappings
from converter.paths import default_mapping_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect a Sandbox GLTF/GLB and apply the draft bone map.")
    parser.add_argument("input")
    parser.add_argument("--mapping", default=str(default_mapping_path()))
    parser.add_argument("--pretty", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    args = parser.parse_args(argv)

    inspection = inspect_gltf(args.input)
    mapping = load_mapping(args.mapping)
    summary = summarize_mappings(inspection["meshNames"], mapping)
    payload = {**inspection, **summary}
    print(json.dumps(payload, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
