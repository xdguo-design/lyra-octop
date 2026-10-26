"""Email-verified self-service registration with administrator approval."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import re
import secrets
import smtplib
import ssl
import threading
import time
from collections import deque
from email.message import EmailMessage

from octop.i18n import tr
from octop.infra.db.repos.users import STATUS_PENDING
from octop.infra.db.services import SharedServices
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.email import normalize_email
from octop.infra.users.identity import Role, User
from octop.infra.users.manager import UserManager
from octop.infra.users.password import validate_password_policy

logger = logging.getLogger(__name__)

RATE_LIMIT_BURST = 5
RATE_LIMIT_WINDOW = 600.0
EMAIL_CODE_TTL_SECONDS = 600
EMAIL_CODE_COOLDOWN_SECONDS = 60
EMAIL_CODE_MAX_ATTEMPTS = 5
SMTP_SOCKET_TIMEOUT_SECONDS = 10
_EMAIL_LOCAL_PART = re.compile(r"^[A-Za-z0-9.!#$%&'+^_`{}~-]{1,64}$")
_EMAIL_DOMAIN = re.compile(r"^[A-Za-z0-9.-]{1,253}$")

_lock = threading.Lock()
_attempts: dict[str, deque[float]] = {}


def normalize_registration_email(raw: str | None) -> str:
    """Validate an email address that is also safe as a cross-platform username path."""
    email = normalize_email(raw)
    if email is None or len(email) > 254 or email.count("@") != 1:
        raise OctopError(ErrorCode.EMAIL_INVALID, "invalid email address")
    local, domain = email.split("@", 1)
    if (
        not _EMAIL_LOCAL_PART.fullmatch(local)
        or local.startswith(".")
        or local.endswith(".")
        or ".." in local
        or not _EMAIL_DOMAIN.fullmatch(domain)
        or domain.startswith(".")
        or domain.endswith(".")
        or ".." in domain
        or "." not in domain
    ):
        raise OctopError(ErrorCode.EMAIL_INVALID, "invalid email address")
    if any(label.startswith("-") or label.endswith("-") for label in domain.split(".")):
        raise OctopError(ErrorCode.EMAIL_INVALID, "invalid email address")
    return email


def check_registration_rate_limit(client_id: str) -> None:
    """Limit verification-email requests per client address."""
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


def _email_code_secret() -> bytes:
    raw = os.environ.get("OCTOP_EMAIL_CODE_SECRET", "")
    try:
        secret = bytes.fromhex(raw)
    except ValueError:
        secret = b""
    if len(secret) != 32 or len(raw) != 64:
        raise OctopError(
            ErrorCode.EMAIL_DELIVERY_UNAVAILABLE,
            "email verification is not configured",
        )
    return secret


def _code_digest(secret: bytes, email: str, code: str) -> str:
    return hmac.new(secret, f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def _smtp_config() -> tuple[str, int, str, str, str]:
    host = os.environ.get("OCTOP_SMTP_HOST", "").strip()
    sender = os.environ.get("OCTOP_SMTP_FROM", "").strip()
    username = os.environ.get("OCTOP_SMTP_USERNAME", "").strip()
    password = os.environ.get("OCTOP_SMTP_PASSWORD", "")
    try:
        port = int(os.environ.get("OCTOP_SMTP_PORT", "587"))
    except ValueError:
        port = 0
    if not host or not sender or not 1 <= port <= 65535 or bool(username) != bool(password):
        raise OctopError(
            ErrorCode.EMAIL_DELIVERY_UNAVAILABLE,
            "email verification is not configured",
        )
    return host, port, username, password, sender


def _send_verification_email(
    config: tuple[str, int, str, str, str], email: str, code: str, locale: str
) -> None:
    host, port, username, password, sender = config
    message = EmailMessage()
    message["Subject"] = tr("email_registration.subject", locale)
    message["From"] = sender
    message["To"] = email
    message.set_content(tr("email_registration.body", locale, code=code))
    with smtplib.SMTP(host, port, timeout=SMTP_SOCKET_TIMEOUT_SECONDS) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        if username:
            smtp.login(username, password)
        smtp.send_message(message)


async def request_registration_code(
    *, services: SharedServices, email: str, client_id: str, locale: str
) -> str:
    """Send and persist a one-time email code; return the normalized address."""
    check_registration_rate_limit(client_id)
    normalized_email = normalize_registration_email(email)
    secret = _email_code_secret()
    smtp_config = _smtp_config()
    code = f"{secrets.randbelow(1_000_000):06d}"
    now = int(time.time())
    digest = _code_digest(secret, normalized_email, code)
    reserved = services.email_verification_repo.reserve(
        normalized_email,
        digest,
        now,
        now + EMAIL_CODE_TTL_SECONDS,
        EMAIL_CODE_COOLDOWN_SECONDS,
    )
    if not reserved:
        raise OctopError(ErrorCode.REGISTRATION_RATE_LIMITED, "too many registration attempts")
    try:
        await asyncio.get_running_loop().run_in_executor(
            None, _send_verification_email, smtp_config, normalized_email, code, locale
        )
    except Exception as exc:
        services.email_verification_repo.invalidate(normalized_email, digest)
        logger.warning("registration email delivery failed (%s)", type(exc).__name__)
        raise OctopError(
            ErrorCode.EMAIL_DELIVERY_FAILED,
            "verification email could not be sent",
        ) from None
    if not services.email_verification_repo.mark_sent(normalized_email, digest, int(time.time())):
        raise OctopError(
            ErrorCode.EMAIL_DELIVERY_FAILED,
            "verification email could not be sent",
        )
    return normalized_email


async def register_public(
    *,
    user_manager: UserManager,
    services: SharedServices,
    email: str,
    email_code: str,
    password: str,
    display_name: str | None = None,
    locale: str | None = None,
) -> User:
    """Create a pending account after atomically consuming a valid email code."""
    normalized_email = normalize_registration_email(email)
    validate_password_policy(password)
    if len(email_code) != 6 or not email_code.isascii() or not email_code.isdigit():
        raise OctopError(ErrorCode.EMAIL_VERIFICATION_FAILED, "invalid email verification code")
    secret = _email_code_secret()
    if not services.email_verification_repo.consume(
        normalized_email,
        _code_digest(secret, normalized_email, email_code),
        int(time.time()),
        EMAIL_CODE_MAX_ATTEMPTS,
    ):
        raise OctopError(ErrorCode.EMAIL_VERIFICATION_FAILED, "invalid email verification code")
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
        username=normalized_email,
        email=normalized_email,
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
