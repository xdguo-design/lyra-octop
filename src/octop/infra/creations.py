"""Capture public website thumbnails for the Creations page."""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import socket
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

_CAPTURE_TIMEOUT_SECONDS = 15
_MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
_MAX_PROXY_BYTES = 20 * 1024 * 1024
_ITEM_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_CAPTURE_SEMAPHORE = asyncio.Semaphore(2)


def creation_thumbnail_path(root: Path, owner_user_id: int, item_id: str) -> Path:
    if not _ITEM_ID_RE.fullmatch(item_id):
        raise ValueError("invalid creation item id")
    return root / "creation-thumbnails" / str(owner_user_id) / f"{item_id}.jpg"


async def capture_creation_thumbnail(url: str, destination: Path) -> bool:
    """Save a first-viewport JPEG; failures remove stale captures and return False."""
    try:
        async with asyncio.timeout(_CAPTURE_TIMEOUT_SECONDS):
            async with _CAPTURE_SEMAPHORE:
                image = await _capture(url)
        if not image or len(image) > _MAX_THUMBNAIL_BYTES:
            raise ValueError("thumbnail is empty or too large")
        await asyncio.to_thread(_write_thumbnail, destination, image)
        return True
    except Exception:
        await asyncio.to_thread(_remove_thumbnail, destination)
        return False


async def capture_trusted_local_thumbnail(
    url: str,
    allowed_origins: tuple[str, ...],
    destination: Path,
) -> bool:
    """Capture a managed preview while allowing only its configured loopback origins."""
    try:
        parsed_url = urlsplit(url)
        allowed = set(allowed_origins)
        if (
            parsed_url.scheme != "http"
            or parsed_url.hostname != "127.0.0.1"
            or f"{parsed_url.scheme}://{parsed_url.netloc}" not in allowed
            or not allowed
            or any(
                (parsed := urlsplit(origin)).scheme != "http"
                or parsed.hostname != "127.0.0.1"
                or not parsed.port
                for origin in allowed
            )
        ):
            raise ValueError("thumbnail capture target is not a configured loopback origin")
        async with asyncio.timeout(_CAPTURE_TIMEOUT_SECONDS):
            async with _CAPTURE_SEMAPHORE:
                image = await _capture_trusted_local(url, allowed)
        if not image or len(image) > _MAX_THUMBNAIL_BYTES:
            raise ValueError("thumbnail is empty or too large")
        await asyncio.to_thread(_write_thumbnail, destination, image)
        return True
    except Exception:
        await asyncio.to_thread(_remove_thumbnail, destination)
        return False


async def _capture_trusted_local(url: str, allowed_origins: set[str]) -> bytes:
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        try:
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                service_workers="block",
            )
            try:
                page = await context.new_page()
                request_count = 0
                transferred_bytes = 0

                async def allow_managed_origin(route: Any) -> None:
                    nonlocal request_count
                    request_count += 1
                    request_url = urlsplit(route.request.url)
                    origin = f"{request_url.scheme}://{request_url.netloc}"
                    if (
                        request_count > 256
                        or request_url.scheme != "http"
                        or request_url.hostname != "127.0.0.1"
                        or origin not in allowed_origins
                    ):
                        await route.abort()
                        return
                    await route.continue_()

                async def limit_response(response: Any) -> None:
                    nonlocal transferred_bytes
                    length = response.headers.get("content-length")
                    if length and length.isdigit():
                        transferred_bytes += int(length)
                        if transferred_bytes > _MAX_PROXY_BYTES:
                            await response.finished()
                            await page.close()

                await page.route("**/*", allow_managed_origin)
                page.on("response", lambda response: asyncio.create_task(limit_response(response)))
                await page.goto(url, wait_until="domcontentloaded", timeout=12_000)
                await page.wait_for_timeout(500)
                return await page.screenshot(type="jpeg", quality=70, full_page=False)
            finally:
                await context.close()
        finally:
            await browser.close()


async def _capture(url: str) -> bytes:
    from playwright.async_api import async_playwright

    proxy = _PublicEgressProxy()
    async with proxy, async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            proxy={"server": proxy.url, "bypass": "<-loopback>"},
            args=["--proxy-bypass-list=<-loopback>"],
        )
        try:
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                service_workers="block",
            )
            try:
                page = await context.new_page()

                async def allow_web_request(route: Any) -> None:
                    request_url = urlsplit(route.request.url)
                    hostname = (request_url.hostname or "").rstrip(".").lower()
                    try:
                        blocked_loopback = not ipaddress.ip_address(hostname).is_global
                    except ValueError:
                        blocked_loopback = hostname == "localhost" or hostname.endswith(
                            ".localhost"
                        )
                    if (
                        request_url.scheme not in {"http", "https"}
                        or not request_url.hostname
                        or request_url.username is not None
                        or request_url.password is not None
                        or blocked_loopback
                    ):
                        await route.abort()
                        return
                    await route.continue_()

                await page.route("**/*", allow_web_request)
                await page.goto(url, wait_until="domcontentloaded", timeout=12_000)
                await page.wait_for_timeout(500)
                return await page.screenshot(type="jpeg", quality=70, full_page=False)
            finally:
                await context.close()
        finally:
            await browser.close()


def _write_thumbnail(destination: Path, image: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    try:
        temporary.write_bytes(image)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _remove_thumbnail(destination: Path) -> None:
    with suppress(OSError):
        destination.unlink(missing_ok=True)


def remove_creation_thumbnail(destination: Path) -> None:
    _remove_thumbnail(destination)


class _PublicEgressProxy:
    """Short-lived HTTP proxy that pins each outbound connection to a public IP."""

    def __init__(self) -> None:
        self._server: asyncio.Server | None = None
        self.url = ""
        self._bytes = 0

    def _consume(self, size: int) -> None:
        self._bytes += size
        if self._bytes > _MAX_PROXY_BYTES:
            raise ValueError("thumbnail capture exceeded its network budget")

    async def __aenter__(self) -> _PublicEgressProxy:
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0, limit=65536)
        address = self._server.sockets[0].getsockname()
        self.url = f"http://127.0.0.1:{address[1]}"
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        upstream: tuple[asyncio.StreamReader, asyncio.StreamWriter] | None = None
        try:
            request_line = await asyncio.wait_for(reader.readline(), timeout=3)
            method, target, _ = request_line.decode("ascii").strip().split(" ", 2)
            headers = await _read_proxy_headers(reader)
            if method.upper() == "CONNECT":
                host, port = _parse_authority(target, 443)
                upstream = await _connect_public(host, port)
                writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await writer.drain()
                await _tunnel(reader, writer, *upstream, proxy=self)
                return

            parsed = urlsplit(target)
            if (
                method.upper() not in {"GET", "HEAD"}
                or parsed.scheme.lower() != "http"
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or any(name.lower() == b"upgrade" for name, _ in headers)
            ):
                raise ValueError("unsupported proxy request")
            port = parsed.port or 80
            upstream = await _connect_public(parsed.hostname, port)
            path = parsed.path or "/"
            if parsed.query:
                path += "?" + parsed.query
            host_header = parsed.netloc.encode("ascii")
            forwarded = [f"{method} {path} HTTP/1.1\r\n".encode("ascii")]
            forwarded.extend(
                name + b": " + value + b"\r\n"
                for name, value in headers
                if name.lower()
                not in {b"host", b"connection", b"proxy-connection", b"proxy-authorization"}
            )
            forwarded.extend((b"Host: " + host_header + b"\r\n", b"Connection: close\r\n\r\n"))
            upstream[1].write(b"".join(forwarded))
            await upstream[1].drain()
            await _relay_response(upstream[0], writer, self)
        except Exception:
            if not writer.is_closing():
                writer.write(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
                with suppress(OSError):
                    await writer.drain()
        finally:
            if upstream is not None:
                upstream[1].close()
                with suppress(OSError):
                    await upstream[1].wait_closed()
            writer.close()
            with suppress(OSError):
                await writer.wait_closed()


async def _read_proxy_headers(reader: asyncio.StreamReader) -> list[tuple[bytes, bytes]]:
    headers: list[tuple[bytes, bytes]] = []
    size = 0
    while True:
        line = await asyncio.wait_for(reader.readline(), timeout=3)
        size += len(line)
        if size > 65536:
            raise ValueError("proxy headers are too large")
        if line in {b"\r\n", b"\n", b""}:
            return headers
        name, separator, value = line.partition(b":")
        if not separator:
            raise ValueError("invalid proxy header")
        headers.append((name.strip(), value.strip()))


def _parse_authority(value: str, default_port: int) -> tuple[str, int]:
    parsed = urlsplit("//" + value)
    if not parsed.hostname or parsed.username is not None or parsed.password is not None:
        raise ValueError("invalid proxy authority")
    port = parsed.port or default_port
    if not 1 <= port <= 65535:
        raise ValueError("invalid proxy port")
    return parsed.hostname, port


async def _connect_public(
    host: str, port: int
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    try:
        literal = ipaddress.ip_address(host)
        addresses = [literal]
    except ValueError:
        loop = asyncio.get_running_loop()
        results = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = [ipaddress.ip_address(result[4][0]) for result in results]
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("target is not globally routable")
    last_error: OSError | None = None
    for address in addresses:
        try:
            return await asyncio.wait_for(asyncio.open_connection(str(address), port), timeout=4)
        except OSError as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    raise OSError("no public address available")


async def _tunnel(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    upstream_reader: asyncio.StreamReader,
    upstream_writer: asyncio.StreamWriter,
    *,
    proxy: _PublicEgressProxy,
) -> None:
    async def pump(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        while chunk := await reader.read(65536):
            proxy._consume(len(chunk))
            writer.write(chunk)
            await writer.drain()

    tasks = {
        asyncio.create_task(pump(client_reader, upstream_writer)),
        asyncio.create_task(pump(upstream_reader, client_writer)),
    }
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    await asyncio.gather(*done, *pending, return_exceptions=True)


async def _relay_response(
    upstream_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    proxy: _PublicEgressProxy,
) -> None:
    while chunk := await upstream_reader.read(65536):
        proxy._consume(len(chunk))
        client_writer.write(chunk)
        await client_writer.drain()
