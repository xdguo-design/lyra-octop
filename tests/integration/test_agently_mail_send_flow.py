"""Agent Mail automated gateway send-flow contract (fake upstream, no credentials)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from octop.infra.connectors.gateway.adapters import agently_cli
from octop.infra.connectors.gateway.protocol import handle_mcp_request


def _call(
    creds: dict[str, Any],
    method: str,
    *,
    name: str = "",
    args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    params = {"name": name, "arguments": args or {}} if method == "tools/call" else {}
    return handle_mcp_request(
        kind="agently-cli",
        creds=creds,
        body={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
    )


def _data(response: dict[str, Any]) -> dict[str, Any]:
    assert response["result"]["isError"] is False
    text = response["result"]["content"][0]["text"]
    return json.loads(text)["result"]["data"]


@pytest.fixture
def gateway(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> list[list[str]]:
    """Record exact CLI commands while keeping the upstream provider mocked."""
    monkeypatch.setenv("OCTOP_HOME", str(tmp_path))
    monkeypatch.setattr(agently_cli, "resolve_binary", lambda _: "agently-cli")
    calls: list[list[str]] = []

    def fake_cli(argv: list[str], **_kwargs: Any) -> str:
        calls.append(list(argv))
        if argv[-1] == "--dry-run":
            return json.dumps({"description": "preview", "calls": []})
        if argv[1:3] == ["message", "+send"]:
            return json.dumps({"ok": True, "data": {"queued": True, "message_id": "mock-mail-001"}})
        raise AssertionError(f"unexpected command: {argv}")

    monkeypatch.setattr(agently_cli, "run_cli", fake_cli)
    return calls


def test_agent_mail_gateway_send_after_confirmation_only(gateway: list[list[str]]) -> None:
    """MCP tools/list -> preview -> confirmation -> provider CLI exactly once."""
    creds = {"instance_id": "test-mail-instance"}
    available = _call(creds, "tools/list")["result"]["tools"]
    assert "agently_send" in {tool["name"] for tool in available}

    args = {
        "to": "xdguo0527@gmail.com",
        "subject": "Lyra Agent Mail simulated automated send",
        "body": "This checks the Lyra gateway only; no real email is sent.",
    }
    preview = _data(_call(creds, "tools/call", name="agently_send", args=args))
    assert preview["confirmation_required"] is True
    assert preview["summary"]["to"] == ["xdguo0527@gmail.com"]
    token = preview["confirmation_token"]
    assert len(gateway) == 1
    assert gateway[0][-1] == "--dry-run"

    confirmed = _data(
        _call(creds, "tools/call", name="agently_send", args={**args, "confirmation_token": token})
    )
    assert confirmed == {"queued": True, "message_id": "mock-mail-001"}
    assert len(gateway) == 2
    assert gateway[1][1:3] == ["message", "+send"]
    assert "--to=xdguo0527@gmail.com" in gateway[1]
    assert gateway[1][-1] != "--dry-run"

    replay = _call(
        creds, "tools/call", name="agently_send", args={**args, "confirmation_token": token}
    )
    assert replay["result"]["isError"] is True
    assert len(gateway) == 2


def test_mail_confirmation_is_bound_to_original_recipient(gateway: list[list[str]]) -> None:
    creds = {"instance_id": "mail-one"}
    args = {"to": "xdguo0527@gmail.com", "subject": "Bound send", "body": "Test"}
    token = _data(_call(creds, "tools/call", name="agently_send", args=args))["confirmation_token"]
    changed = _call(
        creds,
        "tools/call",
        name="agently_send",
        args={**args, "to": "other@example.com", "confirmation_token": token},
    )
    assert changed["result"]["isError"] is True
    assert len(gateway) == 1
    success = _data(
        _call(creds, "tools/call", name="agently_send", args={**args, "confirmation_token": token})
    )
    assert success["queued"] is True
    assert len(gateway) == 2


def test_unattended_mail_send_is_explicitly_blocked(gateway: list[list[str]]) -> None:
    creds = {"instance_id": "background"}
    args = {"to": "xdguo0527@gmail.com", "subject": "Should not send", "body": "Test"}
    with agently_cli.write_scope(allowed=False):
        response = _call(creds, "tools/call", name="agently_send", args=args)
    assert response["result"]["isError"] is True
    assert gateway == []
