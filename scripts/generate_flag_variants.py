#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


FRAME_WIDTH = 32
CHECKER_SIZE = 4

CLOTH_LIGHT = (203, 77, 104, 255)
CLOTH_DARK = (130, 36, 82, 255)

SOLID_PALETTES: dict[str, tuple[tuple[int, int, int, int], tuple[int, int, int, int]]] = {
    "green": ((86, 196, 120, 255), (46, 122, 75, 255)),
    "gold": ((240, 198, 84, 255), (177, 126, 32, 255)),
}

CHECKERED_PALETTES: dict[
    str,
    tuple[
        tuple[tuple[int, int, int, int], tuple[int, int, int, int]],
        tuple[tuple[int, int, int, int], tuple[int, int, int, int]],
    ],
] = {
    "checkered": (
        ((248, 248, 248, 255), (206, 206, 206, 255)),
        ((102, 103, 126, 255), (58, 54, 82, 255)),
    ),
    "checkered-gold": (
        ((255, 247, 226, 255), (224, 210, 172, 255)),
        ((240, 198, 84, 255), (177, 126, 32, 255)),
    ),
}


def is_cloth_pixel(rgba: tuple[int, int, int, int]) -> bool:
    return rgba == CLOTH_LIGHT or rgba == CLOTH_DARK


def remap_solid(
    image: Image.Image,
    palette: tuple[tuple[int, int, int, int], tuple[int, int, int, int]],
) -> Image.Image:
    output = image.copy()
    pixels = output.load()
    assert pixels is not None

    for y in range(output.height):
        for x in range(output.width):
            rgba = pixels[x, y]
            if rgba == CLOTH_LIGHT:
                pixels[x, y] = palette[0]
            elif rgba == CLOTH_DARK:
                pixels[x, y] = palette[1]

    return output


def remap_checkered(
    image: Image.Image,
    palette_a: tuple[tuple[int, int, int, int], tuple[int, int, int, int]],
    palette_b: tuple[tuple[int, int, int, int], tuple[int, int, int, int]],
) -> Image.Image:
    output = image.copy()
    pixels = output.load()
    assert pixels is not None

    for y in range(output.height):
        for x in range(output.width):
            rgba = pixels[x, y]
            if not is_cloth_pixel(rgba):
                continue

            frame_x = x % FRAME_WIDTH
            checker_index = ((frame_x // CHECKER_SIZE) + (y // CHECKER_SIZE)) % 2
            palette = palette_a if checker_index == 0 else palette_b
            pixels[x, y] = palette[0] if rgba == CLOTH_LIGHT else palette[1]

    return output


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate flag color variants from public/assets/objects/flag.png"
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("public/assets/objects/flag.png"),
        help="Source flag sprite sheet",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("public/assets/objects"),
        help="Output directory for generated variants",
    )
    args = parser.parse_args()

    source_path = args.source
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    source = Image.open(source_path).convert("RGBA")

    for name, palette in SOLID_PALETTES.items():
        remap_solid(source, palette).save(out_dir / f"flag-{name}.png")

    for name, (palette_a, palette_b) in CHECKERED_PALETTES.items():
        remap_checkered(source, palette_a, palette_b).save(out_dir / f"flag-{name}.png")

    print("Generated:")
    for name in [*SOLID_PALETTES.keys(), *CHECKERED_PALETTES.keys()]:
        print(f"- {out_dir / f'flag-{name}.png'}")


if __name__ == "__main__":
    main()
