"""Conversation file reads: ownership, integrity, isolated parsing, and persistence."""

from __future__ import annotations

import asyncio
import hashlib
import json
import tempfile
import threading
from dataclasses import asdict
from functools import partial
from pathlib import Path
from typing import Any, cast

from octop.infra.db.repos._base import now_ts
from octop.infra.db.repos.chat_files import ChatFileRepo
from octop.infra.files.parse import (
    DEFAULT_PARSE_LIMITS,
    PARSER_VERSION,
    UnsupportedFileTypeError,
)
from octop.infra.files.worker import parse_file_in_worker

_READ_SLOTS = threading.BoundedSemaphore(2)
_PARSE_LEASE_SECONDS = 60


def _source_spans(revision: Any, segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for segment in segments:
        try:
            locator = json.loads(str(segment.get("locator_json") or "{}"))
        except json.JSONDecodeError:
            locator = {}
        result.append(
            {
                **segment,
                "source_span": {
                    "file_id": revision.file_id,
                    "revision_id": revision.revision_id,
                    "parser_version": revision.parse_version,
                    "content_hash": revision.sha256,
                    "ordinal": int(segment["ordinal"]),
                    "locator": locator,
                },
            }
        )
    return result


class FileReadBusy(RuntimeError):
    """All bounded parser slots are in use."""


class FileIntegrityError(ValueError):
    """Stored bytes no longer match the immutable revision digest."""


class FileTooLargeError(ValueError):
    """File exceeds the automatic read budget."""


class FileService:
    def __init__(self, repo: ChatFileRepo) -> None:
        self._repo = repo

    async def read_owned_revision_bytes(
        self,
        *,
        workspace: Any,
        file_id: str,
        revision_id: str,
        user_id: int,
        agent_id: str,
        thread_id: str | None = None,
    ) -> tuple[Any, Any, bytes]:
        if thread_id is None:
            file_row = self._repo.get_owned_file(file_id, user_id=user_id, agent_id=agent_id)
            revision = self._repo.get_revision(revision_id)
            owned = (
                (file_row, revision)
                if file_row is not None and revision is not None and revision.file_id == file_id
                else None
            )
        else:
            owned = self._repo.get_owned_revision(
                file_id=file_id,
                revision_id=revision_id,
                user_id=user_id,
                agent_id=agent_id,
                thread_id=thread_id,
            )
        if owned is None:
            raise PermissionError("file revision is not available")
        file_row, revision = owned
        return file_row, revision, await self._read_revision_bytes(workspace, revision)

    async def read_registered_path_bytes(
        self, *, workspace: Any, agent_id: str, user_id: int, workspace_path: str
    ) -> tuple[bytes, str] | None:
        rows = self._repo.list_workspace_path_revisions(
            agent_id=agent_id, workspace_path=workspace_path
        )
        if not rows:
            return None
        if len(rows) != 1 or rows[0]["deleted_at"] is not None:
            raise PermissionError("registered file path is not available")
        row = rows[0]
        if int(row["user_id"]) != user_id:
            raise PermissionError("registered file path is not available")
        revision = self._repo.get_revision(str(row["revision_id"]))
        if revision is None or revision.file_id != str(row["file_id"]):
            raise PermissionError("registered file revision is not available")
        return await self._read_revision_bytes(workspace, revision), revision.media_type

    @staticmethod
    async def _read_revision_bytes(workspace: Any, revision: Any) -> bytes:
        data = cast(bytes | None, await workspace.adownload_bytes(revision.workspace_path))
        if data is None:
            raise FileNotFoundError("stored file content is unavailable")
        FileService._verify_revision_bytes(revision, data)
        return data

    @staticmethod
    def _verify_revision_bytes(revision: Any, data: bytes) -> None:
        if len(data) != revision.byte_size or hashlib.sha256(data).hexdigest() != revision.sha256:
            raise FileIntegrityError("file integrity check failed")

    async def read(
        self,
        *,
        workspace: Any,
        file_id: str,
        revision_id: str,
        user_id: int,
        agent_id: str,
        thread_id: str,
    ) -> dict[str, Any]:
        if not _READ_SLOTS.acquire(blocking=False):
            raise FileReadBusy("file parser capacity is full")
        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(
            None,
            partial(
                self._read_sync,
                workspace=workspace,
                file_id=file_id,
                revision_id=revision_id,
                user_id=user_id,
                agent_id=agent_id,
                thread_id=thread_id,
            ),
        )
        future.add_done_callback(lambda _: _READ_SLOTS.release())
        return await asyncio.shield(future)

    def _read_sync(
        self,
        *,
        workspace: Any,
        file_id: str,
        revision_id: str,
        user_id: int,
        agent_id: str,
        thread_id: str,
    ) -> dict[str, Any]:
        owned = self._repo.get_owned_revision(
            file_id=file_id,
            revision_id=revision_id,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
        )
        if owned is None:
            raise PermissionError("file is not available in this thread")
        file_row, revision = owned
        data = workspace.download_bytes(revision.workspace_path)
        if data is None:
            raise FileNotFoundError("stored file content is unavailable")
        try:
            self._verify_revision_bytes(revision, data)
        except FileIntegrityError:
            self._repo.invalidate_parse_result(
                revision_id, expected_parse_version=revision.parse_version
            )
            raise
        if revision.parse_version is not None and revision.parse_version >= PARSER_VERSION:
            return self._stored_result(revision_id)
        if len(data) > DEFAULT_PARSE_LIMITS.max_input_bytes:
            self._repo.set_parse_status(
                revision_id,
                status="failed",
                expected_parse_version=revision.parse_version,
            )
            raise FileTooLargeError("file exceeds the automatic read size limit")

        suffix = Path(file_row.display_name).suffix.lower()
        self._repo.set_parse_status(
            revision_id,
            status="processing",
            expected_parse_version=revision.parse_version,
            lease_until=now_ts() + _PARSE_LEASE_SECONDS,
        )
        with tempfile.TemporaryDirectory(prefix="octop-file-read-") as directory:
            path = Path(directory) / ("input" + suffix)
            path.write_bytes(data)
            try:
                result = parse_file_in_worker(path)
            except UnsupportedFileTypeError:
                self._repo.set_parse_status(
                    revision_id,
                    status="unsupported",
                    expected_parse_version=revision.parse_version,
                )
                raise
            except Exception:
                self._repo.set_parse_status(
                    revision_id,
                    status="failed",
                    expected_parse_version=revision.parse_version,
                )
                raise

        coverage = asdict(result.coverage)
        status = (
            "needs_ocr"
            if result.coverage.ocr_needed_units
            else "partial"
            if result.coverage.truncated
            else "ready"
        )
        locator_segments = [
            (
                json.dumps(segment.locator, ensure_ascii=True, separators=(",", ":")),
                segment.text,
            )
            for segment in result.segments
        ]
        saved = self._repo.append_segments(
            revision_id,
            locator_segments,
            parse_version=result.coverage.parser_version,
            read_status=status,
            coverage_json=json.dumps(coverage, separators=(",", ":")),
            only_if_unparsed=revision.parse_version is None,
            expected_parse_version=revision.parse_version,
        )
        if saved is None:
            return self._stored_result(revision_id)
        return {
            "file_id": file_id,
            "revision_id": revision_id,
            "read_status": status,
            "coverage": coverage,
            "segments": _source_spans(
                self._repo.get_revision(revision_id),
                self._repo.list_segments(revision_id, limit=2_000),
            ),
        }

    def _stored_result(self, revision_id: str) -> dict[str, Any]:
        revision = self._repo.get_revision(revision_id)
        if revision is None:
            raise FileNotFoundError("file revision is unavailable")
        return {
            "file_id": revision.file_id,
            "revision_id": revision_id,
            "read_status": self._read_status(revision),
            "coverage": json.loads(revision.coverage_json),
            "segments": _source_spans(revision, self._repo.list_segments(revision_id, limit=2_000)),
        }

    @staticmethod
    def _read_status(revision: Any) -> str:
        if (
            revision.read_status == "processing"
            and revision.parse_lease_until is not None
            and revision.parse_lease_until <= now_ts()
        ):
            return "stored"
        return str(revision.read_status)

    # ---- Read-side queries (DB only; no workspace or worker needed) ----

    def _summary(self, file_row: Any, revision: Any) -> dict[str, Any]:
        return {
            "file_id": file_row.file_id,
            "display_name": file_row.display_name,
            "media_type": revision.media_type if revision else "",
            "byte_size": revision.byte_size if revision else 0,
            "read_status": self._read_status(revision) if revision else "stored",
            "current_revision_id": file_row.current_revision_id,
            "origin_kind": revision.origin_kind if revision else None,
            "created_at": file_row.created_at,
            "updated_at": file_row.updated_at,
        }

    def _resolve_revision(self, file_row: Any, revision_id: str | None) -> Any:
        if revision_id is None:
            if file_row.current_revision_id is None:
                raise FileNotFoundError("file has no revision yet")
            revision = self._repo.get_revision(file_row.current_revision_id)
        else:
            revision = self._repo.get_revision(revision_id)
        if revision is None or revision.file_id != file_row.file_id:
            raise FileNotFoundError("file revision is unavailable")
        return revision

    def _owned_bound_file(self, *, file_id: str, user_id: int, agent_id: str) -> Any:
        row = self._repo.get_owned_file(file_id, user_id=user_id, agent_id=agent_id)
        if row is None or row.thread_id is None:
            raise PermissionError("file is not available in this thread")
        return row

    def list_thread_files(
        self, *, user_id: int, agent_id: str, thread_id: str
    ) -> list[dict[str, Any]]:
        files = self._repo.list_for_thread(user_id=user_id, agent_id=agent_id, thread_id=thread_id)
        summaries: list[dict[str, Any]] = []
        for file_row in files:
            revision = (
                self._repo.get_revision(file_row.current_revision_id)
                if file_row.current_revision_id
                else None
            )
            summaries.append(self._summary(file_row, revision))
        return summaries

    def get_file(self, *, file_id: str, user_id: int, agent_id: str) -> dict[str, Any]:
        row = self._repo.get_owned_file(file_id, user_id=user_id, agent_id=agent_id)
        if row is None:
            raise PermissionError("file is not available")
        current = (
            self._repo.get_revision(row.current_revision_id) if row.current_revision_id else None
        )
        revisions = [
            {
                "revision_id": item.revision_id,
                "parent_revision_id": item.parent_revision_id,
                "origin_kind": item.origin_kind,
                "read_status": self._read_status(item),
                "byte_size": item.byte_size,
                "created_at": item.created_at,
            }
            for item in self._repo.list_revisions(file_id, limit=20)
        ]
        return {
            **self._summary(row, current),
            "coverage": json.loads(current.coverage_json) if current else {},
            "revisions": revisions,
        }

    def get_segments(
        self,
        *,
        file_id: str,
        revision_id: str | None,
        user_id: int,
        agent_id: str,
        limit: int,
        offset: int,
    ) -> dict[str, Any]:
        row = self._owned_bound_file(file_id=file_id, user_id=user_id, agent_id=agent_id)
        revision = self._resolve_revision(row, revision_id)
        # Fetch one extra row to know whether another page exists.
        fetched = self._repo.list_segments(revision.revision_id, limit=limit + 1, offset=offset)
        has_more = len(fetched) > limit
        return {
            "file_id": file_id,
            "revision_id": revision.revision_id,
            "read_status": self._read_status(revision),
            "segments": _source_spans(revision, fetched[:limit]),
            "next_offset": offset + limit if has_more else None,
        }

    def search(
        self,
        *,
        file_id: str,
        revision_id: str | None,
        query: str,
        limit: int,
        user_id: int,
        agent_id: str,
    ) -> dict[str, Any]:
        row = self._owned_bound_file(file_id=file_id, user_id=user_id, agent_id=agent_id)
        revision = self._resolve_revision(row, revision_id)
        matches = self._repo.search_segments(revision.revision_id, query, limit=limit)
        return {
            "file_id": file_id,
            "revision_id": revision.revision_id,
            "query": query.strip()[:500],
            "matches": _source_spans(revision, matches),
        }
