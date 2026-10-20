from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, Mock

from langchain_core.messages import AIMessage

from octop.infra.admission_registration_demo import demo_store
from tests.support.auth import create_user


async def _select_admission_session(client: Any, auth: dict[str, str], token: str) -> str:
    applications = await client.get(
        "/api/admission-registration/v1/applications",
        headers=auth,
        params={"identityToken": token},
    )
    application = applications.json()["items"][0]
    selected = await client.post(
        "/api/admission-registration/v1/applications/select",
        headers=auth,
        json={"identityToken": token, "applicationId": application["id"]},
    )
    assert selected.status_code == 200, selected.text
    return selected.json()["sessionId"]


def _use_test_admission_model(server: Any, monkeypatch: Any) -> None:
    server.services.settings_repo.set_active_model("demo-provider", "demo-model")
    providers = server.app_runtime.agent_registry.providers
    monkeypatch.setattr(providers, "is_model_ref_usable", Mock(return_value=True))
    monkeypatch.setattr(providers, "get_model_reasoning_capability", Mock(return_value=None))


async def test_reverification_clears_previous_patient_conversation_and_starts_clean(
    env_admin_alice: Any,
) -> None:
    client, server, _admin_auth, alice_auth = env_admin_alice
    demo_store.reset()
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=alice_auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    session_id = await _select_admission_session(client, alice_auth, token)
    saved = await client.post(
        f"/api/admission-registration/v1/sessions/{session_id}/turns",
        headers=alice_auth,
        json={
            "identityToken": token,
            "expectedRevision": 0,
            "turnId": "resume-turn-0001",
            "previousTurnId": None,
            "utterance": "我的联系电话是13800138000",
            "response": "已记录联系电话。",
            "action": "voice_turn",
            "fields": {"phone": "13800138000"},
            "pendingProposal": {"phone": "13900139000"},
        },
    )
    assert saved.status_code == 200, saved.text

    failed_reverify = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=alice_auth,
        json={"method": "id_card", "mockScenario": "failed"},
    )
    still_valid = await client.get(
        f"/api/admission-registration/v1/sessions/{session_id}",
        headers=alice_auth,
        params={"identityToken": token},
    )
    assert failed_reverify.status_code == 422
    assert still_valid.status_code == 200, still_valid.text

    reverified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=alice_auth,
        json={"method": "id_card"},
    )
    new_token = reverified.json()["identityToken"]
    stale_token_read = await client.get(
        f"/api/admission-registration/v1/sessions/{session_id}",
        headers=alice_auth,
        params={"identityToken": token},
    )
    new_session_id = await _select_admission_session(client, alice_auth, new_token)
    new_session = await client.get(
        f"/api/admission-registration/v1/sessions/{new_session_id}",
        headers=alice_auth,
        params={"identityToken": new_token},
    )
    repeated_session_id = await _select_admission_session(client, alice_auth, new_token)

    assert new_session_id != session_id
    assert repeated_session_id == new_session_id
    assert stale_token_read.status_code == 401
    assert new_session.status_code == 200, new_session.text
    assert new_session.json()["revision"] == 0
    assert new_session.json()["turns"] == []
    assert new_session.json()["pendingProposal"] is None
    assert "important" not in new_session.json()["summary"]
    assert new_session.json()["facts"]["phone"]["value"] == ""
    saved_new_turn = await client.post(
        f"/api/admission-registration/v1/sessions/{new_session_id}/turns",
        headers=alice_auth,
        json={
            "identityToken": new_token,
            "expectedRevision": 0,
            "turnId": "fresh-turn-0001",
            "previousTurnId": None,
            "utterance": "请记录联系电话13800138000",
            "response": "已记录联系电话。",
            "action": "voice_turn",
            "fields": {"phone": "13800138000"},
        },
    )
    assert saved_new_turn.status_code == 200, saved_new_turn.text
    assert await _select_admission_session(client, alice_auth, new_token) == new_session_id
    retained = await client.get(
        f"/api/admission-registration/v1/sessions/{new_session_id}",
        headers=alice_auth,
        params={"identityToken": new_token},
    )
    assert retained.status_code == 200, retained.text
    assert retained.json()["revision"] == 1
    assert retained.json()["facts"]["phone"]["value"] == "13800138000"
    alice = server.services.user_repo.get_by_username("alice")
    assert alice is not None
    assert server.services.admission_session_repo.get_owned(session_id, alice.id) is None


async def test_mock_endpoints_require_an_authenticated_user(env: Any) -> None:
    client, _server, _auth = env
    paths = [
        ("GET", "/api/admission-registration/v1/health", None),
        ("GET", "/api/admission-registration/v1/regions", None),
        ("POST", "/api/admission-registration/v1/validate", {"fields": {}}),
        (
            "POST",
            "/api/admission-registration/v1/identity/verify",
            {"method": "id_card"},
        ),
        (
            "POST",
            "/api/admission-registration/v1/submissions",
            {
                "identityToken": "forged",
                "applicationId": "forged",
                "sessionId": "forged-session",
                "reviewRevision": 1,
                "idempotencyKey": "request-123",
                "fields": {},
            },
        ),
        (
            "POST",
            "/api/admission-registration/v1/submissions/result",
            {"identityToken": "forged", "idempotencyKey": "request-123"},
        ),
        (
            "POST",
            "/api/admission-registration/v1/ai/candidates",
            {
                "text": "患者女儿王晓梅，联系电话13800138000",
                "page": 2,
                "identityToken": "forged",
                "sessionId": "forged-session",
            },
        ),
    ]

    for method, path, body in paths:
        response = await client.request(method, path, json=body)
        assert response.status_code == 401, (method, path, response.text)


async def test_identity_token_cannot_be_replayed_by_another_user(env_admin_alice: Any) -> None:
    client, _server, _admin_auth, alice_auth = env_admin_alice
    bob_auth = await create_user(client, _admin_auth, username="admission-bob")
    demo_store.reset()

    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=alice_auth,
        json={"method": "id_card"},
    )
    assert verified.status_code == 200, verified.text
    token = verified.json()["identityToken"]

    submission = await client.post(
        "/api/admission-registration/v1/submissions",
        headers=bob_auth,
        json={
            "identityToken": token,
            "applicationId": "APP-forged",
            "sessionId": "forged-session",
            "reviewRevision": 1,
            "idempotencyKey": "request-123",
            "fields": verified.json()["fields"],
        },
    )
    result = await client.post(
        "/api/admission-registration/v1/submissions/result",
        headers=bob_auth,
        json={"identityToken": token, "idempotencyKey": "request-123"},
    )

    assert submission.status_code == 401
    assert result.status_code == 401


async def test_application_is_required_and_bound_to_the_verified_patient(
    env_admin_alice: Any,
) -> None:
    client, _server, _admin_auth, alice_auth = env_admin_alice
    bob_auth = await create_user(client, _admin_auth, username="admission-app-bob")
    demo_store.reset()
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=alice_auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    fields = {
        **verified.json()["fields"],
        "phone": "13800138000",
        "nativeRegion": [],
        "residentRegion": [],
        "addressDetail": "佳兆业中心",
        "employerName": "东软",
        "employerAddress": "沈阳市",
        "marriage": "未婚",
        "occupation": "职工",
        "emergencyContact": "王小明",
        "relationship": "子女",
    }

    applications = await client.get(
        "/api/admission-registration/v1/applications",
        headers=alice_auth,
        params={"identityToken": token},
    )
    assert applications.status_code == 200, applications.text
    application = applications.json()["items"][0]
    assert application["department"] == "心内科"
    assert application["plannedAdmissionAt"] == "2026-10-22 09:00"

    bypass = await client.post(
        "/api/admission-registration/v1/submissions",
        headers=alice_auth,
        json={
            "identityToken": token,
            "applicationId": application["id"],
            "sessionId": "forged-session",
            "reviewRevision": 1,
            "idempotencyKey": "request-123",
            "fields": fields,
        },
    )
    foreign_select = await client.post(
        "/api/admission-registration/v1/applications/select",
        headers=bob_auth,
        json={"identityToken": token, "applicationId": application["id"]},
    )
    select = await client.post(
        "/api/admission-registration/v1/applications/select",
        headers=alice_auth,
        json={"identityToken": token, "applicationId": application["id"]},
    )
    assert bypass.status_code == 409
    assert foreign_select.status_code == 401
    assert select.status_code == 200, select.text


async def test_selected_application_creates_a_persistent_linked_session(
    env_admin_alice: Any,
) -> None:
    client, _server, _admin_auth, alice_auth = env_admin_alice
    demo_store.reset()
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=alice_auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    application = (
        await client.get(
            "/api/admission-registration/v1/applications",
            headers=alice_auth,
            params={"identityToken": token},
        )
    ).json()["items"][0]
    selected = await client.post(
        "/api/admission-registration/v1/applications/select",
        headers=alice_auth,
        json={"identityToken": token, "applicationId": application["id"]},
    )
    session_id = selected.json()["sessionId"]
    fields = {
        **verified.json()["fields"],
        "phone": "13800138000",
        "nativeRegion": [],
        "residentRegion": [],
        "addressDetail": "佳兆业中心",
        "employerName": "东软",
        "employerAddress": "沈阳市",
        "marriage": "未婚",
        "occupation": "职工",
        "emergencyContact": "王小明",
        "relationship": "子女",
    }
    turn = {
        "identityToken": token,
        "expectedRevision": 0,
        "turnId": "turn-demo-001",
        "previousTurnId": None,
        "utterance": "联系电话是13800138000",
        "response": "已记录联系电话。",
        "action": "voice_turn",
        "fields": {"phone": "13800138000"},
        "pendingProposal": None,
    }
    saved = await client.post(
        f"/api/admission-registration/v1/sessions/{session_id}/turns",
        headers=alice_auth,
        json=turn,
    )
    fetched = await client.get(
        f"/api/admission-registration/v1/sessions/{session_id}",
        headers=alice_auth,
        params={"identityToken": token},
    )

    assert selected.status_code == 200, selected.text
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["lastTurnId"] == "turn-demo-001"
    assert fetched.json()["facts"]["phone"]["value"] == "13800138000"
    assert fetched.json()["turns"][0]["previousTurnId"] is None

    bypass = await client.post(
        "/api/admission-registration/v1/submissions",
        headers=alice_auth,
        json={
            "identityToken": token,
            "applicationId": application["id"],
            "sessionId": session_id,
            "reviewRevision": 1,
            "idempotencyKey": "request-review-123",
            "fields": fields,
        },
    )
    review = await client.post(
        f"/api/admission-registration/v1/sessions/{session_id}/review",
        headers=alice_auth,
        json={"identityToken": token, "expectedRevision": 1, "fields": fields},
    )
    submission = await client.post(
        "/api/admission-registration/v1/submissions",
        headers=alice_auth,
        json={
            "identityToken": token,
            "applicationId": application["id"],
            "sessionId": session_id,
            "reviewRevision": review.json()["reviewRevision"],
            "idempotencyKey": "request-review-123",
            "fields": fields,
        },
    )
    assert bypass.status_code == 409
    assert review.status_code == 200, review.text
    assert submission.status_code == 200, submission.text
    assert submission.json()["status"] == "success"


async def test_ai_candidates_use_active_model_and_accept_only_grounded_phone(
    env: Any, monkeypatch: Any
) -> None:
    client, server, auth = env
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    session_id = await _select_admission_session(client, auth, token)
    await client.post(
        f"/api/admission-registration/v1/sessions/{session_id}/turns",
        headers=auth,
        json={
            "identityToken": token,
            "expectedRevision": 0,
            "turnId": "turn-context-0001",
            "previousTurnId": None,
            "utterance": "我电话是13800138000",
            "response": "已记录联系电话。",
            "action": "voice_turn",
            "fields": {"phone": "13800138000"},
            "pendingProposal": None,
        },
    )
    call_agent = AsyncMock(
        return_value={"messages": [AIMessage(content=json.dumps({"contact_phone": "13800138000"}))]}
    )
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call_agent)
    server.app_runtime.agent_registry.harness_manager.shared_factory = Mock()
    _use_test_admission_model(server, monkeypatch)

    response = await client.post(
        "/api/admission-registration/v1/ai/candidates",
        headers=auth,
        json={
            "text": "联系电话是13800138000",
            "page": 1,
            "identityToken": token,
            "sessionId": session_id,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"fields": {"phone": "13800138000"}}
    request = call_agent.await_args.args[1]
    assert request["model"] == "demo-provider/demo-model"
    assert request["skills"] == []
    assert "admission-patient-info" in request["messages"][0]["content"]
    model_input = json.loads(request["messages"][1]["content"])
    assert model_input["context"]["application"]["department"] == "心内科"
    assert model_input["context"]["facts"]["phone"]["value"] == "13800138000"
    assert model_input["context"]["recent_turns"][0]["utterance"] == "我电话是13800138000"
    assert model_input["current_utterance"] == "联系电话是13800138000"


async def test_ai_candidates_recover_a_labeled_phone_omitted_by_agent(
    env: Any, monkeypatch: Any
) -> None:
    client, server, auth = env
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    session_id = await _select_admission_session(client, auth, token)
    call_agent = AsyncMock(return_value={"messages": [AIMessage(content="{} ")]})
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call_agent)
    server.app_runtime.agent_registry.harness_manager.shared_factory = Mock()
    _use_test_admission_model(server, monkeypatch)

    response = await client.post(
        "/api/admission-registration/v1/ai/candidates",
        headers=auth,
        json={
            "text": "我的电话是13800138000",
            "page": 1,
            "identityToken": token,
            "sessionId": session_id,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"fields": {"phone": "13800138000"}}
    request = call_agent.await_args.args[1]
    assert request["source"] == "admission_demo"
    assert request["skills"] == []


async def test_ai_candidates_split_labeled_regions_from_a_multi_field_utterance(
    env: Any, monkeypatch: Any
) -> None:
    client, server, auth = env
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    session_id = await _select_admission_session(client, auth, token)
    call_agent = AsyncMock(
        return_value={
            "messages": [
                AIMessage(
                    content=json.dumps(
                        {"contact_phone": "13800138000", "address": "辽宁省沈阳市沈河区"}
                    )
                )
            ]
        }
    )
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call_agent)
    server.app_runtime.agent_registry.harness_manager.shared_factory = Mock()
    _use_test_admission_model(server, monkeypatch)

    response = await client.post(
        "/api/admission-registration/v1/ai/candidates",
        headers=auth,
        json={
            "text": (
                "帮我记录一下电话13800138000，并且籍贯是辽宁省沈阳市沈河区，"
                "现住地址也是辽宁省沈阳市沈河区。"
            ),
            "page": 1,
            "identityToken": token,
            "sessionId": session_id,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "fields": {
            "phone": "13800138000",
            "nativeRegion": ["210000", "210100", "210103"],
            "residentRegion": ["210000", "210100", "210103"],
        }
    }


async def test_ai_candidates_reject_unknown_identity_sessions(env: Any) -> None:
    client, server, auth = env
    factory = Mock()
    factory.get.return_value = SimpleNamespace(
        ainvoke=AsyncMock(return_value=SimpleNamespace(content="{}"))
    )
    server.app_runtime.agent_registry.harness_manager.shared_factory = factory
    server.services.settings_repo.set_active_model("demo-provider", "demo-model")

    response = await client.post(
        "/api/admission-registration/v1/ai/candidates",
        headers=auth,
        json={
            "text": "联系电话是13800138000",
            "page": 1,
            "identityToken": "missing-token",
            "sessionId": "missing-session",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "身份核验已失效，请重新核验"


async def test_ai_model_failure_is_reported_as_unavailable_not_empty_candidates(env: Any) -> None:
    client, server, auth = env
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    session_id = await _select_admission_session(client, auth, token)
    fake_model = SimpleNamespace(
        ainvoke=AsyncMock(side_effect=TimeoutError("model timeout")),
        get_num_tokens_from_messages=Mock(return_value=50),
    )
    factory = Mock()
    factory.get.return_value = fake_model
    server.app_runtime.agent_registry.harness_manager.shared_factory = factory
    server.services.settings_repo.set_active_model("demo-provider", "demo-model")

    response = await client.post(
        "/api/admission-registration/v1/ai/candidates",
        headers=auth,
        json={
            "text": "联系电话13800138000",
            "page": 1,
            "identityToken": token,
            "sessionId": session_id,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "AI_MODEL_UNAVAILABLE"


async def test_ai_rate_limit_is_reported_explicitly_and_preserves_transcript(
    env: Any, monkeypatch: Any
) -> None:
    client, server, auth = env
    verified = await client.post(
        "/api/admission-registration/v1/identity/verify",
        headers=auth,
        json={"method": "id_card"},
    )
    token = verified.json()["identityToken"]
    session_id = await _select_admission_session(client, auth, token)

    class ProviderRateLimitError(Exception):
        status_code = 429

    call_agent = AsyncMock(side_effect=ProviderRateLimitError("rate limit"))
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())
    monkeypatch.setattr(server.app_runtime.agent_registry, "call", call_agent)
    server.app_runtime.agent_registry.harness_manager.shared_factory = Mock()
    _use_test_admission_model(server, monkeypatch)

    response = await client.post(
        "/api/admission-registration/v1/ai/candidates",
        headers=auth,
        json={
            "text": "联系电话13800138000",
            "page": 1,
            "identityToken": token,
            "sessionId": session_id,
        },
    )

    assert response.status_code == 429
    assert response.json()["detail"] == {
        "code": "AI_RATE_LIMITED",
        "message": "AI 服务请求过于频繁，请稍后重试；转写内容已保留。",
    }
