"""Tests for conservative context budgeting and delegation packet validation."""

from __future__ import annotations

import pytest

from octop.infra.agents.context.budget import (
    context_pressure,
    estimate_payload_tokens,
    estimate_text_tokens,
    resolve_context_budget,
    validate_context_packet,
)


def test_context_budget_never_exceeds_model_window_after_reserves() -> None:
    budget = resolve_context_budget(
        model_context_window_tokens=32_768,
        configured_input_cap_tokens=64_000,
        output_reserve_tokens=4_096,
        safety_margin_tokens=512,
    )
    assert budget.window_source == "model"
    assert budget.effective_input_cap_tokens == 28_160


def test_context_budget_respects_smaller_agent_cap() -> None:
    budget = resolve_context_budget(
        model_context_window_tokens=128_000,
        configured_input_cap_tokens=20_000,
        output_reserve_tokens=4_096,
        safety_margin_tokens=1_024,
    )
    assert budget.effective_input_cap_tokens == 20_000


def test_missing_model_window_is_marked_as_estimated_fallback() -> None:
    budget = resolve_context_budget(
        model_context_window_tokens=None,
        configured_input_cap_tokens=20_000,
        output_reserve_tokens=1_024,
        safety_margin_tokens=512,
        fallback_context_window_tokens=16_000,
    )
    assert budget.window_source == "fallback"
    assert budget.model_context_window_tokens == 16_000
    assert budget.effective_input_cap_tokens == 14_464


def test_invalid_budget_inputs_do_not_accept_boolean_as_integer() -> None:
    budget = resolve_context_budget(
        model_context_window_tokens=True,
        configured_input_cap_tokens=False,
        fallback_context_window_tokens=16_000,
        output_reserve_tokens=1_024,
        safety_margin_tokens=512,
    )
    assert budget.window_source == "fallback"
    assert budget.configured_input_cap_tokens is None
    assert budget.effective_input_cap_tokens == 14_464


@pytest.mark.parametrize(
    ("used", "expected"),
    [
        (0, "normal"),
        (699, "normal"),
        (700, "warn"),
        (820, "compact"),
        (920, "emergency"),
        (1_200, "emergency"),
    ],
)
def test_context_pressure_thresholds_are_observational_only(used: int, expected: str) -> None:
    assert context_pressure(used, 1_000) == expected


def test_text_token_estimate_handles_cjk_and_ascii() -> None:
    assert estimate_text_tokens("hello world") == 3
    assert estimate_text_tokens("你好世界") == 4
    assert estimate_text_tokens("") == 0


def test_payload_estimator_counts_text_and_marks_media_without_reading_payload() -> None:
    estimated, media = estimate_payload_tokens(
        [
            {"type": "text", "text": "你好"},
            {"type": "image_url", "image_url": {"url": "https://example.invalid/image.png"}},
        ]
    )
    assert estimated == 2
    assert media == 1


def _valid_packet() -> dict[str, object]:
    return {
        "schema_version": 1,
        "agent_id": "agent-child",
        "task_id": "task-42",
        "input_token_budget": 100,
        "items": [
            {
                "source_id": "project-doc:architecture",
                "scope": "project",
                "trust_level": "verified",
                "sensitivity": "internal",
                "estimated_tokens": 100,
                "included": True,
                "reason": "Directly defines the implementation boundary",
                "excerpt": "Use the existing harness extension points.",
            }
        ],
    }


def test_context_packet_accepts_bounded_provenance_aware_items() -> None:
    validate_context_packet(_valid_packet())


def test_context_packet_rejects_included_items_over_budget() -> None:
    packet = _valid_packet()
    packet["input_token_budget"] = 99
    with pytest.raises(ValueError, match="exceed input_token_budget"):
        validate_context_packet(packet)


def test_context_packet_rejects_raw_secret_fields() -> None:
    packet = _valid_packet()
    packet["api_key"] = "must-not-be-forwarded"
    with pytest.raises(ValueError, match="api_key is not allowed"):
        validate_context_packet(packet)


def test_context_packet_rejects_unknown_scope_and_unbounded_excerpt() -> None:
    packet = _valid_packet()
    item = packet["items"][0]
    assert isinstance(item, dict)
    item["scope"] = "other-user-private-memory"
    item["excerpt"] = "x" * 4_001
    with pytest.raises(ValueError) as exc:
        validate_context_packet(packet)
    assert "scope is unsupported" in str(exc.value)
    assert "excerpt must be text up to 4000 chars" in str(exc.value)
