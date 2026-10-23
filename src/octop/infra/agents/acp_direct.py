"""Direct ACP chat helpers for workbench threads."""

from __future__ import annotations

import os
from contextlib import AsyncExitStack
from pathlib import Path
from typing import Any

from octop_harness.acp.client import ACPHostedClient
from octop_harness.acp.models import ACPConfig, ACPConfigurationError
from octop_harness.acp.service import get_acp_service, init_acp_service
from octop_harness.runtime_env import load_dotenv_path, overlay_env


def _workspace_dir(registry: Any, agent_id: str) -> Path:
    config = registry.get_config(agent_id)
    backend = config.get("backend")
    if isinstance(backend, dict) and backend.get("type") not in (None, "filesystem", "local_shell"):
        raise ACPConfigurationError("Direct ACP chat requires a local workspace")
    return Path(registry.resolve_workspace_dir(agent_id)).resolve()


def _acp_config(registry: Any, user_id: int) -> ACPConfig:
    runners = registry.acp_settings.load_runners(user_id)
    return ACPConfig.from_dict({"runners": runners})


async def list_model_options(*, registry: Any, user_id: int, agent_id: str) -> list[dict[str, str]]:
    """Read model choices from the runner's ACP session config options."""
    from acp import PROTOCOL_VERSION, spawn_agent_process
    from acp.schema import ClientCapabilities, Implementation

    cwd = _workspace_dir(registry, agent_id)
    config = _acp_config(registry, user_id)
    runner = config.runners.get("opencode")
    if runner is None or not runner.enabled:
        raise ACPConfigurationError("OpenCode is not enabled")
    client = ACPHostedClient(runner_name="opencode", runner_config=runner, cwd=str(cwd))
    env = overlay_env(os.environ, load_dotenv_path(os.path.join(cwd, ".env")), protect=True)
    env = overlay_env(env, runner.env, protect=False)
    async with AsyncExitStack() as stack:
        conn, _process = await stack.enter_async_context(
            spawn_agent_process(
                client,  # type: ignore[arg-type]
                runner.command,
                *runner.args,
                cwd=str(cwd),
                env=env,
                transport_kwargs={"limit": runner.stdio_buffer_limit_bytes},
            ),
        )
        initialized = await conn.initialize(
            protocol_version=PROTOCOL_VERSION,
            capabilities=ClientCapabilities(),
            client_info=Implementation(name="octop-direct-acp", version="1"),
        )
        if initialized.protocol_version != PROTOCOL_VERSION:
            raise ACPConfigurationError("OpenCode ACP protocol version mismatch")
        session = await conn.new_session(cwd=str(cwd))
        options = getattr(session, "config_options", None) or []
        model_option = next(
            (item for item in options if str(getattr(item, "id", "")) == "model"),
            None,
        )
        if model_option is None:
            return []
        return [
            {
                "value": str(getattr(item, "value", "")),
                "label": str(getattr(item, "name", "")) or str(getattr(item, "value", "")),
            }
            for item in getattr(model_option, "options", [])
            if str(getattr(item, "value", "")).strip()
        ]


async def run_direct_turn(
    *,
    registry: Any,
    user_id: int,
    agent_id: str,
    thread_id: str,
    model: str | None,
    prompt: str,
    on_message: Any,
) -> dict[str, Any]:
    """Run a prompt in the OpenCode ACP session bound to this thread."""
    cwd = _workspace_dir(registry, agent_id)
    config = _acp_config(registry, user_id)
    runner = config.runners.get("opencode")
    if runner is None or not runner.enabled:
        raise ACPConfigurationError("OpenCode is not enabled")
    service_key = f"direct:{user_id}:{agent_id}"
    service = get_acp_service(service_key)
    if service is None:
        service = init_acp_service(service_key, config)
    session = await service._get_or_create_session(  # noqa: SLF001
        thread_id=thread_id,
        runner="opencode",
        cwd=str(cwd),
        require_existing=False,
    )
    if model:
        await session.conn.set_config_option(
            config_id="model",
            value=model,
            session_id=session.acp_session_id,
        )
    result = await service.run_turn(
        thread_id=thread_id,
        runner="opencode",
        prompt_blocks=[{"type": "text", "text": prompt}],
        cwd=str(cwd),
        on_message=on_message,
    )
    event = result.get("event")
    if isinstance(event, dict) and event.get("text"):
        await on_message({"type": "text", "text": str(event["text"]), "is_chunk": False}, False)
    return result


async def cancel_direct_turn(*, user_id: int, agent_id: str, thread_id: str) -> bool:
    service = get_acp_service(f"direct:{user_id}:{agent_id}")
    if service is None:
        return False
    return await service.cancel_turn(thread_id=thread_id, runner="opencode")


async def close_direct_thread(*, user_id: int, agent_id: str, thread_id: str) -> None:
    service = get_acp_service(f"direct:{user_id}:{agent_id}")
    if service is not None:
        await service.close_thread_session(thread_id=thread_id, runner="opencode")
