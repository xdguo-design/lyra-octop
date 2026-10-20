from __future__ import annotations

from typing import Any


async def test_mobile_device_required_detail_uses_request_locale(env: Any) -> None:
    client, _server, auth = env
    response = await client.get(
        "/api/mobile/devices/%20/info",
        headers={**auth, "Accept-Language": "zh-CN"},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "必须提供设备标识。"}


async def test_mobile_device_required_when_enabling_uses_request_locale(env: Any) -> None:
    client, _server, auth = env
    response = await client.put(
        "/api/mobile/agent-control",
        headers={**auth, "Accept-Language": "zh-CN"},
        json={"enabled": True},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "启用移动设备控制时必须提供设备标识。"}


async def test_mobile_device_not_connected_detail_uses_request_locale(
    env: Any, monkeypatch: Any
) -> None:
    from octop.api.routers.mobile import status

    client, _server, auth = env
    monkeypatch.setattr(status, "device_info", lambda _device: {})
    monkeypatch.setattr(status, "list_devices", lambda: [])

    response = await client.get(
        "/api/mobile/devices/test-serial/info",
        headers={**auth, "Accept-Language": "zh-CN"},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "ADB 设备未连接：test-serial"}
