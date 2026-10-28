"""Owner-scoped application registration and capability grant API."""

from __future__ import annotations

import time
from typing import Any, cast

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field

from octop.api.common.agent import require_agent_row
from octop.api.deps import current_user, get_server
from octop.infra.apps import InvalidCapabilityScope, validate_app_key, validate_scopes
from octop.infra.errors import ErrorCode, OctopError

router = APIRouter()


class AppRegistrationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app_key: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)


class AppRegistrationPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class AppRegistrationResponse(BaseModel):
    registration_id: str
    owner_user_id: int
    app_key: str
    display_name: str
    adapter_kind: str
    enabled: bool
    created_at: int
    updated_at: int


class CapabilityGrantCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=1, max_length=64)
    read_scopes: list[str] = Field(default_factory=list, max_length=16)
    write_scopes: list[str] = Field(default_factory=list, max_length=16)
    expires_at: int | None = Field(default=None, gt=0)


class CapabilityGrantResponse(BaseModel):
    grant_id: str
    registration_id: str
    owner_user_id: int
    agent_id: str
    read_scopes: list[str]
    write_scopes: list[str]
    expires_at: int | None
    revoked_at: int | None
    created_at: int
    updated_at: int


@router.post(
    "/apps",
    status_code=status.HTTP_201_CREATED,
    response_model=AppRegistrationResponse,
    summary="Register a supported mock application",
    description="Registers an isolated mock adapter contract; real EHR endpoints are not configured here.",
)
async def create_app_registration(
    body: AppRegistrationCreate,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    display_name = body.display_name.strip()
    if not display_name:
        raise OctopError.localized(ErrorCode.APP_DISPLAY_NAME_INVALID)
    try:
        app_key = validate_app_key(body.app_key)
    except ValueError as exc:
        raise OctopError.localized(ErrorCode.APP_UNSUPPORTED) from exc
    registration = server.services.app_registry_repo.create_registration(
        owner_user_id=int(user.id),
        app_key=app_key,
        display_name=display_name,
    )
    if registration is None:
        raise OctopError.localized(ErrorCode.APP_REGISTRATION_EXISTS)
    return cast(dict[str, Any], registration)


@router.get(
    "/apps", response_model=list[AppRegistrationResponse], summary="List registered applications"
)
async def list_app_registrations(
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    return cast(
        list[dict[str, Any]],
        server.services.app_registry_repo.list_registrations(owner_user_id=int(user.id)),
    )


@router.patch(
    "/apps/{registration_id}",
    response_model=AppRegistrationResponse,
    summary="Enable or disable an application registration",
)
async def patch_app_registration(
    registration_id: str,
    body: AppRegistrationPatch,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    repo = server.services.app_registry_repo
    if not repo.set_enabled(
        owner_user_id=int(user.id), registration_id=registration_id, enabled=body.enabled
    ):
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    registration = repo.get_registration(
        owner_user_id=int(user.id), registration_id=registration_id
    )
    if registration is None:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    return cast(dict[str, Any], registration)


@router.post(
    "/apps/{registration_id}/grants",
    status_code=status.HTTP_201_CREATED,
    response_model=CapabilityGrantResponse,
    summary="Grant an Agent scoped application access",
    description="Read and write scopes are separate; grants may expire and are re-checked by adapters on each operation.",
)
async def create_capability_grant(
    registration_id: str,
    body: CapabilityGrantCreate,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    if body.expires_at is not None and body.expires_at <= int(time.time()):
        raise OctopError.localized(ErrorCode.APP_GRANT_EXPIRY_INVALID)
    app = server.services.app_registry_repo.get_registration(
        owner_user_id=int(user.id), registration_id=registration_id
    )
    if app is None or not app["enabled"]:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    try:
        read_scopes, write_scopes = validate_scopes(
            str(app["app_key"]),
            read_scopes=body.read_scopes,
            write_scopes=body.write_scopes,
        )
    except InvalidCapabilityScope as exc:
        raise OctopError.localized(ErrorCode.APP_SCOPE_INVALID) from exc
    require_agent_row(body.agent_id, user=user, as_user=None, server=server)
    grant = server.services.app_registry_repo.save_grant(
        owner_user_id=int(user.id),
        registration_id=registration_id,
        agent_id=body.agent_id,
        read_scopes=read_scopes,
        write_scopes=write_scopes,
        expires_at=body.expires_at,
    )
    if grant is None:
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    return cast(dict[str, Any], grant)


@router.get(
    "/apps/{registration_id}/grants",
    response_model=list[CapabilityGrantResponse],
    summary="List application capability grants",
)
async def list_capability_grants(
    registration_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    if (
        server.services.app_registry_repo.get_registration(
            owner_user_id=int(user.id), registration_id=registration_id
        )
        is None
    ):
        raise OctopError.localized(ErrorCode.NOT_FOUND)
    return cast(
        list[dict[str, Any]],
        server.services.app_registry_repo.list_grants(
            owner_user_id=int(user.id), registration_id=registration_id
        ),
    )


@router.delete(
    "/apps/grants/{grant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an application capability grant",
)
async def revoke_capability_grant(
    grant_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    if not server.services.app_registry_repo.revoke_grant(
        owner_user_id=int(user.id), grant_id=grant_id
    ):
        raise OctopError.localized(ErrorCode.NOT_FOUND)
