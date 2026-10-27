"""Tests for metadata-only context observability middleware."""

from __future__ import annotations

import logging
from types import SimpleNamespace

from octop.infra.agents.middleware.context_observability import (
    ContextObservabilityMiddleware,
    build_context_observation,
)


def _request() -> SimpleNamespace:
    return SimpleNamespace(
        model=SimpleNamespace(
            model_name="test-model",
            profile={"context_window": 32_768, "max_input_tokens": 30_000},
            max_tokens=4_096,
        ),
        messages=[
            SimpleNamespace(id="msg-1", type="human", content="private text must not be logged"),
            SimpleNamespace(id="msg-2", type="ai", content="hello", tool_calls=[]),
        ],
    )


def test_observation_reports_budget_and_source_metadata_only() -> None:
    request = _request()
    event = build_context_observation(
        agent_id="agent-1",
        model=request.model,
        messages=request.messages,
    )
    assert event["event"] == "context_observation"
    assert event["window_source"] == "model"
    assert event["effective_input_cap_tokens"] == 27_648
    assert event["source_count"] == 2
    assert event["selected_sources"][0]["source_id"] == "msg-1"
    assert event["selected_sources"][0]["selection_reason"] == "present_in_model_request"
    assert "private text must not be logged" not in str(event)


def test_middleware_passes_the_same_request_without_mutating_it(caplog) -> None:
    request = _request()
    original_messages = request.messages
    middleware = ContextObservabilityMiddleware(agent_id="agent-1")

    with caplog.at_level(logging.DEBUG):
        result = middleware.wrap_model_call(request, lambda received: received)

    assert result is request
    assert request.messages is original_messages
    assert "octop_context_observation" in caplog.text
    assert "msg-1" in caplog.text
    assert "private text must not be logged" not in caplog.text


def test_observation_marks_unknown_model_window_as_fallback() -> None:
    model = SimpleNamespace(model_name="unknown-window", profile={}, max_tokens=2_048)
    event = build_context_observation(
        agent_id="agent-1",
        model=model,
        messages=[SimpleNamespace(id="m1", type="human", content="short prompt")],
    )
    assert event["window_source"] == "fallback"
    assert event["effective_input_cap_tokens"] < 128_000
    assert event["omission_visibility"] == "not_available_after_context_assembly"
    assert event["compaction_lifecycle_visibility"] == "requires_harness_lifecycle_hook"
