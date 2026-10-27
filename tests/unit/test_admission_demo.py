from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from langchain_core.messages import AIMessage

from octop.infra.admission_demo import (
    AdmissionContextTooLongError,
    _classify_confirmation_output,
    _classify_intent_output,
    _ensure_admission_agent,
    _extract_fields_output,
    _model_display_name,
    _parse_json_object,
    classify_active_admission_intent,
    classify_active_candidate_confirmation,
    extract_active_registration_fields,
    extract_active_registration_fields_with_model,
    provision_admission_agent,
)


def test_parses_json_fences_and_embedded_objects() -> None:
    assert _parse_json_object('```json\n{"intent":"greeting"}\n```') == {"intent": "greeting"}
    assert _parse_json_object('结果：{"decision":"keep_current"}。') == {"decision": "keep_current"}
    assert _parse_json_object("不是 JSON") is None


def test_admission_model_timing_tracks_model_latency_and_usage(monkeypatch) -> None:
    from octop.infra.admission_demo import _AdmissionModelTiming

    timing = _AdmissionModelTiming()
    ticks = iter((10.0, 11.5))
    monkeypatch.setattr("octop.infra.admission_demo.perf_counter", lambda: next(ticks))
    response = SimpleNamespace(
        generations=[
            [
                SimpleNamespace(
                    message=AIMessage(
                        content="{}",
                        usage_metadata={"input_tokens": 42, "output_tokens": 7, "total_tokens": 49},
                    )
                )
            ]
        ]
    )

    timing.on_chat_model_start(
        {},
        [
            [
                SimpleNamespace(type="system", content="x" * 5),
                SimpleNamespace(type="human", content="y"),
            ]
        ],
        run_id="model-run",
    )
    timing.on_llm_end(response, run_id="model-run")

    assert timing.elapsed_ms == 1500
    assert timing.calls == 1
    assert timing.input_tokens == 42
    assert timing.output_tokens == 7
    assert (timing.message_count, timing.system_chars, timing.user_chars) == (2, 5, 1)


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (
            '{"intent":"begin_admission","reply":"ignored"}',
            (
                "begin_admission",
                "您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。",
            ),
        ),
        (
            '{"intent":"answer_question","reply":"先核验，再填写。"}',
            ("answer_question", "先核验，再填写。"),
        ),
        (
            '{"intent":"answer_question","reply":""}',
            ("unknown", "我没能确定您的需求，请说说您想办理什么。"),
        ),
        (
            '{"intent":"unsupported","reply":""}',
            ("unsupported", "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。"),
        ),
        (
            '{"intent":"begin_admission","reply":"","submit":true}',
            ("unknown", "我没能确定您的需求，请说说您想办理什么。"),
        ),
        ("invalid", ("unknown", "我没能确定您的需求，请说说您想办理什么。")),
    ],
)
def test_intent_output_is_strict_and_uses_fixed_responses(content: str, expected: tuple) -> None:
    assert _classify_intent_output(content) == expected


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ('{"decision":"accept_candidate"}', "accept_candidate"),
        ('{"decision":"keep_current"}', "keep_current"),
        ('{"decision":"unknown"}', "unknown"),
        ('{"decision":"accept_candidate","submit":true}', "unknown"),
        ("not JSON", "unknown"),
    ],
)
def test_confirmation_output_accepts_only_allowed_decisions(content: str, expected: str) -> None:
    assert _classify_confirmation_output(content) == expected


def test_extract_output_enforces_page_allowlist_and_value_limits() -> None:
    output = _extract_fields_output(
        json.dumps(
            {
                "contact_phone": " 13800138000 ",
                "occupation": "学生",
                "unexpected": "value",
                "address": "甲" * 201,
                "employer_name": 3,
            }
        ),
        page=1,
    )
    assert output == {"contact_phone": "13800138000"}
    assert _extract_fields_output(
        json.dumps({"contact_phone": "13800138000", "occupation": "学生"}), page=0
    ) == {"contact_phone": "13800138000", "occupation": "学生"}
    assert _extract_fields_output("not JSON", page=2) == {}


@pytest.mark.asyncio
async def test_active_intent_calls_only_router_skill(monkeypatch) -> None:
    call = AsyncMock(return_value='{"intent":"unsupported","reply":""}')
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill", call)

    result = await classify_active_admission_intent(SimpleNamespace(), "帮我打印报告")

    assert result == ("unsupported", "抱歉，本演示仅支持模拟入院登记，暂不支持这项服务。")
    call.assert_awaited_once_with(
        SimpleNamespace(),
        skill="admission-router",
        payload={"text": "帮我打印报告"},
        user_id=None,
    )


@pytest.mark.asyncio
async def test_active_intent_prefers_exact_route_without_calling_models(monkeypatch) -> None:
    call = AsyncMock()
    vector = AsyncMock()
    decider = AsyncMock()
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill", call)
    monkeypatch.setattr("octop.infra.admission_demo._admission_intent_vector_candidates", vector)
    monkeypatch.setattr("octop.infra.admission_demo._classify_with_groq_decider", decider)

    result = await classify_active_admission_intent(SimpleNamespace(), "住院登记！")

    assert result[0] == "begin_admission"
    call.assert_not_awaited()
    vector.assert_not_awaited()
    decider.assert_not_awaited()


@pytest.mark.asyncio
async def test_active_intent_uses_vectors_and_groq_then_bound_model_for_answers(
    monkeypatch,
) -> None:
    candidates = [{"intent": "answer_question", "similarity": 0.81}]
    vector = AsyncMock(return_value=candidates)
    decider = AsyncMock(return_value="answer_question")
    primary = AsyncMock(return_value='{"intent":"answer_question","reply":"先确认身份。"}')
    monkeypatch.setattr("octop.infra.admission_demo._admission_intent_vector_candidates", vector)
    monkeypatch.setattr("octop.infra.admission_demo._classify_with_groq_decider", decider)
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill", primary)

    result = await classify_active_admission_intent(SimpleNamespace(), "入院流程是什么")

    assert result == ("answer_question", "先确认身份。")
    primary.assert_awaited_once()
    assert primary.await_args.kwargs["payload"]["intent_hint"] == "answer_question"
    assert primary.await_args.kwargs["payload"]["vector_candidates"] == candidates


@pytest.mark.asyncio
async def test_active_intent_falls_back_to_bound_model_when_groq_is_unavailable(
    monkeypatch,
) -> None:
    vector = AsyncMock(return_value=[])
    decider = AsyncMock(return_value=None)
    primary = AsyncMock(return_value='{"intent":"unsupported","reply":""}')
    monkeypatch.setattr("octop.infra.admission_demo._admission_intent_vector_candidates", vector)
    monkeypatch.setattr("octop.infra.admission_demo._classify_with_groq_decider", decider)
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill", primary)

    result = await classify_active_admission_intent(SimpleNamespace(), "查检查报告")

    assert result[0] == "unsupported"
    assert primary.await_args.kwargs["payload"] == {"text": "查检查报告"}


@pytest.mark.asyncio
async def test_local_intent_vectors_rank_the_closest_example(monkeypatch) -> None:
    from octop.infra.admission_demo import _admission_intent_vector_candidates
    from octop.infra.agents.providers import onnx_service

    settings_repo = SimpleNamespace(get=Mock(return_value=None))
    server = SimpleNamespace(services=SimpleNamespace(settings_repo=settings_repo))
    vectors = [[1.0, 0.0]] + [[0.0, 1.0]] * 9 + [[1.0, 0.0]] * 3 + [[0.0, 1.0]] * 3
    monkeypatch.setattr(onnx_service, "embedding_prerequisites_ok", lambda _get: True)
    monkeypatch.setattr(onnx_service, "load_config", lambda _get: SimpleNamespace(model="local"))
    embed = Mock(return_value=vectors)
    monkeypatch.setattr(onnx_service, "embed_texts", embed)

    candidates = await _admission_intent_vector_candidates(server, "我要查报告")

    assert candidates[0] == {"intent": "unsupported", "similarity": 1.0}
    assert len(candidates) == 2
    embed.assert_called_once()


@pytest.mark.asyncio
async def test_groq_decider_masks_pii_and_rejects_low_confidence(monkeypatch) -> None:
    from octop.infra.admission_demo import _classify_with_groq_decider

    provider = SimpleNamespace(
        enabled=True,
        base_url="https://api.groq.com/openai/v1",
        api_key="test-key",
        get_models=lambda: [{"id": "qwen/qwen3.8-27b", "enabled": True}],
    )
    server = SimpleNamespace(
        services=SimpleNamespace(provider_repo=SimpleNamespace(get_by_name=lambda _name: provider))
    )
    monkeypatch.setattr("octop.infra.admission_demo._mask_admission_pii", lambda _text: "已脱敏")
    request = AsyncMock(return_value={"intent": "begin_admission", "confidence": 0.89})
    monkeypatch.setattr("octop.infra.admission_demo._post_groq_decision", request)

    result = await _classify_with_groq_decider(server, "我是张三，要入院", [])

    assert result is None
    assert request.await_args.args[2]["utterance"] == "已脱敏"


@pytest.mark.asyncio
async def test_groq_request_uses_structured_decision_schema(monkeypatch) -> None:
    from octop.infra import admission_demo

    call: dict[str, object] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"choices": [{"message": {"content": '{"intent":"greeting","confidence":0.9}'}}]}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, headers, json):
            call.update(url=url, headers=headers, body=json)
            return FakeResponse()

    monkeypatch.setattr(admission_demo.httpx, "AsyncClient", lambda **_kwargs: FakeClient())

    result = await admission_demo._post_groq_decision(
        "https://api.groq.com/openai/v1",
        "test-key",
        {"utterance": "你好", "vector_candidates": []},
    )

    assert result == {"intent": "greeting", "confidence": 0.9}
    assert call["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert call["body"]["model"] == "qwen/qwen3.8-27b"
    assert call["body"]["response_format"]["json_schema"]["strict"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["住院登记", "入院登记。", " 住院登记！ "])
async def test_bare_admission_name_starts_the_demo_without_model(text: str, monkeypatch) -> None:
    call = AsyncMock()
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill", call)

    result = await classify_active_admission_intent(SimpleNamespace(), text)

    assert result == (
        "begin_admission",
        "您好，我可以协助您办理入院登记。请先通过身份证、社保卡或电子医保凭证确认身份。",
    )
    call.assert_not_awaited()


@pytest.mark.asyncio
async def test_candidate_confirmation_uses_patient_info_skill(monkeypatch) -> None:
    call = AsyncMock(return_value='{"decision":"keep_current"}')
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill", call)

    result = await classify_active_candidate_confirmation(
        SimpleNamespace(), "保留原来的", "address", "旧地址", "新地址"
    )

    assert result == "keep_current"
    call.assert_awaited_once_with(
        SimpleNamespace(),
        skill="admission-patient-info",
        payload={
            "mode": "candidate_confirmation",
            "utterance": "保留原来的",
            "field_key": "address",
            "current_value": "旧地址",
            "candidate_value": "新地址",
        },
        user_id=None,
    )


@pytest.mark.asyncio
async def test_extraction_uses_patient_info_skill_and_page_scope(monkeypatch) -> None:
    server = SimpleNamespace()
    call = AsyncMock(return_value=('{"occupation":"学生","address":"忽略"}', "Qwen Display"))
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill_with_model", call)

    result, model_name = await extract_active_registration_fields_with_model(
        server, "我在上学", page=2
    )

    assert result == {"occupation": "学生"}
    assert model_name == "Qwen Display"
    call.assert_awaited_once_with(
        server,
        skill="admission-patient-info",
        payload={"mode": "extract", "page": 2, "current_utterance": "我在上学"},
        user_id=None,
    )


def test_model_display_name_prefers_configured_name_and_falls_back_to_model_id() -> None:
    provider = SimpleNamespace(
        name="example",
        get_models=lambda: [{"id": "qwen-3", "name": "Qwen Display"}, {"id": "gpt-4o"}],
    )
    providers = SimpleNamespace(iter_usable_rows=lambda: [provider])

    assert _model_display_name(providers, "example/qwen-3") == "Qwen Display"
    assert _model_display_name(providers, "example/gpt-4o") == "gpt-4o"
    assert _model_display_name(providers, "missing/model-x") == "model-x"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "text,context",
    [
        ("口述", {"recent_turns": ["甲" * 20000]}),
        ("甲" * 2000, None),
    ],
)
async def test_rejects_oversized_model_input_before_calling_agent(
    monkeypatch, text, context
) -> None:
    call = AsyncMock()
    monkeypatch.setattr("octop.infra.admission_demo._call_admission_skill_with_model", call)

    with pytest.raises(AdmissionContextTooLongError):
        await extract_active_registration_fields(SimpleNamespace(), text, context=context)

    call.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,enabled", [("enabled", True), ("disabled", False), ("auto", None)])
async def test_agent_call_uses_bound_model_and_selected_thinking(
    monkeypatch, mode, enabled
) -> None:
    from octop.infra.admission_demo import _call_admission_skill
    from octop.infra.agents.providers.reasoning import reasoning_capability

    registry = SimpleNamespace(
        call=AsyncMock(return_value={"messages": [AIMessage(content="{}")]}),
        sync_tools_disabled=Mock(),
        get_row=lambda _id: SimpleNamespace(default_model="ModelScope/Qwen/Qwen3.5-27B"),
        get_config=lambda _id: {"reasoning": {"mode": mode}},
        providers=SimpleNamespace(
            is_model_ref_usable=lambda _ref: True,
            get_model_reasoning_capability=lambda _ref: reasoning_capability(
                {"id": "Qwen/Qwen3.5-27B"}, base_url="https://api-inference.modelscope.cn/v1"
            ),
        ),
    )
    server = SimpleNamespace(
        services=SimpleNamespace(
            settings_repo=SimpleNamespace(
                get_active_model=lambda: ("DifferentProvider", "different-model")
            )
        ),
        app_runtime=SimpleNamespace(
            agent_registry=registry,
        ),
    )
    server.app_runtime.agent_registry.harness_manager = SimpleNamespace(shared_factory=object())
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())

    assert (
        await _call_admission_skill(server, skill="admission-router", payload={"text": "你好"})
        == "{}"
    )
    request = registry.call.await_args.args[1]
    assert request["skills"] == []
    assert request["mcp_servers"] == []
    disabled = registry.sync_tools_disabled.call_args.args[1]
    assert {"write_todos", "read_file", "ls", "delete"} <= disabled
    assert request["messages"][0]["role"] == "system"
    assert "admission-router" in request["messages"][0]["content"]
    assert request["user"] is None
    assert request["model"] == "ModelScope/Qwen/Qwen3.5-27B"
    assert request["configurable"]["model_settings"] == {"max_tokens": 256}
    if enabled is None:
        assert request["configurable"] == {"model_settings": {"max_tokens": 256}}
    else:
        assert request["configurable"]["octop_reasoning_overrides"]["extra_body"] == {
            "chat_template_kwargs": {"enable_thinking": enabled}
        }
    assert json.loads(request["messages"][1]["content"]) == {"text": "你好"}


@pytest.mark.asyncio
async def test_candidate_confirmation_uses_small_completion_budget(monkeypatch) -> None:
    from octop.infra.admission_demo import _call_admission_skill

    registry = SimpleNamespace(
        call=AsyncMock(return_value={"messages": [AIMessage(content='{"decision":"unknown"}')]}),
        sync_tools_disabled=Mock(),
        get_row=lambda _id: SimpleNamespace(default_model="provider/model"),
        get_config=lambda _id: {},
        providers=SimpleNamespace(
            is_model_ref_usable=lambda _ref: True,
            get_model_reasoning_capability=lambda _ref: None,
        ),
    )
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())

    await _call_admission_skill(
        SimpleNamespace(app_runtime=SimpleNamespace(agent_registry=registry)),
        skill="admission-patient-info",
        payload={"mode": "candidate_confirmation", "utterance": "我再想想"},
    )

    request = registry.call.await_args.args[1]
    assert request["configurable"]["model_settings"] == {"max_tokens": 64}
    assert len(request["callbacks"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "page,attached,utterance,expected",
    [
        (1, True, "现住址在朝阳区", ["china_address_resolver"]),
        (1, True, "联系电话是13800138000", []),
        (2, True, "现住址在朝阳区", []),
        (1, False, "现住址在朝阳区", []),
    ],
)
async def test_address_mcp_is_only_requested_for_address_extraction(
    monkeypatch, page, attached, utterance, expected
) -> None:
    from octop.infra.admission_demo import _call_admission_skill

    registry = SimpleNamespace(
        call=AsyncMock(return_value={"messages": [AIMessage(content="{}")]}),
        sync_tools_disabled=Mock(),
        default_mcp_servers=Mock(return_value=["china_address_resolver"] if attached else []),
        validate_mcp_servers=Mock(return_value=["china_address_resolver"]),
        get_row=lambda _id: SimpleNamespace(default_model="provider/model"),
        get_config=lambda _id: {},
        providers=SimpleNamespace(
            is_model_ref_usable=lambda _ref: True,
            get_model_reasoning_capability=lambda _ref: None,
        ),
    )
    server = SimpleNamespace(
        app_runtime=SimpleNamespace(agent_registry=registry),
    )
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())

    await _call_admission_skill(
        server,
        skill="admission-patient-info",
        payload={"mode": "extract", "page": page, "current_utterance": utterance},
        user_id=1,
    )

    assert registry.call.await_args.args[1]["mcp_servers"] == expected
    if expected:
        registry.validate_mcp_servers.assert_called_once_with(1, ["china_address_resolver"])
    else:
        registry.validate_mcp_servers.assert_not_called()


@pytest.mark.asyncio
async def test_address_mcp_load_failure_retries_without_mcp(monkeypatch) -> None:
    from octop.infra.admission_demo import _call_admission_skill
    from octop.infra.errors import ErrorCode, OctopError

    registry = SimpleNamespace(
        call=AsyncMock(
            side_effect=[
                OctopError(ErrorCode.CONNECTOR_MCP_LOAD_FAILED, "MCP unavailable"),
                {"messages": [AIMessage(content="{}")]},
            ]
        ),
        sync_tools_disabled=Mock(),
        default_mcp_servers=Mock(return_value=["china_address_resolver"]),
        validate_mcp_servers=Mock(return_value=["china_address_resolver"]),
        get_row=lambda _id: SimpleNamespace(default_model="provider/model"),
        get_config=lambda _id: {},
        providers=SimpleNamespace(
            is_model_ref_usable=lambda _ref: True,
            get_model_reasoning_capability=lambda _ref: None,
        ),
    )
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())

    assert (
        await _call_admission_skill(
            SimpleNamespace(app_runtime=SimpleNamespace(agent_registry=registry)),
            skill="admission-patient-info",
            payload={"mode": "extract", "page": 1, "current_utterance": "现住址在朝阳区"},
            user_id=1,
        )
        == "{}"
    )
    first, retry = (call.args[1] for call in registry.call.await_args_list)
    assert first["mcp_servers"] == ["china_address_resolver"]
    assert retry["mcp_servers"] == []
    assert first["messages"] == retry["messages"]


@pytest.mark.asyncio
async def test_unavailable_bound_model_does_not_fall_back_to_global_model(monkeypatch) -> None:
    from octop.infra.admission_demo import AdmissionModelUnavailableError, _call_admission_skill

    registry = SimpleNamespace(
        get_row=lambda _id: SimpleNamespace(default_model="deleted/model"),
        get_config=lambda _id: {},
        providers=SimpleNamespace(is_model_ref_usable=lambda _ref: False),
        call=AsyncMock(),
    )
    monkeypatch.setattr("octop.infra.admission_demo._ensure_admission_agent", AsyncMock())
    with pytest.raises(AdmissionModelUnavailableError, match="bound admission model"):
        await _call_admission_skill(
            SimpleNamespace(app_runtime=SimpleNamespace(agent_registry=registry)),
            skill="admission-router",
            payload={"text": "你好"},
        )
    registry.call.assert_not_awaited()


@pytest.mark.asyncio
async def test_creates_visible_expert_with_privacy_and_tool_limits() -> None:
    row = SimpleNamespace(
        user_id=None,
        is_shared=1,
        name="入院登记助手",
        icon_url="/experts/avatars/admission-assistant.png",
    )
    current_row = None

    async def create(spec, **_kwargs):
        nonlocal current_row
        current_row = row
        return row

    registry = SimpleNamespace(
        get_row=lambda _agent_id: current_row,
        get_config=lambda _agent_id: {},
        get_agent=lambda _agent_id: "live-agent",
        create=AsyncMock(side_effect=create),
        default_mcp_servers=lambda _agent_id: ["china_address_resolver"],
        persist_mcp_servers=Mock(),
    )
    server = SimpleNamespace(app_runtime=SimpleNamespace(agent_registry=registry))

    assert await _ensure_admission_agent(server) == "live-agent"
    registry.create.assert_awaited_once()
    spec = registry.create.await_args.args[0]
    assert spec.name == "入院登记助手"
    assert spec.kind == "expert"
    assert spec.user_id is None
    assert spec.is_shared is True
    assert spec.icon_url == "/experts/avatars/admission-assistant.png"
    assert spec.mcp_servers == ["china_address_resolver"]
    registry.persist_mcp_servers.assert_not_called()
    assert spec.config["admission_demo_agent"] is True
    assert spec.config["observability"]["langfuse"] is False
    assert spec.config["checkpointer"] is False
    assert spec.config["session_log_enabled"] is False
    assert spec.config["memory"]["memory_enabled"] is False
    assert spec.config["memory"]["memory_jsonl_enabled"] is False
    initializer = registry.create.await_args.kwargs["workspace_initializer"]

    class Workspace:
        directories: list[str] = []
        files: dict[str, str] = {}

        async def amkdir(self, path: str) -> None:
            self.directories.append(path)

        async def awrite_text(self, path: str, content: str) -> None:
            self.files[path] = content

    workspace = Workspace()
    await initializer(row, workspace)
    assert set(workspace.files) == {
        "skills/admission-router/SKILL.md",
        "skills/admission-patient-info/SKILL.md",
    }
    assert "begin_admission" in workspace.files["skills/admission-router/SKILL.md"]
    assert "candidate_confirmation" in workspace.files["skills/admission-patient-info/SKILL.md"]


@pytest.mark.asyncio
@pytest.mark.parametrize("icon_url", [None, "/custom-avatar.png"])
async def test_backfills_admission_avatar_without_overwriting_custom_avatar(icon_url) -> None:
    row = SimpleNamespace(user_id=None, is_shared=1, icon_url=icon_url)
    registry = SimpleNamespace(
        get_row=lambda _agent_id: row,
        get_config=lambda _agent_id: {"admission_demo_agent": True},
        default_mcp_servers=lambda _agent_id: [],
        persist_mcp_servers=Mock(),
        set_icon_url=Mock(return_value=row),
    )
    server = SimpleNamespace(app_runtime=SimpleNamespace(agent_registry=registry))

    await provision_admission_agent(server)

    registry.persist_mcp_servers.assert_called_once_with(
        "octop-admission-demo", ["china_address_resolver"]
    )
    if icon_url is None:
        registry.set_icon_url.assert_called_once_with(
            "octop-admission-demo", "/experts/avatars/admission-assistant.png"
        )
    else:
        registry.set_icon_url.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("bound", [None, "pinned/model"])
async def test_pins_initial_active_model_without_changing_an_existing_binding(bound) -> None:
    row = SimpleNamespace(user_id=None, is_shared=1, icon_url="/avatar.png", default_model=bound)
    registry = SimpleNamespace(
        get_row=lambda _id: row,
        get_config=lambda _id: {
            "admission_demo_agent": True,
            "max_iters": 32,
            "max_input_length": 20000,
            "temperature": 0.2,
            "max_tokens": 512,
            "model_retry_enabled": False,
            "reasoning": {"mode": "disabled"},
        },
        default_mcp_servers=lambda _id: ["china_address_resolver"],
        persist_mcp_servers=Mock(),
        update=AsyncMock(return_value=row),
    )
    server = SimpleNamespace(
        app_runtime=SimpleNamespace(agent_registry=registry),
        services=SimpleNamespace(
            settings_repo=SimpleNamespace(get_active_model=lambda: ("active", "model"))
        ),
    )
    await provision_admission_agent(server)
    if bound is None:
        registry.update.assert_awaited_once_with(
            "octop-admission-demo", default_model="active/model"
        )
    else:
        registry.update.assert_not_awaited()


@pytest.mark.asyncio
async def test_upgrades_existing_admission_graph_budget_without_changing_model() -> None:
    row = SimpleNamespace(
        user_id=None, is_shared=1, icon_url="/avatar.png", default_model="pinned/model"
    )
    config = {
        "admission_demo_agent": True,
        "max_iters": 12,
        "max_input_length": 20000,
        "temperature": 0.2,
        "max_tokens": 512,
        "model_retry_enabled": False,
        "reasoning": {"mode": "disabled"},
        "checkpointer": False,
    }
    registry = SimpleNamespace(
        get_row=lambda _id: row,
        get_config=lambda _id: config,
        default_mcp_servers=lambda _id: ["china_address_resolver"],
        update=AsyncMock(return_value=row),
    )
    server = SimpleNamespace(app_runtime=SimpleNamespace(agent_registry=registry))

    await provision_admission_agent(server)

    registry.update.assert_awaited_once()
    updates = registry.update.await_args.kwargs
    assert updates["max_iters"] == 32
    assert "model_retry_enabled" not in updates
    assert json.loads(updates["config_json"]) == {
        **config,
        "max_iters": 32,
        "model_retry_enabled": False,
    }
    assert "default_model" not in updates
