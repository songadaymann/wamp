from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


MIN_PUNK_ID = 0
MAX_PUNK_ID = 9999
ATLAS_COLUMNS = 100
CELL_SIZE = 24
ATLAS_ROWS = ((MAX_PUNK_ID - MIN_PUNK_ID + 1) + ATLAS_COLUMNS - 1) // ATLAS_COLUMNS

DEFAULT_SOURCE_DIR = (
    Path(__file__).resolve().parent.parent.parent / "fling-punk" / "assets" / "punks"
)
DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parent.parent / "public" / "assets" / "cryptopunks" / "head-preview-atlas.png"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a single preview atlas containing all CryptoPunk head PNGs.",
    )
    parser.add_argument(
        "--source-dir",
        default=str(DEFAULT_SOURCE_DIR),
        help="Directory containing 0.png through 9999.png",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PATH),
        help="Output atlas PNG path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_dir = Path(args.source_dir).resolve()
    output_path = Path(args.output).resolve()

    if not source_dir.is_dir():
        raise SystemExit(f"Source punk directory not found: {source_dir}")

    atlas = Image.new(
        "RGBA",
        (ATLAS_COLUMNS * CELL_SIZE, ATLAS_ROWS * CELL_SIZE),
        (0, 0, 0, 0),
    )

    for punk_id in range(MIN_PUNK_ID, MAX_PUNK_ID + 1):
        punk_path = source_dir / f"{punk_id}.png"
        if not punk_path.is_file():
            raise SystemExit(f"Missing punk source image: {punk_path}")

        with Image.open(punk_path).convert("RGBA") as punk_image:
            if punk_image.size != (CELL_SIZE, CELL_SIZE):
                raise SystemExit(
                    f"Unexpected CryptoPunk size for {punk_path}: {punk_image.size}, expected {(CELL_SIZE, CELL_SIZE)}",
                )

            x = (punk_id % ATLAS_COLUMNS) * CELL_SIZE
            y = (punk_id // ATLAS_COLUMNS) * CELL_SIZE
            atlas.paste(punk_image, (x, y), punk_image)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output_path, optimize=True)
    print(f"Wrote CryptoPunk head preview atlas to {output_path}")


if __name__ == "__main__":
    main()
