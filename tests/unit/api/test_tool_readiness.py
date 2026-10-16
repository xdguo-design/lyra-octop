"""Readiness status is based on the effective turn, not model assertions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from octop.api.routers.agent_tools import (
    describe_connector_readiness,
    prepare_selected_connector_readiness,
)


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


@pytest.mark.asyncio
async def test_readiness_preloads_selected_active_agent_mail() -> None:
    """A selected Agent Mail must be loaded before testing tool presence."""
    registry = MagicMock()
    registry.prepare_chat_mcp = AsyncMock(return_value=[])
    rows = instances()
    rows[2]["status"] = "active"
    rows[2]["has_credentials"] = True

    await prepare_selected_connector_readiness(
        registry=registry,
        agent_id="agent-1",
        user_id=9,
        selected=["agently-cli__three", "agently-cli__three", "github__two", "missing"],
        instances=rows,
        mode="craft",
    )
    registry.prepare_chat_mcp.assert_awaited_once_with(
        "agent-1", ["agently-cli__three", "github__two"], connector_user_id=9
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["ask", "plan"])
async def test_readiness_does_not_load_tools_in_non_execution_modes(mode: str) -> None:
    registry = MagicMock()
    registry.prepare_chat_mcp = AsyncMock()
    await prepare_selected_connector_readiness(
        registry=registry,
        agent_id="agent-1",
        user_id=9,
        selected=["qq-mail__one"],
        instances=instances(),
        mode=mode,
    )
    registry.prepare_chat_mcp.assert_not_awaited()


@pytest.mark.asyncio
async def test_readiness_does_not_load_unselected_or_unauthorized_mail() -> None:
    registry = MagicMock()
    registry.prepare_chat_mcp = AsyncMock()
    await prepare_selected_connector_readiness(
        registry=registry,
        agent_id="agent-1",
        user_id=9,
        selected=["agently-cli__three", "not-installed"],
        instances=instances(),
        mode="craft",
    )
    registry.prepare_chat_mcp.assert_not_awaited()


@pytest.mark.asyncio
async def test_readiness_load_error_does_not_fake_registration(
    caplog: pytest.LogCaptureFixture,
) -> None:
    registry = MagicMock()
    registry.prepare_chat_mcp = AsyncMock(side_effect=RuntimeError("temporary load failure"))
    await prepare_selected_connector_readiness(
        registry=registry,
        agent_id="agent-1",
        user_id=9,
        selected=["qq-mail__one"],
        instances=instances(),
        mode="craft",
    )
    assert "tool readiness preflight failed" in caplog.text
    items = describe_connector_readiness(
        selected=["qq-mail__one"],
        mode="craft",
        instances=instances(),
        loaded_tools=set(),
    )
    assert items[0].status == "not_loaded"
    assert items[0].provider_verified is False
