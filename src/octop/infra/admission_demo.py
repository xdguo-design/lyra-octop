"""Platform Agent calls and validated results for the admission demo."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Literal, cast

from octop.infra.agents.providers.reasoning import (
    agent_reasoning_defaults,
    reasoning_request_parameters,
)

logger = logging.getLogger(__name__)

_ADMISSION_AGENT_ID = "octop-admission-demo"
_ADMISSION_AGENT_NAME = "入院登记助手"
_ADMISSION_AGENT_AVATAR = "/experts/avatars/admission-assistant.png"
_ADMISSION_AGENT_LOCK = asyncio.Lock()
_SKILL_DIR = Path(__file__).with_name("admission_demo_skills")

_PAGE_FIELDS: dict[int, frozenset[str]] = {
    1: frozenset({"contact_phone", "native_region", "resident_region", "address"}),
    2: frozenset(
        {
            "employer_name",
            "employer_address",
            "marriage",
            "occupation",
            "emergency_contact",
            "relationship",
        }
    ),
}
_ALL_FIELDS = _PAGE_FIELDS[1] | _PAGE_FIELDS[2]
AdmissionHomeIntent = Literal[
    "begin_admission", "greeting", "answer_question", "unsupported", "unknown"
]
_INTENT_REPLIES: dict[str, str] = {
    "begin_admission": "您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。",
    "greeting": "您好，我可以帮您办理入院登记。您可以说“我要办理入院”。",
    "unsupported": "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。",
    "unknown": "我没能确定您的需求，请说说您想办理什么。",
}
_JSON_FENCE = re.compile(r"\A```(?:json)?\s*(.*?)\s*```\Z", re.DOTALL | re.IGNORECASE)


class AdmissionModelUnavailableError(RuntimeError):
    """The active model or admission Agent cannot currently serve requests."""


class AdmissionModelRateLimitError(RuntimeError):
    """The active model provider rejected a request because of rate limits."""

    def __init__(self, message: str, retry_after: str | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class AdmissionContextTooLongError(ValueError):
    """The structured admission context exceeds the active model input budget."""


def _is_model_rate_limited(exc: Exception) -> bool:
    return getattr(exc, "status_code", None) == 429


def _parse_json_object(content: str) -> Any:
    fenced = _JSON_FENCE.fullmatch(content)
    raw = fenced.group(1) if fenced else content
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match is None:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


def _active_model_ref(server: Any) -> tuple[str, str]:
    services = server.services
    runtime = server.app_runtime
    if services is None or runtime is None:
        raise AdmissionModelUnavailableError("model runtime is unavailable")
    provider_name, model_id = services.settings_repo.get_active_model()
    manager = runtime.agent_registry.harness_manager
    if not provider_name or not model_id or manager is None or manager.shared_factory is None:
        raise AdmissionModelUnavailableError("active model is not configured")
    return str(provider_name), str(model_id)


async def _seed_admission_skills(_row: Any, workspace: Any) -> None:
    for slug in ("admission-router", "admission-patient-info"):
        skill_path = _SKILL_DIR / slug / "SKILL.md"
        content = await asyncio.to_thread(skill_path.read_text, encoding="utf-8")
        target = f"skills/{slug}/SKILL.md"
        await workspace.amkdir(f"skills/{slug}")
        await workspace.awrite_text(target, content)


async def _read_skill_text(slug: str) -> str:
    """Read a seeded admission skill body for inline system-message injection."""
    skill_path = _SKILL_DIR / slug / "SKILL.md"
    return await asyncio.to_thread(skill_path.read_text, encoding="utf-8")


async def provision_admission_agent(server: Any) -> Any:
    """Create the shared platform Agent and its workspace Skills if needed."""
    runtime = server.app_runtime
    if runtime is None:
        raise AdmissionModelUnavailableError("agent runtime is unavailable")
    registry = runtime.agent_registry
    services = getattr(server, "services", None)
    active_provider, active_model = (
        services.settings_repo.get_active_model() if services else (None, None)
    )
    initial_model_ref = (
        f"{active_provider}/{active_model}" if active_provider and active_model else None
    )
    async with _ADMISSION_AGENT_LOCK:
        row = registry.get_row(_ADMISSION_AGENT_ID)
        if row is None:
            from octop_harness.plugins import PluginRegistry

            from octop.infra.agents.manager import AgentCreateSpec
            from octop.infra.agents.settings.tool_catalog import (
                BUILTIN_TOOL_CATALOG,
                CRITICAL_TOOLS,
            )

            disabled_plugins = {
                item.manifest.id: {"enabled": False} for item in PluginRegistry().list_plugins()
            }
            disabled_tools = sorted({item.name for item in BUILTIN_TOOL_CATALOG} - CRITICAL_TOOLS)
            await registry.create(
                AgentCreateSpec(
                    agent_id=_ADMISSION_AGENT_ID,
                    name=_ADMISSION_AGENT_NAME,
                    description="供入院登记 Demo 使用的意图路由与资料补全专家。",
                    kind="expert",
                    user_id=None,
                    is_shared=True,
                    default_model=initial_model_ref,
                    icon_url=_ADMISSION_AGENT_AVATAR,
                    mcp_servers=[],
                    system_prompt=(
                        "你是入院登记助手，只服务于模拟入院登记演示。不得声称办理真实业务。"
                        "遵循本轮明确指定的 Skill 和输出格式；未指定结构化任务时，用中文简洁说明演示范围。"
                    ),
                    config={
                        "admission_demo_agent": True,
                        "observability": {"langfuse": False},
                        "checkpointer": False,
                        "session_log_enabled": False,
                        "memory": {
                            "memory_enabled": False,
                            "memory_jsonl_enabled": False,
                        },
                        "tools_disabled": disabled_tools,
                        "plugins": disabled_plugins,
                        "team_enabled": False,
                        "web_search_tools": False,
                    },
                ),
                workspace_initializer=_seed_admission_skills,
            )
            row = registry.get_row(_ADMISSION_AGENT_ID)
        elif row.user_id is not None or not registry.get_config(_ADMISSION_AGENT_ID).get(
            "admission_demo_agent"
        ):
            raise AdmissionModelUnavailableError("admission Agent ID is already in use")
        elif not bool(row.is_shared):
            row = await registry.set_shared(_ADMISSION_AGENT_ID, True)
        if not getattr(row, "icon_url", None):
            row = registry.set_icon_url(_ADMISSION_AGENT_ID, _ADMISSION_AGENT_AVATAR)
        if initial_model_ref and not (getattr(row, "default_model", None) or "").strip():
            row = await registry.update(_ADMISSION_AGENT_ID, default_model=initial_model_ref)
        return row


async def _ensure_admission_agent(server: Any) -> Any:
    await provision_admission_agent(server)
    registry = server.app_runtime.agent_registry
    try:
        return registry.get_agent(_ADMISSION_AGENT_ID)
    except Exception:
        try:
            await registry.start(_ADMISSION_AGENT_ID)
            return registry.get_agent(_ADMISSION_AGENT_ID)
        except Exception as exc:
            raise AdmissionModelUnavailableError("admission Agent is unavailable") from exc


def _disable_admission_tools(registry: Any) -> None:
    """Hide every built-in tool from the admission agent before a structured call.

    ``normalize_tools_disabled`` strips ``CRITICAL_TOOLS`` (``ls``/``read_file``/
    ``write_todos``/…) from the persisted denylist, so those stay on the running
    agent. A reasoning model handed tools answers with a ``tool_calls`` message and
    an empty ``content``, which then fails JSON parsing and degrades to ``unknown``.
    Pushing the full catalog straight to the live agent avoids that.
    """
    from octop.infra.agents.settings.tool_catalog import BUILTIN_TOOL_CATALOG

    try:
        registry.sync_tools_disabled(
            _ADMISSION_AGENT_ID, {entry.name for entry in BUILTIN_TOOL_CATALOG}
        )
    except Exception:
        logger.debug("admission demo tool denylist sync failed", exc_info=True)


async def _call_admission_skill(
    server: Any,
    *,
    skill: str,
    payload: dict[str, Any],
    user_id: int | None = None,
) -> str | None:
    await _ensure_admission_agent(server)
    registry = server.app_runtime.agent_registry
    _disable_admission_tools(registry)
    row = registry.get_row(_ADMISSION_AGENT_ID)
    config = registry.get_config(_ADMISSION_AGENT_ID)
    model_ref = (getattr(row, "default_model", None) or config.get("default_model") or "").strip()
    if not model_ref or model_ref.lower() == "auto":
        provider_name, model_id = _active_model_ref(server)
        model_ref = f"{provider_name}/{model_id}"
    if not registry.providers.is_model_ref_usable(model_ref):
        raise AdmissionModelUnavailableError("bound admission model is unavailable")
    mode, effort = agent_reasoning_defaults(config)
    overrides = reasoning_request_parameters(
        registry.providers.get_model_reasoning_capability(model_ref), mode=mode, effort=effort
    )
    configurable: dict[str, Any] = {}
    if overrides:
        configurable["octop_reasoning_overrides"] = overrides
    # 技能内容作为显式 system 消息注入：运行时的 skills 注入不稳定
    # （短输入时模型偶尔当作无结构化任务自由作答），直接放进 messages 保证到达。
    skill_text = await _read_skill_text(skill)
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    result = await server.app_runtime.agent_registry.call(
        _ADMISSION_AGENT_ID,
        {
            "messages": [
                {"role": "system", "content": skill_text},
                {"role": "user", "content": payload_json},
            ],
            "thread_id": uuid.uuid4().hex,
            "source": "admission_demo",
            "user": user_id,
            "model": model_ref,
            "skills": [],
            "mcp_servers": [],
            "configurable": configurable,
        },
    )
    messages = result.get("messages") if isinstance(result, dict) else None
    if not isinstance(messages, list):
        return None
    for message in reversed(messages):
        content = getattr(message, "content", None)
        if isinstance(content, str) and content.strip():
            message_type = getattr(message, "type", None)
            if message_type in ("ai", "assistant") or message.__class__.__name__ == "AIMessage":
                return content.strip()
    return None


def _classify_intent_output(content: str | None) -> tuple[AdmissionHomeIntent, str]:
    payload = _parse_json_object(content or "")
    if isinstance(payload, dict) and set(payload) == {"intent", "reply"}:
        intent, reply = payload["intent"], payload["reply"]
        if intent == "answer_question" and isinstance(reply, str) and reply.strip():
            # 超过 100 字只截断，不整条丢弃——否则一条有效的流程解答会退化成“没听懂”。
            return "answer_question", reply.strip()[:100]
        if isinstance(intent, str) and intent in _INTENT_REPLIES:
            return cast(AdmissionHomeIntent, intent), _INTENT_REPLIES[intent]
    logger.warning("admission demo intent output unparseable: %.400s", content)
    return "unknown", _INTENT_REPLIES["unknown"]


def _classify_confirmation_output(
    content: str | None,
) -> Literal["accept_candidate", "keep_current", "unknown"]:
    payload = _parse_json_object(content or "")
    if isinstance(payload, dict) and set(payload) == {"decision"}:
        decision = payload["decision"]
        if decision in {"accept_candidate", "keep_current"}:
            return cast(Literal["accept_candidate", "keep_current"], decision)
    return "unknown"


def _extract_fields_output(content: str | None, page: int) -> dict[str, str]:
    payload = _parse_json_object(content or "")
    if not isinstance(payload, dict):
        logger.info("admission demo Agent returned non-JSON content")
        return {}
    allowed = _ALL_FIELDS if page == 0 else _PAGE_FIELDS.get(page, _PAGE_FIELDS[1])
    return {
        key: value.strip()
        for key, value in payload.items()
        if key in allowed and isinstance(value, str) and 0 < len(value.strip()) <= 200
    }


async def extract_active_registration_fields(
    server: Any,
    text: str,
    page: int = 1,
    *,
    context: dict[str, Any] | None = None,
    user_id: int | None = None,
) -> dict[str, str]:
    """Extract explicit field candidates through the admission-patient-info Skill."""
    try:
        payload = {"mode": "extract", "page": page, "current_utterance": text}
        if context is not None:
            payload["context"] = context
            if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > 18000:
                raise AdmissionContextTooLongError("admission model input exceeds 6000 tokens")
        content = await asyncio.wait_for(
            _call_admission_skill(
                server,
                skill="admission-patient-info",
                payload=payload,
                user_id=user_id,
            ),
            timeout=30,
        )
        return _extract_fields_output(content, page)
    except AdmissionModelUnavailableError:
        raise
    except AdmissionContextTooLongError:
        raise
    except Exception as exc:
        if _is_model_rate_limited(exc):
            logger.info("admission demo active model request rate limited")
            response = getattr(exc, "response", None)
            headers = getattr(response, "headers", {})
            retry_after = headers.get("Retry-After") if headers else None
            raise AdmissionModelRateLimitError(
                "active model request was rate limited", str(retry_after) if retry_after else None
            ) from exc
        logger.warning("admission demo active model unavailable", exc_info=True)
        raise AdmissionModelUnavailableError("active model request failed") from exc


async def classify_active_admission_intent(
    server: Any, text: str, *, user_id: int | None = None
) -> tuple[AdmissionHomeIntent, str]:
    """Route a homepage utterance through the admission-router Skill."""
    try:
        # glm-5.3-flash 等推理模型经 Agent+Skill 链路常超 15s，与 extract 的 30s 对齐。
        content = await asyncio.wait_for(
            _call_admission_skill(
                server,
                skill="admission-router",
                payload={"text": text},
                user_id=user_id,
            ),
            timeout=30,
        )
        return _classify_intent_output(content)
    except AdmissionModelUnavailableError:
        raise
    except Exception as exc:
        if _is_model_rate_limited(exc):
            logger.info("admission demo intent request rate limited")
            raise AdmissionModelRateLimitError("active model request was rate limited") from exc
        logger.warning("admission demo intent model unavailable", exc_info=True)
        raise AdmissionModelUnavailableError("active model request failed") from exc


async def classify_active_candidate_confirmation(
    server: Any,
    text: str,
    field_key: str,
    current_value: str,
    candidate_value: str,
    *,
    user_id: int | None = None,
) -> Literal["accept_candidate", "keep_current", "unknown"]:
    """Classify a single conflict confirmation through the patient-info Skill."""
    try:
        content = await asyncio.wait_for(
            _call_admission_skill(
                server,
                skill="admission-patient-info",
                payload={
                    "mode": "candidate_confirmation",
                    "utterance": text,
                    "field_key": field_key,
                    "current_value": current_value,
                    "candidate_value": candidate_value,
                },
                user_id=user_id,
            ),
            timeout=30,
        )
        return _classify_confirmation_output(content)
    except AdmissionModelUnavailableError:
        raise
    except Exception as exc:
        if _is_model_rate_limited(exc):
            logger.info("admission demo candidate confirmation request rate limited")
            raise AdmissionModelRateLimitError("active model request was rate limited") from exc
        logger.warning("admission demo candidate confirmation unavailable", exc_info=True)
        raise AdmissionModelUnavailableError("active model request failed") from exc
