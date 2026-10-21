from __future__ import annotations

from pathlib import Path
from typing import Any

from octop.infra.db.repos.thread_messages import ThreadMessageInput
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
    assignment_events = server.services.audit_repo.query(project_id=project["project_id"])
    assert any(event.action == "workbench.thread.assign" for event in assignment_events)
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


async def test_project_knowledge_bases_are_owner_visible_and_audited(
    env_with_main_agent: Any,
) -> None:
    client, server, admin_auth, _agent_id = env_with_main_agent
    admin = server.services.user_repo.get_by_username("admin")
    assert admin is not None
    own_base = server.services.knowledge_repo.create_base(owner_user_id=admin.id, name="项目资料")
    project = (
        await client.post("/api/workbench/projects", headers=admin_auth, json={"name": "项目 RAG"})
    ).json()
    url = f"/api/workbench/projects/{project['project_id']}/knowledge-bases"
    saved = await client.put(
        url, headers=admin_auth, json={"knowledge_base_ids": [own_base.id, own_base.id]}
    )
    assert saved.status_code == 200
    assert saved.json() == [own_base.id]
    index = (await client.get("/api/workbench", headers=admin_auth)).json()
    assert index["projects"][0]["knowledge_base_ids"] == [own_base.id]

    await create_user(client, admin_auth, username="project-rag-other")
    other = server.services.user_repo.get_by_username("project-rag-other")
    assert other is not None
    private_base = server.services.knowledge_repo.create_base(
        owner_user_id=other.id, name="其他人的资料"
    )
    denied = await client.put(
        url, headers=admin_auth, json={"knowledge_base_ids": [private_base.id]}
    )
    assert denied.status_code == 404
    assert any(
        event.action == "workbench.project.knowledge_bases.update"
        for event in server.services.audit_repo.query(project_id=project["project_id"])
    )


async def test_project_activity_is_queryable_by_project_and_time(
    env_with_main_agent: Any,
) -> None:
    client, _server, admin_auth, _agent_id = env_with_main_agent
    created = await client.post(
        "/api/workbench/projects", headers=admin_auth, json={"name": "活动项目"}
    )
    assert created.status_code == 201
    project_id = created.json()["project_id"]
    choices = await client.get("/api/admin/audit-log/projects", headers=admin_auth)
    assert {row["project_id"] for row in choices.json()} >= {project_id}

    logs = await client.get(
        f"/api/admin/audit-log?project_id={project_id}&since=1&until=4102444800",
        headers=admin_auth,
    )
    assert logs.status_code == 200
    assert any(
        row["action"] == "workbench.project.create" and row["project_id"] == project_id
        for row in logs.json()
    )

    outside_range = await client.get(
        f"/api/admin/audit-log?project_id={project_id}&since=1&until=1",
        headers=admin_auth,
    )
    assert outside_range.status_code == 200
    assert outside_range.json() == []


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
            "external_url": None,
            "code_enabled": child["code_enabled"],
            "knowledge_base_ids": [],
            "created_at": child["created_at"],
            "updated_at": child["updated_at"],
        }
    ]


async def test_project_share_is_anonymous_read_only_and_revocable(
    env_with_main_agent: Any,
) -> None:
    client, server, admin_auth, agent_id = env_with_main_agent
    admin = server.services.user_repo.get_by_username("admin")
    assert admin is not None
    project = (
        await client.post("/api/workbench/projects", headers=admin_auth, json={"name": "共享项目"})
    ).json()
    folder = (
        await client.post(
            f"/api/workbench/projects/{project['project_id']}/folders",
            headers=admin_auth,
            json={"name": "任务"},
        )
    ).json()
    server.services.thread_repo.insert(
        thread_id="shared_thread",
        agent_id=agent_id,
        user_id=admin.id,
        channel_type="dashboard",
        session_key="shared-session",
        title="演示任务",
    )
    server.services.thread_repo.insert(
        thread_id="unshared_thread",
        agent_id=agent_id,
        user_id=admin.id,
        channel_type="dashboard",
        session_key="unshared-session",
        title="私人任务",
    )
    assert server.services.workbench_repo.assign_thread(
        owner_user_id=admin.id,
        thread_id="shared_thread",
        project_id=project["project_id"],
        folder_id=folder["folder_id"],
    )
    server.services.thread_message_repo.replace_all(
        "shared_thread",
        [
            ThreadMessageInput(None, "human", '{"type":"human","data":{"content":"你好"}}', 10),
            ThreadMessageInput(None, "ai", '{"type":"ai","data":{"content":"项目回复"}}', 11),
            ThreadMessageInput(
                None, "tool", '{"type":"tool","data":{"content":"secret output"}}', 12
            ),
        ],
    )

    created = await client.post(
        f"/api/workbench/projects/{project['project_id']}/shares",
        headers=admin_auth,
        json={"expires_in_seconds": 3600},
    )
    assert created.status_code == 201
    share = created.json()
    assert share["token"]
    assert "token_hash" not in share

    public = await client.get(f"/api/workbench-shares/{share['token']}")
    assert public.status_code == 200
    assert public.headers["cache-control"] == "no-store"
    payload = public.json()
    assert payload["project"]["project_id"] == project["project_id"]
    assert payload["folders"][0]["folder_id"] == folder["folder_id"]
    assert payload["threads"] == [
        {
            "thread_id": "shared_thread",
            "title": "演示任务",
            "project_id": project["project_id"],
            "folder_id": folder["folder_id"],
        }
    ]
    history = await client.get(f"/api/workbench-shares/{share['token']}/threads/shared_thread")
    assert history.status_code == 200
    assert history.json()["messages"] == [
        {"role": "user", "content": "你好", "created_at": 10},
        {"role": "assistant", "content": "项目回复", "created_at": 11},
    ]
    assert "secret output" not in history.text
    assert (
        await client.get(f"/api/workbench-shares/{share['token']}/threads/unshared_thread")
    ).status_code == 404
    assert (
        await client.post(
            f"/api/workbench/projects/{project['project_id']}/shares",
            headers=admin_auth,
            json={"expires_in_seconds": 60},
        )
    ).status_code == 422
    assert (await client.get("/api/workbench-shares/not-a-valid-share-token")).status_code == 404
    assert (await client.get("/api/workbench-shares/💩")).status_code == 404

    shares = await client.get(
        f"/api/workbench/projects/{project['project_id']}/shares", headers=admin_auth
    )
    assert shares.status_code == 200
    assert len(shares.json()) == 1
    assert "token" not in shares.json()[0]

    other_auth = await create_user(client, admin_auth, username="share-other")
    forbidden = await client.delete(
        f"/api/workbench/projects/{project['project_id']}/shares/{share['share_id']}",
        headers=other_auth,
    )
    assert forbidden.status_code == 404
    revoked = await client.delete(
        f"/api/workbench/projects/{project['project_id']}/shares/{share['share_id']}",
        headers=admin_auth,
    )
    assert revoked.status_code == 204
    assert (await client.get(f"/api/workbench-shares/{share['token']}")).status_code == 404
