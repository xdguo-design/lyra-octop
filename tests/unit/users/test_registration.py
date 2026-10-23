"""Unit tests for email-verified registration and admin approval."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from octop.config import OctopConfig
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import build_shared_services
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.manager import UserManager
from octop.infra.users.registration import (
    _code_digest,
    check_registration_rate_limit,
    normalize_registration_email,
    register_public,
    reset_registration_rate_limits,
)
from octop.infra.utils.paths import PathLayout

PASSWORD = "Str0ngPass1"
EMAIL_SECRET = "ef" * 32


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OCTOP_EMAIL_CODE_SECRET", EMAIL_SECRET)
    paths = PathLayout(tmp_path / ".octop")
    paths.ensure_root()
    db = SqlitePool(paths.db)
    run_migrations(db)
    services = build_shared_services(db=db, paths=paths, config=OctopConfig())
    manager = UserManager(services)
    asyncio.run(manager.boot())
    reset_registration_rate_limits()
    return services, manager


def _register(manager: UserManager, services, email: str, code: str = "123456"):
    normalized = normalize_registration_email(email)
    now = int(time.time())
    digest = _code_digest(bytes.fromhex(EMAIL_SECRET), normalized, code)
    assert services.email_verification_repo.reserve(normalized, digest, now, now + 600, 60)
    assert services.email_verification_repo.mark_sent(normalized, digest, now)
    return asyncio.run(
        register_public(
            user_manager=manager,
            services=services,
            email=email,
            email_code=code,
            password=PASSWORD,
        )
    )


def test_register_creates_pending_account(env) -> None:
    services, manager = env
    with pytest.raises(OctopError) as exc:
        _register(manager, services, "first@example.com")
    assert exc.value.code is ErrorCode.SETUP_REQUIRED

    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    user = _register(manager, services, "Newbie@example.com")

    assert user.username == "newbie@example.com"
    assert manager.get("newbie@example.com") is None
    row = services.user_repo.get_by_username("newbie@example.com")
    assert row is not None
    assert row.email == "newbie@example.com"
    assert row.status == "pending"
    assert row.role == "user"


def test_pending_account_cannot_authenticate_until_approved(env) -> None:
    _services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    _register(manager, _services, "newbie@example.com")

    with pytest.raises(OctopError) as exc:
        asyncio.run(manager.authenticate("newbie@example.com", PASSWORD))
    assert exc.value.code is ErrorCode.USER_PENDING_APPROVAL

    asyncio.run(manager.set_status("newbie@example.com", "active"))
    user = asyncio.run(manager.authenticate("newbie@example.com", PASSWORD))
    assert user is not None and user.username == "newbie@example.com"


def test_reject_then_approve_roundtrip(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))
    _register(manager, services, "newbie@example.com")

    asyncio.run(manager.set_status("newbie@example.com", "rejected"))
    row = services.user_repo.get_by_username("newbie@example.com")
    assert row is not None and row.status == "rejected"

    asyncio.run(manager.set_status("newbie@example.com", "active"))
    row = services.user_repo.get_by_username("newbie@example.com")
    assert row is not None and row.status == "active"
    assert manager.get("newbie@example.com") is not None


def test_registration_rate_limit(env) -> None:
    for _ in range(5):
        check_registration_rate_limit("ip-burst")
    with pytest.raises(OctopError) as exc:
        check_registration_rate_limit("ip-burst")
    assert exc.value.code is ErrorCode.REGISTRATION_RATE_LIMITED
    check_registration_rate_limit("ip-other")


def test_email_username_rejects_path_and_windows_filename_characters() -> None:
    for email in ("../escape@example.com", "a\\b@example.com", "a:*?@example.com"):
        with pytest.raises(OctopError) as exc:
            normalize_registration_email(email)
        assert exc.value.code is ErrorCode.EMAIL_INVALID


def test_admin_role_has_a_single_holder(env) -> None:
    services, manager = env
    asyncio.run(manager.create(username="admin", password=PASSWORD, role="admin"))

    with pytest.raises(OctopError) as exc:
        asyncio.run(manager.create(username="admin2", password=PASSWORD, role="admin"))
    assert exc.value.code is ErrorCode.ADMIN_SINGLETON

    _register(manager, services, "newbie@example.com")
    asyncio.run(manager.set_status("newbie@example.com", "active"))
    with pytest.raises(OctopError) as exc:
        asyncio.run(manager.set_role("newbie@example.com", "admin"))
    assert exc.value.code is ErrorCode.ADMIN_SINGLETON

    asyncio.run(manager.set_role("admin", "admin"))
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
