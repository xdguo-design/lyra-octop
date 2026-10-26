from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from octop.api.middleware import project_preview_proxy


def test_preview_host_proxies_to_its_container_and_preserves_headers(
    monkeypatch: Any,
) -> None:
    requested: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requested.append(request)
        return httpx.Response(
            200,
            content=b"preview body",
            headers=[("set-cookie", "first=1; Path=/"), ("set-cookie", "second=2; Path=/")],
        )

    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(
        project_preview_proxy.httpx,
        "AsyncClient",
        lambda **_kwargs: real_client(transport=transport),
    )

    class Manager:
        def preview_upstream_for_host(self, host: str) -> str | None:
            return "http://127.0.0.1:8765" if host == "random.preview.example.com" else None

    app = FastAPI()
    app.add_middleware(
        project_preview_proxy._ProjectPreviewProxyMiddleware,
        server=SimpleNamespace(project_service_manager=Manager()),
    )

    @app.get("/octop-only")
    async def fallback() -> dict[str, str]:
        return {"source": "octop"}

    with TestClient(app, base_url="https://random.preview.example.com") as client:
        response = client.get("/api/admin/overview?limit=5")
    assert response.status_code == 200
    assert response.content == b"preview body"
    assert response.headers.get_list("set-cookie") == ["first=1; Path=/", "second=2; Path=/"]
    assert response.headers["referrer-policy"] == "no-referrer"
    assert requested[0].url == "http://127.0.0.1:8765/api/admin/overview?limit=5"
    assert requested[0].headers["host"] == "random.preview.example.com"
    assert requested[0].headers["x-forwarded-proto"] == "https"


def test_non_preview_host_continues_to_octop() -> None:
    class Manager:
        def preview_upstream_for_host(self, _host: str) -> None:
            return None

    app = FastAPI()
    app.add_middleware(
        project_preview_proxy._ProjectPreviewProxyMiddleware,
        server=SimpleNamespace(project_service_manager=Manager()),
    )

    @app.get("/octop-only")
    async def fallback() -> dict[str, str]:
        return {"source": "octop"}

    with TestClient(app, base_url="https://octop.example.com") as client:
        response = client.get("/octop-only")
    assert response.json() == {"source": "octop"}


def test_stopped_preview_host_does_not_fall_through_to_octop() -> None:
    class Manager:
        def preview_upstream_for_host(self, _host: str) -> None:
            return None

        def is_preview_host(self, host: str) -> bool:
            return host.endswith(".preview.example.com")

    app = FastAPI()
    app.add_middleware(
        project_preview_proxy._ProjectPreviewProxyMiddleware,
        server=SimpleNamespace(project_service_manager=Manager()),
    )

    @app.get("/octop-only")
    async def fallback() -> dict[str, str]:
        return {"source": "octop"}

    with TestClient(app, base_url="https://random.preview.example.com") as client:
        response = client.get("/octop-only")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_preview_websocket_relay(monkeypatch: Any) -> None:
    sent_upstream: list[str] = []
    sent_client: list[dict[str, Any]] = []

    class Upstream:
        subprotocol = "octop-preview"
        emitted = False

        async def __aenter__(self) -> Upstream:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def send(self, message: str) -> None:
            sent_upstream.append(message)

        def __aiter__(self) -> Upstream:
            return self

        async def __anext__(self) -> str:
            if sent_upstream and not self.emitted:
                self.emitted = True
                return f"echo:{sent_upstream[-1]}"
            raise StopAsyncIteration

    connect_args: dict[str, Any] = {}

    def fake_connect(target: str, **kwargs: Any) -> Upstream:
        connect_args.update(target=target, **kwargs)
        return Upstream()

    monkeypatch.setattr(project_preview_proxy, "websocket_connect", fake_connect)
    events = iter(
        [
            {"type": "websocket.connect"},
            {"type": "websocket.receive", "text": "ping"},
            {"type": "websocket.disconnect", "code": 1000},
        ]
    )

    async def receive() -> dict[str, Any]:
        return next(events)

    async def send(event: dict[str, Any]) -> None:
        sent_client.append(event)

    await project_preview_proxy._forward_websocket(
        {"type": "websocket", "path": "/socket", "query_string": b"q=1"},
        receive,
        send,
        "http://127.0.0.1:8765",
        "random.preview.example.com",
        {
            b"host": b"random.preview.example.com",
            b"sec-websocket-protocol": b"octop-preview",
        },
    )
    assert connect_args["target"] == "ws://127.0.0.1:8765/socket?q=1"
    assert connect_args.get("proxy") is None
    assert sent_upstream == ["ping"]
    assert sent_client == [
        {"type": "websocket.accept", "subprotocol": "octop-preview"},
        {"type": "websocket.send", "text": "echo:ping"},
        {"type": "websocket.close", "code": 1000},
    ]
