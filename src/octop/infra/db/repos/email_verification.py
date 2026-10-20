"""One-time registration email verification codes."""

from __future__ import annotations

import hmac

from octop.infra.db.pool import DatabasePool


class EmailVerificationRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def reserve(
        self,
        email: str,
        code_digest: str,
        now: int,
        expires_at: int,
        cooldown_seconds: int,
    ) -> bool:
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM email_verification_codes WHERE expires_at <= ?", (now,))
            result = conn.execute(
                "INSERT INTO email_verification_codes"
                "(email, code_digest, created_at, expires_at, attempts, sent_at) "
                "VALUES (?, ?, ?, ?, 0, NULL) "
                "ON CONFLICT(email) DO UPDATE SET code_digest = excluded.code_digest, "
                "created_at = excluded.created_at, expires_at = excluded.expires_at, "
                "attempts = 0, sent_at = NULL "
                "WHERE email_verification_codes.created_at <= ?",
                (email, code_digest, now, expires_at, now - cooldown_seconds),
            )
            return bool(result.rowcount == 1)

    def mark_sent(self, email: str, code_digest: str, sent_at: int) -> bool:
        with self._db.transaction() as conn:
            result = conn.execute(
                "UPDATE email_verification_codes SET sent_at = ? "
                "WHERE email = ? AND code_digest = ? AND sent_at IS NULL",
                (sent_at, email, code_digest),
            )
            return bool(result.rowcount == 1)

    def invalidate(self, email: str, code_digest: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE email_verification_codes SET code_digest = NULL, sent_at = NULL "
                "WHERE email = ? AND code_digest = ?",
                (email, code_digest),
            )

    def consume(self, email: str, code_digest: str, now: int, max_attempts: int) -> bool:
        with self._db.transaction() as conn:
            row = conn.execute(
                "SELECT code_digest, expires_at, attempts, sent_at "
                "FROM email_verification_codes WHERE email = ?",
                (email,),
            ).fetchone()
            if row is None:
                return False
            if (
                row["sent_at"] is not None
                and int(row["expires_at"]) > now
                and int(row["attempts"]) < max_attempts
                and isinstance(row["code_digest"], str)
                and hmac.compare_digest(row["code_digest"], code_digest)
            ):
                conn.execute("DELETE FROM email_verification_codes WHERE email = ?", (email,))
                return True
            attempts = int(row["attempts"]) + 1
            if attempts >= max_attempts or int(row["expires_at"]) <= now:
                conn.execute("DELETE FROM email_verification_codes WHERE email = ?", (email,))
            else:
                conn.execute(
                    "UPDATE email_verification_codes SET attempts = ? WHERE email = ?",
                    (attempts, email),
                )
            return False
