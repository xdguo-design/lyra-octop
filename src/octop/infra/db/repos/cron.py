"""Cron jobs table access."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from octop.infra.cron.task_type import (
    DEFAULT_CRON_TASK_TYPE,
    CronTaskType,
    default_cron_name,
    normalize_cron_task_type,
    require_cron_task_type,
)
from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import (
    UNSET,
    DbRow,
    bool_int,
    map_rows,
    now_ts,
    partial_updates,
)

__all__ = [
    "DEFAULT_CRON_TASK_TYPE",
    "CronJobRepo",
    "CronJobRow",
    "CronTaskType",
    "normalize_cron_task_type",
    "require_cron_task_type",
]


def _encode_mcp_servers(names: list[str] | None) -> str:
    cleaned = [str(n).strip() for n in (names or []) if str(n).strip()]
    return json.dumps(cleaned, ensure_ascii=False)


def _decode_mcp_servers(raw: Any) -> list[str]:
    if raw is None or raw == "":
        return []
    if isinstance(raw, list):
        return [str(n).strip() for n in raw if str(n).strip()]
    try:
        parsed = json.loads(str(raw))
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [str(n).strip() for n in parsed if str(n).strip()]


def _optional_str(r: DbRow, key: str) -> str | None:
    try:
        value = r[key]
    except (KeyError, IndexError):
        return None
    text = str(value).strip() if value else ""
    return text or None


@dataclass(frozen=True)
class CronJobRow:
    id: int
    cron_id: str
    name: str
    agent_id: str
    user_id: int
    trigger: str
    prompt: str
    session_key: str
    model: str | None
    fresh_thread: int
    enabled: int
    task_type: str
    mcp_servers: list[str]
    last_run_at: int | None
    last_status: str | None
    last_error: str | None
    created_at: int
    updated_at: int

    @classmethod
    def from_row(cls, r: DbRow) -> CronJobRow:
        return cls(
            id=r["id"],
            cron_id=r["cron_id"],
            name=_optional_str(r, "name") or default_cron_name(r["prompt"], r["cron_id"]),
            agent_id=r["agent_id"],
            user_id=r["user_id"],
            trigger=r["schedule_spec"],
            prompt=r["prompt"],
            session_key=r["session_key"],
            model=r["model"],
            fresh_thread=r["fresh_thread"],
            enabled=r["enabled"],
            task_type=normalize_cron_task_type(str(r["task_type"])),
            mcp_servers=_decode_mcp_servers(r["mcp_servers"]),
            last_run_at=r["last_run_at"],
            last_status=r["last_status"],
            last_error=r["last_error"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    def to_public_dict(self, *, include_agent: bool = False) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.cron_id,
            "name": self.name,
            "trigger": self.trigger,
            "prompt": self.prompt,
            "session_key": self.session_key,
            "model": self.model,
            "fresh_thread": bool(self.fresh_thread),
            "enabled": bool(self.enabled),
            "task_type": self.task_type,
            "mcp_servers": list(self.mcp_servers),
            "last_run_at": self.last_run_at,
            "last_status": self.last_status,
        }
        if include_agent:
            out["agent_id"] = self.agent_id
            out["last_error"] = self.last_error
        return out


class CronJobRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def create(
        self,
        *,
        cron_id: str,
        agent_id: str,
        user_id: int,
        trigger: str,
        prompt: str,
        session_key: str,
        fresh_thread: bool = False,
        model: str | None = None,
        task_type: CronTaskType = DEFAULT_CRON_TASK_TYPE,
        mcp_servers: list[str] | None = None,
        enabled: bool = True,
        name: str | None = None,
    ) -> str:
        ts = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO cron_jobs(cron_id, name, agent_id, user_id, schedule_spec, prompt, "
                "session_key, model, fresh_thread, task_type, mcp_servers, enabled, "
                "created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    cron_id,
                    (name or "").strip() or default_cron_name(prompt, cron_id),
                    agent_id,
                    user_id,
                    trigger,
                    prompt,
                    session_key,
                    model,
                    bool_int(fresh_thread),
                    task_type,
                    _encode_mcp_servers(mcp_servers),
                    bool_int(enabled),
                    ts,
                    ts,
                ),
            )
        return cron_id

    def get(self, cron_id: str) -> CronJobRow | None:
        with self._db.connect() as conn:
            r = conn.execute("SELECT * FROM cron_jobs WHERE cron_id = ?", (cron_id,)).fetchone()
        return CronJobRow.from_row(r) if r else None

    def list_by_agent(
        self,
        agent_id: str,
        *,
        include_disabled: bool = True,
        user_id: int | None = None,
    ) -> list[CronJobRow]:
        sql = "SELECT * FROM cron_jobs WHERE agent_id = ?"
        params: list[object] = [agent_id]
        if user_id is not None:
            sql += " AND user_id = ?"
            params.append(user_id)
        if not include_disabled:
            sql += " AND enabled = 1"
        sql += " ORDER BY created_at DESC"
        with self._db.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return map_rows(rows, CronJobRow)

    def list_all(self, *, include_disabled: bool = True) -> list[CronJobRow]:
        sql = "SELECT * FROM cron_jobs"
        if not include_disabled:
            sql += " WHERE enabled = 1"
        sql += " ORDER BY agent_id, created_at DESC"
        with self._db.connect() as conn:
            rows = conn.execute(sql).fetchall()
        return map_rows(rows, CronJobRow)

    def set_run_status(
        self,
        cron_id: str,
        *,
        ts: int,
        status: str,
        error: str | None = None,
    ) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE cron_jobs SET last_run_at = ?, last_status = ?, last_error = ?, "
                "updated_at = ? WHERE cron_id = ?",
                (ts, status, error, now_ts(), cron_id),
            )

    def start_run(
        self,
        *,
        run_id: str,
        cron_id: str,
        agent_id: str,
        user_id: int,
        instance_id: str,
        trigger_kind: str,
        started_at: int,
    ) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO cron_runs(run_id, cron_id, agent_id, user_id, instance_id, "
                "trigger_kind, status, started_at) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)",
                (run_id, cron_id, agent_id, user_id, instance_id, trigger_kind, started_at),
            )

    def finish_run(
        self,
        run_id: str,
        *,
        status: str,
        finished_at: int,
        error: str | None = None,
    ) -> bool:
        if status not in {"ok", "error", "cancelled", "interrupted"}:
            raise ValueError("invalid cron run terminal status")
        with self._db.transaction() as conn:
            changed = conn.execute(
                "UPDATE cron_runs SET status = ?, finished_at = ?, error = ? "
                "WHERE run_id = ? AND status = 'running'",
                (status, finished_at, error[:1000] if error else None, run_id),
            ).rowcount
        return int(changed or 0) == 1

    def touch_instance(self, instance_id: str, *, heartbeat_at: int) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO cron_instances(instance_id, heartbeat_at) VALUES (?, ?) "
                "ON CONFLICT(instance_id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at",
                (instance_id, heartbeat_at),
            )

    def remove_instance(self, instance_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM cron_instances WHERE instance_id = ?", (instance_id,))

    def mark_interrupted_runs(
        self, *, finished_at: int, stale_before: int, current_instance_id: str
    ) -> int:
        """Close runs whose server instance has not renewed its heartbeat."""
        with self._db.transaction() as conn:
            changed = conn.execute(
                "UPDATE cron_runs SET status = 'interrupted', finished_at = ?, "
                "error = 'Process stopped before the run completed' WHERE status = 'running' "
                "AND instance_id != ? AND NOT EXISTS (SELECT 1 FROM cron_instances i "
                "WHERE i.instance_id = cron_runs.instance_id AND i.heartbeat_at >= ?)",
                (finished_at, current_instance_id, stale_before),
            ).rowcount
        return int(changed or 0)

    def get_run(
        self, run_id: str, *, user_id: int, agent_id: str, cron_id: str
    ) -> dict[str, object] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT run_id, cron_id, agent_id, trigger_kind, status, started_at, "
                "finished_at, error FROM cron_runs WHERE run_id = ? AND user_id = ? "
                "AND agent_id = ? AND cron_id = ?",
                (run_id, user_id, agent_id, cron_id),
            ).fetchone()
        return dict(row) if row else None

    def list_runs(
        self,
        *,
        cron_id: str,
        user_id: int,
        agent_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict[str, object]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT run_id, cron_id, agent_id, trigger_kind, status, started_at, "
                "finished_at, error FROM cron_runs WHERE cron_id = ? AND user_id = ? "
                "AND agent_id = ? ORDER BY started_at DESC, run_id DESC LIMIT ? OFFSET ?",
                (cron_id, user_id, agent_id, max(1, min(limit, 100)), max(0, offset)),
            ).fetchall()
        return [dict(row) for row in rows]

    def update(
        self,
        cron_id: str,
        *,
        trigger: str | None = None,
        name: str | None = None,
        prompt: str | None = None,
        session_key: str | None = None,
        fresh_thread: bool | None = None,
        enabled: bool | None = None,
        task_type: CronTaskType | None = None,
        model: str | None | object = UNSET,
        mcp_servers: list[str] | None | object = UNSET,
    ) -> None:
        fields, params = partial_updates(
            [
                ("schedule_spec", trigger),
                ("name", name),
                ("prompt", prompt),
                ("session_key", session_key),
                ("task_type", task_type),
            ]
        )
        if fresh_thread is not None:
            fields.append("fresh_thread = ?")
            params.append(bool_int(fresh_thread))
        if model is not UNSET:
            fields.append("model = ?")
            params.append(model)
        if mcp_servers is not UNSET:
            fields.append("mcp_servers = ?")
            params.append(
                _encode_mcp_servers(mcp_servers if isinstance(mcp_servers, list) else None)
            )
        if enabled is not None:
            fields.append("enabled = ?")
            params.append(bool_int(enabled))
        if not fields:
            return
        fields.append("updated_at = ?")
        params.append(now_ts())
        params.append(cron_id)
        with self._db.transaction() as conn:
            conn.execute(f"UPDATE cron_jobs SET {', '.join(fields)} WHERE cron_id = ?", params)

    def delete(self, cron_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM cron_jobs WHERE cron_id = ?", (cron_id,))
