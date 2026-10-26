from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from hashlib import sha256
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx
from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from admission_registration.ai import candidate_result, model_input
from admission_registration.contracts import REGIONS, validate_fields
from admission_registration.store import DemoStore, StoreCapacityError

API_PREFIX = "/api/admission-registration/v1"
OCTOP_API_BASE_URL = os.getenv("OCTOP_API_BASE_URL", "http://127.0.0.1:8200").rstrip("/")
REGIONS_SERVICE_URL = os.getenv(
    "REGIONS_SERVICE_URL", "http://127.0.0.1:8210/api/regions"
).strip()
_platform_url = urlparse(OCTOP_API_BASE_URL)
if (
    _platform_url.scheme not in {"http", "https"}
    or not _platform_url.hostname
    or _platform_url.username
):
    raise RuntimeError("OCTOP_API_BASE_URL must be a fixed HTTP(S) origin")
_regions_url = urlparse(REGIONS_SERVICE_URL)
if _regions_url.scheme not in {"http", "https"} or not _regions_url.hostname or _regions_url.username:
    raise RuntimeError("REGIONS_SERVICE_URL must be a fixed HTTP(S) URL")

app = FastAPI(title="Admission Registration Demo API", version="0.1.0")
logger = logging.getLogger(__name__)
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
    page: int = Field(ge=0, le=2)
    identityToken: str = Field(min_length=1, max_length=64)
    sessionId: str = Field(min_length=1, max_length=64)
    turnId: str = Field(min_length=8, max_length=128)


class TurnBody(StrictModel):
    identityToken: str = Field(min_length=1, max_length=64)
    expectedRevision: int = Field(ge=0)
    turnId: str = Field(min_length=8, max_length=128)
    previousTurnId: str | None = Field(default=None, max_length=128)
    utterance: str = Field(max_length=2000)
    response: str = Field(max_length=4000)
    action: Literal[
        "voice_turn", "manual_turn", "candidate_accept", "candidate_reject", "manual_edit"
    ]
    fields: dict[str, Any] = Field(default_factory=dict)
    pendingProposal: dict[str, Any] | None = None


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
    children: list["RegionOption"] | None = None


class RegionsResponse(StrictModel):
    mock: bool
    items: list[RegionOption]


def _platform_region_tree(payload: Any) -> list[dict[str, Any]]:
    items = payload.get("items") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=503, detail="地区服务尚无可用缓存")
    seen: set[str] = set()

    def convert(nodes: list[Any], depth: int = 1) -> list[dict[str, Any]]:
        if depth > 3:
            raise ValueError("平台地区树超过三级")
        result = []
        for node in nodes:
            if not isinstance(node, dict):
                raise ValueError("平台地区节点无效")
            code, label, children = node.get("code", node.get("value")), node.get("label"), node.get("children", [])
            if (
                not isinstance(code, str)
                or not re.fullmatch(r"\d{6}", code)
                or code in seen
                or not isinstance(label, str)
                or not label.strip()
                or not isinstance(children, list)
            ):
                raise ValueError("平台地区节点无效")
            seen.add(code)
            result.append(
                {
                    "code": code,
                    "label": label,
                    **({"children": convert(children, depth + 1)} if children else {}),
                }
            )
        return result

    return convert(items)


class SubmissionResponse(StrictModel):
    mock: bool
    status: Literal["success", "failed", "already_registered", "unknown"]
    receiptId: str | None = None
    notificationSent: bool | None = None
    printSucceeded: bool | None = None


class AiCandidatesResponse(StrictModel):
    fields: dict[str, Any]
    clarification: str | None = Field(
        default=None, max_length=480, description="模型针对未确定字段向患者提出的问题"
    )
    clarificationChoices: list[str] = Field(
        default_factory=list, max_length=4, description="可点击或可语音复述的澄清单选项"
    )
    uncertainFields: list[str] | None = Field(
        default=None, description="模型识别为需要患者澄清的字段键"
    )
    errors: dict[str, str] | None = Field(
        default=None,
        description="识别到但未通过字段校验的候选及其修改提示",
    )
    modelName: str | None = Field(
        default=None,
        description="本次提取使用的模型展示名；旧版平台未返回时为空",
    )
    turnCount: int = Field(description="本次办理已用对话轮数")
    maxTurns: int = Field(default=20, description="本次办理最多允许的对话轮数")


def _read_owned_session(
    client: httpx.AsyncClient, session_id: str, identity_token: str, authorization: str
):
    return client.get(
        f"{OCTOP_API_BASE_URL}/api/admission-registration/v1/sessions/{quote(session_id, safe='')}",
        params={"identityToken": identity_token},
        headers={"Authorization": authorization},
    )


def _raise_session_error(status_code: int) -> None:
    if status_code == 401:
        raise HTTPException(status_code=401, detail="身份核验或平台登录已失效，请重新登录")
    if status_code == 404:
        raise HTTPException(status_code=404, detail="办理会话不存在或已过期")
    if status_code >= 400:
        raise HTTPException(status_code=502, detail="平台办理会话暂不可用")


def _turn_limit_error(turn_count: int) -> HTTPException:
    return HTTPException(
        status_code=429,
        detail={
            "code": "ADMISSION_TURN_LIMIT",
            "message": "本次登记已达到20轮对话上限，请直接在表单中修改或联系工作人员。",
            "turnCount": turn_count,
            "maxTurns": 20,
        },
    )


def _dialog_turn_count(turns: list[object]) -> int:
    return sum(
        1 for turn in turns if not isinstance(turn, dict) or turn.get("action") != "manual_edit"
    )


@app.post(
    API_PREFIX + "/sessions/{session_id}/turns",
    summary="保存登记对话并强制执行轮次上限",
    description="对话轮次由独立登记服务计数；Octop 仅保存经验证的会话记录。",
)
async def save_turn(
    session_id: str,
    body: TurnBody,
    response: Response,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="请登录平台后使用智能登记")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
            session_response = await _read_owned_session(
                client, session_id, body.identityToken, authorization
            )
            _raise_session_error(session_response.status_code)
            upstream_authorization = authorization
            renewed_token = session_response.headers.get("X-Octop-Access-Token")
            if renewed_token:
                response.headers["X-Octop-Access-Token"] = renewed_token
                upstream_authorization = f"Bearer {renewed_token}"
            session = session_response.json()
            turns = session.get("turns") if isinstance(session, dict) else None
            turns = turns if isinstance(turns, list) else []
            turn_count = _dialog_turn_count(turns)
            if any(isinstance(turn, dict) and turn.get("turnId") == body.turnId for turn in turns):
                return {
                    "sessionId": session_id,
                    "revision": session.get("revision", body.expectedRevision),
                    "lastTurnId": session.get("lastTurnId") or body.turnId,
                }
            if body.action != "manual_edit" and turn_count >= 20:
                raise _turn_limit_error(turn_count)
            saved_response = await client.post(
                f"{OCTOP_API_BASE_URL}/api/admission-registration/v1/sessions/"
                f"{quote(session_id, safe='')}/turns",
                json=body.model_dump(),
                headers={"Authorization": upstream_authorization},
            )
            if saved_response.status_code == 409:
                raise HTTPException(status_code=409, detail="会话内容已更新，请刷新后重试")
            _raise_session_error(saved_response.status_code)
            renewed_token = getattr(saved_response, "headers", {}).get("X-Octop-Access-Token")
            if renewed_token:
                response.headers["X-Octop-Access-Token"] = renewed_token
            return saved_response.json()
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="对话保存超时，请稍后重试") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="平台办理会话暂不可用") from exc


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
async def regions() -> dict[str, object]:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=3.0), trust_env=False, follow_redirects=False
        ) as client:
            response = await client.get(REGIONS_SERVICE_URL, params={}, headers={})
            response.raise_for_status()
        nodes = _platform_region_tree(response.json())
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="地区服务响应超时") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="读取行政区划失败，请检查地区服务配置") from exc

    def convert(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "value": node["code"],
                "label": node["label"],
                "leaf": not node.get("children"),
                **({"children": convert(node["children"])} if node.get("children") else {}),
            }
            for node in items
        ]

    return {"mock": False, "items": convert(nodes)}


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
    response_model_exclude_none=True,
    summary="通过平台 AI 提取候选字段",
    description=(
        "本服务读取本人会话并组装结构化资料、压缩历史、最近五轮和本轮回答；"
        "达到20轮后拒绝继续 AI 操作。Octop 只提供 Admission Agent/Skill/模型推理。"
    ),
)
async def ai_candidates(
    body: AiBody,
    response: Response,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="请登录平台后使用智能填写")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(32.0, connect=3.0)) as client:
            session_response = await _read_owned_session(
                client, body.sessionId, body.identityToken, authorization
            )
            if session_response.status_code == 401:
                raise HTTPException(status_code=401, detail="身份核验或平台登录已失效，请重新登录")
            if session_response.status_code == 404:
                raise HTTPException(status_code=404, detail="办理会话不存在或已过期")
            session_response.raise_for_status()
            upstream_authorization = authorization
            renewed_token = session_response.headers.get("X-Octop-Access-Token")
            if renewed_token:
                response.headers["X-Octop-Access-Token"] = renewed_token
                upstream_authorization = f"Bearer {renewed_token}"
            session = session_response.json()
            turns = session.get("turns") if isinstance(session, dict) else None
            turns = turns if isinstance(turns, list) else []
            turn_count = _dialog_turn_count(turns)
            existing_turn = next(
                (
                    turn
                    for turn in turns
                    if isinstance(turn, dict) and turn.get("turnId") == body.turnId
                ),
                None,
            )
            if existing_turn is not None:
                fields = existing_turn.get("fields")
                return {
                    "fields": fields if isinstance(fields, dict) else {},
                    "turnCount": turn_count,
                    "maxTurns": 20,
                }
            if turn_count >= 20:
                raise _turn_limit_error(turn_count)
            prompt = model_input(body.text, session)
            if len(prompt.encode("utf-8")) > 6000:
                raise HTTPException(
                    status_code=413,
                    detail={
                        "code": "AI_CONTEXT_TOO_LONG",
                        "message": "本轮回答和办理上下文超过模型输入限制，请缩短回答后重试。",
                    },
                )
            try:
                regions_response = await client.get(
                    REGIONS_SERVICE_URL,
                    params={},
                    headers={},
                )
                regions_response.raise_for_status()
                region_tree = _platform_region_tree(regions_response.json())
            except (httpx.HTTPError, HTTPException, ValueError) as exc:
                logger.warning(
                    "Region lookup failed during candidate extraction; "
                    "using bundled region data: %s",
                    exc,
                )
                region_tree = REGIONS
            pages = (1, 2) if body.page == 0 else (body.page,)
            platform_responses = await asyncio.gather(
                *(
                    client.post(
                        f"{OCTOP_API_BASE_URL}/api/admission-demo/extract",
                        json={"text": prompt, "page": page},
                        headers={"Authorization": upstream_authorization},
                    )
                    for page in pages
                )
            )
            for platform_response in platform_responses:
                if getattr(platform_response, "status_code", 200) == 401:
                    raise HTTPException(status_code=401, detail="平台登录已失效，请重新登录")
                platform_response.raise_for_status()
                renewed_token = platform_response.headers.get("X-Octop-Access-Token")
                if renewed_token:
                    response.headers["X-Octop-Access-Token"] = renewed_token
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise HTTPException(status_code=401, detail="平台登录已失效，请重新登录") from exc
        raise HTTPException(
            status_code=502, detail="平台智能填写暂不可用，请保留转写并手动补充"
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504, detail="智能填写响应超时，请保留转写并手动补充"
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="平台智能填写暂不可用，请保留转写并手动补充"
        ) from exc
    extracted: dict[str, Any] = {}
    model_name: str | None = None
    clarification_parts: list[str] = []
    clarification_choice_sets: list[list[str]] = []
    uncertain_fields: list[str] = []
    has_uncertainty_metadata = False
    for platform_response in platform_responses:
        payload = platform_response.json()
        if isinstance(payload, dict):
            fields = payload.get("fields")
            if isinstance(fields, dict):
                extracted.update(fields)
            candidate_uncertain = payload.get("uncertainFields")
            if isinstance(candidate_uncertain, list):
                has_uncertainty_metadata = True
                uncertain_fields.extend(
                    field
                    for field in candidate_uncertain
                    if isinstance(field, str) and field not in uncertain_fields
                )
            candidate_clarification = payload.get("clarification")
            if (
                isinstance(candidate_clarification, str)
                and candidate_clarification.strip()
                and candidate_clarification.strip() not in clarification_parts
            ):
                clarification_parts.append(candidate_clarification.strip())
                candidate_choices = payload.get("clarificationChoices")
                clarification_choice_sets.append(
                    [
                        choice.strip()
                        for choice in candidate_choices[:4]
                        if isinstance(choice, str) and choice.strip()
                    ]
                    if isinstance(candidate_choices, list)
                    else []
                )
            candidate_model = payload.get("modelName")
            if isinstance(candidate_model, str) and candidate_model.strip():
                model_name = candidate_model.strip()
    candidates, errors = candidate_result(
        body.text,
        extracted,
        body.page,
        region_tree,
        uncertain_fields=uncertain_fields if has_uncertainty_metadata else None,
    )
    result: dict[str, Any] = {"fields": candidates}
    if clarification_parts:
        result["clarification"] = " ".join(clarification_parts)[:480]
        if len(clarification_parts) == 1:
            result["clarificationChoices"] = clarification_choice_sets[0]
    if has_uncertainty_metadata:
        result["uncertainFields"] = uncertain_fields
    if errors:
        result["errors"] = errors
    if model_name:
        result["modelName"] = model_name
    result["turnCount"] = turn_count
    result["maxTurns"] = 20
    return result
