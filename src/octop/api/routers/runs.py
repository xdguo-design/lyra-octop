"""Authenticated API for durable Run records and their event history."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal, cast
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, Query, Response
from pydantic import BaseModel, Field, field_validator

from octop.api.common.agent import require_agent_row
from octop.api.deps import current_user, get_server
from octop.infra.agents.versioning import capture_agent_version
from octop.infra.db.repos.runs import (
    STEP_ERROR_CODES,
    RunEventLimitExceeded,
    RunIdempotencyConflict,
)
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.utils.ulid import new_ulid

router = APIRouter()


def _run_artifact_response(artifact: dict[str, Any]) -> dict[str, Any]:
    return {
        **artifact,
        "content_url": (
            f"/api/agents/{quote(str(artifact['agent_id']), safe='')}/files/"
            f"{quote(str(artifact['file_id']), safe='')}/revisions/"
            f"{quote(str(artifact['revision_id']), safe='')}/content"
        ),
    }


RunStatus = Literal[
    "created",
    "queued",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "cancel_requested",
    "cancelled",
    "interrupted",
    "unknown_external_effect",
]


class RunSourceFileRef(BaseModel):
    file_id: str = Field(min_length=1, max_length=64)
    revision_id: str = Field(min_length=1, max_length=64)


class RunCreateBody(BaseModel):
    agent_id: str = Field(min_length=1, max_length=64, description="Accessible Octop agent.")
    project_id: str | None = Field(default=None, max_length=64)
    parent_run_id: str | None = Field(default=None, max_length=64)
    thread_id: str | None = Field(default=None, max_length=128)
    source_files: list[RunSourceFileRef] = Field(default_factory=list, max_length=50)
    input_ref: str | None = Field(
        default=None,
        max_length=512,
        description=(
            "Opaque input reference; this API does not dereference it. Executors must recheck "
            "ownership before reading it. Raw prompt content is not copied here."
        ),
    )

    @field_validator("agent_id", "project_id", "parent_run_id", "thread_id", "input_ref")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        if not text:
            raise ValueError("value cannot be blank")
        return text

    @field_validator("source_files")
    @classmethod
    def unique_source_files(cls, value: list[RunSourceFileRef]) -> list[RunSourceFileRef]:
        refs = [(item.file_id, item.revision_id) for item in value]
        if len(refs) != len(set(refs)):
            raise ValueError("source file revisions must be unique")
        return value


class CapabilityScopeSnapshot(BaseModel):
    registration_id: str
    app_key: str
    grant_id: str
    expires_at: int | None
    read_scopes: list[str]
    write_scopes: list[str]


class RunProjectContextSnapshot(BaseModel):
    project_id: str
    instructions_revision: int
    instructions: str
    knowledge_base_ids: list[str]


class RunSourceFileSnapshot(BaseModel):
    file_id: str
    revision_id: str
    thread_id: str
    content_hash: str
    media_type: str
    byte_size: int


class RunResponse(BaseModel):
    run_id: str
    project_id: str | None
    agent_id: str
    agent_version_id: str | None
    thread_id: str | None
    project_context_snapshot: RunProjectContextSnapshot | None
    source_file_revisions: list[RunSourceFileSnapshot]
    capability_scope_snapshot: list[CapabilityScopeSnapshot] = Field(
        description=(
            "Read-only creation-time scope snapshot for audit; it does not grant execution "
            "permission, which must be checked again when a tool runs."
        )
    )
    status: RunStatus
    created_at: int
    updated_at: int
    started_at: int | None
    finished_at: int | None


class RunEventResponse(BaseModel):
    event_id: str
    run_id: str
    step_id: str | None
    sequence: int
    type: str
    payload: dict[str, str]
    created_at: int


class RunStepResponse(BaseModel):
    step_id: str
    run_id: str
    kind: str
    executor: str
    status: str
    attempt: int
    created_at: int
    updated_at: int
    started_at: int | None
    finished_at: int | None


class TeamRunChildResponse(BaseModel):
    run_id: str
    agent_id: str
    status: RunStatus
    created_at: int
    updated_at: int
    started_at: int | None
    finished_at: int | None


class RunEffectResponse(BaseModel):
    effect_id: str
    run_id: str
    step_id: str | None
    agent_id: str
    registration_id: str
    approval_id: str
    approved_by_user_id: int
    approval_expires_at: int
    scope: str
    resource_hash: str
    request_hash: str
    result_hash: str | None
    status: Literal["requested", "succeeded", "failed", "unknown"]
    created_at: int
    updated_at: int


class RunArtifactCreateBody(BaseModel):
    file_id: str = Field(min_length=1, max_length=64)
    revision_id: str = Field(min_length=1, max_length=64)


class RunArtifactResponse(BaseModel):
    artifact_id: str
    run_id: str | None
    project_id: str | None
    agent_id: str
    thread_id: str
    file_id: str
    revision_id: str
    display_name: str
    content_hash: str
    media_type: str
    byte_size: int
    origin_kind: str
    created_at: int
    content_url: str


_SAFE_RUN_STATES = frozenset(
    {
        "created",
        "queued",
        "running",
        "waiting_approval",
        "succeeded",
        "failed",
        "cancel_requested",
        "cancelled",
        "interrupted",
        "unknown_external_effect",
    }
)


def _safe_event_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {}
    safe: dict[str, str] = {}
    for key in ("from", "to"):
        value = payload.get(key)
        if isinstance(value, str) and value in _SAFE_RUN_STATES:
            safe[key] = value
    error_code = payload.get("error_code")
    if isinstance(error_code, str) and error_code in STEP_ERROR_CODES:
        safe["error_code"] = error_code
    if payload.get("source") == "team":
        safe["source"] = "team"
    kind = payload.get("kind")
    if isinstance(kind, str) and kind in {"agent", "team_dispatch", "tool", "retrieval"}:
        safe["kind"] = kind
    return safe


@router.post(
    "/runs",
    status_code=201,
    summary="Create a durable run record",
    response_model=RunResponse,
    responses={200: {"model": RunResponse, "description": "Previously created run returned."}},
    description=(
        "Creates a persisted Run in `created` state. This endpoint records the task; it does not "
        "start an executor. Use the Idempotency-Key header to safely retry creation; an identical "
        "retry returns the existing Run with HTTP 200. Capability scopes are snapshotted for audit "
        "only; execution must recheck the current grant."
    ),
)
async def create_run(
    body: RunCreateBody,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=128),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    require_agent_row(body.agent_id, user=user, as_user=None, server=server)
    agent_row = server.services.agent_repo.get(body.agent_id)
    if agent_row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {body.agent_id!r} not found")
    project_context_snapshot = None
    if body.project_id is not None:
        project_context = server.services.workbench_repo.get_project_context(
            owner_user_id=user.id, project_id=body.project_id
        )
        if project_context is None:
            raise OctopError(ErrorCode.NOT_FOUND, "workbench project not found")
        visible_knowledge_bases = {
            base.id for base in server.services.knowledge_repo.list_visible(user.id)
        }
        knowledge_base_ids = project_context["knowledge_base_ids"]
        if any(base_id not in visible_knowledge_bases for base_id in knowledge_base_ids):
            raise OctopError(ErrorCode.NOT_FOUND, "project knowledge base not found")
        project_context_snapshot = {
            "project_id": body.project_id,
            "instructions_revision": project_context["instructions_revision"],
            "instructions": project_context["instructions"],
            "knowledge_base_ids": knowledge_base_ids,
        }
    source_file_revisions: list[dict[str, Any]] = []
    if body.source_files:
        if body.thread_id is None:
            raise OctopError(ErrorCode.NOT_FOUND, "source file thread not found")
        file_repo = server.services.chat_file_repo
        for source in body.source_files:
            owned = file_repo.get_owned_revision(
                file_id=source.file_id,
                revision_id=source.revision_id,
                user_id=int(user.id),
                agent_id=body.agent_id,
                thread_id=body.thread_id,
            )
            if owned is None:
                raise OctopError(ErrorCode.NOT_FOUND, "source file revision not found")
            file_row, revision = owned
            source_file_revisions.append(
                {
                    "file_id": file_row.file_id,
                    "revision_id": revision.revision_id,
                    "thread_id": body.thread_id,
                    "content_hash": revision.sha256,
                    "media_type": revision.media_type,
                    "byte_size": revision.byte_size,
                }
            )
    if (
        body.parent_run_id is not None
        and server.services.run_repo.get(body.parent_run_id, owner_user_id=user.id) is None
    ):
        raise OctopError(ErrorCode.NOT_FOUND, "parent run not found")

    key = idempotency_key.strip() if idempotency_key is not None else None
    if key == "":
        key = None
    request_body = body.model_dump(mode="json")
    request_hash = hashlib.sha256(
        json.dumps(request_body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    try:
        existing = (
            server.services.run_repo.find_idempotent(
                owner_user_id=int(user.id), idempotency_key=key, request_hash=request_hash
            )
            if key is not None
            else None
        )
    except RunIdempotencyConflict as exc:
        raise OctopError.localized(ErrorCode.RUN_IDEMPOTENCY_CONFLICT) from exc
    if existing is not None:
        response.status_code = 200
        return cast(dict[str, Any], existing)
    agent_version = capture_agent_version(
        agent_row,
        created_by=int(user.id),
        version_repo=server.services.agent_version_repo,
        secret_repo=server.services.secret_repo,
    )
    try:
        run, replayed = server.services.run_repo.create(
            run_id=new_ulid(),
            owner_user_id=user.id,
            agent_id=body.agent_id,
            project_id=body.project_id,
            parent_run_id=body.parent_run_id,
            thread_id=body.thread_id,
            input_ref=body.input_ref,
            idempotency_key=key,
            request_hash=request_hash,
            project_context_snapshot=project_context_snapshot,
            source_file_revisions=source_file_revisions,
            capability_scope_snapshot=server.services.app_registry_repo.effective_scope_snapshot(
                owner_user_id=int(user.id), agent_id=body.agent_id
            ),
            agent_version_id=agent_version.version_id,
        )
    except RunIdempotencyConflict as exc:
        raise OctopError.localized(ErrorCode.RUN_IDEMPOTENCY_CONFLICT) from exc
    if replayed:
        response.status_code = 200
    return cast(dict[str, Any], run)


@router.get("/runs", summary="List the current user's runs", response_model=list[RunResponse])
async def list_runs(
    project_id: str | None = Query(default=None, max_length=64),
    status: RunStatus | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    if project_id is not None:
        project_ids = {
            item["project_id"]
            for item in server.services.workbench_repo.list_index(user.id)["projects"]
        }
        if project_id not in project_ids:
            raise OctopError(ErrorCode.NOT_FOUND, "workbench project not found")
    return cast(
        list[dict[str, Any]],
        server.services.run_repo.list_by_owner(
            owner_user_id=user.id,
            project_id=project_id,
            status=status,
            limit=limit,
            offset=offset,
        ),
    )


@router.post(
    "/runs/{run_id}/start",
    summary="Queue a run from a saved chat message",
    response_model=RunResponse,
    description=(
        "Queues a created Run whose input_ref is the ID of a persisted user message in its bound "
        "thread. Ownership, agent, thread, and message role are checked before queueing and again "
        "by the executor."
    ),
)
async def start_run(
    run_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    run = server.services.run_repo.get(run_id, owner_user_id=int(user.id))
    if run is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    thread_id = run.get("thread_id")
    message_id = run.get("input_ref")
    if not thread_id or not message_id:
        raise OctopError.localized(ErrorCode.RUN_INPUT_REQUIRED)
    thread = server.services.thread_repo.get(str(thread_id))
    if thread is None or int(thread.user_id) != int(user.id) or thread.agent_id != run["agent_id"]:
        raise OctopError(ErrorCode.NOT_FOUND, "run input not found")
    message = server.services.thread_message_repo.get_by_message_id(str(thread_id), str(message_id))
    if message is None or message.role not in {"human", "user"}:
        raise OctopError(ErrorCode.NOT_FOUND, "run input not found")
    if run["status"] != "created":
        return cast(dict[str, Any], run)
    queued = server.services.run_repo.transition(
        run_id,
        owner_user_id=int(user.id),
        status="queued",
        expected_version=int(run["version"]),
    )
    if queued is None:
        current = server.services.run_repo.get(run_id, owner_user_id=int(user.id))
        if current is not None and current["status"] != "created":
            return cast(dict[str, Any], current)
        raise OctopError.localized(ErrorCode.RUN_STATE_CONFLICT)
    return cast(dict[str, Any], queued)


@router.get("/runs/{run_id}", summary="Get a run", response_model=RunResponse)
async def get_run(
    run_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    run = server.services.run_repo.get(run_id, owner_user_id=user.id)
    if run is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    return cast(dict[str, Any], run)


@router.get(
    "/runs/{run_id}/children",
    summary="List team dispatch runs for a parent run",
    response_model=list[TeamRunChildResponse],
)
async def list_run_children(
    run_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    children = server.services.run_repo.list_children(run_id, owner_user_id=int(user.id))
    if children is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    return cast(list[dict[str, Any]], children)


@router.post(
    "/runs/{run_id}/artifacts",
    status_code=201,
    summary="Attach an immutable conversation file revision to a run",
    response_model=RunArtifactResponse,
    responses={200: {"model": RunArtifactResponse, "description": "Artifact already attached."}},
    description=(
        "Registers an existing file revision as a Run artifact. The revision must belong to the "
        "Run owner's agent and thread; retries for the same revision are idempotent."
    ),
)
async def attach_run_artifact(
    run_id: str,
    body: RunArtifactCreateBody,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    result = server.services.run_repo.attach_artifact(
        artifact_id=new_ulid(),
        run_id=run_id,
        owner_user_id=int(user.id),
        file_id=body.file_id,
        revision_id=body.revision_id,
    )
    if result is None:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    artifact, replayed = result
    if replayed:
        response.status_code = 200
    response.headers["Cache-Control"] = "private, no-store"
    return _run_artifact_response(artifact)


@router.get(
    "/runs/{run_id}/artifacts",
    summary="List artifacts attached to a run",
    response_model=list[RunArtifactResponse],
    description="Returns owner-scoped Artifact metadata and authenticated content URLs, never storage paths.",
)
async def list_run_artifacts(
    run_id: str,
    response: Response,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    artifacts = server.services.run_repo.list_artifacts(run_id, owner_user_id=int(user.id))
    if artifacts is None:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    response.headers["Cache-Control"] = "private, no-store"
    return [_run_artifact_response(artifact) for artifact in artifacts]


@router.get(
    "/runs/projects/{project_id}/artifacts",
    summary="List artifacts produced by a project",
    response_model=list[RunArtifactResponse],
    description=(
        "Returns one owner-scoped entry per immutable revision attached to a Run in this project. "
        "The artifact ID is the same revision ID used by Chat and Run views."
    ),
)
async def list_project_artifacts(
    project_id: str,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    project_ids = {
        item["project_id"]
        for item in server.services.workbench_repo.list_index(int(user.id))["projects"]
    }
    if project_id not in project_ids:
        raise OctopError(ErrorCode.NOT_FOUND, "workbench project not found")
    artifacts = server.services.run_repo.list_project_artifacts(
        project_id,
        owner_user_id=int(user.id),
        limit=limit,
        offset=offset,
    )
    response.headers["Cache-Control"] = "private, no-store"
    return [_run_artifact_response(artifact) for artifact in artifacts]


@router.get(
    "/runs/{run_id}/effects",
    summary="List external side effects recorded for a run",
    response_model=list[RunEffectResponse],
    description=(
        "Returns owner-scoped effect ledger metadata. Request and resource bodies are never "
        "stored; only hashes, scope, approval reference, and reconciliation status are returned."
    ),
)
async def list_run_effects(
    run_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    if server.services.run_repo.get(run_id, owner_user_id=user.id) is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    return cast(
        list[dict[str, Any]],
        server.services.run_effect_repo.list_for_run(run_id, owner_user_id=user.id),
    )


@router.post(
    "/runs/{run_id}/cancel",
    summary="Request cancellation of a run",
    response_model=RunResponse,
    description=(
        "Cancels a run that has not started or is waiting for approval. For queued or running "
        "work, records a durable cancel_requested state and signals Team Inbox dispatches; "
        "cancellation does not roll back external effects."
    ),
)
async def cancel_run(
    run_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    run = server.services.run_repo.get(run_id, owner_user_id=user.id)
    if run is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    if run["status"] == "waiting_approval":
        try:
            cancelled = server.services.run_repo.transition(
                run_id,
                owner_user_id=user.id,
                status="cancelled",
                expected_version=int(run["version"]),
            )
        except RunEventLimitExceeded as exc:
            raise OctopError.localized(ErrorCode.RUN_EVENT_LIMIT_EXCEEDED) from exc
        if cancelled is not None:
            for step in server.services.run_repo.list_steps(run_id, owner_user_id=user.id):
                if step["status"] == "waiting_approval":
                    server.services.run_repo.transition_step(
                        str(step["step_id"]),
                        owner_user_id=user.id,
                        status="cancelled",
                        expected_version=int(step["version"]),
                    )
            coordinator = server.app_runtime.gateway.processor.hitl_coordinator
            for pending in coordinator.list_pending_for_thread(
                str(run.get("thread_id") or ""),
                agent_id=str(run["agent_id"]),
                user_id=int(user.id),
            ):
                if pending.run_id == run_id:
                    coordinator.mark_resolved(pending.pending_id, "expired")
            await server.app_runtime.gateway.processor.teams.cancel_run_dispatches(
                run_id, owner_user_id=int(user.id)
            )
            return cast(dict[str, Any], cancelled)
        current = server.services.run_repo.get(run_id, owner_user_id=user.id)
        if current is None:
            raise OctopError(ErrorCode.NOT_FOUND, "run not found")
        if current["status"] in {"cancel_requested", "cancelled"}:
            await server.app_runtime.gateway.processor.teams.cancel_run_dispatches(
                run_id, owner_user_id=int(user.id)
            )
        return cast(dict[str, Any], current)
    next_status = {
        "created": "cancelled",
        "queued": "cancel_requested",
        "running": "cancel_requested",
        "waiting_approval": "cancel_requested",
    }.get(str(run["status"]))
    if next_status is None:
        if run["status"] in {"cancel_requested", "cancelled"}:
            await server.app_runtime.gateway.processor.teams.cancel_run_dispatches(
                run_id, owner_user_id=int(user.id)
            )
        return cast(dict[str, Any], run)
    try:
        changed = server.services.run_repo.transition(
            run_id,
            owner_user_id=user.id,
            status=next_status,
            expected_version=int(run["version"]),
        )
    except RunEventLimitExceeded as exc:
        raise OctopError.localized(ErrorCode.RUN_EVENT_LIMIT_EXCEEDED) from exc
    if changed is not None:
        if next_status == "cancel_requested":
            await server.app_runtime.gateway.processor.teams.cancel_run_dispatches(
                run_id, owner_user_id=int(user.id)
            )
            current = server.services.run_repo.get(run_id, owner_user_id=user.id)
            if current is not None:
                return cast(dict[str, Any], current)
        return cast(dict[str, Any], changed)
    current = server.services.run_repo.get(run_id, owner_user_id=user.id)
    if current is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    if current["status"] in {"cancel_requested", "cancelled"}:
        await server.app_runtime.gateway.processor.teams.cancel_run_dispatches(
            run_id, owner_user_id=int(user.id)
        )
    return cast(dict[str, Any], current)


@router.get(
    "/runs/{run_id}/events",
    summary="List run events after a sequence number",
    response_model=list[RunEventResponse],
)
async def list_run_events(
    run_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    if server.services.run_repo.get(run_id, owner_user_id=user.id) is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    events = server.services.run_repo.list_events(
        run_id, owner_user_id=user.id, after_sequence=after_sequence, limit=limit
    )
    return [{**event, "payload": _safe_event_payload(event.get("payload"))} for event in events]


@router.get(
    "/runs/{run_id}/steps",
    summary="List steps for a run",
    response_model=list[RunStepResponse],
)
async def list_run_steps(
    run_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    if server.services.run_repo.get(run_id, owner_user_id=user.id) is None:
        raise OctopError(ErrorCode.NOT_FOUND, "run not found")
    return cast(
        list[dict[str, Any]],
        server.services.run_repo.list_steps(run_id, owner_user_id=user.id),
    )
