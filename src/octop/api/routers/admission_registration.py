"""Authenticated mock API for the Vue admission-registration creation."""

from __future__ import annotations

import json
import time
from hashlib import sha256
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from octop.api.deps import current_user, get_server
from octop.infra.admission_demo import (
    AdmissionContextTooLongError,
    AdmissionModelRateLimitError,
    AdmissionModelUnavailableError,
    extract_active_registration_fields,
)
from octop.infra.admission_registration_demo import (
    FIELD_SCHEMA,
    StoreCapacityError,
    accepted_candidates,
    demo_store,
    regions_for,
    validate_fields,
)

router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidationBody(StrictModel):
    fields: dict[str, Any]


class VerifyBody(StrictModel):
    method: Literal["id_card", "social_card", "insurance_qr"]
    mockScenario: Literal["success", "failed", "no_profile"] = "success"


class SubmissionBody(StrictModel):
    identityToken: str = Field(min_length=1, max_length=64)
    applicationId: str = Field(min_length=1, max_length=64)
    sessionId: str = Field(min_length=8, max_length=128)
    reviewRevision: int = Field(ge=1)
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
    sessionId: str = Field(min_length=8, max_length=128)


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


class AdmissionApplication(StrictModel):
    id: str
    patientName: str
    department: str
    plannedAdmissionAt: str
    doctor: str | None = None
    orderedAt: str | None = None
    type: str | None = None
    diagnosis: str | None = None
    ward: str | None = None
    status: Literal["有效"]


class ApplicationsResponse(StrictModel):
    items: list[AdmissionApplication]


class SelectApplicationBody(StrictModel):
    identityToken: str = Field(min_length=1, max_length=64)
    applicationId: str = Field(min_length=1, max_length=64)


class SelectApplicationResponse(StrictModel):
    application: AdmissionApplication
    sessionId: str


class AdmissionTurnBody(StrictModel):
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


class AdmissionTurnResponse(StrictModel):
    turnId: str
    previousTurnId: str | None
    speaker: str
    utterance: str
    response: str
    action: str
    fields: dict[str, Any]
    status: str
    createdAt: int


class AdmissionSessionResponse(StrictModel):
    sessionId: str
    applicationId: str
    phase: str
    revision: int
    facts: dict[str, Any]
    summary: dict[str, Any]
    pendingProposal: dict[str, Any] | None
    lastTurnId: str | None
    turns: list[AdmissionTurnResponse]


class AdmissionTurnSaved(StrictModel):
    sessionId: str
    revision: int
    lastTurnId: str


class ReviewBody(StrictModel):
    identityToken: str = Field(min_length=1, max_length=64)
    expectedRevision: int = Field(ge=0)
    fields: dict[str, Any]


class ReviewResponse(StrictModel):
    sessionId: str
    reviewRevision: int
    applicationId: str


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


@router.get(
    "/admission-registration/v1/health",
    response_model=HealthResponse,
    summary="Check admission-registration demo API",
)
async def health(_user: Any = Depends(current_user)) -> HealthResponse:
    return HealthResponse(status="ok")


@router.post(
    "/admission-registration/v1/validate",
    response_model=ValidationResponse,
    responses={422: {"model": ValidationResponse}},
    summary="Validate mock admission fields",
)
async def validate(body: ValidationBody, _user: Any = Depends(current_user)) -> JSONResponse:
    errors = validate_fields(body.fields)
    return JSONResponse(
        status_code=200 if not errors else 422, content={"valid": not errors, "errors": errors}
    )


@router.post(
    "/admission-registration/v1/identity/verify",
    response_model=IdentityResponse,
    summary="Run mock identity verification",
)
async def verify(
    body: VerifyBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    if body.mockScenario == "failed":
        raise HTTPException(status_code=422, detail="模拟身份核验失败，请重试或联系现场工作人员")
    if body.mockScenario == "no_profile":
        raise HTTPException(status_code=404, detail="演示档案中未找到该身份，请联系现场工作人员")
    try:
        verified = demo_store.verify(user.id, body.method)
        identity = demo_store.identity(user.id, str(verified["identityToken"]))
        if identity is None:
            raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
        server.services.admission_session_repo.delete_for_patient(
            user.id, str(identity["patientRef"])
        )
        return verified
    except StoreCapacityError as exc:
        raise HTTPException(status_code=503, detail="模拟服务当前繁忙，请稍后重试") from exc


@router.get(
    "/admission-registration/v1/regions",
    response_model=RegionsResponse,
    summary="Read mock region options",
)
async def get_regions(
    parent_code: str | None = Query(default=None, alias="parentCode"),
    _user: Any = Depends(current_user),
) -> dict[str, object]:
    try:
        items = regions_for(parent_code)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="地区不存在") from exc
    return {"mock": True, "items": items}


@router.get(
    "/admission-registration/v1/applications",
    response_model=ApplicationsResponse,
    summary="查询本人有效入院申请单",
    description="申请单由当前身份核验会话绑定；客户端不能指定患者或其他用户。",
)
async def get_applications(
    identityToken: str = Query(min_length=1, max_length=64),
    user: Any = Depends(current_user),
) -> dict[str, object]:
    items = demo_store.applications(user.id, identityToken)
    if items is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    return {"items": items}


@router.post(
    "/admission-registration/v1/applications/select",
    response_model=SelectApplicationResponse,
    summary="确认本人入院申请单",
)
async def select_application(
    body: SelectApplicationBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    application = demo_store.select_application(user.id, body.identityToken, body.applicationId)
    if application is None:
        if demo_store.identity(user.id, body.identityToken) is None:
            raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
        raise HTTPException(status_code=409, detail="申请单不存在或已失效，请重新查询")
    identity = demo_store.identity(user.id, body.identityToken)
    if identity is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    session_id = demo_store.admission_session_id(user.id, body.identityToken)
    if session_id is None:
        raise HTTPException(status_code=409, detail="请先选择有效申请单")
    identity_fields = cast(dict[str, Any], identity["fields"])
    editable_fields = {
        key: value
        for key, value in identity_fields.items()
        if key not in {"name", "idNumber", "nationality", "ethnicity"}
    }
    session = server.services.admission_session_repo.create_or_get(
        session_id=session_id,
        owner_user_id=user.id,
        patient_ref=str(identity["patientRef"]),
        application_id=str(application["id"]),
        phase="form",
        facts_json=json.dumps(
            {
                key: {"value": value, "source": "profile", "confirmed": bool(value)}
                for key, value in editable_fields.items()
            },
            ensure_ascii=False,
        ),
        summary_json=json.dumps(
            {
                "application": {
                    "id": application["id"],
                    "department": application["department"],
                    "plannedAdmissionAt": application["plannedAdmissionAt"],
                }
            },
            ensure_ascii=False,
        ),
        expires_at=int(time.time()) + 24 * 60 * 60,
    )
    if session is None:
        raise HTTPException(status_code=409, detail="请重新核验身份后再选择申请单")
    return {"application": application, "sessionId": session_id}


def _owned_admission_session(
    server: Any, user: Any, identity_token: str, session_id: str
) -> tuple[Any, Any]:
    identity = demo_store.identity(user.id, identity_token)
    if identity is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    application = demo_store.selected_application(user.id, identity_token)
    session = server.services.admission_session_repo.get_owned(session_id, user.id)
    if (
        session is None
        or application is None
        or session.application_id != application["id"]
        or session.patient_ref != identity["patientRef"]
    ):
        raise HTTPException(status_code=404, detail="办理会话不存在或已过期")
    return identity, session


@router.get(
    "/admission-registration/v1/sessions/{session_id}",
    response_model=AdmissionSessionResponse,
    summary="读取本人入院办理会话",
)
async def get_admission_session(
    session_id: str,
    identityToken: str = Query(min_length=1, max_length=64),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    _identity, session = _owned_admission_session(server, user, identityToken, session_id)
    turns = server.services.admission_session_repo.list_turns(session_id, user.id)
    return {
        "sessionId": session.session_id,
        "applicationId": session.application_id,
        "phase": session.phase,
        "revision": session.revision,
        "facts": json.loads(session.facts_json),
        "summary": json.loads(session.summary_json),
        "pendingProposal": json.loads(session.pending_proposal_json)
        if session.pending_proposal_json
        else None,
        "lastTurnId": session.last_turn_id,
        "turns": [
            {
                "turnId": turn.turn_id,
                "previousTurnId": turn.previous_turn_id,
                "speaker": turn.speaker,
                "utterance": turn.utterance,
                "response": turn.response,
                "action": turn.action,
                "fields": json.loads(turn.fields_json),
                "status": turn.status,
                "createdAt": turn.created_at,
            }
            for turn in turns
        ],
    }


@router.post(
    "/admission-registration/v1/sessions/{session_id}/turns",
    response_model=AdmissionTurnSaved,
    summary="保存入院办理对话与字段快照",
)
async def save_admission_turn(
    session_id: str,
    body: AdmissionTurnBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    _identity, session = _owned_admission_session(server, user, body.identityToken, session_id)
    allowed = set(FIELD_SCHEMA["properties"]) - {
        "name",
        "idNumber",
        "nationality",
        "ethnicity",
    }
    if set(body.fields) - allowed:
        raise HTTPException(status_code=422, detail="对话包含不支持修改的身份字段")
    if len(json.dumps(body.pendingProposal, ensure_ascii=False)) > 10_000:
        raise HTTPException(status_code=422, detail="待确认修改内容过长")
    facts = json.loads(session.facts_json)
    pending = body.pendingProposal
    if body.action in {"candidate_accept", "candidate_reject"}:
        pending = None
    pending_fields = set(pending) if isinstance(pending, dict) else set()
    for key, value in body.fields.items():
        facts[key] = {
            "value": value,
            "source": "ai" if body.action == "voice_turn" else "manual",
            "confirmed": key not in pending_fields,
            "source_turn_id": body.turnId,
        }
    important = {
        key: facts[key]["value"]
        for key in ("phone", "nativeRegion", "residentRegion", "addressDetail", "emergencyContact")
        if key in facts
    }
    summary = {
        "applicationId": session.application_id,
        "important": important,
        "pendingAction": body.action if pending else None,
    }
    saved = server.services.admission_session_repo.append_turn(
        session_id=session_id,
        owner_user_id=user.id,
        expected_revision=body.expectedRevision,
        turn_id=body.turnId,
        previous_turn_id=body.previousTurnId,
        speaker="patient",
        text=body.utterance,
        response=body.response,
        action=body.action,
        fields_json=json.dumps(body.fields, ensure_ascii=False),
        status="completed",
        facts_json=json.dumps(facts, ensure_ascii=False),
        summary_json=json.dumps(summary, ensure_ascii=False),
        phase=session.phase,
        pending_proposal_json=json.dumps(pending, ensure_ascii=False) if pending else None,
    )
    if not saved:
        raise HTTPException(status_code=409, detail="会话内容已更新，请刷新后重试")
    return {
        "sessionId": session_id,
        "revision": body.expectedRevision + 1,
        "lastTurnId": body.turnId,
    }


def _submission_fingerprint(fields: dict[str, Any]) -> str:
    return sha256(
        json.dumps(fields, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


@router.post(
    "/admission-registration/v1/sessions/{session_id}/review",
    response_model=ReviewResponse,
    summary="确认当前入院登记信息版本",
)
async def confirm_admission_review(
    session_id: str,
    body: ReviewBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    identity, session = _owned_admission_session(server, user, body.identityToken, session_id)
    errors = validate_fields(body.fields)
    if errors:
        raise HTTPException(status_code=422, detail={"code": "VALIDATION_FAILED", "errors": errors})
    identity_fields = cast(dict[str, Any], identity["fields"])
    readonly_fields = ("name", "idNumber", "nationality", "ethnicity")
    if any(body.fields.get(key) != identity_fields.get(key) for key in readonly_fields):
        raise HTTPException(status_code=409, detail="核验身份信息不能修改")
    fingerprint = _submission_fingerprint(body.fields)
    summary = json.loads(session.summary_json)
    if (
        session.phase == "review"
        and session.revision == body.expectedRevision + 1
        and summary.get("reviewInputRevision") == body.expectedRevision
        and summary.get("reviewFingerprint") == fingerprint
    ):
        return {
            "sessionId": session_id,
            "reviewRevision": session.revision,
            "applicationId": session.application_id,
        }
    if session.pending_proposal_json is not None:
        raise HTTPException(status_code=409, detail="请先确认或拒绝待修改信息")
    facts = json.loads(session.facts_json)
    editable_fields = {
        key: value for key, value in body.fields.items() if key not in readonly_fields
    }
    for key, value in editable_fields.items():
        source = facts.get(key, {}).get("source", "manual")
        facts[key] = {
            "value": value,
            "source": source,
            "confirmed": True,
            "source_turn_id": facts.get(key, {}).get("source_turn_id"),
        }
    summary.update(
        {
            "applicationId": session.application_id,
            "reviewFingerprint": fingerprint,
            "reviewInputRevision": body.expectedRevision,
            "important": {
                key: editable_fields[key]
                for key in (
                    "phone",
                    "nativeRegion",
                    "residentRegion",
                    "addressDetail",
                    "emergencyContact",
                )
            },
        }
    )
    if not server.services.admission_session_repo.mark_reviewed(
        session_id=session_id,
        owner_user_id=user.id,
        expected_revision=body.expectedRevision,
        facts_json=json.dumps(facts, ensure_ascii=False),
        summary_json=json.dumps(summary, ensure_ascii=False),
    ):
        raise HTTPException(status_code=409, detail="会话内容已变化，请重新核对信息")
    return {
        "sessionId": session_id,
        "reviewRevision": body.expectedRevision + 1,
        "applicationId": session.application_id,
    }


@router.post(
    "/admission-registration/v1/submissions",
    response_model=SubmissionResponse,
    summary="Create a mock admission registration",
)
async def submit(
    body: SubmissionBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    identity = demo_store.identity(user.id, body.identityToken)
    if identity is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    application = demo_store.selected_application(user.id, body.identityToken)
    if application is None or application["id"] != body.applicationId:
        raise HTTPException(status_code=409, detail="请先确认本人有效入院申请单")
    _identity, session = _owned_admission_session(server, user, body.identityToken, body.sessionId)
    review_summary = json.loads(session.summary_json)
    if (
        session.phase != "review"
        or session.revision != body.reviewRevision
        or review_summary.get("reviewFingerprint") != _submission_fingerprint(body.fields)
    ):
        raise HTTPException(status_code=409, detail="登记信息已变化，请重新核对后提交")
    _validate_or_422(body.fields)
    identity_fields = cast(dict[str, Any], identity["fields"])
    readonly_fields = ("name", "idNumber", "nationality", "ethnicity")
    if any(body.fields.get(key) != identity_fields.get(key) for key in readonly_fields):
        raise HTTPException(status_code=409, detail="核验身份信息不能修改")
    try:
        stored = demo_store.submit(
            user.id,
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


@router.post(
    "/admission-registration/v1/submissions/result",
    response_model=SubmissionResponse,
    summary="Read a mock admission result",
)
async def submission_result(
    body: SubmissionResultBody, user: Any = Depends(current_user)
) -> dict[str, object]:
    if demo_store.identity(user.id, body.identityToken) is None:
        raise HTTPException(status_code=401, detail="身份核验已失效，请重新核验")
    result = demo_store.result(user.id, body.identityToken, body.idempotencyKey)
    return result or {"mock": True, "status": "unknown"}


@router.post(
    "/admission-registration/v1/ai/candidates",
    response_model=AiCandidatesResponse,
    summary="Extract mock admission candidates with the active Octop model",
    description=(
        "Uses the active model and the verified patient's selected application, confirmed facts, "
        "pending change, and up to four recent turns. Audio is not stored."
    ),
    responses={
        429: {"description": "The active AI model provider rate limited the request."},
        413: {"description": "The structured context exceeds the model input budget."},
        503: {"description": "The active model is unavailable or timed out."},
    },
)
async def ai_candidates(
    body: AiBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, object]:
    _identity, session = _owned_admission_session(server, user, body.identityToken, body.sessionId)
    turns = server.services.admission_session_repo.list_turns(body.sessionId, user.id)
    application = demo_store.selected_application(user.id, body.identityToken)
    context = {
        "current_page": body.page,
        "application": {
            key: application[key]
            for key in ("id", "department", "plannedAdmissionAt", "diagnosis", "ward")
            if application and application.get(key)
        },
        "facts": json.loads(session.facts_json),
        "pending_proposal": json.loads(session.pending_proposal_json)
        if session.pending_proposal_json
        else None,
        "recent_turns": [
            {"utterance": turn.utterance, "response": turn.response, "action": turn.action}
            for turn in turns[-4:]
        ],
    }
    try:
        extracted = await extract_active_registration_fields(
            server, body.text, page=0, context=context, user_id=user.id
        )
    except AdmissionModelRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "AI_RATE_LIMITED",
                "message": "AI 服务请求过于频繁，请稍后重试；转写内容已保留。",
                **({"retryAfter": exc.retry_after} if exc.retry_after else {}),
            },
        ) from exc
    except AdmissionContextTooLongError as exc:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "AI_CONTEXT_TOO_LONG",
                "message": "本轮信息和已保存的办理上下文超过模型长度限制，请缩短本次描述后重试。转写已保留。",
            },
        ) from exc
    except AdmissionModelUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_MODEL_UNAVAILABLE",
                "message": "当前智能填写服务暂不可用，请保留转写并手动补充。",
            },
        ) from exc
    return {"fields": accepted_candidates(body.text, extracted, 0)}
