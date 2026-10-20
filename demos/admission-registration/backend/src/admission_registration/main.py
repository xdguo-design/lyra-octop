from __future__ import annotations

import json
import os
from hashlib import sha256
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from admission_registration.ai import accepted_candidates
from admission_registration.contracts import REGIONS, validate_fields
from admission_registration.store import DemoStore, StoreCapacityError

API_PREFIX = "/api/admission-registration/v1"
OCTOP_API_BASE_URL = os.getenv("OCTOP_API_BASE_URL", "http://127.0.0.1:8200").rstrip("/")
_platform_url = urlparse(OCTOP_API_BASE_URL)
if (
    _platform_url.scheme not in {"http", "https"}
    or not _platform_url.hostname
    or _platform_url.username
):
    raise RuntimeError("OCTOP_API_BASE_URL must be a fixed HTTP(S) origin")

app = FastAPI(title="Admission Registration Demo API", version="0.1.0")
store = DemoStore()
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ADMISSION_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "Accept-Language"],
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidationBody(StrictModel):
    fields: dict[str, Any]


class VerifyBody(StrictModel):
    method: Literal["id_card", "social_card", "insurance_qr"]
    mockScenario: Literal["success", "failed", "no_profile"] = "success"


class SubmissionBody(StrictModel):
    identityToken: str = Field(min_length=1, max_length=64)
    idempotencyKey: str = Field(min_length=8, max_length=128)
    mockScenario: Literal["success", "failed", "already_registered", "unknown"] = "success"
    fields: dict[str, Any]


class SubmissionResultBody(StrictModel):
    identityToken: str = Field(min_length=1, max_length=64)
    idempotencyKey: str = Field(min_length=8, max_length=128)


class AiBody(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
    page: int = Field(ge=1, le=2)
    identityToken: str = Field(min_length=1, max_length=64)


class HealthResponse(StrictModel):
    status: Literal["ok"]


class ValidationResponse(StrictModel):
    valid: bool
    errors: dict[str, str]


class IdentityResponse(StrictModel):
    mock: bool
    verified: bool
    identityToken: str
    fields: dict[str, Any]


class RegionOption(StrictModel):
    value: str
    label: str
    leaf: bool


class RegionsResponse(StrictModel):
    mock: bool
    items: list[RegionOption]


class SubmissionResponse(StrictModel):
    mock: bool
    status: Literal["success", "failed", "already_registered", "unknown"]
    receiptId: str | None = None
    notificationSent: bool | None = None
    printSucceeded: bool | None = None


class AiCandidatesResponse(StrictModel):
    fields: dict[str, Any]


def _validate_or_422(fields: dict[str, Any]) -> None:
    errors = validate_fields(fields)
    if errors:
        raise HTTPException(status_code=422, detail={"code": "VALIDATION_FAILED", "errors": errors})


@app.get(API_PREFIX + "/health", response_model=HealthResponse, summary="检查演示服务")
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post(
    API_PREFIX + "/validate",
    response_model=ValidationResponse,
    responses={422: {"model": ValidationResponse}},
    summary="校验入院登记字段",
)
def validate(body: ValidationBody) -> JSONResponse:
    errors = validate_fields(body.fields)
    return JSONResponse(
        status_code=200 if not errors else 422, content={"valid": not errors, "errors": errors}
    )


@app.post(
    API_PREFIX + "/identity/verify",
    response_model=IdentityResponse,
    summary="执行模拟身份核验",
)
def verify(body: VerifyBody) -> dict[str, object]:
    if body.mockScenario == "failed":
        raise HTTPException(status_code=422, detail="模拟身份核验失败，请重试或联系现场工作人员")
    if body.mockScenario == "no_profile":
        raise HTTPException(status_code=404, detail="演示档案中未找到该身份，请联系现场工作人员")
    try:
        return store.verify(body.method)
    except StoreCapacityError as exc:
        raise HTTPException(status_code=503, detail="模拟服务当前繁忙，请稍后重试") from exc


@app.get(
    API_PREFIX + "/regions",
    response_model=RegionsResponse,
    summary="读取模拟地区选项",
)
def regions(parent_code: str | None = Query(default=None, alias="parentCode")) -> dict[str, object]:
    nodes = REGIONS
    if parent_code:
        node = _find_region(nodes, parent_code)
        if node is None:
            raise HTTPException(status_code=404, detail="地区不存在")
        nodes = node.get("children", [])
    return {
        "mock": True,
        "items": [
            {"value": node["code"], "label": node["label"], "leaf": not node.get("children")}
            for node in nodes
        ],
    }


@app.post(
    API_PREFIX + "/submissions",
    response_model=SubmissionResponse,
    summary="创建模拟入院登记",
)
def submit(body: SubmissionBody) -> dict[str, object]:
    identity = store.identity(body.identityToken)
    if identity is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    _validate_or_422(body.fields)
    identity_fields = identity["fields"]
    readonly_fields = ("name", "idNumber", "nationality", "ethnicity")
    if any(body.fields.get(key) != identity_fields.get(key) for key in readonly_fields):
        raise HTTPException(status_code=409, detail="核验身份信息不能修改")
    try:
        stored = store.submit(
            body.identityToken,
            body.idempotencyKey,
            body.fields,
            body.mockScenario,
        )
    except StoreCapacityError as exc:
        raise HTTPException(status_code=503, detail="模拟登记服务当前繁忙，请稍后重试") from exc
    if stored is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    fingerprint, result = stored
    current_fingerprint = sha256(
        json.dumps([body.fields, body.mockScenario], ensure_ascii=False, sort_keys=True).encode(
            "utf-8"
        )
    ).hexdigest()
    if fingerprint != current_fingerprint:
        raise HTTPException(
            status_code=409, detail="该确认请求已处理，请勿使用相同请求编号提交不同内容"
        )
    return result


@app.post(
    API_PREFIX + "/submissions/result",
    response_model=SubmissionResponse,
    summary="查询模拟登记结果",
)
def submission_result(body: SubmissionResultBody) -> dict[str, object]:
    if store.identity(body.identityToken) is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    result = store.result(body.identityToken, body.idempotencyKey)
    return result or {"mock": True, "status": "unknown"}


@app.post(
    API_PREFIX + "/ai/candidates",
    response_model=AiCandidatesResponse,
    summary="通过平台 AI 提取候选字段",
    description=(
        "只转发当前转写和表单页码到固定 Octop 入院提取接口；"
        "要求身份核验会话未过期，不会发送历史，也不会提交登记。"
    ),
)
async def ai_candidates(
    body: AiBody,
    response: Response,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="请登录平台后使用智能填写")
    if store.identity(body.identityToken) is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(32.0, connect=3.0)) as client:
            platform_response = await client.post(
                f"{OCTOP_API_BASE_URL}/api/admission-demo/extract",
                json={"text": body.text, "page": body.page},
                headers={"Authorization": authorization},
            )
        platform_response.raise_for_status()
        payload = platform_response.json()
        renewed_token = platform_response.headers.get("X-Octop-Access-Token")
        if renewed_token:
            response.headers["X-Octop-Access-Token"] = renewed_token
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504, detail="智能填写响应超时，请保留转写并手动补充"
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="平台智能填写暂不可用，请保留转写并手动补充"
        ) from exc
    candidates = accepted_candidates(
        body.text, payload.get("fields") if isinstance(payload, dict) else None, body.page
    )
    return {"fields": candidates}


def _find_region(nodes: list[dict[str, Any]], code: str) -> dict[str, Any] | None:
    for node in nodes:
        if node["code"] == code:
            return node
        found = _find_region(node.get("children", []), code)
        if found:
            return found
    return None
