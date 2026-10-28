"""P0 offline acceptance for the three defect classes in the handoff:

  1. Workbench code browsing permissions (regular users, root bounding,
     legacy import defaults).
  2. Chat attachment lifecycle (draft vs thread-bound, cross-user safety).
  3. Conversation history pagination (contiguous, unique, cursor sanity).

The assertions encode the acceptance criteria; they hold both before the fix
(where the buggy path simply fails) and after it.
"""

from __future__ import annotations

import json
from typing import Any

from octop.infra.db.repos.thread_messages import ThreadMessageInput
from tests.support.auth import create_user


async def _force_enable_code(srv: Any, project_id: str) -> None:
    """Storage-level enable so boundary tests do not depend on the enable API."""
    with srv.services.db.connect() as conn:
        conn.execute(
            "UPDATE workbench_projects SET code_enabled = 1 WHERE project_id = ?",
            (project_id,),
        )


# ── Issue 1: workbench code browsing permissions ────────────────────────────


async def test_regular_user_planet_project_cannot_browse_code(env_with_agent: Any) -> None:
    client, srv, admin_auth, _agent_id = env_with_agent
    other_auth = await create_user(client, admin_auth, username="p0-code-regular")

    created = await client.post(
        "/api/workbench/projects", headers=other_auth, json={"name": "星球", "icon": "🌍"}
    )
    assert created.status_code == 201, created.text
    project = created.json()
    project_id = project["project_id"]

    # Naming a project "星球" must not hand a regular user code access.
    assert project["code_enabled"] is False
    for call in (
        client.get(f"/api/workbench/projects/{project_id}/code", headers=other_auth),
        client.get(
            f"/api/workbench/projects/{project_id}/code/file",
            headers=other_auth,
            params={"path": "main.py"},
        ),
    ):
        response = await call
        assert response.status_code == 404, response.text

    # No self-service surface may flip the flag on either.
    for method in ("post", "put", "patch"):
        for suffix in ("/code", "/code-enabled"):
            response = await getattr(client, method)(
                f"/api/workbench/projects/{project_id}{suffix}",
                headers=other_auth,
                json={"enabled": True},
            )
            assert response.status_code in (403, 404, 405), (method, suffix, response.text)
    index = (await client.get("/api/workbench", headers=other_auth)).json()
    assert index["projects"][0]["code_enabled"] is False


async def test_code_browsing_stays_inside_configured_root(
    env_with_agent: Any, tmp_path: Any
) -> None:
    client, srv, admin_auth, _agent_id = env_with_agent
    root = tmp_path / "planet-root"
    root.mkdir()
    (root / "main.py").write_text("print('planet')", encoding="utf-8")
    (root / ".env").write_text("TOKEN=secret", encoding="utf-8")
    (root / "data").mkdir()
    outside = tmp_path / "outside.py"
    outside.write_text("print('outside')", encoding="utf-8")
    object.__setattr__(srv.services.config, "workbench_code_root", str(root))

    project = (
        await client.post(
            "/api/workbench/projects", headers=admin_auth, json={"name": "星球", "icon": "🌍"}
        )
    ).json()
    project_id = project["project_id"]
    if not project["code_enabled"]:
        await _force_enable_code(srv, project_id)

    listing = await client.get(f"/api/workbench/projects/{project_id}/code", headers=admin_auth)
    assert listing.status_code == 200, listing.text
    assert [entry["name"] for entry in listing.json()["entries"]] == ["main.py"]

    ok = await client.get(
        f"/api/workbench/projects/{project_id}/code/file",
        headers=admin_auth,
        params={"path": "main.py"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["content"] == "print('planet')"

    for bad_path in ("../outside.py", str(outside), "data/../../outside.py", ".."):
        escaped = await client.get(
            f"/api/workbench/projects/{project_id}/code/file",
            headers=admin_auth,
            params={"path": bad_path},
        )
        assert escaped.status_code == 404, (bad_path, escaped.text)

    secret = await client.get(
        f"/api/workbench/projects/{project_id}/code/file",
        headers=admin_auth,
        params={"path": ".env"},
    )
    assert secret.status_code == 404, secret.text

    # A different account must not browse someone else's enabled project.
    other_auth = await create_user(client, admin_auth, username="p0-code-other")
    forbidden = await client.get(f"/api/workbench/projects/{project_id}/code", headers=other_auth)
    assert forbidden.status_code == 404, forbidden.text


async def test_legacy_import_disables_code_browsing_for_planet_projects(env: Any) -> None:
    client, _srv, admin_auth = env
    payload = {"projects": [{"name": "星球", "thread_ids": []}]}
    assert (
        await client.post("/api/workbench/import-local", headers=admin_auth, json=payload)
    ).status_code == 204
    index = (await client.get("/api/workbench", headers=admin_auth)).json()
    planet = next(p for p in index["projects"] if p["name"] == "星球")
    assert planet["code_enabled"] is False
    listing = await client.get(
        f"/api/workbench/projects/{planet['project_id']}/code", headers=admin_auth
    )
    assert listing.status_code == 404, listing.text


# ── Issue 2: chat attachment lifecycle ──────────────────────────────────────


async def _upload(client: Any, auth: dict[str, str], agent_id: str, name: str) -> dict[str, Any]:
    response = await client.post(
        f"/api/agents/{agent_id}/upload",
        files={"file": (name, b"attachment body", "text/plain")},
        headers=auth,
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_uploaded_attachment_is_an_unbound_draft_until_sent(
    env_with_provider: Any,
) -> None:
    client, srv, admin_auth = env_with_provider
    alice_auth = await create_user(client, admin_auth, username="p0-att-alice")
    bob_auth = await create_user(client, admin_auth, username="p0-att-bob")
    agent = await client.post(
        "/api/agents",
        headers=alice_auth,
        json={
            "name": "alice-attachments",
            "config": {"providers": ["openai"], "default_model": "openai:gpt-4o"},
        },
    )
    agent.raise_for_status()
    agent_id = agent.json()["agent_id"]

    body = await _upload(client, alice_auth, agent_id, "draft.txt")
    record = srv.services.chat_file_repo.get(body["file_id"])
    assert record is not None
    assert record.thread_id is None, "a fresh upload must stay an unbound draft"
    assert record.deleted_at is None

    # A draft is invisible to every thread's file list.
    srv.services.thread_repo.insert(
        thread_id="p0-att-thread",
        agent_id=agent_id,
        user_id=record.user_id,
        channel_type="dashboard",
        session_key="p0-att-session",
    )
    listing = await client.get(
        f"/api/agents/{agent_id}/threads/p0-att-thread/files", headers=alice_auth
    )
    assert listing.status_code == 200, listing.text
    assert listing.json() == []

    # Another user cannot even see the draft's metadata.
    intruder = await client.get(f"/api/agents/{agent_id}/files/{body['file_id']}", headers=bob_auth)
    assert intruder.status_code in (403, 404), intruder.text

    # Binding is one-way: once bound to a thread it cannot be re-pointed.
    assert srv.services.chat_file_repo.bind_thread(
        body["file_id"],
        user_id=record.user_id,
        agent_id=agent_id,
        thread_id="p0-att-thread",
        revision_id=body["revision_id"],
        workspace_path=body["workspace_path"],
    )
    assert not srv.services.chat_file_repo.bind_thread(
        body["file_id"],
        user_id=record.user_id,
        agent_id=agent_id,
        thread_id="p0-att-other-thread",
        revision_id=body["revision_id"],
        workspace_path=body["workspace_path"],
    )
    bound = srv.services.chat_file_repo.get(body["file_id"])
    assert bound is not None and bound.thread_id == "p0-att-thread"

    # Reads require the exact bound thread.
    wrong_thread = await client.post(
        f"/api/agents/{agent_id}/files/{body['file_id']}/read",
        headers=alice_auth,
        json={"thread_id": "p0-att-other-thread", "revision_id": body["revision_id"]},
    )
    assert wrong_thread.status_code == 404, wrong_thread.text


async def test_attachment_deletion_surface_is_owner_draft_only(env_with_provider: Any) -> None:
    client, srv, admin_auth = env_with_provider
    alice_auth = await create_user(client, admin_auth, username="p0-del-alice")
    bob_auth = await create_user(client, admin_auth, username="p0-del-bob")
    agent = await client.post(
        "/api/agents",
        headers=alice_auth,
        json={
            "name": "alice-delete",
            "config": {"providers": ["openai"], "default_model": "openai:gpt-4o"},
        },
    )
    agent.raise_for_status()
    agent_id = agent.json()["agent_id"]

    draft = await _upload(client, alice_auth, agent_id, "draft.txt")
    bound = await _upload(client, alice_auth, agent_id, "bound.txt")
    alice_id = srv.services.chat_file_repo.get(draft["file_id"]).user_id
    srv.services.thread_repo.insert(
        thread_id="p0-del-thread",
        agent_id=agent_id,
        user_id=alice_id,
        channel_type="dashboard",
        session_key="p0-del-session",
    )
    assert srv.services.chat_file_repo.bind_thread(
        bound["file_id"],
        user_id=alice_id,
        agent_id=agent_id,
        thread_id="p0-del-thread",
        revision_id=bound["revision_id"],
        workspace_path=bound["workspace_path"],
    )

    # Whatever deletion surface exists, none of these may destroy data:
    #  - another user must never delete alice's draft
    #  - a thread-bound file must survive (no accidental deletion)
    #  - alice's own draft deletion is the only acceptable 2xx/204
    for auth, file_id, label in (
        (bob_auth, draft["file_id"], "other-user-draft"),
        (alice_auth, bound["file_id"], "owner-bound"),
        (bob_auth, bound["file_id"], "other-user-bound"),
    ):
        response = await client.delete(f"/api/agents/{agent_id}/files/{file_id}", headers=auth)
        assert response.status_code in (403, 404, 405), (label, response.text)

    for file_id in (draft["file_id"], bound["file_id"]):
        row = srv.services.chat_file_repo.get(file_id)
        assert row is not None and row.deleted_at is None, file_id
    listing = await client.get(
        f"/api/agents/{agent_id}/threads/p0-del-thread/files", headers=alice_auth
    )
    assert [row["file_id"] for row in listing.json()] == [bound["file_id"]]


# ── Issue 3: conversation history pagination ────────────────────────────────


async def test_history_pages_are_contiguous_unique_and_cursor_safe(
    env_with_main_agent: Any,
) -> None:
    client, srv, admin_auth, agent_id = env_with_main_agent
    admin = srv.services.user_repo.get_by_username("admin")
    assert admin is not None
    thread_id = "p0-history-thread"
    srv.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=admin.id,
        channel_type="dashboard",
        session_key="p0-history-session",
    )
    total = 30
    srv.services.thread_message_repo.replace_all(
        thread_id,
        [
            ThreadMessageInput(
                f"m{index:02d}",
                "human" if index % 2 == 0 else "ai",
                json.dumps(
                    {
                        "type": "human" if index % 2 == 0 else "ai",
                        "data": {"content": f"消息 {index:02d}", "id": f"m{index:02d}"},
                    },
                    ensure_ascii=False,
                ),
                1000 + index,
            )
            for index in range(total)
        ],
    )

    seen: list[str] = []
    offset = 0
    has_more = True
    while has_more:
        page = await client.get(
            f"/api/agents/{agent_id}/threads/{thread_id}/history",
            headers=admin_auth,
            params={"limit": 10, "offset": offset},
        )
        assert page.status_code == 200, page.text
        body = page.json()
        ids = [message["id"] for message in body["messages"]]
        contents = [
            block["text"]
            for message in body["messages"]
            for block in message["content"]
            if block.get("type") == "text"
        ]
        assert len(ids) == len(set(ids)), f"duplicate ids within page at offset {offset}"
        assert not (seen and set(ids) & set(seen)), f"overlap at offset {offset}"
        assert contents == sorted(contents), f"page out of order at offset {offset}"
        seen.extend(ids)
        has_more = body["has_more"]
        assert body["offset"] == offset
        offset += 10
    # Pages walk backwards from the newest message; concatenated they cover the
    # whole thread exactly once — newest page first, ascending inside each page.
    expected = [
        f"m{index:02d}"
        for start in range(total - 10, -1, -10)
        for index in range(start, start + 10)
    ]
    assert seen == expected
    assert has_more is False

    # A stray cursor must not corrupt offset paging on the projection path.
    with_cursor = await client.get(
        f"/api/agents/{agent_id}/threads/{thread_id}/history",
        headers=admin_auth,
        params={"limit": 10, "offset": 0, "cursor": "stray-cursor"},
    )
    assert with_cursor.status_code == 200, with_cursor.text
    assert [m["id"] for m in with_cursor.json()["messages"]] == [
        f"m{index:02d}" for index in range(20, 30)
    ]

    # Limit is clamped, not trusted from the client.
    huge = await client.get(
        f"/api/agents/{agent_id}/threads/{thread_id}/history",
        headers=admin_auth,
        params={"limit": 100000},
    )
    assert huge.status_code == 200, huge.text
    assert huge.json()["limit"] == 200
    assert len(huge.json()["messages"]) == total

    # Another user's thread is invisible.
    other_auth = await create_user(client, admin_auth, username="p0-history-other")
    forbidden = await client.get(
        f"/api/agents/{agent_id}/threads/{thread_id}/history", headers=other_auth
    )
    assert forbidden.status_code in (403, 404), forbidden.text


async def test_shared_project_history_paginates_without_repeats(env_with_main_agent: Any) -> None:
    client, srv, admin_auth, agent_id = env_with_main_agent
    admin = srv.services.user_repo.get_by_username("admin")
    assert admin is not None
    project = (
        await client.post("/api/workbench/projects", headers=admin_auth, json={"name": "分页分享"})
    ).json()
    thread_id = "p0-share-history-thread"
    srv.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=admin.id,
        channel_type="dashboard",
        session_key="p0-share-history-session",
    )
    assert srv.services.workbench_repo.assign_thread(
        owner_user_id=admin.id,
        thread_id=thread_id,
        project_id=project["project_id"],
        folder_id=None,
    )
    total = 6
    srv.services.thread_message_repo.replace_all(
        thread_id,
        [
            ThreadMessageInput(
                f"s{index}",
                "human" if index % 2 == 0 else "ai",
                json.dumps(
                    {
                        "type": "human" if index % 2 == 0 else "ai",
                        "data": {"content": f"分享 {index}", "id": f"s{index}"},
                    },
                    ensure_ascii=False,
                ),
                2000 + index,
            )
            for index in range(total)
        ],
    )
    share = (
        await client.post(
            f"/api/workbench/projects/{project['project_id']}/shares",
            headers=admin_auth,
            json={"expires_in_seconds": 3600},
        )
    ).json()

    seen: list[str] = []
    offset = 0
    has_more = True
    while has_more:
        page = await client.get(
            f"/api/workbench-shares/{share['token']}/threads/{thread_id}",
            params={"limit": 2, "offset": offset},
        )
        assert page.status_code == 200, page.text
        body = page.json()
        # The share surface projects to role/content/created_at only.
        contents = [message["content"] for message in body["messages"]]
        assert len(set(contents)) == len(contents), f"duplicate messages at offset {offset}"
        assert not (seen and set(contents) & set(seen)), f"overlap at offset {offset}"
        assert contents == sorted(contents), f"out of order at offset {offset}"
        seen.extend(contents)
        has_more = body["has_more"]
        offset += 2
    expected = [
        f"分享 {index}" for start in range(total - 2, -1, -2) for index in range(start, start + 2)
    ]
    assert seen == expected
    assert has_more is False
