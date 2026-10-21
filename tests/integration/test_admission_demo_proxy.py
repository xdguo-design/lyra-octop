from __future__ import annotations

from typing import Any

import httpx
import pytest


@pytest.mark.parametrize(
    "path",
    ["ai/candidates", "sessions/adm_proxy_test/turns"],
)
async def test_embedded_admission_proxy_requires_login(env: Any, path: str) -> None:
    client, _server, _auth = env
    response = await client.post(f"/admission-registration-api/v1/{path}", json={})
    assert response.status_code == 401


async def test_embedded_admission_regions_proxy(env: Any, monkeypatch: Any) -> None:
    from octop.api.routers import admission_demo_proxy as proxy

    client, _server, auth = env
    requests = []
    unauthorized = await client.get("/admission-registration-api/v1/regions")
    assert unauthorized.status_code == 401

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"items": [{"code": "110000", "label": "北京市"}]})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        proxy.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    response = await client.get("/admission-registration-api/v1/regions", headers=auth)

    assert response.status_code == 200
    assert response.json() == {"items": [{"code": "110000", "label": "北京市"}]}
    assert str(requests[0].url) == "http://127.0.0.1:8765/api/admission-registration/v1/regions"
    assert requests[0].method == "GET"
    assert requests[0].headers["authorization"] == auth["Authorization"]


@pytest.mark.parametrize("status", [200, 401, 409, 422, 429, 500])
async def test_embedded_admission_proxy_preserves_contract(
    env: Any, monkeypatch: Any, status: int
) -> None:
    from octop.api.routers import admission_demo_proxy as proxy

    client, _server, auth = env
    requests = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            status,
            json={"revision": 1, "detail": "upstream result"},
            headers={"X-Octop-Access-Token": "renewed-test-token", "Set-Cookie": "ignored=1"},
        )

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        proxy.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    payload = {"identityToken": "test-identity", "utterance": "test answer"}
    for path in ("ai/candidates", "sessions/adm_proxy_test/turns"):
        response = await client.post(
            f"/admission-registration-api/v1/{path}", headers=auth, json=payload
        )
        assert response.status_code == status
        assert response.json() == {"revision": 1, "detail": "upstream result"}
        assert response.headers["X-Octop-Access-Token"] == "renewed-test-token"
        assert response.headers["Cache-Control"] == "no-store"
        assert "set-cookie" not in response.headers
        assert str(requests[-1].url) == (
            f"http://127.0.0.1:8765/api/admission-registration/v1/{path}"
        )
        assert requests[-1].headers["authorization"] == auth["Authorization"]
        assert requests[-1].content == response.request.content


@pytest.mark.parametrize(
    ("failure", "status"), [(httpx.ConnectError, 502), (httpx.ReadTimeout, 504)]
)
async def test_embedded_admission_proxy_handles_unavailable_backend(
    env: Any, monkeypatch: Any, failure: Any, status: int
) -> None:
    from octop.api.routers import admission_demo_proxy as proxy

    client, _server, auth = env

    def handle(request: httpx.Request) -> httpx.Response:
        raise failure("backend unavailable", request=request)

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        proxy.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    response = await client.post(
        "/admission-registration-api/v1/ai/candidates", headers=auth, json={}
    )
    assert response.status_code == status
    assert response.json()["detail"]


async def test_embedded_admission_proxy_rejects_large_body_and_invalid_session(env: Any) -> None:
    client, _server, auth = env
    response = await client.post(
        "/admission-registration-api/v1/ai/candidates", headers=auth, content=b"x" * 65537
    )
    assert response.status_code == 413
    response = await client.post(
        "/admission-registration-api/v1/sessions/invalid:session/turns", headers=auth, json={}
    )
    assert response.status_code == 422


@pytest.mark.parametrize("status", [200, 307])
async def test_embedded_admission_proxy_rejects_html_and_redirects(
    env: Any, monkeypatch: Any, status: int
) -> None:
    from octop.api.routers import admission_demo_proxy as proxy

    client, _server, auth = env
    requests = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            status,
            text="<html>wrong service</html>",
            headers={"Content-Type": "text/html", "Location": "https://untrusted.invalid/"},
        )

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        proxy.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(transport=httpx.MockTransport(handle), **kwargs),
    )
    response = await client.post(
        "/admission-registration-api/v1/ai/candidates", headers=auth, json={}
    )
    assert response.status_code == 502
    assert len(requests) == 1
    assert "location" not in response.headers
