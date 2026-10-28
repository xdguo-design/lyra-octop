"""Unit tests for agent idle auto-stop and on-demand start (``_ensure_running``)."""

from __future__ import annotations

import json
import time
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from octop.config import OctopConfig
from octop.infra.agents.manager import AgentManager
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRow
from octop.infra.db.services import build_shared_services
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.utils.paths import PathLayout


@pytest.fixture
def manager(tmp_path: Path) -> AgentManager:
    paths = PathLayout(tmp_path / ".octop")
    paths.ensure_root()
    db = SqlitePool(paths.db)
    run_migrations(db)
    services = build_shared_services(db=db, paths=paths, config=OctopConfig())
    return AgentManager(repos=services.repos, paths=services.paths)


def _running_row(
    agent_id: str = "01IDLEAGENT",
    config_json: str | None = None,
) -> AgentRow:
    return AgentRow(
        id=1,
        agent_id=agent_id,
        user_id=1,
        name="bot",
        description=None,
        persona_mbti=None,
        default_model=None,
        system_prompt=None,
        enabled=1,
        config_json=config_json,
        last_state="running",
        last_error=None,
        created_at=0,
        updated_at=0,
    )


def _wire_loaded(
    manager: AgentManager,
    row: AgentRow,
    *,
    monkeypatch: pytest.MonkeyPatch,
    idle_seconds: float | None,
) -> AsyncMock:
    """Pretend the harness has *row* loaded and stub out ``stop``."""
    monkeypatch.setattr(manager, "_octop_harness_or_none", lambda _aid: object())
    monkeypatch.setattr(manager._repos.agent_repo, "list_all", lambda **_kw: [row])
    stop_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(manager, "stop", stop_mock)
    if idle_seconds is not None:
        manager._last_activity[row.agent_id] = time.monotonic() - idle_seconds
    return stop_mock


async def test_sweep_disabled_by_default(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    row = _running_row()
    stop_mock = _wire_loaded(manager, row, monkeypatch=monkeypatch, idle_seconds=10_000)
    await manager._sweep_idle_agents()
    stop_mock.assert_not_awaited()


async def test_sweep_stops_idle_agent_and_writes_audit(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager._config = replace(manager._config, agent_idle_stop_minutes=30)
    row = _running_row()
    stop_mock = _wire_loaded(manager, row, monkeypatch=monkeypatch, idle_seconds=31 * 60)
    audit_mock = MagicMock()
    monkeypatch.setattr(manager._repos.audit_repo, "write", audit_mock)
    await manager._sweep_idle_agents()
    stop_mock.assert_awaited_once_with(row.agent_id)
    audit_mock.assert_called_once()
    assert audit_mock.call_args.kwargs["action"] == "agent.idle_stop"


async def test_sweep_keeps_recently_active_agent(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager._config = replace(manager._config, agent_idle_stop_minutes=30)
    row = _running_row()
    stop_mock = _wire_loaded(manager, row, monkeypatch=monkeypatch, idle_seconds=60)
    await manager._sweep_idle_agents()
    stop_mock.assert_not_awaited()


async def test_sweep_spares_agent_mid_invocation(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager._config = replace(manager._config, agent_idle_stop_minutes=30)
    row = _running_row()
    stop_mock = _wire_loaded(manager, row, monkeypatch=monkeypatch, idle_seconds=31 * 60)
    manager._active_invocations[row.agent_id] = 1
    await manager._sweep_idle_agents()
    stop_mock.assert_not_awaited()


async def test_per_agent_override_zero_disables_stop(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager._config = replace(manager._config, agent_idle_stop_minutes=30)
    row = _running_row(config_json=json.dumps({"idle_stop_minutes": 0}))
    stop_mock = _wire_loaded(manager, row, monkeypatch=monkeypatch, idle_seconds=10_000)
    await manager._sweep_idle_agents()
    stop_mock.assert_not_awaited()


async def test_per_agent_override_shorter_limit(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    manager._config = replace(manager._config, agent_idle_stop_minutes=30)
    row = _running_row(config_json=json.dumps({"idle_stop_minutes": 5}))
    stop_mock = _wire_loaded(manager, row, monkeypatch=monkeypatch, idle_seconds=6 * 60)
    await manager._sweep_idle_agents()
    stop_mock.assert_awaited_once_with(row.agent_id)


async def test_ensure_running_starts_stopped_agent(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    loaded = {"v": False}

    def fake_loaded(_aid: str) -> object | None:
        return object() if loaded["v"] else None

    monkeypatch.setattr(manager, "_octop_harness_or_none", fake_loaded)
    start_mock = AsyncMock(return_value=None)

    async def mark_loaded(agent_id: str) -> None:
        loaded["v"] = True

    start_mock.side_effect = mark_loaded
    monkeypatch.setattr(manager, "start", start_mock)

    await manager._ensure_running("01LAZYAGENT")
    start_mock.assert_awaited_once_with("01LAZYAGENT")
    assert "01LAZYAGENT" in manager._last_activity


async def test_ensure_running_raises_when_start_does_not_load_agent(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    agent_id = "01LAZYAGENT"
    monkeypatch.setattr(manager, "_octop_harness_or_none", lambda _aid: None)
    monkeypatch.setattr(manager, "start", AsyncMock(return_value=None))
    monkeypatch.setattr(
        manager,
        "get_row",
        lambda _aid: replace(_running_row(agent_id), last_state="failed"),
    )

    with pytest.raises(OctopError) as exc_info:
        await manager._ensure_running(agent_id)

    assert exc_info.value.code is ErrorCode.AGENT_FAILED


async def test_ensure_running_noop_when_loaded(
    manager: AgentManager, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(manager, "_octop_harness_or_none", lambda _aid: object())
    start_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(manager, "start", start_mock)

    await manager._ensure_running("01LAZYAGENT")
    start_mock.assert_not_awaited()
    assert "01LAZYAGENT" in manager._last_activity


async def test_invocation_updates_activity_clock(manager: AgentManager) -> None:
    manager._last_activity["01BUSYAGENT"] = time.monotonic() - 999
    async with manager._track_invocation("01BUSYAGENT"):
        mid = manager._last_activity["01BUSYAGENT"]
        assert mid > time.monotonic() - 60
    assert manager._last_activity["01BUSYAGENT"] >= mid
