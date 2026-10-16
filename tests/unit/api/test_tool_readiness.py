"""Readiness status is based on the effective turn, not model assertions."""

from __future__ import annotations

from octop.api.routers.agent_tools import describe_connector_readiness


def instances() -> list[dict[str, object]]:
    return [
        {
            "mcp_server_name": "qq-mail__one",
            "kind": "qq-mail",
            "status": "active",
            "has_credentials": True,
        },
        {
            "mcp_server_name": "github__two",
            "kind": "custom-mcp",
            "status": "active",
            "has_credentials": True,
        },
        {
            "mcp_server_name": "agently-cli__three",
            "kind": "agently-cli",
            "status": "disabled",
            "has_credentials": False,
        },
    ]


def test_tools_report_registration_without_claiming_provider_success() -> None:
    items = describe_connector_readiness(
        selected=["qq-mail__one", "github__two"],
        mode="craft",
        instances=instances(),
        loaded_tools={"qq-mail__one_send_email", "github__two_search_repositories"},
    )
    assert [item.status for item in items] == ["registered", "registered", "not_selected"]
    assert items[0].tools == ["qq-mail__one_send_email"]
    assert items[1].provider_verified is False


def test_mode_prevents_execution_even_when_tools_are_loaded() -> None:
    items = describe_connector_readiness(
        selected=["qq-mail__one"],
        mode="ask",
        instances=instances(),
        loaded_tools={"qq-mail__one_send_email"},
    )
    assert items[0].status == "mode_blocked"
    assert items[0].tools == []


def test_missing_and_disabled_are_distinct() -> None:
    items = describe_connector_readiness(
        selected=["missing", "agently-cli__three", "github__two"],
        mode="craft",
        instances=instances(),
        loaded_tools=set(),
    )
    assert [item.status for item in items[:3]] == [
        "not_configured",
        "authorization_required",
        "not_loaded",
    ]
