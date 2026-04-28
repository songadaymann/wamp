from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image

from back_head_template_lib import (
    get_class_by_id,
    load_classes,
    load_metadata,
    load_json,
    render_manual_seed_transfer,
    resolve_class,
    resolve_palette_family,
)


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent.parent


def resolve_local_sprites_separated_root() -> Path:
    try:
        return REPO_ROOT.parents[2] / "Sprites-and-Things" / "player" / "SpritesSeparated"
    except IndexError:
        return REPO_ROOT.parent / "Sprites-and-Things" / "player" / "SpritesSeparated"


LOCAL_FLING_PUNK_ASSETS = REPO_ROOT.parent / "fling-punk" / "assets"
LOCAL_SPRITES_SEPARATED_ROOT = resolve_local_sprites_separated_root()
DEFAULT_METADATA = Path(
    os.environ.get(
        "CRYPTOPUNK_METADATA_PATH",
        str(LOCAL_FLING_PUNK_ASSETS / "punks-metadata.json"),
    ),
)
DEFAULT_PUNKS_DIR = Path(
    os.environ.get(
        "CRYPTOPUNK_PUNKS_DIR",
        str(LOCAL_FLING_PUNK_ASSETS / "punks"),
    ),
)
DEFAULT_CLASSES = ROOT / "back-head-templates" / "classes.json"
DEFAULT_GROUPS = ROOT / "back-head-templates" / "back-view-groups.json"
DEFAULT_SPECIAL_GROUPS = ROOT / "back-head-templates" / "special-groups.json"
DEFAULT_PLAN_CSV = ROOT / "back-head-templates" / "head-class-planning.csv"
DEFAULT_SOURCE_ROOT = Path(
    os.environ.get("PLAYER_SPRITES_SEPARATED_ROOT", str(LOCAL_SPRITES_SEPARATED_ROOT)),
)
DEFAULT_RENDERER = REPO_ROOT / "gen-avatar" / "prototype-punk-avatar.mjs"
DEFAULT_GAME_PLAYER_ROOT = REPO_ROOT / "public" / "assets" / "player" / "default"
DEFAULT_OUTPUT_ROOT = ROOT / "generated-avatar-packs"
SPECIAL_BASE_GROUP_ID = "special-base"
MIN_PUNK_ID = 0
MAX_PUNK_ID = 9999
CANONICAL_BASE_RGB = {
    "Alien": (200, 251, 251),
    "Ape": (53, 36, 16),
    "Zombie": (125, 162, 105),
    "Albino": (234, 217, 217),
    "Light": (219, 177, 128),
    "Medium": (174, 139, 97),
    "Dark": (113, 63, 29),
}

FULL_FRONT_STATE_SPECS = [
    "idle=Idle",
    "run=Run",
    "jump-rise=JumpRise",
    "jump-fall=JumpFall",
    "wall-slide=WallSlide",
    "wall-jump=WallJump",
    "land=Land",
    "crouch=Crouch",
    "crawl=Crawl",
    "push=Push",
    "pull=Pull",
    "sword-slash=Combat/StandingSlash",
    "air-slash-down=Combat/AirSlashDown",
    "gun-fire=Combat/GunFire",
]
LADDER_STATE_SPEC = "ladder-climb=LadderClimb"


BASE_STATE_FRAME_NAMES = {
    "idle": [f"Player {index}.aseprite" for index in [0, 1, 2, 3, 4, 5, 6]],
    "run": [f"Player {index}.aseprite" for index in [15, 16, 17, 18, 19, 20, 21, 22]],
    "jump-rise": [f"Player {index}.aseprite" for index in [32]],
    "jump-fall": [f"Player {index}.aseprite" for index in [34]],
    "wall-slide": [f"Player {index}.aseprite" for index in [107, 108, 109, 110, 111, 112]],
    "wall-jump": [f"Player {index}.aseprite" for index in [113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123]],
    "land": [f"Player {index}.aseprite" for index in [35, 36]],
    "ladder-climb": [f"Player {index}.aseprite" for index in [124, 125, 126, 127, 128, 129, 130, 131]],
    "crouch": [f"Player {index}.aseprite" for index in [51, 52, 53, 54, 55, 56]],
    "crawl": [f"Player {index}.aseprite" for index in [57, 58, 59, 60, 61, 62, 63, 64]],
    "push": [f"Player {index}.aseprite" for index in [262, 263, 264, 265, 266, 267, 268, 269]],
    "pull": [f"Player {index}.aseprite" for index in [270, 271, 272, 273, 274, 275]],
}
COMBAT_STATE_FRAME_NAMES = {
    "sword-slash": [f"PlayerCombat {index}.aseprite" for index in [89, 90, 91, 92, 93]],
    "air-slash-down": [f"PlayerCombat {index}.aseprite" for index in [107, 108, 109, 110, 111, 112]],
    "gun-fire": [f"PlayerCombat {index}.aseprite" for index in [233, 234, 235, 236, 237]],
}

OUTPUT_FILES = {
    "base_png": "PlayerSheet.png",
    "base_json": "PlayerSheet.json",
    "combat_png": "PlayerCombatActionsSheet.png",
    "combat_json": "PlayerCombatActionsSheet.json",
    "head_png": "head.png",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a runtime-ready player atlas pack for a single CryptoPunk id.",
    )
    parser.add_argument("punk_id", type=parse_punk_id, help="CryptoPunk id to render, 0 through 9999.")
    parser.add_argument("--metadata", default=str(DEFAULT_METADATA), help="Path to punks-metadata.json.")
    parser.add_argument("--punks-dir", default=str(DEFAULT_PUNKS_DIR), help="Directory containing punk PNG files.")
    parser.add_argument("--classes", default=str(DEFAULT_CLASSES), help="Path to classes.json.")
    parser.add_argument("--groups", default=str(DEFAULT_GROUPS), help="Path to back-view-groups.json.")
    parser.add_argument("--special-groups", default=str(DEFAULT_SPECIAL_GROUPS), help="Path to special-groups.json.")
    parser.add_argument("--plan-csv", default=str(DEFAULT_PLAN_CSV), help="Filled head-class-planning.csv.")
    parser.add_argument("--source-root", default=str(DEFAULT_SOURCE_ROOT), help="Sprite source root.")
    parser.add_argument("--renderer", default=str(DEFAULT_RENDERER), help="Path to prototype-punk-avatar.mjs.")
    parser.add_argument(
        "--default-player-root",
        default=str(DEFAULT_GAME_PLAYER_ROOT),
        help="Folder containing the canonical default player atlas assets.",
    )
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT), help="Folder where generated packs should be written.")
    parser.add_argument(
        "--include-shared-assets",
        action="store_true",
        help="Copy shared Weapons/FX atlas files into the output folder as well.",
    )
    parser.add_argument(
        "--keep-temp-render",
        action="store_true",
        help="Keep the intermediate rendered frame folders for inspection.",
    )
    return parser.parse_args()


def parse_punk_id(value: str) -> int:
    try:
        punk_id = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("punk_id must be an integer.") from error

    if punk_id < MIN_PUNK_ID or punk_id > MAX_PUNK_ID:
        raise argparse.ArgumentTypeError(f"punk_id must be between {MIN_PUNK_ID} and {MAX_PUNK_ID}.")

    return punk_id


def parse_bool(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"yes", "y", "true", "1"}


def parse_optional_bool(value: str | None) -> bool | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None
    if normalized in {"yes", "y", "true", "1"}:
        return True
    if normalized in {"no", "n", "false", "0"}:
        return False
    return None


def load_fill_plan(plan_csv_path: Path) -> dict[str, dict[str, Any]]:
    plan: dict[str, dict[str, Any]] = {}
    with plan_csv_path.open(newline="", encoding="utf8") as handle:
        for row in csv.DictReader(handle):
            plan[row["class_id"]] = row
    return plan


def infer_needs_back_fill_color(template_path: Path, source_family: str) -> bool:
    template = load_json(template_path)
    reference_palette = template.get("referencePalette", [])
    fill_tones = {
        int(operation["tone"])
        for operation in template.get("operations", [])
        if operation.get("op") == "fill" and "tone" in operation
    }
    source_rgb = CANONICAL_BASE_RGB.get(source_family)
    if source_rgb is None or not fill_tones:
        return False

    for tone in fill_tones:
        if tone < 0 or tone >= len(reference_palette):
            continue
        palette_entry = reference_palette[tone]
        if tuple(int(channel) for channel in palette_entry[:3]) == source_rgb:
            return True

    return False


def build_accessory_to_group(classes_doc: dict[str, Any], groups_doc: dict[str, Any]) -> dict[str, str]:
    mapping: dict[str, str] = {}

    for group_def in groups_doc.get("groups", []):
        for class_id in group_def.get("classIds", []):
            class_def = get_class_by_id(classes_doc, class_id)
            match = class_def.get("match", {})
            for key in ("accessoriesAny", "accessoriesAll"):
                for accessory in match.get(key, []):
                    mapping.setdefault(accessory, group_def["id"])

    return mapping


def resolve_special_group_id(punk: dict[str, Any], accessory_to_group: dict[str, str]) -> str:
    relevant_accessories = [accessory for accessory in punk.get("accessories", []) if accessory in accessory_to_group]
    group_ids = sorted({accessory_to_group[accessory] for accessory in relevant_accessories})
    return group_ids[0] if group_ids else SPECIAL_BASE_GROUP_ID


def build_special_entry_map(special_groups_doc: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    mapping: dict[tuple[str, str], dict[str, Any]] = {}
    for entry in special_groups_doc.get("entries", []):
        mapping[(entry["type"], entry["groupId"])] = entry
    return mapping


def run_renderer(
    *,
    renderer_path: Path,
    source_root: Path,
    punk_png: Path,
    output_dir: Path,
    state_specs: list[str],
    head_png: Path | None = None,
) -> dict[str, Any]:
    cmd = [
        "node",
        str(renderer_path),
        "--source-root",
        str(source_root),
        "--punk",
        str(punk_png),
        "--states",
        ",".join(state_specs),
        "--output",
        str(output_dir),
    ]
    if head_png is not None:
        cmd.extend(["--head-image", str(head_png), "--head-offset-x", "0", "--head-offset-y", "3"])

    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads((output_dir / "report.json").read_text(encoding="utf8"))


def resolve_human_back_head(
    *,
    punk: dict[str, Any],
    classes_doc: dict[str, Any],
    classes_path: Path,
    fill_plan: dict[str, dict[str, Any]],
    metadata_by_id: dict[int, dict[str, Any]],
    output_path: Path,
) -> dict[str, Any]:
    class_def = resolve_class(punk, classes_doc)
    class_id = class_def["id"]
    plan_row = fill_plan.get(class_id)
    if plan_row is None:
        raise ValueError(f"No fill-plan row found for class {class_id}.")
    seed_image_path = (classes_path.parent / str(class_def["manualSeedImage"])).resolve()
    template_path = (classes_path.parent / str(class_def["template"])).resolve()
    seed_punk = metadata_by_id[int(class_def["sourcePunkId"])]
    source_family = resolve_palette_family(seed_punk)
    target_family = resolve_palette_family(punk)
    needs_fill = parse_optional_bool(plan_row.get("needs_back_fill_color"))
    if needs_fill is None:
        needs_fill = infer_needs_back_fill_color(template_path, source_family)
    render_manual_seed_transfer(
        seed_image_path,
        template_path,
        output_path,
        source_family=source_family,
        target_family=target_family,
        recolor_fill_pixels=needs_fill,
    )
    return {
        "mode": "human-class",
        "classId": class_id,
        "needsBackFillColor": needs_fill,
        "seedPunkId": int(class_def["sourcePunkId"]),
        "seedImage": str(seed_image_path),
        "template": str(template_path),
    }


def resolve_special_back_head(
    *,
    punk: dict[str, Any],
    classes_doc: dict[str, Any],
    groups_doc: dict[str, Any],
    special_groups_doc: dict[str, Any],
    templates_root: Path,
) -> tuple[Path, dict[str, Any]]:
    accessory_to_group = build_accessory_to_group(classes_doc, groups_doc)
    special_entry_map = build_special_entry_map(special_groups_doc)
    group_id = resolve_special_group_id(punk, accessory_to_group)
    entry = special_entry_map.get((punk["type"], group_id))
    if entry is None:
        raise ValueError(f"No special back-head entry for {punk['type']} / {group_id}.")
    back_head_path = (templates_root / entry["manualSeedImage"]).resolve()
    return back_head_path, {
        "mode": "special-group",
        "groupId": group_id,
        "sourcePunkId": int(entry["sourcePunkId"]),
        "manualSeedImage": str(back_head_path),
        "needsBackFillColor": bool(entry.get("needsBackFillColor")),
        "sharedHumanClassId": entry.get("sharedHumanClassId"),
    }


def paste_frames_onto_atlas(
    atlas_image_path: Path,
    atlas_json_path: Path,
    frame_name_map: dict[str, list[str]],
    rendered_root: Path,
    output_image_path: Path,
    output_json_path: Path,
) -> None:
    atlas_image = Image.open(atlas_image_path).convert("RGBA")
    atlas_json = load_json(atlas_json_path)

    for state_key, target_frame_names in frame_name_map.items():
        state_dir = rendered_root / state_key
        rendered_frame_paths = sorted(state_dir.glob("*.png"))
        if len(rendered_frame_paths) != len(target_frame_names):
            raise ValueError(
                f"Rendered frame count mismatch for {state_key}: expected {len(target_frame_names)}, got {len(rendered_frame_paths)}.",
            )

        for frame_name, rendered_frame_path in zip(target_frame_names, rendered_frame_paths):
            frame_meta = atlas_json["frames"].get(frame_name)
            if frame_meta is None:
                raise ValueError(f"Frame {frame_name} not found in atlas json {atlas_json_path}.")
            frame_box = frame_meta["frame"]
            rendered_frame = Image.open(rendered_frame_path).convert("RGBA")
            if rendered_frame.size != (frame_box["w"], frame_box["h"]):
                raise ValueError(
                    f"Frame size mismatch for {rendered_frame_path}: expected {(frame_box['w'], frame_box['h'])}, got {rendered_frame.size}.",
                )
            atlas_image.paste(
                Image.new("RGBA", (frame_box["w"], frame_box["h"]), (0, 0, 0, 0)),
                (frame_box["x"], frame_box["y"]),
            )
            atlas_image.paste(rendered_frame, (frame_box["x"], frame_box["y"]), rendered_frame)

    output_image_path.parent.mkdir(parents=True, exist_ok=True)
    atlas_image.save(output_image_path)
    output_json_path.write_text(f"{json.dumps(atlas_json, indent=2)}\n", encoding="utf8")


def maybe_copy_shared_assets(default_player_root: Path, output_dir: Path) -> None:
    for name in ["WeaponsSheet.png", "WeaponsSheet.json", "FXSheet.png", "FXSheet.json"]:
        shutil.copy2(default_player_root / name, output_dir / name)


def main() -> None:
    args = parse_args()
    metadata_path = Path(args.metadata).resolve()
    punks_dir = Path(args.punks_dir).resolve()
    classes_path = Path(args.classes).resolve()
    groups_path = Path(args.groups).resolve()
    special_groups_path = Path(args.special_groups).resolve()
    plan_csv_path = Path(args.plan_csv).resolve()
    source_root = Path(args.source_root).resolve()
    renderer_path = Path(args.renderer).resolve()
    default_player_root = Path(args.default_player_root).resolve()
    output_root = Path(args.output_root).resolve()

    metadata = load_metadata(metadata_path)
    metadata_by_id = {int(punk["id"]): punk for punk in metadata}
    punk = metadata_by_id[int(args.punk_id)]
    punk_png = (punks_dir / f"{args.punk_id}.png").resolve()
    classes_doc = load_classes(classes_path)
    groups_doc = load_json(groups_path)
    special_groups_doc = load_json(special_groups_path)
    fill_plan = load_fill_plan(plan_csv_path)

    output_dir = output_root / f"punk-{args.punk_id}"
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=f"punk-{args.punk_id}-render-") as temp_dir_raw:
        temp_dir = Path(temp_dir_raw)
        back_head_png = temp_dir / f"punk-{args.punk_id}-back-head.png"

        if punk["type"] == "Human":
            back_head_info = resolve_human_back_head(
                punk=punk,
                classes_doc=classes_doc,
                classes_path=classes_path,
                fill_plan=fill_plan,
                metadata_by_id=metadata_by_id,
                output_path=back_head_png,
            )
        else:
            resolved_special_back_head, back_head_info = resolve_special_back_head(
                punk=punk,
                classes_doc=classes_doc,
                groups_doc=groups_doc,
                special_groups_doc=special_groups_doc,
                templates_root=special_groups_path.parent,
            )
            shutil.copy2(resolved_special_back_head, back_head_png)

        front_output_dir = temp_dir / "front"
        ladder_output_dir = temp_dir / "ladder"

        front_report = run_renderer(
            renderer_path=renderer_path,
            source_root=source_root,
            punk_png=punk_png,
            output_dir=front_output_dir,
            state_specs=FULL_FRONT_STATE_SPECS,
        )
        ladder_report = run_renderer(
            renderer_path=renderer_path,
            source_root=source_root,
            punk_png=punk_png,
            output_dir=ladder_output_dir,
            state_specs=[LADDER_STATE_SPEC],
            head_png=back_head_png,
        )

        combined_base_root = temp_dir / "combined-base"
        shutil.copytree(front_output_dir, combined_base_root)
        shutil.rmtree(combined_base_root / "preview", ignore_errors=True)
        ladder_frames_dir = Path(ladder_report["previews"]["ladder-climb"]["framesDir"])
        ladder_target_dir = combined_base_root / "ladder-climb"
        if ladder_target_dir.exists():
            shutil.rmtree(ladder_target_dir)
        shutil.copytree(ladder_frames_dir, ladder_target_dir)

        base_atlas_png = default_player_root / OUTPUT_FILES["base_png"]
        base_atlas_json = default_player_root / OUTPUT_FILES["base_json"]
        combat_atlas_png = default_player_root / OUTPUT_FILES["combat_png"]
        combat_atlas_json = default_player_root / OUTPUT_FILES["combat_json"]

        paste_frames_onto_atlas(
            atlas_image_path=base_atlas_png,
            atlas_json_path=base_atlas_json,
            frame_name_map=BASE_STATE_FRAME_NAMES,
            rendered_root=combined_base_root,
            output_image_path=output_dir / OUTPUT_FILES["base_png"],
            output_json_path=output_dir / OUTPUT_FILES["base_json"],
        )
        paste_frames_onto_atlas(
            atlas_image_path=combat_atlas_png,
            atlas_json_path=combat_atlas_json,
            frame_name_map=COMBAT_STATE_FRAME_NAMES,
            rendered_root=front_output_dir,
            output_image_path=output_dir / OUTPUT_FILES["combat_png"],
            output_json_path=output_dir / OUTPUT_FILES["combat_json"],
        )
        shutil.copy2(punk_png, output_dir / OUTPUT_FILES["head_png"])

        if args.include_shared_assets:
            maybe_copy_shared_assets(default_player_root, output_dir)

        if args.keep_temp_render:
            debug_render_dir = output_dir / "_render-debug"
            shutil.copytree(temp_dir, debug_render_dir, dirs_exist_ok=True)

    manifest = {
        "version": 1,
        "punkId": int(args.punk_id),
        "punkType": punk["type"],
        "accessories": list(punk.get("accessories", [])),
        "outputDir": str(output_dir),
        "assets": {
            "baseTexture": str(output_dir / OUTPUT_FILES["base_png"]),
            "baseAtlas": str(output_dir / OUTPUT_FILES["base_json"]),
            "combatTexture": str(output_dir / OUTPUT_FILES["combat_png"]),
            "combatAtlas": str(output_dir / OUTPUT_FILES["combat_json"]),
        },
        "headImage": str(output_dir / OUTPUT_FILES["head_png"]),
        "sharedAssets": {
            "weaponsTexture": str((output_dir / "WeaponsSheet.png") if args.include_shared_assets else (default_player_root / "WeaponsSheet.png")),
            "weaponsAtlas": str((output_dir / "WeaponsSheet.json") if args.include_shared_assets else (default_player_root / "WeaponsSheet.json")),
            "fxTexture": str((output_dir / "FXSheet.png") if args.include_shared_assets else (default_player_root / "FXSheet.png")),
            "fxAtlas": str((output_dir / "FXSheet.json") if args.include_shared_assets else (default_player_root / "FXSheet.json")),
        },
        "backHead": back_head_info,
        "notes": "Base/combat atlases are generated per punk. Weapons/FX remain shared from the default player pack unless copied in.",
    }
    (output_dir / "manifest.json").write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf8")

    print(f"Avatar pack written to {output_dir}")
    print(f"Punk: {args.punk_id} ({punk['type']})")
    print(f"Base atlas: {output_dir / OUTPUT_FILES['base_png']}")
    print(f"Combat atlas: {output_dir / OUTPUT_FILES['combat_png']}")
    print(f"Head image: {output_dir / OUTPUT_FILES['head_png']}")


if __name__ == "__main__":
    main()
