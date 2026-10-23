"""Email normalization and light validation for local users."""

from __future__ import annotations

from octop.infra.errors import ErrorCode, OctopError


def normalize_email(raw: str | None) -> str | None:
    """Strip and lowercase; empty / whitespace-only becomes ``None``."""
    if raw is None:
        return None
    cleaned = raw.strip().lower()
    return cleaned or None


def validate_email_format(email: str) -> None:
    """Raise ``OctopError(EMAIL_INVALID)`` when *email* is not a plausible address.

    Practical address shape (``local@domain.tld``, not full RFC 5322), checked by
    splitting instead of a backtracking regex so matching stays linear
    (py/polynomial-redos).
    """
    local, sep, domain = email.partition("@")
    stem, dot, tail = domain.rpartition(".")
    if (
        not sep
        or not local
        or not dot
        or not stem
        or not tail
        or "@" in domain
        or any(char.isspace() for char in email)
    ):
        raise OctopError(ErrorCode.EMAIL_INVALID, "invalid email address", status=400)


def parse_optional_email(raw: str | None, *, required_valid: bool = True) -> str | None:
    """Normalize optional email input; optionally validate non-empty values."""
    email = normalize_email(raw)
    if email is None:
        return None
    if required_valid:
        validate_email_format(email)
    return email
