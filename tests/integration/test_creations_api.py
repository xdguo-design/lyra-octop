from __future__ import annotations

from typing import Any

from tests.support.auth import create_user


async def test_creation_items_and_folder_delete_preserve_items(
    env: Any,
) -> None:
    client, _server, admin_auth = env
    folder = (
        await client.post(
            "/api/creations/folders",
            headers=admin_auth,
            json={"name": "计划"},
        )
    ).json()
    platform = await client.post(
        "/api/creations/items",
        headers=admin_auth,
        json={
            "kind": "platform",
            "name": "学习平台",
            "description": "待建设",
            "folder_id": folder["folder_id"],
        },
    )
    assert platform.status_code == 201
    service = await client.post(
        "/api/creations/items",
        headers=admin_auth,
        json={
            "kind": "service",
            "name": "文档站",
            "url": "https://docs.example.test",
            "folder_id": folder["folder_id"],
        },
    )
    assert service.status_code == 201
    app_folder = await client.put(
        "/api/creations/cards/app/planet/folder",
        headers=admin_auth,
        json={"folder_id": folder["folder_id"]},
    )
    assert app_folder.status_code == 200
    before = (await client.get("/api/creations", headers=admin_auth)).json()
    assert {item["folder_id"] for item in before["items"]} == {folder["folder_id"]}
    assert before["card_folders"] == {"app:planet": folder["folder_id"]}

    deleted = await client.delete(
        f"/api/creations/folders/{folder['folder_id']}", headers=admin_auth
    )
    assert deleted.status_code == 204
    after = (await client.get("/api/creations", headers=admin_auth)).json()
    assert all(item["folder_id"] is None for item in after["items"])
    assert after["folders"] == []
    assert after["card_folders"] == {}


async def test_creation_data_is_account_scoped_and_service_urls_are_validated(
    env: Any,
) -> None:
    client, _server, admin_auth = env
    folder = (
        await client.post(
            "/api/creations/folders",
            headers=admin_auth,
            json={"name": "Private"},
        )
    ).json()
    entry = await client.post(
        "/api/creations/items",
        headers=admin_auth,
        json={"kind": "platform", "name": "Private plan"},
    )
    assert entry.status_code == 201
    other_auth = await create_user(client, admin_auth, username="other")
    other_index = (await client.get("/api/creations", headers=other_auth)).json()
    assert other_index == {"folders": [], "items": [], "card_folders": {}}
    assert (
        await client.patch(
            f"/api/creations/folders/{folder['folder_id']}",
            headers=other_auth,
            json={"name": "stolen"},
        )
    ).status_code == 404
    assert (
        await client.post(
            "/api/creations/items",
            headers=other_auth,
            json={
                "kind": "platform",
                "name": "Cross-account folder",
                "folder_id": folder["folder_id"],
            },
        )
    ).status_code == 404
    assert (
        await client.post(
            "/api/creations/items",
            headers=admin_auth,
            json={
                "kind": "service",
                "name": "Bad URL",
                "url": "javascript:alert(1)",
            },
        )
    ).status_code == 422
