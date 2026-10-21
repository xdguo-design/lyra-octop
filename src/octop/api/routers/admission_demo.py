"""AI candidate extraction for the authenticated admission demo."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from octop.api.deps import current_user, get_server
from octop.infra.admission_demo import (
    AdmissionModelRateLimitError,
    AdmissionModelUnavailableError,
    classify_active_admission_intent,
    classify_active_candidate_confirmation,
    extract_active_registration_result_with_model,
)

router = APIRouter()


class AdmissionExtractionBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    page: int = Field(default=1, ge=1, le=2, description="表单页码（1 或 2），限定可抽取的字段范围")


class AdmissionExtractionResponse(BaseModel):
    fields: dict[str, str]
    modelName: str = Field(description="本次抽取实际使用的模型展示名；未配置展示名时返回模型 ID")
    clarification: str | None = Field(
        default=None, max_length=240, description="模型针对含糊字段向患者提出的澄清问题"
    )
    clarificationChoices: list[str] = Field(
        default_factory=list, max_length=4, description="可点击或可语音复述的澄清单选项"
    )
    uncertainFields: list[str] | None = Field(
        default=None, description="模型判断需要患者澄清的字段键"
    )


class AdmissionIntentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: Literal["home"] = Field(description="仅支持首页意图识别")
    text: str = Field(min_length=1, max_length=2000)


class AdmissionIntentResponse(BaseModel):
    intent: Literal["begin_admission", "greeting", "answer_question", "unsupported", "unknown"]
    reply: str = Field(min_length=1, max_length=100)


AdmissionConfirmationField = Literal[
    "phone",
    "addressDetail",
    "nativeRegion",
    "residentRegion",
    "employerName",
    "employerAddress",
    "marriage",
    "occupation",
    "emergencyContact",
    "relationship",
]


class AdmissionCandidateConfirmationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=2000)
    field_key: AdmissionConfirmationField
    current_value: str = Field(min_length=1, max_length=200)
    candidate_value: str = Field(min_length=1, max_length=200)


class AdmissionCandidateConfirmationResponse(BaseModel):
    decision: Literal["accept_candidate", "keep_current", "unknown"]


@router.post(
    "/admission-demo/extract",
    response_model=AdmissionExtractionResponse,
    summary="Extract admission form candidates with the bound admission expert model",
    description=(
        "Requires an authenticated Octop user. `page` (1 or 2) limits which form fields "
        "may be extracted. Uses the admission expert's bound model and reasoning settings; the model cannot "
        "determine eligibility or submit an admission."
    ),
    responses={
        429: {"description": "The active AI model provider rate limited the request."},
        503: {"description": "The active AI model is unavailable or timed out."},
    },
)
async def extract_admission_fields(
    body: AdmissionExtractionBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> AdmissionExtractionResponse:
    try:
        (
            fields,
            model_name,
            clarification,
            uncertain_fields,
            clarification_choices,
        ) = await extract_active_registration_result_with_model(
            server, body.text, body.page, user_id=user.id
        )
    except AdmissionModelRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "AI_RATE_LIMITED",
                "message": "AI 服务请求过于频繁，请稍后重试；转写内容已保留。",
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
    return AdmissionExtractionResponse(
        fields=fields,
        modelName=model_name,
        clarification=clarification,
        clarificationChoices=clarification_choices,
        uncertainFields=uncertain_fields,
    )


@router.post(
    "/admission-demo/intent",
    response_model=AdmissionIntentResponse,
    summary="Answer a home-page question within admission demo capabilities",
    description=(
        "Requires an authenticated Octop user. Uses the admission expert's bound model to judge one fixed "
        "UI intent for the utterance; the reply is demo-scripted wording except for "
        "page-capability answers. Only an explicit begin intent can start identity "
        "verification."
    ),
    responses={
        429: {"description": "The active AI model provider rate limited the request."},
        503: {"description": "The active AI model is unavailable or timed out."},
    },
)
async def classify_admission_home_intent(
    body: AdmissionIntentBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> AdmissionIntentResponse:
    try:
        intent, reply = await classify_active_admission_intent(server, body.text, user_id=user.id)
    except AdmissionModelRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail={"code": "AI_RATE_LIMITED", "message": "AI 请求触发限流，请稍后重试。"},
        ) from exc
    except AdmissionModelUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_MODEL_UNAVAILABLE",
                "message": "当前语音意图识别暂不可用，请重试。",
            },
        ) from exc
    return AdmissionIntentResponse(intent=intent, reply=reply)


@router.post(
    "/admission-demo/candidate-confirmation",
    response_model=AdmissionCandidateConfirmationResponse,
    summary="Classify a voice response to one admission candidate conflict",
    description=(
        "Requires an authenticated Octop user. Sends only the current utterance and one "
        "field conflict to the active model. The model can accept, keep, or mark unknown; "
        "it cannot write form data or submit admission."
    ),
    responses={
        429: {"description": "The active AI model provider rate limited the request."},
        503: {"description": "The active AI model is unavailable or timed out."},
    },
)
async def classify_admission_candidate_confirmation(
    body: AdmissionCandidateConfirmationBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> AdmissionCandidateConfirmationResponse:
    try:
        decision = await classify_active_candidate_confirmation(
            server,
            body.text,
            body.field_key,
            body.current_value,
            body.candidate_value,
            user_id=user.id,
        )
    except AdmissionModelRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail={"code": "AI_RATE_LIMITED", "message": "语音确认请求触发限流，请稍后重试。"},
        ) from exc
    except AdmissionModelUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_MODEL_UNAVAILABLE",
                "message": "当前语音确认服务暂不可用，请点击选项或重试。",
            },
        ) from exc
    return AdmissionCandidateConfirmationResponse(decision=decision)
