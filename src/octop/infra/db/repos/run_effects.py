"""Owner-scoped ledger for approved external side effects."""

from __future__ import annotations

import json
from typing import Any, Literal
from uuid import uuid4

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.db.repos.runs import RunRepo

EffectStatus = Literal["requested", "succeeded", "failed", "unknown"]
_EFFECT_TRANSITIONS: dict[str, frozenset[str]] = {
    "requested": frozenset({"succeeded", "failed", "unknown"}),
    "unknown": frozenset({"succeeded", "failed"}),
    "succeeded": frozenset(),
    "failed": frozenset(),
}


class EffectIdempotencyConflict(ValueError):
    """Raised when an external key is reused for a different requested effect."""


class RunEffectRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def request(
        self,
        *,
        owner_user_id: int,
        run_id: str,
        step_id: str,
        agent_id: str,
        thread_id: str,
        registration_id: str,
        scope: str,
        resource_hash: str,
        request_hash: str,
        idempotency_key: str,
        approval_id: str,
        now: int | None = None,
    ) -> tuple[dict[str, Any], bool]:
        ts = now if now is not None else now_ts()
        for value in (resource_hash, request_hash):
            if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
                raise ValueError("effect hashes must be lowercase SHA-256 hex")
        if not idempotency_key or len(idempotency_key) > 128:
            raise ValueError("invalid external idempotency key")

        with self._db.transaction() as conn:
            run = conn.execute(
                "SELECT agent_id, status FROM runs WHERE run_id = ? AND owner_user_id = ?",
                (run_id, owner_user_id),
            ).fetchone()
            step = conn.execute(
                "SELECT status FROM run_steps WHERE step_id = ? AND run_id = ?",
                (step_id, run_id),
            ).fetchone()
            if (
                run is None
                or run["agent_id"] != agent_id
                or run["status"] != "running"
                or step is None
                or step["status"] != "running"
            ):
                raise PermissionError("effect requires an owned running Run and Step")

            grant = conn.execute(
                "SELECT g.write_scopes_json FROM capability_grants g "
                "JOIN app_registrations a ON a.registration_id = g.registration_id "
                "WHERE g.registration_id = ? AND g.owner_user_id = ? AND g.agent_id = ? "
                "AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?) "
                "AND a.enabled = 1",
                (registration_id, owner_user_id, agent_id, ts),
            ).fetchone()
            if grant is None:
                raise PermissionError("active write grant required")
            try:
                write_scopes = json.loads(grant["write_scopes_json"])
            except (TypeError, json.JSONDecodeError):
                write_scopes = []
            if not isinstance(write_scopes, list) or scope not in write_scopes:
                raise PermissionError("active write scope required")

            approval = conn.execute(
                "SELECT user_id, agent_id, thread_id, resume_agent_id, resume_thread_id, expires_at "
                "FROM hitl_approvals "
                "WHERE pending_id = ? AND status = 'approved'",
                (approval_id,),
            ).fetchone()
            if (
                approval is None
                or int(approval["user_id"]) != owner_user_id
                or not (
                    (approval["agent_id"] == agent_id and approval["thread_id"] == thread_id)
                    or (
                        approval["resume_agent_id"] == agent_id
                        and approval["resume_thread_id"] == thread_id
                    )
                )
                or int(approval["expires_at"]) <= ts
            ):
                raise PermissionError("current owner approval required")
            audit = conn.execute(
                "SELECT actor FROM audit_log WHERE action = 'tool_approval.decision' "
                "AND target = ? ORDER BY ts DESC LIMIT 1",
                (approval_id,),
            ).fetchone()
            actor = str(audit["actor"]) if audit is not None else ""
            if actor != f"user:{owner_user_id}":
                raise PermissionError("owner approval decision is missing")

            prior = conn.execute(
                "SELECT * FROM run_effects WHERE registration_id = ? AND idempotency_key = ?",
                (registration_id, idempotency_key),
            ).fetchone()
            if prior is not None:
                matches = (
                    prior["owner_user_id"] == owner_user_id
                    and prior["run_id"] == run_id
                    and prior["step_id"] == step_id
                    and prior["agent_id"] == agent_id
                    and prior["scope"] == scope
                    and prior["resource_hash"] == resource_hash
                    and prior["request_hash"] == request_hash
                    and prior["approval_id"] == approval_id
                )
                if not matches:
                    raise EffectIdempotencyConflict("external key belongs to a different effect")
                return dict(prior), False

            effect_id = uuid4().hex
            inserted = conn.execute(
                "INSERT INTO run_effects(effect_id, run_id, step_id, owner_user_id, agent_id, "
                "registration_id, approval_id, approved_by_user_id, approval_expires_at, scope, "
                "resource_hash, request_hash, idempotency_key, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?) "
                "ON CONFLICT(registration_id, idempotency_key) DO NOTHING "
                "RETURNING effect_id",
                (
                    effect_id,
                    run_id,
                    step_id,
                    owner_user_id,
                    agent_id,
                    registration_id,
                    approval_id,
                    owner_user_id,
                    int(approval["expires_at"]),
                    scope,
                    resource_hash,
                    request_hash,
                    idempotency_key,
                    ts,
                    ts,
                ),
            ).fetchone()
            if inserted is None:
                prior = conn.execute(
                    "SELECT * FROM run_effects WHERE registration_id = ? AND idempotency_key = ?",
                    (registration_id, idempotency_key),
                ).fetchone()
                if prior is None:
                    raise RuntimeError("effect idempotency conflict did not return a row")
                matches = (
                    prior["owner_user_id"] == owner_user_id
                    and prior["run_id"] == run_id
                    and prior["step_id"] == step_id
                    and prior["agent_id"] == agent_id
                    and prior["scope"] == scope
                    and prior["resource_hash"] == resource_hash
                    and prior["request_hash"] == request_hash
                    and prior["approval_id"] == approval_id
                )
                if not matches:
                    raise EffectIdempotencyConflict("external key belongs to a different effect")
                return dict(prior), False
            RunRepo(self._db)._append_event(
                conn,
                run_id=run_id,
                owner_user_id=owner_user_id,
                step_id=step_id,
                event_type="external_effect.requested",
                payload={"effect_id": effect_id, "scope": scope, "resource_hash": resource_hash},
                created_at=ts,
            )
            row = conn.execute(
                "SELECT * FROM run_effects WHERE effect_id = ?", (effect_id,)
            ).fetchone()
        return dict(row), True

    def resolve(
        self,
        effect_id: str,
        *,
        owner_user_id: int,
        status: Literal["succeeded", "failed", "unknown"],
        result_hash: str | None = None,
        now: int | None = None,
    ) -> dict[str, Any] | None:
        if result_hash is not None and (
            len(result_hash) != 64 or any(char not in "0123456789abcdef" for char in result_hash)
        ):
            raise ValueError("result hash must be lowercase SHA-256 hex")
        ts = now if now is not None else now_ts()
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT * FROM run_effects WHERE effect_id = ? AND owner_user_id = ?",
                (effect_id, owner_user_id),
            ).fetchone()
            if row is None:
                return None
            current = str(row["status"])
            if current == status:
                return dict(row)
            if status not in _EFFECT_TRANSITIONS.get(current, frozenset()):
                raise ValueError(f"invalid external effect transition: {current} -> {status}")
            conn.execute(
                "UPDATE run_effects SET status = ?, result_hash = ?, updated_at = ? "
                "WHERE effect_id = ? AND owner_user_id = ? AND status = ?",
                (status, result_hash, ts, effect_id, owner_user_id, current),
            )
            RunRepo(self._db)._append_event(
                conn,
                run_id=str(row["run_id"]),
                owner_user_id=owner_user_id,
                step_id=str(row["step_id"]),
                event_type=f"external_effect.{status}",
                payload={"effect_id": effect_id, "scope": str(row["scope"])},
                created_at=ts,
            )
            updated = conn.execute(
                "SELECT * FROM run_effects WHERE effect_id = ?", (effect_id,)
            ).fetchone()
        return dict(updated) if updated is not None else None

    def reconcile_terminal_runs(self, *, now: int | None = None) -> int:
        """Mark unreported requests unknown once their Run can no longer execute."""
        ts = now if now is not None else now_ts()
        terminal = ("succeeded", "failed", "interrupted", "cancelled", "unknown_external_effect")
        placeholders = ", ".join("?" for _ in terminal)
        changed_count = 0
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT e.effect_id, e.run_id, e.step_id, e.owner_user_id, e.scope "
                "FROM run_effects e JOIN runs r ON r.run_id = e.run_id "
                f"WHERE e.status = 'requested' AND r.status IN ({placeholders}) "
                "ORDER BY e.created_at, e.effect_id",
                terminal,
            ).fetchall()
            for row in rows:
                changed = conn.execute(
                    "UPDATE run_effects SET status = 'unknown', updated_at = ? "
                    "WHERE effect_id = ? AND status = 'requested' RETURNING effect_id",
                    (ts, row["effect_id"]),
                ).fetchone()
                if changed is None:
                    continue
                RunRepo(self._db)._append_event(
                    conn,
                    run_id=str(row["run_id"]),
                    owner_user_id=int(row["owner_user_id"]),
                    step_id=str(row["step_id"]),
                    event_type="external_effect.unknown",
                    payload={"effect_id": str(row["effect_id"]), "scope": str(row["scope"])},
                    created_at=ts,
                )
                changed_count += 1
        return changed_count

    def list_for_run(self, run_id: str, *, owner_user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT e.* FROM run_effects e JOIN runs r ON r.run_id = e.run_id "
                "WHERE e.run_id = ? AND e.owner_user_id = ? AND r.owner_user_id = ? "
                "ORDER BY e.created_at, e.effect_id",
                (run_id, owner_user_id, owner_user_id),
            ).fetchall()
        return [dict(row) for row in rows]
