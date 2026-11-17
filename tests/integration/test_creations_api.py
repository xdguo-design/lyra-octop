from __future__ import annotations

from typing import Any

import pytest

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
    assert other_index == {
        "folders": [],
        "items": [],
        "card_folders": {},
        "card_meta": {},
    }
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


async def test_builtin_app_can_bind_and_pull_cnb_repository(env: Any) -> None:
    client, server, admin_auth = env
    repository_url = "https://cnb.cool/group/subgroup/admission-registration"
    bound = await client.put(
        "/api/creations/cards/app/admission-registration/meta",
        headers=admin_auth,
        json={
            "name": "智能入院登记",
            "description": "Vue 原型演示",
            "category": "applet",
            "repository_url": repository_url,
            "repository_branch": "dev",
        },
    )
    assert bound.status_code == 200
    assert bound.json()["repository_url"] == repository_url
    assert bound.json()["repository_branch"] == "dev"
    index = await client.get("/api/creations", headers=admin_auth)
    assert index.json()["card_meta"]["app:admission-registration"]["repository_url"] == (
        repository_url
    )
    assert index.json()["card_meta"]["app:admission-registration"]["repository_branch"] == "dev"

    connector = await client.post(
        "/api/connector-instances",
        headers=admin_auth,
        json={
            "kind": "cnb",
            "display_name": "CNB",
            "credentials": {"token": "repo-read-token"},
        },
    )
    assert connector.status_code == 201

    class ManagerStub:
        call: tuple[str, str, str | None, bool, str | None] | None = None

        async def update(
            self,
            url: str,
            project_id: str,
            *,
            access_token: str | None = None,
            source_only: bool = False,
            repository_branch: str | None = None,
        ) -> None:
            self.call = (url, project_id, access_token, source_only, repository_branch)

        async def close(self) -> None:
            return None

    manager = ManagerStub()
    server.project_service_manager = manager
    result = await client.post(
        "/api/creations/cards/app/admission-registration/update", headers=admin_auth
    )
    assert result.status_code == 200
    assert result.json() == {"updated": True}
    assert manager.call is not None
    assert manager.call[0] == repository_url
    assert manager.call[1].startswith("app:")
    assert manager.call[1].endswith(":admission-registration")
    assert manager.call[2:] == ("repo-read-token", True, "dev")

    invalid = await client.put(
        "/api/creations/cards/app/admission-registration/meta",
        headers=admin_auth,
        json={"repository_url": "https://evil.example/repo"},
    )
    assert invalid.status_code == 422
    invalid_branch = await client.put(
        "/api/creations/cards/app/admission-registration/meta",
        headers=admin_auth,
        json={"repository_url": repository_url, "repository_branch": "--upload-pack=evil"},
    )
    assert invalid_branch.status_code == 422


async def test_trusted_project_launch_requires_admin_and_owned_profile(
    env: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, server, admin_auth = env
    repo_url = "https://github.com/xdguo-design/data-upload-product"
    cnb_url = "https://cnb.cool/group/private-project"
    connector = await client.post(
        "/api/connector-instances",
        headers=admin_auth,
        json={
            "kind": "cnb",
            "display_name": "CNB",
            "credentials": {"token": "repo-read-token"},
        },
    )
    assert connector.status_code == 201
    cnb_item = (
        await client.post(
            "/api/creations/items",
            headers=admin_auth,
            json={"kind": "service", "name": "CNB 项目", "url": cnb_url},
        )
    ).json()
    item = (
        await client.post(
            "/api/creations/items",
            headers=admin_auth,
            json={"kind": "service", "name": "数据转换平台", "url": repo_url},
        )
    ).json()

    class ManagerStub:
        running = {"status": "running", "url": "http://127.0.0.1:49152", "logs": None}

        def __init__(self) -> None:
            self.tokens: list[str | None] = []

        def has_profile(self, url: str) -> bool:
            return url in {repo_url, cnb_url}

        def status(self, url: str, _item_id: str | None = None) -> dict[str, str | None]:
            return self.running

        def thumbnail_origins(self, _url: str, _item_id: str | None = None) -> tuple[str, ...]:
            return ("http://127.0.0.1:49152", "http://127.0.0.1:49153")

        async def start(
            self,
            _url: str,
            _item_id: str | None = None,
            *,
            access_token: str | None = None,
        ) -> dict[str, str | None]:
            self.tokens.append(access_token)
            return self.running

        async def stop(self, _url: str, _item_id: str | None = None) -> dict[str, str | None]:
            self.running = {"status": "stopped", "url": None, "logs": None}
            return self.running

        async def update(
            self, _url: str, _item_id: str, *, access_token: str | None = None
        ) -> None:
            self.tokens.append(access_token)

        async def close(self) -> None:
            return None

    manager = ManagerStub()
    server.project_service_manager = manager

    async def capture(_url: str, _origins: tuple[str, ...], _destination: Any) -> bool:
        return False

    monkeypatch.setattr("octop.api.routers.creations.capture_trusted_local_thumbnail", capture)

    assert (
        await client.get(f"/api/creations/items/{item['item_id']}/launch", headers=admin_auth)
    ).json()["status"] == "running"
    assert (
        await client.post(f"/api/creations/items/{item['item_id']}/launch", headers=admin_auth)
    ).json()["url"] == "http://127.0.0.1:49152"
    assert (
        await client.delete(f"/api/creations/items/{item['item_id']}/launch", headers=admin_auth)
    ).json()["status"] == "stopped"
    assert (
        await client.post(f"/api/creations/items/{item['item_id']}/update", headers=admin_auth)
    ).json() == {"updated": True}
    assert (
        await client.post(f"/api/creations/items/{cnb_item['item_id']}/launch", headers=admin_auth)
    ).status_code == 200
    assert (
        await client.post(f"/api/creations/items/{cnb_item['item_id']}/update", headers=admin_auth)
    ).json() == {"updated": True}
    assert manager.tokens == [None, None, "repo-read-token", "repo-read-token"]

    user_auth = await create_user(client, admin_auth, username="launch-user")
    assert (
        await client.post(f"/api/creations/items/{item['item_id']}/launch", headers=user_auth)
    ).status_code == 403

    other_item = (
        await client.post(
            "/api/creations/items",
            headers=user_auth,
            json={"kind": "service", "name": "私有项目", "url": repo_url},
        )
    ).json()
    assert (
        await client.post(f"/api/creations/items/{other_item['item_id']}/launch", headers=user_auth)
    ).status_code == 403
    assert (
        await client.post(f"/api/creations/items/{other_item['item_id']}/update", headers=user_auth)
    ).status_code == 403

    unknown = (
        await client.post(
            "/api/creations/items",
            headers=admin_auth,
            json={"kind": "service", "name": "其他仓库", "url": "https://github.com/example/other"},
        )
    ).json()
    assert (
        await client.post(f"/api/creations/items/{unknown['item_id']}/launch", headers=admin_auth)
    ).status_code == 404


async def test_repository_download_and_install_jobs(env: Any) -> None:
    client, server, admin_auth = env
    repo_url = "https://github.com/xdguo-design/data-upload-product"
    item = (
        await client.post(
            "/api/creations/items",
            headers=admin_auth,
            json={"kind": "service", "name": "数据转换平台", "url": repo_url},
        )
    ).json()
    platform = (
        await client.post(
            "/api/creations/items",
            headers=admin_auth,
            json={"kind": "platform", "name": "计划中的平台"},
        )
    ).json()

    class ManagerStub:
        def __init__(self) -> None:
            self.download_tokens: list[str | None] = []
            self.install_tokens: list[str | None] = []
            self.stopped: list[str] = []

        def has_profile(self, url: str) -> bool:
            return url == repo_url

        def download_status(
            self, _url: str, _item_id: str | None = None
        ) -> dict[str, str | int | None]:
            return {
                "status": "running",
                "percent": 42,
                "message": "正在下载代码",
                "logs": None,
            }

        async def start_download(
            self,
            _url: str,
            _item_id: str | None = None,
            *,
            access_token: str | None = None,
            branch: str | None = None,
        ) -> dict[str, str | int | None]:
            self.download_tokens.append(access_token)
            return {
                "status": "running",
                "percent": 0,
                "message": "正在连接仓库",
                "logs": None,
            }

        async def cancel_download(
            self, _url: str, _item_id: str | None = None
        ) -> dict[str, str | int | None]:
            return {
                "status": "cancelled",
                "percent": 12,
                "message": "已取消下载",
                "logs": None,
            }

        def deploy_status(
            self, _url: str, _item_id: str | None = None
        ) -> dict[str, str | int | None]:
            return {
                "status": "done",
                "percent": 100,
                "message": "安装完成",
                "logs": None,
                "url": "http://127.0.0.1:4010",
                "kind": "node",
            }

        async def start_deploy(
            self,
            _url: str,
            _item_id: str | None = None,
            *,
            access_token: str | None = None,
            branch: str | None = None,
        ) -> dict[str, str | int | None]:
            self.install_tokens.append(access_token)
            return {
                "status": "running",
                "percent": 2,
                "message": "准备代码",
                "logs": None,
                "url": None,
                "kind": None,
            }

        async def stop(self, _url: str, item_id: str | None = None) -> dict[str, str | None]:
            self.stopped.append(item_id or "")
            return {"status": "stopped", "url": None, "logs": None}

        async def close(self) -> None:
            return None

    manager = ManagerStub()
    server.project_service_manager = manager
    item_path = f"/api/creations/items/{item['item_id']}"

    downloaded = await client.get(f"{item_path}/download", headers=admin_auth)
    assert downloaded.status_code == 200
    assert downloaded.json()["percent"] == 42

    assert (await client.post(f"{item_path}/download", headers=admin_auth)).json()[
        "status"
    ] == "running"
    assert manager.download_tokens == [None]

    connector = await client.post(
        "/api/connector-instances",
        headers=admin_auth,
        json={
            "kind": "github",
            "display_name": "GitHub",
            "credentials": {"token": "ghp_read_only"},
        },
    )
    assert connector.status_code == 201
    assert (await client.post(f"{item_path}/download", headers=admin_auth)).status_code == 200
    assert manager.download_tokens == [None, "ghp_read_only"]

    cancelled = await client.delete(f"{item_path}/download", headers=admin_auth)
    assert cancelled.json()["status"] == "cancelled"

    installed = await client.get(f"{item_path}/install", headers=admin_auth)
    assert installed.json()["url"] == "http://127.0.0.1:4010"
    assert installed.json()["kind"] == "node"
    assert (await client.post(f"{item_path}/install", headers=admin_auth)).json()["status"] == (
        "running"
    )
    assert manager.install_tokens == ["ghp_read_only"]
    assert (await client.delete(f"{item_path}/install", headers=admin_auth)).status_code == 200
    assert manager.stopped == [item["item_id"]]

    platform_path = f"/api/creations/items/{platform['item_id']}"
    assert (await client.get(f"{platform_path}/download", headers=admin_auth)).status_code == 404
    assert (await client.post(f"{platform_path}/install", headers=admin_auth)).status_code == 404

    user_auth = await create_user(client, admin_auth, username="repo-user")
    assert (await client.post(f"{item_path}/download", headers=user_auth)).status_code == 403
    assert (await client.post(f"{item_path}/install", headers=user_auth)).status_code == 403


async def test_repository_lookup_normalizes_cnb_urls_without_network(env: Any) -> None:
    client, _server, admin_auth = env
    found = await client.post(
        "/api/creations/repositories/lookup",
        headers=admin_auth,
        json={"url": "https://cnb.cool/group/subgroup/octop.git"},
    )
    assert found.status_code == 200
    assert found.json() == {
        "url": "https://cnb.cool/group/subgroup/octop",
        "name": "octop",
        "description": None,
        "default_branch": None,
        "language": None,
        "stars": None,
    }
    invalid = await client.post(
        "/api/creations/repositories/lookup",
        headers=admin_auth,
        json={"url": "https://gitlab.com/group/repo"},
    )
    assert invalid.status_code == 422
