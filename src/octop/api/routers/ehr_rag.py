"""Authenticated proxy to the loopback EHR reference-search service."""

from __future__ import annotations

import json
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from octop.api.common.client_ip import resolve_client_ip
from octop.api.deps import current_user
from octop.infra.ehr_public import (
    PublicEhrRateLimiter,
    project_public_search_response,
    public_search_payload,
)
from octop.infra.users.identity import User

router = APIRouter()
public_router = APIRouter()
_MAX_BODY_BYTES = 512 * 1024
_PUBLIC_LIMITER = PublicEhrRateLimiter()
_PUBLIC_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


class PublicEhrSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    top_k: int = Field(default=10, ge=1, le=12)

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("query must not be blank")
        return value


def _allowed(method: str, path: str) -> bool:
    if method == "GET":
        return path in {"api/health", "api/stats", "api/skills"} or bool(
            re.fullmatch(r"api/graph/(?:node|subgraph)/[A-Za-z0-9:_-]+", path)
        )
    if method == "POST":
        return path in {
            "api/search",
            "api/qa",
            "api/graph/search",
            "api/graph/path",
        } or bool(re.fullmatch(r"api/skills/[A-Za-z0-9_.-]+/run", path))
    return False


async def _proxy_ehr_rag(
    upstream_path: str,
    request: Request,
    user: User,
) -> Response:
    del user
    method = request.method
    if not _allowed(method, upstream_path):
        raise HTTPException(status_code=404, detail="Not Found")

    if len(request.url.query) > 4096:
        raise HTTPException(status_code=413, detail="Query string too large")
    body = bytearray()
    if method == "POST":
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > _MAX_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Request body too large")

    upstream = await _request_ehr_rag(request, upstream_path, bytes(body) or None)

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers={"content-type": upstream.headers.get("content-type", "application/json")},
    )


async def _request_ehr_rag(
    request: Request,
    upstream_path: str,
    content: bytes | None = None,
) -> httpx.Response:
    server = request.app.state.octop_server
    base_url = server.services.config.ehr_rag_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            return await client.request(
                request.method,
                f"{base_url}/{upstream_path}",
                params=request.query_params,
                content=content,
                headers={"content-type": "application/json"} if content else None,
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="EHR search service unavailable") from exc


@router.get(
    "/{upstream_path:path}",
    operation_id="proxy_ehr_rag_get",
    summary="Read EHR reference data and graph",
    description="Forwards allowlisted EHR GET endpoints to the loopback service; requires Octop login.",
)
async def proxy_ehr_rag_get(
    upstream_path: str,
    request: Request,
    user: User = Depends(current_user),
) -> Response:
    return await _proxy_ehr_rag(upstream_path, request, user)


@router.post(
    "/{upstream_path:path}",
    operation_id="proxy_ehr_rag_post",
    summary="Search or ask EHR reference data",
    description="Forwards allowlisted EHR POST endpoints to the loopback service; requires Octop login.",
)
async def proxy_ehr_rag_post(
    upstream_path: str,
    request: Request,
    user: User = Depends(current_user),
) -> Response:
    return await _proxy_ehr_rag(upstream_path, request, user)


@public_router.get(
    "/health",
    summary="Check the public EHR knowledge service",
    description="Anonymous health check for the isolated public EHR search page.",
)
async def public_ehr_health(request: Request) -> JSONResponse:
    upstream = await _request_ehr_rag(request, "api/health")
    if upstream.status_code != 200:
        raise HTTPException(status_code=502)
    try:
        payload = upstream.json()
    except ValueError as exc:
        raise HTTPException(status_code=502) from exc
    return JSONResponse(
        {"ok": bool(payload.get("ok")) if isinstance(payload, dict) else False},
        headers=_PUBLIC_HEADERS,
    )


@public_router.post(
    "/search",
    summary="Search curated public EHR knowledge",
    description="Anonymous, rate-limited medical search. Document, code, Agent and workspace data are excluded.",
)
async def public_ehr_search(
    payload: PublicEhrSearchRequest,
    request: Request,
) -> JSONResponse:
    if not _PUBLIC_LIMITER.allow(resolve_client_ip(request)):
        raise HTTPException(status_code=429)
    upstream = await _request_ehr_rag(
        request,
        "api/search",
        json.dumps(public_search_payload(payload.query, payload.top_k)).encode(),
    )
    if upstream.status_code != 200:
        raise HTTPException(status_code=502)
    try:
        projected = project_public_search_response(payload.query, upstream.json())
    except ValueError as exc:
        raise HTTPException(status_code=502) from exc
    return JSONResponse(projected, headers=_PUBLIC_HEADERS)
