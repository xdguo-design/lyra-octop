from __future__ import annotations

import asyncio
import hashlib
import threading
from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.chat_files import ChatFileRepo
from octop.infra.db.repos.threads import ThreadRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.files.service import FileService


class _Workspace:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def download_bytes(self, path: str) -> bytes:
        assert path == "inbound/report.txt"
        return self.data


def _file_repo(tmp_path: Path, data: bytes) -> ChatFileRepo:
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
        display_name="report.txt",
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
