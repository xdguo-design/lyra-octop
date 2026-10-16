from __future__ import annotations

from pathlib import Path
from typing import Any

from tests.support.auth import create_user


async def test_projects_folders_and_thread_assignments_are_account_scoped(
    env_with_main_agent: Any,
) -> None:
    client, server, admin_auth, agent_id = env_with_main_agent
    admin = server.services.user_repo.get_by_username("admin")
    assert admin is not None
    server.services.thread_repo.insert(
        thread_id="thread_workbench",
        agent_id=agent_id,
        user_id=admin.id,
        channel_type="dashboard",
        session_key="workbench-session",
    )

    project_response = await client.post(
        "/api/workbench/projects", headers=admin_auth, json={"name": "星球", "icon": "🌍"}
    )
    assert project_response.status_code == 201
    project = project_response.json()
    assert project["code_enabled"] is True
    folder_response = await client.post(
        f"/api/workbench/projects/{project['project_id']}/folders",
        headers=admin_auth,
        json={"name": "前端"},
    )
    assert folder_response.status_code == 201
    folder = folder_response.json()

    assigned = await client.put(
        "/api/workbench/threads/thread_workbench/assignment",
        headers=admin_auth,
        json={"project_id": project["project_id"], "folder_id": folder["folder_id"]},
    )
    assert assigned.status_code == 200
    other_auth = await create_user(client, admin_auth, username="workbench-other")
    assert (await client.get("/api/workbench", headers=other_auth)).json() == {
        "projects": [],
        "folders": [],
        "assignments": [],
    }

    deleted = await client.delete(
        f"/api/workbench/folders/{folder['folder_id']}", headers=admin_auth
    )
    assert deleted.status_code == 204
    index = (await client.get("/api/workbench", headers=admin_auth)).json()
    assert index["assignments"] == [
        {"thread_id": "thread_workbench", "project_id": project["project_id"], "folder_id": None}
    ]

    deleted = await client.delete(
        f"/api/workbench/projects/{project['project_id']}", headers=admin_auth
    )
    assert deleted.status_code == 204
    index = (await client.get("/api/workbench", headers=admin_auth)).json()
    assert index["assignments"] == []
    assert server.services.thread_repo.get("thread_workbench") is not None


async def test_local_project_import_is_idempotent(env: Any) -> None:
    client, _server, admin_auth = env
    payload = {"projects": [{"name": "星球", "thread_ids": []}]}
    assert (
        await client.post("/api/workbench/import-local", headers=admin_auth, json=payload)
    ).status_code == 204
    assert (
        await client.post("/api/workbench/import-local", headers=admin_auth, json=payload)
    ).status_code == 204
    index = (await client.get("/api/workbench", headers=admin_auth)).json()
    assert [project["name"] for project in index["projects"]] == ["星球"]


async def test_planet_code_route_is_root_bounded_and_owner_scoped(
    env_with_main_agent: Any,
    tmp_path: Path,
) -> None:
    client, server, admin_auth, _agent_id = env_with_main_agent
    source_root = tmp_path / "planet"
    source_root.mkdir()
    (source_root / "main.py").write_text("print('planet')", encoding="utf-8")
    (source_root / ".env").write_text("TOKEN=secret", encoding="utf-8")
    object.__setattr__(server.services.config, "workbench_code_root", str(source_root))
    project = (
        await client.post(
            "/api/workbench/projects", headers=admin_auth, json={"name": "星球", "icon": "🌍"}
        )
    ).json()

    listing = await client.get(
        f"/api/workbench/projects/{project['project_id']}/code", headers=admin_auth
    )
    assert listing.status_code == 200
    assert [entry["name"] for entry in listing.json()["entries"]] == ["main.py"]
    file = await client.get(
        f"/api/workbench/projects/{project['project_id']}/code/file",
        headers=admin_auth,
        params={"path": "main.py"},
    )
    assert file.status_code == 200
    assert file.json()["content"] == "print('planet')"
    escaped = await client.get(
        f"/api/workbench/projects/{project['project_id']}/code/file",
        headers=admin_auth,
        params={"path": "../outside.py"},
    )
    assert escaped.status_code == 404

    other_auth = await create_user(client, admin_auth, username="code-other")
    forbidden_project = await client.get(
        f"/api/workbench/projects/{project['project_id']}/code", headers=other_auth
    )
    assert forbidden_project.status_code == 404


async def test_projects_can_nest_under_a_parent_project(env_with_main_agent: Any) -> None:
    client, server, admin_auth, agent_id = env_with_main_agent
    admin = server.services.user_repo.get_by_username("admin")
    assert admin is not None

    parent = (
        await client.post(
            "/api/workbench/projects", headers=admin_auth, json={"name": "星球", "icon": "📁"}
        )
    ).json()
    child = (
        await client.post(
            "/api/workbench/projects",
            headers=admin_auth,
            json={"name": "星球26.10", "icon": "⚔️", "parent_id": parent["project_id"]},
        )
    ).json()
    assert child["parent_id"] == parent["project_id"]

    moved = await client.put(
        f"/api/workbench/projects/{child['project_id']}",
        headers=admin_auth,
        json={"name": child["name"], "icon": child["icon"], "parent_id": None},
    )
    assert moved.status_code == 200
    assert moved.json()["parent_id"] is None
    moved = await client.put(
        f"/api/workbench/projects/{child['project_id']}",
        headers=admin_auth,
        json={"name": child["name"], "icon": child["icon"], "parent_id": parent["project_id"]},
    )
    assert moved.status_code == 200

    # A project cannot become its own parent or nest under its own subtree.
    self_parent = await client.put(
        f"/api/workbench/projects/{child['project_id']}",
        headers=admin_auth,
        json={"name": child["name"], "icon": child["icon"], "parent_id": child["project_id"]},
    )
    assert self_parent.status_code == 403
    flipped = await client.put(
        f"/api/workbench/projects/{parent['project_id']}",
        headers=admin_auth,
        json={"name": parent["name"], "icon": parent["icon"], "parent_id": child["project_id"]},
    )
    assert flipped.status_code == 403

    # Deleting the parent sends children back to the top level.
    deleted = await client.delete(
        f"/api/workbench/projects/{parent['project_id']}", headers=admin_auth
    )
    assert deleted.status_code == 204
    index = (await client.get("/api/workbench", headers=admin_auth)).json()
    assert index["projects"] == [
        {
            "project_id": child["project_id"],
            "name": child["name"],
            "icon": child["icon"],
            "parent_id": None,
            "code_enabled": child["code_enabled"],
            "created_at": child["created_at"],
            "updated_at": child["updated_at"],
        }
    ]
