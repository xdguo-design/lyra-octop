"""Unit tests for IM channel HITL."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import pytest
from octop_gateway.models import MessageEvent, MessageEventType, TextContent

from octop.infra.gateway.hitl.coordinator import (
    HitlChannelCoordinator,
    HitlSlashOutcome,
    HitlStreamContext,
)
from octop.infra.gateway.hitl.format import format_hitl_card, parse_action_requests
from octop.infra.gateway.hitl.store import HitlPendingStore
from octop.infra.gateway.process.stream_project import (
    StreamProjectionState,
    project_resume_stream,
    project_stream,
)


def test_parse_action_requests() -> None:
    raw = {
        "action_requests": [
            {"name": "execute", "args": {"command": "ls"}, "description": "run ls"},
        ]
    }
    actions = parse_action_requests(raw)
    assert len(actions) == 1
    assert actions[0]["name"] == "execute"
    assert actions[0]["args"] == {"command": "ls"}


def test_parse_action_requests_unwraps_interrupt_envelope() -> None:
    from octop.infra.gateway.hitl.format import normalize_hitl_request

    raw = {
        "id": "int-1",
        "value": {
            "action_requests": [
                {
                    "name": "ask_user_question",
                    "args": {"questions": [{"question": "Which DB?"}]},
                }
            ],
            "review_configs": [
                {"action_name": "ask_user_question", "allowed_decisions": ["respond"]}
            ],
        },
    }
    assert normalize_hitl_request(raw)["action_requests"][0]["name"] == "ask_user_question"
    actions = parse_action_requests(raw)
    assert actions[0]["name"] == "ask_user_question"
    assert actions[0]["args"]["questions"][0]["question"] == "Which DB?"


def test_hitl_store_register_and_resolve() -> None:
    store = HitlPendingStore()
    record = store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=7,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    assert record.pending_id
    resolved = store.resolve_for_session("sk1")
    assert resolved is not None
    assert resolved.pending_id == record.pending_id
    store.mark_resolved(record.pending_id, "approved")
    assert store.resolve_for_session("sk1") is None


def test_coordinator_persists_approval_without_tool_arguments(tmp_path) -> None:
    from octop.infra.db.migrate import run_migrations
    from octop.infra.db.pool import SqlitePool
    from octop.infra.db.repos.audit import AuditRepo

    db_path = tmp_path / "approval-audit.sqlite"
    pool = SqlitePool(db_path)
    run_migrations(pool)
    audit = AuditRepo(pool)
    coordinator = HitlChannelCoordinator(audit_repo=audit)
    record = coordinator.register_from_request(
        {
            "action_requests": [
                {"name": "send_email", "args": {"to": "patient@example.com", "body": "secret"}}
            ]
        },
        ctx=HitlStreamContext(
            thread_id="thread-1",
            agent_id="agent-1",
            user_id=7,
            session_key="session-1",
            channel_type="dashboard",
        ),
    )

    pending = AuditRepo(SqlitePool(db_path)).query(action="tool_approval.pending")
    assert len(pending) == 1
    assert pending[0].actor == "user:7"
    assert pending[0].payload is not None
    assert "send_email" in pending[0].payload
    assert "patient@example.com" not in pending[0].payload
    assert "secret" not in pending[0].payload

    coordinator.mark_resolved(record.pending_id, "approved")
    coordinator.mark_resolved(record.pending_id, "approved")
    decisions = AuditRepo(SqlitePool(db_path)).query(action="tool_approval.decision")
    assert len(decisions) == 1
    assert '"decision":"approved"' in (decisions[0].payload or "")
    coordinator.mark_resolved(record.pending_id, "expired")
    decisions = AuditRepo(SqlitePool(db_path)).query(action="tool_approval.decision")
    assert len(decisions) == 2
    assert '"decision":"expired"' in (decisions[0].payload or "")


def test_pending_approval_survives_coordinator_restart_encrypted_and_owner_scoped(tmp_path) -> None:
    from octop.infra.db.migrate import run_migrations
    from octop.infra.db.pool import SqlitePool
    from octop.infra.db.repos.agents import AgentRepo
    from octop.infra.db.repos.hitl_approvals import HitlApprovalRepo
    from octop.infra.db.repos.runs import RunRepo
    from octop.infra.db.repos.secrets import SecretRepo
    from octop.infra.db.repos.threads import ThreadRepo
    from octop.infra.db.repos.users import UserRepo

    pool = SqlitePool(tmp_path / "hitl-pending.sqlite")
    run_migrations(pool)
    users = UserRepo(pool)
    owner_id = users.create(username="hitl-owner", password_hash="h", role="user")
    other_id = users.create(username="hitl-other", password_hash="h", role="user")
    AgentRepo(pool).create(agent_id="hitl-agent", user_id=owner_id, name="Agent")
    ThreadRepo(pool).insert(
        thread_id="hitl-thread",
        agent_id="hitl-agent",
        user_id=owner_id,
        channel_type="dashboard",
        session_key="hitl-session",
    )
    runs = RunRepo(pool)
    run, _ = runs.create(
        run_id="hitl-run",
        owner_user_id=owner_id,
        agent_id="hitl-agent",
        project_id=None,
        parent_run_id=None,
        thread_id="hitl-thread",
        input_ref="hitl-message",
        idempotency_key=None,
        request_hash="hitl-request",
    )
    assert runs.transition("hitl-run", owner_user_id=owner_id, status="queued", expected_version=0)
    assert runs.transition("hitl-run", owner_user_id=owner_id, status="running", expected_version=1)
    step = runs.create_step(
        step_id="hitl-step",
        run_id="hitl-run",
        owner_user_id=owner_id,
        kind="agent",
        executor="test",
        parent_step_id=None,
    )
    assert runs.transition_step(
        "hitl-step", owner_user_id=owner_id, status="running", expected_version=0
    )
    approvals = HitlApprovalRepo(pool)
    secrets = SecretRepo(pool)
    coordinator = HitlChannelCoordinator(approval_repo=approvals, secret_repo=secrets)
    record = coordinator.register_from_request(
        {
            "action_requests": [
                {"name": "send_email", "args": {"to": "patient@example.com", "body": "private"}}
            ]
        },
        ctx=HitlStreamContext(
            thread_id="hitl-thread",
            agent_id="hitl-agent",
            user_id=owner_id,
            session_key="hitl-session",
            channel_type="dashboard",
            run_id=str(run["run_id"]),
            step_id=str(step["step_id"]),
        ),
    )

    with pool.connect() as conn:
        blob = bytes(
            conn.execute(
                "SELECT request_blob FROM hitl_approvals WHERE pending_id = ?",
                (record.pending_id,),
            ).fetchone()["request_blob"]
        )
    assert b"patient@example.com" not in blob
    assert b"private" not in blob

    recovered = HitlChannelCoordinator(
        approval_repo=HitlApprovalRepo(pool), secret_repo=SecretRepo(pool)
    )
    assert (
        recovered.resolve_pending_for_thread("hitl-thread", agent_id="hitl-agent", user_id=other_id)
        is None
    )
    restored = recovered.resolve_pending_for_thread(
        "hitl-thread", agent_id="hitl-agent", user_id=owner_id
    )
    assert restored is not None
    assert restored.pending_id == record.pending_id
    assert restored.run_id == "hitl-run"
    assert restored.step_id == "hitl-step"
    assert restored.action_requests[0]["args"]["to"] == "patient@example.com"
    recovered.set_resume_target(restored, agent_id="hitl-member", thread_id="hitl-member-thread")
    assert recovered.pending_thread_ids(agent_id="hitl-agent", user_id=owner_id) == frozenset(
        {"hitl-thread"}
    )
    assert recovered.pending_thread_ids(agent_id="hitl-member", user_id=owner_id) == frozenset(
        {"hitl-member-thread"}
    )

    competing = HitlChannelCoordinator(
        approval_repo=HitlApprovalRepo(pool), secret_repo=SecretRepo(pool)
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        decisions = list(
            executor.map(
                lambda coordinator: coordinator.mark_resolved(record.pending_id, "approved"),
                (recovered, competing),
            )
        )
    assert sorted(decisions) == [False, True]
    assert HitlApprovalRepo(pool).get(record.pending_id).status == "approved"  # type: ignore[union-attr]
    with pool.connect() as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'tool_approval.decision'"
        ).fetchone()[0]
    assert count == 1
    assert (
        HitlChannelCoordinator(
            approval_repo=HitlApprovalRepo(pool), secret_repo=SecretRepo(pool)
        ).resolve_pending_for_thread("hitl-thread", agent_id="hitl-agent", user_id=owner_id)
        is None
    )

    expiring = recovered.register_from_request(
        {"action_requests": [{"name": "write", "args": {"secret": "expire-me"}}]},
        ctx=HitlStreamContext(
            thread_id="hitl-thread",
            agent_id="hitl-agent",
            user_id=owner_id,
            session_key="hitl-session",
            channel_type="dashboard",
        ),
    )
    with pool.connect() as conn:
        conn.execute(
            "UPDATE hitl_approvals SET expires_at = 1 WHERE pending_id = ?",
            (expiring.pending_id,),
        )
    assert (
        recovered.list_pending_for_thread("hitl-thread", agent_id="hitl-agent", user_id=owner_id)
        == []
    )
    with pool.connect() as conn:
        expired = conn.execute(
            "SELECT status, request_blob FROM hitl_approvals WHERE pending_id = ?",
            (expiring.pending_id,),
        ).fetchone()
        decisions = conn.execute(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'tool_approval.decision'"
        ).fetchone()[0]
    assert expired["status"] == "expired"
    assert bytes(expired["request_blob"]) == b""
    assert decisions == 2


def test_team_approval_is_audited_before_member_resumes() -> None:
    audit = MagicMock()
    sequence: list[str] = []
    audit.write.side_effect = lambda **_kwargs: sequence.append("audit")
    coordinator = HitlChannelCoordinator(audit_repo=audit)
    record = coordinator.register_from_request(
        {"action_requests": [{"name": "send_email", "args": {}}]},
        ctx=HitlStreamContext(
            thread_id="room-thread",
            agent_id="host-agent",
            user_id=7,
            session_key="session-1",
            channel_type="dashboard",
        ),
        resume_agent_id="member-agent",
    )
    sequence.clear()

    def deliver(_pending_id: str, _decisions: list[dict[str, object]]) -> bool:
        sequence.append("resume")
        return True

    assert (
        coordinator.hand_member_pause(
            record,
            [{"type": "approve"}],
            deliver=deliver,
            rejected=False,
        )
        is True
    )
    assert sequence == ["audit", "resume"]


def test_format_hitl_card_contains_commands() -> None:
    text = format_hitl_card(
        [{"name": "execute", "args": {"command": "echo hi"}}],
        pending_id="ab12",
        locale="en",
    )
    assert "/approve" in text
    assert "/reject" in text
    assert "ab12" in text


@pytest.mark.asyncio
async def test_project_stream_emits_hitl_card() -> None:
    async def _stream(*_args: object, **_kwargs: object):
        yield {
            "type": "hitl_required",
            "request": {
                "action_requests": [{"name": "write_file", "args": {"path": "/tmp/x"}}],
            },
        }

    agent_manager = MagicMock()
    agent_manager.stream = _stream

    coordinator = HitlChannelCoordinator()
    state = StreamProjectionState()
    events: list[MessageEvent] = []
    async for ev in project_stream(
        agent_manager,
        "agent1",
        {"thread_id": "thr1", "messages": []},
        projection_state=state,
        hitl_coordinator=coordinator,
        hitl_ctx=HitlStreamContext(
            thread_id="thr1",
            agent_id="agent1",
            user_id=1,
            session_key="sk1",
            channel_type="feishu",
        ),
    ):
        events.append(ev)

    assert state.hitl_paused is True
    assert state.hitl_pending_id
    assert len(events) == 1
    assert events[0].type == MessageEventType.MESSAGE
    text = events[0].content[0]
    assert isinstance(text, TextContent)
    assert "/approve" in text.text


@pytest.mark.asyncio
async def test_coordinator_slash_approve_resumes() -> None:
    store = HitlPendingStore()
    coordinator = HitlChannelCoordinator(store=store)
    store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )

    async def _resume(*_args: object, **_kwargs: object):
        yield {"type": "token", "content": "done", "node": "agent"}

    agent_manager = MagicMock()
    agent_manager.resume_hitl = _resume

    ctx = MagicMock()
    ctx.session_key = "sk1"
    ctx.agent_id = "agent1"
    ctx.user_id = 1
    ctx.channel_type = "feishu"
    ctx.thread_registry = MagicMock()

    from octop_harness.slash import SlashCommand

    cmd = SlashCommand(name="approve", args="")
    events: list[MessageEvent] = []
    async for ev in coordinator.iter_slash_resolution(
        cmd,
        ctx,
        agent_manager=agent_manager,
        locale="en",
    ):
        events.append(ev)

    assert any(
        isinstance(c, TextContent) and "done" in c.text
        for e in events
        if e.content
        for c in e.content
    )
    assert store.resolve_for_session("sk1") is None


@pytest.mark.asyncio
async def test_coordinator_slash_approve_wakes_team_member_without_host_resume() -> None:
    store = HitlPendingStore()
    coordinator = HitlChannelCoordinator(store=store)
    record = store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    record.resume_agent_id = "member"
    record.resume_thread_id = "thr-room~member"
    delivered: list[tuple[str, list[dict[str, str]]]] = []

    def deliver(pending_id: str, decisions: list[dict[str, str]]) -> bool:
        delivered.append((pending_id, decisions))
        return True

    agent_manager = MagicMock()
    ctx = MagicMock()
    ctx.session_key = "sk1"
    ctx.agent_id = "host"
    ctx.user_id = 1
    ctx.channel_type = "feishu"
    ctx.thread_registry = MagicMock()

    from octop_harness.slash import SlashCommand

    events: list[MessageEvent] = []
    async for ev in coordinator.iter_slash_resolution(
        SlashCommand(name="approve", args=""),
        ctx,
        agent_manager=agent_manager,
        locale="en",
        member_hitl=deliver,
    ):
        events.append(ev)

    assert delivered == [(record.pending_id, [{"type": "approve"}])]
    assert agent_manager.resume_hitl.call_count == 0
    assert store.get(record.pending_id) is not None
    assert store.get(record.pending_id).status == "approved"  # type: ignore[union-attr]
    assert any(
        isinstance(c, TextContent) and "Approved" in c.text
        for e in events
        if e.content
        for c in e.content
    )


@pytest.mark.asyncio
async def test_coordinator_slash_approve_invalid_pending_id() -> None:
    store = HitlPendingStore()
    coordinator = HitlChannelCoordinator(store=store)
    store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )

    from octop_harness.slash import SlashCommand

    ctx = MagicMock()
    ctx.session_key = "sk1"
    ctx.agent_id = "agent1"
    ctx.user_id = 1

    cmd = SlashCommand(name="approve", args="deadbeef")
    events: list[MessageEvent] = []
    async for ev in coordinator.iter_slash_resolution(
        cmd,
        ctx,
        agent_manager=MagicMock(),
        locale="en",
    ):
        events.append(ev)

    text = "".join(
        c.text for e in events if e.content for c in e.content if isinstance(c, TextContent)
    )
    assert "deadbeef" in text
    assert store.resolve_for_session("sk1") is not None


@pytest.mark.asyncio
async def test_coordinator_resume_failure_keeps_pending() -> None:
    store = HitlPendingStore()
    sequence: list[str] = []
    audit = MagicMock()
    audit.write.side_effect = lambda **_kwargs: sequence.append("audit")
    coordinator = HitlChannelCoordinator(store=store, audit_repo=audit)
    record = store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )

    agent_manager = MagicMock()

    async def _fail(*_args: object, **_kwargs: object):
        sequence.append("resume")
        raise RuntimeError("boom")
        yield  # pragma: no cover

    agent_manager.resume_hitl = _fail

    ctx = MagicMock()
    ctx.session_key = "sk1"
    ctx.agent_id = "agent1"
    ctx.user_id = 1
    ctx.channel_type = "feishu"
    ctx.thread_registry = MagicMock()

    from octop_harness.slash import SlashCommand

    cmd = SlashCommand(name="approve", args="")
    async for _ in coordinator.iter_slash_resolution(
        cmd,
        ctx,
        agent_manager=agent_manager,
        locale="en",
    ):
        pass

    pending = store.resolve_for_session("sk1")
    assert pending is not None
    assert pending.pending_id == record.pending_id
    assert sequence == ["audit", "resume"]


@pytest.mark.asyncio
async def test_project_resume_stream_nested_hitl() -> None:
    async def _resume(*_args: object, **_kwargs: object):
        yield {
            "type": "hitl_required",
            "request": {
                "action_requests": [{"name": "delete_file", "args": {"path": "/tmp/y"}}],
            },
        }

    agent_manager = MagicMock()
    agent_manager.resume_hitl = _resume

    coordinator = HitlChannelCoordinator()
    state = StreamProjectionState()
    events: list[MessageEvent] = []
    async for ev in project_resume_stream(
        agent_manager,
        "agent1",
        "thr1",
        [{"type": "approve"}],
        projection_state=state,
        hitl_coordinator=coordinator,
        hitl_ctx=HitlStreamContext(
            thread_id="thr1",
            agent_id="agent1",
            user_id=1,
            session_key="sk1",
            channel_type="feishu",
        ),
    ):
        events.append(ev)

    assert state.hitl_paused is True
    assert state.hitl_pending_id
    assert len(events) == 1


def test_hitl_store_gc_removes_stale_resolved() -> None:
    store = HitlPendingStore(ttl_seconds=0.01)
    record = store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    store.mark_resolved(record.pending_id, "approved")
    import time

    time.sleep(0.02)
    store._gc()
    assert store.get(record.pending_id) is None


def test_hitl_store_resolve_pending_for_thread() -> None:
    store = HitlPendingStore()
    store.register(
        thread_id="thr-a",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    store.register(
        thread_id="thr-b",
        agent_id="agent1",
        user_id=1,
        session_key="sk2",
        channel_type="dashboard",
        action_requests=[{"name": "write_file", "args": {"path": "x"}}],
        review_configs=None,
    )
    pending = store.resolve_pending_for_thread("thr-a", agent_id="agent1", user_id=1)
    assert pending is not None
    assert pending.action_requests[0]["name"] == "execute"
    assert store.resolve_pending_for_thread("thr-a", agent_id="agent1", user_id=2) is None
    assert store.pending_thread_ids(agent_id="agent1", user_id=1) == frozenset({"thr-a", "thr-b"})
    assert store.pending_thread_ids(agent_id="agent1", user_id=2) == frozenset()


def test_hitl_store_keeps_each_team_member_pause() -> None:
    store = HitlPendingStore()
    first = store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
        resume_agent_id="doctor",
    )
    second = store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "write_file", "args": {}}],
        review_configs=None,
        resume_agent_id="nurse",
    )
    assert store.get(first.pending_id) is not None
    assert store.get(first.pending_id).status == "pending"  # type: ignore[union-attr]
    assert store.get(second.pending_id) is not None
    assert store.get(second.pending_id).status == "pending"  # type: ignore[union-attr]
    picked = store.resolve_pending_for_thread(
        "thr-room",
        agent_id="host",
        user_id=1,
        pending_id=first.pending_id,
    )
    assert picked is first
    again = store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {"command": "df"}}],
        review_configs=None,
        resume_agent_id="doctor",
    )
    assert store.get(first.pending_id).status == "expired"  # type: ignore[union-attr]
    assert store.get(second.pending_id).status == "pending"  # type: ignore[union-attr]
    assert store.get(again.pending_id).status == "pending"  # type: ignore[union-attr]


def test_hitl_store_resolves_team_member_pause_from_either_thread() -> None:
    store = HitlPendingStore()
    record = store.register(
        thread_id="thr-room",
        agent_id="host",
        user_id=1,
        session_key="host:dashboard:1:dm",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    record.resume_agent_id = "member"
    record.resume_thread_id = "thr-room~member"
    assert store.resolve_pending_for_thread("thr-room", agent_id="host", user_id=1) is record
    assert (
        store.resolve_pending_for_thread("thr-room~member", agent_id="member", user_id=1) is record
    )
    assert store.pending_thread_ids(agent_id="host", user_id=1) == frozenset({"thr-room"})
    assert store.pending_thread_ids(agent_id="member", user_id=1) == frozenset({"thr-room~member"})


def test_pending_hitl_payload() -> None:
    from octop.infra.gateway.hitl.coordinator import pending_hitl_payload

    store = HitlPendingStore()
    record = store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=7,
        session_key="sk1",
        channel_type="dashboard",
        action_requests=[{"name": "execute", "args": {"command": "ls"}}],
        review_configs=None,
    )
    payload = pending_hitl_payload(
        HitlChannelCoordinator(store=store),
        thread_id="thr1",
        agent_id="agent1",
        user_id=7,
    )
    assert payload is not None
    assert payload["pending_id"] == record.pending_id
    assert payload["action_requests"][0]["name"] == "execute"


def test_hitl_store_get_pending_agent_mismatch() -> None:
    store = HitlPendingStore()
    record = store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )
    assert store.get_pending(record.pending_id, session_key="sk1", agent_id="other") is None


def test_expire_pending_for_thread_drops_history_reinject() -> None:
    store = HitlPendingStore()
    record = store.register(
        thread_id="thr-ask",
        agent_id="agent1",
        user_id=7,
        session_key="sk-ask",
        channel_type="dashboard",
        action_requests=[{"name": "ask_user_question", "args": {"questions": []}}],
        review_configs=None,
    )
    store.expire_pending_for_thread("thr-ask", agent_id="agent1", user_id=7)
    assert store.resolve_pending_for_thread("thr-ask", agent_id="agent1", user_id=7) is None
    expired = store.get(record.pending_id)
    assert expired is not None
    assert expired.status == "expired"


@pytest.mark.asyncio
async def test_slash_outcome_completed_turn() -> None:
    store = HitlPendingStore()
    coordinator = HitlChannelCoordinator(store=store)
    store.register(
        thread_id="thr1",
        agent_id="agent1",
        user_id=1,
        session_key="sk1",
        channel_type="feishu",
        action_requests=[{"name": "execute", "args": {}}],
        review_configs=None,
    )

    async def _resume(*_args: object, **_kwargs: object):
        yield {"type": "token", "content": "ok", "node": "agent"}

    agent_manager = MagicMock()
    agent_manager.resume_hitl = _resume

    ctx = MagicMock()
    ctx.session_key = "sk1"
    ctx.agent_id = "agent1"
    ctx.user_id = 1
    ctx.channel_type = "feishu"
    ctx.thread_registry = MagicMock()

    from octop_harness.slash import SlashCommand

    outcome = HitlSlashOutcome()
    cmd = SlashCommand(name="approve", args="")
    async for _ in coordinator.iter_slash_resolution(
        cmd,
        ctx,
        agent_manager=agent_manager,
        locale="en",
        outcome=outcome,
    ):
        pass
    assert outcome.completed_turn is True
