"""Pure context-budget and context-packet validation helpers.

This module is intentionally side-effect free. It is safe to exercise in shadow
mode before wiring it into octop-harness's model-call lifecycle.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

DEFAULT_MODEL_CONTEXT_TOKENS = 32_000
DEFAULT_OUTPUT_RESERVE_TOKENS = 4_096
DEFAULT_SAFETY_MARGIN_TOKENS = 1_024
MAX_CONTEXT_ITEMS = 256
MAX_SOURCE_ID_LENGTH = 512

TrustLevel = Literal["trusted_policy", "project", "user", "tool_output", "external", "unknown"]


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


@dataclass(frozen=True, slots=True)
class ContextBudget:
    """Resolved token limits for one model call."""

    model_context_tokens: int
    output_reserve_tokens: int
    safety_margin_tokens: int
    configured_input_cap_tokens: int | None
    effective_input_cap_tokens: int
    source: Literal["model_profile", "configured_fallback"]
    is_estimated: bool


def resolve_context_budget(
    *,
    model_context_tokens: Any = None,
    configured_input_cap_tokens: Any = None,
    output_reserve_tokens: Any = DEFAULT_OUTPUT_RESERVE_TOKENS,
    safety_margin_tokens: Any = DEFAULT_SAFETY_MARGIN_TOKENS,
    fallback_model_context_tokens: int = DEFAULT_MODEL_CONTEXT_TOKENS,
) -> ContextBudget:
    """Resolve a conservative input cap without assuming all models are 128k.

    A model's reported context window is preferred. When unavailable or invalid,
    a conservative fallback is used and explicitly marked as estimated.
    """
    model_limit = _positive_int(model_context_tokens)
    estimated = model_limit is None
    if model_limit is None:
        model_limit = _positive_int(fallback_model_context_tokens) or DEFAULT_MODEL_CONTEXT_TOKENS

    output_reserve = _positive_int(output_reserve_tokens)
    if output_reserve is None:
        output_reserve = DEFAULT_OUTPUT_RESERVE_TOKENS
    safety_margin = _positive_int(safety_margin_tokens)
    if safety_margin is None:
        safety_margin = DEFAULT_SAFETY_MARGIN_TOKENS

    configured_cap = _positive_int(configured_input_cap_tokens)
    provider_input_cap = max(1, model_limit - output_reserve - safety_margin)
    effective_cap = min(provider_input_cap, configured_cap) if configured_cap is not None else provider_input_cap

    return ContextBudget(
        model_context_tokens=model_limit,
        output_reserve_tokens=output_reserve,
        safety_margin_tokens=safety_margin,
        configured_input_cap_tokens=configured_cap,
        effective_input_cap_tokens=effective_cap,
        source="configured_fallback" if estimated else "model_profile",
        is_estimated=estimated,
    )


@dataclass(frozen=True, slots=True)
class ContextItem:
    """A bounded, provenance-carrying item proposed for a model context."""

    source_id: str
    scope: str
    trust_level: TrustLevel
    sensitivity: Literal["public", "internal", "confidential", "secret"]
    estimated_tokens: int
    inclusion_reason: str
    revision: str | None = None


@dataclass(frozen=True, slots=True)
class ContextPacketValidation:
    valid: bool
    errors: tuple[str, ...]
    estimated_tokens: int


def validate_context_items(items: Any, *, max_items: int = MAX_CONTEXT_ITEMS) -> ContextPacketValidation:
    """Validate provenance and boundedness; this does not grant access.

    Authorization must be checked before retrieval/assembly. This validator
    prevents malformed or unbounded packets from entering the next pipeline
    stage, but it is deliberately not an authorization mechanism.
    """
    if not isinstance(items, (list, tuple)):
        return ContextPacketValidation(False, ("items must be a list or tuple",), 0)
    if len(items) > max_items:
        return ContextPacketValidation(False, (f"too many context items (max {max_items})",), 0)

    errors: list[str] = []
    estimated_tokens = 0
    allowed_trust = {"trusted_policy", "project", "user", "tool_output", "external", "unknown"}
    allowed_sensitivity = {"public", "internal", "confidential", "secret"}

    for index, item in enumerate(items):
        prefix = f"items[{index}]"
        if not isinstance(item, ContextItem):
            errors.append(f"{prefix} must be a ContextItem")
            continue
        if not item.source_id.strip() or len(item.source_id) > MAX_SOURCE_ID_LENGTH:
            errors.append(f"{prefix}.source_id is missing or too long")
        if not item.scope.strip():
            errors.append(f"{prefix}.scope is required")
        if item.trust_level not in allowed_trust:
            errors.append(f"{prefix}.trust_level is invalid")
        if item.sensitivity not in allowed_sensitivity:
            errors.append(f"{prefix}.sensitivity is invalid")
        if isinstance(item.estimated_tokens, bool) or item.estimated_tokens < 0:
            errors.append(f"{prefix}.estimated_tokens must be a non-negative integer")
        elif not isinstance(item.estimated_tokens, int):
            errors.append(f"{prefix}.estimated_tokens must be a non-negative integer")
        else:
            estimated_tokens += item.estimated_tokens
        if not item.inclusion_reason.strip():
            errors.append(f"{prefix}.inclusion_reason is required")

    return ContextPacketValidation(not errors, tuple(errors), estimated_tokens)


__all__ = [
    "ContextBudget",
    "ContextItem",
    "ContextPacketValidation",
    "resolve_context_budget",
    "validate_context_items",
]
