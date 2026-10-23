"""Route wildcard preview subdomains to their loopback-only project containers."""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import AsyncIterator
from typing import Any, cast
from urllib.parse import urlsplit

import httpx
from fastapi import Request
from fastapi.responses import Response, StreamingResponse
from starlette.background import BackgroundTask
from starlette.types import ASGIApp, Receive, Scope, Send
from websockets.asyncio.client import connect as websocket_connect

_INSTALL_ATTR = "_octop_project_preview_proxy_installed"
logger = logging.getLogger(__name__)
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


class _ProjectPreviewProxyMiddleware:
    def __init__(self, app: ASGIApp, server: Any) -> None:
        self.app = app
        self.server = server

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        host = headers.get(b"host", b"").decode("latin-1")
        manager = self.server.project_service_manager
        resolver = getattr(manager, "preview_upstream_for_host", None)
        upstream_url = resolver(host) if callable(resolver) else None
        is_preview_host = getattr(manager, "is_preview_host", None)
        if callable(is_preview_host) and is_preview_host(host) and upstream_url is None:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                response = Response("Preview is stopped or unavailable", status_code=404)
                await response(scope, receive, send)
            return
        if upstream_url is None:
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await _forward_websocket(scope, receive, send, upstream_url, host, headers)
            return
        request = Request(scope, receive)
        response = await _forward(request, upstream_url, host)
        await response(scope, receive, send)


def install(app: Any, server: Any) -> None:
    if getattr(app, _INSTALL_ATTR, False):
        return
    setattr(app, _INSTALL_ATTR, True)
    app.add_middleware(_ProjectPreviewProxyMiddleware, server=server)


async def _forward(request: Request, upstream_url: str, host: str) -> Response:
    upstream_origin = f"{urlsplit(upstream_url).scheme}://{urlsplit(upstream_url).netloc}"
    target = upstream_url + request.url.path
    if request.url.query:
        target += f"?{request.url.query}"
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower() not in _HOP_BY_HOP | {"host", "content-length"}
    }
    headers["host"] = host
    headers["x-forwarded-host"] = host
    headers["x-forwarded-proto"] = "https"
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(300.0, connect=5.0),
        trust_env=False,
        follow_redirects=False,
    )
    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                target,
                headers=headers,
                content=request.stream(),
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        return Response("Preview service unavailable", status_code=502)

    response_headers = {
        name: value for name, value in upstream.headers.items() if name.lower() not in _HOP_BY_HOP
    }
    location = response_headers.get("location")
    if location and location.startswith(upstream_origin):
        response_headers["location"] = f"https://{host}{location[len(upstream_origin) :]}"
    response_headers["referrer-policy"] = "no-referrer"

    async def close() -> None:
        await upstream.aclose()
        await client.aclose()

    async def body() -> AsyncIterator[bytes]:
        if upstream.is_stream_consumed:
            yield upstream.content
            return
        async for chunk in upstream.aiter_raw():
            yield chunk

    response = StreamingResponse(
        body(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(close),
    )
    response.raw_headers = [
        (name.lower().encode("latin-1"), value.encode("latin-1"))
        for name, value in upstream.headers.multi_items()
        if name.lower() not in _HOP_BY_HOP | {"referrer-policy"}
    ] + [
        (b"referrer-policy", b"no-referrer"),
    ]
    if location and location.startswith(upstream_origin):
        response.raw_headers = [
            (name, value) for name, value in response.raw_headers if name != b"location"
        ] + [
            (
                b"location",
                f"https://{host}{location[len(upstream_origin) :]}".encode("latin-1"),
            )
        ]
    return response


async def _forward_websocket(
    scope: Scope,
    receive: Receive,
    send: Send,
    upstream_url: str,
    host: str,
    headers: dict[bytes, bytes],
) -> None:
    await receive()
    upstream_headers = [
        (name.decode("latin-1"), value.decode("latin-1"))
        for name, value in headers.items()
        if name.lower().decode("latin-1")
        not in _HOP_BY_HOP
        | {
            "host",
            "content-length",
            "sec-websocket-key",
            "sec-websocket-version",
            "sec-websocket-extensions",
            "sec-websocket-protocol",
        }
    ]
    upstream_headers.extend(
        (("host", host), ("x-forwarded-host", host), ("x-forwarded-proto", "https"))
    )
    query = scope.get("query_string", b"").decode("latin-1")
    target = upstream_url.replace("http://", "ws://", 1) + scope["path"]
    if query:
        target += f"?{query}"
    protocols = [
        value.decode("latin-1")
        for value in headers.get(b"sec-websocket-protocol", b"").split(b",")
        if value.strip()
    ]
    origin = headers.get(b"origin")
    connect_options: dict[str, Any] = {
        "additional_headers": upstream_headers,
        "subprotocols": cast(Any, protocols or None),
        "origin": cast(Any, origin.decode("latin-1") if origin else None),
        "open_timeout": 5,
        "close_timeout": 2,
        "max_size": 2**20,
    }
    if "proxy" in inspect.signature(websocket_connect).parameters:
        connect_options["proxy"] = None
    try:
        async with websocket_connect(target, **connect_options) as upstream:
            await send({"type": "websocket.accept", "subprotocol": upstream.subprotocol})

            async def client_to_upstream() -> None:
                while True:
                    event = await receive()
                    if event["type"] == "websocket.disconnect":
                        return
                    if event.get("text") is not None:
                        await upstream.send(event["text"])
                    elif event.get("bytes") is not None:
                        await upstream.send(event["bytes"])

            async def upstream_to_client() -> None:
                async for message in upstream:
                    await send(
                        {"type": "websocket.send", "text": message}
                        if isinstance(message, str)
                        else {"type": "websocket.send", "bytes": message}
                    )

            tasks = {
                asyncio.create_task(client_to_upstream()),
                asyncio.create_task(upstream_to_client()),
            }
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            await asyncio.gather(*done, *pending, return_exceptions=True)
            await send({"type": "websocket.close", "code": 1000})
    except Exception:
        logger.exception("project preview websocket proxy failed")
        await send({"type": "websocket.close", "code": 1011})
