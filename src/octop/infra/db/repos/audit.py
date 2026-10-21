"""Audit log table access."""

from __future__ import annotations

from dataclasses import dataclass

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, map_rows, now_ts

ACTOR_SYSTEM = "_system"
ACTOR_ADMIN = "_admin"


@dataclass(frozen=True)
class AuditRow:
    id: int
    ts: int
    actor: str | None
    action: str
    target: str | None
    payload: str | None
    project_id: str | None

    @classmethod
    def from_row(cls, r: DbRow) -> AuditRow:
        return cls(
            id=r["id"],
            ts=r["ts"],
            actor=r["actor"],
            action=r["action"],
            target=r["target"],
            payload=r["payload"],
            project_id=r["project_id"],
        )


class AuditRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def write(
        self,
        *,
        actor: str | None,
        action: str,
        target: str | None = None,
        payload: str | None = None,
        project_id: str | None = None,
    ) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO audit_log(ts, actor, action, target, payload, project_id) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (now_ts(), actor, action, target, payload or None, project_id),
            )

    def system_event(
        self,
        action: str,
        target: str | None = None,
        payload: str | None = None,
    ) -> None:
        """Write an audit event with actor = ``_system``."""
        self.write(actor=ACTOR_SYSTEM, action=action, target=target, payload=payload)

    def admin_event(
        self,
        action: str,
        target: str | None = None,
        payload: str | None = None,
    ) -> None:
        """Write an audit event with actor = ``_admin``."""
        self.write(actor=ACTOR_ADMIN, action=action, target=target, payload=payload)

    def user_event(
        self,
        username: str,
        action: str,
        target: str | None = None,
        payload: str | None = None,
    ) -> None:
        """Write an audit event with actor = username."""
        self.write(actor=username, action=action, target=target, payload=payload)

    def query(
        self,
        *,
        since: int | None = None,
        actor: str | None = None,
        action: str | None = None,
        project_id: str | None = None,
        until: int | None = None,
        limit: int = 100,
    ) -> list[AuditRow]:
        conditions: list[str] = []
        params: list[object] = []
        if since is not None:
            conditions.append("ts >= ?")
            params.append(since)
        if actor is not None:
            conditions.append("actor = ?")
            params.append(actor)
        if action is not None:
            conditions.append("action = ?")
            params.append(action)
        if project_id is not None:
            conditions.append("project_id = ?")
            params.append(project_id)
        if until is not None:
            conditions.append("ts <= ?")
            params.append(until)
        sql = "SELECT * FROM audit_log"
        if conditions:
            sql += " WHERE " + " AND ".join(conditions)
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        with self._db.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return map_rows(rows, AuditRow)

    def list_projects(self) -> list[dict[str, str]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT a.project_id, COALESCE(p.name, a.project_id) AS name "
                "FROM audit_log a LEFT JOIN workbench_projects p ON p.project_id = a.project_id "
                "WHERE a.project_id IS NOT NULL ORDER BY name"
            ).fetchall()
        return [{"project_id": row["project_id"], "name": row["name"]} for row in rows]

    def delete_before(self, cutoff_ts: int) -> int:
        """Delete audit rows older than ``cutoff_ts``. Returns deleted count."""
        with self._db.transaction() as conn:
            cursor = conn.execute("DELETE FROM audit_log WHERE ts < ?", (cutoff_ts,))
        return int(cursor.rowcount or 0)
