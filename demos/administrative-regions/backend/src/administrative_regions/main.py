from __future__ import annotations

import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from administrative_regions.service import RegionService

MAX_MCP_BODY = 64 * 1024
_STATIC_PAGE = Path(__file__).with_name("static") / "index.html"


def _settings() -> tuple[str, Path, str, list[str]]:
    token = os.environ.get("ADMIN_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("ADMIN_TOKEN must contain at least 32 characters")
    timezone = os.environ.get("REGIONS_TIMEZONE", "Asia/Shanghai")
    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(f"unknown REGIONS_TIMEZONE: {timezone}") from exc
    data_dir = Path(os.environ.get("REGIONS_DATA_DIR", "./data")).resolve()
    origins = [
        origin.strip()
        for origin in os.environ.get("REGIONS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ]
    return token, data_dir, timezone, origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    token, data_dir, timezone, _origins = _settings()
    service = RegionService(data_dir)
    scheduler = AsyncIOScheduler(timezone=timezone)

    async def scheduled_sync() -> None:
        try:
            await service.sync()
        except Exception:
            pass

    scheduler.add_job(
        scheduled_sync,
        "cron",
        day_of_week="mon",
        hour=3,
        minute=0,
        id="official-regions-weekly-sync",
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.start()
    app.state.admin_token = token
    app.state.regions = service
    app.state.scheduler = scheduler
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="Octop Administrative Regions",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
)
_, _, _, _cors_origins = _settings() if os.environ.get("ADMIN_TOKEN") else ("", Path(), "", [])
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )


def _service(request: Request) -> RegionService:
    return request.app.state.regions


def _require_admin(request: Request, authorization: str | None) -> None:
    token = request.app.state.admin_token
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if (
        not authorization
        or not authorization.startswith("Bearer ")
        or not hmac.compare_digest(supplied, token)
    ):
        raise HTTPException(status_code=401, detail="有效的管理令牌是必需的")


@app.get("/", include_in_schema=False)
async def admin_page() -> FileResponse:
    return FileResponse(_STATIC_PAGE, media_type="text/html; charset=utf-8")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/regions")
async def get_regions(request: Request) -> dict[str, Any]:
    service = _service(request)
    return {
        "items": [
            {
                "code": node["code"],
                "label": node["label"],
                "children": _public_children(node.get("children", [])),
            }
            for node in service.regions
        ]
    }


def _public_children(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "code": node["code"],
            "label": node["label"],
            "children": _public_children(node.get("children", [])),
        }
        for node in nodes
    ]


@app.get("/api/status")
async def get_status(
    request: Request, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    _require_admin(request, authorization)
    return _service(request).status()


@app.post("/api/sync")
async def sync_regions(
    request: Request, authorization: str | None = Header(default=None)
) -> JSONResponse:
    _require_admin(request, authorization)
    try:
        return JSONResponse(await _service(request).sync())
    except Exception as exc:
        raise HTTPException(status_code=502, detail="同步失败；仍保留上次有效缓存") from exc


@app.post("/mcp")
async def mcp(request: Request, authorization: str | None = Header(default=None)) -> JSONResponse:
    _require_admin(request, authorization)
    body = await request.body()
    if len(body) > MAX_MCP_BODY:
        raise HTTPException(status_code=413, detail="MCP 请求过大")
    try:
        message = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="JSON-RPC 请求无效") from exc
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
        return _rpc_error(
            message.get("id") if isinstance(message, dict) else None, -32600, "无效请求"
        )
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params") if isinstance(message.get("params"), dict) else {}
    if method == "notifications/initialized":
        return JSONResponse({}, status_code=202)
    if method == "initialize":
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "administrative-regions", "version": "0.1.0"},
                },
            }
        )
    if method == "ping":
        return _rpc_result(request_id, {})
    if method == "tools/list":
        return _rpc_result(
            request_id,
            {
                "tools": [
                    {
                        "name": "regions_list",
                        "description": "列出官方行政区划；可传父级 6 位编码",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "parent_code": {"type": "string", "pattern": "^\\d{6}$"}
                            },
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": "regions_resolve",
                        "description": "解析地址中的行政区划；存在同名歧义时返回候选路径供用户确认",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"text": {"type": "string", "maxLength": 200}},
                            "required": ["text"],
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": "regions_status",
                        "description": "读取地区缓存和最近同步状态",
                        "inputSchema": {
                            "type": "object",
                            "properties": {},
                            "additionalProperties": False,
                        },
                    },
                    {
                        "name": "regions_sync",
                        "description": "从官方上游同步地区树并原子更新缓存",
                        "inputSchema": {
                            "type": "object",
                            "properties": {},
                            "additionalProperties": False,
                        },
                    },
                ]
            },
        )
    if method == "tools/call":
        return await _call_tool(request, request_id, params)
    return _rpc_error(request_id, -32601, "方法不存在")


async def _call_tool(request: Request, request_id: Any, params: dict[str, Any]) -> JSONResponse:
    name = params.get("name")
    args = params.get("arguments", {})
    if not isinstance(args, dict):
        return _rpc_error(request_id, -32602, "参数无效")
    service = _service(request)
    if name == "regions_list":
        parent = args.get("parent_code")
        if parent is not None and (
            not isinstance(parent, str) or not re.fullmatch(r"\d{6}", parent)
        ):
            return _rpc_error(request_id, -32602, "parent_code 必须是 6 位编码")
        try:
            result: Any = service.list_regions(parent)
        except KeyError:
            return _rpc_error(request_id, -32004, "地区不存在")
    elif name == "regions_resolve":
        text = args.get("text")
        if not isinstance(text, str) or not text or len(text) > 200:
            return _rpc_error(request_id, -32602, "text 必须为 1 到 200 个字符")
        result = service.resolve(text)
    elif name == "regions_status":
        result = service.status()
    elif name == "regions_sync":
        try:
            result = await service.sync()
        except Exception:
            return _rpc_result(
                request_id,
                {"isError": True, "content": [{"type": "text", "text": "同步失败，缓存已保留"}]},
            )
    else:
        return _rpc_error(request_id, -32602, "工具不存在")
    return _rpc_result(
        request_id,
        {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
            "structuredContent": result,
        },
    )


def _rpc_result(request_id: Any, result: Any) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})


def _rpc_error(request_id: Any, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    )
