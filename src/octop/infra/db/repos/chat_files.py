"""Persistence for conversation file identities and immutable revisions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts


@dataclass(frozen=True)
class ChatFileRow:
    file_id: str
    user_id: int
    agent_id: str
    thread_id: str | None
    display_name: str
    current_revision_id: str | None
    deleted_at: int | None
    created_at: int
    updated_at: int

    @classmethod
    def from_row(cls, row: DbRow) -> ChatFileRow:
        return cls(**{field: row[field] for field in cls.__dataclass_fields__})


@dataclass(frozen=True)
class ChatFileRevisionRow:
    revision_id: str
    file_id: str
    parent_revision_id: str | None
    workspace_path: str
    sha256: str
    media_type: str
    byte_size: int
    origin_kind: str
    read_status: str
    parse_version: int | None
    parse_lease_until: int | None
    coverage_json: str
    created_at: int

    @classmethod
    def from_row(cls, row: DbRow) -> ChatFileRevisionRow:
        return cls(**{field: row[field] for field in cls.__dataclass_fields__})


class ChatFileRevisionConflict(ValueError):
    """Raised when a file revision changed since the caller last read it."""


class ChatFileRepo:
    _MAX_REVISION_CHARS = 2_000_000
    _MAX_REVISION_SEGMENTS = 20_000
    _MAX_USER_CHARS = 100 * 1024 * 1024

    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def create_uploaded(
        self,
        *,
        file_id: str,
        revision_id: str,
        user_id: int,
        agent_id: str,
        display_name: str,
        workspace_path: str,
        sha256: str,
        media_type: str,
        byte_size: int,
        thread_id: str | None = None,
        origin_kind: str = "upload",
    ) -> ChatFileRow:
        now = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO chat_files(file_id, user_id, agent_id, thread_id, display_name, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (file_id, user_id, agent_id, thread_id, display_name, now, now),
            )
            conn.execute(
                "INSERT INTO chat_file_revisions(revision_id, file_id, workspace_path, sha256, "
                "media_type, byte_size, origin_kind, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    revision_id,
                    file_id,
                    workspace_path,
                    sha256,
                    media_type,
                    byte_size,
                    origin_kind,
                    now,
                ),
            )
            conn.execute(
                "UPDATE chat_files SET current_revision_id = ? WHERE file_id = ?",
                (revision_id, file_id),
            )
            row = conn.execute("SELECT * FROM chat_files WHERE file_id = ?", (file_id,)).fetchone()
        return ChatFileRow.from_row(row)

    def append_text_revision(
        self,
        *,
        file_id: str,
        revision_id: str,
        expected_revision_id: str,
        user_id: int,
        agent_id: str,
        thread_id: str,
        workspace_path: str,
        sha256: str,
        media_type: str,
        byte_size: int,
    ) -> ChatFileRow:
        now = now_ts()
        conflict = False
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO chat_file_revisions(revision_id, file_id, parent_revision_id, "
                "workspace_path, sha256, media_type, byte_size, origin_kind, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'generated', ?)",
                (
                    revision_id,
                    file_id,
                    expected_revision_id,
                    workspace_path,
                    sha256,
                    media_type,
                    byte_size,
                    now,
                ),
            )
            changed = conn.execute(
                "UPDATE chat_files SET current_revision_id = ?, updated_at = ? "
                "WHERE file_id = ? AND user_id = ? AND agent_id = ? AND thread_id = ? "
                "AND current_revision_id = ? AND deleted_at IS NULL",
                (
                    revision_id,
                    now,
                    file_id,
                    user_id,
                    agent_id,
                    thread_id,
                    expected_revision_id,
                ),
            ).rowcount
            conflict = int(changed or 0) != 1
            row = conn.execute("SELECT * FROM chat_files WHERE file_id = ?", (file_id,)).fetchone()
        if conflict:
            raise ChatFileRevisionConflict(revision_id)
        return ChatFileRow.from_row(row)

    def get(self, file_id: str) -> ChatFileRow | None:
        with self._db.connect() as conn:
            row = conn.execute("SELECT * FROM chat_files WHERE file_id = ?", (file_id,)).fetchone()
        return ChatFileRow.from_row(row) if row else None

    def delete_draft(self, file_id: str, *, user_id: int, agent_id: str) -> list[str] | None:
        """Soft-delete an owned unbound draft and return its stored revision paths."""
        deleted_at = now_ts()
        with self._db.transaction() as conn:
            eligible = conn.execute(
                "SELECT 1 FROM chat_files WHERE file_id = ? AND user_id = ? AND agent_id = ? "
                "AND thread_id IS NULL AND deleted_at IS NULL",
                (file_id, user_id, agent_id),
            ).fetchone()
            if eligible is None:
                return None
            paths = [
                str(row["workspace_path"])
                for row in conn.execute(
                    "SELECT workspace_path FROM chat_file_revisions WHERE file_id = ?",
                    (file_id,),
                ).fetchall()
            ]
            changed = conn.execute(
                "UPDATE chat_files SET deleted_at = ?, updated_at = ? "
                "WHERE file_id = ? AND user_id = ? AND agent_id = ? "
                "AND thread_id IS NULL AND deleted_at IS NULL",
                (deleted_at, deleted_at, file_id, user_id, agent_id),
            ).rowcount
        return paths if int(changed or 0) == 1 else None

    def get_revision(self, revision_id: str) -> ChatFileRevisionRow | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM chat_file_revisions WHERE revision_id = ?", (revision_id,)
            ).fetchone()
        return ChatFileRevisionRow.from_row(row) if row else None

    def get_owned_revision(
        self,
        *,
        file_id: str,
        revision_id: str,
        user_id: int,
        agent_id: str,
        thread_id: str,
    ) -> tuple[ChatFileRow, ChatFileRevisionRow] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT f.*, r.revision_id, r.parent_revision_id, r.workspace_path, r.sha256, "
                "r.media_type, r.byte_size, r.origin_kind, r.read_status, r.parse_version, "
                "r.parse_lease_until, r.coverage_json, r.created_at AS revision_created_at "
                "FROM chat_files f JOIN chat_file_revisions r ON r.file_id = f.file_id "
                "WHERE f.file_id = ? AND r.revision_id = ? AND f.user_id = ? "
                "AND f.agent_id = ? AND f.thread_id = ? AND f.deleted_at IS NULL",
                (file_id, revision_id, user_id, agent_id, thread_id),
            ).fetchone()
        if row is None:
            return None
        file_row = ChatFileRow.from_row(row)
        revision_data = dict(row)
        revision_data["created_at"] = revision_data.pop("revision_created_at")
        return file_row, ChatFileRevisionRow.from_row(revision_data)

    def append_segments(
        self,
        revision_id: str,
        segments: list[tuple[str, str]],
        *,
        parse_version: int,
        read_status: str,
        coverage_json: str,
        only_if_unparsed: bool = False,
        expected_parse_version: int | None = None,
    ) -> list[int] | None:
        """Store parsed segments, optionally replacing one known older parser result."""
        with self._db.transaction() as conn:
            revision = conn.execute(
                "SELECT file_id, parse_version FROM chat_file_revisions WHERE revision_id = ?",
                (revision_id,),
            ).fetchone()
            if revision is None:
                raise ValueError("revision does not exist")
            if only_if_unparsed:
                claimed = conn.execute(
                    "UPDATE chat_file_revisions SET parse_version = ?, read_status = ?, "
                    "parse_lease_until = NULL, "
                    "coverage_json = ? WHERE revision_id = ? AND parse_version IS NULL "
                    "AND read_status != 'failed'",
                    (parse_version, read_status, coverage_json, revision_id),
                ).rowcount
                if not claimed:
                    return None
            elif expected_parse_version is not None:
                if (
                    revision["parse_version"] is None
                    or int(revision["parse_version"]) != expected_parse_version
                    or parse_version <= expected_parse_version
                ):
                    return None
                changed = conn.execute(
                    "UPDATE chat_file_revisions SET parse_version = ?, read_status = ?, "
                    "parse_lease_until = NULL, "
                    "coverage_json = ? WHERE revision_id = ? AND parse_version = ? "
                    "AND read_status != 'failed'",
                    (
                        parse_version,
                        read_status,
                        coverage_json,
                        revision_id,
                        expected_parse_version,
                    ),
                ).rowcount
                if not changed:
                    return None
                conn.execute("DELETE FROM chat_file_segments WHERE revision_id = ?", (revision_id,))
            if (
                revision["parse_version"] is not None
                and not only_if_unparsed
                and expected_parse_version is None
                and int(revision["parse_version"]) != parse_version
            ):
                raise ValueError("parser version cannot change for an existing revision")
            owner = conn.execute(
                "SELECT user_id FROM chat_files WHERE file_id = ?", (revision["file_id"],)
            ).fetchone()
            counts = conn.execute(
                "SELECT COUNT(*) AS count, COALESCE(SUM(char_count), 0) AS chars "
                "FROM chat_file_segments WHERE revision_id = ?",
                (revision_id,),
            ).fetchone()
            incoming_chars = sum(len(text) for _, text in segments)
            if int(counts["count"]) + len(segments) > self._MAX_REVISION_SEGMENTS:
                raise ValueError("revision segment limit exceeded")
            if int(counts["chars"]) + incoming_chars > self._MAX_REVISION_CHARS:
                raise ValueError("revision character limit exceeded")
            user_chars = conn.execute(
                "SELECT COALESCE(SUM(s.char_count), 0) AS chars FROM chat_file_segments s "
                "JOIN chat_file_revisions r ON r.revision_id = s.revision_id "
                "JOIN chat_files f ON f.file_id = r.file_id WHERE f.user_id = ?",
                (owner["user_id"],),
            ).fetchone()["chars"]
            if int(user_chars) + incoming_chars > self._MAX_USER_CHARS:
                raise ValueError("user extracted text budget exceeded")
            first = int(
                conn.execute(
                    "SELECT COALESCE(MAX(ordinal), -1) + 1 FROM chat_file_segments "
                    "WHERE revision_id = ?",
                    (revision_id,),
                ).fetchone()[0]
            )
            for offset, (locator_json, text) in enumerate(segments):
                conn.execute(
                    "INSERT INTO chat_file_segments(revision_id, ordinal, locator_json, text, char_count) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (revision_id, first + offset, locator_json, text, len(text)),
                )
            if not only_if_unparsed:
                conn.execute(
                    "UPDATE chat_file_revisions SET parse_version = ?, read_status = ?, "
                    "parse_lease_until = NULL, coverage_json = ? "
                    "WHERE revision_id = ?",
                    (parse_version, read_status, coverage_json, revision_id),
                )
            return list(range(first, first + len(segments)))

    def invalidate_parse_result(
        self, revision_id: str, *, expected_parse_version: int | None
    ) -> bool:
        version_clause = (
            "parse_version IS NULL" if expected_parse_version is None else "parse_version = ?"
        )
        params: tuple[object, ...] = (revision_id,)
        if expected_parse_version is not None:
            params += (expected_parse_version,)
        with self._db.transaction() as conn:
            changed = conn.execute(
                "UPDATE chat_file_revisions SET parse_version = NULL, read_status = 'failed', "
                "parse_lease_until = NULL, coverage_json = '{}' "
                f"WHERE revision_id = ? AND {version_clause}",
                params,
            ).rowcount
            if int(changed or 0) == 1:
                conn.execute("DELETE FROM chat_file_segments WHERE revision_id = ?", (revision_id,))
        return int(changed or 0) == 1

    def set_parse_status(
        self,
        revision_id: str,
        *,
        status: str,
        expected_parse_version: int | None,
        lease_until: int | None = None,
    ) -> bool:
        version_clause = (
            "parse_version IS NULL" if expected_parse_version is None else "parse_version = ?"
        )
        params: tuple[object, ...] = (status, lease_until, revision_id)
        if expected_parse_version is not None:
            params += (expected_parse_version,)
        with self._db.transaction() as conn:
            changed = conn.execute(
                "UPDATE chat_file_revisions SET read_status = ?, parse_lease_until = ? "
                f"WHERE revision_id = ? AND {version_clause}",
                params,
            ).rowcount
        return int(changed or 0) == 1

    def list_segments(
        self, revision_id: str, *, limit: int = 200, offset: int = 0
    ) -> list[dict[str, object]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT ordinal, locator_json, text, char_count FROM chat_file_segments "
                "WHERE revision_id = ? ORDER BY ordinal LIMIT ? OFFSET ?",
                (revision_id, max(1, min(limit, self._MAX_REVISION_SEGMENTS)), max(0, offset)),
            ).fetchall()
        return [dict(row) for row in rows]

    def search_segments(
        self, revision_id: str, query: str, *, limit: int = 20
    ) -> list[dict[str, object]]:
        """Bounded case-insensitive substring search over one revision's segments."""
        needle = query.strip()
        if not needle:
            return []
        escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT ordinal, locator_json, text, char_count FROM chat_file_segments "
                "WHERE revision_id = ? AND lower(text) LIKE ? ESCAPE '\\' "
                "ORDER BY ordinal LIMIT ?",
                (revision_id, pattern.lower(), max(1, min(limit, 100))),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_owned_file(self, file_id: str, *, user_id: int, agent_id: str) -> ChatFileRow | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM chat_files WHERE file_id = ? AND user_id = ? AND agent_id = ? "
                "AND deleted_at IS NULL",
                (file_id, user_id, agent_id),
            ).fetchone()
        return ChatFileRow.from_row(row) if row else None

    def list_for_thread(
        self, *, user_id: int, agent_id: str, thread_id: str, limit: int = 50, offset: int = 0
    ) -> list[ChatFileRow]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM chat_files WHERE user_id = ? AND agent_id = ? AND thread_id = ? "
                "AND deleted_at IS NULL ORDER BY updated_at DESC, created_at DESC "
                "LIMIT ? OFFSET ?",
                (user_id, agent_id, thread_id, max(1, min(limit, 50)), max(0, offset)),
            ).fetchall()
        return [ChatFileRow.from_row(row) for row in rows]

    def list_revisions(
        self, file_id: str, *, limit: int = 50, offset: int = 0
    ) -> list[ChatFileRevisionRow]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM chat_file_revisions WHERE file_id = ? "
                "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (file_id, max(1, min(limit, 50)), max(0, offset)),
            ).fetchall()
        return [ChatFileRevisionRow.from_row(row) for row in rows]

    def has_registered_workspace_path(
        self, *, agent_id: str, workspace_path: str, include_descendants: bool = False
    ) -> bool:
        """Return whether a workspace path belongs to any registered file revision."""
        path = workspace_path.replace("\\", "/").strip("/")
        if not path:
            return False
        descendant_prefix = f"{path}/"
        descendant_clause = " OR substr(r.workspace_path, 1, ?) = ?" if include_descendants else ""
        params: tuple[object, ...] = (agent_id, path)
        if include_descendants:
            params += (len(descendant_prefix), descendant_prefix)
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM chat_file_revisions r "
                "JOIN chat_files f ON f.file_id = r.file_id "
                f"WHERE f.agent_id = ? AND f.deleted_at IS NULL "
                f"AND (r.workspace_path = ?{descendant_clause}) LIMIT 1",
                params,
            ).fetchone()
        return row is not None

    def list_workspace_path_revisions(
        self, *, agent_id: str, workspace_path: str
    ) -> list[dict[str, Any]]:
        """Find registered revisions behind a legacy workspace path, including deleted files."""
        path = workspace_path.replace("\\", "/").strip("/")
        if not path:
            return []
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT f.file_id, f.user_id, f.deleted_at, r.revision_id, "
                "r.sha256, r.media_type "
                "FROM chat_file_revisions r JOIN chat_files f ON f.file_id = r.file_id "
                "WHERE f.agent_id = ? AND r.workspace_path = ?",
                (agent_id, path),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_workspace_paths_hidden_from_user(self, *, agent_id: str, user_id: int) -> list[str]:
        """List registered paths the caller cannot see, including soft-deleted files."""
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT DISTINCT r.workspace_path FROM chat_file_revisions r "
                "JOIN chat_files f ON f.file_id = r.file_id "
                "WHERE f.agent_id = ? AND (f.user_id != ? OR f.deleted_at IS NOT NULL)",
                (agent_id, user_id),
            ).fetchall()
        return [str(row["workspace_path"]) for row in rows]

    def list_registered_workspace_paths(self, *, agent_id: str) -> list[str]:
        """List all immutable revision paths for an agent, including deleted files."""
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT r.workspace_path FROM chat_file_revisions r "
                "JOIN chat_files f ON f.file_id = r.file_id WHERE f.agent_id = ?",
                (agent_id,),
            ).fetchall()
        return [str(row["workspace_path"]) for row in rows]

    def bind_thread(
        self,
        file_id: str,
        *,
        user_id: int,
        agent_id: str,
        thread_id: str,
        revision_id: str,
        workspace_path: str,
    ) -> bool:
        """Bind a draft to one thread; retries to that same thread are idempotent."""
        with self._db.transaction() as conn:
            changed = conn.execute(
                "UPDATE chat_files SET thread_id = ?, updated_at = ? "
                "WHERE file_id = ? AND user_id = ? AND agent_id = ? AND thread_id IS NULL "
                "AND current_revision_id = ? AND deleted_at IS NULL AND EXISTS ("
                "SELECT 1 FROM chat_file_revisions r WHERE r.revision_id = ? "
                "AND r.file_id = chat_files.file_id AND r.workspace_path = ?)",
                (
                    thread_id,
                    now_ts(),
                    file_id,
                    user_id,
                    agent_id,
                    revision_id,
                    revision_id,
                    workspace_path,
                ),
            ).rowcount
            if changed:
                return True
            row = conn.execute(
                "SELECT 1 FROM chat_files WHERE file_id = ? AND user_id = ? AND agent_id = ? "
                "AND thread_id = ? AND current_revision_id = ? AND deleted_at IS NULL "
                "AND EXISTS (SELECT 1 FROM chat_file_revisions r "
                "WHERE r.revision_id = ? AND r.file_id = chat_files.file_id "
                "AND r.workspace_path = ?)",
                (file_id, user_id, agent_id, thread_id, revision_id, revision_id, workspace_path),
            ).fetchone()
            return row is not None
