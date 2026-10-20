"""HTTP adapter for conversation file reads."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

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
