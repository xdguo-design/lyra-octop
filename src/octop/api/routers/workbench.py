"""Account-owned workbench projects, task grouping, and read-only code browsing."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import secrets
import time
from typing import Any, cast

import httpx
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, field_validator

from octop.api.deps import current_user, get_server
from octop.infra.db.repos.workbench import WorkbenchContextConflict
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.workbench.code_browser import (
    CodeBrowseError,
    list_code_directory,
    read_code_file,
)

router = APIRouter()


def _audit_project_action(
    server: Any,
    user: Any,
    action: str,
    project_id: str,
    target: str | None = None,
    payload: str | None = None,
) -> None:
    server.services.audit_repo.write(
        actor=user.username,
        action=action,
        target=target,
        payload=payload,
        project_id=project_id,
    )


class WorkbenchProject(BaseModel):
    project_id: str
    name: str
    icon: str
    parent_id: str | None = None
    external_url: str | None = None
    code_enabled: bool
    knowledge_base_ids: list[str] = Field(default_factory=list)
    created_at: int
    updated_at: int


class ProjectContextResponse(BaseModel):
    project_id: str
    instructions: str
    instructions_revision: int
    knowledge_base_ids: list[str]
    updated_at: int


class ProjectInstructionsBody(BaseModel):
    instructions: str = Field(max_length=20_000, description="Project instructions for new runs.")
    expected_revision: int = Field(ge=1, description="Revision returned by the context read.")


class WorkbenchFolder(BaseModel):
    folder_id: str
    project_id: str
    name: str
    created_at: int
    updated_at: int


class WorkbenchAssignment(BaseModel):
    thread_id: str
    project_id: str | None
    folder_id: str | None


class WorkbenchIndex(BaseModel):
    projects: list[WorkbenchProject]
    folders: list[WorkbenchFolder]
    recycled_folders: list[WorkbenchFolder] = Field(default_factory=list)
    assignments: list[WorkbenchAssignment]


class ProjectBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(default="📁", min_length=1, max_length=16)
    parent_id: str | None = None
    external_url: str | None = None
    code_enabled: bool | None = None

    @field_validator("name", "icon")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value cannot be blank")
        return value


class FolderBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("folder name cannot be blank")
        return value


class AssignmentBody(BaseModel):
    project_id: str | None
    folder_id: str | None = None


class ProjectKnowledgeBasesBody(BaseModel):
    knowledge_base_ids: list[str] = Field(max_length=100)


class LegacyProject(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    thread_ids: list[str] = Field(default_factory=list, max_length=1000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("project name cannot be blank")
        return value


class LegacyImportBody(BaseModel):
    projects: list[LegacyProject] = Field(max_length=100)


class CodeEntry(BaseModel):
    name: str
    path: str
    is_directory: bool
    size: int | None


class CodeDirectory(BaseModel):
    path: str
    entries: list[CodeEntry]


class CodeFile(BaseModel):
    path: str
    content: str
    size: int


class ProjectShareBody(BaseModel):
    expires_in_seconds: int = Field(ge=3600, le=30 * 24 * 60 * 60)


class ProjectShare(BaseModel):
    share_id: str
    project_id: str
    created_at: int
    expires_at: int
    revoked_at: int | None = None


class CreatedProjectShare(ProjectShare):
    token: str


def _share_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _not_found(message: str = "workbench item not found") -> OctopError:
    return OctopError(ErrorCode.NOT_FOUND, message)


def _validate_project_parent(
    repo: Any, owner_user_id: int, project_id: str | None, parent_id: str | None
) -> None:
    """A project may only nest under an existing project outside its own subtree."""
    if parent_id is None or project_id is None:
        return
    if parent_id == project_id:
        raise OctopError(ErrorCode.FORBIDDEN, "project cannot be its own parent")
    projects = {item["project_id"]: item for item in repo.list_index(owner_user_id)["projects"]}
    parent = projects.get(parent_id)
    if parent is None:
        raise _not_found("parent project not found")
    seen: set[str] = set()
    cursor: str | None = parent_id
    while cursor is not None and cursor not in seen:
        if cursor == project_id:
            raise OctopError(ErrorCode.FORBIDDEN, "project cannot nest under its own subtree")
        seen.add(cursor)
        cursor = projects.get(cursor, {}).get("parent_id")


@router.get(
    "/workbench",
    summary="List workbench projects and task assignments",
    response_model=WorkbenchIndex,
)
async def list_workbench(
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return cast(dict[str, Any], server.services.workbench_repo.list_index(user.id))


@router.post(
    "/workbench/import-local", status_code=204, summary="Import browser-local projects once"
)
async def import_local_projects(
    body: LegacyImportBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    before = {
        item["project_id"]
        for item in server.services.workbench_repo.list_index(user.id)["projects"]
    }
    server.services.workbench_repo.import_legacy_projects(
        owner_user_id=user.id,
        projects=[
            {"name": item.name, "thread_ids": list(dict.fromkeys(item.thread_ids))}
            for item in body.projects
        ],
    )
    for item in server.services.workbench_repo.list_index(user.id)["projects"]:
        if item["project_id"] not in before:
            _audit_project_action(
                server, user, "workbench.project.create", item["project_id"], payload=item["name"]
            )
    return Response(status_code=204)


@router.post(
    "/workbench/projects",
    status_code=201,
    summary="Create a workbench project",
    response_model=WorkbenchProject,
)
async def create_project(
    body: ProjectBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    if body.code_enabled is True and not bool(getattr(user, "is_admin", False)):
        raise OctopError(ErrorCode.FORBIDDEN, "only administrators can enable code browsing")
    repo = server.services.workbench_repo
    _validate_project_parent(repo, user.id, None, body.parent_id)
    row = repo.create_project(
        owner_user_id=user.id,
        name=body.name,
        icon=body.icon,
        parent_id=body.parent_id,
        external_url=body.external_url,
        code_enabled=bool(body.code_enabled and getattr(user, "is_admin", False)),
    )
    if row is None:
        raise _not_found("parent project not found")
    _audit_project_action(
        server, user, "workbench.project.create", row["project_id"], payload=row["name"]
    )
    return cast(dict[str, Any], row)


_GITHUB_URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$",
    re.IGNORECASE,
)
_GITHUB_SLUG_RE = re.compile(r"^([\w.-]+)/([\w.-]+?)(?:\.git)?$")
_GITHUB_ICON = "🐙"


class GithubImportBody(BaseModel):
    ref: str = Field(min_length=3, max_length=300)

    @field_validator("ref")
    @classmethod
    def strip_ref(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("repository reference cannot be blank")
        return value


def _parse_github_ref(ref: str) -> tuple[str, str]:
    match = _GITHUB_URL_RE.match(ref) or _GITHUB_SLUG_RE.match(ref)
    if match is None:
        raise OctopError(
            ErrorCode.NOT_FOUND,
            "unrecognized GitHub repository reference",
        )
    return match.group(1), match.group(2)


@router.post(
    "/workbench/projects/from-github",
    status_code=201,
    summary="Mount a public GitHub repository as a workbench project",
    response_model=WorkbenchProject,
)
async def import_github_project(
    body: GithubImportBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    repo = server.services.workbench_repo
    owner, name = _parse_github_ref(body.ref)
    api_url = f"https://api.github.com/repos/{owner}/{name}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                api_url,
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "octop-workbench",
                },
            )
    except httpx.HTTPError as exc:
        raise OctopError(
            ErrorCode.NOT_FOUND, "cannot reach GitHub to resolve the repository"
        ) from exc
    if resp.status_code == 404:
        raise OctopError(ErrorCode.NOT_FOUND, "GitHub repository not found or not public")
    if resp.status_code in (403, 429):
        raise OctopError(ErrorCode.FORBIDDEN, "GitHub API rate limited")
    if resp.status_code != 200:
        raise OctopError(ErrorCode.NOT_FOUND, "GitHub repository lookup failed")
    data = resp.json()
    html_url = str(data.get("html_url") or f"https://github.com/{owner}/{name}")
    existing = repo.find_project_by_external_url(owner_user_id=user.id, external_url=html_url)
    if existing is not None:
        return cast(dict[str, Any], existing)
    repo_name = str(data.get("name") or name)[:80].strip() or name[:80]
    row = repo.create_project(
        owner_user_id=user.id,
        name=repo_name,
        icon=_GITHUB_ICON,
        external_url=html_url,
    )
    if row is None:
        raise _not_found("workbench project not found")
    _audit_project_action(
        server, user, "workbench.project.create", row["project_id"], payload=row["name"]
    )
    return cast(dict[str, Any], row)


@router.put(
    "/workbench/projects/{project_id}",
    summary="Rename a project or change its icon",
    response_model=WorkbenchProject,
)
async def update_project(
    project_id: str,
    body: ProjectBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    if body.code_enabled is True and not bool(getattr(user, "is_admin", False)):
        raise OctopError(ErrorCode.FORBIDDEN, "only administrators can enable code browsing")
    repo = server.services.workbench_repo
    parent_set = "parent_id" in body.model_fields_set
    if parent_set:
        _validate_project_parent(repo, user.id, project_id, body.parent_id)
    if not repo.update_project(
        owner_user_id=user.id,
        project_id=project_id,
        name=body.name,
        icon=body.icon,
        parent_id=body.parent_id,
        parent_id_set=parent_set,
        code_enabled=body.code_enabled if bool(getattr(user, "is_admin", False)) else None,
    ):
        raise _not_found("workbench project not found")
    row = next(
        (item for item in repo.list_index(user.id)["projects"] if item["project_id"] == project_id),
        None,
    )
    if row is None:
        raise _not_found("workbench project not found")
    _audit_project_action(server, user, "workbench.project.update", project_id, payload=row["name"])
    return cast(dict[str, Any], row)


@router.get(
    "/workbench/projects/{project_id}/context",
    summary="Read project instructions and knowledge bindings",
    response_model=ProjectContextResponse,
)
async def get_project_context(
    project_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    context = server.services.workbench_repo.get_project_context(
        owner_user_id=user.id, project_id=project_id
    )
    if context is None:
        raise _not_found("workbench project not found")
    return cast(dict[str, Any], context)


@router.put(
    "/workbench/projects/{project_id}/context",
    summary="Update project instructions using a revision check",
    response_model=ProjectContextResponse,
    description="A stale expected_revision is rejected without overwriting newer instructions.",
)
async def update_project_context(
    project_id: str,
    body: ProjectInstructionsBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    try:
        context = server.services.workbench_repo.update_project_instructions(
            owner_user_id=user.id,
            project_id=project_id,
            instructions=body.instructions,
            expected_revision=body.expected_revision,
        )
    except WorkbenchContextConflict as exc:
        raise OctopError.localized(ErrorCode.WORKBENCH_CONTEXT_CONFLICT) from exc
    if context is None:
        raise _not_found("workbench project not found")
    _audit_project_action(
        server,
        user,
        "workbench.project.context.update",
        project_id,
        payload=f"revision={context['instructions_revision']}",
    )
    return cast(dict[str, Any], context)


@router.put(
    "/workbench/projects/{project_id}/knowledge-bases",
    summary="Set knowledge bases used by project conversations",
    response_model=list[str],
)
async def set_project_knowledge_bases(
    project_id: str,
    body: ProjectKnowledgeBasesBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[str]:
    repo = server.services.workbench_repo
    ids = list(dict.fromkeys(item.strip() for item in body.knowledge_base_ids if item.strip()))
    visible = {base.id for base in server.services.knowledge_repo.list_visible(user.id)}
    if any(item not in visible for item in ids):
        raise _not_found("knowledge base not found")
    if not repo.set_project_knowledge_bases(
        owner_user_id=user.id, project_id=project_id, knowledge_base_ids=ids
    ):
        raise _not_found("workbench project not found")
    _audit_project_action(
        server,
        user,
        "workbench.project.knowledge_bases.update",
        project_id,
        payload=json.dumps(ids, ensure_ascii=False),
    )
    return ids


@router.delete(
    "/workbench/projects/{project_id}",
    status_code=204,
    summary="Delete a project and ungroup its tasks",
)
async def delete_project(
    project_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    project = next(
        (
            item
            for item in server.services.workbench_repo.list_index(user.id)["projects"]
            if item["project_id"] == project_id
        ),
        None,
    )
    if not server.services.workbench_repo.delete_project(
        owner_user_id=user.id, project_id=project_id
    ):
        raise _not_found("workbench project not found")
    _audit_project_action(
        server,
        user,
        "workbench.project.delete",
        project_id,
        payload=project["name"] if project else None,
    )
    return Response(status_code=204)


@router.post(
    "/workbench/projects/{project_id}/folders",
    status_code=201,
    summary="Create a project folder",
    response_model=WorkbenchFolder,
)
async def create_folder(
    project_id: str,
    body: FolderBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = server.services.workbench_repo.create_folder(
        owner_user_id=user.id, project_id=project_id, name=body.name
    )
    if row is None:
        raise _not_found("workbench project not found")
    _audit_project_action(
        server, user, "workbench.folder.create", project_id, row["folder_id"], row["name"]
    )
    return cast(dict[str, Any], row)


@router.patch(
    "/workbench/folders/{folder_id}",
    summary="Rename a project folder",
    response_model=WorkbenchFolder,
)
async def rename_folder(
    folder_id: str,
    body: FolderBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    repo = server.services.workbench_repo
    if not repo.update_folder(owner_user_id=user.id, folder_id=folder_id, name=body.name):
        raise _not_found("workbench folder not found")
    row = next(
        (item for item in repo.list_index(user.id)["folders"] if item["folder_id"] == folder_id),
        None,
    )
    if row is None:
        raise _not_found("workbench folder not found")
    _audit_project_action(
        server, user, "workbench.folder.update", row["project_id"], folder_id, row["name"]
    )
    return cast(dict[str, Any], row)


@router.delete(
    "/workbench/folders/{folder_id}",
    status_code=204,
    summary="Move a project folder to the recycle bin",
)
async def delete_folder(
    folder_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    folder = next(
        (
            item
            for item in server.services.workbench_repo.list_index(user.id)["folders"]
            if item["folder_id"] == folder_id
        ),
        None,
    )
    if not server.services.workbench_repo.delete_folder(owner_user_id=user.id, folder_id=folder_id):
        raise _not_found("workbench folder not found")
    if folder:
        _audit_project_action(
            server,
            user,
            "workbench.folder.delete",
            folder["project_id"],
            folder_id,
            folder["name"],
        )
    return Response(status_code=204)


@router.post(
    "/workbench/folders/{folder_id}/restore",
    status_code=204,
    summary="Restore a project folder from the recycle bin",
)
async def restore_folder(
    folder_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    repo = server.services.workbench_repo
    folder = next(
        (
            item
            for item in repo.list_index(user.id)["recycled_folders"]
            if item["folder_id"] == folder_id
        ),
        None,
    )
    if folder is None or not repo.restore_folder(owner_user_id=user.id, folder_id=folder_id):
        raise _not_found("workbench folder not found in recycle bin")
    _audit_project_action(
        server, user, "workbench.folder.restore", folder["project_id"], folder_id, folder["name"]
    )
    return Response(status_code=204)


@router.put(
    "/workbench/threads/{thread_id}/assignment",
    summary="Move a task into a project or folder",
    response_model=WorkbenchAssignment,
)
async def assign_thread(
    thread_id: str,
    body: AssignmentBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    repo = server.services.workbench_repo
    old = next(
        (
            item
            for item in repo.list_index(user.id)["assignments"]
            if item["thread_id"] == thread_id
        ),
        None,
    )
    if not repo.assign_thread(
        owner_user_id=user.id,
        thread_id=thread_id,
        project_id=body.project_id,
        folder_id=body.folder_id,
    ):
        raise _not_found("thread, project, or folder not found")
    if old is None or old["project_id"] != body.project_id or old["folder_id"] != body.folder_id:
        project_ids = {
            project_id
            for project_id in (old["project_id"] if old else None, body.project_id)
            if project_id is not None
        }
        for project_id in project_ids:
            _audit_project_action(
                server,
                user,
                "workbench.thread.assign",
                project_id,
                thread_id,
                json.dumps(
                    {
                        "from_project_id": old["project_id"] if old else None,
                        "to_project_id": body.project_id,
                        "folder_id": body.folder_id,
                    },
                    ensure_ascii=False,
                ),
            )
    return {
        "thread_id": thread_id,
        "project_id": body.project_id,
        "folder_id": body.folder_id,
    }


@router.post(
    "/workbench/projects/{project_id}/shares",
    status_code=201,
    summary="Create a time-limited read-only project share link",
    response_model=CreatedProjectShare,
)
async def create_project_share(
    project_id: str,
    body: ProjectShareBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + body.expires_in_seconds
    row = server.services.workbench_repo.create_project_share(
        owner_user_id=user.id,
        project_id=project_id,
        token_hash=_share_token_hash(token),
        expires_at=expires_at,
    )
    if row is None:
        raise _not_found("workbench project not found")
    _audit_project_action(server, user, "workbench.project.share", project_id, row["share_id"])
    return {**row, "token": token}


@router.get(
    "/workbench/projects/{project_id}/shares",
    summary="List project share links",
    response_model=list[ProjectShare],
)
async def list_project_shares(
    project_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    repo = server.services.workbench_repo
    if not any(
        project["project_id"] == project_id for project in repo.list_index(user.id)["projects"]
    ):
        raise _not_found("workbench project not found")
    shares: list[dict[str, Any]] = repo.list_project_shares(
        owner_user_id=user.id, project_id=project_id
    )
    return shares


@router.delete(
    "/workbench/projects/{project_id}/shares/{share_id}",
    status_code=204,
    summary="Revoke a project share link",
)
async def revoke_project_share(
    project_id: str,
    share_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    if not server.services.workbench_repo.revoke_project_share(
        owner_user_id=user.id, project_id=project_id, share_id=share_id
    ):
        raise _not_found("workbench share not found")
    _audit_project_action(server, user, "workbench.project.unshare", project_id, share_id)
    return Response(status_code=204)


@router.get(
    "/workbench-shares/{token}",
    summary="Read a shared workbench project without signing in",
)
async def get_shared_project(
    token: str,
    response: Response,
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    share = server.services.workbench_repo.get_project_share(
        _share_token_hash(token), now=int(time.time())
    )
    if share is None:
        raise _not_found("shared project not found")
    data = server.services.workbench_repo.get_shared_project_data(
        owner_user_id=share["owner_user_id"], project_id=share["project_id"]
    )
    project = next(
        (item for item in data["projects"] if item["project_id"] == share["project_id"]), None
    )
    if project is None:
        raise _not_found("shared project not found")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    return {
        "project": project,
        "projects": data["projects"],
        "folders": data["folders"],
        "threads": data["threads"],
        "expires_at": share["expires_at"],
        "timezone": server.services.config.default_timezone,
    }


@router.get(
    "/workbench-shares/{token}/threads/{thread_id}",
    summary="Read a shared task conversation",
)
async def get_shared_thread_history(
    token: str,
    thread_id: str,
    response: Response,
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100_000),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    share = server.services.workbench_repo.get_project_share(
        _share_token_hash(token), now=int(time.time())
    )
    if share is None:
        raise _not_found("shared project not found")
    data = server.services.workbench_repo.get_shared_project_data(
        owner_user_id=share["owner_user_id"], project_id=share["project_id"]
    )
    if not any(item["thread_id"] == thread_id for item in data["threads"]):
        raise _not_found("shared task not found")

    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
    message_repo = server.services.thread_message_repo
    from langchain_core.messages import messages_from_dict  # noqa: PLC0415

    from octop.api.routers.chat.serialize import (  # noqa: PLC0415
        _serialize_history_message,
    )

    archive = getattr(server.app_runtime, "history_archive", None)
    from octop.infra.history.service import HistoryArchive  # noqa: PLC0415

    rows = None
    wires: list[dict[str, Any]] = []
    thread = server.services.thread_repo.get(thread_id)
    if thread is None:
        raise _not_found("shared task not found")
    if isinstance(archive, HistoryArchive):
        from octop.infra.history.reader import read_page  # noqa: PLC0415

        page = await read_page(
            archive,
            server.app_runtime.agent_registry,
            thread.agent_id,
            thread_id,
            limit=limit,
            offset=offset,
        )
        wires = page["messages"]
        has_more = page["has_more"]
        next_offset = offset + len(wires)
        status = "ready"
    else:
        status = message_repo.projection_status(thread_id)
        if status != "ready":
            owner = server.user_manager.get_by_id(share["owner_user_id"])
            if thread is not None and owner is not None:
                registry = server.app_runtime.agent_registry
                busy = getattr(registry, "is_agent_active", lambda _agent_id: False)(
                    thread.agent_id
                )
                if not busy:

                    async def _work() -> None:
                        from octop.api.routers.chat.serialize import (  # noqa: PLC0415
                            _backfill_thread_projection,
                        )

                        await _backfill_thread_projection(
                            server, thread.agent_id, thread_id, user=owner
                        )

                    accepted = server.app_runtime.gateway.history_backfill.enqueue(thread_id, _work)
                    if accepted:
                        message_repo.mark_projection(thread_id, "queued")
                        status = "queued"
            response.headers["Retry-After"] = "2"
            return {
                "messages": [],
                "has_more": False,
                "next_offset": offset,
                "history_status": status,
            }
        rows, has_more = message_repo.page(thread_id, limit=limit, offset=offset)
        next_offset = offset + len(rows)

    raw_items = (
        [(json.loads(row.message_json), row.created_at, row.role) for row in rows]
        if rows is not None
        else [(wire, None, None) for wire in wires]
    )
    messages: list[dict[str, Any]] = []
    for wire, created_at, stored_role in raw_items:
        if stored_role is not None and stored_role not in {
            "human",
            "user",
            "ai",
            "assistant",
        }:
            continue
        try:
            rendered = _serialize_history_message(
                messages_from_dict([wire])[0],
                fallback_created_at=created_at,
            )
        except (ValueError, TypeError, KeyError):
            continue
        if rendered is None:
            continue
        content = "\n".join(
            str(block.get("text") or "")
            for block in rendered.get("content", [])
            if isinstance(block, dict) and block.get("type") == "text"
        ).strip()
        if content:
            messages.append(
                {
                    "role": str(rendered.get("role") or stored_role or ""),
                    "content": content,
                    "created_at": int(rendered.get("created_at") or created_at or 0),
                }
            )
    return {
        "messages": messages,
        "has_more": has_more,
        "next_offset": next_offset,
        "history_status": status,
    }


@router.get(
    "/workbench/projects/{project_id}/code",
    summary="List a configured project source directory",
    response_model=CodeDirectory,
)
async def list_code(
    project_id: str,
    path: str = Query(default=".", max_length=1024),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    if not bool(getattr(user, "is_admin", False)):
        raise _not_found("project code is unavailable")
    if not server.services.workbench_repo.owns_code_project(
        owner_user_id=user.id, project_id=project_id
    ):
        raise _not_found("project code is unavailable")
    root = server.services.config.workbench_code_root
    try:
        entries = await asyncio.get_running_loop().run_in_executor(
            None, list_code_directory, root, path
        )
    except (CodeBrowseError, OSError, RuntimeError) as exc:
        raise _not_found("code path unavailable") from exc
    return {"path": path, "entries": entries}


@router.get(
    "/workbench/projects/{project_id}/code/file",
    summary="Read a bounded UTF-8 project source file",
    response_model=CodeFile,
)
async def get_code_file(
    project_id: str,
    path: str = Query(..., min_length=1, max_length=1024),
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    if not bool(getattr(user, "is_admin", False)):
        raise _not_found("project code is unavailable")
    if not server.services.workbench_repo.owns_code_project(
        owner_user_id=user.id, project_id=project_id
    ):
        raise _not_found("project code is unavailable")
    root = server.services.config.workbench_code_root
    try:
        return await asyncio.get_running_loop().run_in_executor(None, read_code_file, root, path)
    except (CodeBrowseError, OSError, RuntimeError) as exc:
        raise _not_found("code file unavailable") from exc
