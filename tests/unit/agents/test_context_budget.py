"""Tests for pure context-budget and packet-validation helpers."""

from __future__ import annotations

from octop.infra.agents.context_budget import (
    ContextItem,
    resolve_context_budget,
    validate_context_items,
)


def test_budget_prefers_model_window_and_reserves_output_and_margin() -> None:
    budget = resolve_context_budget(
        model_context_tokens=64_000,
        configured_input_cap_tokens=60_000,
        output_reserve_tokens=4_000,
        safety_margin_tokens=1_000,
    )
    assert budget.effective_input_cap_tokens == 59_000
    assert budget.source == "model_profile"
    assert not budget.is_estimated


def test_budget_uses_lower_configured_cap() -> None:
    budget = resolve_context_budget(
        model_context_tokens=128_000,
        configured_input_cap_tokens=20_000,
        output_reserve_tokens=4_000,
        safety_margin_tokens=1_000,
    )
    assert budget.effective_input_cap_tokens == 20_000


def test_budget_marks_fallback_as_estimated() -> None:
    budget = resolve_context_budget(
        model_context_tokens=None,
        fallback_model_context_tokens=24_000,
        output_reserve_tokens=2_000,
        safety_margin_tokens=500,
    )
    assert budget.effective_input_cap_tokens == 21_500
    assert budget.is_estimated
    assert budget.source == "configured_fallback"


def test_invalid_model_window_uses_fallback_and_boolean_is_not_a_number() -> None:
    budget = resolve_context_budget(model_context_tokens=True, fallback_model_context_tokens=16_000)
    assert budget.model_context_tokens == 16_000
    assert budget.is_estimated


def test_context_packet_requires_provenance_and_counts_tokens() -> None:
    items = [
        ContextItem(
            source_id="doc:architecture@rev-3",
            scope="project:octop",
            trust_level="project",
            sensitivity="internal",
            estimated_tokens=120,
            inclusion_reason="Relevant architecture decision",
            revision="rev-3",
        ),
        ContextItem(
            source_id="message:turn-7",
            scope="conversation:thread-1",
            trust_level="user",
            sensitivity="internal",
            estimated_tokens=80,
            inclusion_reason="Current explicit constraint",
        ),
    ]
    result = validate_context_items(items)
    assert result.valid
    assert result.errors == ()
    assert result.estimated_tokens == 200


def test_context_packet_rejects_missing_scope_and_reason() -> None:
    item = ContextItem(
        source_id="memory:1",
        scope=" ",
        trust_level="unknown",
        sensitivity="internal",
        estimated_tokens=12,
        inclusion_reason=" ",
    )
    result = validate_context_items([item])
    assert not result.valid
    assert "items[0].scope is required" in result.errors
    assert "items[0].inclusion_reason is required" in result.errors


def test_context_packet_rejects_negative_tokens_and_unbounded_item_count() -> None:
    item = ContextItem(
        source_id="tool:output",
        scope="task:1",
        trust_level="tool_output",
        sensitivity="internal",
        estimated_tokens=-1,
        inclusion_reason="Task evidence",
    )
    assert not validate_context_items([item]).valid
    assert not validate_context_items([item], max_items=0).valid


def test_context_packet_rejects_untyped_items() -> None:
    result = validate_context_items([{"source_id": "raw"}])
    assert not result.valid
    assert result.errors == ("items[0] must be a ContextItem",)
