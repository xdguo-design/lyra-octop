from __future__ import annotations

from typing import Any

from tests.support.auth import create_agent, create_user


async def test_presentations_persist_and_reject_stale_revisions(env: Any) -> None:
    client, _server, auth = env
    agent = await create_agent(client, auth, name="Presentation writer")
    base = f"/api/agents/{agent}/presentations"
    response = await client.post(
        base,
        headers=auth,
        json={"title": "Product brief", "brief": "Explain our project", "page_count": 3},
    )
    assert response.status_code == 201, response.text
    deck = response.json()
    assert deck["slides"] == []
    assert deck["page_count"] == 3
    assert (await client.get(base, headers=auth)).json()[0]["deck_id"] == deck["deck_id"]
    endpoint = f"{base}/{deck['deck_id']}"
    saved = await client.put(
        endpoint,
        headers=auth,
        json={
            "revision": deck["revision"],
            "title": "Updated",
            "brief": "Explain our project",
            "slides": [{"slide_id": "page1", "title": "The problem", "body": "Details"}],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["title"] == "Updated"
    stale = await client.put(
        endpoint,
        headers=auth,
        json={"revision": deck["revision"], "title": "Old edit", "slides": []},
    )
    assert stale.status_code == 409
    assert (await client.get(endpoint, headers=auth)).json()["title"] == "Updated"
    assert (await client.get(f"{endpoint}/download", headers=auth)).status_code == 409


async def test_pre_deck_chat_log_is_authenticated_and_available(env: Any) -> None:
    client, _server, auth = env
    agent = await create_agent(client, auth, name="PPT chat continuity")
    base = f"/api/agents/{agent}/presentations"
    assert (await client.get(f"{base}/chat")).status_code == 401
    response = await client.get(f"{base}/chat", headers=auth)
    assert response.status_code == 200, response.text
    assert response.json() == {"messages": []}


async def test_presentations_require_authentication_and_ownership(env: Any) -> None:
    client, _server, admin = env
    alice = await create_user(client, admin, username="ppt_alice")
    bob = await create_user(client, admin, username="ppt_bob")
    agent = await create_agent(client, alice, name="Alice presentations")
    base = f"/api/agents/{agent}/presentations"
    assert (await client.get(base)).status_code == 401
    assert (await client.get(base, headers=bob)).status_code == 403
    created = await client.post(
        base, headers=alice, json={"title": "Private", "brief": "Confidential"}
    )
    assert created.status_code == 201, created.text
    deck_id = created.json()["deck_id"]
    assert (await client.get(f"{base}/{deck_id}", headers=bob)).status_code == 403
    assert (await client.get(f"{base}/{deck_id}/download", headers=bob)).status_code == 403
    bob_agent = await create_agent(client, bob, name="Bob presentations")
    assert (
        await client.get(f"/api/agents/{bob_agent}/presentations/{deck_id}", headers=bob)
    ).status_code == 404


async def test_presentations_validate_input_and_document_api(env: Any) -> None:
    client, _server, auth = env
    agent = await create_agent(client, auth, name="PPT validation")
    base = f"/api/agents/{agent}/presentations"
    for body in (
        {"title": " "},
        {"title": "a", "page_count": 21},
        {"title": "a", "brief": "a" * 12001},
    ):
        assert (await client.post(base, headers=auth, json=body)).status_code == 422
    runtime = await client.get(f"{base}/runtime", headers=auth)
    assert runtime.status_code == 200
    assert isinstance(runtime.json()["installed"], bool)
    from octop.api.app import build_app

    schema = build_app(_server).openapi()
    entry = schema["paths"]["/api/agents/{agent_id}/presentations/{deck_id}/jobs"]["post"]
    assert entry["summary"]
    assert entry["requestBody"]["content"]["application/json"]["schema"]
