"""Account isolation and non-destructive workbench grouping."""

from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.threads import ThreadRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.db.repos.workbench import WorkbenchRepo


@pytest.fixture
def setup_db(tmp_path: Path) -> tuple[SqlitePool, int, int]:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    users = UserRepo(db)
    owner_id = users.create(username="owner", password_hash="h", role="user")
    other_id = users.create(username="other", password_hash="h", role="user")
    AgentRepo(db).create(agent_id="agent_owner", user_id=owner_id, name="Agent")
    ThreadRepo(db).insert(
        thread_id="thread_owner",
        agent_id="agent_owner",
        user_id=owner_id,
        channel_type="dashboard",
        session_key="session_owner",
    )
    return db, owner_id, other_id


def test_workbench_projects_are_account_scoped(setup_db: tuple[SqlitePool, int, int]) -> None:
    db, owner_id, other_id = setup_db
    repo = WorkbenchRepo(db)
    project = repo.create_project(owner_user_id=owner_id, name="星球", icon="🌍")
    assert [row["project_id"] for row in repo.list_index(owner_id)["projects"]] == [
        project["project_id"]
    ]
    assert repo.list_index(other_id)["projects"] == []
    assert (
        repo.create_folder(owner_user_id=other_id, project_id=project["project_id"], name="偷看")
        is None
    )


def test_deleting_folder_or_project_only_ungroups_threads(
    setup_db: tuple[SqlitePool, int, int],
) -> None:
    db, owner_id, _ = setup_db
    repo = WorkbenchRepo(db)
    project = repo.create_project(owner_user_id=owner_id, name="星球", icon="🌍")
    folder = repo.create_folder(
        owner_user_id=owner_id, project_id=project["project_id"], name="前端"
    )
    assert folder is not None
    assert repo.assign_thread(
        owner_user_id=owner_id,
        thread_id="thread_owner",
        project_id=project["project_id"],
        folder_id=folder["folder_id"],
    )

    assert repo.delete_folder(owner_user_id=owner_id, folder_id=folder["folder_id"])
    assignment = repo.list_index(owner_id)["assignments"][0]
    assert assignment == {
        "thread_id": "thread_owner",
        "project_id": project["project_id"],
        "folder_id": None,
    }

    assert repo.delete_project(owner_user_id=owner_id, project_id=project["project_id"])
    assert repo.list_index(owner_id)["assignments"] == []
    with db.connect() as conn:
        assert conn.execute(
            "SELECT 1 FROM threads WHERE thread_id = ?", ("thread_owner",)
        ).fetchone()


def test_thread_assignment_rejects_other_account_and_mismatched_folder(
    setup_db: tuple[SqlitePool, int, int],
) -> None:
    _, owner_id, other_id = setup_db
    repo = WorkbenchRepo(_)
    project = repo.create_project(owner_user_id=owner_id, name="星球", icon="🌍")
    foreign_project = repo.create_project(owner_user_id=other_id, name="私有", icon="🔒")
    folder = repo.create_folder(
        owner_user_id=other_id, project_id=foreign_project["project_id"], name="私有目录"
    )
    assert folder is not None
    assert not repo.assign_thread(
        owner_user_id=other_id,
        thread_id="thread_owner",
        project_id=foreign_project["project_id"],
        folder_id=folder["folder_id"],
    )
    assert not repo.assign_thread(
        owner_user_id=owner_id,
        thread_id="thread_owner",
        project_id=project["project_id"],
        folder_id=folder["folder_id"],
    )
