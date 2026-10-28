"""Dashboard chat over WebSocket — routes turns through Gateway / GlobalProcessor."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import ValidationError
from starlette.websockets import WebSocketState

from octop.api.common.agent import assert_agent_access
from octop.api.deps import resolve_user_from_token
from octop.api.routers.chat.models import UserTurnWsFrame
from octop.api.routers.chat.sse import json_chunk_default
from octop.api.routers.chat.turn import (
    build_dashboard_inbound,
    prepare_dashboard_turn,
    turn_has_content,
)
from octop.infra.bridge.ids import parse_bridge_agent_id
from octop.infra.errors import OctopError
from octop.infra.gateway.ws import WS_CHANNEL_ID
from octop.infra.history.projection import live_message_inputs

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/agents/{agent_id}/chat/ws")
async def dashboard_chat_ws(
    websocket: WebSocket,
    agent_id: str,
    token: str | None = Query(default=None),
) -> None:
    """Bidirectional Dashboard chat. Wire protocol mirrors harness stream chunks."""
    server = websocket.app.state.octop_server
    if not token:
        await websocket.close(code=4001, reason="missing token")
        return

    try:
        user = resolve_user_from_token(server, token)
    except OctopError as exc:
        await websocket.close(code=4001, reason=f"auth: {exc.code.value}")
        return

    bridge_ref = parse_bridge_agent_id(agent_id)
    if bridge_ref is not None:
        await _bridge_chat_ws(websocket, server=server, user=user, ref=bridge_ref)
        return

    assert server.app_runtime is not None  # noqa: S101
    gateway = server.app_runtime.gateway
    hub = gateway.ws_hub
    channel_manager = gateway.channel_manager
    if channel_manager is None:
        await websocket.close(code=1011, reason="gateway not ready")
        return

    try:
        assert_agent_access(server, agent_id, user)
    except OctopError as exc:
        from octop.infra.errors import ErrorCode  # noqa: PLC0415

        code = 4003 if exc.code == ErrorCode.FORBIDDEN else 4404
        await websocket.close(code=code, reason=str(exc.code.value))
        return

    connection_id = uuid.uuid4().hex
    await websocket.accept()

    async def send_frame(frame: dict[str, Any]) -> None:
        if websocket.application_state != WebSocketState.CONNECTED:
            return
        await websocket.send_text(
            json.dumps(frame, ensure_ascii=False, default=json_chunk_default),
        )

    hub.register(connection_id, send_frame)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"type": "user_turn", "text": raw}

            if not isinstance(payload, dict):
                continue

            msg_type = str(payload.get("type") or "user_turn")
            if msg_type == "ping":
                await send_frame({"type": "pong"})
                continue

            if msg_type == "subscribe":
                thread_id = str(payload.get("thread_id") or "").strip()
                if not thread_id:
                    await send_frame({"type": "error", "message": "subscribe requires thread_id"})
                    continue
                row = gateway.thread_registry.get_thread(thread_id)
                if row is None or row.agent_id != agent_id or row.user_id != user.id:
                    await send_frame(
                        {"type": "error", "message": f"thread {thread_id!r} not found"},
                    )
                    continue
                hub.subscribe(thread_id, connection_id)
                await send_frame(
                    {
                        "type": "turn_status",
                        "thread_id": thread_id,
                        "active": hub.is_turn_active(thread_id),
                    },
                )
                continue

            if msg_type == "cancel":
                thread_id = str(payload.get("thread_id") or "").strip()
                if not thread_id:
                    await send_frame({"type": "error", "message": "cancel requires thread_id"})
                    continue
                row = gateway.thread_registry.get_thread(thread_id)
                if row is None or row.agent_id != agent_id or row.user_id != user.id:
                    await send_frame(
                        {"type": "error", "message": f"thread {thread_id!r} not found"},
                    )
                    continue
                if row.acp_runner:
                    from octop.infra.agents.acp_direct import cancel_direct_turn

                    await cancel_direct_turn(
                        user_id=user.id,
                        agent_id=agent_id,
                        thread_id=thread_id,
                        runner_name=row.acp_runner,
                    )
                else:
                    server.app_runtime.agent_registry.cancel_stream(agent_id, thread_id)
                continue

            if msg_type != "user_turn":
                await send_frame({"type": "error", "message": f"unknown message type: {msg_type}"})
                continue

            try:
                frame = UserTurnWsFrame.model_validate({**payload, "type": "user_turn"})
            except ValidationError as exc:
                await send_frame({"type": "error", "message": str(exc)})
                await send_frame({"type": "done"})
                continue

            turn = frame.to_turn_body()
            if not turn_has_content(turn):
                await send_frame({"type": "error", "message": "empty message"})
                await send_frame({"type": "done"})
                continue

            try:
                prepared = await prepare_dashboard_turn(
                    server,
                    agent_id=agent_id,
                    user=user,
                    turn=turn,
                )
            except OctopError as exc:
                await send_frame({"type": "error", "message": str(exc)})
                await send_frame({"type": "done"})
                continue

            thread_row = gateway.thread_registry.get_thread(prepared.thread_id)
            if thread_row is not None and thread_row.acp_runner:
                has_attachments = any(
                    isinstance(message.get("content"), list) for message in (frame.messages or [])
                )
                if has_attachments:
                    await send_frame(
                        {
                            "type": "error",
                            "message": "ACP direct chat currently accepts text only",
                        }
                    )
                    await send_frame({"type": "done"})
                    continue
                hub.subscribe(prepared.thread_id, connection_id)
                hub.mark_turn_active(prepared.thread_id)
                direct_thread_id = prepared.thread_id
                prompt_text = turn.text or ""
                try:
                    from octop.infra.agents.acp_direct import run_direct_turn

                    async def on_acp_message(
                        event: dict[str, Any],
                        _is_last: bool,
                        thread_id: str = direct_thread_id,
                        runner_name: str = thread_row.acp_runner,
                    ) -> None:
                        if event.get("type") == "tool_start":
                            await hub.push_to_thread(
                                thread_id,
                                {
                                    "type": "tool_call_chunk",
                                    "id": event.get("call_id"),
                                    "name": event.get("name"),
                                    "args": {},
                                },
                            )
                        elif event.get("type") == "permission_request":
                            from octop.infra.agents.acp_direct import cancel_direct_turn

                            await cancel_direct_turn(
                                user_id=user.id,
                                agent_id=agent_id,
                                thread_id=thread_id,
                                runner_name=runner_name,
                            )
                            await hub.push_to_thread(
                                thread_id,
                                {
                                    "type": "error",
                                    "message": f"{runner_name} requested tool permission; approve it in that CLI session and retry.",
                                },
                            )

                    await asyncio.to_thread(
                        server.services.thread_message_repo.append_legacy_interval,
                        prepared.thread_id,
                        live_message_inputs([HumanMessage(content=prompt_text)]),
                    )
                    result = await run_direct_turn(
                        registry=server.app_runtime.agent_registry,
                        user_id=user.id,
                        agent_id=agent_id,
                        thread_id=prepared.thread_id,
                        runner_name=thread_row.acp_runner,
                        model=thread_row.acp_model,
                        prompt=prompt_text,
                        on_message=on_acp_message,
                    )
                    event = result.get("event")
                    answer = str(event.get("text") or "") if isinstance(event, dict) else ""
                    if answer:
                        await hub.push_to_thread(
                            prepared.thread_id, {"type": "token", "content": answer}
                        )
                        await asyncio.to_thread(
                            server.services.thread_message_repo.append_legacy_interval,
                            prepared.thread_id,
                            live_message_inputs([AIMessage(content=answer)]),
                        )
                except Exception as exc:
                    logger.exception("direct OpenCode turn failed thread=%s", prepared.thread_id)
                    await hub.push_to_thread(
                        prepared.thread_id, {"type": "error", "message": str(exc)}
                    )
                finally:
                    await hub.push_to_thread(prepared.thread_id, {"type": "done"})
                    hub.mark_turn_idle(prepared.thread_id)
                continue

            inbound = build_dashboard_inbound(
                agent_id=agent_id,
                user_id=user.id,
                prepared=prepared,
                turn=turn,
                ws_connection_id=connection_id,
                user_is_admin=bool(getattr(user, "is_admin", False)),
            )
            hub.subscribe(prepared.thread_id, connection_id)
            channel_manager.enqueue(WS_CHANNEL_ID, inbound)

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("dashboard chat ws error agent=%s", agent_id)
        if websocket.application_state == WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                await send_frame({"type": "error", "message": "internal error"})
    finally:
        # Disconnect must not cancel an in-flight turn — clients may reconnect and
        # subscribe to continue receiving subsequent chunks (weak stream resume).
        hub.unregister(connection_id)
        if websocket.application_state == WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                await websocket.close()


async def _bridge_chat_ws(
    websocket: WebSocket,
    *,
    server: Any,
    user: Any,
    ref: Any,
) -> None:
    """Relay dashboard chat frames to a remote agent over Bridge WS."""
    rt = server.app_runtime
    mgr = getattr(rt, "bridge_manager", None) if rt is not None else None
    if mgr is None:
        await websocket.close(code=1011, reason="bridge not ready")
        return
    try:
        mgr.get_owned(ref.connection_id, user.id)
        mgr.require_session(ref.connection_id)
    except OctopError as exc:
        await websocket.close(code=1011, reason=str(exc.code.value))
        return

    await websocket.accept()

    async def send_frame(frame: dict[str, Any]) -> None:
        if websocket.application_state != WebSocketState.CONNECTED:
            return
        await websocket.send_text(
            json.dumps(frame, ensure_ascii=False, default=json_chunk_default),
        )

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"type": "user_turn", "text": raw}
            if not isinstance(payload, dict):
                continue
            msg_type = str(payload.get("type") or "user_turn")
            if msg_type == "ping":
                await send_frame({"type": "pong"})
                continue
            if msg_type == "subscribe":
                # History/live resume stays on the peer; acknowledge without local hub.
                thread_id = str(payload.get("thread_id") or "").strip()
                await send_frame(
                    {
                        "type": "turn_status",
                        "thread_id": thread_id,
                        "active": False,
                    }
                )
                continue
            if msg_type == "cancel":
                await send_frame({"type": "error", "message": "cancel not supported on bridge yet"})
                continue
            if msg_type != "user_turn":
                await send_frame({"type": "error", "message": f"unknown message type: {msg_type}"})
                continue
            try:
                frame = UserTurnWsFrame.model_validate({**payload, "type": "user_turn"})
            except ValidationError as exc:
                await send_frame({"type": "error", "message": str(exc)})
                await send_frame({"type": "done"})
                continue
            turn = frame.to_turn_body()
            if not turn_has_content(turn):
                await send_frame({"type": "error", "message": "empty message"})
                await send_frame({"type": "done"})
                continue
            turn_payload = frame.model_dump(exclude_none=True)
            turn_payload.pop("type", None)
            try:
                await mgr.relay_user_turn(
                    connection_id=ref.connection_id,
                    owner_user_id=user.id,
                    remote_agent_id=ref.remote_agent_id,
                    turn_payload=turn_payload,
                    on_frame=send_frame,
                )
            except OctopError as exc:
                await send_frame({"type": "error", "message": str(exc)})
                await send_frame({"type": "done"})
            except Exception:
                logger.exception("bridge chat relay failed")
                await send_frame({"type": "error", "message": "bridge turn failed"})
                await send_frame({"type": "done"})
    except WebSocketDisconnect:
        pass
    finally:
        if websocket.application_state == WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                await websocket.close()
