"""HTTP adapter for conversation file reads."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from octop.api.common.agent import require_agent_row
from octop.api.common.workspace import require_running_workspace
from octop.api.deps import current_user, get_server
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.files.parse import FileParseError
from octop.infra.files.service import (
    FileIntegrityError,
    FileReadBusy,
    FileService,
    FileTooLargeError,
)
from octop.infra.files.worker import FileWorkerError

router = APIRouter()


class FileReadRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128, description="Owning conversation thread.")
    revision_id: str = Field(
        min_length=1, max_length=64, description="Immutable file revision to read."
    )


class FileSegmentResponse(BaseModel):
    ordinal: int
    locator_json: str
    text: str
    char_count: int


class FileReadResponse(BaseModel):
    file_id: str
    revision_id: str
    read_status: str
    coverage: dict[str, Any]
    segments: list[FileSegmentResponse]


class FileSummaryResponse(BaseModel):
    file_id: str
    display_name: str
    media_type: str
    byte_size: int
    read_status: str
    current_revision_id: str | None
    created_at: int
    updated_at: int


class FileDetailResponse(FileSummaryResponse):
    coverage: dict[str, Any]
    revisions: list[dict[str, Any]]


class FileSegmentsResponse(BaseModel):
    file_id: str
    revision_id: str
    read_status: str
    segments: list[FileSegmentResponse]
    next_offset: int | None


class FileSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500, description="Bounded keyword query.")
    revision_id: str | None = Field(
        default=None, max_length=64, description="Defaults to the current revision."
    )
    limit: int = Field(default=10, ge=1, le=20)


class FileSearchResponse(BaseModel):
    file_id: str
    revision_id: str
    query: str
    matches: list[FileSegmentResponse]


def _file_service(server: Any) -> FileService:
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    return FileService(server.services.chat_file_repo)


@router.post(
    "/agents/{agent_id}/files/{file_id}/read",
    response_model=FileReadResponse,
    summary="Read an uploaded conversation file",
    description=(
        "Parses one immutable file revision in a killable worker process. Access requires "
        "the owning user, agent, and bound thread; extracted text and source locators are stored."
    ),
)
async def read_chat_file(
    agent_id: str,
    file_id: str,
    body: FileReadRequest,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileReadResponse:
    workspace = await require_running_workspace(agent_id, user=user, as_user=None, server=server)
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    try:
        result = await FileService(server.services.chat_file_repo).read(
            workspace=workspace,
            file_id=file_id,
            revision_id=body.revision_id,
            user_id=int(user.id),
            agent_id=agent_id,
            thread_id=body.thread_id,
        )
    except FileReadBusy as exc:
        raise OctopError.localized(ErrorCode.FILE_READ_BUSY) from exc
    except PermissionError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    except FileNotFoundError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    except FileParseError as exc:
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE) from exc
    except FileWorkerError as exc:
        raise OctopError.localized(ErrorCode.FILE_READ_FAILED) from exc
    except FileIntegrityError as exc:
        raise OctopError.localized(ErrorCode.FILE_INTEGRITY_FAILED) from exc
    except FileTooLargeError as exc:
        raise OctopError.localized(ErrorCode.FILE_READ_TOO_LARGE) from exc
    return FileReadResponse.model_validate(result)


@router.get(
    "/agents/{agent_id}/threads/{thread_id}/files",
    response_model=list[FileSummaryResponse],
    summary="List conversation files bound to a thread",
    description=(
        "Returns the current user's files bound to this agent and thread, newest "
        "first. Bodies and host paths are never included."
    ),
)
async def list_thread_files(
    agent_id: str,
    thread_id: str,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[FileSummaryResponse]:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    response.headers["Cache-Control"] = "private, no-store"
    return [
        FileSummaryResponse.model_validate(item)
        for item in _file_service(server).list_thread_files(
            user_id=int(user.id), agent_id=agent_id, thread_id=thread_id
        )
    ]


@router.get(
    "/agents/{agent_id}/files/{file_id}",
    response_model=FileDetailResponse,
    summary="Get one conversation file with coverage and revisions",
    description="File metadata, current read coverage and the revision list; no host paths.",
)
async def get_chat_file(
    agent_id: str,
    file_id: str,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileDetailResponse:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    response.headers["Cache-Control"] = "private, no-store"
    try:
        detail = _file_service(server).get_file(
            file_id=file_id, user_id=int(user.id), agent_id=agent_id
        )
    except PermissionError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    return FileDetailResponse.model_validate(detail)


@router.get(
    "/agents/{agent_id}/files/{file_id}/segments",
    response_model=FileSegmentsResponse,
    summary="Read extracted segments with real locators",
    description=(
        "Bounded page of stored segments for one revision (defaults to current). "
        "Requires the owning user, agent and thread binding."
    ),
)
async def get_file_segments(
    agent_id: str,
    file_id: str,
    response: Response,
    revision_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileSegmentsResponse:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    response.headers["Cache-Control"] = "private, no-store"
    try:
        result = _file_service(server).get_segments(
            file_id=file_id,
            revision_id=revision_id,
            user_id=int(user.id),
            agent_id=agent_id,
            limit=limit,
            offset=offset,
        )
    except PermissionError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    except FileNotFoundError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    return FileSegmentsResponse.model_validate(result)


@router.post(
    "/agents/{agent_id}/files/{file_id}/search",
    response_model=FileSearchResponse,
    summary="Search extracted segments by keyword",
    description=(
        "Bounded case-insensitive substring search over one revision's segments "
        "(defaults to current). Returns real locators, never host paths."
    ),
)
async def search_file_segments(
    agent_id: str,
    file_id: str,
    body: FileSearchRequest,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileSearchResponse:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    response.headers["Cache-Control"] = "private, no-store"
    try:
        result = _file_service(server).search(
            file_id=file_id,
            revision_id=body.revision_id,
            query=body.query,
            limit=body.limit,
            user_id=int(user.id),
            agent_id=agent_id,
        )
    except PermissionError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    except FileNotFoundError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    return FileSearchResponse.model_validate(result)
