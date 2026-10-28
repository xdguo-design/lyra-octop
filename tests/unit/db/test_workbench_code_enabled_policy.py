"""P0 acceptance: workbench code browsing must never be self-service.

Acceptance criteria (docs/testing/dev-p0-manual-acceptance.md, workbench code
browsing):

  1. A regular user must not gain code-directory access by naming a project
     "星球".
  2. Legacy (browser-local) project imports must default code browsing to off.
  3. Renaming a project must not toggle code browsing.
  4. ``owns_code_project`` must keep gating on owner + ``code_enabled``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.users import UserRepo
from octop.infra.db.repos.workbench import WorkbenchRepo


@pytest.fixture
def workbench(tmp_path: Path) -> tuple[SqlitePool, WorkbenchRepo, int, int]:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    users = UserRepo(db)
    admin_id = users.create(username="admin", password_hash="h", role="admin")
    regular_id = users.create(username="regular", password_hash="h", role="user")
    agents = AgentRepo(db)
    agents.create(agent_id="agent_admin", user_id=admin_id, name="Admin agent")
    agents.create(agent_id="agent_regular", user_id=regular_id, name="Regular agent")
    return db, WorkbenchRepo(db), admin_id, regular_id


def test_planet_named_project_does_not_self_enable_code_browsing(
    workbench: tuple[SqlitePool, WorkbenchRepo, int, int],
) -> None:
    _db, repo, _admin_id, regular_id = workbench
    project = repo.create_project(owner_user_id=regular_id, name="星球", icon="🌍")
    assert project is not None
    # A regular user must not gain code browsing just by picking this name.
    assert project["code_enabled"] is False
    assert not repo.owns_code_project(owner_user_id=regular_id, project_id=project["project_id"])


def test_legacy_import_leaves_code_browsing_disabled(
    workbench: tuple[SqlitePool, WorkbenchRepo, int, int],
) -> None:
    _db, repo, _admin_id, regular_id = workbench
    repo.import_legacy_projects(
        owner_user_id=regular_id,
        projects=[{"name": "星球", "thread_ids": []}],
    )
    projects = repo.list_index(regular_id)["projects"]
    assert [project["name"] for project in projects] == ["星球"]
    # list_index returns the raw storage flag (int); only its truthiness matters.
    assert not projects[0]["code_enabled"]
    assert not repo.owns_code_project(
        owner_user_id=regular_id, project_id=projects[0]["project_id"]
    )


def test_renaming_a_project_to_planet_does_not_enable_code_browsing(
    workbench: tuple[SqlitePool, WorkbenchRepo, int, int],
) -> None:
    _db, repo, _admin_id, regular_id = workbench
    project = repo.create_project(owner_user_id=regular_id, name="普通项目", icon="📁")
    assert project is not None
    assert repo.update_project(
        owner_user_id=regular_id,
        project_id=project["project_id"],
        name="星球",
        icon="📁",
    )
    row = next(
        item
        for item in repo.list_index(regular_id)["projects"]
        if item["project_id"] == project["project_id"]
    )
    assert row["name"] == "星球"
    assert not row["code_enabled"]


def test_owns_code_project_gate_requires_owner_and_enabled_flag(
    workbench: tuple[SqlitePool, WorkbenchRepo, int, int],
) -> None:
    db, repo, admin_id, regular_id = workbench
    planet = repo.create_project(owner_user_id=admin_id, name="星球", icon="🌍")
    plain = repo.create_project(owner_user_id=regular_id, name="普通项目", icon="📁")
    assert planet is not None and plain is not None
    # Force-enable at the storage layer so the gate itself is under test,
    # independent of whichever enable policy the fix branch ships.
    with db.connect() as conn:
        conn.execute(
            "UPDATE workbench_projects SET code_enabled = 1 WHERE project_id = ?",
            (planet["project_id"],),
        )
    assert repo.owns_code_project(owner_user_id=admin_id, project_id=planet["project_id"])
    assert not repo.owns_code_project(owner_user_id=regular_id, project_id=planet["project_id"])
    assert not repo.owns_code_project(owner_user_id=regular_id, project_id=plain["project_id"])
