from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from langchain_core.messages import AIMessage


def _bind_test_admission_model(server: Any) -> None:
    server.services.provider_repo.create(
        name="demo-provider",
        kind="openai",
        base_url="https://example.test/v1",
        api_key="test-key",
        models_json=json.dumps(
            [
                {
                    "id": "demo-model",
                    "name": "Demo Display Name",
                    "reasoning_config": {
                        "adapter": "openai_reasoning_effort",
                        "efforts": ["low", "high"],
                    },
                }
            ]
        ),
    )
    config = server.app_runtime.agent_registry.get_config("octop-admission-demo")
    config["reasoning"] = {"mode": "enabled", "effort": "high"}
    server.services.agent_repo.update_config(
        "octop-admission-demo",
        default_model="demo-provider/demo-model",
        config_json=json.dumps(config),
    )
    server.services.settings_repo.set_active_model("different-provider", "different-model")


async def test_admission_ai_endpoint_requires_login(env: Any) -> None:
    client, _server, _auth = env

    response = await client.post(
        "/api/admission-demo/extract",
        json={"text": "我是王晓梅，患者女儿，手机号 13800138000。"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


async def test_admission_expert_is_provisioned_as_a_shared_system_agent(env: Any) -> None:
    client, _server, auth = env

    # The demo Agent is a shared system agent (user_id NULL): addressable by id
    # and listed for admins under scope=all, but deliberately kept out of every
    # user's default "mine + explicitly shared" list (see the list_agents contract).
    response = await client.get("/api/agents?scope=all", headers=auth)

    assert response.status_code == 200, response.text
    admission_agent = next(
        agent for agent in response.json() if agent["agent_id"] == "octop-admission-demo"
    )
    assert admission_agent["name"] == "入院登记助手"
    assert admission_agent["kind"] == "expert"
    assert admission_agent["is_shared"] is True
    assert admission_agent["is_owner"] is False


async def test_admission_ai_endpoint_rejects_oversized_input(env: Any) -> None:
    client, _server, auth = env

    response = await client.post(
        "/api/admission-demo/extract",
        headers=auth,
        json={"text": "甲" * 2001},
    )

    assert response.status_code == 422


async def test_admission_ai_uses_the_bound_expert_model_and_effort(env: Any, monkeypatch) -> None:
    client, server, auth = env
    factory = Mock()
    manager = server.app_runtime.agent_registry.harness_manager
    manager.shared_factory = factory
    call = AsyncMock(
        return_value={
            "messages": [
                AIMessage(
                    content=json.dumps({"emergency_contact": "王晓梅", "relationship": "女儿"})
                )
            ]
        }
    )
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call)
    monkeypatch.setattr(
        "octop.infra.admission_demo._ensure_admission_agent", AsyncMock(return_value=object())
    )
    _bind_test_admission_model(server)

    response = await client.post(
        "/api/admission-demo/extract",
        headers=auth,
        json={"text": "我是王晓梅，患者的女儿。", "page": 2},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "fields": {"emergency_contact": "王晓梅", "relationship": "女儿"},
        "modelName": "Demo Display Name",
        "clarification": None,
        "clarificationChoices": [],
        "uncertainFields": None,
    }
    assert call.await_args.args[1]["skills"] == []
    assert call.await_args.args[1]["messages"][0]["role"] == "system"
    assert "admission-patient-info" in call.await_args.args[1]["messages"][0]["content"]
    assert call.await_args.args[1]["user"] is not None
    assert call.await_args.args[1]["model"] == "demo-provider/demo-model"
    assert call.await_args.args[1]["configurable"]["octop_reasoning_overrides"] == {
        "model_fields": {"reasoning_effort": "high"}
    }


async def test_admission_ai_reports_active_model_failure(env: Any, monkeypatch) -> None:
    client, server, auth = env
    factory = Mock()
    server.app_runtime.agent_registry.harness_manager.shared_factory = factory
    monkeypatch.setattr(
        server.app_runtime.agent_registry,
        "call",
        AsyncMock(side_effect=RuntimeError("model not found")),
    )
    monkeypatch.setattr(
        "octop.infra.admission_demo._ensure_admission_agent", AsyncMock(return_value=object())
    )
    server.services.settings_repo.set_active_model("demo-provider", "missing-model")

    response = await client.post(
        "/api/admission-demo/extract",
        headers=auth,
        json={"text": "联系电话13800138000"},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "AI_MODEL_UNAVAILABLE"


async def test_admission_intent_endpoint_requires_login(env: Any) -> None:
    client, _server, _auth = env

    response = await client.post(
        "/api/admission-demo/intent",
        json={"page": "home", "text": "我要入院"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


async def test_candidate_confirmation_endpoint_requires_login(env: Any) -> None:
    client, _server, _auth = env

    response = await client.post(
        "/api/admission-demo/candidate-confirmation",
        json={
            "text": "好的修改",
            "field_key": "addressDetail",
            "current_value": "旧地址",
            "candidate_value": "佳兆业中心",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_FAILED"


async def test_candidate_confirmation_endpoint_uses_bound_model(env: Any, monkeypatch) -> None:
    client, server, auth = env
    factory = Mock()
    server.app_runtime.agent_registry.harness_manager.shared_factory = factory
    call = AsyncMock(
        return_value={"messages": [AIMessage(content='{"decision":"accept_candidate"}')]}
    )
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call)
    monkeypatch.setattr(
        "octop.infra.admission_demo._ensure_admission_agent", AsyncMock(return_value=object())
    )
    _bind_test_admission_model(server)

    response = await client.post(
        "/api/admission-demo/candidate-confirmation",
        headers=auth,
        json={
            "text": "好的，改成佳兆业中心",
            "field_key": "addressDetail",
            "current_value": "沈阳市教作业中心",
            "candidate_value": "佳兆业中心",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"decision": "accept_candidate"}
    assert call.await_args.args[1]["skills"] == []
    assert call.await_args.args[1]["messages"][0]["role"] == "system"
    assert "admission-patient-info" in call.await_args.args[1]["messages"][0]["content"]


async def test_candidate_confirmation_endpoint_rejects_invalid_context(env: Any) -> None:
    client, _server, auth = env
    valid = {
        "text": "好的修改",
        "field_key": "addressDetail",
        "current_value": "旧地址",
        "candidate_value": "佳兆业中心",
    }

    invalid_field = await client.post(
        "/api/admission-demo/candidate-confirmation",
        headers=auth,
        json={**valid, "field_key": "idNumber"},
    )
    extra_data = await client.post(
        "/api/admission-demo/candidate-confirmation",
        headers=auth,
        json={**valid, "form": {"phone": "13800138000"}},
    )
    oversized_value = await client.post(
        "/api/admission-demo/candidate-confirmation",
        headers=auth,
        json={**valid, "candidate_value": "甲" * 201},
    )

    assert invalid_field.status_code == 422
    assert extra_data.status_code == 422
    assert oversized_value.status_code == 422


@pytest.mark.parametrize(
    ("text", "model_intent", "expected_reply"),
    [
        (
            "住院登记",
            "begin_admission",
            "您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。",
        ),
        ("入院登记怎么办理？", "answer_question", "测试回答"),
        ("帮我做报告解读", "unsupported", "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。"),
    ],
)
async def test_admission_intent_endpoint_uses_fixed_response_for_model_and_short_phrase(
    env: Any, text: str, model_intent: str, expected_reply: str, monkeypatch
) -> None:
    client, server, auth = env
    factory = Mock()
    server.app_runtime.agent_registry.harness_manager.shared_factory = factory
    call = AsyncMock(
        return_value={
            "messages": [AIMessage(content=f'{{"intent":"{model_intent}","reply":"测试回答"}}')]
        }
    )
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call)
    monkeypatch.setattr(
        "octop.infra.admission_demo._ensure_admission_agent", AsyncMock(return_value=object())
    )
    _bind_test_admission_model(server)

    response = await client.post(
        "/api/admission-demo/intent",
        headers=auth,
        json={"page": "home", "text": text},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"intent": model_intent, "reply": expected_reply}
    if text == "住院登记":
        call.assert_not_awaited()
    else:
        assert call.await_args.args[1]["skills"] == []
        assert call.await_args.args[1]["messages"][0]["role"] == "system"
        assert "admission-router" in call.await_args.args[1]["messages"][0]["content"]


async def test_admission_intent_endpoint_rejects_other_pages_and_oversized_text(env: Any) -> None:
    client, _server, auth = env

    wrong_page = await client.post(
        "/api/admission-demo/intent",
        headers=auth,
        json={"page": "identity", "text": "我要入院"},
    )
    oversized = await client.post(
        "/api/admission-demo/intent",
        headers=auth,
        json={"page": "home", "text": "甲" * 2001},
    )
    extra_action = await client.post(
        "/api/admission-demo/intent",
        headers=auth,
        json={"page": "home", "text": "我要入院", "action": "verify_identity"},
    )

    assert wrong_page.status_code == 422
    assert oversized.status_code == 422
    assert extra_action.status_code == 422


async def test_admission_intent_endpoint_reports_model_failure(env: Any) -> None:
    client, server, auth = env
    server.app_runtime.agent_registry.harness_manager.shared_factory = None
    server.services.settings_repo.set_active_model("demo-provider", "missing-model")

    response = await client.post(
        "/api/admission-demo/intent",
        headers=auth,
        json={"page": "home", "text": "我要入院"},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "AI_MODEL_UNAVAILABLE"
