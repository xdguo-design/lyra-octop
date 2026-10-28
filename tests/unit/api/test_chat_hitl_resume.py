"""Dashboard HITL resume SSE must persist follow-up approvals in the pending store."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.requests import Request

from octop.api.routers.chat import routes as chat_routes
from octop.api.routers.chat.models import HitlResumeBody
from octop.api.routers.chat.routes import iter_dashboard_hitl_resume_sse
from octop.infra.gateway.hitl.coordinator import HitlChannelCoordinator


def _parse_sse_chunks(raw: str) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    for block in raw.split("\n\n"):
        if not block.strip():
            continue
        data_line = next(
            (line[6:] for line in block.split("\n") if line.startswith("data: ")),
            None,
        )
        if data_line is None:
            continue
        chunks.append(json.loads(data_line))
    return chunks


@pytest.mark.asyncio
@pytest.mark.parametrize(("thread_owner", "pending_count"), [(1, 0), (2, 1), (1, 2)])
async def test_resume_route_requires_owned_thread_and_pending_record(
    monkeypatch: pytest.MonkeyPatch,
    thread_owner: int,
    pending_count: int,
) -> None:
    processor = MagicMock()
    processor.hitl_coordinator = HitlChannelCoordinator()
    for index in range(pending_count):
        processor.hitl_coordinator.store.register(
            thread_id="thread-1",
            agent_id="agent-1",
            user_id=1,
            session_key="agent-1:dashboard:1:dm",
            channel_type="dashboard",
            action_requests=[{"name": "dangerous_write", "args": {}}],
            review_configs=None,
            resume_agent_id=f"member-{index}" if pending_count > 1 else None,
        )
    thread = SimpleNamespace(
        agent_id="agent-1",
        user_id=thread_owner,
        session_key="agent-1:dashboard:1:dm",
        channel_type="dashboard",
    )
    server = SimpleNamespace(
        app_runtime=SimpleNamespace(
            gateway=SimpleNamespace(
                processor=processor,
                thread_registry=SimpleNamespace(get_thread=lambda _thread_id: thread),
            ),
        ),
    )
    monkeypatch.setattr(chat_routes, "assert_agent_access", lambda *_args: None)
    monkeypatch.setattr(chat_routes, "resolve_request_locale", lambda _request: "en")
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})

    response = await chat_routes.resume_hitl(
        "agent-1",
        HitlResumeBody(thread_id="thread-1", decisions=[{"type": "approve"}]),
        request,
        SimpleNamespace(id=1),
        server,
    )

    chunk = await anext(response.body_iterator)
    assert "hitl.expired" not in chunk
    assert (
        "several approvals" in chunk.lower() if pending_count == 2 else "expired" in chunk.lower()
    )
    processor.iter_hitl_resume_chunks.assert_not_called()


@pytest.mark.asyncio
async def test_dashboard_hitl_resume_registers_followup_hitl_required() -> None:
    async def _resume(*_args: object, **_kwargs: object):
        yield {"type": "token", "content": "ok"}
        yield {
            "type": "hitl_required",
            "request": {
                "action_requests": [
                    {"name": "execute", "args": {"command": "ls -la /private/etc"}},
                ],
                "review_configs": [
                    {"action_name": "execute", "allowed_decisions": ["approve", "reject"]},
                ],
            },
        }

    processor = MagicMock()
    processor.iter_hitl_resume_chunks = _resume
    hitl = HitlChannelCoordinator()
    first = hitl.store.register(
        thread_id="thr-follow",
        agent_id="agent-1",
        user_id=1,
        session_key="agent-1:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {"command": "ls -la /etc"}}],
        review_configs=None,
    )

    frames: list[str] = []
    async for frame in iter_dashboard_hitl_resume_sse(
        processor=processor,
        hitl_coordinator=hitl,
        agent_id="agent-1",
        thread_id="thr-follow",
        user_id=1,
        decisions=[{"type": "approve"}],
        pending=first,
        session_key="agent-1:dashboard:1:dm",
        channel_type="dashboard",
        locale="zh",
        is_disconnected=AsyncMock(return_value=False),
    ):
        frames.append(frame)

    chunks = _parse_sse_chunks("".join(frames))
    hitl_chunks = [c for c in chunks if c.get("type") == "hitl_required"]
    assert hitl_chunks
    assert any(c.get("type") == "done" for c in chunks)

    followup = hitl.store.resolve_pending_for_thread(
        "thr-follow",
        agent_id="agent-1",
        user_id=1,
    )
    assert followup is not None
    assert hitl_chunks[0]["request"]["pending_id"] == followup.pending_id
    assert followup.pending_id != first.pending_id
    assert followup.action_requests[0]["args"]["command"] == "ls -la /private/etc"
    assert hitl.store.get(first.pending_id) is not None
    assert hitl.store.get(first.pending_id).status == "approved"  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_dashboard_resume_cas_loser_does_not_resume_harness() -> None:
    coordinator = HitlChannelCoordinator()
    record = coordinator.register_from_request(
        {"action_requests": [{"name": "write", "args": {}}]},
        ctx=SimpleNamespace(
            thread_id="thread-1",
            agent_id="agent-1",
            user_id=1,
            session_key="session-1",
            channel_type="dashboard",
        ),
    )
    assert coordinator.mark_resolved(record.pending_id, "approved")
    processor = SimpleNamespace(iter_hitl_resume_chunks=MagicMock())

    frames = [
        frame
        async for frame in iter_dashboard_hitl_resume_sse(
            processor=processor,
            hitl_coordinator=coordinator,
            agent_id="agent-1",
            thread_id="thread-1",
            user_id=1,
            decisions=[{"type": "approve"}],
            pending=record,
            session_key="session-1",
            channel_type="dashboard",
            locale="en",
            is_disconnected=AsyncMock(return_value=False),
        )
    ]
    assert "expired" in frames[0].lower()
    processor.iter_hitl_resume_chunks.assert_not_called()


@pytest.mark.asyncio
async def test_dashboard_hitl_resume_wakes_team_member_without_host_resume() -> None:
    from types import SimpleNamespace

    hitl = HitlChannelCoordinator()
    pending = hitl.store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {"command": "df"}}],
        review_configs=None,
    )
    pending.resume_agent_id = "member"
    pending.resume_thread_id = "thr-room~member"
    delivered: dict[str, object] = {}

    def deliver(pending_id: str, decisions: list[dict[str, str]]) -> bool:
        delivered["id"] = pending_id
        delivered["decisions"] = decisions
        return True

    processor = SimpleNamespace(teams=SimpleNamespace(deliver_member_hitl=deliver))
    frames: list[str] = []
    async for frame in iter_dashboard_hitl_resume_sse(
        processor=processor,
        hitl_coordinator=hitl,
        agent_id="host",
        thread_id="thr-room",
        user_id=1,
        decisions=[{"type": "approve"}],
        pending=pending,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        locale="zh",
        is_disconnected=AsyncMock(return_value=False),
    ):
        frames.append(frame)

    chunks = _parse_sse_chunks("".join(frames))
    assert chunks == [{"type": "done", "team_member_continuing": True}]
    assert delivered == {"id": pending.pending_id, "decisions": [{"type": "approve"}]}
    assert hitl.store.get(pending.pending_id) is not None
    assert hitl.store.get(pending.pending_id).status == "approved"  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_dashboard_hitl_resume_expires_when_member_job_is_gone() -> None:
    from types import SimpleNamespace

    hitl = HitlChannelCoordinator()
    pending = hitl.store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    pending.resume_agent_id = "member"
    pending.resume_thread_id = "thr-room~member"
    processor = SimpleNamespace(
        teams=SimpleNamespace(deliver_member_hitl=lambda *_args, **_kwargs: False)
    )
    frames: list[str] = []
    async for frame in iter_dashboard_hitl_resume_sse(
        processor=processor,
        hitl_coordinator=hitl,
        agent_id="host",
        thread_id="thr-room",
        user_id=1,
        decisions=[{"type": "reject"}],
        pending=pending,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        locale="en",
        is_disconnected=AsyncMock(return_value=False),
    ):
        frames.append(frame)

    chunks = _parse_sse_chunks("".join(frames))
    assert chunks[0]["type"] == "error"
    assert "expired" in chunks[0]["message"].lower()
    assert hitl.store.get(pending.pending_id) is not None
    assert hitl.store.get(pending.pending_id).status == "expired"  # type: ignore[union-attr]


@pytest.mark.asyncio
async def test_dashboard_hitl_resume_registers_without_prior_pending() -> None:
    async def _resume(*_args: object, **_kwargs: object):
        yield {
            "type": "hitl_required",
            "request": {
                "action_requests": [{"name": "execute", "args": {"command": "echo hi"}}],
            },
        }

    processor = MagicMock()
    processor.iter_hitl_resume_chunks = _resume
    hitl = HitlChannelCoordinator()

    async for _ in iter_dashboard_hitl_resume_sse(
        processor=processor,
        hitl_coordinator=hitl,
        agent_id="agent-1",
        thread_id="thr-orphan",
        user_id=9,
        decisions=[{"type": "approve"}],
        pending=None,
        session_key="sk-orphan",
        channel_type="dashboard",
        locale="en",
        is_disconnected=AsyncMock(return_value=False),
    ):
        pass

    pending = hitl.store.resolve_pending_for_thread(
        "thr-orphan",
        agent_id="agent-1",
        user_id=9,
    )
    assert pending is not None
    assert pending.action_requests[0]["args"]["command"] == "echo hi"


@pytest.mark.asyncio
async def test_dashboard_hitl_resume_finishes_after_client_disconnect() -> None:
    completed = False

    async def _resume(*_args: object, **_kwargs: object):
        nonlocal completed
        yield {"type": "token", "content": "hidden after disconnect"}
        completed = True

    processor = MagicMock()
    processor.iter_hitl_resume_chunks = _resume
    hitl = HitlChannelCoordinator()

    frames = [
        frame
        async for frame in iter_dashboard_hitl_resume_sse(
            processor=processor,
            hitl_coordinator=hitl,
            agent_id="agent-1",
            thread_id="thr-disconnected",
            user_id=9,
            decisions=[{"type": "respond", "message": "answer"}],
            pending=None,
            session_key="sk-disconnected",
            channel_type="dashboard",
            locale="en",
            is_disconnected=AsyncMock(return_value=True),
        )
    ]

    assert completed is True
    assert frames == []


@pytest.mark.asyncio
async def test_dashboard_hitl_resume_marks_pending_resolved_when_stream_errors() -> None:
    async def _resume(*_args: object, **_kwargs: object):
        raise RuntimeError("stream died")
        yield {}  # pragma: no cover

    processor = MagicMock()
    processor.iter_hitl_resume_chunks = _resume
    hitl = HitlChannelCoordinator()
    first = hitl.store.register(
        thread_id="thr-err",
        agent_id="agent-1",
        user_id=1,
        session_key="sk-err",
        channel_type="dashboard",
        action_requests=[{"name": "ask_user_question", "args": {"questions": []}}],
        review_configs=None,
    )

    frames: list[str] = []
    async for frame in iter_dashboard_hitl_resume_sse(
        processor=processor,
        hitl_coordinator=hitl,
        agent_id="agent-1",
        thread_id="thr-err",
        user_id=1,
        decisions=[{"type": "respond", "message": "ok"}],
        pending=first,
        session_key="sk-err",
        channel_type="dashboard",
        locale="zh",
        is_disconnected=AsyncMock(return_value=False),
    ):
        frames.append(frame)

    chunks = _parse_sse_chunks("".join(frames))
    assert any(c.get("type") == "error" for c in chunks)
    resolved = hitl.store.get(first.pending_id)
    assert resolved is not None
    assert resolved.status == "expired"
    assert hitl.store.resolve_pending_for_thread("thr-err", agent_id="agent-1", user_id=1) is None
