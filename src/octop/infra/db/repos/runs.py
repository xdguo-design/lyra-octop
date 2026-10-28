"""Durable Run, Step, and Event persistence."""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts

RUN_TRANSITIONS: dict[str, frozenset[str]] = {
    "created": frozenset({"queued", "cancelled"}),
    "queued": frozenset({"running", "failed", "cancel_requested", "cancelled", "interrupted"}),
    "running": frozenset(
        {
            "waiting_approval",
            "succeeded",
            "failed",
            "cancel_requested",
            "interrupted",
            "unknown_external_effect",
        }
    ),
    "waiting_approval": frozenset(
        {"queued", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted"}
    ),
    "cancel_requested": frozenset(
        {"cancelled", "succeeded", "failed", "interrupted", "unknown_external_effect"}
    ),
    "interrupted": frozenset({"queued", "failed", "unknown_external_effect"}),
    "failed": frozenset({"queued"}),
    "unknown_external_effect": frozenset({"succeeded", "failed"}),
    "succeeded": frozenset(),
    "cancelled": frozenset(),
}

STEP_TRANSITIONS: dict[str, frozenset[str]] = {
    "queued": frozenset({"running", "failed", "cancelled", "interrupted"}),
    "running": frozenset(
        {"waiting_approval", "succeeded", "failed", "cancel_requested", "interrupted"}
    ),
    "waiting_approval": frozenset(
        {"queued", "succeeded", "failed", "cancelled", "cancel_requested", "interrupted"}
    ),
    "cancel_requested": frozenset({"cancelled", "succeeded", "failed", "interrupted"}),
    "interrupted": frozenset({"queued", "failed"}),
    "failed": frozenset({"queued"}),
    "succeeded": frozenset(),
    "cancelled": frozenset(),
}
MAX_RUN_EVENTS = 100_000
MAX_RUN_RUNTIME_SECONDS = 3600
MAX_RUN_LEASE_SECONDS = 300
STEP_ERROR_CODES = frozenset(
    {"execution_failed", "provider_unavailable", "approval_rejected", "team_member_failed"}
)


class RunIdempotencyConflict(ValueError):
    """Raised when an idempotency key is reused for a different request."""


class RunEventLimitExceeded(ValueError):
    """Raised instead of allowing unbounded event growth for one run."""


class _RunDispatchConflict(RuntimeError):
    """Internal signal to roll back a multi-row team dispatch state change."""


def _public_run(row: DbRow) -> dict[str, Any]:
    run = {
        key: row[key]
        for key in (
            "run_id",
            "owner_user_id",
            "project_id",
            "agent_id",
            "agent_version_id",
            "parent_run_id",
            "thread_id",
            "input_ref",
            "status",
            "version",
            "created_at",
            "updated_at",
            "started_at",
            "finished_at",
        )
    }
    raw_context = row["project_context_json"]
    run["project_context_snapshot"] = json.loads(raw_context) if raw_context else None
    run["source_file_revisions"] = json.loads(row["source_file_revisions_json"] or "[]")
    run["capability_scope_snapshot"] = json.loads(row["capability_scopes_json"] or "[]")
    return run


class RunRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def find_idempotent(
        self, *, owner_user_id: int, idempotency_key: str, request_hash: str
    ) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM runs WHERE owner_user_id = ? AND idempotency_key = ?",
                (owner_user_id, idempotency_key),
            ).fetchone()
        if row is None:
            return None
        if row["request_hash"] != request_hash:
            raise RunIdempotencyConflict("idempotency key belongs to a different request")
        return _public_run(row)

    def create(
        self,
        *,
        run_id: str,
        owner_user_id: int,
        agent_id: str,
        project_id: str | None,
        parent_run_id: str | None,
        input_ref: str | None,
        idempotency_key: str | None,
        request_hash: str,
        thread_id: str | None = None,
        project_context_snapshot: dict[str, Any] | None = None,
        source_file_revisions: list[dict[str, Any]] | None = None,
        capability_scope_snapshot: list[dict[str, Any]] | None = None,
        agent_version_id: str | None = None,
        created_at: int | None = None,
    ) -> tuple[dict[str, Any], bool]:
        ts = created_at if created_at is not None else now_ts()
        with self._db.transaction() as conn:
            if parent_run_id is not None:
                parent = conn.execute(
                    "SELECT 1 FROM runs WHERE run_id = ? AND owner_user_id = ?",
                    (parent_run_id, owner_user_id),
                ).fetchone()
                if parent is None:
                    raise KeyError("parent run not found")
            if agent_version_id is not None:
                version = conn.execute(
                    "SELECT 1 FROM agent_versions WHERE version_id = ? AND agent_id = ?",
                    (agent_version_id, agent_id),
                ).fetchone()
                if version is None:
                    raise KeyError("agent version not found")
            inserted = conn.execute(
                "INSERT INTO runs(run_id, owner_user_id, project_id, agent_id, parent_run_id, "
                "agent_version_id, thread_id, input_ref, project_context_json, source_file_revisions_json, "
                "capability_scopes_json, "
                "idempotency_key, request_hash, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?) "
                "ON CONFLICT(owner_user_id, idempotency_key) DO NOTHING RETURNING run_id",
                (
                    run_id,
                    owner_user_id,
                    project_id,
                    agent_id,
                    parent_run_id,
                    agent_version_id,
                    thread_id,
                    input_ref,
                    json.dumps(project_context_snapshot, ensure_ascii=False, separators=(",", ":"))
                    if project_context_snapshot is not None
                    else None,
                    json.dumps(
                        source_file_revisions or [], ensure_ascii=False, separators=(",", ":")
                    ),
                    json.dumps(
                        capability_scope_snapshot or [], ensure_ascii=False, separators=(",", ":")
                    ),
                    idempotency_key,
                    request_hash,
                    ts,
                    ts,
                ),
            ).fetchone()
            if inserted is None:
                row = conn.execute(
                    "SELECT * FROM runs WHERE owner_user_id = ? AND idempotency_key = ?",
                    (owner_user_id, idempotency_key),
                ).fetchone()
                if row is None:
                    raise RuntimeError("idempotent run insert did not return a row")
                if row["request_hash"] != request_hash:
                    raise RunIdempotencyConflict("idempotency key belongs to a different request")
                return _public_run(row), True
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                event_type="run.created",
                payload={},
                created_at=ts,
            )
            row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if row is None:
            raise RuntimeError("created run could not be read")
        return _public_run(row), False

    def get(self, run_id: str, *, owner_user_id: int) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
        return _public_run(row) if row else None

    def attach_artifact(
        self,
        *,
        artifact_id: str,
        run_id: str,
        owner_user_id: int,
        file_id: str,
        revision_id: str,
    ) -> tuple[dict[str, Any], bool] | None:
        """Bind one owned immutable thread revision to its Run without exposing storage paths."""
        ts = now_ts()
        with self._db.transaction() as conn:
            source = conn.execute(
                "SELECT r.run_id, r.project_id, r.agent_id, r.thread_id, "
                "f.file_id, f.display_name, f.deleted_at, f.thread_id AS file_thread_id, "
                "v.revision_id, v.sha256, v.media_type, v.byte_size, v.origin_kind "
                "FROM runs r JOIN chat_files f ON f.file_id = ? "
                "JOIN chat_file_revisions v ON v.revision_id = ? AND v.file_id = f.file_id "
                "WHERE r.run_id = ? AND r.owner_user_id = ? AND f.user_id = r.owner_user_id "
                "AND f.agent_id = r.agent_id AND f.thread_id = r.thread_id "
                "AND f.deleted_at IS NULL",
                (file_id, revision_id, run_id, owner_user_id),
            ).fetchone()
            if source is None or source["thread_id"] is None:
                return None
            inserted = conn.execute(
                "INSERT INTO run_artifacts(artifact_id, run_id, file_id, revision_id, created_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, revision_id) DO NOTHING",
                (artifact_id, run_id, file_id, revision_id, ts),
            ).rowcount
            row = conn.execute(
                "SELECT a.revision_id AS artifact_id, a.run_id, r.project_id, r.agent_id, r.thread_id, "
                "f.file_id, f.display_name, v.revision_id, v.sha256 AS content_hash, "
                "v.media_type, v.byte_size, v.origin_kind, a.created_at "
                "FROM run_artifacts a JOIN runs r ON r.run_id = a.run_id "
                "JOIN chat_files f ON f.file_id = a.file_id "
                "JOIN chat_file_revisions v ON v.revision_id = a.revision_id "
                "WHERE a.run_id = ? AND a.revision_id = ? AND r.owner_user_id = ? "
                "AND f.deleted_at IS NULL",
                (run_id, revision_id, owner_user_id),
            ).fetchone()
        return (dict(row), int(inserted or 0) == 0) if row else None

    def list_artifacts(self, run_id: str, *, owner_user_id: int) -> list[dict[str, Any]] | None:
        with self._db.connect() as conn:
            run = conn.execute(
                "SELECT 1 FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
            if run is None:
                return None
            rows = conn.execute(
                "SELECT a.revision_id AS artifact_id, a.run_id, r.project_id, r.agent_id, r.thread_id, "
                "f.file_id, f.display_name, v.revision_id, v.sha256 AS content_hash, "
                "v.media_type, v.byte_size, v.origin_kind, a.created_at "
                "FROM run_artifacts a JOIN runs r ON r.run_id = a.run_id "
                "JOIN chat_files f ON f.file_id = a.file_id "
                "JOIN chat_file_revisions v ON v.revision_id = a.revision_id AND v.file_id = f.file_id "
                "WHERE a.run_id = ? AND r.owner_user_id = ? AND f.user_id = r.owner_user_id "
                "AND f.agent_id = r.agent_id AND f.thread_id = r.thread_id AND f.deleted_at IS NULL "
                "ORDER BY a.created_at, a.artifact_id",
                (run_id, owner_user_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_project_artifacts(
        self, project_id: str, *, owner_user_id: int, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        """List owner-visible Run outputs and Chat revisions assigned to a project."""
        with self._db.connect() as conn:
            rows = conn.execute(
                "WITH project_artifacts AS ("
                "SELECT a.revision_id AS artifact_id, a.run_id, r.project_id, r.agent_id, r.thread_id, "
                "f.file_id, f.display_name, v.revision_id, v.sha256 AS content_hash, "
                "v.media_type, v.byte_size, v.origin_kind, a.created_at "
                "FROM run_artifacts a JOIN runs r ON r.run_id = a.run_id "
                "JOIN chat_files f ON f.file_id = a.file_id "
                "JOIN chat_file_revisions v ON v.revision_id = a.revision_id AND v.file_id = f.file_id "
                "WHERE r.project_id = ? AND r.owner_user_id = ? AND f.user_id = r.owner_user_id "
                "AND f.agent_id = r.agent_id AND f.thread_id = r.thread_id AND f.deleted_at IS NULL "
                "UNION ALL "
                "SELECT v.revision_id AS artifact_id, NULL AS run_id, a.project_id, t.agent_id, "
                "t.thread_id, f.file_id, f.display_name, v.revision_id, v.sha256 AS content_hash, "
                "v.media_type, v.byte_size, v.origin_kind, v.created_at "
                "FROM workbench_thread_assignments a JOIN threads t ON t.thread_id = a.thread_id "
                "JOIN chat_files f ON f.thread_id = t.thread_id AND f.user_id = a.owner_user_id "
                "AND f.agent_id = t.agent_id JOIN chat_file_revisions v ON v.file_id = f.file_id "
                "WHERE a.project_id = ? AND a.owner_user_id = ? AND f.deleted_at IS NULL) "
                "SELECT artifact.* FROM project_artifacts artifact "
                "WHERE NOT EXISTS (SELECT 1 FROM project_artifacts newer "
                "WHERE newer.revision_id = artifact.revision_id AND artifact.run_id IS NOT NULL "
                "AND newer.run_id IS NOT NULL AND (newer.created_at > artifact.created_at OR "
                "(newer.created_at = artifact.created_at AND newer.run_id > artifact.run_id))) "
                "AND NOT EXISTS (SELECT 1 FROM project_artifacts run_artifact "
                "WHERE run_artifact.revision_id = artifact.revision_id AND artifact.run_id IS NULL "
                "AND run_artifact.run_id IS NOT NULL) "
                "ORDER BY artifact.created_at DESC, artifact.artifact_id LIMIT ? OFFSET ?",
                (
                    project_id,
                    owner_user_id,
                    project_id,
                    owner_user_id,
                    max(1, min(limit, 100)),
                    max(0, offset),
                ),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_artifact(
        self, run_id: str, artifact_id: str, *, owner_user_id: int
    ) -> dict[str, Any] | None:
        rows = self.list_artifacts(run_id, owner_user_id=owner_user_id)
        if rows is None:
            return None
        return next((row for row in rows if row["artifact_id"] == artifact_id), None)

    def claim_next(
        self,
        *,
        executor_id: str,
        lease_seconds: int = 30,
        require_input: bool = False,
        now: int | None = None,
    ) -> dict[str, Any] | None:
        """Atomically claim the oldest queued run for one executor instance."""
        executor_id = executor_id.strip()
        if not executor_id or len(executor_id) > 128:
            raise ValueError("executor_id must contain 1..128 characters")
        if not 1 <= lease_seconds <= MAX_RUN_LEASE_SECONDS:
            raise ValueError(f"lease_seconds must be 1..{MAX_RUN_LEASE_SECONDS}")
        ts = now if now is not None else now_ts()
        with self._db.transaction() as conn:
            lock = " FOR UPDATE SKIP LOCKED" if self._db.dialect == "postgresql" else ""
            row = conn.execute(
                "SELECT * FROM runs WHERE status = 'queued' "
                + ("AND thread_id IS NOT NULL AND input_ref IS NOT NULL " if require_input else "")
                + "ORDER BY created_at, run_id LIMIT 1"
                + lock
            ).fetchone()
            if row is None:
                return None
            run_id = str(row["run_id"])
            owner_user_id = int(row["owner_user_id"])
            version = int(row["version"])
            lease_until = min(ts + lease_seconds, ts + MAX_RUN_RUNTIME_SECONDS)
            changed = conn.execute(
                "UPDATE runs SET status = 'running', version = version + 1, "
                "updated_at = ?, started_at = COALESCE(started_at, ?), "
                "lease_owner = ?, lease_expires_at = ?, max_runtime_seconds = ?, "
                "run_attempt = run_attempt + 1 "
                "WHERE run_id = ? AND status = 'queued' AND version = ?",
                (
                    ts,
                    ts,
                    executor_id,
                    lease_until,
                    MAX_RUN_RUNTIME_SECONDS,
                    run_id,
                    version,
                ),
            ).rowcount
            if int(changed or 0) != 1:
                return None
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                event_type="run.status_changed",
                payload={"from": "queued", "to": "running"},
                created_at=ts,
            )
            claimed = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if claimed is None:
            raise RuntimeError("claimed run could not be read")
        return {
            **_public_run(claimed),
            "lease_owner": claimed["lease_owner"],
            "lease_expires_at": claimed["lease_expires_at"],
            "run_attempt": claimed["run_attempt"],
        }

    def heartbeat(
        self,
        run_id: str,
        *,
        executor_id: str,
        lease_seconds: int = 30,
        now: int | None = None,
    ) -> bool:
        if not 1 <= lease_seconds <= MAX_RUN_LEASE_SECONDS:
            raise ValueError(f"lease_seconds must be 1..{MAX_RUN_LEASE_SECONDS}")
        ts = now if now is not None else now_ts()
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT started_at, max_runtime_seconds FROM runs WHERE run_id = ? "
                "AND status = 'running' AND lease_owner = ? AND lease_expires_at > ?",
                (run_id, executor_id, ts),
            ).fetchone()
            if row is None:
                return False
            deadline = int(row["started_at"]) + int(row["max_runtime_seconds"])
            lease_until = min(ts + lease_seconds, deadline)
            if lease_until <= ts:
                return False
            changed = conn.execute(
                "UPDATE runs SET lease_expires_at = ?, updated_at = ? "
                "WHERE run_id = ? AND status = 'running' AND lease_owner = ? "
                "AND lease_expires_at > ?",
                (lease_until, ts, run_id, executor_id, ts),
            ).rowcount
        return bool(changed == 1)

    def reconcile_expired_leases(self, *, now: int | None = None, limit: int = 100) -> int:
        """Mark lost executors interrupted; never requeue work with unknown side effects."""
        ts = now if now is not None else now_ts()
        bounded_limit = max(1, min(limit, 500))
        interrupted = 0
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT run_id, owner_user_id, status, version FROM runs "
                "WHERE status IN ('running', 'cancel_requested') "
                "AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? "
                "ORDER BY lease_expires_at LIMIT ?",
                (ts, bounded_limit),
            ).fetchall()
            for row in rows:
                run_id = str(row["run_id"])
                old_status = str(row["status"])
                changed = conn.execute(
                    "UPDATE runs SET status = 'interrupted', version = version + 1, "
                    "updated_at = ?, finished_at = ?, lease_owner = NULL, lease_expires_at = NULL "
                    "WHERE run_id = ? AND status = ? AND version = ? "
                    "AND lease_expires_at <= ?",
                    (ts, ts, run_id, old_status, int(row["version"]), ts),
                ).rowcount
                if int(changed or 0) != 1:
                    continue
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=int(row["owner_user_id"]),
                    event_type="run.status_changed",
                    payload={"from": old_status, "to": "interrupted"},
                    created_at=ts,
                )
                steps = conn.execute(
                    "SELECT step_id, status, version FROM run_steps WHERE run_id = ? "
                    "AND status IN ('running', 'cancel_requested')",
                    (run_id,),
                ).fetchall()
                for step in steps:
                    step_id = str(step["step_id"])
                    step_status = str(step["status"])
                    step_changed = conn.execute(
                        "UPDATE run_steps SET status = 'interrupted', version = version + 1, "
                        "updated_at = ?, finished_at = ? "
                        "WHERE step_id = ? AND status = ? AND version = ?",
                        (ts, ts, step_id, step_status, int(step["version"])),
                    ).rowcount
                    if int(step_changed or 0) == 1:
                        self._append_event(
                            conn,
                            run_id=run_id,
                            owner_user_id=int(row["owner_user_id"]),
                            event_type="step.status_changed",
                            payload={"from": step_status, "to": "interrupted"},
                            step_id=step_id,
                            created_at=ts,
                        )
                interrupted += 1
        return interrupted

    def reconcile_orphaned_team_dispatches(self, *, now: int | None = None) -> int:
        """Close Team Inbox work left behind by a process restart without replaying it."""
        ts = now if now is not None else now_ts()
        reconciled = 0
        with self._db.transaction() as conn:
            lock = " FOR UPDATE OF r, s" if self._db.dialect == "postgresql" else ""
            rows = conn.execute(
                "SELECT r.run_id, r.owner_user_id, r.status AS run_status, r.version AS run_version, "
                "s.step_id, s.status AS step_status, s.version AS step_version "
                "FROM runs r JOIN run_steps s ON s.run_id = r.run_id "
                "WHERE s.kind = 'team_dispatch' AND r.status IN ('queued', 'running', 'cancel_requested') "
                "AND s.status IN ('queued', 'running', 'cancel_requested') "
                "AND r.lease_owner IS NOT NULL AND r.lease_expires_at <= ? "
                f"ORDER BY s.created_at, s.step_id{lock}",
                (ts,),
            ).fetchall()
            for row in rows:
                step_status = str(row["step_status"])
                run_status = str(row["run_status"])
                if step_status == "queued":
                    target_run = "cancelled" if run_status == "cancel_requested" else "interrupted"
                    target_step = target_run
                else:
                    target_run, target_step = "unknown_external_effect", "interrupted"
                run_id, step_id = str(row["run_id"]), str(row["step_id"])
                changed_run = conn.execute(
                    "UPDATE runs SET status = ?, version = version + 1, updated_at = ?, "
                    "finished_at = ?, lease_owner = NULL, lease_expires_at = NULL "
                    "WHERE run_id = ? AND version = ? AND status = ?",
                    (
                        target_run,
                        ts,
                        ts,
                        run_id,
                        int(row["run_version"]),
                        run_status,
                    ),
                ).rowcount
                if int(changed_run or 0) != 1:
                    continue
                changed_step = conn.execute(
                    "UPDATE run_steps SET status = ?, version = version + 1, updated_at = ?, "
                    "finished_at = ? WHERE step_id = ? AND version = ? AND status = ?",
                    (
                        target_step,
                        ts,
                        ts,
                        step_id,
                        int(row["step_version"]),
                        step_status,
                    ),
                ).rowcount
                if int(changed_step or 0) != 1:
                    raise _RunDispatchConflict
                owner_user_id = int(row["owner_user_id"])
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    event_type="run.status_changed",
                    payload={"from": run_status, "to": target_run},
                    created_at=ts,
                )
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    step_id=step_id,
                    event_type="step.status_changed",
                    payload={"from": step_status, "to": target_step},
                    created_at=ts,
                )
                reconciled += 1
        return reconciled

    def list_by_owner(
        self,
        *,
        owner_user_id: int,
        project_id: str | None = None,
        status: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        clauses = ["owner_user_id = ?"]
        params: list[object] = [owner_user_id]
        if project_id is not None:
            clauses.append("project_id = ?")
            params.append(project_id)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        params.extend((max(1, min(limit, 100)), max(0, offset)))
        with self._db.connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM runs WHERE {' AND '.join(clauses)} "
                "ORDER BY created_at DESC, run_id DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()
        return [_public_run(row) for row in rows]

    def list_children(self, run_id: str, *, owner_user_id: int) -> list[dict[str, Any]] | None:
        with self._db.connect() as conn:
            parent = conn.execute(
                "SELECT 1 FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
            if parent is None:
                return None
            rows = conn.execute(
                "SELECT c.* FROM runs c WHERE c.parent_run_id = ? AND c.owner_user_id = ? "
                "AND EXISTS (SELECT 1 FROM run_steps s WHERE s.run_id = c.run_id "
                "AND s.kind = 'team_dispatch') ORDER BY c.created_at, c.run_id",
                (run_id, owner_user_id),
            ).fetchall()
        return [_public_run(row) for row in rows]

    def finish_agent_run(
        self,
        run_id: str,
        *,
        step_id: str,
        owner_user_id: int,
        executor_id: str,
        outcome: str,
        error_code: str | None = None,
        now: int | None = None,
    ) -> bool | None:
        """Finish a leased Run only after its Team dispatch children are terminal."""
        if outcome not in {"succeeded", "failed", "waiting_approval"}:
            raise ValueError("invalid agent run outcome")
        if error_code is not None and (outcome != "failed" or error_code not in STEP_ERROR_CODES):
            raise ValueError("invalid error code")
        ts = now if now is not None else now_ts()
        try:
            with self._db.transaction() as conn:
                lock = " FOR UPDATE" if self._db.dialect == "postgresql" else ""
                run = conn.execute(
                    "SELECT status, version, lease_owner, lease_expires_at FROM runs "
                    f"WHERE run_id = ? AND owner_user_id = ?{lock}",
                    (run_id, owner_user_id),
                ).fetchone()
                if (
                    run is None
                    or run["status"] != "running"
                    or run["lease_owner"] != executor_id
                    or run["lease_expires_at"] is None
                    or int(run["lease_expires_at"]) <= ts
                ):
                    return None
                step = conn.execute(
                    f"SELECT status, version FROM run_steps WHERE step_id = ? AND run_id = ?{lock}",
                    (step_id, run_id),
                ).fetchone()
                if step is None or step["status"] != "running":
                    return None
                child_lock = " FOR UPDATE OF c" if self._db.dialect == "postgresql" else ""
                children = conn.execute(
                    "SELECT c.status FROM runs c WHERE c.parent_run_id = ? "
                    "AND c.owner_user_id = ? AND EXISTS "
                    "(SELECT 1 FROM run_steps s WHERE s.run_id = c.run_id "
                    f"AND s.kind = 'team_dispatch'){child_lock}",
                    (run_id, owner_user_id),
                ).fetchall()
                statuses = {str(child["status"]) for child in children}
                terminal = {
                    "succeeded",
                    "failed",
                    "interrupted",
                    "cancelled",
                    "unknown_external_effect",
                }
                if statuses - terminal:
                    return False
                if "unknown_external_effect" in statuses:
                    run_status, step_status, error_code = (
                        "unknown_external_effect",
                        "interrupted",
                        None,
                    )
                elif "failed" in statuses:
                    run_status, step_status, error_code = "failed", "failed", "team_member_failed"
                elif statuses & {"interrupted", "cancelled"}:
                    run_status, step_status, error_code = "interrupted", "interrupted", None
                else:
                    run_status = step_status = outcome
                changed_step = conn.execute(
                    "UPDATE run_steps SET status = ?, version = version + 1, updated_at = ?, "
                    "finished_at = ?, error_summary = ? WHERE step_id = ? AND version = ? "
                    "AND status = 'running'",
                    (
                        step_status,
                        ts,
                        ts if step_status in {"succeeded", "failed", "interrupted"} else None,
                        error_code,
                        step_id,
                        int(step["version"]),
                    ),
                ).rowcount
                if int(changed_step or 0) != 1:
                    raise _RunDispatchConflict
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    step_id=step_id,
                    event_type="step.status_changed",
                    payload={
                        "from": "running",
                        "to": step_status,
                        **({"error_code": error_code} if error_code else {}),
                    },
                    created_at=ts,
                )
                changed_run = conn.execute(
                    "UPDATE runs SET status = ?, version = version + 1, updated_at = ?, "
                    "finished_at = ?, lease_owner = NULL, lease_expires_at = NULL "
                    "WHERE run_id = ? AND owner_user_id = ? AND version = ? AND status = 'running'",
                    (
                        run_status,
                        ts,
                        ts
                        if run_status
                        in {"succeeded", "failed", "interrupted", "unknown_external_effect"}
                        else None,
                        run_id,
                        owner_user_id,
                        int(run["version"]),
                    ),
                ).rowcount
                if int(changed_run or 0) != 1:
                    raise _RunDispatchConflict
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    event_type="run.status_changed",
                    payload={"from": "running", "to": run_status},
                    created_at=ts,
                )
        except _RunDispatchConflict:
            return None
        return True

    def transition(
        self,
        run_id: str,
        *,
        owner_user_id: int,
        status: str,
        expected_version: int,
        updated_at: int | None = None,
    ) -> dict[str, Any] | None:
        ts = updated_at if updated_at is not None else now_ts()
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT status, version FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
            if row is None or int(row["version"]) != expected_version:
                return None
            old_status = str(row["status"])
            if status not in RUN_TRANSITIONS.get(old_status, frozenset()):
                raise ValueError(f"invalid run transition: {old_status} -> {status}")
            started_at = ts if status == "running" else None
            finished_at = (
                ts
                if status
                in {"succeeded", "failed", "cancelled", "interrupted", "unknown_external_effect"}
                else None
            )
            changed = conn.execute(
                "UPDATE runs SET status = ?, version = version + 1, updated_at = ?, "
                "started_at = COALESCE(started_at, ?), finished_at = ? "
                "WHERE run_id = ? AND owner_user_id = ? AND version = ?",
                (status, ts, started_at, finished_at, run_id, owner_user_id, expected_version),
            ).rowcount
            if int(changed or 0) != 1:
                return None
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                event_type="run.status_changed",
                payload={"from": old_status, "to": status},
                created_at=ts,
            )
            updated = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        return _public_run(updated) if updated else None

    def create_step(
        self,
        *,
        step_id: str,
        run_id: str,
        owner_user_id: int,
        kind: str,
        executor: str,
        parent_step_id: str | None,
        created_at: int | None = None,
    ) -> dict[str, Any]:
        ts = created_at if created_at is not None else now_ts()
        with self._db.transaction() as conn:
            run = conn.execute(
                "SELECT 1 FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
            if run is None:
                raise KeyError("run not found")
            if parent_step_id is not None:
                parent = conn.execute(
                    "SELECT 1 FROM run_steps WHERE step_id = ? AND run_id = ?",
                    (parent_step_id, run_id),
                ).fetchone()
                if parent is None:
                    raise KeyError("parent step not found")
            conn.execute(
                "INSERT INTO run_steps(step_id, run_id, parent_step_id, kind, executor, status, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
                (step_id, run_id, parent_step_id, kind, executor, ts, ts),
            )
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                step_id=step_id,
                event_type="step.created",
                payload={"kind": kind, "executor": executor},
                created_at=ts,
            )
            row = conn.execute("SELECT * FROM run_steps WHERE step_id = ?", (step_id,)).fetchone()
        if row is None:
            raise RuntimeError("created run step could not be read")
        return dict(row)

    def create_team_dispatch(
        self,
        *,
        run_id: str,
        step_id: str,
        inbox_id: str,
        owner_user_id: int,
        team_agent_id: str,
        member_agent_id: str,
        request_hash: str,
        encrypted_payload: bytes | None = None,
        parent_run_id: str | None = None,
        lease_owner: str | None = None,
        lease_seconds: int = 30,
    ) -> tuple[dict[str, Any], dict[str, Any], bool]:
        """Persist one async team inbox item as an owner-scoped Run and Step."""
        if not 1 <= lease_seconds <= MAX_RUN_LEASE_SECONDS:
            raise ValueError(f"lease_seconds must be 1..{MAX_RUN_LEASE_SECONDS}")
        if lease_owner is not None and (not lease_owner or len(lease_owner) > 128):
            raise ValueError("invalid Team dispatcher id")
        ts = now_ts()
        idempotency_key = f"team-inbox:{inbox_id}"
        with self._db.transaction() as conn:
            if parent_run_id is not None:
                lock = " FOR UPDATE" if self._db.dialect == "postgresql" else ""
                parent = conn.execute(
                    "SELECT agent_id, project_id, thread_id, status FROM runs "
                    f"WHERE run_id = ? AND owner_user_id = ?{lock}",
                    (parent_run_id, owner_user_id),
                ).fetchone()
                if (
                    parent is None
                    or parent["agent_id"] != team_agent_id
                    or parent["status"] != "running"
                ):
                    raise KeyError("parent run not found")
                project_id, thread_id = parent["project_id"], parent["thread_id"]
            else:
                project_id = thread_id = None
            inserted = conn.execute(
                "INSERT INTO runs(run_id, owner_user_id, project_id, agent_id, parent_run_id, "
                "thread_id, idempotency_key, "
                "request_hash, status, lease_owner, lease_expires_at, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?) "
                "ON CONFLICT(owner_user_id, idempotency_key) DO NOTHING RETURNING run_id",
                (
                    run_id,
                    owner_user_id,
                    project_id,
                    team_agent_id,
                    parent_run_id,
                    thread_id,
                    idempotency_key,
                    request_hash,
                    lease_owner,
                    ts + lease_seconds if lease_owner is not None else None,
                    ts,
                    ts,
                ),
            ).fetchone()
            created = inserted is not None
            if created:
                run = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    event_type="run.created",
                    payload={"source": "team"},
                    created_at=ts,
                )
            else:
                run = conn.execute(
                    "SELECT * FROM runs WHERE owner_user_id = ? AND idempotency_key = ?",
                    (owner_user_id, idempotency_key),
                ).fetchone()
                if (
                    run is None
                    or run["request_hash"] != request_hash
                    or run["agent_id"] != team_agent_id
                    or run["parent_run_id"] != parent_run_id
                ):
                    raise RunIdempotencyConflict("team inbox id belongs to a different dispatch")

            actual_run_id = str(run["run_id"])
            inserted_step = conn.execute(
                "INSERT INTO run_steps(step_id, run_id, inbox_id, kind, executor, status, "
                "created_at, updated_at) VALUES (?, ?, ?, 'team_dispatch', ?, 'queued', ?, ?) "
                "ON CONFLICT(inbox_id) WHERE inbox_id IS NOT NULL DO NOTHING RETURNING step_id",
                (step_id, actual_run_id, inbox_id, member_agent_id, ts, ts),
            ).fetchone()
            created_step = inserted_step is not None
            if created_step:
                step = conn.execute(
                    "SELECT * FROM run_steps WHERE step_id = ?", (step_id,)
                ).fetchone()
                self._append_event(
                    conn,
                    run_id=actual_run_id,
                    owner_user_id=owner_user_id,
                    step_id=step_id,
                    event_type="step.created",
                    payload={"kind": "team_dispatch", "executor": member_agent_id},
                    created_at=ts,
                )
            else:
                step = conn.execute(
                    "SELECT s.* FROM run_steps s JOIN runs r ON r.run_id = s.run_id "
                    "WHERE s.inbox_id = ? AND r.owner_user_id = ?",
                    (inbox_id, owner_user_id),
                ).fetchone()
                if (
                    step is None
                    or step["run_id"] != actual_run_id
                    or step["executor"] != member_agent_id
                ):
                    raise RunIdempotencyConflict("team inbox id belongs to a different dispatch")
            if run is None or step is None:
                raise RuntimeError("team dispatch persistence did not return its records")
            if created_step and encrypted_payload is not None:
                conn.execute(
                    "INSERT INTO team_dispatch_payloads(inbox_id, step_id, payload_blob, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    (inbox_id, step["step_id"], encrypted_payload, ts),
                )
        return _public_run(run), dict(step), not (created or created_step)

    def claim_expired_team_dispatches(
        self, *, executor_id: str, lease_seconds: int = 30, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Fence and return only expired dispatches that have not started."""
        if not executor_id or len(executor_id) > 128:
            raise ValueError("invalid Team dispatcher id")
        if not 1 <= lease_seconds <= MAX_RUN_LEASE_SECONDS:
            raise ValueError(f"lease_seconds must be 1..{MAX_RUN_LEASE_SECONDS}")
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be 1..1000")
        ts = now_ts()
        lock = " FOR UPDATE OF r SKIP LOCKED" if self._db.dialect == "postgresql" else ""
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT r.run_id, r.owner_user_id, s.inbox_id, s.step_id, p.payload_blob "
                "FROM run_steps s JOIN runs r ON r.run_id = s.run_id "
                "JOIN team_dispatch_payloads p ON p.inbox_id = s.inbox_id "
                "WHERE s.kind = 'team_dispatch' AND s.status = 'queued' AND r.status = 'queued' "
                "AND r.lease_expires_at IS NOT NULL AND r.lease_expires_at <= ? "
                "AND (r.parent_run_id IS NULL OR EXISTS (SELECT 1 FROM runs parent "
                "WHERE parent.run_id = r.parent_run_id AND parent.owner_user_id = r.owner_user_id "
                "AND parent.status = 'running' AND (parent.lease_owner IS NULL "
                "OR parent.lease_expires_at > ?))) "
                f"ORDER BY r.lease_expires_at, r.run_id LIMIT ?{lock}",
                (ts, ts, limit),
            ).fetchall()
            claimed: list[dict[str, Any]] = []
            for row in rows:
                changed = conn.execute(
                    "UPDATE runs SET lease_owner = ?, lease_expires_at = ?, updated_at = ? "
                    "WHERE run_id = ? AND owner_user_id = ? AND status = 'queued' "
                    "AND lease_expires_at <= ?",
                    (
                        executor_id,
                        ts + lease_seconds,
                        ts,
                        row["run_id"],
                        row["owner_user_id"],
                        ts,
                    ),
                ).rowcount
                if int(changed or 0) == 1:
                    claimed.append(
                        {
                            "run_id": str(row["run_id"]),
                            "owner_user_id": int(row["owner_user_id"]),
                            "inbox_id": str(row["inbox_id"]),
                            "step_id": str(row["step_id"]),
                            "payload_blob": bytes(row["payload_blob"]),
                        }
                    )
        return claimed

    def start_team_dispatch(
        self,
        inbox_id: str,
        *,
        owner_user_id: int,
        executor_id: str | None = None,
        lease_seconds: int = 30,
    ) -> bool:
        if not 1 <= lease_seconds <= MAX_RUN_LEASE_SECONDS:
            raise ValueError(f"lease_seconds must be 1..{MAX_RUN_LEASE_SECONDS}")
        try:
            return self._start_team_dispatch_transaction(
                inbox_id,
                owner_user_id=owner_user_id,
                executor_id=executor_id,
                lease_seconds=lease_seconds,
            )
        except _RunDispatchConflict:
            return False

    def _start_team_dispatch_transaction(
        self,
        inbox_id: str,
        *,
        owner_user_id: int,
        executor_id: str | None,
        lease_seconds: int,
    ) -> bool:
        ts = now_ts()
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT r.run_id, r.status AS run_status, r.version AS run_version, "
                "r.lease_owner, r.lease_expires_at, "
                "s.step_id, s.status AS step_status, s.version AS step_version "
                "FROM run_steps s JOIN runs r ON r.run_id = s.run_id "
                "WHERE s.inbox_id = ? AND r.owner_user_id = ?",
                (inbox_id, owner_user_id),
            ).fetchone()
            if row is None:
                return False
            run_status, step_status = str(row["run_status"]), str(row["step_status"])
            if run_status not in {"queued", "running"} or step_status not in {
                "queued",
                "running",
            }:
                return False
            if executor_id is not None and (
                row["lease_owner"] != executor_id
                or row["lease_expires_at"] is None
                or int(row["lease_expires_at"]) <= ts
            ):
                return False
            if run_status == "queued":
                if executor_id is None:
                    changed = conn.execute(
                        "UPDATE runs SET status = 'running', version = version + 1, "
                        "started_at = COALESCE(started_at, ?), updated_at = ? "
                        "WHERE run_id = ? AND version = ? AND status = 'queued'",
                        (ts, ts, row["run_id"], row["run_version"]),
                    ).rowcount
                else:
                    changed = conn.execute(
                        "UPDATE runs SET status = 'running', version = version + 1, "
                        "started_at = COALESCE(started_at, ?), updated_at = ?, lease_expires_at = ? "
                        "WHERE run_id = ? AND version = ? AND status = 'queued'",
                        (ts, ts, ts + lease_seconds, row["run_id"], row["run_version"]),
                    ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
                self._append_event(
                    conn,
                    run_id=str(row["run_id"]),
                    owner_user_id=owner_user_id,
                    event_type="run.status_changed",
                    payload={"from": "queued", "to": "running"},
                    created_at=ts,
                )
            elif executor_id is not None:
                changed = conn.execute(
                    "UPDATE runs SET lease_expires_at = CASE "
                    "WHEN ? < started_at + max_runtime_seconds THEN ? "
                    "ELSE started_at + max_runtime_seconds END, updated_at = ? "
                    "WHERE run_id = ? AND owner_user_id = ? AND lease_owner = ? "
                    "AND lease_expires_at > ? AND started_at + max_runtime_seconds > ? "
                    "AND version = ?",
                    (
                        ts + lease_seconds,
                        ts + lease_seconds,
                        ts,
                        row["run_id"],
                        owner_user_id,
                        executor_id,
                        ts,
                        ts,
                        row["run_version"],
                    ),
                ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
            if step_status == "queued":
                changed = conn.execute(
                    "UPDATE run_steps SET status = 'running', version = version + 1, "
                    "started_at = COALESCE(started_at, ?), updated_at = ? "
                    "WHERE step_id = ? AND version = ? AND status = 'queued'",
                    (ts, ts, row["step_id"], row["step_version"]),
                ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
                self._append_event(
                    conn,
                    run_id=str(row["run_id"]),
                    owner_user_id=owner_user_id,
                    step_id=str(row["step_id"]),
                    event_type="step.status_changed",
                    payload={"from": "queued", "to": "running"},
                    created_at=ts,
                )
        return True

    def heartbeat_team_dispatch(
        self,
        inbox_id: str,
        *,
        owner_user_id: int,
        executor_id: str,
        lease_seconds: int = 30,
        now: int | None = None,
    ) -> bool:
        if not 1 <= lease_seconds <= MAX_RUN_LEASE_SECONDS:
            raise ValueError(f"lease_seconds must be 1..{MAX_RUN_LEASE_SECONDS}")
        ts = now if now is not None else now_ts()
        with self._db.transaction() as conn:
            changed = conn.execute(
                "UPDATE runs SET lease_expires_at = CASE "
                "WHEN started_at IS NULL OR ? < started_at + max_runtime_seconds THEN ? "
                "ELSE started_at + max_runtime_seconds END, updated_at = ? "
                "WHERE owner_user_id = ? AND lease_owner = ? AND lease_expires_at > ? "
                "AND status IN ('queued', 'running', 'cancel_requested') "
                "AND (started_at IS NULL OR started_at + max_runtime_seconds > ?) "
                "AND run_id = (SELECT run_id FROM run_steps WHERE inbox_id = ? AND kind = 'team_dispatch')",
                (
                    ts + lease_seconds,
                    ts + lease_seconds,
                    ts,
                    owner_user_id,
                    executor_id,
                    ts,
                    ts,
                    inbox_id,
                ),
            ).rowcount
        return int(changed or 0) == 1

    def finish_team_dispatch(self, inbox_id: str, *, owner_user_id: int, outcome: str) -> bool:
        try:
            return self._finish_team_dispatch_transaction(
                inbox_id, owner_user_id=owner_user_id, outcome=outcome
            )
        except _RunDispatchConflict:
            return False

    def _finish_team_dispatch_transaction(
        self, inbox_id: str, *, owner_user_id: int, outcome: str
    ) -> bool:
        target = {
            "done": "succeeded",
            "failed": "failed",
            "cancelled": "cancelled",
            "interrupted": "interrupted",
        }.get(outcome)
        if target is None:
            raise ValueError("invalid team dispatch outcome")
        ts = now_ts()
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT r.run_id, r.status AS run_status, r.version AS run_version, "
                "s.step_id, s.status AS step_status, s.version AS step_version "
                "FROM run_steps s JOIN runs r ON r.run_id = s.run_id "
                "WHERE s.inbox_id = ? AND r.owner_user_id = ?",
                (inbox_id, owner_user_id),
            ).fetchone()
            if row is None:
                return False
            run_status, step_status = str(row["run_status"]), str(row["step_status"])
            if run_status == target and step_status == target:
                return True
            if run_status not in {"queued", "running", "cancel_requested"} or step_status not in {
                "queued",
                "running",
                "cancel_requested",
            }:
                return False
            run_id, step_id = str(row["run_id"]), str(row["step_id"])
            run_version = int(row["run_version"])
            step_version = int(row["step_version"])
            if target == "cancelled" and run_status == "running":
                changed = conn.execute(
                    "UPDATE runs SET status = 'cancel_requested', version = version + 1, "
                    "updated_at = ? WHERE run_id = ? AND version = ?",
                    (ts, run_id, run_version),
                ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    event_type="run.status_changed",
                    payload={"from": "running", "to": "cancel_requested"},
                    created_at=ts,
                )
                run_status = "cancel_requested"
                run_version += 1
            if target == "cancelled" and step_status == "running":
                changed = conn.execute(
                    "UPDATE run_steps SET status = 'cancel_requested', version = version + 1, "
                    "updated_at = ? WHERE step_id = ? AND version = ?",
                    (ts, step_id, step_version),
                ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    step_id=step_id,
                    event_type="step.status_changed",
                    payload={"from": "running", "to": "cancel_requested"},
                    created_at=ts,
                )
                step_status = "cancel_requested"
                step_version += 1
            if target == "succeeded" and run_status == "queued":
                changed = conn.execute(
                    "UPDATE runs SET status = 'running', version = version + 1, "
                    "started_at = COALESCE(started_at, ?), updated_at = ? "
                    "WHERE run_id = ? AND version = ?",
                    (ts, ts, run_id, row["run_version"]),
                ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
                run_version += 1
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    event_type="run.status_changed",
                    payload={"from": "queued", "to": "running"},
                    created_at=ts,
                )
                run_status = "running"
            if target == "succeeded" and step_status == "queued":
                changed = conn.execute(
                    "UPDATE run_steps SET status = 'running', version = version + 1, "
                    "started_at = COALESCE(started_at, ?), updated_at = ? "
                    "WHERE step_id = ? AND version = ?",
                    (ts, ts, step_id, row["step_version"]),
                ).rowcount
                if int(changed or 0) != 1:
                    raise _RunDispatchConflict
                step_version += 1
                self._append_event(
                    conn,
                    run_id=run_id,
                    owner_user_id=owner_user_id,
                    step_id=step_id,
                    event_type="step.status_changed",
                    payload={"from": "queued", "to": "running"},
                    created_at=ts,
                )
                step_status = "running"
            if target not in RUN_TRANSITIONS.get(run_status, frozenset()) or target not in (
                STEP_TRANSITIONS.get(step_status, frozenset())
            ):
                return False
            changed = conn.execute(
                "UPDATE runs SET status = ?, version = version + 1, updated_at = ?, "
                "lease_owner = NULL, lease_expires_at = NULL, "
                "finished_at = ? WHERE run_id = ? AND version = ?",
                (target, ts, ts, run_id, run_version),
            ).rowcount
            if int(changed or 0) != 1:
                raise _RunDispatchConflict
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                event_type="run.status_changed",
                payload={"from": run_status, "to": target},
                created_at=ts,
            )
            changed = conn.execute(
                "UPDATE run_steps SET status = ?, version = version + 1, updated_at = ?, "
                "finished_at = ?, error_summary = ? WHERE step_id = ? AND version = ?",
                (
                    target,
                    ts,
                    ts,
                    "team_member_failed" if target == "failed" else None,
                    step_id,
                    step_version,
                ),
            ).rowcount
            if int(changed or 0) != 1:
                raise _RunDispatchConflict
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                step_id=step_id,
                event_type="step.status_changed",
                payload={
                    "from": step_status,
                    "to": target,
                    **({"error_code": "team_member_failed"} if target == "failed" else {}),
                },
                created_at=ts,
            )
            conn.execute("DELETE FROM team_dispatch_payloads WHERE inbox_id = ?", (inbox_id,))
        return True

    def transition_step(
        self,
        step_id: str,
        *,
        owner_user_id: int,
        status: str,
        expected_version: int,
        error_code: str | None = None,
        updated_at: int | None = None,
    ) -> dict[str, Any] | None:
        ts = updated_at if updated_at is not None else now_ts()
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT s.run_id, s.status, s.version FROM run_steps s "
                "JOIN runs r ON r.run_id = s.run_id "
                "WHERE s.step_id = ? AND r.owner_user_id = ?",
                (step_id, owner_user_id),
            ).fetchone()
            if row is None or int(row["version"]) != expected_version:
                return None
            old_status = str(row["status"])
            if status not in STEP_TRANSITIONS.get(old_status, frozenset()):
                raise ValueError(f"invalid step transition: {old_status} -> {status}")
            if error_code is not None and (
                status != "failed" or error_code not in STEP_ERROR_CODES
            ):
                raise ValueError("invalid step error code")
            started_at = ts if status == "running" else None
            finished_at = (
                ts if status in {"succeeded", "failed", "cancelled", "interrupted"} else None
            )
            retry = int(status == "queued" and old_status in {"failed", "interrupted"})
            changed = conn.execute(
                "UPDATE run_steps SET status = ?, version = version + 1, attempt = attempt + ?, "
                "error_summary = ?, "
                "updated_at = ?, "
                "started_at = COALESCE(started_at, ?), finished_at = ? "
                "WHERE step_id = ? AND version = ?",
                (
                    status,
                    retry,
                    error_code if status == "failed" else None,
                    ts,
                    started_at,
                    finished_at,
                    step_id,
                    expected_version,
                ),
            ).rowcount
            if int(changed or 0) != 1:
                return None
            run_id = str(row["run_id"])
            self._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                step_id=step_id,
                event_type="step.status_changed",
                payload={
                    "from": old_status,
                    "to": status,
                    **({"error_code": error_code} if error_code is not None else {}),
                },
                created_at=ts,
            )
            updated = conn.execute(
                "SELECT * FROM run_steps WHERE step_id = ?", (step_id,)
            ).fetchone()
        return dict(updated) if updated else None

    def list_steps(self, run_id: str, *, owner_user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT s.* FROM run_steps s JOIN runs r ON r.run_id = s.run_id "
                "WHERE s.run_id = ? AND r.owner_user_id = ? ORDER BY s.created_at, s.step_id",
                (run_id, owner_user_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_events(
        self,
        run_id: str,
        *,
        owner_user_id: int,
        after_sequence: int = 0,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT e.event_id, e.run_id, e.step_id, e.sequence, e.event_type, "
                "e.payload_json, e.created_at FROM run_events e JOIN runs r ON r.run_id = e.run_id "
                "WHERE e.run_id = ? AND r.owner_user_id = ? AND e.sequence > ? "
                "ORDER BY e.sequence LIMIT ?",
                (run_id, owner_user_id, max(0, after_sequence), max(1, min(limit, 100))),
            ).fetchall()
        return [
            {
                "event_id": row["event_id"],
                "run_id": row["run_id"],
                "step_id": row["step_id"],
                "sequence": row["sequence"],
                "type": row["event_type"],
                "payload": json.loads(row["payload_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

    def _append_event(
        self,
        conn: Any,
        *,
        run_id: str,
        owner_user_id: int,
        event_type: str,
        payload: dict[str, Any],
        created_at: int,
        step_id: str | None = None,
    ) -> None:
        row = conn.execute(
            "UPDATE runs SET next_event_sequence = next_event_sequence + 1 "
            "WHERE run_id = ? AND owner_user_id = ? AND next_event_sequence < ? "
            "RETURNING next_event_sequence",
            (run_id, owner_user_id, MAX_RUN_EVENTS),
        ).fetchone()
        if row is None:
            exists = conn.execute(
                "SELECT 1 FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
            if exists is not None:
                raise RunEventLimitExceeded("run event limit exceeded")
            raise KeyError("run not found")
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 16_384:
            raise ValueError("run event payload exceeds 16 KiB")
        conn.execute(
            "INSERT INTO run_events(event_id, run_id, step_id, sequence, event_type, "
            "payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                uuid4().hex,
                run_id,
                step_id,
                int(row["next_event_sequence"]),
                event_type,
                encoded,
                created_at,
            ),
        )
