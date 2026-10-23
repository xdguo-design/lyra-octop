from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.chat_files import ChatFileRepo
from octop.infra.db.repos.threads import ThreadRepo
from octop.infra.db.repos.users import UserRepo


def _repo(tmp_path: Path) -> tuple[SqlitePool, ChatFileRepo]:
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
    return db, ChatFileRepo(db)


def test_file_and_first_revision_are_created_atomically(tmp_path: Path) -> None:
    db, repo = _repo(tmp_path)

    created = repo.create_uploaded(
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        display_name="same.txt",
        workspace_path="inbound/same.txt",
        sha256="abc",
        media_type="text/plain",
        byte_size=4,
    )

    assert created.file_id == "file-1"
    assert created.current_revision_id == "rev-1"
    assert repo.get_revision("rev-1").workspace_path == "inbound/same.txt"
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM chat_files").fetchone()[0] == 1
        assert conn.execute("SELECT count(*) FROM chat_file_revisions").fetchone()[0] == 1


def test_same_names_are_distinct_and_thread_binding_is_one_way(tmp_path: Path) -> None:
    _db, repo = _repo(tmp_path)
    for suffix in ("1", "2"):
        repo.create_uploaded(
            file_id=f"file-{suffix}",
            revision_id=f"rev-{suffix}",
            user_id=1,
            agent_id="agent",
            display_name="same.txt",
            workspace_path=f"inbound/{suffix}.txt",
            sha256=suffix,
            media_type="text/plain",
            byte_size=1,
        )

    expected = {"revision_id": "rev-1", "workspace_path": "inbound/1.txt"}
    assert (
        repo.bind_thread("file-1", user_id=1, agent_id="agent", thread_id="thread", **expected)
        is True
    )
    assert (
        repo.bind_thread("file-1", user_id=1, agent_id="agent", thread_id="thread", **expected)
        is True
    )
    assert (
        repo.bind_thread("file-1", user_id=1, agent_id="agent", thread_id="other", **expected)
        is False
    )
    assert (
        repo.bind_thread(
            "file-1",
            user_id=1,
            agent_id="agent",
            thread_id="thread",
            revision_id="rev-1",
            workspace_path="inbound/forged.txt",
        )
        is False
    )
    assert (
        repo.bind_thread(
            "file-2",
            user_id=2,
            agent_id="agent",
            thread_id="thread",
            revision_id="rev-2",
            workspace_path="inbound/2.txt",
        )
        is False
    )


def test_revision_conflict_rolls_back_file_row(tmp_path: Path) -> None:
    db, repo = _repo(tmp_path)
    repo.create_uploaded(
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        display_name="one.txt",
        workspace_path="inbound/one.txt",
        sha256="one",
        media_type="text/plain",
        byte_size=3,
    )

    with pytest.raises(sqlite3.IntegrityError):
        repo.create_uploaded(
            file_id="file-2",
            revision_id="rev-1",
            user_id=1,
            agent_id="agent",
            display_name="two.txt",
            workspace_path="inbound/two.txt",
            sha256="two",
            media_type="text/plain",
            byte_size=3,
        )

    assert repo.get("file-2") is None
    with db.connect() as conn:
        assert conn.execute("SELECT count(*) FROM chat_files").fetchone()[0] == 1


def test_segments_append_with_stable_ordinals_and_reject_parser_change(tmp_path: Path) -> None:
    _db, repo = _repo(tmp_path)
    repo.create_uploaded(
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        display_name="one.txt",
        workspace_path="inbound/one.txt",
        sha256="one",
        media_type="text/plain",
        byte_size=3,
    )

    assert repo.append_segments(
        "rev-1",
        [('{"kind":"line","start":1}', "one")],
        parse_version=1,
        read_status="partial",
        coverage_json='{"complete":false}',
    ) == [0]
    assert repo.append_segments(
        "rev-1",
        [('{"kind":"line","start":2}', "two")],
        parse_version=1,
        read_status="ready",
        coverage_json='{"complete":true}',
    ) == [1]
    assert [(row["ordinal"], row["text"]) for row in repo.list_segments("rev-1")] == [
        (0, "one"),
        (1, "two"),
    ]

    with pytest.raises(ValueError, match="parser version"):
        repo.append_segments("rev-1", [], parse_version=2, read_status="ready", coverage_json="{}")


def test_initial_parse_result_is_saved_once(tmp_path: Path) -> None:
    _db, repo = _repo(tmp_path)
    repo.create_uploaded(
        file_id="file-1",
        revision_id="rev-1",
        user_id=1,
        agent_id="agent",
        display_name="one.txt",
        workspace_path="inbound/one.txt",
        sha256="one",
        media_type="text/plain",
        byte_size=3,
    )

    first = repo.append_segments(
        "rev-1",
        [('{"kind":"line","start":1}', "one")],
        parse_version=1,
        read_status="ready",
        coverage_json='{"complete":true}',
        only_if_unparsed=True,
    )
    duplicate = repo.append_segments(
        "rev-1",
        [('{"kind":"line","start":1}', "one")],
        parse_version=1,
        read_status="ready",
        coverage_json='{"complete":true}',
        only_if_unparsed=True,
    )

    assert first == [0]
    assert duplicate is None
    assert [(row["ordinal"], row["text"]) for row in repo.list_segments("rev-1")] == [(0, "one")]
