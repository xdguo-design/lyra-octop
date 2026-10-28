from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos._base import now_ts
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.app_registry import AppRegistryRepo
from octop.infra.db.repos.hitl_approvals import HitlApprovalRepo
from octop.infra.db.repos.run_effects import EffectIdempotencyConflict, RunEffectRepo
from octop.infra.db.repos.runs import RunRepo
from octop.infra.db.repos.users import UserRepo


def test_effect_ledger_rechecks_grant_and_approval_and_reconciles(tmp_path: Path) -> None:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    owner_id = UserRepo(db).create(username="effect-owner", password_hash="h", role="user")
    AgentRepo(db).create(agent_id="effect-agent", user_id=owner_id, name="Effect agent")
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO threads(thread_id, agent_id, user_id, channel_type, session_key, "
            "last_active, created_at) VALUES ('effect-thread', 'effect-agent', ?, 'web', 's', 1, 1)",
            (owner_id,),
        )

    app_repo = AppRegistryRepo(db)
    app = app_repo.create_registration(
        owner_user_id=owner_id, app_key="admission-registration", display_name="Admission"
    )
    assert app is not None
    grant = app_repo.save_grant(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="effect-agent",
        read_scopes=[],
        write_scopes=["admission.narrative.write"],
        expires_at=None,
    )
    assert grant is not None

    approvals = HitlApprovalRepo(db)
    approval_expires_at = now_ts() + 3_600
    approvals.create(
        pending_id="approval-1",
        user_id=owner_id,
        agent_id="effect-agent",
        thread_id="effect-thread",
        session_key="s",
        channel_type="web",
        resume_agent_id=None,
        resume_thread_id=None,
        request_blob=b"encrypted",
        tools=["mock_write"],
        expires_at=approval_expires_at,
    )
    assert approvals.resolve(
        "approval-1",
        "approved",
        actor=f"user:{owner_id}",
        agent_id="effect-agent",
        thread_id="effect-thread",
    )

    runs = RunRepo(db)
    run, _ = runs.create(
        run_id="effect-run",
        owner_user_id=owner_id,
        agent_id="effect-agent",
        project_id=None,
        parent_run_id=None,
        input_ref=None,
        idempotency_key=None,
        request_hash="request",
        created_at=100,
    )
    assert runs.transition(
        "effect-run", owner_user_id=owner_id, status="queued", expected_version=0
    )
    assert runs.transition(
        "effect-run", owner_user_id=owner_id, status="running", expected_version=1
    )
    runs.create_step(
        step_id="effect-step",
        run_id=str(run["run_id"]),
        owner_user_id=owner_id,
        kind="tool",
        executor="mock_write",
        parent_step_id=None,
        created_at=100,
    )
    assert runs.transition_step(
        "effect-step", owner_user_id=owner_id, status="running", expected_version=0
    )

    effects = RunEffectRepo(db)
    payload = {
        "owner_user_id": owner_id,
        "run_id": "effect-run",
        "step_id": "effect-step",
        "agent_id": "effect-agent",
        "thread_id": "effect-thread",
        "registration_id": app["registration_id"],
        "scope": "admission.narrative.write",
        "resource_hash": hashlib.sha256(b"patient-1").hexdigest(),
        "request_hash": hashlib.sha256(b"write body").hexdigest(),
        "idempotency_key": "effect-run-step-1",
        "approval_id": "approval-1",
        "now": now_ts(),
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        concurrent = list(pool.map(lambda _: effects.request(**payload), range(2)))
    assert sum(created for _, created in concurrent) == 1
    effect = concurrent[0][0]
    replay, created = effects.request(**payload)
    assert not created
    assert replay["effect_id"] == effect["effect_id"]
    assert len({row["effect_id"] for row, _ in concurrent}) == 1
    with pytest.raises(EffectIdempotencyConflict):
        effects.request(**{**payload, "request_hash": hashlib.sha256(b"different").hexdigest()})
    with pytest.raises(PermissionError, match="current owner approval"):
        effects.request(
            **{**payload, "thread_id": "other-thread", "idempotency_key": "wrong-thread"}
        )

    assert (
        effects.resolve(
            effect["effect_id"], owner_user_id=owner_id, status="unknown", now=now_ts() + 1
        )["status"]
        == "unknown"
    )
    resolved = effects.resolve(
        effect["effect_id"],
        owner_user_id=owner_id,
        status="succeeded",
        result_hash=hashlib.sha256(b"receipt").hexdigest(),
        now=now_ts() + 2,
    )
    assert resolved is not None and resolved["status"] == "succeeded"
    assert len(effects.list_for_run("effect-run", owner_user_id=owner_id)) == 1
    pending_effect, created = effects.request(
        **{**payload, "idempotency_key": "terminal-run-pending-effect"}
    )
    assert created and pending_effect["status"] == "requested"

    assert app_repo.revoke_grant(owner_user_id=owner_id, grant_id=grant["grant_id"])
    with pytest.raises(PermissionError, match="active write grant"):
        effects.request(**{**payload, "idempotency_key": "after-revoke", "now": now_ts() + 3})
    with pytest.raises(ValueError, match="invalid external effect transition"):
        effects.resolve(effect["effect_id"], owner_user_id=owner_id, status="failed")

    assert runs.transition(
        "effect-run", owner_user_id=owner_id, status="succeeded", expected_version=2
    )
    assert effects.reconcile_terminal_runs(now=now_ts() + 4) == 1
    assert effects.reconcile_terminal_runs(now=now_ts() + 5) == 0
    terminal_effects = effects.list_for_run("effect-run", owner_user_id=owner_id)
    pending_result = next(
        row for row in terminal_effects if row["effect_id"] == pending_effect["effect_id"]
    )
    assert pending_result["status"] == "unknown"

    events = runs.list_events("effect-run", owner_user_id=owner_id)
    effect_events = [event for event in events if event["type"].startswith("external_effect.")]
    assert [event["type"] for event in effect_events] == [
        "external_effect.requested",
        "external_effect.unknown",
        "external_effect.succeeded",
        "external_effect.requested",
        "external_effect.unknown",
    ]
    assert all("request" not in str(event["payload"]).lower() for event in effect_events)
