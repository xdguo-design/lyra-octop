from types import SimpleNamespace

import pytest

from octop.infra.gateway.process.processor import GlobalProcessor


@pytest.mark.parametrize("meta,expected", [({}, "high"), ({"reasoning_effort": "low"}, "low")])
def test_expert_reasoning_default_reaches_chat_and_turn_can_override(meta, expected) -> None:
    capability = {"adapter": "openai_reasoning_effort", "efforts": ["low", "high"]}
    processor = SimpleNamespace(
        _agent_manager=SimpleNamespace(
            providers=SimpleNamespace(get_model_reasoning_capability=lambda _ref: capability),
            get_config=lambda _id: {"reasoning": {"mode": "enabled", "effort": "high"}},
        ),
        _thread_registry=SimpleNamespace(get_thread=lambda _id: None),
        _user_repo=SimpleNamespace(get=lambda _id: None),
    )
    assert GlobalProcessor._resolve_reasoning_overrides(
        processor,
        user_id=1,
        thread_id="test",
        model_ref="provider/model",
        meta=meta,
        agent_id="expert",
    ) == {"model_fields": {"reasoning_effort": expected}}
