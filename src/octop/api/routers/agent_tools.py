"""Per-agent tool settings — built-in denylist + plugin tool enable flags."""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from octop.api.common.agent import assert_agent_owner as _assert_agent_owner
from octop.api.deps import current_user, get_server
from octop.i18n.domains.tools import tool_display_name
from octop.infra.agents.plugins.plugin_tool_defaults import merge_plugins_tool_settings
from octop.infra.agents.settings.tool_catalog import (
    BUILTIN_TOOL_CATALOG,
    CRITICAL_TOOLS,
    agent_plugin_enabled,
    builtin_tool_available,
    normalize_tools_disabled,
)
from octop.infra.agents.teams import HOST_TOOLS_ALLOWED, is_team_agent
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.server import OctopServer
from octop.infra.utils.locale import resolve_request_locale

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


class ToolSettingsItem(BaseModel):
    name: str
    source: Literal["builtin", "plugin"]
    category: str
    label: str
    description: str | None = None
    enabled: bool
    disableable: bool
    available: bool = True
    plugin_id: str | None = None
    plugin_name: str | None = None
    plugin_icon: str | None = None


class ToolSettingsResponse(BaseModel):
    tools: list[ToolSettingsItem]


class ToolSettingsPutBody(BaseModel):
    disabled_builtin: list[str] = Field(
        default_factory=list,
        description="Built-in tool names to hide from the model (denylist).",
    )
    plugins: dict[str, dict[str, Any]] | None = Field(
        default=None,
        description=(
            "Optional plugin tools map (``enabled`` flags). Merged into "
            "``config.plugins`` without reloading the agent."
        ),
    )


class ToolSettingPatchBody(BaseModel):
    enabled: bool
    source: Literal["builtin", "plugin"] = "builtin"
    plugin_id: str | None = None


def _plugin_manager(server: OctopServer) -> Any:
    mgr = server.plugin_manager
    if mgr is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "plugin manager not initialized")
    return mgr


def _plugin_tool_label(
    name: str,
    locale: str,
    *,
    description: str | None = None,
) -> str:
    """Prefer i18n / original CJK name / short description over raw tool id."""
    labeled = tool_display_name(name, locale)
    if labeled != name:
        return labeled
    if description:
        from octop.infra.agents.plugins.plugin_tool_names import (  # noqa: PLC0415
            extract_original_plugin_label,
        )

        original = extract_original_plugin_label(description)
        if original:
            return original
        # Drop a leading ``[原名: …]`` if present, then take the first phrase.
        rest = description
        if rest.startswith("[原名:"):
            close = rest.find("]")
            if close >= 0:
                rest = rest[close + 1 :].strip()
        phrase = rest.split("，", 1)[0].split(",", 1)[0].split("。", 1)[0]
        phrase = phrase.split("!", 1)[0].split("?", 1)[0].split("\n", 1)[0].strip()
        if 2 <= len(phrase) <= 36:
            return phrase
    return name


def _list_plugin_tool_items(
    server: OctopServer,
    agent_cfg: dict[str, Any],
    *,
    locale: str,
) -> list[ToolSettingsItem]:
    """Plugin tools for Personalization → Tools → 插件工具 (and Experts)."""
    mgr = _plugin_manager(server)
    raw_plugins = agent_cfg.get("plugins")
    plugins_cfg: dict[str, Any] = raw_plugins if isinstance(raw_plugins, dict) else {}
    items: list[ToolSettingsItem] = []
    for plugin in mgr.list_installed():
        if plugin.get("error"):
            continue
        plugin_id = str(plugin["id"])
        plugin_name = str(plugin.get("name") or plugin_id).strip() or plugin_id
        raw_icon = plugin.get("icon")
        plugin_icon = (
            str(raw_icon).strip() if isinstance(raw_icon, str) and raw_icon.strip() else None
        )
        globally_on = plugin.get("enabled", True) is not False
        agent_on = agent_plugin_enabled(agent_cfg, plugin_id)
        for tool in plugin.get("tools") or []:
            name = str(tool["name"])
            tool_cfg: dict[str, Any] = {}
            plugin_entry = plugins_cfg.get(plugin_id)
            if isinstance(plugin_entry, dict):
                tools_map = plugin_entry.get("tools")
                if isinstance(tools_map, dict):
                    raw_tool = tools_map.get(name)
                    if isinstance(raw_tool, dict):
                        tool_cfg = raw_tool
            raw_desc = tool.get("description")
            desc = str(raw_desc).strip() if isinstance(raw_desc, str) and raw_desc.strip() else None
            enabled = bool(tool_cfg.get("enabled")) if tool_cfg and "enabled" in tool_cfg else True
            items.append(
                ToolSettingsItem(
                    name=name,
                    source="plugin",
                    category="plugin",
                    label=_plugin_tool_label(name, locale, description=desc),
                    description=desc,
                    enabled=enabled,
                    disableable=True,
                    available=globally_on and agent_on,
                    plugin_id=plugin_id,
                    plugin_name=plugin_name,
                    plugin_icon=plugin_icon,
                )
            )
    return items


@router.get(
    "/{agent_id}/tool-settings",
    summary="List built-in and plugin tools with enable state",
    response_model=ToolSettingsResponse,
)
async def get_tool_settings(
    agent_id: str,
    request: Request,
    server: OctopServer = Depends(get_server),
    user: Any = Depends(current_user),
) -> ToolSettingsResponse:
    assert server.app_runtime is not None
    row = server.app_runtime.agent_registry.get_row(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    _assert_agent_owner(row, user)

    locale = resolve_request_locale(request)
    agent_cfg = server.app_runtime.agent_registry.get_config(agent_id)
    disabled = set(normalize_tools_disabled(agent_cfg.get("tools_disabled")))
    mobile_enabled = bool(server.config is not None and server.config.capabilities.mobile.enabled)
    team_host = is_team_agent(row)

    tools: list[ToolSettingsItem] = []
    catalog = (
        tuple(entry for entry in BUILTIN_TOOL_CATALOG if entry.name in HOST_TOOLS_ALLOWED)
        if team_host
        else BUILTIN_TOOL_CATALOG
    )
    for entry in catalog:
        allowed = not team_host or entry.name in HOST_TOOLS_ALLOWED
        disableable = (not team_host) and entry.name not in CRITICAL_TOOLS
        tools.append(
            ToolSettingsItem(
                name=entry.name,
                source="builtin",
                category=entry.category,
                label=tool_display_name(entry.name, locale),
                description=None,
                enabled=allowed and (entry.name not in disabled if disableable else True),
                disableable=disableable,
                available=allowed
                and builtin_tool_available(
                    entry.name,
                    agent_cfg=agent_cfg,
                    mobile_enabled=mobile_enabled,
                ),
                plugin_id=None,
            )
        )
    tools.extend(_list_plugin_tool_items(server, agent_cfg, locale=locale))
    return ToolSettingsResponse(tools=tools)


@router.put(
    "/{agent_id}/tool-settings",
    summary="Update built-in tool denylist and optional plugin tool flags",
    response_model=ToolSettingsResponse,
)
async def put_tool_settings(
    agent_id: str,
    body: ToolSettingsPutBody,
    request: Request,
    server: OctopServer = Depends(get_server),
    user: Any = Depends(current_user),
) -> ToolSettingsResponse:
    assert server.app_runtime is not None
    row = server.app_runtime.agent_registry.get_row(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    _assert_agent_owner(row, user)

    if is_team_agent(row):
        raise HTTPException(
            status_code=400,
            detail="team host tools are fixed to member dispatch",
        )

    registry = server.app_runtime.agent_registry
    await registry.persist_tools_disabled(agent_id, set(body.disabled_builtin))

    if body.plugins is not None:
        cfg = registry.get_config(agent_id)
        merged = merge_plugins_tool_settings(cfg.get("plugins"), body.plugins)
        await registry.persist_plugin_tools_config(agent_id, merged)

    return await get_tool_settings(agent_id, request, server, user)


@router.patch(
    "/{agent_id}/tool-settings/{tool_name}",
    summary="Enable or disable a single built-in or plugin tool",
    response_model=ToolSettingsResponse,
)
async def patch_tool_setting(
    agent_id: str,
    tool_name: str,
    body: ToolSettingPatchBody,
    request: Request,
    server: OctopServer = Depends(get_server),
    user: Any = Depends(current_user),
) -> ToolSettingsResponse:
    assert server.app_runtime is not None
    row = server.app_runtime.agent_registry.get_row(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    _assert_agent_owner(row, user)

    name = tool_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="tool name is required")

    registry = server.app_runtime.agent_registry
    if is_team_agent(row):
        raise HTTPException(
            status_code=400,
            detail="team host tools are fixed to member dispatch",
        )
    if body.source == "builtin":
        if name in CRITICAL_TOOLS:
            raise HTTPException(
                status_code=400,
                detail=f"tool {name!r} cannot be disabled",
            )
        cfg = registry.get_config(agent_id)
        disabled = set(normalize_tools_disabled(cfg.get("tools_disabled")))
        if body.enabled:
            disabled.discard(name)
        else:
            disabled.add(name)
        await registry.persist_tools_disabled(agent_id, disabled)
    else:
        plugin_id = (body.plugin_id or "").strip()
        if not plugin_id:
            raise HTTPException(
                status_code=400,
                detail="plugin_id is required for plugin tools",
            )
        cfg = registry.get_config(agent_id)
        merged = merge_plugins_tool_settings(
            cfg.get("plugins"),
            {plugin_id: {"tools": {name: {"enabled": body.enabled}}}},
        )
        await registry.persist_plugin_tools_config(agent_id, merged)

    return await get_tool_settings(agent_id, request, server, user)


class ConnectorReadinessItem(BaseModel):
    name: str
    kind: str | None = None
    status: Literal[
        "not_configured",
        "not_selected",
        "authorization_required",
        "mode_blocked",
        "not_loaded",
        "registered",
    ]
    tools: list[str] = Field(default_factory=list)
    # Registration is NOT proof that the provider API call will succeed.
    provider_verified: bool = False


class ConnectorReadinessResponse(BaseModel):
    mode: Literal["ask", "plan", "craft"]
    connectors: list[ConnectorReadinessItem]


def describe_connector_readiness(
    *,
    selected: list[str],
    mode: str,
    instances: list[dict[str, Any]],
    loaded_tools: set[str],
) -> list[ConnectorReadinessItem]:
    """Pure preflight for email, GitHub MCP, and any other connector.

    Never infer permissions from the tool's label or the model's claims.
    """
    by_name = {str(item.get("mcp_server_name")): item for item in instances}
    output: list[ConnectorReadinessItem] = []
    for name in dict.fromkeys(selected):
        record = by_name.get(name)
        matches = sorted(tool for tool in loaded_tools if tool.startswith(name + "_"))
        if record is None:
            status = "not_configured"
        elif mode in ("ask", "plan"):
            status = "mode_blocked"
        elif record.get("status") != "active" or not record.get("has_credentials"):
            status = "authorization_required"
        elif not matches:
            status = "not_loaded"
        else:
            status = "registered"
        output.append(
            ConnectorReadinessItem(
                name=name,
                kind=str(record.get("kind")) if record else None,
                status=status,
                tools=matches if status == "registered" else [],
            )
        )
    # Configured but unselected integrations cannot be used in this turn.
    for name, record in by_name.items():
        if name not in selected:
            output.append(
                ConnectorReadinessItem(
                    name=name,
                    kind=str(record.get("kind") or ""),
                    status="not_selected",
                )
            )
    return output


async def prepare_selected_connector_readiness(
    *,
    registry: Any,
    agent_id: str,
    user_id: int,
    selected: list[str],
    instances: list[dict[str, Any]],
    mode: str,
) -> None:
    """Attempt registration before reporting a selected connector as missing.

    The normal chat path loads gateway tools on demand via prepare_chat_mcp.
    A read-only status lookup previously skipped that step, so a usable Agent
    Mail / Gmail / GitHub connector could be incorrectly shown as not_loaded.
    Only preflight explicitly effective, active, credentialed selections.
    This does not send mail or assert that the upstream provider is reachable.
    """
    if mode != "craft":
        return
    active = {
        str(item.get("mcp_server_name"))
        for item in instances
        if item.get("status") == "active" and item.get("has_credentials") is True
    }
    names = [name for name in dict.fromkeys(selected) if name in active]
    if not names:
        return
    try:
        await registry.prepare_chat_mcp(agent_id, names, connector_user_id=user_id)
    except Exception:
        # The final status will remain not_loaded if registration failed.
        # Do not report a successful provider operation merely from a preflight.
        logger.exception(
            "tool readiness preflight failed for agent=%s servers=%s",
            agent_id,
            names,
        )


@router.get(
    "/{agent_id}/tool-readiness",
    summary="Explain effective connector availability for this agent and turn",
    response_model=ConnectorReadinessResponse,
)
async def get_tool_readiness(
    agent_id: str,
    request: Request,
    mode: Literal["ask", "plan", "craft"] = "craft",
    server: OctopServer = Depends(get_server),
    user: Any = Depends(current_user),
) -> ConnectorReadinessResponse:
    if server.app_runtime is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "agent runtime unavailable")
    registry = server.app_runtime.agent_registry
    row = registry.get_row(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    _assert_agent_owner(row, user)
    # Omitted selection means the new-turn defaults (incl. expert defaults).
    # An explicit selection, including an empty one, must not force defaults.
    if "selected" in request.query_params:
        chosen = [name for name in request.query_params.getlist("selected") if name]
    else:
        chosen = registry.merge_turn_mcp_servers(
            user.id,
            None,
            apply_defaults=True,
            extra_defaults=registry.default_mcp_servers(agent_id),
        ) or []
    visible = registry._connector_svc.list_instances_for_api(user.id)
    await prepare_selected_connector_readiness(
        registry=registry,
        agent_id=agent_id,
        user_id=user.id,
        selected=chosen,
        instances=visible,
        mode=mode,
    )
    agent = registry.get_agent(agent_id)
    loaded = set(getattr(agent, "_mcp_tool_name_set", frozenset()))
    return ConnectorReadinessResponse(
        mode=mode,
        connectors=describe_connector_readiness(
            selected=chosen,
            mode=mode,
            instances=visible,
            loaded_tools=loaded,
        ),
    )
