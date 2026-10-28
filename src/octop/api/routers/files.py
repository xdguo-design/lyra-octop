"""HTTP adapter for conversation file reads."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from functools import partial
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, field_validator

from octop.api.common.agent import require_agent_row
from octop.api.common.attachments import save_attachment
from octop.api.common.content_disposition import content_disposition
from octop.api.common.workspace import require_agent_workspace, require_running_workspace
from octop.api.deps import current_user, get_server
from octop.infra.db.repos.chat_files import ChatFileRevisionConflict
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.files.parse import FileParseError, UnsupportedFileTypeError
from octop.infra.files.service import (
    FileIntegrityError,
    FileReadBusy,
    FileService,
    FileTooLargeError,
)
from octop.infra.files.worker import FileWorkerError
from octop.infra.gateway.media.inbound_store import sanitize_inbound_filename
from octop.infra.utils.doc_edit import get_doc_converter
from octop.infra.utils.ulid import new_ulid

router = APIRouter()
logger = logging.getLogger(__name__)


class FileReadRequest(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128, description="Owning conversation thread.")
    revision_id: str = Field(
        min_length=1, max_length=64, description="Immutable file revision to read."
    )


FileReadStatus = Literal[
    "stored", "processing", "ready", "partial", "needs_ocr", "unsupported", "failed"
]


class FileSourceSpan(BaseModel):
    """Parser-derived location pinned to one immutable file revision."""

    file_id: str
    revision_id: str
    parser_version: int
    content_hash: str
    ordinal: int
    locator: dict[str, Any]


class FileSegmentResponse(BaseModel):
    ordinal: int
    locator_json: str
    text: str
    char_count: int
    source_span: FileSourceSpan | None = None


class FileReadResponse(BaseModel):
    file_id: str
    revision_id: str
    read_status: FileReadStatus
    coverage: dict[str, Any]
    segments: list[FileSegmentResponse]


class FileSummaryResponse(BaseModel):
    file_id: str
    display_name: str
    media_type: str
    byte_size: int
    read_status: FileReadStatus
    current_revision_id: str | None
    origin_kind: str | None
    created_at: int
    updated_at: int


class FileDetailResponse(FileSummaryResponse):
    coverage: dict[str, Any]
    revisions: list[dict[str, Any]]
    access_url: str | None = None


class FileSegmentsResponse(BaseModel):
    file_id: str
    revision_id: str
    read_status: FileReadStatus
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


class TextArtifactCreateBody(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=2_000_000)

    @field_validator("filename")
    @classmethod
    def simple_filename(cls, value: str) -> str:
        name = value.strip()
        if not name or Path(name).name != name or any(char in name for char in "\\/\x00"):
            raise ValueError("filename must be a simple name")
        return name


class TextArtifactRevisionBody(BaseModel):
    thread_id: str = Field(min_length=1, max_length=128)
    base_revision_id: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=2_000_000)


class TextArtifactContentResponse(BaseModel):
    file_id: str
    revision_id: str
    content: str


def _file_service(server: Any) -> FileService:
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    return FileService(server.services.chat_file_repo)


def _file_detail_response(server: Any, *, file_id: str, user_id: int, agent_id: str) -> Any:
    detail = _file_service(server).get_file(file_id=file_id, user_id=user_id, agent_id=agent_id)
    if server.services is not None:
        for item in detail["revisions"]:
            revision = server.services.chat_file_repo.get_revision(item["revision_id"])
            if revision is not None and revision.file_id == file_id:
                item["access_url"] = _revision_content_url(agent_id, file_id, revision.revision_id)
                if revision.revision_id == detail["current_revision_id"]:
                    detail["access_url"] = item["access_url"]
    return detail


def _revision_content_url(agent_id: str, file_id: str, revision_id: str) -> str:
    return (
        f"/api/agents/{quote(agent_id, safe='')}/files/{quote(file_id, safe='')}"
        f"/revisions/{quote(revision_id, safe='')}/content"
    )


async def _read_owned_revision_bytes(
    server: Any,
    *,
    agent_id: str,
    file_id: str,
    revision_id: str,
    user: Any,
    thread_id: str | None = None,
) -> tuple[Any, Any, bytes]:
    workspace = await require_agent_workspace(agent_id, user=user, server=server)
    try:
        return await _file_service(server).read_owned_revision_bytes(
            workspace=workspace,
            file_id=file_id,
            revision_id=revision_id,
            user_id=int(user.id),
            agent_id=agent_id,
            thread_id=thread_id,
        )
    except PermissionError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    except FileNotFoundError:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from None
    except FileIntegrityError:
        raise OctopError.localized(ErrorCode.FILE_INTEGRITY_FAILED) from None


def _text_media_type(filename: str) -> str:
    return {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".csv": "text/csv",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(Path(filename).suffix.lower(), "")


def _validate_text_artifact(filename: str, content: str, *, max_bytes: int) -> tuple[str, bytes]:
    extension = Path(filename).suffix.lower()
    media_type = _text_media_type(filename)
    if extension == ".docx":
        # shortcut: DOCX conversion is capped at 200k chars/10k lines; raise after conversion moves to the bounded file worker.
        if len(content) > 200_000 or content.count("\n") > 10_000:
            raise OctopError.localized(
                ErrorCode.DOCUMENT_CONVERSION_LIMIT,
                details={"max_characters": 200_000, "max_lines": 10_000},
            )
        if any(
            (ord(char) < 0x20 and char not in "\t\n\r")
            or 0xD800 <= ord(char) <= 0xDFFF
            or ord(char) in {0xFFFE, 0xFFFF}
            for char in content
        ):
            raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE)
        converter = get_doc_converter(filename)
        if converter is None:
            raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE)
        data = converter.from_markdown(content)
    else:
        data = content.encode("utf-8")
    if not media_type or (extension != ".docx" and b"\x00" in data):
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE)
    if len(data) > max_bytes:
        max_mb = max(1, max_bytes // (1024 * 1024))
        raise OctopError.localized(
            ErrorCode.ATTACHMENT_TOO_LARGE, max_mb=max_mb, details={"max_mb": max_mb}
        )
    return media_type, data


def _require_owned_thread(server: Any, *, thread_id: str, agent_id: str, user_id: int) -> None:
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    thread = server.services.thread_repo.get(thread_id)
    if thread is None or thread.agent_id != agent_id or thread.user_id != user_id:
        raise OctopError.localized(ErrorCode.NOT_FOUND)


async def _delete_unregistered_file(workspace: Any, path: str) -> None:
    try:
        await workspace.adelete(path)
    except Exception:
        logger.exception("failed to clean up unregistered file %s", path)


@router.post(
    "/agents/{agent_id}/threads/{thread_id}/files",
    status_code=201,
    response_model=FileDetailResponse,
    summary="Create a text file in a conversation",
    description=(
        "Creates an immutable TXT, MD, CSV or generated DOCX revision in the agent workspace and "
        "binds it to the current user's thread. DOCX content uses bounded Markdown conversion; "
        "the response contains metadata only."
    ),
)
async def create_text_artifact(
    agent_id: str,
    thread_id: str,
    body: TextArtifactCreateBody,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileDetailResponse:
    workspace = await require_running_workspace(agent_id, user=user, as_user=None, server=server)
    _require_owned_thread(server, thread_id=thread_id, agent_id=agent_id, user_id=int(user.id))
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    max_bytes = int(server.services.config.max_upload_bytes)
    media_type, data = await asyncio.get_running_loop().run_in_executor(
        None,
        partial(_validate_text_artifact, body.filename, body.content, max_bytes=max_bytes),
    )
    display_name = sanitize_inbound_filename(body.filename)
    stored = await save_attachment(
        workspace,
        owner_id=int(user.id),
        filename=f"{new_ulid()}-{display_name}",
        media_type=media_type,
        data=data,
        max_bytes=max_bytes,
    )
    file_id, revision_id = new_ulid(), new_ulid()
    try:
        await asyncio.get_running_loop().run_in_executor(
            None,
            partial(
                server.services.chat_file_repo.create_uploaded,
                file_id=file_id,
                revision_id=revision_id,
                user_id=int(user.id),
                agent_id=agent_id,
                display_name=display_name,
                workspace_path=stored.data_path,
                sha256=hashlib.sha256(data).hexdigest(),
                media_type=stored.media_type,
                byte_size=stored.size,
                thread_id=thread_id,
                origin_kind="generated",
            ),
        )
    except Exception:
        await _delete_unregistered_file(workspace, stored.data_path)
        raise
    response.headers["Cache-Control"] = "private, no-store"
    return FileDetailResponse.model_validate(
        _file_detail_response(server, file_id=file_id, user_id=int(user.id), agent_id=agent_id)
    )


@router.post(
    "/agents/{agent_id}/files/{file_id}/revisions",
    status_code=201,
    response_model=FileDetailResponse,
    responses={
        409: {
            "description": "The stale edit is preserved; error.details.revision_id identifies it."
        }
    },
    summary="Create a text file revision",
    description=(
        "Appends a TXT, MD, CSV or generated DOCX revision only when `base_revision_id` is still "
        "current. A stale revision returns 409 and leaves the existing revision unchanged."
    ),
)
async def create_text_artifact_revision(
    agent_id: str,
    file_id: str,
    body: TextArtifactRevisionBody,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileDetailResponse:
    workspace = await require_running_workspace(agent_id, user=user, as_user=None, server=server)
    _require_owned_thread(server, thread_id=body.thread_id, agent_id=agent_id, user_id=int(user.id))
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    owned = server.services.chat_file_repo.get_owned_revision(
        file_id=file_id,
        revision_id=body.base_revision_id,
        user_id=int(user.id),
        agent_id=agent_id,
        thread_id=body.thread_id,
    )
    if owned is None:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    file_row, base_revision = owned
    if (
        Path(file_row.display_name).suffix.lower() == ".docx"
        and base_revision.origin_kind != "generated"
    ):
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE)
    media_type, data = await asyncio.get_running_loop().run_in_executor(
        None,
        partial(
            _validate_text_artifact,
            file_row.display_name,
            body.content,
            max_bytes=int(server.services.config.max_upload_bytes),
        ),
    )
    max_bytes = int(server.services.config.max_upload_bytes)
    stored = await save_attachment(
        workspace,
        owner_id=int(user.id),
        filename=f"{new_ulid()}-{file_row.display_name}",
        media_type=media_type,
        data=data,
        max_bytes=max_bytes,
    )
    revision_id = new_ulid()
    try:
        await asyncio.get_running_loop().run_in_executor(
            None,
            partial(
                server.services.chat_file_repo.append_text_revision,
                file_id=file_id,
                revision_id=revision_id,
                expected_revision_id=body.base_revision_id,
                user_id=int(user.id),
                agent_id=agent_id,
                thread_id=body.thread_id,
                workspace_path=stored.data_path,
                sha256=hashlib.sha256(data).hexdigest(),
                media_type=stored.media_type,
                byte_size=stored.size,
            ),
        )
    except ChatFileRevisionConflict as exc:
        # Keep the losing edit as a branch revision so a concurrent draft is recoverable.
        raise OctopError.localized(
            ErrorCode.FILE_REVISION_CONFLICT,
            details={"revision_id": str(exc)},
        ) from exc
    except Exception:
        await _delete_unregistered_file(workspace, stored.data_path)
        raise
    response.headers["Cache-Control"] = "private, no-store"
    return FileDetailResponse.model_validate(
        _file_detail_response(server, file_id=file_id, user_id=int(user.id), agent_id=agent_id)
    )


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
    except UnsupportedFileTypeError as exc:
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE) from exc
    except FileParseError as exc:
        raise OctopError.localized(ErrorCode.FILE_READ_FAILED) from exc
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
        detail = _file_detail_response(
            server, file_id=file_id, user_id=int(user.id), agent_id=agent_id
        )
    except PermissionError as exc:
        raise OctopError.localized(ErrorCode.NOT_FOUND) from exc
    return FileDetailResponse.model_validate(detail)


@router.get(
    "/agents/{agent_id}/files/{file_id}/revisions/{revision_id}/content",
    summary="Download an owned conversation file revision",
    description=(
        "Streams a revision only after checking the current user owns its file metadata. "
        "The immutable content hash is verified before bytes are returned."
    ),
)
async def download_chat_file_revision(
    agent_id: str,
    file_id: str,
    revision_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    file_row, _revision, data = await _read_owned_revision_bytes(
        server,
        agent_id=agent_id,
        file_id=file_id,
        revision_id=revision_id,
        user=user,
    )
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": content_disposition(file_row.display_name),
            "Cache-Control": "private, no-store",
        },
    )


@router.get(
    "/agents/{agent_id}/files/{file_id}/revisions/{revision_id}/text",
    response_model=TextArtifactContentResponse,
    summary="Read an owned text artifact revision",
    description=(
        "Returns exact UTF-8 TXT/MD/CSV content or a generated DOCX revision converted to "
        "Markdown, after checking the owner, Agent, Thread and content hash. Uploaded DOCX "
        "files are not opened by the editor converter."
    ),
)
async def read_text_artifact_revision(
    agent_id: str,
    file_id: str,
    revision_id: str,
    response: Response,
    thread_id: str = Query(min_length=1, max_length=128),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> TextArtifactContentResponse:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    _file, revision, data = await _read_owned_revision_bytes(
        server,
        agent_id=agent_id,
        file_id=file_id,
        revision_id=revision_id,
        user=user,
        thread_id=thread_id,
    )
    converter = get_doc_converter(_file.display_name)
    if converter is not None and revision.origin_kind != "generated":
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE)
    if not _text_media_type(_file.display_name):
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE)
    try:
        if converter is not None:
            content = await asyncio.get_running_loop().run_in_executor(
                None, partial(converter.to_markdown, data)
            )
        else:
            content = data.decode("utf-8")
    except Exception as exc:
        # A persisted generated DOCX can still be an invalid ZIP/XML package after storage damage.
        raise OctopError.localized(ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE) from exc
    response.headers["Cache-Control"] = "private, no-store"
    return TextArtifactContentResponse(
        file_id=file_id,
        revision_id=revision.revision_id,
        content=content,
    )


@router.delete(
    "/agents/{agent_id}/files/{file_id}/draft",
    status_code=204,
    summary="Soft-delete an unbound chat attachment draft",
    description=(
        "Deletes only the current user's unbound upload draft. Files already attached to a "
        "conversation cannot be deleted through this endpoint."
    ),
)
async def delete_chat_file_draft(
    agent_id: str,
    file_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    require_agent_row(agent_id, user=user, as_user=None, server=server)
    if server.services is None:
        raise OctopError(ErrorCode.INTERNAL_ERROR, "file service is unavailable")
    deleted = server.services.chat_file_repo.delete_draft(
        file_id,
        user_id=int(user.id),
        agent_id=agent_id,
    )
    if deleted is None:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    registry = getattr(server.app_runtime, "agent_registry", None)
    workspace = registry.workspace_for_agent(agent_id) if registry is not None else None
    if workspace is None:
        logger.warning("deleted chat draft storage unavailable file_id=%s", file_id)
    else:
        for path in deleted:
            try:
                await workspace.adelete(path)
            except Exception:
                logger.warning("failed to remove deleted chat draft file_id=%s", file_id)
    return Response(status_code=204)


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
