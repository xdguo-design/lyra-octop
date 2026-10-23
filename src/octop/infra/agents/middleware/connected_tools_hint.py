"""Keep live connector capabilities ahead of stale conversation memories."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from deepagents.middleware._utils import append_to_system_message
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from octop_harness.middleware.runtime import runtime_config


def _with_connector_hint(request: ModelRequest[Any]) -> ModelRequest[Any]:
    configurable = runtime_config(request).get("configurable") or {}
    servers = configurable.get("mcp_servers")
    if not isinstance(servers, list) or not servers:
        return request
    prefixes = tuple(f"{name}_" for name in servers if isinstance(name, str) and name)
    tool_names = [str(getattr(tool, "name", "")) for tool in request.tools or []]
    active = [name for name in tool_names if name.startswith(prefixes)]
    if not active:
        return request

    hint = (
        "Connected tools in this request are available now. Earlier assistant replies "
        "and recalled memories about missing tools may be outdated. Use the current "
        "tools for matching requests, or ask for missing required details. Do not claim "
        "a connected tool is unavailable unless its call actually fails. Always honor "
        "the user's explicit limits on tool use and data access; never call a tool or "
        "read data that the user explicitly said not to access."
    )
    send_tool = next((name for name in active if name.endswith("_agently_send")), None)
    if send_tool:
        hint += (
            f" Agent Mail can send email with {send_tool}. Ask for any missing "
            "recipient, subject, or body, and follow the tool's confirmation flow."
        )
    return request.override(system_message=append_to_system_message(request.system_message, hint))


class ConnectedToolsHintMiddleware(AgentMiddleware[Any, Any]):
    def wrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], ModelResponse[Any]],
    ) -> ModelResponse[Any]:
        return handler(_with_connector_hint(request))

    async def awrap_model_call(
        self,
        request: ModelRequest[Any],
        handler: Callable[[ModelRequest[Any]], Awaitable[ModelResponse[Any]]],
    ) -> ModelResponse[Any]:
        return await handler(_with_connector_hint(request))
