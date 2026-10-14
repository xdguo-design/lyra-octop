"""Integration tests: public registration with admin approval + image captcha."""

from __future__ import annotations

import httpx

from octop.infra.auth.captcha import local
from octop.infra.auth.captcha.providers import parse_slug

PASSWORD = "Str0ngPass1"


async def _enable_image_captcha(client: httpx.AsyncClient, auth: dict[str, str]) -> None:
    """Point the login/register captcha at the built-in image provider."""
    r = await client.put(
        "/api/settings/captcha",
        headers=auth,
        json={"active": "image"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["active"] == "image"


async def _register(
    client: httpx.AsyncClient,
    username: str,
    *,
    password: str = PASSWORD,
    captcha: bool = True,
) -> httpx.Response:
    headers: dict[str, str] = {}
    body: dict[str, object] = {"username": username, "password": password}
    if captcha:
        body["captcha_token"] = await _fresh_captcha(client)
    return await client.post("/api/auth/register", headers=headers, json=body)


async def _fresh_captcha(client: httpx.AsyncClient) -> str:
    """Issue a challenge and answer it correctly (test seam reads the code)."""
    challenge = await client.get("/api/auth/captcha/challenge")
    assert challenge.status_code == 200, challenge.text
    cid = challenge.json()["challenge_id"]
    return f"{cid}:{local.challenge_code_for_tests(cid)}"


async def _login(
    client: httpx.AsyncClient, username: str, password: str = PASSWORD
) -> httpx.Response:
    """Login with a valid captcha token (the provider is active in these tests)."""
    return await client.post(
        "/api/auth/login",
        json={
            "username": username,
            "password": password,
            "captcha_token": await _fresh_captcha(client),
        },
    )


async def test_register_lands_pending_then_admin_approves(env) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)

    r = await _register(c, "newbie")
    assert r.status_code == 201, r.text
    assert r.json()["registered"] is True

    # Pending accounts cannot sign in.
    r = await _login(c, "newbie")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "USER_PENDING_APPROVAL"

    # Admin sees it in the queue and approves.
    r = await c.get("/api/users", headers=auth)
    row = next(u for u in r.json() if u["username"] == "newbie")
    assert row["status"] == "pending"
    assert row["disabled"] is False

    r = await c.patch(
        f"/api/users/{row['id']}",
        headers=auth,
        json={"status": "active"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active"

    r = await _login(c, "newbie")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"] == "newbie"


async def test_register_requires_a_correct_captcha(env) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)

    r = await c.post(
        "/api/auth/register",
        json={"username": "typo", "password": PASSWORD},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "CAPTCHA_REQUIRED"

    challenge = await c.get("/api/auth/captcha/challenge")
    cid = challenge.json()["challenge_id"]
    r = await c.post(
        "/api/auth/register",
        json={
            "username": "typo",
            "password": PASSWORD,
            "captcha_token": f"{cid}:WRONG",
        },
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "CAPTCHA_FAILED"

    # The captcha is also enforced on login once the provider is active.
    r = await c.post(
        "/api/auth/login",
        json={"username": "admin", "password": "wrong-on-purpose"},
    )
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "CAPTCHA_REQUIRED"


async def test_admin_role_has_a_single_holder(env) -> None:
    c, _srv, auth = env
    r = await c.post(
        "/api/users",
        headers=auth,
        json={"username": "second-admin", "password": PASSWORD, "role": "admin"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "ADMIN_SINGLETON"

    # A regular member is still creatable.
    r = await c.post(
        "/api/users",
        headers=auth,
        json={"username": "member", "password": PASSWORD, "role": "user"},
    )
    assert r.status_code == 201


async def test_register_rejects_weak_password_and_taken_username(env) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)
    r = await _register(c, "weak", password="short")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "PASSWORD_TOO_WEAK"

    r = await _register(c, "admin")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "USERNAME_TAKEN"


async def test_captcha_settings_endpoint_reports_image_provider(env) -> None:
    c, _srv, auth = env
    await _enable_image_captcha(c, auth)
    r = await c.get("/api/auth/captcha")
    assert r.status_code == 200
    assert r.json()["provider"] == "image"
    # The built-in provider has no site key to publish.
    assert "site_key" not in r.json()
    assert parse_slug("image") == "image"
