"""Same-origin transport for the independently hosted admission Demo API."""

from __future__ import annotations

import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response

from octop.api.deps import ACCESS_TOKEN_RESPONSE_HEADER, current_user
from octop.i18n import tr
from octop.infra.utils.locale import resolve_request_locale

router = APIRouter(dependencies=[Depends(current_user)])
_PREFIX = "/admission-registration-api/v1"
_MAX_BODY_BYTES = 64 * 1024


async def _forward(request: Request, path: str) -> Response:
    locale = resolve_request_locale(request)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > _MAX_BODY_BYTES:
            raise HTTPException(
                status_code=413, detail=tr("admission_proxy.request_too_large", locale)
            )
    headers = {
        key: request.headers[key]
        for key in ("authorization", "content-type", "accept-language")
        if key in request.headers
    }
    origin = os.getenv("ADMISSION_API_ORIGIN", "http://127.0.0.1:8765").rstrip("/")
    try:
        # The target is operator-configured; never follow redirects with a patient's token.
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(40.0, connect=3.0), trust_env=False, follow_redirects=False
        ) as client:
            upstream = await client.request(
                request.method,
                f"{origin}/api/admission-registration/v1/{path}",
                content=bytes(body),
                headers=headers,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail=tr("admission_proxy.timeout", locale)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=tr("admission_proxy.unavailable", locale)
        ) from exc
    if upstream.headers.get("content-type", "").split(";", 1)[0] != "application/json":
        raise HTTPException(status_code=502, detail=tr("admission_proxy.invalid_response", locale))
    response_headers = {"Cache-Control": "no-store"}
    renewed_token = upstream.headers.get(ACCESS_TOKEN_RESPONSE_HEADER)
    if renewed_token:
        response_headers[ACCESS_TOKEN_RESPONSE_HEADER] = renewed_token
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type="application/json",
        headers=response_headers,
    )


@router.post(_PREFIX + "/ai/candidates", include_in_schema=False)
async def candidates(request: Request) -> Response:
    return await _forward(request, "ai/candidates")


@router.get(_PREFIX + "/regions", include_in_schema=False)
async def regions(request: Request) -> Response:
    return await _forward(request, "regions")


@router.post(_PREFIX + "/sessions/{session_id}/turns", include_in_schema=False)
async def save_turn(
    request: Request,
    session_id: Annotated[str, Path(min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")],
) -> Response:
    return await _forward(request, f"sessions/{session_id}/turns")
