"""Account-owned platforms, deployed links, and creation folders."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from octop.api.common.agent import require_agent_row
from octop.api.deps import current_user, get_server, require_admin
from octop.infra.creations import (
    capture_creation_thumbnail,
    capture_trusted_local_thumbnail,
    creation_thumbnail_path,
    remove_creation_thumbnail,
)
from octop.infra.errors import ErrorCode, OctopError

router = APIRouter()
_BUILT_IN_APPS = {
    "speech-recognition",
    "admission-demo",
    "planet",
    "manus-refund",
    "manus-clinicemr",
    "manus-freellm",
}


class CreationFolder(BaseModel):
    folder_id: str
    name: str
    created_at: int
    updated_at: int


class CreationItem(BaseModel):
    item_id: str
    kind: Literal["platform", "service", "applet"]
    name: str
    description: str
    url: str | None
    folder_id: str | None
    created_at: int
    updated_at: int
    thumbnail_url: str | None = None


class CardMeta(BaseModel):
    name: str | None
    description: str | None
    category: Literal["platform", "applet", "service", "repository"] | None = None


class CreationIndex(BaseModel):
    folders: list[CreationFolder]
    items: list[CreationItem]
    card_folders: dict[str, str]
    card_meta: dict[str, CardMeta]


class ProjectLaunchStatus(BaseModel):
    status: Literal["stopped", "starting", "running", "failed"]
    url: str | None = None
    logs: str | None = None
    thumbnail_url: str | None = None


class FolderBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("folder name cannot be blank")
        return name


class CreationItemBody(BaseModel):
    kind: Literal["platform", "service", "applet"]
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    url: str | None = Field(default=None, max_length=2048)
    folder_id: str | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("creation name cannot be blank")
        return name

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        url = value.strip()
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError as exc:
            raise ValueError("URL must be a valid absolute address") from exc
        if (
            not url
            or any(char.isspace() or ord(char) < 32 for char in url)
            or parts.scheme.lower() not in {"http", "https"}
            or not parts.hostname
            or (port is not None and not 1 <= port <= 65535)
            or parts.username is not None
            or parts.password is not None
        ):
            raise ValueError("URL must be an absolute http or https address without credentials")
        return url

    @model_validator(mode="after")
    def service_needs_url(self) -> CreationItemBody:
        if self.kind == "service" and not self.url:
            raise ValueError("deployed services need a URL")
        return self


class CardFolderBody(BaseModel):
    folder_id: str | None


class CardMetaBody(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    category: Literal["platform", "applet", "service", "repository"] | None = Field(
        default=None, description="Optional user-selected category for the built-in card."
    )

    @field_validator("name", "description")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


@router.get("/creations", summary="List creation entries and folders", response_model=CreationIndex)
async def list_creations(
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> CreationIndex:
    repo = server.services.creation_repo
    return CreationIndex(
        folders=repo.list_folders(user.id),
        items=[
            CreationItem.model_validate(_with_thumbnail(item, server.paths.root, user.id))
            for item in repo.list_items(user.id)
        ],
        card_folders=repo.list_card_folders(user.id),
        card_meta={
            key: CardMeta.model_validate(value)
            for key, value in repo.list_card_meta(user.id).items()
        },
    )


def _with_thumbnail(item: dict[str, Any], root: Path, owner_user_id: int) -> dict[str, Any]:
    row = dict(item)
    path = creation_thumbnail_path(root, owner_user_id, row["item_id"])
    row["thumbnail_url"] = (
        f"/api/creations/items/{row['item_id']}/thumbnail?v={row['updated_at']}"
        if path.is_file()
        else None
    )
    return row


def _launchable_item(server: Any, user: Any, item_id: str) -> dict[str, Any]:
    row = next(
        (
            item
            for item in server.services.creation_repo.list_items(user.id)
            if item["item_id"] == item_id
        ),
        None,
    )
    manager = server.project_service_manager
    if (
        row is None
        or row["kind"] != "service"
        or not row["url"]
        or manager is None
        or not manager.has_profile(row["url"])
    ):
        raise OctopError(ErrorCode.NOT_FOUND, "project launch profile not found")
    return cast(dict[str, Any], row)


@router.get(
    "/creations/items/{item_id}/launch",
    summary="Get a trusted local project launch status",
    response_model=ProjectLaunchStatus,
)
async def get_project_launch_status(
    item_id: str,
    user: Any = Depends(require_admin()),
    server: Any = Depends(get_server),
) -> ProjectLaunchStatus:
    row = _launchable_item(server, user, item_id)
    status = server.project_service_manager.status(row["url"])
    return ProjectLaunchStatus(
        **status,
        thumbnail_url=_with_thumbnail(row, server.paths.root, user.id)["thumbnail_url"],
    )


@router.post(
    "/creations/items/{item_id}/launch",
    summary="Start a trusted local project preview",
    response_model=ProjectLaunchStatus,
)
async def start_project_preview(
    item_id: str,
    user: Any = Depends(require_admin()),
    server: Any = Depends(get_server),
) -> ProjectLaunchStatus:
    row = _launchable_item(server, user, item_id)
    manager = server.project_service_manager
    try:
        status = await manager.start(row["url"])
    except RuntimeError:
        status = manager.status(row["url"])
    if status["status"] == "running" and status["url"]:
        await capture_trusted_local_thumbnail(
            status["url"],
            manager.thumbnail_origins(row["url"]),
            creation_thumbnail_path(server.paths.root, user.id, item_id),
        )
    return ProjectLaunchStatus(
        **status,
        thumbnail_url=_with_thumbnail(row, server.paths.root, user.id)["thumbnail_url"],
    )


@router.delete(
    "/creations/items/{item_id}/launch",
    summary="Stop a trusted local project preview",
    response_model=ProjectLaunchStatus,
)
async def stop_project_preview(
    item_id: str,
    user: Any = Depends(require_admin()),
    server: Any = Depends(get_server),
) -> ProjectLaunchStatus:
    row = _launchable_item(server, user, item_id)
    status = await server.project_service_manager.stop(row["url"])
    return ProjectLaunchStatus(
        **status,
        thumbnail_url=_with_thumbnail(row, server.paths.root, user.id)["thumbnail_url"],
    )


async def _refresh_thumbnail(item: dict[str, Any], root: Path, owner_user_id: int) -> None:
    path = creation_thumbnail_path(root, owner_user_id, item["item_id"])
    hostname = urlsplit(item["url"]).hostname if item["url"] else None
    if item["kind"] == "service" and item["url"] and hostname != "github.com":
        await capture_creation_thumbnail(item["url"], path)
    else:
        await asyncio.to_thread(remove_creation_thumbnail, path)


@router.post(
    "/creations/folders",
    status_code=201,
    summary="Create a creation folder",
    response_model=CreationFolder,
)
async def create_folder(
    body: FolderBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return cast(
        "dict[str, Any]",
        server.services.creation_repo.create_folder(owner_user_id=user.id, name=body.name),
    )


@router.patch(
    "/creations/folders/{folder_id}",
    summary="Rename a creation folder",
    response_model=CreationFolder,
)
async def rename_folder(
    folder_id: str,
    body: FolderBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    repo = server.services.creation_repo
    if not repo.rename_folder(owner_user_id=user.id, folder_id=folder_id, name=body.name):
        raise OctopError(ErrorCode.NOT_FOUND, "creation folder not found")
    folder = next(
        (row for row in repo.list_folders(user.id) if row["folder_id"] == folder_id),
        None,
    )
    if folder is None:
        raise OctopError(ErrorCode.NOT_FOUND, "creation folder not found")
    return cast("dict[str, Any]", folder)


@router.delete(
    "/creations/folders/{folder_id}", status_code=204, summary="Delete a creation folder"
)
async def delete_folder(
    folder_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    if not server.services.creation_repo.delete_folder(owner_user_id=user.id, folder_id=folder_id):
        raise OctopError(ErrorCode.NOT_FOUND, "creation folder not found")
    return Response(status_code=204)


@router.post(
    "/creations/items",
    status_code=201,
    summary="Add a planned platform or deployed service",
    response_model=CreationItem,
)
async def create_item(
    body: CreationItemBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = server.services.creation_repo.create_item(
        owner_user_id=user.id,
        kind=body.kind,
        name=body.name,
        description=body.description,
        url=body.url,
        folder_id=body.folder_id,
    )
    if row is None:
        raise OctopError(ErrorCode.NOT_FOUND, "creation folder not found")
    await _refresh_thumbnail(row, server.paths.root, user.id)
    return _with_thumbnail(row, server.paths.root, user.id)


@router.put(
    "/creations/items/{item_id}",
    summary="Update a platform or deployed service",
    response_model=CreationItem,
)
async def update_item(
    item_id: str,
    body: CreationItemBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    repo = server.services.creation_repo
    previous = next(
        (row for row in repo.list_items(user.id) if row["item_id"] == item_id),
        None,
    )
    if previous is None:
        raise OctopError(ErrorCode.NOT_FOUND, "creation item not found")
    values = body.model_dump()
    if not repo.update_item(owner_user_id=user.id, item_id=item_id, values=values):
        raise OctopError(ErrorCode.NOT_FOUND, "creation item or folder not found")
    thumbnail_path = creation_thumbnail_path(server.paths.root, user.id, item_id)
    needs_capture = previous["kind"] != body.kind or previous["url"] != body.url
    if body.kind == "service" and body.url and not thumbnail_path.is_file():
        needs_capture = True
    if needs_capture:
        await _refresh_thumbnail(
            {"item_id": item_id, "kind": body.kind, "url": body.url},
            server.paths.root,
            user.id,
        )
        latest = next(
            (row for row in repo.list_items(user.id) if row["item_id"] == item_id),
            None,
        )
        if latest is None or latest["kind"] != body.kind or latest["url"] != body.url:
            await asyncio.to_thread(
                remove_creation_thumbnail,
                creation_thumbnail_path(server.paths.root, user.id, item_id),
            )
    item = next((row for row in repo.list_items(user.id) if row["item_id"] == item_id), None)
    if item is None:
        raise OctopError(ErrorCode.NOT_FOUND, "creation item not found")
    return _with_thumbnail(item, server.paths.root, user.id)


@router.delete(
    "/creations/items/{item_id}", status_code=204, summary="Delete a platform or deployed service"
)
async def delete_item(
    item_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    if not server.services.creation_repo.delete_item(owner_user_id=user.id, item_id=item_id):
        raise OctopError(ErrorCode.NOT_FOUND, "creation item not found")
    await asyncio.to_thread(
        remove_creation_thumbnail,
        creation_thumbnail_path(server.paths.root, user.id, item_id),
    )
    return Response(status_code=204)


@router.get(
    "/creations/items/{item_id}/thumbnail",
    summary="Read a captured creation website thumbnail",
    response_class=FileResponse,
)
async def get_item_thumbnail(
    item_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> FileResponse:
    item = next(
        (
            row
            for row in server.services.creation_repo.list_items(user.id)
            if row["item_id"] == item_id and row["kind"] == "service"
        ),
        None,
    )
    if item is None:
        raise OctopError(ErrorCode.NOT_FOUND, "creation thumbnail not found")
    path = creation_thumbnail_path(server.paths.root, user.id, item_id)
    if not path.is_file():
        raise OctopError(ErrorCode.NOT_FOUND, "creation thumbnail not found")
    return FileResponse(
        path=path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.put(
    "/creations/cards/{card_type}/{card_id}/folder",
    summary="Move a built-in app or agent card to a folder",
)
async def set_card_folder(
    card_type: Literal["agent", "app"],
    card_id: str,
    body: CardFolderBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, str | None]:
    if card_type == "agent":
        require_agent_row(card_id, user=user, as_user=None, server=server)
    elif card_id not in _BUILT_IN_APPS:
        raise OctopError(ErrorCode.NOT_FOUND, "creation app not found")
    if not server.services.creation_repo.set_card_folder(
        owner_user_id=user.id,
        card_type=card_type,
        card_id=card_id,
        folder_id=body.folder_id,
    ):
        raise OctopError(ErrorCode.NOT_FOUND, "creation folder not found")
    return {"folder_id": body.folder_id}


@router.put(
    "/creations/cards/{card_type}/{card_id}/meta",
    summary="Update the name, description, or category of a built-in app card",
)
async def set_card_meta(
    card_type: Literal["agent", "app"],
    card_id: str,
    body: CardMetaBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, str | None]:
    if card_type != "app" or card_id not in _BUILT_IN_APPS:
        raise OctopError(ErrorCode.NOT_FOUND, "creation app not found")
    server.services.creation_repo.set_card_meta(
        owner_user_id=user.id,
        card_type=card_type,
        card_id=card_id,
        name=body.name,
        description=body.description,
        category=body.category,
    )
    return {
        "name": body.name,
        "description": body.description,
        "category": body.category,
    }
