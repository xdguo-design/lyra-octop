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
from typing import Any

from octop.infra.db.repos.chat_files import ChatFileRepo
from octop.infra.files.parse import DEFAULT_PARSE_LIMITS
from octop.infra.files.worker import parse_file_in_worker

_READ_SLOTS = threading.BoundedSemaphore(2)


class FileReadBusy(RuntimeError):
    """All bounded parser slots are in use."""


class FileIntegrityError(ValueError):
    """Stored bytes no longer match the immutable revision digest."""


class FileTooLargeError(ValueError):
    """File exceeds the automatic read budget."""


class FileService:
    def __init__(self, repo: ChatFileRepo) -> None:
        self._repo = repo

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
        if revision.parse_version is not None:
            return self._stored_result(revision_id)

        data = workspace.download_bytes(revision.workspace_path)
        if data is None:
            raise FileNotFoundError("stored file content is unavailable")
        if len(data) != revision.byte_size or hashlib.sha256(data).hexdigest() != revision.sha256:
            raise FileIntegrityError("file integrity check failed")
        if len(data) > DEFAULT_PARSE_LIMITS.max_input_bytes:
            raise FileTooLargeError("file exceeds the automatic read size limit")

        suffix = Path(file_row.display_name).suffix.lower()
        with tempfile.TemporaryDirectory(prefix="octop-file-read-") as directory:
            path = Path(directory) / ("input" + suffix)
            path.write_bytes(data)
            result = parse_file_in_worker(path)

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
            only_if_unparsed=True,
        )
        if saved is None:
            return self._stored_result(revision_id)
        return {
            "file_id": file_id,
            "revision_id": revision_id,
            "read_status": status,
            "coverage": coverage,
            "segments": self._repo.list_segments(revision_id, limit=2_000),
        }

    def _stored_result(self, revision_id: str) -> dict[str, Any]:
        revision = self._repo.get_revision(revision_id)
        if revision is None:
            raise FileNotFoundError("file revision is unavailable")
        return {
            "file_id": revision.file_id,
            "revision_id": revision_id,
            "read_status": revision.read_status,
            "coverage": json.loads(revision.coverage_json),
            "segments": self._repo.list_segments(revision_id, limit=2_000),
        }
