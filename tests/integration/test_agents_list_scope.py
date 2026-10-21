"""Agent list user isolation."""

from __future__ import annotations

import pytest

from tests.support.auth import create_user


@pytest.fixture
async def env(env_with_provider):
    yield env_with_provider


async def test_list_agents_default_scope_is_mine_only(env) -> None:
    c, _srv, admin_auth = env
    guest_auth = await create_user(c, admin_auth, username="guest_iso")
    jubaoliang_auth = await create_user(c, admin_auth, username="jubaoliang_iso")

    r = await c.post(
        "/api/agents/from-expert/default",
        headers=guest_auth,
        json={"name": "guest-bot"},
    )
    assert r.status_code == 201, r.text
    guest_agent_id = r.json()["agent_id"]

    r = await c.post(
        "/api/agents/from-expert/default",
        headers=jubaoliang_auth,
        json={"name": "juba-bot"},
    )
    assert r.status_code == 201, r.text

    r = await c.get("/api/agents", headers=jubaoliang_auth)
    assert r.status_code == 200
    rows = r.json()
    ids = {row["agent_id"] for row in rows}
    assert guest_agent_id not in ids
    assert all(row.get("user_id") is not None or row["is_shared"] for row in rows)


async def test_list_includes_only_enabled_explicitly_shared_system_agents(env) -> None:
    c, srv, admin_auth = env
    user_auth = await create_user(c, admin_auth, username="system_shared_viewer")
    repo = srv.services.agent_repo
    for agent_id in ("system-shared", "system-private", "system-disabled"):
        repo.create(agent_id=agent_id, user_id=None, name=agent_id)
    repo.set_shared("system-shared", True)
    repo.set_shared("system-disabled", True)
    repo.set_enabled("system-disabled", False)

    response = await c.get("/api/agents", headers=user_auth)

    assert response.status_code == 200, response.text
    rows = {row["agent_id"]: row for row in response.json()}
    assert "system-shared" in rows
    assert rows["system-shared"]["is_shared"] is True
    assert rows["system-shared"]["is_owner"] is False
    assert "system-private" not in rows
    assert "system-disabled" not in rows


async def test_admin_scope_all_lists_every_user(env) -> None:
    c, _srv, admin_auth = env
    guest_auth = await create_user(c, admin_auth, username="guest_all")
    r = await c.post(
        "/api/agents/from-expert/default",
        headers=guest_auth,
        json={"name": "guest-all-bot"},
    )
    assert r.status_code == 201, r.text
    guest_agent_id = r.json()["agent_id"]

    r = await c.get("/api/agents?scope=all", headers=admin_auth)
    assert r.status_code == 200
    ids = {row["agent_id"] for row in r.json()}
    assert guest_agent_id in ids


async def test_non_admin_cannot_use_scope_all(env) -> None:
    c, _srv, admin_auth = env
    user_auth = await create_user(c, admin_auth, username="scope_user")
    r = await c.get("/api/agents?scope=all", headers=user_auth)
    assert r.status_code == 403


async def test_non_admin_cannot_get_other_users_agent(env) -> None:
    c, _srv, admin_auth = env
    guest_auth = await create_user(c, admin_auth, username="guest_get")
    other_auth = await create_user(c, admin_auth, username="other_get")
    r = await c.post(
        "/api/agents/from-expert/default",
        headers=guest_auth,
        json={"name": "guest-only"},
    )
    assert r.status_code == 201, r.text
    guest_agent_id = r.json()["agent_id"]

    r = await c.get(f"/api/agents/{guest_agent_id}", headers=other_auth)
    assert r.status_code == 403


async def test_owner_can_delete_own_agent(env) -> None:
    c, _srv, admin_auth = env
    owner_auth = await create_user(c, admin_auth, username="owner_del")
    r = await c.post(
        "/api/agents/from-expert/default",
        headers=owner_auth,
        json={"name": "deletable-bot"},
    )
    assert r.status_code == 201, r.text
    agent_id = r.json()["agent_id"]

    r = await c.delete(f"/api/agents/{agent_id}", headers=owner_auth)
    assert r.status_code == 204

    r = await c.get(f"/api/agents/{agent_id}", headers=owner_auth)
    assert r.status_code == 404


async def test_non_admin_cannot_delete_shared_agent(env) -> None:
    c, srv, admin_auth = env
    user_auth = await create_user(c, admin_auth, username="shared_guard")
    agent_id = "shared-del-test"
    srv.services.agent_repo.create(agent_id=agent_id, user_id=None, name="shared")

    r = await c.delete(f"/api/agents/{agent_id}", headers=user_auth)
    assert r.status_code == 403

    r = await c.delete(f"/api/agents/{agent_id}", headers=admin_auth)
    assert r.status_code == 204


async def test_regular_user_can_create_and_reload_agent(env) -> None:
    c, _srv, admin_auth = env
    user_auth = await create_user(c, admin_auth, username="agent_owner")
    r = await c.post(
        "/api/agents",
        headers=user_auth,
        json={"name": "user-bot", "config": {}},
    )
    assert r.status_code == 201, r.text
    agent_id = r.json()["agent_id"]

    r = await c.post(f"/api/agents/{agent_id}/reload", headers=user_auth)
    assert r.status_code == 204

    r = await c.post(f"/api/agents/{agent_id}/start", headers=user_auth)
    assert r.status_code == 204
