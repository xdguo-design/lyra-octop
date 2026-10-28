"""App registrations and owner-scoped capability grants."""

from __future__ import annotations

import json
from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.utils.ulid import new_short_id


class AppRegistryRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def create_registration(
        self, *, owner_user_id: int, app_key: str, display_name: str
    ) -> dict[str, Any] | None:
        ts = now_ts()
        registration_id = new_short_id()
        with self._db.connect() as conn:
            row = conn.execute(
                "INSERT INTO app_registrations(registration_id, owner_user_id, app_key, "
                "display_name, adapter_kind, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'mock', ?, ?) "
                "ON CONFLICT(owner_user_id, app_key) DO NOTHING RETURNING *",
                (registration_id, owner_user_id, app_key, display_name, ts, ts),
            ).fetchone()
        return self._registration(row) if row is not None else None

    def list_registrations(self, *, owner_user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM app_registrations WHERE owner_user_id = ? "
                "ORDER BY created_at, registration_id",
                (owner_user_id,),
            ).fetchall()
        return [self._registration(row) for row in rows]

    def get_registration(
        self, *, owner_user_id: int, registration_id: str
    ) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM app_registrations WHERE owner_user_id = ? AND registration_id = ?",
                (owner_user_id, registration_id),
            ).fetchone()
        return self._registration(row) if row is not None else None

    def set_enabled(self, *, owner_user_id: int, registration_id: str, enabled: bool) -> bool:
        with self._db.connect() as conn:
            cursor = conn.execute(
                "UPDATE app_registrations SET enabled = ?, updated_at = ? "
                "WHERE owner_user_id = ? AND registration_id = ?",
                (enabled, now_ts(), owner_user_id, registration_id),
            )
        return bool(cursor.rowcount == 1)

    def save_grant(
        self,
        *,
        owner_user_id: int,
        registration_id: str,
        agent_id: str,
        read_scopes: list[str],
        write_scopes: list[str],
        expires_at: int | None,
    ) -> dict[str, Any] | None:
        ts = now_ts()
        with self._db.transaction() as conn:
            app = conn.execute(
                "SELECT 1 FROM app_registrations WHERE owner_user_id = ? "
                "AND registration_id = ? AND enabled = ?",
                (owner_user_id, registration_id, True),
            ).fetchone()
            agent = conn.execute(
                "SELECT 1 FROM agents WHERE user_id = ? AND agent_id = ?",
                (owner_user_id, agent_id),
            ).fetchone()
            if app is None or agent is None:
                return None
            row = conn.execute(
                "INSERT INTO capability_grants(grant_id, registration_id, owner_user_id, "
                "agent_id, read_scopes_json, write_scopes_json, expires_at, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(registration_id, owner_user_id, agent_id) DO UPDATE SET "
                "read_scopes_json = excluded.read_scopes_json, "
                "write_scopes_json = excluded.write_scopes_json, expires_at = excluded.expires_at, "
                "revoked_at = NULL, updated_at = excluded.updated_at RETURNING *",
                (
                    new_short_id(),
                    registration_id,
                    owner_user_id,
                    agent_id,
                    json.dumps(read_scopes, separators=(",", ":")),
                    json.dumps(write_scopes, separators=(",", ":")),
                    expires_at,
                    ts,
                    ts,
                ),
            ).fetchone()
        return self._grant(row) if row is not None else None

    def list_grants(self, *, owner_user_id: int, registration_id: str) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM capability_grants WHERE owner_user_id = ? "
                "AND registration_id = ? ORDER BY created_at, grant_id",
                (owner_user_id, registration_id),
            ).fetchall()
        return [self._grant(row) for row in rows]

    def effective_scope_snapshot(
        self, *, owner_user_id: int, agent_id: str, now: int | None = None
    ) -> list[dict[str, Any]]:
        """Return active capability metadata for audit; callers must reauthorize at execution."""
        ts = now if now is not None else now_ts()
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT a.registration_id, a.app_key, g.grant_id, g.expires_at, "
                "g.read_scopes_json, g.write_scopes_json "
                "FROM capability_grants g JOIN app_registrations a "
                "ON a.registration_id = g.registration_id "
                "WHERE g.owner_user_id = ? AND g.agent_id = ? AND g.revoked_at IS NULL "
                "AND (g.expires_at IS NULL OR g.expires_at > ?) AND a.enabled = 1 "
                "ORDER BY a.app_key, a.registration_id",
                (owner_user_id, agent_id, ts),
            ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            try:
                read_scopes = json.loads(row["read_scopes_json"])
                write_scopes = json.loads(row["write_scopes_json"])
            except (TypeError, json.JSONDecodeError):
                read_scopes = []
                write_scopes = []
            result.append(
                {
                    "registration_id": str(row["registration_id"]),
                    "app_key": str(row["app_key"]),
                    "grant_id": str(row["grant_id"]),
                    "expires_at": row["expires_at"],
                    "read_scopes": sorted(
                        {scope for scope in read_scopes if isinstance(scope, str)}
                    )
                    if isinstance(read_scopes, list)
                    else [],
                    "write_scopes": sorted(
                        {scope for scope in write_scopes if isinstance(scope, str)}
                    )
                    if isinstance(write_scopes, list)
                    else [],
                }
            )
        return result

    def revoke_grant(self, *, owner_user_id: int, grant_id: str) -> bool:
        with self._db.connect() as conn:
            cursor = conn.execute(
                "UPDATE capability_grants SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? "
                "WHERE owner_user_id = ? AND grant_id = ?",
                (now_ts(), now_ts(), owner_user_id, grant_id),
            )
        return bool(cursor.rowcount == 1)

    def allows(
        self,
        *,
        owner_user_id: int,
        registration_id: str,
        agent_id: str,
        scope: str,
        write: bool,
        now: int | None = None,
    ) -> bool:
        ts = now if now is not None else now_ts()
        column = "write_scopes_json" if write else "read_scopes_json"
        with self._db.connect() as conn:
            row = conn.execute(
                f"SELECT g.{column} FROM capability_grants g "
                "JOIN app_registrations a ON a.registration_id = g.registration_id "
                "WHERE g.owner_user_id = ? AND g.registration_id = ? AND g.agent_id = ? "
                "AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > ?) "
                "AND a.enabled = 1",
                (owner_user_id, registration_id, agent_id, ts),
            ).fetchone()
        if row is None:
            return False
        try:
            scopes = json.loads(row[column])
        except (TypeError, json.JSONDecodeError):
            return False
        return isinstance(scopes, list) and scope in scopes

    @staticmethod
    def _registration(row: Any) -> dict[str, Any]:
        result = dict(row)
        result["enabled"] = bool(result["enabled"])
        return result

    @staticmethod
    def _grant(row: Any) -> dict[str, Any]:
        result = dict(row)
        result["read_scopes"] = json.loads(result.pop("read_scopes_json"))
        result["write_scopes"] = json.loads(result.pop("write_scopes_json"))
        return result
