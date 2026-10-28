from __future__ import annotations

import asyncio
import hashlib
from dataclasses import replace
from types import SimpleNamespace
from typing import Any

import pytest

from octop.infra.agents.versioning import read_agent_version_snapshot
from octop.infra.db.repos.thread_messages import ThreadMessageInput
from octop.infra.gateway.hitl.coordinator import HitlStreamContext
from tests.support.auth import create_agent, create_user, resolve_user_id


async def test_runs_are_idempotent_and_owner_scoped(env_with_agent: Any) -> None:
    client, server, admin_auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, admin_auth, "admin")
    app = server.services.app_registry_repo.create_registration(
        owner_user_id=owner_id,
        app_key="admission-registration",
        display_name="Admission registration",
    )
    assert app is not None
    grant = server.services.app_registry_repo.save_grant(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id=agent_id,
        read_scopes=["admission.patient.read"],
        write_scopes=["admission.narrative.write"],
        expires_at=None,
    )
    assert grant is not None
    payload = {
        "agent_id": agent_id,
        "input_ref": "thread:thread-1/message:message-1",
    }
    created = await client.post(
        "/api/runs", headers={**admin_auth, "Idempotency-Key": "run-request-1"}, json=payload
    )
    assert created.status_code == 201, created.text
    run = created.json()
    assert run["status"] == "created"
    assert run["agent_version_id"]
    assert run["capability_scope_snapshot"] == [
        {
            "registration_id": app["registration_id"],
            "app_key": "admission-registration",
            "grant_id": grant["grant_id"],
            "expires_at": None,
            "read_scopes": ["admission.patient.read"],
            "write_scopes": ["admission.narrative.write"],
        }
    ]
    assert (
        not {
            "owner_user_id",
            "parent_run_id",
            "input_ref",
            "version",
        }
        & run.keys()
    )

    details = await client.get(f"/api/runs/{run['run_id']}", headers=admin_auth)
    assert details.status_code == 200, details.text
    assert "input_ref" not in details.json()
    assert details.json()["project_context_snapshot"] is None
    assert details.json()["source_file_revisions"] == []
    effects = await client.get(f"/api/runs/{run['run_id']}/effects", headers=admin_auth)
    assert effects.status_code == 200, effects.text
    assert effects.json() == []
    listed = await client.get("/api/runs", headers=admin_auth)
    assert listed.status_code == 200, listed.text
    assert "input_ref" not in listed.json()[0]

    invalid_project = await client.post(
        "/api/runs",
        headers={**admin_auth, "Idempotency-Key": "run-invalid-project"},
        json={**payload, "project_id": "not-owned"},
    )
    assert invalid_project.status_code == 404, invalid_project.text

    replay = await client.post(
        "/api/runs", headers={**admin_auth, "Idempotency-Key": "run-request-1"}, json=payload
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["run_id"] == run["run_id"]
    assert replay.json()["agent_version_id"] == run["agent_version_id"]
    assert replay.json()["capability_scope_snapshot"] == run["capability_scope_snapshot"]
    assert server.services.app_registry_repo.revoke_grant(
        owner_user_id=owner_id, grant_id=grant["grant_id"]
    )
    replay_after_revoke = await client.post(
        "/api/runs", headers={**admin_auth, "Idempotency-Key": "run-request-1"}, json=payload
    )
    assert replay_after_revoke.status_code == 200
    assert (
        replay_after_revoke.json()["capability_scope_snapshot"] == run["capability_scope_snapshot"]
    )
    after_revoke = await client.post("/api/runs", headers=admin_auth, json=payload)
    assert after_revoke.status_code == 201, after_revoke.text
    assert after_revoke.json()["capability_scope_snapshot"] == []

    conflict = await client.post(
        "/api/runs",
        headers={**admin_auth, "Idempotency-Key": "run-request-1"},
        json={**payload, "input_ref": "thread:other/message:other"},
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["error"]["code"] == "RUN_IDEMPOTENCY_CONFLICT"

    events = await client.get(f"/api/runs/{run['run_id']}/events", headers=admin_auth)
    assert events.status_code == 200, events.text
    assert [event["type"] for event in events.json()] == ["run.created"]
    steps = await client.get(f"/api/runs/{run['run_id']}/steps", headers=admin_auth)
    assert steps.status_code == 200, steps.text
    assert steps.json() == []

    other_auth = await create_user(client, admin_auth, username="runs-other-user")
    hidden = await client.get(f"/api/runs/{run['run_id']}", headers=other_auth)
    assert hidden.status_code == 404, hidden.text
    hidden_effects = await client.get(f"/api/runs/{run['run_id']}/effects", headers=other_auth)
    assert hidden_effects.status_code == 404, hidden_effects.text
    hidden_events = await client.get(f"/api/runs/{run['run_id']}/events", headers=other_auth)
    assert hidden_events.status_code == 404, hidden_events.text
    hidden_steps = await client.get(f"/api/runs/{run['run_id']}/steps", headers=other_auth)
    assert hidden_steps.status_code == 404, hidden_steps.text
    listed = await client.get("/api/runs", headers=other_auth)
    assert listed.status_code == 200, listed.text
    assert listed.json() == []


async def test_team_children_are_parent_scoped_without_exposing_parent_fields(
    env_with_agent: Any,
) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    parent_response = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert parent_response.status_code == 201, parent_response.text
    parent_id = parent_response.json()["run_id"]
    assert "parent_run_id" not in parent_response.json()
    server.services.run_repo.transition(
        parent_id, owner_user_id=owner_id, status="queued", expected_version=0
    )
    server.services.run_repo.transition(
        parent_id, owner_user_id=owner_id, status="running", expected_version=1
    )
    child, _step, _replayed = server.services.run_repo.create_team_dispatch(
        run_id="team-child-api-run",
        step_id="team-child-api-step",
        inbox_id="team-child-api-inbox",
        owner_user_id=owner_id,
        team_agent_id=agent_id,
        member_agent_id="team-member",
        request_hash="team-child-api-hash",
        parent_run_id=parent_id,
    )

    listed = await client.get(f"/api/runs/{parent_id}/children", headers=auth)
    assert listed.status_code == 200, listed.text
    assert [item["run_id"] for item in listed.json()] == [child["run_id"]]
    assert "parent_run_id" not in listed.json()[0]

    other = await create_user(client, auth, username="run-child-other")
    hidden = await client.get(f"/api/runs/{parent_id}/children", headers=other)
    assert hidden.status_code == 404, hidden.text


@pytest.mark.parametrize(
    ("parent_status", "expected_status"),
    [("running", "cancel_requested"), ("waiting_approval", "cancelled")],
)
async def test_cancelling_parent_run_signals_team_child_inbox(
    env_with_agent: Any, parent_status: str, expected_status: str
) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    parent_response = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert parent_response.status_code == 201, parent_response.text
    parent_id = parent_response.json()["run_id"]
    server.services.run_repo.transition(
        parent_id, owner_user_id=owner_id, status="queued", expected_version=0
    )
    server.services.run_repo.transition(
        parent_id, owner_user_id=owner_id, status="running", expected_version=1
    )
    server.services.run_repo.create_team_dispatch(
        run_id="team-child-cancel-run",
        step_id="team-child-cancel-step",
        inbox_id="team-child-cancel-inbox",
        owner_user_id=owner_id,
        team_agent_id=agent_id,
        member_agent_id="team-member",
        request_hash="team-child-cancel-hash",
        parent_run_id=parent_id,
    )
    if parent_status == "waiting_approval":
        server.services.run_repo.transition(
            parent_id, owner_user_id=owner_id, status="waiting_approval", expected_version=2
        )
    inbox = server.app_runtime.gateway.processor.teams._agent_manager._harness_manager.team.inbox
    inbox.get.return_value = SimpleNamespace(status="running")
    inbox.cancel.return_value = True

    cancelled = await client.post(f"/api/runs/{parent_id}/cancel", headers=auth)
    repeated = await client.post(f"/api/runs/{parent_id}/cancel", headers=auth)

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == repeated.json()["status"] == expected_status
    assert inbox.cancel.call_count == 2
    inbox.cancel.assert_called_with("team-child-cancel-inbox")


async def test_run_artifacts_are_revision_pinned_and_owner_scoped(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    project_response = await client.post(
        "/api/workbench/projects", headers=auth, json={"name": "Run artifact project"}
    )
    assert project_response.status_code == 201, project_response.text
    project_id = project_response.json()["project_id"]
    thread_id = "run-artifact-thread"
    server.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="run-artifact-session",
    )
    server.services.chat_file_repo.create_uploaded(
        file_id="run-artifact-file",
        revision_id="run-artifact-revision",
        user_id=owner_id,
        agent_id=agent_id,
        thread_id=thread_id,
        display_name="result.txt",
        workspace_path="inbound/run-artifact-result.txt",
        sha256="a" * 64,
        media_type="text/plain",
        byte_size=6,
        origin_kind="generated",
    )
    other_thread_id = "run-artifact-other-thread"
    server.services.thread_repo.insert(
        thread_id=other_thread_id,
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="run-artifact-other-session",
    )
    server.services.chat_file_repo.create_uploaded(
        file_id="run-artifact-foreign-thread-file",
        revision_id="run-artifact-foreign-thread-revision",
        user_id=owner_id,
        agent_id=agent_id,
        thread_id=other_thread_id,
        display_name="other.txt",
        workspace_path="inbound/run-artifact-other.txt",
        sha256="b" * 64,
        media_type="text/plain",
        byte_size=5,
        origin_kind="generated",
    )
    created = await client.post(
        "/api/runs",
        headers=auth,
        json={"agent_id": agent_id, "thread_id": thread_id, "project_id": project_id},
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    attached = await client.post(
        f"/api/runs/{run_id}/artifacts",
        headers=auth,
        json={"file_id": "run-artifact-file", "revision_id": "run-artifact-revision"},
    )
    assert attached.status_code == 201, attached.text
    artifact = attached.json()
    assert artifact["artifact_id"] == artifact["revision_id"] == "run-artifact-revision"
    assert artifact["run_id"] == run_id
    assert artifact["thread_id"] == thread_id
    assert artifact["content_hash"] == "a" * 64
    assert artifact["content_url"].endswith(
        "/files/run-artifact-file/revisions/run-artifact-revision/content"
    )
    assert "workspace_path" not in artifact

    replay = await client.post(
        f"/api/runs/{run_id}/artifacts",
        headers=auth,
        json={"file_id": "run-artifact-file", "revision_id": "run-artifact-revision"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["artifact_id"] == artifact["artifact_id"]
    listed = await client.get(f"/api/runs/{run_id}/artifacts", headers=auth)
    assert listed.status_code == 200, listed.text
    assert [item["artifact_id"] for item in listed.json()] == [artifact["artifact_id"]]

    second_run = await client.post(
        "/api/runs",
        headers=auth,
        json={"agent_id": agent_id, "thread_id": thread_id, "project_id": project_id},
    )
    second_artifact = await client.post(
        f"/api/runs/{second_run.json()['run_id']}/artifacts",
        headers=auth,
        json={"file_id": "run-artifact-file", "revision_id": "run-artifact-revision"},
    )
    assert second_artifact.status_code == 201, second_artifact.text
    assert second_artifact.json()["artifact_id"] == artifact["artifact_id"]

    project_artifacts = await client.get(f"/api/runs/projects/{project_id}/artifacts", headers=auth)
    assert project_artifacts.status_code == 200, project_artifacts.text
    assert [item["artifact_id"] for item in project_artifacts.json()] == ["run-artifact-revision"]
    assert project_artifacts.json()[0]["content_url"] == artifact["content_url"]

    other = await create_user(client, auth, username="run-artifact-other")
    hidden = await client.get(f"/api/runs/{run_id}/artifacts", headers=other)
    assert hidden.status_code == 404, hidden.text
    hidden_project_artifacts = await client.get(
        f"/api/runs/projects/{project_id}/artifacts", headers=other
    )
    assert hidden_project_artifacts.status_code == 404, hidden_project_artifacts.text
    with server.services.db.transaction() as conn:
        conn.execute(
            "UPDATE chat_files SET thread_id = ? WHERE file_id = ?",
            (other_thread_id, "run-artifact-file"),
        )
    scoped_artifacts = await client.get(f"/api/runs/{run_id}/artifacts", headers=auth)
    assert scoped_artifacts.status_code == 200, scoped_artifacts.text
    assert scoped_artifacts.json() == []
    scoped_project_artifacts = await client.get(
        f"/api/runs/projects/{project_id}/artifacts", headers=auth
    )
    assert scoped_project_artifacts.status_code == 200, scoped_project_artifacts.text
    assert scoped_project_artifacts.json() == []
    foreign_file = await client.post(
        f"/api/runs/{run_id}/artifacts",
        headers=other,
        json={"file_id": "run-artifact-file", "revision_id": "run-artifact-revision"},
    )
    assert foreign_file.status_code == 404, foreign_file.text
    wrong_revision = await client.post(
        f"/api/runs/{run_id}/artifacts",
        headers=auth,
        json={"file_id": "run-artifact-file", "revision_id": "missing-revision"},
    )
    assert wrong_revision.status_code == 404, wrong_revision.text
    wrong_thread = await client.post(
        f"/api/runs/{run_id}/artifacts",
        headers=auth,
        json={
            "file_id": "run-artifact-foreign-thread-file",
            "revision_id": "run-artifact-foreign-thread-revision",
        },
    )
    assert wrong_thread.status_code == 404, wrong_thread.text


async def test_cancelling_team_run_closes_dispatch_missing_from_live_inbox(
    env_with_agent: Any,
) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    server.services.run_repo.create_team_dispatch(
        run_id="team-run-process-loss",
        step_id="team-step-process-loss",
        inbox_id="team-inbox-process-loss",
        owner_user_id=owner_id,
        team_agent_id=agent_id,
        member_agent_id="team-member",
        request_hash="team-dispatch-process-loss",
    )
    team_manager = server.app_runtime.gateway.processor.teams
    assert team_manager._run_repo is not None
    inbox = team_manager._agent_manager._harness_manager.team.inbox
    inbox.get.return_value = None

    cancelled = await client.post("/api/runs/team-run-process-loss/cancel", headers=auth)

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "interrupted"
    steps = await client.get("/api/runs/team-run-process-loss/steps", headers=auth)
    assert steps.status_code == 200, steps.text
    assert [step["status"] for step in steps.json()] == ["interrupted"]

    server.services.run_repo.create_team_dispatch(
        run_id="team-run-live-cancel",
        step_id="team-step-live-cancel",
        inbox_id="team-inbox-live-cancel",
        owner_user_id=owner_id,
        team_agent_id=agent_id,
        member_agent_id="team-member",
        request_hash="team-dispatch-live-cancel",
    )
    inbox.get.return_value = SimpleNamespace(status="running")
    inbox.cancel.return_value = True
    live_cancel = await client.post("/api/runs/team-run-live-cancel/cancel", headers=auth)
    assert live_cancel.status_code == 200, live_cancel.text
    assert live_cancel.json()["status"] == "cancel_requested"
    inbox.cancel.assert_called_with("team-inbox-live-cancel")


async def test_run_event_sequence_cursor_rejects_invalid_values(env_with_agent: Any) -> None:
    client, _server, auth, agent_id = env_with_agent
    created = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert created.status_code == 201, created.text

    invalid_cursor = await client.get(
        f"/api/runs/{created.json()['run_id']}/events?after_sequence=-1", headers=auth
    )
    assert invalid_cursor.status_code == 422, invalid_cursor.text


async def test_run_start_requires_owned_persisted_user_message(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    project = server.services.workbench_repo.create_project(
        owner_user_id=owner_id, name="Run context", icon="folder"
    )
    assert project is not None
    context = server.services.workbench_repo.get_project_context(
        owner_user_id=owner_id, project_id=project["project_id"]
    )
    assert context is not None
    server.services.workbench_repo.update_project_instructions(
        owner_user_id=owner_id,
        project_id=project["project_id"],
        instructions="Use the approved terminology.",
        expected_revision=int(context["instructions_revision"]),
    )
    observed: list[str] = []

    async def fake_turn(_message: Any):
        observed.append(_message.content[0].text)
        yield {"type": "token", "text": "ok"}
        yield {"type": "done"}

    server.app_runtime.gateway.processor.iter_turn_chunks = fake_turn
    thread_id = "run-start-thread"
    message_id = "run-start-message"
    server.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="run-start-session",
    )
    server.services.thread_message_repo.append_if_ready(
        thread_id,
        [
            ThreadMessageInput(
                message_id=message_id,
                role="human",
                message_json='{"type":"human","data":{"content":"hello"}}',
                created_at=1,
            )
        ],
    )
    created = await client.post(
        "/api/runs",
        headers=auth,
        json={
            "agent_id": agent_id,
            "project_id": project["project_id"],
            "thread_id": thread_id,
            "input_ref": message_id,
        },
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]
    assert created.json()["project_context_snapshot"]["instructions_revision"] == 2
    assert created.json()["source_file_revisions"] == []

    started = await client.post(f"/api/runs/{run_id}/start", headers=auth)
    assert started.status_code == 200, started.text
    for _ in range(60):
        current = server.services.run_repo.get(run_id, owner_user_id=owner_id)
        if current is not None and current["status"] == "succeeded":
            break
        await asyncio.sleep(0.05)
    assert current is not None and current["status"] == "succeeded"
    assert len(observed) == 1 and "Use the approved terminology." in observed[0]
    assert "Task input:\nhello" in observed[0]
    steps = server.services.run_repo.list_steps(run_id, owner_user_id=owner_id)
    assert len(steps) == 1 and steps[0]["status"] == "succeeded"
    replay = await client.post(f"/api/runs/{run_id}/start", headers=auth)
    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "succeeded"

    other_auth = await create_user(client, auth, username="run-start-other")
    hidden = await client.post(f"/api/runs/{run_id}/start", headers=other_auth)
    assert hidden.status_code == 404, hidden.text

    missing = await client.post("/api/runs/does-not-exist/start", headers=auth)
    assert missing.status_code == 404, missing.text


async def test_parent_run_waits_for_its_team_dispatch(env_with_agent: Any) -> None:
    from octop.infra.run_context import current_run_context

    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    thread_id, message_id = "team-parent-thread", "team-parent-message"
    server.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="team-parent-session",
    )
    server.services.thread_message_repo.append_if_ready(
        thread_id,
        [
            ThreadMessageInput(
                message_id=message_id,
                role="human",
                message_json='{"type":"human","data":{"content":"hello"}}',
                created_at=1,
            )
        ],
    )

    async def fake_turn(_message: Any):
        context = current_run_context.get()
        assert context is not None and context.owner_user_id == owner_id
        await asyncio.to_thread(
            server.services.run_repo.create_team_dispatch,
            run_id="team-aggregate-child",
            step_id="team-aggregate-step",
            inbox_id="team-aggregate-inbox",
            owner_user_id=owner_id,
            team_agent_id=agent_id,
            member_agent_id="team-member",
            request_hash="team-aggregate-hash",
            parent_run_id=context.run_id,
        )
        yield {"type": "done"}

    server.app_runtime.gateway.processor.iter_turn_chunks = fake_turn
    created = await client.post(
        "/api/runs",
        headers=auth,
        json={"agent_id": agent_id, "thread_id": thread_id, "input_ref": message_id},
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]
    started = await client.post(f"/api/runs/{run_id}/start", headers=auth)
    assert started.status_code == 200, started.text
    for _ in range(100):
        child = server.services.run_repo.get("team-aggregate-child", owner_user_id=owner_id)
        if child is not None:
            break
        await asyncio.sleep(0.05)
    assert child is not None
    parent = server.services.run_repo.get(run_id, owner_user_id=owner_id)
    assert parent is not None and parent["status"] == "running"

    assert server.services.run_repo.finish_team_dispatch(
        "team-aggregate-inbox", owner_user_id=owner_id, outcome="done"
    )
    for _ in range(100):
        parent = server.services.run_repo.get(run_id, owner_user_id=owner_id)
        if parent is not None and parent["status"] == "succeeded":
            break
        await asyncio.sleep(0.05)
    assert parent is not None and parent["status"] == "succeeded"


async def test_run_fails_closed_when_agent_version_changes_before_execution(
    env_with_agent: Any,
) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    thread_id = "run-version-drift-thread"
    message_id = "run-version-drift-message"
    server.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="run-version-drift-session",
    )
    server.services.thread_message_repo.append_if_ready(
        thread_id,
        [
            ThreadMessageInput(
                message_id=message_id,
                role="human",
                message_json='{"type":"human","data":{"content":"do not execute"}}',
                created_at=1,
            )
        ],
    )
    created = await client.post(
        "/api/runs",
        headers=auth,
        json={"agent_id": agent_id, "thread_id": thread_id, "input_ref": message_id},
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]
    original_version_id = created.json()["agent_version_id"]

    agent = server.services.agent_repo.get(agent_id)
    assert agent is not None
    server.services.agent_repo.update_config(agent_id, name=f"{agent.name} changed")
    called = False

    async def forbidden_turn(_message: Any):
        nonlocal called
        called = True
        yield {"type": "done"}

    server.app_runtime.gateway.processor.iter_turn_chunks = forbidden_turn
    started = await client.post(f"/api/runs/{run_id}/start", headers=auth)
    assert started.status_code == 200, started.text

    current = None
    for _ in range(60):
        current = server.services.run_repo.get(run_id, owner_user_id=owner_id)
        if current is not None and current["status"] == "failed":
            break
        await asyncio.sleep(0.05)
    assert current is not None and current["status"] == "failed"
    assert current["agent_version_id"] == original_version_id
    assert not called


async def test_run_detail_step_and_event_responses_drop_unlisted_fields(
    env_with_agent: Any, monkeypatch: Any
) -> None:
    client, server, auth, agent_id = env_with_agent
    created = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    monkeypatch.setattr(
        server.services.run_repo,
        "list_events",
        lambda *_args, **_kwargs: [
            {
                "event_id": "event-safe-id",
                "run_id": run_id,
                "step_id": "step-safe-id",
                "sequence": 1,
                "type": "run.status_changed",
                "payload": {
                    "from": "running",
                    "to": "failed",
                    "error_code": "execution_failed",
                    "prompt": "private input",
                    "nested": {"token": "secret"},
                },
                "created_at": 1,
            }
        ],
    )
    monkeypatch.setattr(
        server.services.run_repo,
        "list_steps",
        lambda *_args, **_kwargs: [
            {
                "step_id": "step-safe-id",
                "run_id": run_id,
                "parent_step_id": "private-parent",
                "kind": "agent",
                "executor": "agent-1",
                "status": "failed",
                "attempt": 1,
                "version": 2,
                "error_summary": "private exception details",
                "created_at": 1,
                "updated_at": 1,
                "started_at": 1,
                "finished_at": 1,
            }
        ],
    )

    events = await client.get(f"/api/runs/{run_id}/events", headers=auth)
    assert events.status_code == 200, events.text
    assert events.json() == [
        {
            "event_id": "event-safe-id",
            "run_id": run_id,
            "step_id": "step-safe-id",
            "sequence": 1,
            "type": "run.status_changed",
            "payload": {"from": "running", "to": "failed", "error_code": "execution_failed"},
            "created_at": 1,
        }
    ]

    steps = await client.get(f"/api/runs/{run_id}/steps", headers=auth)
    assert steps.status_code == 200, steps.text
    assert steps.json() == [
        {
            "step_id": "step-safe-id",
            "run_id": run_id,
            "kind": "agent",
            "executor": "agent-1",
            "status": "failed",
            "attempt": 1,
            "created_at": 1,
            "updated_at": 1,
            "started_at": 1,
            "finished_at": 1,
        }
    ]


async def test_run_cancellation_is_owner_scoped_and_idempotent(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    created = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]

    other_auth = await create_user(client, auth, username="run-cancel-peer")
    hidden = await client.post(f"/api/runs/{run_id}/cancel", headers=other_auth)
    assert hidden.status_code == 404, hidden.text

    queued = server.services.run_repo.transition(
        run_id,
        owner_user_id=(await resolve_user_id(client, auth, "admin")),
        status="queued",
        expected_version=0,
    )
    assert queued is not None
    cancelled = await client.post(f"/api/runs/{run_id}/cancel", headers=auth)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancel_requested"

    repeated = await client.post(f"/api/runs/{run_id}/cancel", headers=auth)
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["status"] == cancelled.json()["status"] == "cancel_requested"
    assert "version" not in repeated.json()
    events = await client.get(f"/api/runs/{run_id}/events", headers=auth)
    assert [event["sequence"] for event in events.json()] == [1, 2, 3]


async def test_cancelling_waiting_approval_expires_pending_and_finishes_step(
    env_with_agent: Any,
) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    thread_id = "run-cancel-hitl-thread"
    server.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="run-cancel-hitl-session",
    )
    created = await client.post(
        "/api/runs",
        headers=auth,
        json={"agent_id": agent_id, "thread_id": thread_id},
    )
    assert created.status_code == 201, created.text
    run_id = created.json()["run_id"]
    for expected, status in enumerate(("queued", "running", "waiting_approval")):
        changed = server.services.run_repo.transition(
            run_id,
            owner_user_id=owner_id,
            status=status,
            expected_version=expected,
        )
        assert changed is not None
    step = server.services.run_repo.create_step(
        step_id="run-cancel-hitl-step",
        run_id=run_id,
        owner_user_id=owner_id,
        kind="agent",
        executor="test",
        parent_step_id=None,
    )
    step = server.services.run_repo.transition_step(
        step["step_id"],
        owner_user_id=owner_id,
        status="running",
        expected_version=int(step["version"]),
    )
    assert step is not None
    step = server.services.run_repo.transition_step(
        step["step_id"],
        owner_user_id=owner_id,
        status="waiting_approval",
        expected_version=int(step["version"]),
    )
    assert step is not None
    coordinator = server.app_runtime.gateway.processor.hitl_coordinator
    pending = coordinator.register_from_request(
        {"action_requests": [{"name": "send_email", "args": {"body": "private"}}]},
        ctx=HitlStreamContext(
            thread_id=thread_id,
            agent_id=agent_id,
            user_id=owner_id,
            session_key="run-cancel-hitl-session",
            channel_type="dashboard",
            run_id=run_id,
            step_id=str(step["step_id"]),
        ),
    )

    cancelled = await client.post(f"/api/runs/{run_id}/cancel", headers=auth)

    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "cancelled"
    assert coordinator.store.get(pending.pending_id).status == "expired"
    steps = server.services.run_repo.list_steps(run_id, owner_user_id=owner_id)
    assert len(steps) == 1 and steps[0]["status"] == "cancelled"


async def test_run_pins_project_instructions_at_creation(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    created_project = await client.post(
        "/api/workbench/projects", headers=auth, json={"name": "run-context"}
    )
    assert created_project.status_code == 201, created_project.text
    project_id = created_project.json()["project_id"]

    update = await client.put(
        f"/api/workbench/projects/{project_id}/context",
        headers=auth,
        json={"instructions": "First version", "expected_revision": 1},
    )
    assert update.status_code == 200, update.text

    first = await client.post(
        "/api/runs", headers=auth, json={"agent_id": agent_id, "project_id": project_id}
    )
    assert first.status_code == 201, first.text

    update = await client.put(
        f"/api/workbench/projects/{project_id}/context",
        headers=auth,
        json={"instructions": "Second version", "expected_revision": 2},
    )
    assert update.status_code == 200, update.text
    second = await client.post(
        "/api/runs", headers=auth, json={"agent_id": agent_id, "project_id": project_id}
    )
    assert second.status_code == 201, second.text

    owner_id = await resolve_user_id(client, auth, "admin")
    first_snapshot = server.services.run_repo.get(first.json()["run_id"], owner_user_id=owner_id)[
        "project_context_snapshot"
    ]
    assert first_snapshot["instructions_revision"] == 2
    assert first_snapshot["instructions"] == "First version"
    second_snapshot = server.services.run_repo.get(second.json()["run_id"], owner_user_id=owner_id)[
        "project_context_snapshot"
    ]
    assert second_snapshot["instructions_revision"] == 3
    assert second_snapshot["instructions"] == "Second version"


async def test_run_pins_immutable_agent_version(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    first = await client.post(
        "/api/runs",
        headers={**auth, "Idempotency-Key": "agent-version-run"},
        json={"agent_id": agent_id},
    )
    assert first.status_code == 201, first.text
    first_run = first.json()
    stored_first = server.services.agent_version_repo.get(
        first_run["agent_version_id"], agent_id=agent_id
    )
    assert stored_first is not None
    assert b"changed prompt" not in stored_first.snapshot_blob

    server.services.agent_repo.update_config(agent_id, system_prompt="changed prompt")
    second = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert second.status_code == 201, second.text
    assert second.json()["agent_version_id"] != first_run["agent_version_id"]
    stored_second = server.services.agent_version_repo.get(
        second.json()["agent_version_id"], agent_id=agent_id
    )
    assert stored_second is not None
    first_snapshot = read_agent_version_snapshot(
        stored_first, secret_repo=server.services.secret_repo
    )
    second_snapshot = read_agent_version_snapshot(
        stored_second, secret_repo=server.services.secret_repo
    )
    assert first_snapshot["system_prompt"] != "changed prompt"
    assert second_snapshot["system_prompt"] == "changed prompt"
    with pytest.raises(ValueError, match="snapshot hash mismatch"):
        read_agent_version_snapshot(
            replace(stored_first, content_hash="0" * 64),
            secret_repo=server.services.secret_repo,
        )
    server.services.agent_repo.update_config(agent_id, system_prompt="latest prompt")
    replay = await client.post(
        "/api/runs",
        headers={**auth, "Idempotency-Key": "agent-version-run"},
        json={"agent_id": agent_id},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["agent_version_id"] == first_run["agent_version_id"]
    assert server.services.agent_version_repo.get_alias(agent_id) == stored_second


async def test_agent_version_hash_normalizes_json_id_columns(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    server.services.agent_repo.update_config(agent_id, skill_package_ids='["skill-a"]')
    first = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert first.status_code == 201, first.text

    server.services.agent_repo.update_config(agent_id, skill_package_ids='[ "skill-a" ]')
    second = await client.post("/api/runs", headers=auth, json={"agent_id": agent_id})
    assert second.status_code == 201, second.text
    assert second.json()["agent_version_id"] == first.json()["agent_version_id"]


async def test_run_snapshots_only_owned_source_file_revisions(env_with_agent: Any) -> None:
    client, server, auth, agent_id = env_with_agent
    owner_id = await resolve_user_id(client, auth, "admin")
    file_bytes = b"synthetic source"
    file_repo = server.services.chat_file_repo
    server.services.thread_repo.insert(
        thread_id="run-source-thread",
        agent_id=agent_id,
        user_id=owner_id,
        channel_type="dashboard",
        session_key="run-source-thread",
    )
    file_repo.create_uploaded(
        file_id="run-source-file",
        revision_id="run-source-rev",
        user_id=owner_id,
        agent_id=agent_id,
        display_name="source.txt",
        workspace_path="inbound/source.txt",
        sha256=hashlib.sha256(file_bytes).hexdigest(),
        media_type="text/plain",
        byte_size=len(file_bytes),
    )
    assert file_repo.bind_thread(
        "run-source-file",
        user_id=owner_id,
        agent_id=agent_id,
        thread_id="run-source-thread",
        revision_id="run-source-rev",
        workspace_path="inbound/source.txt",
    )

    created = await client.post(
        "/api/runs",
        headers=auth,
        json={
            "agent_id": agent_id,
            "thread_id": "run-source-thread",
            "source_files": [{"file_id": "run-source-file", "revision_id": "run-source-rev"}],
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["source_file_revisions"] == [
        {
            "file_id": "run-source-file",
            "revision_id": "run-source-rev",
            "thread_id": "run-source-thread",
            "content_hash": hashlib.sha256(file_bytes).hexdigest(),
            "media_type": "text/plain",
            "byte_size": len(file_bytes),
        }
    ]
    stored = server.services.run_repo.get(created.json()["run_id"], owner_user_id=owner_id)
    assert stored is not None
    assert stored["source_file_revisions"] == [
        {
            "file_id": "run-source-file",
            "revision_id": "run-source-rev",
            "thread_id": "run-source-thread",
            "content_hash": hashlib.sha256(file_bytes).hexdigest(),
            "media_type": "text/plain",
            "byte_size": len(file_bytes),
        }
    ]

    peer_auth = await create_user(client, auth, username="run-source-peer")
    peer_agent = await create_agent(client, peer_auth, name="peer agent")
    peer_id = await resolve_user_id(client, auth, "run-source-peer")
    server.services.thread_repo.insert(
        thread_id="run-source-peer-thread",
        agent_id=peer_agent,
        user_id=peer_id,
        channel_type="dashboard",
        session_key="run-source-peer-thread",
    )
    forbidden = await client.post(
        "/api/runs",
        headers=peer_auth,
        json={
            "agent_id": peer_agent,
            "thread_id": "run-source-peer-thread",
            "source_files": [{"file_id": "run-source-file", "revision_id": "run-source-rev"}],
        },
    )
    assert forbidden.status_code == 404, forbidden.text
