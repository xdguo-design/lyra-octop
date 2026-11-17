"""Same-origin proxy for the lyra-planet kids app (tests/integration/test_planet_proxy.py)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from octop.api.app import build_app
from tests.support.app import octop_client


class _StubPlanet(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - http.server API
        if self.path == "/api/health":
            body = json.dumps({"status": "ok"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture
def stub_planet() -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _StubPlanet)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    thread.join(timeout=5)


async def test_planet_root_redirects_to_trailing_slash(tmp_octop_home: Path) -> None:
    async with octop_client(tmp_octop_home) as (_client, srv):
        with TestClient(build_app(srv)) as c:
            r = c.get("/planet", follow_redirects=False)
            assert r.status_code == 308
            assert r.headers["location"] == "/planet/"


async def test_planet_proxy_forwards_to_upstream(
    tmp_octop_home: Path, stub_planet: ThreadingHTTPServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    origin = f"http://127.0.0.1:{stub_planet.server_port}"
    monkeypatch.setenv("PLANET_PROXY_ORIGIN", origin)
    async with octop_client(tmp_octop_home) as (_client, srv):
        with TestClient(build_app(srv)) as c:
            r = c.get("/planet/api/health")
            assert r.status_code == 200
            assert r.json() == {"status": "ok"}
            assert r.headers["content-type"].startswith("application/json")


async def test_planet_proxy_reports_unreachable_upstream(
    tmp_octop_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A port nothing listens on — deployments without the planet app degrade.
    monkeypatch.setenv("PLANET_PROXY_ORIGIN", "http://127.0.0.1:59999")
    async with octop_client(tmp_octop_home) as (_client, srv):
        with TestClient(build_app(srv)) as c:
            r = c.get("/planet/api/health")
            assert r.status_code == 502
            assert r.json()["detail"]
