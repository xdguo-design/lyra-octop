"""tests/unit/test_repo_cron.py"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.cron import CronJobRepo, CronJobRow
from octop.infra.db.repos.users import UserRepo
from octop.infra.gateway.threads import ThreadRegistry
from octop.infra.utils.ulid import new_ulid


@pytest.fixture
def db(tmp_path: Path) -> SqlitePool:
    pool = SqlitePool(tmp_path / "x.db")
    run_migrations(pool)
    return pool


@pytest.fixture
def agent_id(db: SqlitePool) -> str:
    uid = UserRepo(db).create(username="alice", password_hash="h", role="admin")
    aid = new_ulid()
    AgentRepo(db).create(agent_id=aid, user_id=uid, name="bot")
    return aid


@pytest.fixture
def user_id(db: SqlitePool) -> int:
    return UserRepo(db).get_by_username("alice").id


@pytest.fixture
def repo(db: SqlitePool) -> CronJobRepo:
    return CronJobRepo(db)


def _session_key(agent_id: str, user_id: int) -> str:
    return ThreadRegistry.dashboard_key(agent_id=agent_id, user_id=user_id)


def test_create_and_get(repo: CronJobRepo, agent_id: str, user_id: int):
    cid = new_ulid()
    repo.create(
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        name="Morning report",
        trigger="0 9 * * *",
        prompt="run report",
        session_key=_session_key(agent_id, user_id),
    )
    row = repo.get(cid)
    assert isinstance(row, CronJobRow)
    assert row.cron_id == cid
    assert row.name == "Morning report"
    assert row.trigger == "0 9 * * *"
    assert row.enabled == 1
    assert row.task_type == "agent"
    assert row.last_run_at is None
    assert row.to_public_dict()["name"] == "Morning report"


def test_create_with_task_type(repo: CronJobRepo, agent_id: str, user_id: int):
    cid = new_ulid()
    repo.create(
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        trigger="0 9 * * *",
        prompt="push only",
        session_key=_session_key(agent_id, user_id),
        task_type="text",
    )
    row = repo.get(cid)
    assert row is not None
    assert row.task_type == "text"
    repo.update(cid, task_type="agent")
    row = repo.get(cid)
    assert row is not None
    assert row.task_type == "agent"


def test_set_run_status(repo: CronJobRepo, agent_id: str, user_id: int):
    cid = new_ulid()
    repo.create(
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        trigger="0 9 * * *",
        prompt="run report",
        session_key=_session_key(agent_id, user_id),
    )
    ts = int(time.time())
    repo.set_run_status(cid, ts=ts, status="ok")
    row = repo.get(cid)
    assert row.last_run_at == ts
    assert row.last_status == "ok"
    assert row.last_error is None

    repo.set_run_status(cid, ts=ts + 1, status="error", error="boom")
    row = repo.get(cid)
    assert row.last_status == "error"
    assert row.last_error == "boom"


def test_run_history_is_owned_ordered_and_survives_job_deletion(
    repo: CronJobRepo, agent_id: str, user_id: int
):
    cid = new_ulid()
    repo.create(
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        trigger="interval:60",
        prompt="run report",
        session_key=_session_key(agent_id, user_id),
    )
    repo.start_run(
        run_id="run-old",
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        instance_id="instance-a",
        trigger_kind="manual",
        started_at=10,
    )
    repo.finish_run("run-old", status="ok", finished_at=11)
    repo.start_run(
        run_id="run-new",
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        instance_id="instance-a",
        trigger_kind="scheduled",
        started_at=20,
    )
    assert repo.finish_run("run-new", status="error", finished_at=21, error="oops")
    assert not repo.finish_run("run-new", status="ok", finished_at=22)

    rows = repo.list_runs(cron_id=cid, user_id=user_id, agent_id=agent_id, limit=1)
    assert rows[0]["run_id"] == "run-new"
    assert rows[0]["status"] == "error"
    assert repo.get_run("run-new", user_id=user_id + 1, agent_id=agent_id, cron_id=cid) is None
    repo.delete(cid)
    assert repo.list_runs(cron_id=cid, user_id=user_id, agent_id=agent_id)[0]["run_id"] == "run-new"


def test_mark_interrupted_runs_closes_only_active_runs(
    repo: CronJobRepo, agent_id: str, user_id: int
):
    repo.touch_instance("live-instance", heartbeat_at=19)
    repo.start_run(
        run_id="running",
        cron_id="deleted-job",
        agent_id=agent_id,
        user_id=user_id,
        instance_id="dead-instance",
        trigger_kind="manual",
        started_at=10,
    )
    repo.start_run(
        run_id="live-running",
        cron_id="deleted-job",
        agent_id=agent_id,
        user_id=user_id,
        instance_id="live-instance",
        trigger_kind="scheduled",
        started_at=11,
    )
    repo.start_run(
        run_id="finished",
        cron_id="deleted-job",
        agent_id=agent_id,
        user_id=user_id,
        instance_id="live-instance",
        trigger_kind="manual",
        started_at=12,
    )
    repo.finish_run("finished", status="ok", finished_at=13)
    assert (
        repo.mark_interrupted_runs(
            finished_at=20, stale_before=15, current_instance_id="new-instance"
        )
        == 1
    )
    assert (
        repo.get_run("running", user_id=user_id, agent_id=agent_id, cron_id="deleted-job")["status"]
        == "interrupted"
    )
    assert (
        repo.get_run("live-running", user_id=user_id, agent_id=agent_id, cron_id="deleted-job")[
            "status"
        ]
        == "running"
    )
    assert (
        repo.get_run("finished", user_id=user_id, agent_id=agent_id, cron_id="deleted-job")[
            "status"
        ]
        == "ok"
    )


def test_list_by_agent(repo: CronJobRepo, agent_id: str, user_id: int):
    sk = _session_key(agent_id, user_id)
    repo.create(
        cron_id=new_ulid(),
        agent_id=agent_id,
        user_id=user_id,
        trigger="* * * * *",
        prompt="p1",
        session_key=sk,
    )
    repo.create(
        cron_id=new_ulid(),
        agent_id=agent_id,
        user_id=user_id,
        trigger="* * * * *",
        prompt="p2",
        session_key=sk,
    )
    rows = repo.list_by_agent(agent_id)
    assert len(rows) == 2


def test_list_by_agent_can_filter_user(
    db: SqlitePool,
    repo: CronJobRepo,
    agent_id: str,
    user_id: int,
):
    other_user = UserRepo(db).create(username="bob", password_hash="h", role="user")
    repo.create(
        cron_id=new_ulid(),
        agent_id=agent_id,
        user_id=user_id,
        trigger="* * * * *",
        prompt="mine",
        session_key=_session_key(agent_id, user_id),
    )
    repo.create(
        cron_id=new_ulid(),
        agent_id=agent_id,
        user_id=other_user,
        trigger="* * * * *",
        prompt="theirs",
        session_key=_session_key(agent_id, other_user),
    )

    rows = repo.list_by_agent(agent_id, user_id=user_id)

    assert len(rows) == 1
    assert rows[0].prompt == "mine"


def test_update_partial(repo: CronJobRepo, agent_id: str, user_id: int):
    cid = new_ulid()
    repo.create(
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        trigger="0 9 * * *",
        prompt="run report",
        session_key=_session_key(agent_id, user_id),
    )
    repo.update(cid, trigger="0 10 * * *", enabled=False)
    row = repo.get(cid)
    assert row.trigger == "0 10 * * *"
    assert row.enabled == 0
    assert row.prompt == "run report"


def test_delete(repo: CronJobRepo, agent_id: str, user_id: int):
    cid = new_ulid()
    repo.create(
        cron_id=cid,
        agent_id=agent_id,
        user_id=user_id,
        trigger="0 9 * * *",
        prompt="run report",
        session_key=_session_key(agent_id, user_id),
    )
    repo.delete(cid)
    assert repo.get(cid) is None
