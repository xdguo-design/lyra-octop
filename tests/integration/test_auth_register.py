"""Integration tests: email-verified public registration with admin approval."""

from __future__ import annotations

import httpx
import pytest

from octop.infra.auth.captcha import local

PASSWORD = "Str0ngPass1"


@pytest.fixture
def registration_mail(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    codes: dict[str, str] = {}
    monkeypatch.setenv("OCTOP_EMAIL_CODE_SECRET", "ab" * 32)
    monkeypatch.setenv("OCTOP_SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("OCTOP_SMTP_PORT", "587")
    monkeypatch.setenv("OCTOP_SMTP_USERNAME", "octop@example.test")
    monkeypatch.setenv("OCTOP_SMTP_PASSWORD", "test-app-password")
    monkeypatch.setenv("OCTOP_SMTP_FROM", "octop@example.test")

    def capture_email(_config, email: str, code: str, _locale: str) -> None:
        codes[email] = code

    from octop.infra.users import registration

    registration.reset_registration_rate_limits()
    monkeypatch.setattr(registration, "_send_verification_email", capture_email)
    return codes


async def _enable_image_captcha(client: httpx.AsyncClient, auth: dict[str, str]) -> None:
    r = await client.put(
        "/api/settings/captcha",
        headers=auth,
        json={"active": "image"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["active"] == "image"


async def _fresh_captcha(client: httpx.AsyncClient) -> str:
    challenge = await client.get("/api/auth/captcha/challenge")
    assert challenge.status_code == 200, challenge.text
    cid = challenge.json()["challenge_id"]
    return f"{cid}:{local.challenge_code_for_tests(cid)}"


async def _send_code(
    client: httpx.AsyncClient,
    email: str,
    registration_mail: dict[str, str],
    *,
    captcha: bool = True,
) -> httpx.Response:
    body: dict[str, object] = {"email": email}
    if captcha:
        body["captcha_token"] = await _fresh_captcha(client)
    return await client.post("/api/auth/register/code", json=body)


async def _register(
    client: httpx.AsyncClient,
    email: str,
    registration_mail: dict[str, str],
    *,
    password: str = PASSWORD,
    code: str | None = None,
) -> httpx.Response:
    if code is None:
        sent = await _send_code(client, email, registration_mail)
        assert sent.status_code == 200, sent.text
        code = registration_mail[email.strip().lower()]
    return await client.post(
        "/api/auth/register",
        json={"email": email, "email_code": code, "password": password},
    )


async def _login(client: httpx.AsyncClient, email: str, password: str = PASSWORD) -> httpx.Response:
    return await client.post(
        "/api/auth/login",
        json={
            "username": email,
            "password": password,
            "captcha_token": await _fresh_captcha(client),
        },
    )


async def test_register_lands_pending_then_admin_approves(env, registration_mail) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)

    email = "New.User+Octop@example.com"
    r = await _register(c, email, registration_mail)
    assert r.status_code == 201, r.text
    assert r.json()["registered"] is True
    assert r.json()["user"]["username"] == email.lower()

    # Pending accounts cannot sign in by their email username.
    r = await _login(c, email.lower())
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "USER_PENDING_APPROVAL"

    # Admin sees it in the existing queue and approves it.
    r = await c.get("/api/users", headers=auth)
    row = next(u for u in r.json() if u["username"] == email.lower())
    assert row["email"] == email.lower()
    assert row["status"] == "pending"
    assert row["disabled"] is False

    r = await c.patch(
        f"/api/users/{row['id']}",
        headers=auth,
        json={"status": "active"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    r = await _login(c, email.lower())
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"] == email.lower()


async def test_register_code_requires_captcha(env, registration_mail) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)

    r = await _send_code(c, "captcha@example.com", registration_mail, captcha=False)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "CAPTCHA_REQUIRED"


async def test_concurrent_code_requests_send_only_one_email(env, registration_mail) -> None:
    import asyncio

    c, _srv, auth = env
    await _enable_image_captcha(c, auth)
    email = "concurrent@example.com"
    captcha_tokens = [await _fresh_captcha(c), await _fresh_captcha(c)]
    responses = await asyncio.gather(
        *(
            c.post(
                "/api/auth/register/code",
                json={"email": email, "captcha_token": token},
            )
            for token in captcha_tokens
        )
    )
    assert sorted(r.status_code for r in responses) == [200, 429]
    assert list(registration_mail) == [email]


async def test_smtp_failure_invalidates_code_without_creating_user(
    env, registration_mail, monkeypatch
) -> None:
    from octop.infra.users import registration

    c, srv, auth = env
    await _enable_image_captcha(c, auth)

    def fail_send(*_args) -> None:
        raise TimeoutError("smtp timed out")

    monkeypatch.setattr(registration, "_send_verification_email", fail_send)
    email = "smtp-failure@example.com"
    r = await _send_code(c, email, registration_mail)
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "EMAIL_DELIVERY_FAILED"
    assert srv.services.user_repo.get_by_email(email) is None
    with srv.services.db.connect() as conn:
        row = conn.execute(
            "SELECT code_digest, sent_at FROM email_verification_codes WHERE email = ?",
            (email,),
        ).fetchone()
    assert row["code_digest"] is None
    assert row["sent_at"] is None


async def test_register_code_rejects_invalid_email_and_path_characters(
    env, registration_mail
) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)

    for email in ("bad-email", "../escape@example.com", "a\\b@example.com", "a:*?@example.com"):
        r = await _send_code(c, email, registration_mail)
        assert r.status_code == 400, (email, r.text)
        assert r.json()["error"]["code"] == "EMAIL_INVALID"


async def test_registration_rejects_wrong_and_replayed_codes(env, registration_mail) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)
    email = "wrong-code@example.com"
    sent = await _send_code(c, email, registration_mail)
    assert sent.status_code == 200, sent.text

    r = await c.post(
        "/api/auth/register",
        json={"email": email, "email_code": "000000", "password": PASSWORD},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "EMAIL_VERIFICATION_FAILED"
    assert _srv.services.user_repo.get_by_email(email) is None

    code = registration_mail[email]
    r = await c.post(
        "/api/auth/register",
        json={"email": email, "email_code": code, "password": PASSWORD},
    )
    assert r.status_code == 201, r.text
    r = await c.post(
        "/api/auth/register",
        json={"email": email, "email_code": code, "password": PASSWORD},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "EMAIL_VERIFICATION_FAILED"


async def test_register_rejects_weak_password_and_duplicate_email(env, registration_mail) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)
    r = await _register(c, "weak@example.com", registration_mail, password="short")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "PASSWORD_TOO_WEAK"

    admin = next(
        user
        for user in (await c.get("/api/users", headers=auth)).json()
        if user["username"] == "admin"
    )
    r = await c.patch(
        f"/api/users/{admin['id']}", headers=auth, json={"email": "admin@example.com"}
    )
    assert r.status_code == 200, r.text
    r = await _register(c, "admin@example.com", registration_mail)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "EMAIL_TAKEN"


async def test_register_code_requires_valid_secret_and_smtp_config(
    env, registration_mail, monkeypatch
):
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)
    monkeypatch.setenv("OCTOP_EMAIL_CODE_SECRET", "weak")
    r = await _send_code(c, "missing-secret@example.com", registration_mail)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "EMAIL_DELIVERY_UNAVAILABLE"

    monkeypatch.setenv("OCTOP_EMAIL_CODE_SECRET", "cd" * 32)
    monkeypatch.delenv("OCTOP_SMTP_HOST")
    r = await _send_code(c, "missing-smtp@example.com", registration_mail)
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "EMAIL_DELIVERY_UNAVAILABLE"
