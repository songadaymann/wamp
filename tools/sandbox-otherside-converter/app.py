#!/usr/bin/env python3
"""Sandbox → Otherside avatar converter: CLI + local drag-and-drop window."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PACKAGE_ROOT = Path(__file__).resolve().parent
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from converter.blender_runner import blender_log, build_skeleton_template, detect_blender_path
from converter.jobs import collect_avatar_files, convert_one, inspect_and_map
from converter.paths import (
    UI_DIR,
    default_compare_blend_path,
    default_mapping_path,
    default_odk_bones_path,
    default_odk_fbx_path,
)

SETTINGS_PATH = Path.home() / ".sandbox-otherside-converter.json"
QUEUE_DIR = Path(tempfile.gettempdir()) / "sandbox-otherside-converter"
QUEUE: dict[str, Path] = {}


def default_output_dir() -> Path:
    return Path.home() / "OthersideAvatars"


def load_settings() -> dict:
    settings = {
        "blenderPath": detect_blender_path() or "",
        "outputDir": str(default_output_dir()),
        "mappingPath": str(default_mapping_path()),
        "targetHeight": 1.8,
    }
    if SETTINGS_PATH.is_file():
        try:
            stored = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            if isinstance(stored, dict):
                settings.update({key: stored[key] for key in settings if key in stored})
        except json.JSONDecodeError:
            pass
    return settings


def save_settings(payload: dict) -> dict:
    settings = load_settings()
    settings.update({key: payload[key] for key in settings if key in payload})
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    return settings


def settings_view() -> dict:
    settings = load_settings()
    return {
        **settings,
        "blenderDetected": detect_blender_path(settings.get("blenderPath") or None),
        "odkFbx": str(default_odk_fbx_path()),
        "compareBlend": str(default_compare_blend_path()),
        "odkBones": str(default_odk_bones_path()),
    }


def remember_file(path: Path) -> dict:
    item_id = uuid.uuid4().hex
    QUEUE[item_id] = path
    return {"id": item_id, "name": path.name, "path": str(path)}


def resolve_queued(item_id: str) -> Path:
    path = QUEUE.get(item_id)
    if path is None or not path.is_file():
        raise FileNotFoundError(f"Queued file not found: {item_id}")
    return path


def open_path(path: Path) -> bool:
    path.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        command = ["open", str(path)]
    elif os.name == "nt":
        command = ["explorer", str(path)]
    else:
        command = ["xdg-open", str(path)]
    try:
        subprocess.Popen(command)
        return True
    except OSError:
        return False


def merged_settings(payload: dict | None) -> dict:
    settings = load_settings()
    if payload:
        settings.update({key: payload[key] for key in ("blenderPath", "outputDir", "mappingPath", "targetHeight") if key in payload})
    return settings


def run_inspect(item_id: str, payload: dict) -> dict:
    settings = merged_settings(payload)
    path = resolve_queued(item_id)
    mapping = Path(settings["mappingPath"]) if settings.get("mappingPath") else default_mapping_path()
    result = inspect_and_map(path, mapping)
    result["id"] = item_id
    result["name"] = path.name
    return result


def run_convert(item_id: str, payload: dict) -> dict:
    settings = merged_settings(payload)
    path = resolve_queued(item_id)
    output_dir = Path(settings["outputDir"]).expanduser()
    mapping = Path(settings["mappingPath"]) if settings.get("mappingPath") else default_mapping_path()
    return convert_one(
        path,
        output_dir,
        mapping_path=mapping,
        blender_path=settings.get("blenderPath") or None,
        target_height=float(settings.get("targetHeight") or 1.8),
    )


def run_template(payload: dict) -> dict:
    settings = merged_settings(payload)
    overlay = None
    overlay_id = (payload or {}).get("overlayId")
    if overlay_id:
        overlay = resolve_queued(str(overlay_id))
    output = default_compare_blend_path()
    result = build_skeleton_template(
        output,
        fbx_path=default_odk_fbx_path() if default_odk_fbx_path().is_file() else None,
        bones_path=default_odk_bones_path(),
        overlay_path=overlay,
        blender_path=settings.get("blenderPath") or None,
    )
    return {
        "ok": result.returncode == 0 and output.is_file(),
        "outputBlend": str(output),
        "returncode": result.returncode,
        "log": blender_log(result),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, (json.dumps(payload) + "\n").encode("utf-8"), "application/json")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        return data if isinstance(data, dict) else {}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path in {"/", "/index.html"}:
            html = (UI_DIR / "index.html").read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
            return
        if parsed.path == "/api/settings":
            self._json(200, settings_view())
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/settings":
                self._json(200, save_settings(self._read_json()))
                return
            if parsed.path == "/api/queue":
                self._json(200, {"items": self._save_uploads()})
                return
            if parsed.path == "/api/inspect":
                payload = self._read_json()
                self._json(200, run_inspect(str(payload.get("id")), payload))
                return
            if parsed.path == "/api/convert":
                payload = self._read_json()
                self._json(200, run_convert(str(payload.get("id")), payload))
                return
            if parsed.path == "/api/template":
                self._json(200, run_template(self._read_json()))
                return
            if parsed.path == "/api/open-output":
                payload = merged_settings(self._read_json())
                output = Path(payload["outputDir"]).expanduser()
                self._json(200, {"ok": open_path(output), "outputDir": str(output)})
                return
        except FileNotFoundError as exc:
            self._json(404, {"error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"error": str(exc)})
            return
        self._json(404, {"error": "not found"})

    def _save_uploads(self) -> list[dict]:
        content_type = self.headers.get("Content-Type", "")
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        items: list[dict] = []
        QUEUE_DIR.mkdir(parents=True, exist_ok=True)
        batch_dir = QUEUE_DIR / uuid.uuid4().hex
        batch_dir.mkdir()
        if "multipart/form-data" not in content_type:
            raise ValueError("Expected multipart file upload")
        boundary = None
        for part in content_type.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part.split("=", 1)[1].strip().strip('"')
        if not boundary:
            raise ValueError("Missing multipart boundary")
        marker = ("--" + boundary).encode("utf-8")
        sidecar_suffixes = {".gltf", ".glb", ".bin", ".png", ".jpg", ".jpeg"}
        for chunk in body.split(marker):
            if not chunk or chunk in {b"--\r\n", b"--"}:
                continue
            if chunk.startswith(b"\r\n"):
                chunk = chunk[2:]
            header_blob, _, file_blob = chunk.partition(b"\r\n\r\n")
            headers = header_blob.decode("utf-8", "replace")
            if "filename=" not in headers:
                continue
            name = ""
            for line in headers.replace("\r\n", "\n").split("\n"):
                if "filename=" not in line:
                    continue
                raw_name = line.split("filename=", 1)[1].split(";", 1)[0].strip()
                name = Path(raw_name.strip('"').strip()).name
                break
            if not name or Path(name).suffix.lower() not in sidecar_suffixes:
                continue
            file_blob = file_blob.rstrip(b"\r\n")
            if file_blob.endswith(b"--"):
                file_blob = file_blob[:-2]
            dest = batch_dir / name
            dest.write_bytes(file_blob)
            if dest.suffix.lower() in {".gltf", ".glb"}:
                items.append(remember_file(dest))
        return items


def serve(host: str, port: int, open_window: bool) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    print(f"Converter window: {url}")
    if open_window:
        opened = False
        try:
            import webview  # type: ignore

            threading.Thread(target=server.serve_forever, daemon=True).start()
            webview.create_window("Sandbox → Otherside Converter", url, width=1180, height=820)
            webview.start()
            server.shutdown()
            return
        except Exception:
            opened = webbrowser.open(url)
        if not opened:
            print("Open the URL in a browser if a window did not appear.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def cmd_inspect(args: argparse.Namespace) -> int:
    mapping = Path(args.mapping) if args.mapping else default_mapping_path()
    for path in collect_avatar_files(args.input):
        print(json.dumps(inspect_and_map(path, mapping), indent=2 if args.pretty else None))
    return 0


def cmd_convert(args: argparse.Namespace) -> int:
    files = collect_avatar_files(args.input)
    if not files:
        print("No .gltf / .glb files found.", file=sys.stderr)
        return 2
    output = Path(args.output).expanduser()
    mapping = Path(args.mapping) if args.mapping else default_mapping_path()
    failed = 0
    for path in files:
        print(f"Converting {path} …")
        report = convert_one(
            path,
            output,
            mapping_path=mapping,
            blender_path=args.blender,
            target_height=args.target_height,
        )
        print(json.dumps({key: report[key] for key in report if key != "log"}, indent=2))
        if report.get("log"):
            print(report["log"])
        if not report.get("ok"):
            failed += 1
    return 1 if failed else 0


def cmd_template(args: argparse.Namespace) -> int:
    output = Path(args.output).expanduser() if args.output else default_compare_blend_path()
    result = build_skeleton_template(
        output,
        fbx_path=Path(args.fbx) if args.fbx else default_odk_fbx_path(),
        bones_path=default_odk_bones_path(),
        overlay_path=Path(args.overlay) if args.overlay else None,
        blender_path=args.blender,
    )
    print(blender_log(result))
    return result.returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bulk-convert The Sandbox voxel avatars to Otherside ODK GLB files.")
    sub = parser.add_subparsers(dest="command")

    serve_p = sub.add_parser("serve", help="Open the local drag-and-drop window")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=8765)
    serve_p.add_argument("--no-open", action="store_true")

    inspect_p = sub.add_parser("inspect", help="Dump nodes/meshes and draft bone mapping")
    inspect_p.add_argument("input", nargs="+")
    inspect_p.add_argument("--mapping")
    inspect_p.add_argument("--pretty", action="store_true")

    convert_p = sub.add_parser("convert", help="Convert one file or a folder of GLTF/GLB files")
    convert_p.add_argument("--input", "-i", nargs="+", required=True)
    convert_p.add_argument("--output", "-o", required=True)
    convert_p.add_argument("--mapping")
    convert_p.add_argument("--blender")
    convert_p.add_argument("--target-height", type=float)

    template_p = sub.add_parser("build-template", help="Build ODK_Sandbox_Compare.blend")
    template_p.add_argument("--output")
    template_p.add_argument("--fbx")
    template_p.add_argument("--overlay")
    template_p.add_argument("--blender")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command or "serve"
    if command == "serve":
        host = getattr(args, "host", "127.0.0.1")
        port = getattr(args, "port", 8765)
        open_window = not getattr(args, "no_open", False)
        serve(host, port, open_window)
        return 0
    if command == "inspect":
        return cmd_inspect(args)
    if command == "convert":
        return cmd_convert(args)
    if command == "build-template":
        return cmd_template(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
