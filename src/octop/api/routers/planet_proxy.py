"""Same-origin transport for the lyra-planet kids app served on loopback.

The Creations page embeds the planet app in an iframe. Browsers block public
pages from loading ``http://127.0.0.1:*`` iframes (Private Network Access), so
the app is proxied under ``/planet/`` instead: same origin as the dashboard,
works on every deployment that has the planet backend listening on loopback.
Deployments without it degrade to a 502 — the dashboard stays unaffected.
"""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from starlette.background import BackgroundTask
from starlette.responses import Response

from octop.i18n import tr
from octop.infra.utils.locale import resolve_request_locale

router = APIRouter()

_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
_REQUEST_HEADERS = ("content-type", "accept-language")
_RESPONSE_HEADERS = (
    "content-type",
    "cache-control",
    "etag",
    "last-modified",
    "content-disposition",
)


def _target() -> str:
    return os.getenv("PLANET_PROXY_ORIGIN", "http://127.0.0.1:8130").rstrip("/")


async def _forward(request: Request, path: str) -> Response:
    url = f"{_target()}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    headers = {key: request.headers[key] for key in _REQUEST_HEADERS if key in request.headers}
    # Buffer the request body so httpx frames the upstream request with
    # Content-Length instead of Transfer-Encoding: chunked — a bodyless GET
    # must not stream a chunked terminator an upstream may never read (a
    # connection closed with unread buffered data answers RST on Windows,
    # which surfaces as a broken read while draining the response).
    body = await request.body()
    locale = resolve_request_locale(request)
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=3.0), trust_env=False)
    upstream_request = client.build_request(
        request.method, url, content=body or None, headers=headers
    )
    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise HTTPException(status_code=504, detail=tr("planet_proxy.timeout", locale)) from exc
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=tr("planet_proxy.unavailable", locale)) from exc

    async def _cleanup() -> None:
        await upstream.aclose()
        await client.aclose()

    forwarded = {key: upstream.headers[key] for key in _RESPONSE_HEADERS if key in upstream.headers}
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=forwarded,
        background=BackgroundTask(_cleanup),
    )


@router.api_route("/planet", methods=_METHODS, include_in_schema=False)
async def planet_root() -> Response:
    # Relative asset/API paths in the planet frontend need the trailing slash.
    return RedirectResponse("/planet/", status_code=308)


@router.api_route("/planet/{path:path}", methods=_METHODS, include_in_schema=False)
async def planet_proxy(request: Request, path: str) -> Response:
    return await _forward(request, path)
