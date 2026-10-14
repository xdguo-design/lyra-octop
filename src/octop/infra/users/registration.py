"""Self-service registration: public sign-up that lands in the admin review queue.

Rules (see ``docs/api.md`` auth section):
- the first account is never created here — that is the setup wizard's job, so an
  empty user table reports ``SETUP_REQUIRED`` instead of minting a public admin;
- every registration lands as ``pending`` and cannot sign in until an administrator
  approves it (``UserManager.set_status``);
- the new account gets the seeded user role template's permissions/policies, so
  public registration never grants more than the preset member role;
- attempts are rate limited per client because the endpoint is unauthenticated.
"""

from __future__ import annotations

import threading
import time
from collections import deque

from octop.infra.db.repos.users import STATUS_PENDING
from octop.infra.db.services import SharedServices
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.identity import Role, User
from octop.infra.users.manager import UserManager

RATE_LIMIT_BURST = 5
RATE_LIMIT_WINDOW = 600.0

_lock = threading.Lock()
_attempts: dict[str, deque[float]] = {}


def check_registration_rate_limit(client_id: str) -> None:
    """Per-client burst limit for the public registration endpoint."""
    cutoff = time.monotonic() - RATE_LIMIT_WINDOW
    with _lock:
        bucket = _attempts.setdefault(client_id, deque())
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_BURST:
            raise OctopError(ErrorCode.REGISTRATION_RATE_LIMITED, "too many registration attempts")
        bucket.append(time.monotonic())


def reset_registration_rate_limits() -> None:
    """Test seam: forget every recorded client bucket."""
    with _lock:
        _attempts.clear()


async def register_public(
    *,
    user_manager: UserManager,
    services: SharedServices,
    username: str,
    password: str,
    display_name: str | None = None,
    locale: str | None = None,
    client_id: str = "unknown",
) -> User:
    """Create a pending account. Raises ``OctopError`` on any policy violation."""
    check_registration_rate_limit(client_id)
    if services.user_repo.count() == 0:
        raise OctopError(
            ErrorCode.SETUP_REQUIRED,
            "initial admin not created; run the setup wizard first",
        )

    from octop.infra.db.repos.user_roles import seeded_user_role_assignment

    assignment = seeded_user_role_assignment(services.db)
    role_id = assignment[0] if assignment else Role.USER
    role_name = assignment[1] if assignment else None
    permissions = list(assignment[2]) if assignment else []
    policies = list(assignment[3]) if assignment else []

    user = await user_manager.create(
        username=(username or "").strip(),
        password=password,
        role=role_id,
        display_name=(display_name or "").strip() or None,
        locale=locale,
        permissions=permissions,
        role_name=role_name,
        status=STATUS_PENDING,
    )
    if policies:
        services.user_policy_repo.merge(user.id, dict(policies))
    services.audit_repo.write(actor=user.username, action="user.register", target=user.username)
    return user
