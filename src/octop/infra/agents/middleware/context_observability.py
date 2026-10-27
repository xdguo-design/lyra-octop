"""Shadow-mode context telemetry; this middleware never edits model requests."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langgraph.config import get_config

from octop.infra.agents.context.budget import (
    context_pressure,
    estimate_payload_tokens,
    resolve_context_budget,
)

logger = logging.getLogger(__name__)
_MAX_SOURCE_ROWS = 50
_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9_.:/-]+")


def _read(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        result = dump()
        if isinstance(result, Mapping):
            return dict(result)
    return {}


def _safe_identifier(value: Any, *, fallback: str) -> str:
    if value is None:
        return fallback
    text = _SAFE_ID_RE.sub("_", str(value).strip())
    return text[:160] or fallback


def _model_profile(model: Any) -> dict[str, Any]:
    return _mapping(_read(model, "profile"))


def _thread_key() -> str | None:
    try:
        config = get_config()
    except RuntimeError:
        return None
    configurable = config.get("configurable") if isinstance(config, Mapping) else None
    thread_id = configurable.get("thread_id") if isinstance(configurable, Mapping) else None
    if not isinstance(thread_id, str) or not thread_id.strip():
        return None
    # Stable correlation without putting raw thread identifiers in operational logs.
    return hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:16]


def _model_budget(model: Any) -> tuple[str, Any]:
    profile = _model_profile(model)
    model_window = (
        profile.get("context_window")
        or profile.get("context_window_tokens")
        or _read(model, "context_window")
    )
    configured_cap = profile.get("max_input_tokens") or _read(model, "max_input_tokens")
    output_reserve = (
        _read(model, "max_tokens")
        or _read(model, "max_completion_tokens")
        or _read(model, "max_output_tokens")
        or profile.get("max_output_tokens")
    )
    budget = resolve_context_budget(
        model_context_window_tokens=model_window,
        configured_input_cap_tokens=configured_cap,
        output_reserve_tokens=output_reserve,
    )
    model_name = (
        _read(model, "model_name")
        or _read(model, "model")
        or _read(model, "name")
        or type(model).__name__
    )
    return _safe_identifier(model_name, fallback="unknown-model"), budget


def _message_rows(messages: Sequence[Any]) -> tuple[list[dict[str, Any]], int, int]:
    rows: list[dict[str, Any]] = []
    total_estimated = 0
    total_media = 0
    for index, message in enumerate(messages):
        content = _read(message, "content")
        tool_calls = _read(message, "tool_calls")
        estimate, media_count = estimate_payload_tokens(
            {"content": content, "tool_calls": tool_calls}
        )
        total_estimated += estimate
        total_media += media_count
        message_id = _safe_identifier(_read(message, "id"), fallback=f"message:{index}")
        role = _safe_identifier(
            _read(message, "type") or _read(message, "role") or type(message).__name__,
            fallback="unknown",
        )
        rows.append(
            {
                "source_id": message_id,
                "role": role,
                "estimated_tokens": estimate,
                "selection_reason": "present_in_model_request",
            }
        )
    return rows, total_estimated, total_media


def build_context_observation(
    *,
    agent_id: str,
    model: Any,
    messages: Sequence[Any],
) -> dict[str, Any]:
    """Build metadata-only telemetry for a final model request."""
    model_name, budget = _model_budget(model)
    sources, estimated_tokens, media_count = _message_rows(messages)
    pressure = context_pressure(estimated_tokens, budget.effective_input_cap_tokens)
    ratio = estimated_tokens / budget.effective_input_cap_tokens
    return {
        "event": "context_observation",
        "schema_version": 1,
        "agent_id": _safe_identifier(agent_id, fallback="unknown-agent"),
        "thread_key": _thread_key(),
        "model": model_name,
        "window_source": budget.window_source,
        "model_context_window_tokens": budget.model_context_window_tokens,
        "configured_input_cap_tokens": budget.configured_input_cap_tokens,
        "output_reserve_tokens": budget.output_reserve_tokens,
        "safety_margin_tokens": budget.safety_margin_tokens,
        "effective_input_cap_tokens": budget.effective_input_cap_tokens,
        "estimated_input_tokens": estimated_tokens,
        "estimated_usage_ratio": round(ratio, 4),
        "pressure": pressure,
        "message_count": len(messages),
        "source_count": len(sources),
        "selected_sources": sources[:_MAX_SOURCE_ROWS],
        "selected_sources_truncated": len(sources) > _MAX_SOURCE_ROWS,
        "multimodal_payload_count": media_count,
        "token_estimate_method": "text_heuristic_v1",
        "omission_visibility": "not_available_after_context_assembly",
        "compaction_lifecycle_visibility": "requires_harness_lifecycle_hook",
    }


class ContextObservabilityMiddleware(AgentMiddleware[Any, Any]):
    """Emit metadata-only observations without changing the model request."""

    def __init__(self, agent_id: str) -> None:
        self._agent_id = agent_id

    def _observe(self, request: ModelRequest[Any]) -> None:
        try:
            raw_messages = getattr(request, "messages", ())
            messages = (
                raw_messages
                if isinstance(raw_messages, Sequence) and not isinstance(raw_messages, str | bytes)
                else ()
            )
            model = getattr(request, "model", None)
            event = build_context_observation(
                agent_id=self._agent_id,
                model=model,
                messages=messages,
            )
            logger.debug(
                "octop_context_observation %s",
                json.dumps(event, ensure_ascii=False, separators=(",", ":")),
            )
            if event["pressure"] in {"warn", "compact", "emergency"}:
                logger.info(
                    "octop_context_pressure agent=%s model=%s estimated=%s cap=%s pressure=%s",
                    event["agent_id"],
                    event["model"],
                    event["estimated_input_tokens"],
                    event["effective_input_cap_tokens"],
                    event["pressure"],
                )
        except Exception:
            # Observability must never make a valid model request fail.
            logger.debug("context observation skipped", exc_info=True)

    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        self._observe(request)
        return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        self._observe(request)
        return await handler(request)


__all__ = ["ContextObservabilityMiddleware", "build_context_observation"]
