from __future__ import annotations

from types import SimpleNamespace

import pytest
from octop_gateway.models import TextContent

from octop.api.routers.chat.models import ChatTurnBody
from octop.api.routers.chat.turn import _bind_file_attachments
from octop.infra.errors import OctopError


class _FileRepo:
    def __init__(self, *, accepts: bool = True) -> None:
        self.accepts = accepts
        self.calls: list[tuple[str, dict[str, object]]] = []

    def bind_thread(self, file_id: str, **kwargs: object) -> bool:
        self.calls.append((file_id, kwargs))
        return self.accepts


@pytest.mark.asyncio
async def test_uploaded_file_is_bound_and_forwarded_as_trusted_reference() -> None:
    repo = _FileRepo()
    server = SimpleNamespace(services=SimpleNamespace(chat_file_repo=repo))
    turn = ChatTurnBody(
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "file",
                        "file_id": "file-1",
                        "revision_id": "rev-1",
                        "workspace_path": "inbound/report.pdf",
                    }
                ],
            }
        ]
    )

    refs = await _bind_file_attachments(
        server, agent_id="agent", user_id=7, thread_id="thread", turn=turn
    )

    assert refs == {"inbound/report.pdf": {"file_id": "file-1", "revision_id": "rev-1"}}
    assert repo.calls == [
        (
            "file-1",
            {
                "user_id": 7,
                "agent_id": "agent",
                "thread_id": "thread",
                "revision_id": "rev-1",
                "workspace_path": "inbound/report.pdf",
            },
        )
    ]


@pytest.mark.asyncio
async def test_invalid_file_identity_is_rejected_before_model_input() -> None:
    repo = _FileRepo(accepts=False)
    server = SimpleNamespace(services=SimpleNamespace(chat_file_repo=repo))
    turn = ChatTurnBody(
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "file",
                        "file_id": "other-users-file",
                        "revision_id": "rev-1",
                        "workspace_path": "inbound/private.pdf",
                    }
                ],
            }
        ]
    )

    with pytest.raises(OctopError):
        await _bind_file_attachments(
            server, agent_id="agent", user_id=7, thread_id="thread", turn=turn
        )


@pytest.mark.asyncio
async def test_uploaded_file_text_is_added_to_the_actual_model_turn(monkeypatch) -> None:
    import octop.api.routers.chat.turn as turn_module

    repo = _FileRepo()
    registry = SimpleNamespace(
        get_row=lambda _agent_id: SimpleNamespace(user_id=7, is_shared=0, default_model=None)
    )
    server = SimpleNamespace(
        services=SimpleNamespace(chat_file_repo=repo),
        app_runtime=SimpleNamespace(
            agent_registry=registry, gateway=SimpleNamespace(thread_registry=object())
        ),
    )

    async def resolve_thread(**_kwargs):
        return "thread", "session"

    async def validate_mcp(*_args, **_kwargs):
        return None

    async def validate_skills(*_args, **_kwargs):
        return None

    async def get_workspace(*_args, **_kwargs):
        return object()

    class _ReadService:
        def __init__(self, _repo):
            pass

        async def read(self, **kwargs):
            assert kwargs["file_id"] == "file-1"
            return {
                "file_id": "file-1",
                "revision_id": "rev-1",
                "read_status": "ready",
                "coverage": {"complete": True},
                "segments": [
                    {
                        "ordinal": 0,
                        "locator_json": '{"kind":"text_line","start":1,"end":1}',
                        "text": "Project deadline: Friday.",
                    }
                ],
            }

    monkeypatch.setattr(turn_module, "resolve_thread_id", resolve_thread)
    monkeypatch.setattr(turn_module, "validate_chat_mcp_servers", validate_mcp)
    monkeypatch.setattr(turn_module, "validate_chat_skills", validate_skills)
    monkeypatch.setattr(turn_module, "require_running_workspace", get_workspace)
    monkeypatch.setattr(turn_module, "FileService", _ReadService)
    turn = ChatTurnBody(
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "file",
                        "file_id": "file-1",
                        "revision_id": "rev-1",
                        "workspace_path": "inbound/report.txt",
                        "filename": "report.txt",
                        "media_type": "text/plain",
                    }
                ],
            }
        ]
    )

    prepared = await turn_module.prepare_dashboard_turn(
        server,
        agent_id="agent",
        user=SimpleNamespace(id=7, is_admin=False, locale="en"),
        turn=turn,
    )

    text = "\n".join(
        part.text for part in prepared.inbound_content if isinstance(part, TextContent)
    )
    assert "Project deadline: Friday." in text
    assert "[[file:file-1:rev-1:0]]" in text
    assert "untrusted" in text.lower()
    assert prepared.inbound_attachments[0]["file_id"] == "file-1"
    assert prepared.inbound_attachments[0]["read_status"] == "ready"
