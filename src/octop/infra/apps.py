"""Mock application capability policy for isolated integration contracts."""

from __future__ import annotations

import re

from octop.infra.db.repos.app_registry import AppRegistryRepo

APP_SCOPES: dict[str, dict[str, frozenset[str]]] = {
    "admission-registration": {
        "read": frozenset({"admission.application.read", "admission.patient.read"}),
        "write": frozenset({"admission.narrative.write"}),
    }
}


class InvalidCapabilityScope(ValueError):
    """A grant contains a scope unsupported by its registered app contract."""


def validate_app_key(app_key: str) -> str:
    value = app_key.strip().lower()
    if value not in APP_SCOPES or not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", value):
        raise ValueError("unsupported mock application")
    return value


def validate_scopes(
    app_key: str, *, read_scopes: list[str], write_scopes: list[str]
) -> tuple[list[str], list[str]]:
    supported = APP_SCOPES[validate_app_key(app_key)]
    read = sorted(set(read_scopes))
    write = sorted(set(write_scopes))
    if not set(read) <= supported["read"] or not set(write) <= supported["write"]:
        raise InvalidCapabilityScope("scope is not supported by this app")
    if not read and not write:
        raise InvalidCapabilityScope("at least one capability scope is required")
    return read, write


def app_scope_allowed(
    repo: AppRegistryRepo,
    *,
    owner_user_id: int,
    registration_id: str,
    agent_id: str,
    scope: str,
    write: bool,
    now: int | None = None,
) -> bool:
    """Re-check the live grant on every adapter operation."""
    # shortcut: no external adapter is wired without an isolated EHR test environment; add one when available.
    return repo.allows(
        owner_user_id=owner_user_id,
        registration_id=registration_id,
        agent_id=agent_id,
        scope=scope,
        write=write,
        now=now,
    )
