"""Account-owned workbench projects, task grouping, and read-only code browsing."""

from __future__ import annotations

import asyncio
import re
from typing import Any, cast

import httpx
from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, field_validator

from octop.api.deps import current_user, get_server
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.workbench.code_browser import (
    CodeBrowseError,
    list_code_directory,
    read_code_file,
)

router = APIRouter()


class WorkbenchProject(BaseModel):
    project_id: str
    name: str
    icon: str
    parent_id: str | None = None
    external_url: str | None = None
    code_enabled: bool
    created_at: int
    updated_at: int


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
    assignments: list[WorkbenchAssignment]


class ProjectBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: str = Field(default="📁", min_length=1, max_length=16)
    parent_id: str | None = None
    external_url: str | None = None

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
    server.services.workbench_repo.import_legacy_projects(
        owner_user_id=user.id,
        projects=[
            {"name": item.name, "thread_ids": list(dict.fromkeys(item.thread_ids))}
            for item in body.projects
        ],
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
    repo = server.services.workbench_repo
    _validate_project_parent(repo, user.id, None, body.parent_id)
    row = repo.create_project(
        owner_user_id=user.id,
        name=body.name,
        icon=body.icon,
        parent_id=body.parent_id,
        external_url=body.external_url,
    )
    if row is None:
        raise _not_found("parent project not found")
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
    ):
        raise _not_found("workbench project not found")
    row = next(
        (item for item in repo.list_index(user.id)["projects"] if item["project_id"] == project_id),
        None,
    )
    if row is None:
        raise _not_found("workbench project not found")
    return cast(dict[str, Any], row)


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
    if not server.services.workbench_repo.delete_project(
        owner_user_id=user.id, project_id=project_id
    ):
        raise _not_found("workbench project not found")
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
    return cast(dict[str, Any], row)


@router.delete(
    "/workbench/folders/{folder_id}",
    status_code=204,
    summary="Delete a folder and return its tasks to the project",
)
async def delete_folder(
    folder_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    if not server.services.workbench_repo.delete_folder(owner_user_id=user.id, folder_id=folder_id):
        raise _not_found("workbench folder not found")
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
    if not server.services.workbench_repo.assign_thread(
        owner_user_id=user.id,
        thread_id=thread_id,
        project_id=body.project_id,
        folder_id=body.folder_id,
    ):
        raise _not_found("thread, project, or folder not found")
    return {
        "thread_id": thread_id,
        "project_id": body.project_id,
        "folder_id": body.folder_id,
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
    if not server.services.workbench_repo.owns_code_project(
        owner_user_id=user.id, project_id=project_id
    ):
        raise _not_found("project code is unavailable")
    root = server.services.config.workbench_code_root
    try:
        return await asyncio.get_running_loop().run_in_executor(None, read_code_file, root, path)
    except (CodeBrowseError, OSError, RuntimeError) as exc:
        raise _not_found("code file unavailable") from exc
