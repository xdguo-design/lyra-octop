from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from octop.infra.presentations.chat import CHAT_SYSTEM, deck_snapshot, parse_decision
from octop.infra.presentations.models import CreateDeck, Slide
from octop.infra.presentations.service import PresentationService

SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#ffffff"/><text x="80" y="100" font-size="40">Hello</text></svg>'


class MemorySettings:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str) -> None:
        self.values[key] = value

    def delete(self, key: str) -> None:
        self.values.pop(key, None)

    def list_prefix(self, prefix: str) -> dict[str, str]:
        return {key: value for key, value in self.values.items() if key.startswith(prefix)}

    def compare_and_set(self, key: str, expected: str, value: str) -> bool:
        if self.values.get(key) != expected:
            return False
        self.values[key] = value
        return True


@pytest.fixture
def service() -> PresentationService:
    return PresentationService(
        SimpleNamespace(
            services=SimpleNamespace(
                settings_repo=MemorySettings(),
                user_policy_repo=SimpleNamespace(get=Mock(return_value=None)),
                usage_repo=SimpleNamespace(
                    record=Mock(return_value=1), total_tokens_for_user=Mock(return_value=0)
                ),
            )
        )
    )


def decision_json(action: str, args: dict[str, object] | None = None) -> str:
    return json.dumps({"action": action, "args": args or {}, "reply": "好的"}, ensure_ascii=False)


def controller(
    service: PresentationService, content_by_prompt: dict[str, str]
) -> tuple[AsyncMock, Mock]:
    """Fake model calls that answer by recognizing the system prompt.

    Decision calls stream through ``_invoke_stream`` in small chunks so the
    reply extraction is exercised across chunk boundaries; pipeline calls
    (outline / slide rendering) go through ``_invoke``.
    """

    async def invoke(agent_id: str, user_id: int, system: str, payload: dict, **_: object) -> str:
        for marker, content in content_by_prompt.items():
            if marker in system:
                return content
        raise AssertionError("unexpected system prompt")

    async def chunked(content: str):
        for index in range(0, len(content), 9):
            yield content[index : index + 9]

    def stream(agent_id: str, user_id: int, system: str, payload: dict, **_: object):
        for marker, content in content_by_prompt.items():
            if marker in system:
                return chunked(content)
        raise AssertionError("unexpected system prompt")

    invoke_mock = AsyncMock(side_effect=invoke)
    stream_mock = Mock(side_effect=stream)
    service._invoke = invoke_mock  # type: ignore[method-assign]
    service._invoke_stream = stream_mock  # type: ignore[method-assign]
    return invoke_mock, stream_mock


async def wait_idle(service: PresentationService, deck_id: str) -> object:
    for _ in range(200):
        await asyncio.sleep(0.01)
        deck = await service.get_deck(7, "agent-a", deck_id)
        if deck.status not in {"outline", "generating", "revising", "exporting"}:
            return deck
    raise AssertionError("job did not settle")


def test_parse_decision_accepts_plain_and_fenced_json() -> None:
    plain = parse_decision('{"action": "revise", "args": {"page": 2}, "reply": "在改"}')
    assert (plain.action, plain.args, plain.reply) == ("revise", {"page": 2}, "在改")
    fenced = parse_decision('```json\n{"action": "none", "args": {}, "reply": "先聊"}\n```')
    assert fenced.action == "none" and fenced.reply == "先聊"


def test_parse_decision_degrades_unusable_output() -> None:
    broken = parse_decision("这不是 JSON，就当纯回复")
    assert broken.action == "none" and broken.reply.startswith("这不是 JSON")
    unknown = parse_decision('{"action": "detonate", "args": {}, "reply": "忽略动作"}')
    assert unknown.action == "none" and unknown.reply == "忽略动作"
    missing_reply = parse_decision('{"action": "revise", "args": {}}')
    assert missing_reply.action == "none" and missing_reply.reply


def test_deck_snapshot_is_bounded_and_svg_free() -> None:
    deck_obj = SimpleNamespace(
        title="T",
        brief="x" * 5000,
        audience="A",
        style="paper",
        page_count=1,
        status="idle",
        export_path=None,
        slides=[SimpleNamespace(title="S", svg=SVG)],
    )
    snapshot = deck_snapshot(deck_obj)  # type: ignore[arg-type]
    assert len(snapshot["brief"]) == 1200
    assert snapshot["slides"] == [{"page": 1, "title": "S", "has_art": True}]


@pytest.mark.asyncio
async def test_chat_busy_replies_without_model_call(service: PresentationService) -> None:
    deck = await service.create_deck(7, "agent-a", CreateDeck(title="Plan"))
    deck.status = "generating"
    await service._persist(deck)
    # A live job entry keeps _recover from resetting the busy state.
    service._jobs[service._key(7, "agent-a", deck.deck_id)] = asyncio.Future()
    try:
        _invoke, stream = controller(service, {})
        outcome = await service.chat(7, "agent-a", deck.deck_id, "再加一页", locale="en")
        assert outcome["action"] == "none"
        assert outcome["reply"].startswith("A presentation task is still running")
        stream.assert_not_called()
        log = await service.chat_log(7, "agent-a", deck.deck_id)
        assert [turn.role for turn in log.messages] == ["user", "assistant"]
    finally:
        service._jobs.clear()


@pytest.mark.asyncio
async def test_chat_create_builds_full_deck_end_to_end(service: PresentationService) -> None:
    outline = json.dumps(
        {
            "slides": [
                {"title": "问题", "body": "现状", "notes": ""},
                {"title": "方案", "body": "做法", "notes": ""},
            ]
        }
    )
    invoke, _stream = controller(
        service,
        {
            CHAT_SYSTEM: decision_json(
                "create",
                {"title": "提案", "brief": "介绍", "page_count": 2, "style": "dark"},
            ),
            "Plan an accurate presentation outline": outline,
            "You author one PowerPoint-compatible SVG slide": SVG,
        },
    )
    outcome = await service.chat(7, "agent-a", None, "做一份2页的深色提案", locale="zh")
    assert outcome["action"] == "create"
    deck = outcome["deck"]
    assert deck is not None and deck.title == "提案" and deck.style == "dark"
    final = await wait_idle(service, deck.deck_id)
    assert final.status == "idle" and len(final.slides) == 2
    assert all(slide.svg == SVG for slide in final.slides)
    assert invoke.await_count == 3  # outline + 2 slides; the decision streamed
    log = await service.chat_log(7, "agent-a", deck.deck_id)
    assert [turn.role for turn in log.messages] == ["user", "assistant"]
    assert log.messages[1].action == "create"
    await service.close()


@pytest.mark.asyncio
async def test_chat_revise_maps_page_number_to_slide_id(service: PresentationService) -> None:
    deck = await service.create_deck(7, "agent-a", CreateDeck(title="Plan"))
    deck.slides = [
        Slide(slide_id="first", title="First", body="Text", svg=SVG),
        Slide(slide_id="second", title="Second", body="Text", svg=SVG),
    ]
    await service._persist(deck)
    controller(
        service,
        {CHAT_SYSTEM: decision_json("revise", {"page": 2, "instruction": "改成左右对比"})},
    )
    outcome = await service.chat(7, "agent-a", deck.deck_id, "第2页改成左右对比")
    assert outcome["action"] == "revise"
    assert outcome["deck"] is not None and outcome["deck"].status == "revising"
    await service.close()


@pytest.mark.asyncio
async def test_chat_update_and_add_and_delete_slides_without_jobs(
    service: PresentationService,
) -> None:
    deck = await service.create_deck(7, "agent-a", CreateDeck(title="Plan"))
    deck.slides = [Slide(slide_id="first", title="First", body="Text", svg=SVG)]
    await service._persist(deck)

    controller(service, {CHAT_SYSTEM: decision_json("update", {"style": "dark"})})
    outcome = await service.chat(7, "agent-a", deck.deck_id, "换成深色风格")
    updated = outcome["deck"]
    assert updated is not None and updated.style == "dark" and updated.status == "idle"
    assert updated.slides[0].svg is None  # style change invalidates artwork

    controller(
        service,
        {CHAT_SYSTEM: decision_json("add_slides", {"slides": [{"title": "New", "body": "More"}]})},
    )
    outcome = await service.chat(7, "agent-a", deck.deck_id, "末尾加一页 New")
    grown = outcome["deck"]
    assert grown is not None and [s.title for s in grown.slides] == ["First", "New"]
    assert grown.slides[0].svg is None  # style change above already invalidated artwork

    controller(service, {CHAT_SYSTEM: decision_json("delete_slide", {"page": 1})})
    outcome = await service.chat(7, "agent-a", deck.deck_id, "删掉第1页")
    shrunk = outcome["deck"]
    assert shrunk is not None and [s.title for s in shrunk.slides] == ["New"]


@pytest.mark.asyncio
async def test_chat_plain_reply_without_deck_persists_draft_transcript(
    service: PresentationService,
) -> None:
    controller(service, {CHAT_SYSTEM: decision_json("none")})
    outcome = await service.chat(7, "agent-a", None, "你能做什么？")
    assert outcome["action"] == "none" and outcome["deck"] is None
    log = await service.chat_log(7, "agent-a", None)
    assert [turn.text for turn in log.messages] == ["你能做什么？", "好的"]


@pytest.mark.asyncio
async def test_chat_moves_draft_transcript_into_created_deck(service: PresentationService) -> None:
    controller(service, {CHAT_SYSTEM: decision_json("none")})
    await service.chat(7, "agent-a", None, "我想做一份项目提案")
    controller(
        service,
        {
            CHAT_SYSTEM: decision_json(
                "create", {"title": "项目提案", "brief": "项目内容", "build": False}
            )
        },
    )

    outcome = await service.chat(7, "agent-a", None, "面向管理团队，8页")
    deck = outcome["deck"]
    assert deck is not None
    log = await service.chat_log(7, "agent-a", deck.deck_id)
    assert [turn.text for turn in log.messages] == [
        "我想做一份项目提案",
        "好的",
        "面向管理团队，8页",
        "好的",
    ]
    assert (await service.chat_log(7, "agent-a", None)).messages == []


@pytest.mark.asyncio
async def test_chat_invalid_args_raises_localized_error(service: PresentationService) -> None:
    deck = await service.create_deck(7, "agent-a", CreateDeck(title="Plan"))
    deck.slides = [Slide(slide_id="first", title="First", body="Text")]
    await service._persist(deck)
    controller(service, {CHAT_SYSTEM: decision_json("revise", {"page": 9, "instruction": "x"})})
    with pytest.raises(Exception) as denied:
        await service.chat(7, "agent-a", deck.deck_id, "改第9页")
    assert denied.value.status == 400  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_chat_transcript_keeps_bounded_history(service: PresentationService) -> None:
    from octop.infra.presentations.models import ChatTurn

    deck = await service.create_deck(7, "agent-a", CreateDeck(title="Plan"))
    turns = [
        ChatTurn(role="user" if i % 2 == 0 else "assistant", text=f"m{i}", at=i) for i in range(70)
    ]
    await service._append_chat(7, "agent-a", deck.deck_id, turns)
    log = await service.chat_log(7, "agent-a", deck.deck_id)
    assert len(log.messages) == 60 and log.messages[-1].text == "m69"


def test_create_body_maps_every_style_choice() -> None:
    for style in ("paper", "dark", "minimal", "business", "tech", "kids"):
        body = PresentationService._create_body({"title": "T", "style": style})
        assert body.style == style
    assert PresentationService._create_body({"title": "T", "style": "neon"}).style == "paper"


def test_parse_decision_strips_reasoning_block_like_screenshot() -> None:
    raw = (
        "<think>Okay, the user is asking me to create a teaching plan "
        "PowerPoint presentation. Let's check the current state.\n"
        "The action should be none. Output only JSON.</think>\n"
        '{"action": "none", "args": {}, "reply": "好的，请补充标题、受众、风格与页数"}'
    )
    decision = parse_decision(raw)
    assert decision.action == "none"
    assert decision.reply == "好的，请补充标题、受众、风格与页数"
    assert "think" not in decision.reply and "Okay" not in decision.reply


def test_parse_decision_extracts_json_wrapped_in_prose() -> None:
    raw = 'Sure! Here is my decision:\n{"action": "generate", "args": {}, "reply": "开始生成"}\nHope that helps.'
    decision = parse_decision(raw)
    assert decision.action == "generate" and decision.reply == "开始生成"


def test_parse_decision_unclosed_think_falls_back_to_localized_reply() -> None:
    decision = parse_decision("<think>reasoning without end and no payload", "请换个说法")
    assert decision.action == "none" and decision.reply == "请换个说法"


def test_parse_decision_long_garbage_never_leaks_into_reply() -> None:
    decision = parse_decision("x" * 500, "请换个说法")
    assert decision.action == "none" and decision.reply == "请换个说法"


def test_clean_model_output_supports_svg_generation() -> None:
    from octop.infra.presentations.chat import clean_model_output

    raw = f"<think>I will draw the title slide now.</think>\n```svg\n{SVG}\n```"
    assert clean_model_output(raw) == SVG
    # An unclosed think block discards everything after it by design.
    assert clean_model_output("<think>still thinking, never closed") == ""


@pytest.mark.asyncio
async def test_chat_stream_emits_only_reply_deltas_then_result(
    service: PresentationService,
) -> None:
    raw = (
        "<think>Reasoning about the request at length. The reply field comes last.</think>\n"
    ) + decision_json("none").replace("好的", "你好，请补充标题、受众、风格与页数")
    controller(service, {CHAT_SYSTEM: raw})
    events = [event async for event in service.chat_stream(7, "agent-a", None, "做个PPT")]
    deltas = [event["text"] for event in events if event["type"] == "delta"]
    results = [event for event in events if event["type"] == "result"]
    assert len(results) == 1
    assert results[0]["action"] == "none"
    assert "".join(deltas) == results[0]["reply"] == "你好，请补充标题、受众、风格与页数"
    assert all("think" not in text and "action" not in text for text in deltas)


@pytest.mark.asyncio
async def test_chat_stream_busy_emits_reply_and_result(service: PresentationService) -> None:
    deck = await service.create_deck(7, "agent-a", CreateDeck(title="Plan"))
    deck.status = "generating"
    await service._persist(deck)
    service._jobs[service._key(7, "agent-a", deck.deck_id)] = asyncio.Future()
    try:
        controller(service, {})
        events = [
            event
            async for event in service.chat_stream(
                7, "agent-a", deck.deck_id, "再加一页", locale="en"
            )
        ]
        assert [event["type"] for event in events] == ["delta", "result"]
        assert events[1]["deck"] is not None
    finally:
        service._jobs.clear()


def test_reply_extractor_decodes_escapes_across_chunks() -> None:
    from octop.infra.presentations.chat import ReplyExtractor

    extractor = ReplyExtractor()
    parts: list[str] = []
    for piece in (
        '{"action": "none", "args": {}, "rep',
        'ly": "第一行\n第二行\u4f60\u597d',
        '"}',
    ):
        parts.append(extractor.feed(piece))
    assert "".join(parts) == "第一行\n第二行你好"


def test_extract_svg_prefers_last_span_and_strips_comments() -> None:
    from octop.infra.presentations.chat import extract_svg
    from octop.infra.presentations.svg import validate_svg

    real = SVG.replace("<text ", "<!-- header --><text ")
    reasoning = (
        "1. Analyze: I will sketch the layout first:\n"
        '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n'
        "2. Now the final artwork:\n" + real
    )
    extracted = extract_svg(reasoning)
    assert extracted.startswith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">')
    assert "header" not in extracted and validate_svg(extracted) == SVG.replace("<text ", "<text ")
