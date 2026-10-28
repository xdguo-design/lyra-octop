"""Authenticated HTTP adapter for account-owned presentation documents."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from octop.api.common.agent import require_agent_owner_row
from octop.api.deps import current_user, get_server
from octop.api.routers.chat.sse import format_sse
from octop.infra.presentations.models import (
    ChatLog,
    ChatOutcome,
    ChatRequest,
    CreateDeck,
    Deck,
    JobRequest,
    SaveDeck,
)
from octop.infra.presentations.service import PresentationService
from octop.infra.utils.locale import resolve_request_locale

router = APIRouter(prefix="/agents/{agent_id}/presentations")


class PresentationRuntime(BaseModel):
    installed: bool
    version: str
    commit: str


@dataclass
class _Context:
    service: PresentationService
    user_id: int
    agent_id: str
    locale: str


async def _context(
    agent_id: str,
    request: Request,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> _Context:
    require_agent_owner_row(agent_id, user=user, as_user=None, server=server)
    if server.presentation_service is None:
        server.presentation_service = PresentationService(server)
    return _Context(server.presentation_service, user.id, agent_id, resolve_request_locale(request))


@router.get(
    "/runtime",
    response_model=PresentationRuntime,
    summary="Check the pinned PPT Master export runtime",
)
async def runtime(context: _Context = Depends(_context)) -> dict[str, object]:
    return await context.service.runtime_status()


@router.get(
    "", response_model=list[Deck], summary="List presentations owned by this account and expert"
)
async def list_presentations(context: _Context = Depends(_context)) -> list[Deck]:
    return await context.service.list_decks(
        context.user_id, context.agent_id, locale=context.locale
    )


@router.post(
    "", response_model=Deck, status_code=201, summary="Create a persisted presentation brief"
)
async def create_presentation(body: CreateDeck, context: _Context = Depends(_context)) -> Deck:
    return await context.service.create_deck(
        context.user_id, context.agent_id, body, locale=context.locale
    )


@router.post(
    "/chat",
    response_model=ChatOutcome,
    summary="Send one chat message to the presentation assistant",
    description=(
        "One bounded model decision maps the message to a pipeline action "
        "(create, update, outline, generate, compose, revise, export, add_slides, delete_slide) "
        "or a plain reply. The deck-bound transcript is persisted server-side; "
        "pass deck_id to keep talking to the current deck."
    ),
)
async def chat(body: ChatRequest, context: _Context = Depends(_context)) -> ChatOutcome:
    outcome = await context.service.chat(
        context.user_id, context.agent_id, body.deck_id, body.message, locale=context.locale
    )
    return ChatOutcome.model_validate(outcome)


@router.get(
    "/chat",
    response_model=ChatLog,
    summary="Read the conversation before a presentation is created",
)
async def get_draft_chat(context: _Context = Depends(_context)) -> ChatLog:
    return await context.service.chat_log(
        context.user_id, context.agent_id, None, locale=context.locale
    )


@router.post(
    "/chat/stream",
    response_class=StreamingResponse,
    summary="Send one chat message and stream the assistant reply (SSE)",
    description=(
        "Server-sent events: `delta` frames carry the reply text as the decision model "
        "produces it (reasoning is stripped server-side); a final `result` frame carries "
        "the authoritative reply, the executed action and the updated deck."
    ),
)
async def chat_stream(
    body: ChatRequest, context: _Context = Depends(_context)
) -> StreamingResponse:
    async def frames() -> AsyncIterator[str]:
        async for event in context.service.chat_stream(
            context.user_id, context.agent_id, body.deck_id, body.message, locale=context.locale
        ):
            kind = event["type"]
            if kind == "error":
                yield format_sse(
                    "result",
                    {
                        "reply": event["reply"],
                        "action": event.get("action", "none"),
                        "deck": event.get("deck"),
                    },
                )
            else:
                yield format_sse(kind, event)

    return StreamingResponse(frames(), media_type="text/event-stream")


@router.get(
    "/{deck_id}/chat",
    response_model=ChatLog,
    summary="Read the persisted deck conversation",
)
async def get_chat(deck_id: str, context: _Context = Depends(_context)) -> ChatLog:
    return await context.service.chat_log(
        context.user_id, context.agent_id, deck_id, locale=context.locale
    )


@router.get(
    "/{deck_id}", response_model=Deck, summary="Read a presentation and its latest task progress"
)
async def get_presentation(deck_id: str, context: _Context = Depends(_context)) -> Deck:
    return await context.service.get_deck(
        context.user_id, context.agent_id, deck_id, locale=context.locale
    )


@router.put(
    "/{deck_id}",
    response_model=Deck,
    summary="Save content using an optimistic revision check",
    description="Rejects stale revisions and writes during active tasks. Changed slide content invalidates only its rendered SVG; client-provided SVG is ignored.",
)
async def save_presentation(
    deck_id: str, body: SaveDeck, context: _Context = Depends(_context)
) -> Deck:
    return await context.service.save_deck(
        context.user_id, context.agent_id, deck_id, body, locale=context.locale
    )


@router.post(
    "/{deck_id}/jobs",
    response_model=Deck,
    status_code=202,
    summary="Start outline, slide generation, selected-slide revision, or PPTX export",
    description="Uses the expert's configured model. Poll the presentation for progress; completed slides survive interruption. Revision and concurrency checks prevent overlapping writes.",
)
async def start_job(deck_id: str, body: JobRequest, context: _Context = Depends(_context)) -> Deck:
    return await context.service.start_job(
        context.user_id, context.agent_id, deck_id, body, locale=context.locale
    )


@router.get(
    "/{deck_id}/download",
    summary="Download the current validated editable PPTX",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        }
    },
)
async def download(deck_id: str, context: _Context = Depends(_context)) -> Response:
    data = await context.service.download(
        context.user_id, context.agent_id, deck_id, locale=context.locale
    )
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f'attachment; filename="presentation-{deck_id}.pptx"',
            "Cache-Control": "private, no-store",
        },
    )
