"""Unit tests for self-service registration: pending accounts, review, admin singleton."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from octop.config import OctopConfig
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import build_shared_services
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.manager import UserManager
from octop.infra.users.registration import (
    register_public,
    reset_registration_rate_limits,
)
from octop.infra.utils.paths import PathLayout

PASSWORD = "Str0ngPass1"


@pytest.fixture
def env(tmp_path: Path):
    paths = PathLayout(tmp_path / ".octop")
    paths.ensure_root()
    db = SqlitePool(paths.db)
    run_migrations(db)
    services = build_shared_services(db=db, paths=paths, config=OctopConfig())
    manager = UserManager(services)
    asyncio.run(manager.boot())
    reset_registration_rate_limits()
    return services, manager


def _register(manager: UserManager, services, username: str, client_id: str = "ip-1"):
    return asyncio.run(
        register_public(
            user_manager=manager,
            services=services,
            username=username,
            password=PASSWORD,
            client_id=client_id,
        )
    )


def test_register_creates_pending_account(env) -> None:
    services, manager = env
    # A first admin must exist: an empty user table refuses public registration.
    with pytest.raises(OctopError) as exc:
        _register(manager, services, "first")
    assert exc.value.code is ErrorCode.SETUP_REQUIRED

    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    user = _register(manager, services, "newbie")

    assert user.username == "newbie"
    # Pending accounts stay out of the in-memory user map (that map signs tokens).
    assert manager.get("newbie") is None
    row = services.user_repo.get_by_username("newbie")
    assert row is not None
    assert row.status == "pending"
    assert row.role == "user"


def test_pending_account_cannot_authenticate_until_approved(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    _register(manager, services, "newbie")

    with pytest.raises(OctopError) as exc:
        asyncio.run(manager.authenticate("newbie", PASSWORD))
    assert exc.value.code is ErrorCode.USER_PENDING_APPROVAL

    asyncio.run(manager.set_status("newbie", "active"))
    user = asyncio.run(manager.authenticate("newbie", PASSWORD))
    assert user is not None and user.username == "newbie"


def test_reject_then_approve_roundtrip(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    _register(manager, services, "newbie")

    asyncio.run(manager.set_status("newbie", "rejected"))
    row = services.user_repo.get_by_username("newbie")
    assert row is not None and row.status == "rejected"

    asyncio.run(manager.set_status("newbie", "active"))
    row = services.user_repo.get_by_username("newbie")
    assert row is not None and row.status == "active"
    assert manager.get("newbie") is not None


def test_registration_rate_limit(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    for i in range(5):
        _register(manager, services, f"burst{i}", client_id="ip-burst")
    with pytest.raises(OctopError) as exc:
        _register(manager, services, "burst-late", client_id="ip-burst")
    assert exc.value.code is ErrorCode.REGISTRATION_RATE_LIMITED

    # A different client is unaffected.
    _register(manager, services, "other-client", client_id="ip-other")


def test_admin_role_has_a_single_holder(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))

    with pytest.raises(OctopError) as exc:
        asyncio.run(manager.create(username="admin2", password=PASSWORD, role="admin"))
    assert exc.value.code is ErrorCode.ADMIN_SINGLETON

    # Promoting an existing user to admin hits the same guard.
    _register(manager, services, "newbie")
    asyncio.run(manager.set_status("newbie", "active"))
    with pytest.raises(OctopError) as exc:
        asyncio.run(manager.set_role("newbie", "admin"))
    assert exc.value.code is ErrorCode.ADMIN_SINGLETON

    # The holder itself may keep (or re-assert) the role.
    asyncio.run(manager.set_role("admin", "admin"))

    # Once the holder is gone, a new admin is allowed again.
    asyncio.run(manager.remove("admin"))
    asyncio.run(manager.create(username="admin3", password=PASSWORD, role="admin"))
    assert manager.get("admin3") is not None


def test_set_status_refuses_admin_account(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    with pytest.raises(OctopError):
        asyncio.run(manager.set_status("admin", "rejected"))
    row = services.user_repo.get_by_username("admin")
    assert row is not None and row.status == "active"
