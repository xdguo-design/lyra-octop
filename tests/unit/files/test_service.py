from __future__ import annotations

import asyncio
import hashlib
import threading
from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos._base import now_ts
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.chat_files import ChatFileRepo
from octop.infra.db.repos.threads import ThreadRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.files.parse import FileParseError, UnsupportedFileTypeError
from octop.infra.files.service import FileIntegrityError, FileService
from octop.infra.files.worker import FileWorkerError


class _Workspace:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def download_bytes(self, path: str) -> bytes:
        assert path == "inbound/report.txt"
        return self.data

    async def adownload_bytes(self, path: str) -> bytes:
        return self.download_bytes(path)


def _file_repo(tmp_path: Path, data: bytes, *, display_name: str = "report.txt") -> ChatFileRepo:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    user_id = UserRepo(db).create(username="owner", password_hash="hash", role="user")
    AgentRepo(db).create(agent_id="agent", user_id=user_id, name="Agent")
    ThreadRepo(db).insert(
        thread_id="thread",
        agent_id="agent",
        user_id=user_id,
        channel_type="dashboard",
        session_key="thread",
    )
    repo = ChatFileRepo(db)
    repo.create_uploaded(
        file_id="file-1",
        revision_id="rev-1",
        user_id=user_id,
        agent_id="agent",
        display_name=display_name,
        workspace_path="inbound/report.txt",
        sha256=hashlib.sha256(data).hexdigest(),
        media_type="text/plain",
        byte_size=len(data),
    )
    repo.bind_thread(
        "file-1",
        user_id=user_id,
        agent_id="agent",
        thread_id="thread",
        revision_id="rev-1",
        workspace_path="inbound/report.txt",
    )
    return repo


@pytest.mark.asyncio
async def test_file_read_persists_real_text_and_source_locations(tmp_path: Path) -> None:
    data = b"alpha\n\nbeta\n"
    repo = _file_repo(tmp_path, data)

    result = await FileService(repo).read(
        workspace=_Workspace(data),
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        thread_id="thread",
    )

    assert [item["text"] for item in result["segments"]] == ["alpha", "beta"]
    assert result["segments"][1]["locator_json"] == '{"kind":"text_line","start":3,"end":3}'
    assert result["coverage"]["complete"] is True
    assert repo.get_revision("rev-1").read_status == "ready"


@pytest.mark.asyncio
async def test_file_read_rejects_workspace_content_changed_after_upload(tmp_path: Path) -> None:
    repo = _file_repo(tmp_path, b"original")

    with pytest.raises(ValueError, match="integrity"):
        await FileService(repo).read(
            workspace=_Workspace(b"changed"),
            file_id="file-1",
            revision_id="rev-1",
            user_id=1,
            agent_id="agent",
            thread_id="thread",
        )
    assert repo.get_revision("rev-1").read_status == "failed"
    assert repo.get_revision("rev-1").parse_version is None
    assert repo.list_segments("rev-1", limit=10) == []


@pytest.mark.asyncio
async def test_revision_downloads_share_owner_and_integrity_checks(tmp_path: Path) -> None:
    data = b"original"
    repo = _file_repo(tmp_path, data)
    service = FileService(repo)

    file_row, revision, actual = await service.read_owned_revision_bytes(
        workspace=_Workspace(data),
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
    )
    assert (file_row.file_id, revision.revision_id, actual) == ("file-1", "rev-1", data)
    assert await service.read_registered_path_bytes(
        workspace=_Workspace(data),
        agent_id="agent",
        user_id=1,
        workspace_path="inbound/report.txt",
    ) == (data, "text/plain")

    with pytest.raises(PermissionError):
        await service.read_owned_revision_bytes(
            workspace=_Workspace(data),
            file_id="file-1",
            revision_id="rev-1",
            user_id=2,
            agent_id="agent",
        )
    with pytest.raises(PermissionError):
        await service.read_registered_path_bytes(
            workspace=_Workspace(data),
            agent_id="agent",
            user_id=2,
            workspace_path="inbound/report.txt",
        )
    with pytest.raises(FileIntegrityError):
        await service.read_owned_revision_bytes(
            workspace=_Workspace(b"changed"),
            file_id="file-1",
            revision_id="rev-1",
            user_id=1,
            agent_id="agent",
        )


@pytest.mark.asyncio
async def test_unsupported_file_type_is_recorded_as_unsupported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from octop.infra.files import service as file_service

    data = b"not a parser-supported format"
    repo = _file_repo(tmp_path, data, display_name="report.bin")
    monkeypatch.setattr(
        file_service,
        "parse_file_in_worker",
        lambda _path: (_ for _ in ()).throw(UnsupportedFileTypeError("unsupported")),
    )

    with pytest.raises(UnsupportedFileTypeError):
        await FileService(repo).read(
            workspace=_Workspace(data),
            file_id="file-1",
            revision_id="rev-1",
            user_id=1,
            agent_id="agent",
            thread_id="thread",
        )

    revision = repo.get_revision("rev-1")
    assert revision.read_status == "unsupported"
    assert revision.parse_lease_until is None


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [FileParseError("invalid"), FileWorkerError("failed")])
async def test_parse_failures_are_recorded_as_failed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
) -> None:
    from octop.infra.files import service as file_service

    data = b"malformed"
    repo = _file_repo(tmp_path, data)
    monkeypatch.setattr(
        file_service,
        "parse_file_in_worker",
        lambda _path: (_ for _ in ()).throw(failure),
    )

    with pytest.raises(type(failure)):
        await FileService(repo).read(
            workspace=_Workspace(data),
            file_id="file-1",
            revision_id="rev-1",
            user_id=1,
            agent_id="agent",
            thread_id="thread",
        )

    revision = repo.get_revision("rev-1")
    assert revision.read_status == "failed"
    assert revision.parse_lease_until is None


def test_expired_parse_lease_is_reported_as_not_yet_read(tmp_path: Path) -> None:
    data = b"not parsed yet"
    repo = _file_repo(tmp_path, data)
    assert repo.set_parse_status(
        "rev-1",
        status="processing",
        expected_parse_version=None,
        lease_until=now_ts() - 1,
    )

    result = FileService(repo).get_file(file_id="file-1", user_id=1, agent_id="agent")

    assert result["read_status"] == "stored"
    assert repo.get_revision("rev-1").read_status == "processing"


@pytest.mark.asyncio
async def test_file_read_returns_every_parsed_segment(tmp_path: Path) -> None:
    data = "\n".join(f"line {number}" for number in range(1, 251)).encode()
    repo = _file_repo(tmp_path, data)

    result = await FileService(repo).read(
        workspace=_Workspace(data),
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        thread_id="thread",
    )
    restored = await FileService(repo).read(
        workspace=_Workspace(data),
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        thread_id="thread",
    )

    assert len(result["segments"]) == 250
    assert result["segments"][-1]["locator_json"] == '{"kind":"text_line","start":250,"end":250}'
    assert result["coverage"]["complete"] is True
    assert restored == result


@pytest.mark.asyncio
async def test_cached_file_read_rechecks_source_integrity(tmp_path: Path) -> None:
    original = b"original content"
    repo = _file_repo(tmp_path, original)
    service = FileService(repo)
    kwargs = {
        "file_id": "file-1",
        "revision_id": "rev-1",
        "user_id": 1,
        "agent_id": "agent",
        "thread_id": "thread",
    }

    await service.read(workspace=_Workspace(original), **kwargs)

    with pytest.raises(ValueError, match="integrity"):
        await service.read(workspace=_Workspace(b"changed after parse"), **kwargs)
    assert repo.list_segments("rev-1", limit=10) == []


@pytest.mark.asyncio
async def test_old_parser_segments_are_replaced_once_on_read(tmp_path: Path) -> None:
    data = b"alpha\nbeta"
    repo = _file_repo(tmp_path, data)
    repo.append_segments(
        "rev-1",
        [('{"kind":"legacy_line","line":1}', "stale")],
        parse_version=1,
        read_status="ready",
        coverage_json="{}",
    )
    service = FileService(repo)
    kwargs = {
        "file_id": "file-1",
        "revision_id": "rev-1",
        "user_id": 1,
        "agent_id": "agent",
        "thread_id": "thread",
    }

    current = await service.read(workspace=_Workspace(data), **kwargs)
    assert [item["text"] for item in current["segments"]] == ["alpha", "beta"]
    assert current["segments"][0]["locator_json"] == '{"kind":"text_line","start":1,"end":1}'
    assert repo.get_revision("rev-1").parse_version == 2

    replaced_again = repo.append_segments(
        "rev-1",
        [("{}", "must not overwrite")],
        parse_version=3,
        read_status="ready",
        coverage_json="{}",
        expected_parse_version=1,
    )
    assert replaced_again is None
    assert [item["text"] for item in repo.list_segments("rev-1", limit=10)] == ["alpha", "beta"]


@pytest.mark.asyncio
async def test_concurrent_reads_commit_one_copy_of_each_segment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from octop.infra.files import service as file_service

    data = b"alpha\nbeta\ngamma"
    repo = _file_repo(tmp_path, data)
    barrier = threading.Barrier(2)
    original_parser = file_service.parse_file_in_worker

    def synchronized_parser(path: Path):
        barrier.wait(timeout=10)
        return original_parser(path)

    monkeypatch.setattr(file_service, "parse_file_in_worker", synchronized_parser)
    service = FileService(repo)

    results = await asyncio.gather(
        *(
            service.read(
                workspace=_Workspace(data),
                file_id="file-1",
                revision_id="rev-1",
                user_id=1,
                agent_id="agent",
                thread_id="thread",
            )
            for _ in range(2)
        )
    )

    assert results[0] == results[1]
    assert [row["text"] for row in repo.list_segments("rev-1", limit=500)] == [
        "alpha",
        "beta",
        "gamma",
    ]
