"""Admin overview/audit/metrics router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from octop.api.deps import get_server, require_permission

router = APIRouter()


class AuditLogItem(BaseModel):
    id: int
    ts: int
    actor: str | None
    action: str
    target: str | None
    payload: str | None
    project_id: str | None


class AuditLogProject(BaseModel):
    project_id: str
    name: str


@router.get("/overview")
async def overview(
    _: Any = Depends(require_permission("admin_console")), server: Any = Depends(get_server)
) -> dict[str, Any]:
    assert server.app_runtime is not None
    users = []
    for user in server.user_manager.list():
        users.append(
            {
                "username": user.username,
                "role": user.role,
                "agents": [],  # agents are now global, not per-user
            }
        )
    agents = [
        {
            "id": r.id,
            "agent_id": r.agent_id,
            "name": r.name,
            "state": r.last_state or "unknown",
        }
        for r in server.app_runtime.agent_registry.list_rows()
    ]
    return {
        "users": users,
        "agents": agents,
        "totals": {
            "users": len(users),
            "agents": len(agents),
        },
    }


# The largest page the Settings → Security audit panel offers.
AUDIT_LOG_MAX_LIMIT = 500


@router.get(
    "/audit-log",
    summary="Query audit log entries",
    response_model=list[AuditLogItem],
)
async def audit_log(
    since: int | None = None,
    until: int | None = None,
    actor: str | None = None,
    action: str | None = None,
    project_id: str | None = None,
    limit: int = Query(
        default=100,
        ge=1,
        le=AUDIT_LOG_MAX_LIMIT,
        description=f"Maximum rows to return, between 1 and {AUDIT_LOG_MAX_LIMIT}.",
    ),
    _: Any = Depends(require_permission("admin_console")),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    rows = server.services.audit_repo.query(
        since=since,
        until=until,
        actor=actor,
        action=action,
        project_id=project_id,
        limit=limit,
    )
    return [
        {
            "id": r.id,
            "ts": r.ts,
            "actor": r.actor,
            "action": r.action,
            "target": r.target,
            "payload": r.payload,
            "project_id": r.project_id,
        }
        for r in rows
    ]


@router.get(
    "/audit-log/projects",
    summary="List projects with audit activity",
    response_model=list[AuditLogProject],
)
async def audit_log_projects(
    _: Any = Depends(require_permission("admin_console")),
    server: Any = Depends(get_server),
) -> list[dict[str, str]]:
    projects: list[dict[str, str]] = server.services.audit_repo.list_projects()
    return projects


@router.get("/metrics")
async def metrics(
    _: Any = Depends(require_permission("admin_console")), server: Any = Depends(get_server)
) -> dict[str, Any]:
    from octop.infra.metrics import METRICS

    assert server.app_runtime is not None
    METRICS.set(
        "agent_active",
        len(server.app_runtime.agent_registry.list_rows()),
    )
    return METRICS.snapshot()
