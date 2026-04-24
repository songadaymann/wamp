from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> int:
    return sum((a - b) ** 2 for a, b in zip(left, right))


def luminance(color: tuple[int, int, int, int]) -> float:
    r, g, b, _ = color
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def is_black(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    return a > 0 and r == 0 and g == 0 and b == 0


def build_generated_palette(base: tuple[int, int, int, int]) -> list[tuple[int, int, int, int]]:
    scales = [1.0, 0.85, 0.70]
    generated = []

    for scale in scales:
        generated.append(
            tuple(max(0, min(255, int(channel * scale))) for channel in base[:3]) + (255,)
        )

    return generated


def build_reference_palette(
    edited: Image.Image,
    include_black: bool = False,
) -> list[tuple[int, int, int, int]]:
    counter: Counter[tuple[int, int, int, int]] = Counter()

    for pixel in edited.getdata():
        if pixel[3] == 0 or (is_black(pixel) and not include_black):
            continue
        counter[pixel] += 1

    colors = sorted(counter, key=lambda color: (-counter[color], -luminance(color)))
    if not colors:
        raise ValueError("Edited image contains no non-black opaque colors.")

    unique = sorted(colors[:3], key=luminance, reverse=True)

    if len(unique) == 1:
        return build_generated_palette(unique[0])

    if len(unique) == 2:
        light, dark = unique
        mid = tuple(int((a + b) / 2) for a, b in zip(light[:3], dark[:3])) + (255,)
        return [light, mid, dark]

    return unique[:3]


def nearest_tone_index(color: tuple[int, int, int, int], palette: list[tuple[int, int, int, int]]) -> int:
    rgb = color[:3]
    distances = [color_distance(rgb, candidate[:3]) for candidate in palette]
    return min(range(len(distances)), key=distances.__getitem__)


def build_sample_points(operations: list[dict[str, int | str]]) -> list[list[int]]:
    fill_points = [(entry["x"], entry["y"]) for entry in operations if entry["op"] == "fill"]

    if not fill_points:
        return []

    min_y = min(y for _, y in fill_points)
    max_y = max(y for _, y in fill_points)
    cutoff = min_y + int((max_y - min_y + 1) * 0.6)

    preferred = [(x, y) for x, y in fill_points if y <= cutoff]
    preferred = sorted(set(preferred), key=lambda point: (point[1], point[0]))

    if len(preferred) <= 24:
        return [[x, y] for x, y in preferred]

    step = max(1, len(preferred) // 24)
    sampled = preferred[::step][:24]
    return [[x, y] for x, y in sampled]


def bootstrap_template(
    source_path: Path,
    edited_path: Path,
    output_path: Path,
    name: str,
    include_black_samples: bool = False,
) -> None:
    source = Image.open(source_path).convert("RGBA")
    edited = Image.open(edited_path).convert("RGBA")

    if source.size != edited.size:
        raise ValueError(f"Source size {source.size} does not match edited size {edited.size}.")

    palette = build_reference_palette(edited, include_black_samples)
    operations: list[dict[str, int | str]] = []

    source_pixels = source.load()
    edited_pixels = edited.load()
    width, height = source.size

    for y in range(height):
        for x in range(width):
            source_pixel = source_pixels[x, y]
            edited_pixel = edited_pixels[x, y]

            if source_pixel == edited_pixel:
                continue

            if edited_pixel[3] == 0:
                operations.append({"x": x, "y": y, "op": "clear"})
                continue

            if is_black(edited_pixel):
                operations.append({"x": x, "y": y, "op": "black"})
                continue

            operations.append(
                {
                    "x": x,
                    "y": y,
                    "op": "fill",
                    "tone": nearest_tone_index(edited_pixel, palette),
                }
            )

    template = {
        "name": name,
        "width": width,
        "height": height,
        "referencePalette": [list(color) for color in palette],
        "samplePoints": build_sample_points(operations),
        "includeBlackSamples": include_black_samples,
        "operations": operations,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(template, indent=2)}\n", encoding="utf8")


def infer_target_palette(
    image: Image.Image,
    sample_points: list[list[int]],
    include_black: bool = False,
) -> list[tuple[int, int, int, int]]:
    pixels = image.load()
    counter: Counter[tuple[int, int, int, int]] = Counter()

    for x, y in sample_points:
        pixel = pixels[x, y]
        if pixel[3] == 0 or (is_black(pixel) and not include_black):
            continue
        counter[pixel] += 1

    if not counter:
        for pixel in image.getdata():
            if pixel[3] == 0 or (is_black(pixel) and not include_black):
                continue
            counter[pixel] += 1

    if not counter:
        raise ValueError("Unable to infer a target skin palette from the source image.")

    dominant_color, dominant_count = counter.most_common(1)[0]
    if include_black and is_black(dominant_color) and dominant_count >= max(1, sum(counter.values()) // 2):
        return build_generated_palette(dominant_color)

    colors = sorted(counter, key=lambda color: (-counter[color], -luminance(color)))
    palette = sorted(colors[:3], key=luminance, reverse=True)

    if len(palette) == 1:
        return build_generated_palette(palette[0])

    if len(palette) == 2:
        light, dark = palette
        mid = tuple(int((a + b) / 2) for a, b in zip(light[:3], dark[:3])) + (255,)
        return [light, mid, dark]

    return palette[:3]


def apply_template(
    source_path: Path,
    template_path: Path,
    output_path: Path,
    target_palette: list[tuple[int, int, int, int]] | None = None,
) -> None:
    source = Image.open(source_path).convert("RGBA")
    template = json.loads(template_path.read_text(encoding="utf8"))

    if source.size != (template["width"], template["height"]):
        raise ValueError(
            f"Source size {source.size} does not match template size {(template['width'], template['height'])}.",
        )

    palette = target_palette or infer_target_palette(
        source,
        template.get("samplePoints", []),
        bool(template.get("includeBlackSamples", False)),
    )
    output = source.copy()
    pixels = output.load()

    for operation in template["operations"]:
        x = int(operation["x"])
        y = int(operation["y"])
        op = operation["op"]

        if op == "clear":
            pixels[x, y] = (0, 0, 0, 0)
            continue

        if op == "black":
            pixels[x, y] = (0, 0, 0, 255)
            continue

        if op == "fill":
            tone = int(operation["tone"])
            pixels[x, y] = palette[min(tone, len(palette) - 1)]
            continue

        raise ValueError(f"Unsupported operation: {op}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)


CANONICAL_BASE_HEX = {
    "Alien": "#C8FBFB",
    "Ape": "#352410",
    "Zombie": "#7DA269",
    "Albino": "#EAD9D9",
    "Light": "#DBB180",
    "Medium": "#AE8B61",
    "Dark": "#713F1D",
}


def hex_to_rgba(hex_color: str) -> tuple[int, int, int, int]:
    normalized = hex_color.strip().lstrip("#")
    return (
        int(normalized[0:2], 16),
        int(normalized[2:4], 16),
        int(normalized[4:6], 16),
        255,
    )


def resolve_palette_family(punk: dict[str, Any]) -> str:
    punk_type = punk.get("type")
    if punk_type == "Alien":
        return "Alien"
    if punk_type == "Ape":
        return "Ape"
    if punk_type == "Zombie":
        return "Zombie"

    skin_tone = punk.get("skinTone")
    if skin_tone == "Albino":
        return "Albino"
    if skin_tone == "Light":
        return "Light"
    if skin_tone == "Medium":
        return "Medium"
    if skin_tone == "Dark":
        return "Dark"

    raise ValueError(f"Unable to resolve palette family for punk {punk.get('id')}.")


def recolor_relative_to_base(
    pixel: tuple[int, int, int, int],
    source_base: tuple[int, int, int, int],
    target_base: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    recolored = []

    for source_channel, target_channel, value in zip(source_base[:3], target_base[:3], pixel[:3]):
        if source_channel <= 0:
            recolored.append(target_channel)
            continue
        recolored.append(max(0, min(255, round(target_channel * (value / source_channel)))))

    return tuple(recolored) + (pixel[3],)


def render_manual_seed_transfer(
    seed_image_path: Path,
    template_path: Path,
    output_path: Path,
    *,
    source_family: str,
    target_family: str,
    recolor_fill_pixels: bool,
) -> None:
    image = Image.open(seed_image_path).convert("RGBA")
    output = image.copy()

    if recolor_fill_pixels and source_family != target_family:
        template = json.loads(template_path.read_text(encoding="utf8"))
        source_base = hex_to_rgba(CANONICAL_BASE_HEX[source_family])
        target_base = hex_to_rgba(CANONICAL_BASE_HEX[target_family])
        pixels = output.load()

        for operation in template.get("operations", []):
            if operation.get("op") != "fill":
                continue
            x = int(operation["x"])
            y = int(operation["y"])
            pixels[x, y] = recolor_relative_to_base(pixels[x, y], source_base, target_base)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf8"))


def load_metadata(metadata_path: Path) -> list[dict[str, Any]]:
    metadata = load_json(metadata_path)
    if not isinstance(metadata, list):
        raise ValueError(f"Expected list metadata in {metadata_path}.")
    return metadata


def load_classes(classes_path: Path) -> dict[str, Any]:
    classes = load_json(classes_path)
    if not isinstance(classes, dict) or "classes" not in classes:
        raise ValueError(f"Expected class manifest with a top-level 'classes' array in {classes_path}.")
    return classes


def classes_list(classes_doc: dict[str, Any]) -> list[dict[str, Any]]:
    classes = classes_doc.get("classes", [])
    if not isinstance(classes, list):
        raise ValueError("Class manifest 'classes' entry must be a list.")
    return classes


def headwear_accessories(classes_doc: dict[str, Any]) -> set[str]:
    accessories: set[str] = set()

    for class_def in classes_list(classes_doc):
        match = class_def.get("match", {})
        for key in ("accessoriesAny", "accessoriesAll"):
            for accessory in match.get(key, []):
                accessories.add(accessory)

    return accessories


def punk_matches_class(punk: dict[str, Any], class_def: dict[str, Any]) -> bool:
    match = class_def.get("match", {})

    for key in ("type", "gender", "skinTone"):
        expected = match.get(key)
        if expected is not None and punk.get(key) != expected:
            return False

    accessories = set(punk.get("accessories", []))

    accessories_any = match.get("accessoriesAny", [])
    if accessories_any and not any(accessory in accessories for accessory in accessories_any):
        return False

    accessories_all = match.get("accessoriesAll", [])
    if accessories_all and not all(accessory in accessories for accessory in accessories_all):
        return False

    accessories_none = match.get("accessoriesNone", [])
    if accessories_none and any(accessory in accessories for accessory in accessories_none):
        return False

    return True


def find_matching_classes(punk: dict[str, Any], classes_doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [class_def for class_def in classes_list(classes_doc) if punk_matches_class(punk, class_def)]


def get_class_by_id(classes_doc: dict[str, Any], class_id: str) -> dict[str, Any]:
    for class_def in classes_list(classes_doc):
        if class_def.get("id") == class_id:
            return class_def
    raise ValueError(f"Unknown back-head class id: {class_id}")


def resolve_class(
    punk: dict[str, Any],
    classes_doc: dict[str, Any],
    class_id: str | None = None,
) -> dict[str, Any]:
    if class_id is not None:
        class_def = get_class_by_id(classes_doc, class_id)
        if not punk_matches_class(punk, class_def):
            raise ValueError(
                f"Punk {punk.get('id')} does not match the requested class '{class_id}'.",
            )
        return class_def

    matches = find_matching_classes(punk, classes_doc)

    if not matches:
        accessories = punk.get("accessories", [])
        raise ValueError(
            f"No back-head class matches punk {punk.get('id')} with accessories {accessories}.",
        )

    if len(matches) > 1:
        match_ids = [class_def.get("id", "<unknown>") for class_def in matches]
        raise ValueError(
            f"Multiple back-head classes match punk {punk.get('id')}: {', '.join(match_ids)}",
        )

    return matches[0]


def count_headwear_matches(punk: dict[str, Any], classes_doc: dict[str, Any]) -> int:
    accessories = set(punk.get("accessories", []))
    return len(accessories & headwear_accessories(classes_doc))


def compare_punks_for_reference(punk: dict[str, Any], classes_doc: dict[str, Any]) -> tuple[int, int, int]:
    return (
        int(punk.get("accessoryCount", 0)),
        count_headwear_matches(punk, classes_doc),
        int(punk.get("id", 0)),
    )


def select_exemplar(
    metadata: list[dict[str, Any]],
    classes_doc: dict[str, Any],
    class_def: dict[str, Any],
) -> dict[str, Any]:
    candidates = [punk for punk in metadata if punk_matches_class(punk, class_def)]
    if not candidates:
        raise ValueError(f"No exemplar candidate found for class {class_def.get('id')}.")
    candidates.sort(key=lambda punk: compare_punks_for_reference(punk, classes_doc))
    return candidates[0]


def infer_punk_id(source_path: Path) -> int:
    match = re.search(r"(\d+)", source_path.stem)
    if not match:
        raise ValueError(f"Unable to infer punk id from source path: {source_path}")
    return int(match.group(1))


def get_punk(metadata: list[dict[str, Any]], punk_id: int) -> dict[str, Any]:
    if 0 <= punk_id < len(metadata):
        punk = metadata[punk_id]
        if int(punk.get("id", -1)) == punk_id:
            return punk

    for punk in metadata:
        if int(punk.get("id", -1)) == punk_id:
            return punk

    raise ValueError(f"Punk id {punk_id} was not found in metadata.")


def resolve_template_path(classes_path: Path, class_def: dict[str, Any]) -> Path:
    template = class_def.get("template")
    if not template:
        raise ValueError(f"Class {class_def.get('id')} does not declare a template path.")
    return (classes_path.parent / template).resolve()
