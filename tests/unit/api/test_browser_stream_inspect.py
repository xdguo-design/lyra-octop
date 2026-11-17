"""Browser WebSocket stream must resolve the page element under a pick click."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from octop.api.routers.browser import stream as stream_mod

_ELEMENT: dict[str, Any] = {
    "tag": "button",
    "label": "button#submit.primary",
    "id": "submit",
    "classes": ["primary"],
    "role": "",
    "type": "submit",
    "name": "",
    "placeholder": "",
    "text": "提交订单",
    "selector": "form.checkout > button.primary",
    "rect": {"x": 10, "y": 20, "width": 120, "height": 32},
    "styles": {"color": "rgb(0, 0, 0)"},
    "attrs": {"type": "submit"},
    "url": "https://shop.example.com/cart",
    "title": "购物车",
    "viewport": {"width": 1280, "height": 800},
}


def _fake_sess(value: Any = _ELEMENT) -> SimpleNamespace:
    client = SimpleNamespace(
        send=AsyncMock(return_value={"result": {"value": value}}),
    )
    return SimpleNamespace(
        click=AsyncMock(),
        scroll=AsyncMock(),
        type=AsyncMock(),
        _internal=SimpleNamespace(client=client),
    )


@pytest.mark.asyncio
async def test_inspect_returns_element_and_forwards_coordinates() -> None:
    sess = _fake_sess()
    send_json = AsyncMock()

    await stream_mod._handle_client_event(
        sess,
        {"type": "inspect", "x": 10, "y": 20, "request_id": "pick-1"},
        send_json=send_json,
    )

    method, params = sess._internal.client.send.await_args.args
    assert method == "Runtime.evaluate"
    assert params["returnByValue"] is True
    assert "document.elementFromPoint" in params["expression"]
    assert "const x = 10;" in params["expression"]
    assert "const y = 20;" in params["expression"]

    payload = send_json.await_args.args[0]
    assert payload["type"] == "element_inspected"
    assert payload["request_id"] == "pick-1"
    assert payload["element"] == _ELEMENT
    assert payload["error"] is None


@pytest.mark.asyncio
async def test_inspect_reports_not_found_when_page_returns_nothing() -> None:
    sess = _fake_sess(value=None)
    send_json = AsyncMock()

    await stream_mod._handle_client_event(
        sess, {"type": "inspect", "x": 1, "y": 2}, send_json=send_json
    )

    payload = send_json.await_args.args[0]
    assert payload["element"] is None
    assert payload["error"] == "not_found"


@pytest.mark.asyncio
async def test_inspect_degrades_to_not_found_when_cdp_fails() -> None:
    sess = _fake_sess()
    sess._internal.client.send = AsyncMock(side_effect=RuntimeError("page gone"))
    send_json = AsyncMock()

    await stream_mod._handle_client_event(
        sess, {"type": "inspect", "x": 3, "y": 4}, send_json=send_json
    )

    payload = send_json.await_args.args[0]
    assert payload["element"] is None
    assert payload["error"] == "not_found"


@pytest.mark.asyncio
async def test_inspect_without_send_json_channel_still_evaluates() -> None:
    sess = _fake_sess()

    await stream_mod._handle_client_event(sess, {"type": "inspect", "x": 0, "y": 0})

    method, _params = sess._internal.client.send.await_args.args
    assert method == "Runtime.evaluate"
