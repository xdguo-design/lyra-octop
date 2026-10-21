"""Unit tests for the conversation file read surface (repo + service)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.chat_files import ChatFileRepo
from octop.infra.db.repos.threads import ThreadRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.files.service import FileService


def _db(tmp_path: Path) -> tuple[SqlitePool, int]:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    user_id = UserRepo(db).create(username="owner", password_hash="hash", role="user")
    return db, user_id


def _seed_file(
    repo: ChatFileRepo,
    *,
    file_id: str,
    revision_id: str,
    user_id: int,
    agent_id: str = "agent",
    display_name: str = "note.txt",
    thread_id: str | None = "thread",
) -> None:
    repo.create_uploaded(
        file_id=file_id,
        revision_id=revision_id,
        user_id=user_id,
        agent_id=agent_id,
        display_name=display_name,
        workspace_path=f"inbound/{file_id}.txt",
        sha256=hashlib.sha256(b"x").hexdigest(),
        media_type="text/plain",
        byte_size=1,
    )
    if thread_id is not None:
        repo.bind_thread(
            file_id,
            user_id=user_id,
            agent_id=agent_id,
            thread_id=thread_id,
            revision_id=revision_id,
            workspace_path=f"inbound/{file_id}.txt",
        )


def test_search_segments_is_case_insensitive_and_escapes_wildcards(tmp_path: Path) -> None:
    db, user_id = _db(tmp_path)
    AgentRepo(db).create(agent_id="agent", user_id=user_id, name="Agent")
    ThreadRepo(db).insert(
        thread_id="thread",
        agent_id="agent",
        user_id=user_id,
        channel_type="dashboard",
        session_key="thread",
    )
    repo = ChatFileRepo(db)
    _seed_file(repo, file_id="f1", revision_id="r1", user_id=user_id)
    repo.append_segments(
        "r1",
        [('{"kind":"text_line"}', "Alpha BETA line"), ('{"kind":"text_line"}', "plain")],
        parse_version=1,
        read_status="ready",
        coverage_json="{}",
    )

    matches = repo.search_segments("r1", "beta")
    assert [item["ordinal"] for item in matches] == [0]

    wildcard = repo.search_segments("r1", "%")
    assert wildcard == []

    assert repo.search_segments("r1", "   ") == []


def test_list_for_thread_orders_newest_first_and_skips_deleted(tmp_path: Path) -> None:
    db, user_id = _db(tmp_path)
    AgentRepo(db).create(agent_id="agent", user_id=user_id, name="Agent")
    ThreadRepo(db).insert(
        thread_id="thread",
        agent_id="agent",
        user_id=user_id,
        channel_type="dashboard",
        session_key="thread",
    )
    repo = ChatFileRepo(db)
    _seed_file(repo, file_id="old", revision_id="r-old", user_id=user_id)
    _seed_file(repo, file_id="new", revision_id="r-new", user_id=user_id)
    _seed_file(repo, file_id="draft", revision_id="r-draft", user_id=user_id, thread_id=None)
    with db.transaction() as conn:
        conn.execute("UPDATE chat_files SET deleted_at = 1 WHERE file_id = 'old'")

    rows = repo.list_for_thread(user_id=user_id, agent_id="agent", thread_id="thread")
    assert [row.file_id for row in rows] == ["new"]

    other = repo.list_for_thread(user_id=user_id, agent_id="agent", thread_id="another-thread")
    assert other == []


def test_get_owned_file_rejects_other_agent_and_deleted(tmp_path: Path) -> None:
    db, user_id = _db(tmp_path)
    AgentRepo(db).create(agent_id="agent", user_id=user_id, name="Agent")
    ThreadRepo(db).insert(
        thread_id="thread",
        agent_id="agent",
        user_id=user_id,
        channel_type="dashboard",
        session_key="thread",
    )
    repo = ChatFileRepo(db)
    _seed_file(repo, file_id="f1", revision_id="r1", user_id=user_id)

    assert repo.get_owned_file("f1", user_id=user_id, agent_id="agent") is not None
    assert repo.get_owned_file("f1", user_id=user_id, agent_id="other") is None
    assert repo.get_owned_file("f1", user_id=user_id + 99, agent_id="agent") is None
    with db.transaction() as conn:
        conn.execute("UPDATE chat_files SET deleted_at = 1 WHERE file_id = 'f1'")
    assert repo.get_owned_file("f1", user_id=user_id, agent_id="agent") is None


def test_service_rejects_revision_from_another_file(tmp_path: Path) -> None:
    db, user_id = _db(tmp_path)
    AgentRepo(db).create(agent_id="agent", user_id=user_id, name="Agent")
    ThreadRepo(db).insert(
        thread_id="thread",
        agent_id="agent",
        user_id=user_id,
        channel_type="dashboard",
        session_key="thread",
    )
    repo = ChatFileRepo(db)
    _seed_file(repo, file_id="f1", revision_id="r1", user_id=user_id)
    _seed_file(repo, file_id="f2", revision_id="r2", user_id=user_id)
    service = FileService(repo)

    with pytest.raises(FileNotFoundError):
        service.get_segments(
            file_id="f1",
            revision_id="r2",
            user_id=user_id,
            agent_id="agent",
            limit=10,
            offset=0,
        )


def test_service_search_rejects_unbound_draft(tmp_path: Path) -> None:
    db, user_id = _db(tmp_path)
    AgentRepo(db).create(agent_id="agent", user_id=user_id, name="Agent")
    repo = ChatFileRepo(db)
    _seed_file(repo, file_id="f1", revision_id="r1", user_id=user_id, thread_id=None)
    service = FileService(repo)

    with pytest.raises(PermissionError):
        service.search(
            file_id="f1",
            revision_id=None,
            query="anything",
            limit=10,
            user_id=user_id,
            agent_id="agent",
        )

    detail = service.get_file(file_id="f1", user_id=user_id, agent_id="agent")
    assert detail["file_id"] == "f1"
    assert detail["revisions"][0]["revision_id"] == "r1"
