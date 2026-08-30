from __future__ import annotations

import json
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

from app import Handler
from converter.paths import FIXTURES_DIR


def test_local_server_inspects_uploaded_fixture() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        with urlopen(f"http://{host}:{port}/") as response:
            html = response.read().decode("utf-8")
        assert "Drag and drop" in html

        fixture = FIXTURES_DIR / "sandbox_voxel_parts.gltf"
        boundary = "----pytestboundary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="files"; filename="{fixture.name}"\r\n'
            "Content-Type: model/gltf+json\r\n\r\n"
        ).encode("utf-8") + fixture.read_bytes() + f"\r\n--{boundary}--\r\n".encode("utf-8")
        request = Request(
            f"http://{host}:{port}/api/queue",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urlopen(request) as response:
            queued = json.loads(response.read().decode("utf-8"))
        assert queued["items"][0]["name"] == fixture.name

        inspect_req = Request(
            f"http://{host}:{port}/api/inspect",
            data=json.dumps({"id": queued["items"][0]["id"]}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(inspect_req) as response:
            inspected = json.loads(response.read().decode("utf-8"))
        assert inspected["unmapped"] == []
        assert inspected["mappedCount"] == 15
    finally:
        server.shutdown()
        thread.join(timeout=2)
