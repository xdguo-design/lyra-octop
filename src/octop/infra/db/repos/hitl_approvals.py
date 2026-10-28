"""Durable HITL pending state; request payloads are encrypted by the coordinator."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, map_rows, now_ts

ApprovalStatus = Literal["pending", "approved", "rejected", "expired"]


@dataclass(frozen=True)
class HitlApprovalRow:
    pending_id: str
    user_id: int
    agent_id: str
    thread_id: str
    session_key: str
    channel_type: str
    resume_agent_id: str | None
    resume_thread_id: str | None
    request_blob: bytes
    status: ApprovalStatus
    created_at: int
    updated_at: int
    expires_at: int
    run_id: str | None = None
    step_id: str | None = None

    @classmethod
    def from_row(cls, row: DbRow) -> HitlApprovalRow:
        return cls(
            pending_id=str(row["pending_id"]),
            user_id=int(row["user_id"]),
            agent_id=str(row["agent_id"]),
            thread_id=str(row["thread_id"]),
            session_key=str(row["session_key"]),
            channel_type=str(row["channel_type"]),
            resume_agent_id=row["resume_agent_id"],
            resume_thread_id=row["resume_thread_id"],
            request_blob=bytes(row["request_blob"]),
            status=str(row["status"]),  # type: ignore[arg-type]
            created_at=int(row["created_at"]),
            updated_at=int(row["updated_at"]),
            expires_at=int(row["expires_at"]),
            run_id=str(row["run_id"]) if row["run_id"] else None,
            step_id=str(row["step_id"]) if row["step_id"] else None,
        )


class HitlApprovalRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def create(
        self,
        *,
        pending_id: str,
        user_id: int,
        agent_id: str,
        thread_id: str,
        session_key: str,
        channel_type: str,
        resume_agent_id: str | None,
        resume_thread_id: str | None,
        request_blob: bytes,
        tools: list[str],
        expires_at: int,
        run_id: str | None = None,
        step_id: str | None = None,
    ) -> None:
        now = now_ts()
        payload = json.dumps(
            {
                "agent_id": agent_id,
                "thread_id": thread_id,
                "channel_type": channel_type,
                "tools": tools,
            },
            separators=(",", ":"),
        )
        with self._db.transaction() as conn:
            resume_filter = (
                "resume_agent_id IS NULL" if resume_agent_id is None else "resume_agent_id = ?"
            )
            prior_params: tuple[Any, ...] = (session_key, user_id, agent_id)
            if resume_agent_id is not None:
                prior_params += (resume_agent_id,)
            prior = conn.execute(
                "SELECT pending_id, agent_id, thread_id FROM hitl_approvals "
                "WHERE session_key = ? AND user_id = ? AND agent_id = ? "
                f"AND status = 'pending' AND {resume_filter}",
                prior_params,
            ).fetchall()
            for row in prior:
                conn.execute(
                    "UPDATE hitl_approvals SET status = 'expired', request_blob = ?, updated_at = ? "
                    "WHERE pending_id = ? AND status = 'pending'",
                    (b"", now, row["pending_id"]),
                )
                self._insert_audit(
                    conn,
                    actor="_system",
                    action="tool_approval.decision",
                    target=str(row["pending_id"]),
                    payload=json.dumps(
                        {
                            "agent_id": row["agent_id"],
                            "thread_id": row["thread_id"],
                            "decision": "expired",
                        },
                        separators=(",", ":"),
                    ),
                    ts=now,
                )
            conn.execute(
                "INSERT INTO hitl_approvals("
                "pending_id, user_id, agent_id, thread_id, session_key, channel_type, "
                "resume_agent_id, resume_thread_id, run_id, step_id, request_blob, status, created_at, "
                "updated_at, expires_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
                (
                    pending_id,
                    user_id,
                    agent_id,
                    thread_id,
                    session_key,
                    channel_type,
                    resume_agent_id,
                    resume_thread_id,
                    run_id,
                    step_id,
                    request_blob,
                    now,
                    now,
                    expires_at,
                ),
            )
            self._insert_audit(
                conn,
                actor=f"user:{user_id}",
                action="tool_approval.pending",
                target=pending_id,
                payload=payload,
                ts=now,
            )

    def get(self, pending_id: str) -> HitlApprovalRow | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM hitl_approvals WHERE pending_id = ?",
                (pending_id,),
            ).fetchone()
        return HitlApprovalRow.from_row(row) if row is not None else None

    def get_pending_for_thread(
        self,
        pending_id: str,
        *,
        user_id: int,
        agent_id: str,
        thread_id: str,
    ) -> HitlApprovalRow | None:
        self._expire_due()
        now = now_ts()
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM hitl_approvals WHERE pending_id = ? AND user_id = ? "
                "AND status = 'pending' AND expires_at > ? AND "
                "((agent_id = ? AND thread_id = ?) OR "
                "(resume_agent_id = ? AND resume_thread_id = ?))",
                (pending_id, user_id, now, agent_id, thread_id, agent_id, thread_id),
            ).fetchone()
        return HitlApprovalRow.from_row(row) if row is not None else None

    def list_pending_for_thread(
        self,
        *,
        user_id: int,
        agent_id: str,
        thread_id: str,
    ) -> list[HitlApprovalRow]:
        self._expire_due()
        now = now_ts()
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM hitl_approvals WHERE user_id = ? AND status = 'pending' "
                "AND expires_at > ? AND ((agent_id = ? AND thread_id = ?) OR "
                "(resume_agent_id = ? AND resume_thread_id = ?)) "
                "ORDER BY created_at DESC, pending_id DESC",
                (user_id, now, agent_id, thread_id, agent_id, thread_id),
            ).fetchall()
        return map_rows(rows, HitlApprovalRow)

    def list_pending_for_session(
        self,
        *,
        user_id: int,
        session_key: str,
        agent_id: str,
    ) -> list[HitlApprovalRow]:
        self._expire_due()
        now = now_ts()
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM hitl_approvals WHERE user_id = ? AND session_key = ? "
                "AND agent_id = ? AND status = 'pending' AND expires_at > ? "
                "ORDER BY created_at DESC, pending_id DESC",
                (user_id, session_key, agent_id, now),
            ).fetchall()
        return map_rows(rows, HitlApprovalRow)

    def list_pending_for_agent(self, *, user_id: int, agent_id: str) -> list[HitlApprovalRow]:
        self._expire_due()
        now = now_ts()
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM hitl_approvals WHERE user_id = ? AND status = 'pending' "
                "AND expires_at > ? AND (agent_id = ? OR resume_agent_id = ?) "
                "ORDER BY created_at DESC, pending_id DESC",
                (user_id, now, agent_id, agent_id),
            ).fetchall()
        return map_rows(rows, HitlApprovalRow)

    def update_request(self, pending_id: str, request_blob: bytes) -> bool:
        with self._db.transaction() as conn:
            result = conn.execute(
                "UPDATE hitl_approvals SET request_blob = ?, updated_at = ? "
                "WHERE pending_id = ? AND status = 'pending' AND expires_at > ?",
                (request_blob, now_ts(), pending_id, now_ts()),
            )
        return bool(result.rowcount == 1)

    def set_resume_target(self, pending_id: str, agent_id: str, thread_id: str) -> bool:
        with self._db.transaction() as conn:
            result = conn.execute(
                "UPDATE hitl_approvals SET resume_agent_id = ?, resume_thread_id = ?, "
                "updated_at = ? WHERE pending_id = ? AND status = 'pending' AND expires_at > ?",
                (agent_id, thread_id, now_ts(), pending_id, now_ts()),
            )
        return bool(result.rowcount == 1)

    def resolve(
        self,
        pending_id: str,
        status: ApprovalStatus,
        *,
        actor: str,
        agent_id: str,
        thread_id: str,
    ) -> bool:
        now = now_ts()
        payload = json.dumps(
            {"agent_id": agent_id, "thread_id": thread_id, "decision": status},
            separators=(",", ":"),
        )
        with self._db.transaction() as conn:
            result = conn.execute(
                "UPDATE hitl_approvals SET status = ?, request_blob = ?, updated_at = ? "
                "WHERE pending_id = ? AND status = 'pending' "
                "AND (expires_at > ? OR ? = 'expired')",
                (status, b"", now, pending_id, now, status),
            )
            if result.rowcount != 1:
                return False
            self._insert_audit(
                conn,
                actor=actor,
                action="tool_approval.decision",
                target=pending_id,
                payload=payload,
                ts=now,
            )
        return True

    def expire_thread(self, *, user_id: int, agent_id: str, thread_id: str) -> int:
        rows = self.list_pending_for_thread(
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
        )
        expired = 0
        for row in rows:
            expired += int(
                self.resolve(
                    row.pending_id,
                    "expired",
                    actor="_system",
                    agent_id=row.agent_id,
                    thread_id=row.thread_id,
                ),
            )
        return expired

    def _expire_due(self) -> None:
        now = now_ts()
        with self._db.transaction() as conn:
            rows = conn.execute(
                "SELECT pending_id, user_id, agent_id, thread_id FROM hitl_approvals "
                "WHERE status = 'pending' AND expires_at <= ? "
                "ORDER BY expires_at LIMIT 500",
                (now,),
            ).fetchall()
            for row in rows:
                result = conn.execute(
                    "UPDATE hitl_approvals SET status = 'expired', request_blob = ?, updated_at = ? "
                    "WHERE pending_id = ? AND status = 'pending' AND expires_at <= ?",
                    (b"", now, row["pending_id"], now),
                )
                if result.rowcount == 1:
                    self._insert_audit(
                        conn,
                        actor="_system",
                        action="tool_approval.decision",
                        target=str(row["pending_id"]),
                        payload=json.dumps(
                            {
                                "agent_id": row["agent_id"],
                                "thread_id": row["thread_id"],
                                "decision": "expired",
                            },
                            separators=(",", ":"),
                        ),
                        ts=now,
                    )

    @staticmethod
    def _insert_audit(
        conn: Any,
        *,
        actor: str,
        action: str,
        target: str,
        payload: str,
        ts: int,
    ) -> None:
        conn.execute(
            "INSERT INTO audit_log(ts, actor, action, target, payload, project_id) "
            "VALUES (?, ?, ?, ?, ?, NULL)",
            (ts, actor, action, target, payload),
        )
