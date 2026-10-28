from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.runs import (
    MAX_RUN_EVENTS,
    RunEventLimitExceeded,
    RunIdempotencyConflict,
    RunRepo,
)
from octop.infra.db.repos.users import UserRepo


@pytest.fixture
def run_repo(tmp_path: Path) -> tuple[SqlitePool, RunRepo, int, int]:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    users = UserRepo(db)
    owner_id = users.create(username="run-owner", password_hash="h", role="user")
    other_id = users.create(username="run-other", password_hash="h", role="user")
    AgentRepo(db).create(agent_id="run-agent", user_id=owner_id, name="Run agent")
    return db, RunRepo(db), owner_id, other_id


def _create(repo: RunRepo, owner_id: int, run_id: str = "run-1") -> dict[str, object]:
    run, replayed = repo.create(
        run_id=run_id,
        owner_user_id=owner_id,
        agent_id="run-agent",
        project_id=None,
        parent_run_id=None,
        input_ref="thread:thread-1/message:message-1",
        idempotency_key="request-1",
        request_hash="hash-1",
        created_at=100,
    )
    assert not replayed
    return run


def test_create_run_is_idempotent_and_detects_key_reuse(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
):
    _db, repo, owner_id, _other_id = run_repo
    first = _create(repo, owner_id)
    replay, replayed = repo.create(
        run_id="ignored-new-id",
        owner_user_id=owner_id,
        agent_id="run-agent",
        project_id=None,
        parent_run_id=None,
        input_ref="thread:thread-1/message:message-1",
        idempotency_key="request-1",
        request_hash="hash-1",
        created_at=200,
    )
    assert replayed
    assert replay["run_id"] == first["run_id"]
    with pytest.raises(RunIdempotencyConflict):
        repo.create(
            run_id="different-id",
            owner_user_id=owner_id,
            agent_id="run-agent",
            project_id=None,
            parent_run_id=None,
            input_ref="different-input",
            idempotency_key="request-1",
            request_hash="different-hash",
            created_at=200,
        )

    other_owner_run, replayed = repo.create(
        run_id="other-owner-run",
        owner_user_id=_other_id,
        agent_id="run-agent",
        project_id=None,
        parent_run_id=None,
        input_ref=None,
        idempotency_key="request-1",
        request_hash="hash-1",
        created_at=200,
    )
    assert not replayed
    assert other_owner_run["run_id"] == "other-owner-run"


def test_run_artifact_schema_repairs_databases_already_at_current_version(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, _repo, _owner_id, _other_id = run_repo
    with db.transaction() as conn:
        conn.execute("DROP TABLE run_artifacts")

    run_migrations(db)

    with db.connect() as conn:
        table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_artifacts'"
        ).fetchone()
    assert table is not None


def test_parent_run_must_belong_to_the_same_owner(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, other_id = run_repo
    parent = _create(repo, owner_id)
    with pytest.raises(KeyError, match="parent run not found"):
        repo.create(
            run_id="child-run",
            owner_user_id=other_id,
            agent_id="run-agent",
            project_id=None,
            parent_run_id=str(parent["run_id"]),
            input_ref=None,
            idempotency_key=None,
            request_hash="child-hash",
        )


def test_run_lease_heartbeat_and_expiry_interrupt_without_requeue(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    _create(repo, owner_id)
    assert repo.transition(
        "run-1", owner_user_id=owner_id, status="queued", expected_version=0, updated_at=10
    )
    repo.create_step(
        step_id="step-1",
        run_id="run-1",
        owner_user_id=owner_id,
        kind="agent",
        executor="harness",
        parent_step_id=None,
        created_at=10,
    )
    assert repo.transition_step(
        "step-1", owner_user_id=owner_id, status="running", expected_version=0, updated_at=10
    )

    claimed = repo.claim_next(executor_id="executor-a", lease_seconds=10, now=20)
    assert claimed is not None
    assert claimed["status"] == "running"
    assert claimed["lease_expires_at"] == 30
    assert claimed["run_attempt"] == 1
    assert not repo.heartbeat("run-1", executor_id="executor-b", now=25)
    assert repo.heartbeat("run-1", executor_id="executor-a", lease_seconds=10, now=25)
    assert repo.reconcile_expired_leases(now=34) == 0
    assert repo.reconcile_expired_leases(now=35) == 1
    assert repo.reconcile_expired_leases(now=36) == 0
    interrupted = repo.get("run-1", owner_user_id=owner_id)
    assert interrupted["status"] == "interrupted"
    assert interrupted["finished_at"] == 35
    steps = repo.list_steps("run-1", owner_user_id=owner_id)
    assert steps[0]["status"] == "interrupted"
    assert steps[0]["finished_at"] == 35
    assert steps[0]["attempt"] == 1
    assert repo.claim_next(executor_id="executor-b", now=40) is None


def test_only_one_executor_claims_a_queued_run(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    _create(repo, owner_id)
    repo.transition("run-1", owner_user_id=owner_id, status="queued", expected_version=0)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(
            pool.map(
                lambda executor: repo.claim_next(executor_id=executor, now=10),
                ("executor-a", "executor-b"),
            )
        )
    assert sum(claim is not None for claim in claims) == 1


def test_team_inbox_is_mapped_to_one_private_run_step_and_completes_idempotently(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, other_id = run_repo
    args = {
        "run_id": "team-run-1",
        "step_id": "team-step-1",
        "inbox_id": "inbox-1",
        "owner_user_id": owner_id,
        "team_agent_id": "run-agent",
        "member_agent_id": "member-1",
        "request_hash": "request-hash",
    }
    run, step, replayed = repo.create_team_dispatch(**args)
    assert not replayed
    assert run["status"] == step["status"] == "queued"
    assert step["inbox_id"] == "inbox-1"

    replay, replay_step, replayed = repo.create_team_dispatch(
        **{**args, "run_id": "ignored-run", "step_id": "ignored-step"}
    )
    assert replayed
    assert replay["run_id"] == run["run_id"]
    assert replay_step["step_id"] == step["step_id"]

    assert not repo.start_team_dispatch("inbox-1", owner_user_id=other_id)
    with ThreadPoolExecutor(max_workers=8) as executor:
        starts = list(
            executor.map(
                lambda _: repo.start_team_dispatch("inbox-1", owner_user_id=owner_id),
                range(8),
            )
        )
    assert all(starts)
    assert repo.finish_team_dispatch("inbox-1", owner_user_id=owner_id, outcome="done")
    assert repo.finish_team_dispatch("inbox-1", owner_user_id=owner_id, outcome="done")
    assert not repo.finish_team_dispatch("inbox-1", owner_user_id=other_id, outcome="failed")

    final = repo.get(str(run["run_id"]), owner_user_id=owner_id)
    steps = repo.list_steps(str(run["run_id"]), owner_user_id=owner_id)
    events = repo.list_events(str(run["run_id"]), owner_user_id=owner_id)
    assert final is not None and final["status"] == "succeeded"
    assert len(steps) == 1 and steps[0]["status"] == "succeeded"
    assert [event["sequence"] for event in events] == list(range(1, 7))
    assert [event["payload"] for event in events] == [
        {"source": "team"},
        {"kind": "team_dispatch", "executor": "member-1"},
        {"from": "queued", "to": "running"},
        {"from": "queued", "to": "running"},
        {"from": "running", "to": "succeeded"},
        {"from": "running", "to": "succeeded"},
    ]


def test_team_dispatch_inherits_owner_project_and_parent_run(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    parent, _ = repo.create(
        run_id="team-parent-run",
        owner_user_id=owner_id,
        agent_id="run-agent",
        project_id="project-1",
        parent_run_id=None,
        input_ref="message-1",
        idempotency_key="team-parent-key",
        request_hash="team-parent-hash",
        thread_id="thread-1",
    )
    assert repo.transition(
        str(parent["run_id"]), owner_user_id=owner_id, status="queued", expected_version=0
    )
    assert repo.transition(
        str(parent["run_id"]), owner_user_id=owner_id, status="running", expected_version=1
    )

    child, _step, _ = repo.create_team_dispatch(
        run_id="team-child-run",
        step_id="team-child-step",
        inbox_id="team-child-inbox",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="team-child-hash",
        parent_run_id=str(parent["run_id"]),
    )

    assert child["parent_run_id"] == parent["run_id"]
    assert child["project_id"] == parent["project_id"]
    assert child["thread_id"] == parent["thread_id"]


def test_team_dispatch_cannot_be_added_after_parent_cancellation(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, repo, owner_id, _other_id = run_repo
    _create(repo, owner_id)
    repo.transition("run-1", owner_user_id=owner_id, status="queued", expected_version=0)
    repo.transition("run-1", owner_user_id=owner_id, status="running", expected_version=1)
    other_db = SqlitePool(db.path)
    other_repo = RunRepo(other_db)
    barrier = Barrier(2)

    def cancel() -> dict[str, object] | None:
        barrier.wait()
        return repo.transition(
            "run-1", owner_user_id=owner_id, status="cancel_requested", expected_version=2
        )

    def dispatch() -> dict[str, object] | None:
        barrier.wait()
        try:
            child, _step, _replayed = other_repo.create_team_dispatch(
                run_id="racing-child",
                step_id="racing-step",
                inbox_id="racing-inbox",
                owner_user_id=owner_id,
                team_agent_id="run-agent",
                member_agent_id="member-1",
                request_hash="racing-hash",
                parent_run_id="run-1",
            )
            return child
        except KeyError:
            return None

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            cancelling = executor.submit(cancel)
            creating = executor.submit(dispatch)
            assert cancelling.result() is not None
            child = creating.result()
        children = repo.list_children("run-1", owner_user_id=owner_id)
        assert children is not None
        assert [item["run_id"] for item in children] == (["racing-child"] if child else [])
        with pytest.raises(KeyError, match="parent run not found"):
            other_repo.create_team_dispatch(
                run_id="late-child",
                step_id="late-step",
                inbox_id="late-inbox",
                owner_user_id=owner_id,
                team_agent_id="run-agent",
                member_agent_id="member-1",
                request_hash="late-hash",
                parent_run_id="run-1",
            )
    finally:
        other_db.close()


@pytest.mark.parametrize(
    ("outcome", "expected_run", "expected_step", "expected_error"),
    [
        ("done", "succeeded", "succeeded", None),
        ("failed", "failed", "failed", "team_member_failed"),
        ("interrupted", "interrupted", "interrupted", None),
        ("cancelled", "interrupted", "interrupted", None),
    ],
)
def test_parent_completion_waits_for_team_dispatch_and_aggregates_outcome(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
    outcome: str,
    expected_run: str,
    expected_step: str,
    expected_error: str | None,
) -> None:
    _db, repo, owner_id, other_id = run_repo
    _create(repo, owner_id)
    repo.transition("run-1", owner_user_id=owner_id, status="queued", expected_version=0)
    assert repo.claim_next(executor_id="executor-1", lease_seconds=300, now=100)
    step = repo.create_step(
        step_id="parent-step",
        run_id="run-1",
        owner_user_id=owner_id,
        kind="agent",
        executor="harness",
        parent_step_id=None,
        created_at=101,
    )
    assert repo.transition_step(
        "parent-step",
        owner_user_id=owner_id,
        status="running",
        expected_version=int(step["version"]),
    )
    repo.create_team_dispatch(
        run_id="child-run",
        step_id="child-step",
        inbox_id="child-inbox",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="child-hash",
        parent_run_id="run-1",
    )

    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=other_id,
            executor_id="executor-1",
            outcome="succeeded",
            now=101,
        )
        is None
    )
    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="other",
            outcome="succeeded",
            now=101,
        )
        is None
    )
    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="executor-1",
            outcome="succeeded",
            now=400,
        )
        is None
    )
    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="executor-1",
            outcome="succeeded",
            now=101,
        )
        is False
    )
    assert repo.finish_team_dispatch("child-inbox", owner_user_id=owner_id, outcome=outcome)
    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="executor-1",
            outcome="succeeded",
            now=101,
        )
        is True
    )

    parent = repo.get("run-1", owner_user_id=owner_id)
    steps = repo.list_steps("run-1", owner_user_id=owner_id)
    assert parent is not None and parent["status"] == expected_run
    assert steps[0]["status"] == expected_step
    assert steps[0]["error_summary"] == expected_error


def test_parent_completion_and_new_team_dispatch_are_serialized(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, repo, owner_id, _other_id = run_repo
    _create(repo, owner_id)
    repo.transition("run-1", owner_user_id=owner_id, status="queued", expected_version=0)
    assert repo.claim_next(executor_id="executor-1", lease_seconds=300, now=100)
    step = repo.create_step(
        step_id="parent-step",
        run_id="run-1",
        owner_user_id=owner_id,
        kind="agent",
        executor="harness",
        parent_step_id=None,
    )
    repo.transition_step(
        "parent-step",
        owner_user_id=owner_id,
        status="running",
        expected_version=int(step["version"]),
    )
    other_db = SqlitePool(db.path)
    other_repo = RunRepo(other_db)
    barrier = Barrier(2)

    def finish() -> bool | None:
        barrier.wait()
        return repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="executor-1",
            outcome="succeeded",
            now=101,
        )

    def dispatch() -> bool:
        barrier.wait()
        try:
            other_repo.create_team_dispatch(
                run_id="new-team-child",
                step_id="new-team-step",
                inbox_id="new-team-inbox",
                owner_user_id=owner_id,
                team_agent_id="run-agent",
                member_agent_id="member-1",
                request_hash="new-team-hash",
                parent_run_id="run-1",
            )
            return True
        except KeyError:
            return False

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            finishing = executor.submit(finish)
            creating = executor.submit(dispatch)
            finished, created = finishing.result(), creating.result()
        assert (finished, created) in {(True, False), (False, True)}
        parent = repo.get("run-1", owner_user_id=owner_id)
        assert parent is not None
        assert parent["status"] == ("succeeded" if finished else "running")
    finally:
        other_db.close()


def test_parent_waits_for_team_child_before_entering_approval(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, repo, owner_id, _other_id = run_repo
    _create(repo, owner_id)
    repo.transition("run-1", owner_user_id=owner_id, status="queued", expected_version=0)
    assert repo.claim_next(executor_id="executor-1", lease_seconds=300, now=100)
    step = repo.create_step(
        step_id="parent-step",
        run_id="run-1",
        owner_user_id=owner_id,
        kind="agent",
        executor="harness",
        parent_step_id=None,
    )
    repo.transition_step(
        "parent-step",
        owner_user_id=owner_id,
        status="running",
        expected_version=int(step["version"]),
    )
    repo.create_team_dispatch(
        run_id="child-run",
        step_id="child-step",
        inbox_id="child-inbox",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="child-hash",
        parent_run_id="run-1",
    )

    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="executor-1",
            outcome="waiting_approval",
            now=101,
        )
        is False
    )
    assert repo.finish_team_dispatch("child-inbox", owner_user_id=owner_id, outcome="done")
    assert (
        repo.finish_agent_run(
            "run-1",
            step_id="parent-step",
            owner_user_id=owner_id,
            executor_id="executor-1",
            outcome="waiting_approval",
            now=102,
        )
        is True
    )
    parent = repo.get("run-1", owner_user_id=owner_id)
    steps = repo.list_steps("run-1", owner_user_id=owner_id)
    assert parent is not None and parent["status"] == "waiting_approval"
    with db.connect() as conn:
        lease_owner = conn.execute(
            "SELECT lease_owner FROM runs WHERE run_id = ?", ("run-1",)
        ).fetchone()["lease_owner"]
    assert lease_owner is None
    assert steps[0]["status"] == "waiting_approval"
    assert steps[0]["finished_at"] is None


@pytest.mark.parametrize(
    ("started", "cancel_requested", "expected_run", "expected_step"),
    [
        (False, False, "interrupted", "interrupted"),
        (True, False, "unknown_external_effect", "interrupted"),
        (False, True, "cancelled", "cancelled"),
    ],
)
def test_startup_reconciles_orphaned_team_dispatches_without_replay(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
    started: bool,
    cancel_requested: bool,
    expected_run: str,
    expected_step: str,
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    repo.create_team_dispatch(
        run_id="orphaned-child",
        step_id="orphaned-step",
        inbox_id="orphaned-inbox",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="orphaned-hash",
        parent_run_id=None,
        lease_owner="team-dispatch-old",
        lease_seconds=5,
    )
    if started:
        assert repo.start_team_dispatch(
            "orphaned-inbox",
            owner_user_id=owner_id,
            executor_id="team-dispatch-old",
        )
    elif cancel_requested:
        assert repo.transition(
            "orphaned-child",
            owner_user_id=owner_id,
            status="cancel_requested",
            expected_version=0,
        )

    assert repo.reconcile_orphaned_team_dispatches(now=10**12) == 1
    child = repo.get("orphaned-child", owner_user_id=owner_id)
    steps = repo.list_steps("orphaned-child", owner_user_id=owner_id)
    assert child is not None and child["status"] == expected_run
    assert steps[0]["status"] == expected_step
    assert [event["type"] for event in repo.list_events("orphaned-child", owner_user_id=owner_id)][
        -2:
    ] == ["run.status_changed", "step.status_changed"]
    assert repo.reconcile_orphaned_team_dispatches(now=10**12 + 1) == 0


def test_team_dispatch_lease_heartbeat_fences_other_workers(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, repo, owner_id, _other_id = run_repo
    repo.create_team_dispatch(
        run_id="leased-child",
        step_id="leased-step",
        inbox_id="leased-inbox",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="leased-hash",
        lease_owner="team-dispatch-live",
        lease_seconds=5,
    )
    assert repo.start_team_dispatch(
        "leased-inbox",
        owner_user_id=owner_id,
        executor_id="team-dispatch-live",
    )
    with db.transaction() as conn:
        conn.execute("UPDATE runs SET max_runtime_seconds = 10 WHERE run_id = ?", ("leased-child",))
    with db.connect() as conn:
        started_at = int(
            conn.execute(
                "SELECT started_at FROM runs WHERE run_id = ?", ("leased-child",)
            ).fetchone()["started_at"]
        )
    now = started_at + 1
    assert not repo.heartbeat_team_dispatch(
        "leased-inbox",
        owner_user_id=owner_id,
        executor_id="other-worker",
        now=now,
    )
    assert repo.heartbeat_team_dispatch(
        "leased-inbox",
        owner_user_id=owner_id,
        executor_id="team-dispatch-live",
        lease_seconds=30,
        now=now,
    )
    with db.connect() as conn:
        lease_expires_at = int(
            conn.execute(
                "SELECT lease_expires_at FROM runs WHERE run_id = ?", ("leased-child",)
            ).fetchone()["lease_expires_at"]
        )
    assert lease_expires_at == started_at + 10
    assert repo.reconcile_orphaned_team_dispatches(now=started_at + 9) == 0
    assert repo.reconcile_orphaned_team_dispatches(now=started_at + 11) == 1


def test_expired_queued_team_dispatch_is_claimed_without_replaying_running_work(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, repo, owner_id, _other_id = run_repo
    for suffix in ("queued", "running"):
        repo.create_team_dispatch(
            run_id=f"recovery-{suffix}",
            step_id=f"recovery-step-{suffix}",
            inbox_id=f"recovery-inbox-{suffix}",
            owner_user_id=owner_id,
            team_agent_id="run-agent",
            member_agent_id="member-1",
            request_hash=f"recovery-hash-{suffix}",
            encrypted_payload=f"ciphertext-{suffix}".encode(),
            lease_owner="team-dispatch-old",
            lease_seconds=30,
        )
    assert repo.start_team_dispatch(
        "recovery-inbox-running",
        owner_user_id=owner_id,
        executor_id="team-dispatch-old",
    )
    with db.transaction() as conn:
        conn.execute(
            "UPDATE runs SET lease_expires_at = 1 WHERE run_id IN (?, ?)",
            ("recovery-queued", "recovery-running"),
        )

    claimed = repo.claim_expired_team_dispatches(executor_id="team-dispatch-new")

    assert [row["inbox_id"] for row in claimed] == ["recovery-inbox-queued"]
    assert claimed[0]["payload_blob"] == b"ciphertext-queued"
    assert not repo.start_team_dispatch(
        "recovery-inbox-queued",
        owner_user_id=owner_id,
        executor_id="team-dispatch-old",
    )
    assert repo.start_team_dispatch(
        "recovery-inbox-queued",
        owner_user_id=owner_id,
        executor_id="team-dispatch-new",
    )
    assert repo.claim_expired_team_dispatches(executor_id="team-dispatch-third") == []
    assert all(
        "payload_blob" not in step
        for step in repo.list_steps("recovery-queued", owner_user_id=owner_id)
    )
    assert repo.finish_team_dispatch(
        "recovery-inbox-queued", owner_user_id=owner_id, outcome="done"
    )
    with db.connect() as conn:
        assert (
            conn.execute(
                "SELECT 1 FROM team_dispatch_payloads WHERE inbox_id = ?",
                ("recovery-inbox-queued",),
            ).fetchone()
            is None
        )


def test_queued_team_dispatch_failure_stores_only_a_fixed_error_code(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run, step, _ = repo.create_team_dispatch(
        run_id="team-run-fail",
        step_id="team-step-fail",
        inbox_id="inbox-fail",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="request-hash-fail",
    )

    assert repo.finish_team_dispatch("inbox-fail", owner_user_id=owner_id, outcome="failed")

    failed = repo.list_steps(str(run["run_id"]), owner_user_id=owner_id)[0]
    assert failed["status"] == "failed"
    assert failed["error_summary"] == "team_member_failed"
    assert repo.list_events(str(run["run_id"]), owner_user_id=owner_id)[-1]["payload"] == {
        "from": "queued",
        "to": "failed",
        "error_code": "team_member_failed",
    }


def test_concurrent_conflicting_team_callbacks_keep_one_terminal_result(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run, _step, _ = repo.create_team_dispatch(
        run_id="team-run-race",
        step_id="team-step-race",
        inbox_id="inbox-race",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="request-hash-race",
    )
    assert repo.start_team_dispatch("inbox-race", owner_user_id=owner_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(
            executor.map(
                lambda outcome: repo.finish_team_dispatch(
                    "inbox-race", owner_user_id=owner_id, outcome=outcome
                ),
                ("done", "failed"),
            )
        )

    assert sum(outcomes) == 1
    stored = repo.get(str(run["run_id"]), owner_user_id=owner_id)
    steps = repo.list_steps(str(run["run_id"]), owner_user_id=owner_id)
    assert stored is not None
    assert stored["status"] in {"succeeded", "failed"}
    assert len(steps) == 1 and steps[0]["status"] == stored["status"]
    late_outcome = "failed" if stored["status"] == "succeeded" else "done"
    assert not repo.finish_team_dispatch("inbox-race", owner_user_id=owner_id, outcome=late_outcome)


def test_cancelled_team_dispatch_closes_run_and_step_after_cancel_request(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run, _step, _ = repo.create_team_dispatch(
        run_id="team-run-cancel",
        step_id="team-step-cancel",
        inbox_id="inbox-cancel",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="request-hash-cancel",
    )
    assert repo.start_team_dispatch("inbox-cancel", owner_user_id=owner_id)
    assert (
        repo.transition(
            str(run["run_id"]),
            owner_user_id=owner_id,
            status="cancel_requested",
            expected_version=1,
        )
        is not None
    )

    assert repo.finish_team_dispatch("inbox-cancel", owner_user_id=owner_id, outcome="cancelled")
    assert repo.finish_team_dispatch("inbox-cancel", owner_user_id=owner_id, outcome="cancelled")
    final = repo.get(str(run["run_id"]), owner_user_id=owner_id)
    steps = repo.list_steps(str(run["run_id"]), owner_user_id=owner_id)
    assert final is not None and final["status"] == "cancelled"
    assert len(steps) == 1 and steps[0]["status"] == "cancelled"


def test_interrupted_team_dispatch_records_terminal_run_and_step(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run, _step, _ = repo.create_team_dispatch(
        run_id="team-run-interrupted",
        step_id="team-step-interrupted",
        inbox_id="inbox-interrupted",
        owner_user_id=owner_id,
        team_agent_id="run-agent",
        member_agent_id="member-1",
        request_hash="request-hash-interrupted",
    )
    assert repo.start_team_dispatch("inbox-interrupted", owner_user_id=owner_id)
    assert repo.finish_team_dispatch(
        "inbox-interrupted", owner_user_id=owner_id, outcome="interrupted"
    )
    final = repo.get(str(run["run_id"]), owner_user_id=owner_id)
    steps = repo.list_steps(str(run["run_id"]), owner_user_id=owner_id)
    assert final is not None and final["status"] == "interrupted"
    assert len(steps) == 1 and steps[0]["status"] == "interrupted"


def test_run_events_have_monotonic_sequence_and_owner_scope(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, other_id = run_repo
    run = _create(repo, owner_id)
    assert [
        event["sequence"] for event in repo.list_events(run["run_id"], owner_user_id=owner_id)
    ] == [1]
    queued = repo.transition(
        run["run_id"], owner_user_id=owner_id, status="queued", expected_version=0, updated_at=110
    )
    assert queued is not None and queued["version"] == 1
    assert [
        event["sequence"] for event in repo.list_events(run["run_id"], owner_user_id=owner_id)
    ] == [1, 2]
    assert repo.get(run["run_id"], owner_user_id=other_id) is None
    assert repo.list_events(run["run_id"], owner_user_id=other_id) == []


def test_invalid_or_stale_run_transition_is_rejected(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)
    with pytest.raises(ValueError, match="invalid run transition"):
        repo.transition(
            run["run_id"],
            owner_user_id=owner_id,
            status="succeeded",
            expected_version=0,
            updated_at=110,
        )
    assert (
        repo.transition(
            run["run_id"],
            owner_user_id=owner_id,
            status="queued",
            expected_version=0,
            updated_at=110,
        )
        is not None
    )
    assert (
        repo.transition(
            run["run_id"],
            owner_user_id=owner_id,
            status="running",
            expected_version=0,
            updated_at=120,
        )
        is None
    )


def test_step_lifecycle_is_bound_to_run_and_updates_parent_events(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)
    step = repo.create_step(
        step_id="step-1",
        run_id=run["run_id"],
        owner_user_id=owner_id,
        kind="agent",
        executor="run-agent",
        parent_step_id=None,
        created_at=120,
    )
    assert step["status"] == "queued"
    started = repo.transition_step(
        step["step_id"],
        owner_user_id=owner_id,
        status="running",
        expected_version=0,
        updated_at=130,
    )
    assert started is not None and started["started_at"] == 130
    finished = repo.transition_step(
        step["step_id"],
        owner_user_id=owner_id,
        status="succeeded",
        expected_version=1,
        updated_at=140,
    )
    assert finished is not None and finished["finished_at"] == 140
    assert [event["type"] for event in repo.list_events(run["run_id"], owner_user_id=owner_id)] == [
        "run.created",
        "step.created",
        "step.status_changed",
        "step.status_changed",
    ]
    assert repo.list_steps(run["run_id"], owner_user_id=_other_id) == []
    assert (
        repo.transition_step(
            step["step_id"],
            owner_user_id=_other_id,
            status="failed",
            expected_version=2,
        )
        is None
    )


def test_run_event_cursor_is_stable_and_excludes_previous_sequences(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)
    first_page = repo.list_events(run["run_id"], owner_user_id=owner_id, limit=1)
    assert [event["sequence"] for event in first_page] == [1]

    queued = repo.transition(
        run["run_id"], owner_user_id=owner_id, status="queued", expected_version=0
    )
    assert queued is not None
    next_page = repo.list_events(
        run["run_id"], owner_user_id=owner_id, after_sequence=first_page[-1]["sequence"]
    )
    assert [event["sequence"] for event in next_page] == [2]


def test_concurrent_run_transitions_accept_only_one_version_cas_winner(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)

    def queue_run(_: int) -> dict[str, object] | None:
        return repo.transition(
            str(run["run_id"]), owner_user_id=owner_id, status="queued", expected_version=0
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(queue_run, range(8)))

    assert sum(result is not None for result in results) == 1
    assert [
        event["sequence"] for event in repo.list_events(run["run_id"], owner_user_id=owner_id)
    ] == [
        1,
        2,
    ]


def test_run_event_limit_rolls_back_state_transition(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)
    with db.transaction() as conn:
        conn.execute(
            "UPDATE runs SET next_event_sequence = ? WHERE run_id = ?",
            (MAX_RUN_EVENTS, run["run_id"]),
        )

    with pytest.raises(RunEventLimitExceeded):
        repo.transition(run["run_id"], owner_user_id=owner_id, status="queued", expected_version=0)

    current = repo.get(run["run_id"], owner_user_id=owner_id)
    assert current is not None and current["status"] == "created" and current["version"] == 0
    assert [
        event["sequence"] for event in repo.list_events(run["run_id"], owner_user_id=owner_id)
    ] == [
        1,
    ]


def test_retrying_failed_step_increments_attempt(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)
    step = repo.create_step(
        step_id="step-retry",
        run_id=run["run_id"],
        owner_user_id=owner_id,
        kind="agent",
        executor="run-agent",
        parent_step_id=None,
        created_at=120,
    )
    running = repo.transition_step(
        step["step_id"], owner_user_id=owner_id, status="running", expected_version=0
    )
    assert running is not None
    failed = repo.transition_step(
        step["step_id"], owner_user_id=owner_id, status="failed", expected_version=1
    )
    assert failed is not None and failed["attempt"] == 1
    retried = repo.transition_step(
        step["step_id"], owner_user_id=owner_id, status="queued", expected_version=2
    )
    assert retried is not None and retried["attempt"] == 2


def test_failed_step_records_only_a_known_error_code(
    run_repo: tuple[SqlitePool, RunRepo, int, int],
) -> None:
    _db, repo, owner_id, _other_id = run_repo
    run = _create(repo, owner_id)
    step = repo.create_step(
        step_id="step-safe-error",
        run_id=run["run_id"],
        owner_user_id=owner_id,
        kind="agent",
        executor="run-agent",
        parent_step_id=None,
    )
    running = repo.transition_step(
        step["step_id"], owner_user_id=owner_id, status="running", expected_version=0
    )
    assert running is not None
    with pytest.raises(ValueError, match="invalid step error code"):
        repo.transition_step(
            step["step_id"],
            owner_user_id=owner_id,
            status="failed",
            expected_version=1,
            error_code="provider returned patient SSN 123",
        )
    failed = repo.transition_step(
        step["step_id"],
        owner_user_id=owner_id,
        status="failed",
        expected_version=1,
        error_code="provider_unavailable",
    )
    assert failed is not None and failed["error_summary"] == "provider_unavailable"
    events = repo.list_events(run["run_id"], owner_user_id=owner_id)
    assert events[-1]["payload"] == {
        "from": "running",
        "to": "failed",
        "error_code": "provider_unavailable",
    }
