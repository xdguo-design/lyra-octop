"""Pure context-budget, token-estimation, and delegation-packet helpers.

These helpers are deliberately side-effect free. They are safe to exercise in
shadow mode before Octop changes any model input or compaction behavior.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000
DEFAULT_OUTPUT_RESERVE_TOKENS = 8_192
DEFAULT_SAFETY_MARGIN_TOKENS = 1_024

_CONTEXT_SCOPES = frozenset(
    {"platform", "user", "project", "conversation", "team", "agent_private", "task", "artifact"}
)
_TRUST_LEVELS = frozenset(
    {"trusted", "verified", "unverified", "untrusted", "user_provided", "external", "tool_output"}
)
_SENSITIVITY_LEVELS = frozenset({"public", "internal", "confidential", "restricted"})
_FORBIDDEN_FIELDS = frozenset(
    {
        "access_token",
        "api_key",
        "authorization",
        "credential",
        "credentials",
        "full_history",
        "messages",
        "password",
        "private_key",
        "raw_content",
        "raw_prompt",
        "secret",
        "secrets",
        "transcript",
    }
)
_NON_TEXT_FIELDS = frozenset(
    {"audio", "base64", "binary", "bytes", "data", "image", "image_url", "video"}
)


@dataclass(frozen=True)
class ContextBudget:
    """Resolved input budget; a fallback window is explicitly identified."""

    model_context_window_tokens: int
    configured_input_cap_tokens: int | None
    output_reserve_tokens: int
    safety_margin_tokens: int
    effective_input_cap_tokens: int
    window_source: str


def positive_int(value: Any) -> int | None:
    """Parse a positive integer while rejecting bools and lossy coercions."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float) and value.is_integer():
        parsed = int(value)
        return parsed if parsed > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


def resolve_context_budget(
    *,
    model_context_window_tokens: Any = None,
    configured_input_cap_tokens: Any = None,
    output_reserve_tokens: Any = None,
    safety_margin_tokens: Any = None,
    fallback_context_window_tokens: Any = DEFAULT_CONTEXT_WINDOW_TOKENS,
) -> ContextBudget:
    """Compute a conservative input cap without changing the active request.

    The model window is the upper bound. The Agent input cap can lower that
    bound, but cannot raise it. Missing model metadata uses an explicit fallback
    and is reported as such so callers do not present it as authoritative.
    """
    model_window = positive_int(model_context_window_tokens)
    window_source = "model" if model_window is not None else "fallback"
    if model_window is None:
        model_window = positive_int(fallback_context_window_tokens)
    if model_window is None:
        model_window = DEFAULT_CONTEXT_WINDOW_TOKENS

    output_reserve = positive_int(output_reserve_tokens)
    if output_reserve is None:
        output_reserve = min(DEFAULT_OUTPUT_RESERVE_TOKENS, max(256, model_window // 8))

    safety_margin = positive_int(safety_margin_tokens)
    if safety_margin is None:
        safety_margin = min(DEFAULT_SAFETY_MARGIN_TOKENS, max(64, model_window // 32))

    available_input = max(1, model_window - output_reserve - safety_margin)
    configured_cap = positive_int(configured_input_cap_tokens)
    effective_cap = (
        min(available_input, configured_cap)
        if configured_cap is not None
        else available_input
    )

    return ContextBudget(
        model_context_window_tokens=model_window,
        configured_input_cap_tokens=configured_cap,
        output_reserve_tokens=output_reserve,
        safety_margin_tokens=safety_margin,
        effective_input_cap_tokens=effective_cap,
        window_source=window_source,
    )


def context_pressure(estimated_input_tokens: int, effective_input_cap_tokens: int) -> str:
    """Classify pressure for telemetry only; this function never triggers compaction."""
    cap = positive_int(effective_input_cap_tokens)
    if cap is None:
        return "unknown"
    used = max(0, estimated_input_tokens)
    ratio = used / cap
    if ratio >= 0.92:
        return "emergency"
    if ratio >= 0.82:
        return "compact"
    if ratio >= 0.70:
        return "warn"
    return "normal"


def estimate_text_tokens(text: str) -> int:
    """Return a cheap heuristic estimate, not a tokenizer/provider measurement.

    Non-ASCII non-whitespace characters count as one token each; ASCII
    characters are estimated at four non-whitespace characters per token.
    """
    if not text:
        return 0
    ascii_chars = sum(1 for char in text if ord(char) < 128 and not char.isspace())
    non_ascii_chars = sum(1 for char in text if ord(char) >= 128 and not char.isspace())
    return math.ceil(ascii_chars / 4) + non_ascii_chars


def estimate_payload_tokens(value: Any) -> tuple[int, int]:
    """Estimate text tokens in a message payload and count omitted media blocks."""
    text_parts: list[str] = []
    media_blocks = 0

    def visit(item: Any, *, depth: int = 0) -> None:
        nonlocal media_blocks
        if depth > 12 or item is None or isinstance(item, bool | int | float):
            return
        if isinstance(item, str):
            text_parts.append(item)
            return
        if isinstance(item, Mapping):
            item_type = str(item.get("type") or "").lower()
            if item_type in {
                "image",
                "image_url",
                "input_image",
                "audio",
                "input_audio",
                "video",
                "file",
            }:
                media_blocks += 1
                return
            for key, child in item.items():
                key_name = str(key).lower()
                if key_name in _NON_TEXT_FIELDS:
                    if child is not None:
                        media_blocks += 1
                    continue
                if key_name in {"type", "mime_type", "mimeType"}:
                    continue
                visit(child, depth=depth + 1)
            return
        if isinstance(item, Sequence) and not isinstance(item, str | bytes | bytearray):
            for child in item:
                visit(child, depth=depth + 1)

    visit(value)
    return estimate_text_tokens("\n".join(text_parts)), media_blocks


def validate_context_packet(packet: Mapping[str, Any]) -> None:
    """Validate a bounded task-context packet before it is sent to a child Agent.

    The validator rejects whole-transcript/raw-secret fields and requires each
    item to declare its scope, provenance/trust, sensitivity, token estimate,
    inclusion decision, and reason. It raises ValueError with all detected
    issues so callers can report them together.
    """
    errors: list[str] = []
    if not isinstance(packet, Mapping):
        raise ValueError("context packet must be a mapping")

    if packet.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    for key in ("agent_id", "task_id"):
        value = packet.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{key} must be a non-empty string")

    budget = positive_int(packet.get("input_token_budget"))
    if budget is None:
        errors.append("input_token_budget must be a positive integer")

    items = packet.get("items")
    if not isinstance(items, Sequence) or isinstance(items, str | bytes | bytearray):
        errors.append("items must be a sequence")
        items = ()

    def scan_forbidden(value: Any, path: str = "packet") -> None:
        if isinstance(value, Mapping):
            for key, child in value.items():
                normalized = str(key).strip().lower().replace("-", "_")
                if normalized in _FORBIDDEN_FIELDS:
                    errors.append(f"{path}.{normalized} is not allowed")
                scan_forbidden(child, f"{path}.{normalized}")
        elif isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
            for index, child in enumerate(value):
                scan_forbidden(child, f"{path}[{index}]")

    scan_forbidden(packet)
    included_tokens = 0
    for index, item in enumerate(items):
        prefix = f"items[{index}]"
        if not isinstance(item, Mapping):
            errors.append(f"{prefix} must be a mapping")
            continue

        source_id = item.get("source_id")
        if not isinstance(source_id, str) or not source_id.strip() or len(source_id) > 256:
            errors.append(f"{prefix}.source_id must be a non-empty string up to 256 chars")

        scope = item.get("scope")
        if not isinstance(scope, str) or scope not in _CONTEXT_SCOPES:
            errors.append(f"{prefix}.scope is unsupported")

        trust = item.get("trust_level")
        if not isinstance(trust, str) or trust not in _TRUST_LEVELS:
            errors.append(f"{prefix}.trust_level is unsupported")

        sensitivity = item.get("sensitivity")
        if not isinstance(sensitivity, str) or sensitivity not in _SENSITIVITY_LEVELS:
            errors.append(f"{prefix}.sensitivity is unsupported")

        estimate = item.get("estimated_tokens")
        if isinstance(estimate, bool) or not isinstance(estimate, int) or estimate < 0:
            errors.append(f"{prefix}.estimated_tokens must be a non-negative integer")
            estimate = 0

        included = item.get("included")
        if not isinstance(included, bool):
            errors.append(f"{prefix}.included must be a boolean")
        elif included:
            included_tokens += estimate

        reason = item.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            errors.append(f"{prefix}.reason must explain the selection or omission")

        excerpt = item.get("excerpt")
        if excerpt is not None and (not isinstance(excerpt, str) or len(excerpt) > 4_000):
            errors.append(f"{prefix}.excerpt must be text up to 4000 chars")

    if budget is not None and included_tokens > budget:
        errors.append("included item estimates exceed input_token_budget")

    if errors:
        raise ValueError("invalid context packet: " + "; ".join(errors))


__all__ = [
    "ContextBudget",
    "context_pressure",
    "estimate_payload_tokens",
    "estimate_text_tokens",
    "positive_int",
    "resolve_context_budget",
    "validate_context_packet",
]
