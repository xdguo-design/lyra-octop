"""Platform Agent calls and validated results for the admission demo."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from time import perf_counter
from typing import Any, Literal, cast

from langchain_core.callbacks import BaseCallbackHandler

from octop.infra.admission_registration_demo import REGIONS
from octop.infra.agents.providers.reasoning import (
    agent_reasoning_defaults,
    reasoning_request_parameters,
)
from octop.infra.errors import ErrorCode, OctopError

logger = logging.getLogger(__name__)

_ADMISSION_AGENT_ID = "octop-admission-demo"
_ADMISSION_ADDRESS_MCP = "china_address_resolver"
_ADMISSION_AGENT_NAME = "入院登记助手"
_ADMISSION_AGENT_AVATAR = "/experts/avatars/admission-assistant.png"
_ADMISSION_AGENT_LOCK = asyncio.Lock()
_ADMISSION_AGENT_RUNTIME = {
    # LangGraph also counts middleware: one tool-free model response takes 13 steps.
    "max_iters": 32,
    # 输入预算按 tokens 计且包含工具 schema：patient-info 技能系统消息 ~2.2K +
    # 运行时重新注入的内置工具目录 ~8.6K + ≤6000B 转写负载 ~2.6K，合计近 14K；
    # 低于此值调用会 ContextOverflowError → 503（语音模式整体不可用）。
    "max_input_length": 20000,
    "temperature": 0.2,
    "max_tokens": 512,
    "model_retry_enabled": False,
}
_ADMISSION_AGENT_REASONING = {"mode": "disabled"}
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
_ADDRESS_MCP_MARKERS = (
    "地址",
    "住址",
    "居住",
    "现住",
    "籍贯",
    "户籍",
    "住在",
    "家在",
    "家住",
    "出生地",
    "出生于",
    "老家",
)


def _address_mcp_requested(payload: dict[str, Any]) -> bool:
    utterance = payload.get("current_utterance")
    if not isinstance(utterance, str) or not utterance.strip():
        return False
    if any(marker in utterance for marker in _ADDRESS_MCP_MARKERS):
        return True
    pending = list(REGIONS)
    while pending:
        region = pending.pop()
        label = region.get("label")
        if (
            isinstance(label, str)
            and len(label) > 1
            and (
                label in utterance
                or any(
                    label.endswith(suffix) and label[: -len(suffix)] in utterance
                    for suffix in ("自治区", "自治州", "地区", "省", "市", "区", "县", "旗")
                )
            )
        ):
            return True
        pending.extend(region.get("children", []))
    return False


class AdmissionModelUnavailableError(RuntimeError):
    """The active model or admission Agent cannot currently serve requests."""


class AdmissionModelRateLimitError(RuntimeError):
    """The active model provider rejected a request because of rate limits."""

    def __init__(self, message: str, retry_after: str | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class AdmissionContextTooLongError(ValueError):
    """The structured admission context exceeds the active model input budget."""


class _AdmissionModelTiming(BaseCallbackHandler):
    """Measure provider model time without retaining prompts or completions."""

    def __init__(self) -> None:
        self._started: dict[str, float] = {}
        self.elapsed_ms = 0
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.message_count = 0
        self.system_chars = 0
        self.user_chars = 0
        self.tool_names: list[str] = []
        self.reasoning_tokens = 0

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: Any,
        **kwargs: Any,
    ) -> None:
        self._started[str(run_id)] = perf_counter()
        for batch in messages:
            self.message_count += len(batch)
            for message in batch:
                content = getattr(message, "content", "")
                if not isinstance(content, str):
                    continue
                if getattr(message, "type", "") == "system":
                    self.system_chars += len(content)
                elif getattr(message, "type", "") == "human":
                    self.user_chars += len(content)
        invocation = kwargs.get("invocation_params")
        tools = invocation.get("tools") if isinstance(invocation, dict) else None
        if isinstance(tools, list):
            for tool in tools:
                if isinstance(tool, dict):
                    function = tool.get("function")
                    name = function.get("name") if isinstance(function, dict) else tool.get("name")
                else:
                    name = getattr(tool, "name", None)
                if isinstance(name, str) and name not in self.tool_names:
                    self.tool_names.append(name)

    def on_llm_end(self, response: Any, *, run_id: Any, **kwargs: Any) -> None:
        self._finish(run_id, response)

    def on_llm_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        self._finish(run_id)

    def _finish(self, run_id: Any, response: Any = None) -> None:
        started = self._started.pop(str(run_id), None)
        if started is not None:
            self.elapsed_ms += round((perf_counter() - started) * 1000)
            self.calls += 1
        generations = getattr(response, "generations", None) or []
        if generations:
            from octop.infra.agents.threads.context_breakdown import usage_dict_from_message

            for batch in generations:
                for generation in batch:
                    usage = usage_dict_from_message(getattr(generation, "message", None))
                    if usage:
                        self.input_tokens += int(usage.get("input_tokens", 0))
                        self.output_tokens += int(usage.get("output_tokens", 0))
                        self.reasoning_tokens += int(usage.get("reasoning_tokens", 0))


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
                    mcp_servers=[_ADMISSION_ADDRESS_MCP],
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
                        "reasoning": _ADMISSION_AGENT_REASONING,
                        **_ADMISSION_AGENT_RUNTIME,
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
        selected_mcp_servers = registry.default_mcp_servers(_ADMISSION_AGENT_ID)
        if _ADMISSION_ADDRESS_MCP not in selected_mcp_servers:
            registry.persist_mcp_servers(
                _ADMISSION_AGENT_ID, [*selected_mcp_servers, _ADMISSION_ADDRESS_MCP]
            )
        if initial_model_ref and not (getattr(row, "default_model", None) or "").strip():
            row = await registry.update(_ADMISSION_AGENT_ID, default_model=initial_model_ref)
        config = registry.get_config(_ADMISSION_AGENT_ID)
        if callable(getattr(registry, "update", None)) and (
            any(config.get(key) != value for key, value in _ADMISSION_AGENT_RUNTIME.items())
            or config.get("reasoning") != _ADMISSION_AGENT_REASONING
        ):
            from octop.infra.agents.settings.runtime_limits import AGENT_RUNTIME_CONFIG_KEYS

            row = await registry.update(
                _ADMISSION_AGENT_ID,
                config_json=json.dumps(
                    {
                        **config,
                        **_ADMISSION_AGENT_RUNTIME,
                        "reasoning": _ADMISSION_AGENT_REASONING,
                    },
                    ensure_ascii=False,
                ),
                **{
                    key: value
                    for key, value in _ADMISSION_AGENT_RUNTIME.items()
                    if key in AGENT_RUNTIME_CONFIG_KEYS
                },
            )
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
            _ADMISSION_AGENT_ID, {entry.name for entry in BUILTIN_TOOL_CATALOG} | {"delete"}
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
    content, _model_name = await _call_admission_skill_with_model(
        server, skill=skill, payload=payload, user_id=user_id
    )
    return content


def _model_display_name(providers: Any, model_ref: str) -> str:
    provider_name, separator, model_id = model_ref.partition("/")
    if separator:
        iter_rows = getattr(providers, "iter_usable_rows", None)
        if callable(iter_rows):
            for provider in iter_rows():
                if provider.name != provider_name:
                    continue
                for model in provider.get_models():
                    if str(model.get("id") or "") == model_id:
                        display_name = str(model.get("name") or "").strip()
                        return display_name or model_id
    return model_id or model_ref


async def _call_admission_skill_with_model(
    server: Any,
    *,
    skill: str,
    payload: dict[str, Any],
    user_id: int | None = None,
) -> tuple[str | None, str]:
    prepare_started = perf_counter()
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
    model_name = _model_display_name(registry.providers, model_ref)
    mode, effort = agent_reasoning_defaults(config)
    overrides = reasoning_request_parameters(
        registry.providers.get_model_reasoning_capability(model_ref), mode=mode, effort=effort
    )
    configurable: dict[str, Any] = {}
    if overrides:
        configurable["octop_reasoning_overrides"] = overrides
    if skill == "admission-router":
        configurable["model_settings"] = {"max_tokens": 256}
    elif payload.get("mode") == "candidate_confirmation":
        configurable["model_settings"] = {"max_tokens": 64}
    # 技能内容作为显式 system 消息注入：运行时的 skills 注入不稳定
    # （短输入时模型偶尔当作无结构化任务自由作答），直接放进 messages 保证到达。
    skill_text = await _read_skill_text(skill)
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    mcp_servers: list[str] = []
    if (
        skill == "admission-patient-info"
        and payload.get("mode") == "extract"
        and payload.get("page") in (0, 1)
        and _address_mcp_requested(payload)
        and user_id is not None
        and _ADMISSION_ADDRESS_MCP in registry.default_mcp_servers(_ADMISSION_AGENT_ID)
    ):
        try:
            mcp_servers = registry.validate_mcp_servers(user_id, [_ADMISSION_ADDRESS_MCP])
        except OctopError:
            logger.info(
                "admission address MCP is unavailable to current user; continuing without it"
            )
    timing = _AdmissionModelTiming()
    request = {
        "messages": [
            {"role": "system", "content": skill_text},
            {"role": "user", "content": payload_json},
        ],
        "thread_id": uuid.uuid4().hex,
        "source": "admission_demo",
        "user": user_id,
        "model": model_ref,
        "skills": [],
        "mcp_servers": mcp_servers,
        "configurable": configurable,
        "callbacks": [timing],
    }
    prepare_ms = round((perf_counter() - prepare_started) * 1000)
    call_started = perf_counter()
    try:
        try:
            result = await registry.call(_ADMISSION_AGENT_ID, request)
        except OctopError as exc:
            if not mcp_servers or exc.code != ErrorCode.CONNECTOR_MCP_LOAD_FAILED:
                raise
            logger.warning("admission address MCP failed; retrying this turn without MCP")
            result = await registry.call(_ADMISSION_AGENT_ID, {**request, "mcp_servers": []})
    finally:
        logger.info(
            "admission model timing skill=%s model=%s prepare_ms=%d agent_ms=%d model_ms=%d model_calls=%d input_tokens=%d output_tokens=%d reasoning_tokens=%d messages=%d system_chars=%d user_chars=%d tools=%s",
            skill,
            model_ref,
            prepare_ms,
            round((perf_counter() - call_started) * 1000),
            timing.elapsed_ms,
            timing.calls,
            timing.input_tokens,
            timing.output_tokens,
            timing.reasoning_tokens,
            timing.message_count,
            timing.system_chars,
            timing.user_chars,
            ",".join(timing.tool_names) or "none",
        )
    messages = result.get("messages") if isinstance(result, dict) else None
    if not isinstance(messages, list):
        return None, model_name
    for message in reversed(messages):
        content = getattr(message, "content", None)
        if isinstance(content, str) and content.strip():
            message_type = getattr(message, "type", None)
            if message_type in ("ai", "assistant") or message.__class__.__name__ == "AIMessage":
                return content.strip(), model_name
    return None, model_name


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


def _extract_skill_output(
    content: str | None, page: int
) -> tuple[dict[str, str], str | None, list[str] | None, list[str]]:
    payload = _parse_json_object(content or "")
    if not isinstance(payload, dict):
        logger.info("admission demo Agent returned non-JSON content")
        return {}, None, None, []
    structured = isinstance(payload.get("fields"), dict)
    raw_fields = payload["fields"] if structured else payload
    allowed = _ALL_FIELDS if page == 0 else _PAGE_FIELDS.get(page, _PAGE_FIELDS[1])
    fields = {
        key: value.strip()
        for key, value in raw_fields.items()
        if key in allowed and isinstance(value, str) and 0 < len(value.strip()) <= 200
    }
    raw_uncertain = payload.get("uncertain_fields") if structured else None
    uncertain_fields = (
        [key for key in raw_uncertain if isinstance(key, str) and key in allowed]
        if isinstance(raw_uncertain, list)
        else None
    )
    clarification = payload.get("clarification") if structured else None
    clarification = (
        clarification.strip()[:240]
        if isinstance(clarification, str) and clarification.strip()
        else None
    )
    raw_choices = payload.get("clarification_choices") if structured else None
    choices = []
    if isinstance(raw_choices, list):
        for choice in raw_choices:
            if (
                isinstance(choice, str)
                and 0 < len(choice.strip()) <= 160
                and choice.strip() not in choices
            ):
                choices.append(choice.strip())
            if len(choices) == 4:
                break
    return fields, clarification, uncertain_fields, choices


def _extract_fields_output(content: str | None, page: int) -> dict[str, str]:
    return _extract_skill_output(content, page)[0]


async def extract_active_registration_fields(
    server: Any,
    text: str,
    page: int = 1,
    *,
    context: dict[str, Any] | None = None,
    user_id: int | None = None,
) -> dict[str, str]:
    """Extract explicit field candidates through the admission-patient-info Skill."""
    fields, _model_name = await extract_active_registration_fields_with_model(
        server, text, page, context=context, user_id=user_id
    )
    return fields


async def extract_active_registration_fields_with_model(
    server: Any,
    text: str,
    page: int = 1,
    *,
    context: dict[str, Any] | None = None,
    user_id: int | None = None,
) -> tuple[dict[str, str], str]:
    """Extract safe field candidates and preserve the existing two-value API."""
    fields, model_name, _, _, _ = await extract_active_registration_result_with_model(
        server, text, page, context=context, user_id=user_id
    )
    return fields, model_name


async def extract_active_registration_result_with_model(
    server: Any,
    text: str,
    page: int = 1,
    *,
    context: dict[str, Any] | None = None,
    user_id: int | None = None,
) -> tuple[dict[str, str], str, str | None, list[str] | None, list[str]]:
    """Extract fields plus model-led clarification metadata."""
    try:
        payload = {"mode": "extract", "page": page, "current_utterance": text}
        if context is not None:
            payload["context"] = context
        if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > 6000:
            raise AdmissionContextTooLongError("admission model input exceeds 2000 tokens")
        content, model_name = await asyncio.wait_for(
            _call_admission_skill_with_model(
                server,
                skill="admission-patient-info",
                payload=payload,
                user_id=user_id,
            ),
            timeout=30,
        )
        fields, clarification, uncertain_fields, choices = _extract_skill_output(content, page)
        return fields, model_name, clarification, uncertain_fields, choices
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
    if text.strip().rstrip("。！!？?，,").strip() in {"住院登记", "入院登记"}:
        return "begin_admission", _INTENT_REPLIES["begin_admission"]
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
