"""Immutable, content-addressed snapshots of Agent configuration."""

from __future__ import annotations

from dataclasses import dataclass

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts
from octop.infra.utils.ulid import new_ulid


@dataclass(frozen=True)
class AgentVersionRow:
    version_id: str
    agent_id: str
    created_by: int | None
    schema_version: int
    content_hash: str
    snapshot_blob: bytes
    created_at: int

    @classmethod
    def from_row(cls, row: DbRow) -> AgentVersionRow:
        return cls(
            version_id=str(row["version_id"]),
            agent_id=str(row["agent_id"]),
            created_by=int(row["created_by"]) if row["created_by"] is not None else None,
            schema_version=int(row["schema_version"]),
            content_hash=str(row["content_hash"]),
            snapshot_blob=bytes(row["snapshot_blob"]),
            created_at=int(row["created_at"]),
        )


class AgentVersionRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def capture(
        self,
        *,
        agent_id: str,
        created_by: int,
        schema_version: int,
        content_hash: str,
        snapshot_blob: bytes,
    ) -> AgentVersionRow:
        ts = now_ts()
        version_id = new_ulid()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO agent_versions(version_id, agent_id, created_by, schema_version, "
                "content_hash, snapshot_blob, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(agent_id, content_hash) DO NOTHING",
                (version_id, agent_id, created_by, schema_version, content_hash, snapshot_blob, ts),
            )
            row = conn.execute(
                "SELECT * FROM agent_versions WHERE agent_id = ? AND content_hash = ?",
                (agent_id, content_hash),
            ).fetchone()
            if row is None:
                raise RuntimeError("AgentVersion capture did not return a row")
            captured = AgentVersionRow.from_row(row)
            conn.execute(
                "INSERT INTO agent_version_aliases(agent_id, alias, version_id, updated_at) "
                "VALUES (?, 'current', ?, ?) ON CONFLICT(agent_id, alias) DO UPDATE SET "
                "version_id = excluded.version_id, updated_at = excluded.updated_at",
                (agent_id, captured.version_id, ts),
            )
        return captured

    def get(self, version_id: str, *, agent_id: str) -> AgentVersionRow | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM agent_versions WHERE version_id = ? AND agent_id = ?",
                (version_id, agent_id),
            ).fetchone()
        return AgentVersionRow.from_row(row) if row is not None else None

    def get_alias(self, agent_id: str, alias: str = "current") -> AgentVersionRow | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT v.* FROM agent_version_aliases a JOIN agent_versions v "
                "ON v.version_id = a.version_id WHERE a.agent_id = ? AND a.alias = ?",
                (agent_id, alias),
            ).fetchone()
        return AgentVersionRow.from_row(row) if row is not None else None
