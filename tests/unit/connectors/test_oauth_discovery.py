"""Unit tests for MCP OAuth discovery and unified oauth targets."""

from __future__ import annotations

import pytest

from octop.infra.connectors.custom_mcp import (
    build_oauth_storage,
    harness_spec_for_server,
    mark_oauth_reauth_required,
    merge_preserved_oauth,
    redact_server_for_api,
)
from octop.infra.connectors.oauth.discovery import (
    build_protected_resource_metadata_urls,
    clear_oauth_discovery_cache,
    discover_oauth_from_mcp_url,
    parse_www_authenticate_resource_metadata,
)
from octop.infra.connectors.oauth.registry import (
    oauth_state_kind_for_target,
    oauth_target_requires_https,
)


def test_build_protected_resource_metadata_urls_path_and_root():
    urls = build_protected_resource_metadata_urls("https://example.com/mcp")
    assert urls == [
        "https://example.com/.well-known/oauth-protected-resource/mcp",
        "https://example.com/.well-known/oauth-protected-resource",
    ]


def test_build_protected_resource_metadata_urls_prefers_www_auth_header():
    header_url = "https://example.com/.well-known/oauth-protected-resource/custom"
    urls = build_protected_resource_metadata_urls(
        "https://example.com/mcp",
        www_auth_resource_metadata=header_url,
    )
    assert urls[0] == header_url


def test_parse_www_authenticate_resource_metadata():
    raw = 'Bearer error="invalid_token", resource_metadata="https://mcp.example.com/prm"'
    assert parse_www_authenticate_resource_metadata(raw) == "https://mcp.example.com/prm"


def test_oauth_target_helpers():
    assert oauth_state_kind_for_target({"type": "catalog", "kind": "notion"}) == "notion"
    assert oauth_state_kind_for_target({"type": "custom_mcp", "server_name": "x"}) == ("custom-mcp")
    assert oauth_target_requires_https({"type": "catalog", "kind": "notion"}) is True
    assert oauth_target_requires_https({"type": "custom_mcp", "server_name": "x"}) is True
    assert oauth_target_requires_https({"type": "catalog", "kind": "tencent-docs"}) is False


def test_merge_preserved_oauth_and_redaction():
    existing = {
        "srv": {
            "transport": "streamable_http",
            "url": "https://example.com/mcp",
            "oauth": {"access_token": "secret", "expires_at": 123},
        }
    }
    incoming = {
        "srv": {
            "transport": "streamable_http",
            "url": "https://example.com/mcp",
            "oauth": {"access_token": "client-sent"},
        }
    }
    merged = merge_preserved_oauth(incoming, existing)
    assert merged["srv"]["oauth"]["access_token"] == "secret"
    preview = redact_server_for_api(merged["srv"])
    assert preview["oauth"] == {"configured": True, "expires_at": 123}
    assert "access_token" not in preview["oauth"]


def test_oauth_required_hint_redaction_and_merge():
    existing = {
        "srv": {
            "transport": "streamable_http",
            "url": "https://example.com/mcp",
            "oauth": {"required": True},
        }
    }
    incoming = {"srv": {"transport": "streamable_http", "url": "https://example.com/mcp"}}
    merged = merge_preserved_oauth(incoming, existing)
    assert merged["srv"]["oauth"] == {"required": True}
    preview = redact_server_for_api(merged["srv"])
    assert preview["oauth"] == {"configured": False, "required": True}


def test_harness_spec_injects_oauth_bearer():
    spec = {
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "oauth": build_oauth_storage(
            {"access_token": "tok123", "refresh_token": "r", "expires_at": 1},
            issuer="https://example.com",
            resource="https://example.com/mcp",
        ),
    }
    harness = harness_spec_for_server(spec)
    assert harness["headers"]["Authorization"] == "Bearer tok123"


def test_oauth_state_kind_invalid():
    with pytest.raises(ValueError, match="unsupported oauth target"):
        oauth_state_kind_for_target({"type": "unknown"})


def test_mark_oauth_reauth_required_clears_tokens():
    spec = {
        "transport": "streamable_http",
        "url": "https://example.com/mcp",
        "oauth": build_oauth_storage(
            {"access_token": "secret", "refresh_token": "r", "expires_at": 1},
            issuer="https://example.com",
            resource="https://example.com/mcp",
        ),
    }
    marked = mark_oauth_reauth_required(spec)
    assert marked["oauth"] == {"required": True}
    preview = redact_server_for_api(marked)
    assert preview["oauth"] == {"configured": False, "required": True}


@pytest.mark.asyncio
async def test_discover_oauth_from_mcp_url_uses_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    clear_oauth_discovery_cache()
    calls = 0
    cached_result = {
        "available": True,
        "issuer": "https://auth.example.com",
        "resource": "https://example.com/mcp",
        "metadata": {"registration_endpoint": "https://auth.example.com/reg"},
        "scopes_supported": None,
        "error": None,
    }

    async def fake_uncached(url: str) -> dict[str, object]:
        nonlocal calls
        calls += 1
        assert url == "https://example.com/mcp"
        return cached_result

    monkeypatch.setattr(
        "octop.infra.connectors.oauth.discovery._discover_oauth_from_mcp_url_uncached",
        fake_uncached,
    )

    first = await discover_oauth_from_mcp_url("https://example.com/mcp")
    second = await discover_oauth_from_mcp_url("https://example.com/mcp")
    assert first == cached_result
    assert second == cached_result
    assert calls == 1

    bypass = await discover_oauth_from_mcp_url("https://example.com/mcp", use_cache=False)
    assert bypass == cached_result
    assert calls == 2


def test_authorization_metadata_url_forms() -> None:
    from octop.infra.connectors.oauth.mcp import _authorization_metadata_urls

    assert _authorization_metadata_urls("https://mcp.notion.com") == [
        "https://mcp.notion.com/.well-known/oauth-authorization-server",
    ]
    # RFC 8414 path-insertion fallback for issuers with a path (e.g. GitHub).
    assert _authorization_metadata_urls("https://github.com/login/oauth") == [
        "https://github.com/login/oauth/.well-known/oauth-authorization-server",
        "https://github.com/.well-known/oauth-authorization-server/login/oauth",
    ]


def test_static_oauth_client_roundtrip_and_redaction() -> None:
    from octop.infra.connectors.custom_mcp import (
        normalize_server_spec,
        static_oauth_client_from_spec,
    )

    spec = normalize_server_spec(
        "gh",
        {
            "transport": "streamable_http",
            "url": "https://api.githubcopilot.com/mcp/",
            "oauth_client_id": "Iv1.abc",
            "oauth_client_secret": "shh",
        },
    )
    assert spec["oauth_client_id"] == "Iv1.abc"
    assert spec["oauth_client_secret"] == "shh"
    assert static_oauth_client_from_spec(spec) == {
        "client_id": "Iv1.abc",
        "client_secret": "shh",
    }
    harness = harness_spec_for_server(spec)
    assert "oauth_client_id" not in harness
    assert "oauth_client_secret" not in harness
    preview = redact_server_for_api(spec)
    assert preview["oauth_client_id"] == "Iv1.abc"
    assert preview["oauth_client_secret_configured"] is True
    assert "oauth_client_secret" not in preview


def test_merge_preserved_oauth_keeps_static_secret_when_unset() -> None:
    existing = {
        "srv": {
            "transport": "streamable_http",
            "url": "https://example.com/mcp",
            "oauth_client_id": "cid",
            "oauth_client_secret": "shh",
        }
    }
    incoming = {
        "srv": {
            "transport": "streamable_http",
            "url": "https://example.com/mcp",
            "oauth_client_id": "cid",
        }
    }
    merged = merge_preserved_oauth(incoming, existing)
    assert merged["srv"]["oauth_client_secret"] == "shh"
    dropped = merge_preserved_oauth(
        {"srv": {"transport": "streamable_http", "url": "https://example.com/mcp"}},
        existing,
    )
    assert "oauth_client_secret" not in dropped["srv"]


@pytest.mark.asyncio
async def test_discovery_tolerates_missing_registration_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import octop.infra.connectors.oauth.discovery as discovery_module

    clear_oauth_discovery_cache()

    async def fake_probe(url: str) -> None:
        return None

    async def fake_prm(url: str) -> dict[str, object]:
        assert url.endswith("/.well-known/oauth-protected-resource/mcp/")
        return {
            "resource": "https://api.githubcopilot.com/mcp/",
            "authorization_servers": ["https://github.com/login/oauth"],
            "scopes_supported": ["repo", "read:org"],
        }

    async def fake_metadata(issuer: str) -> dict[str, object]:
        assert issuer == "https://github.com/login/oauth"
        return {
            "issuer": issuer,
            "authorization_endpoint": "https://github.com/login/oauth/authorize",
            "token_endpoint": "https://github.com/login/oauth/access_token",
            "scopes_supported": ["offline_access"],
        }

    monkeypatch.setattr(discovery_module, "_probe_401_resource_metadata", fake_probe)
    monkeypatch.setattr(discovery_module, "_fetch_prm_document", fake_prm)
    monkeypatch.setattr(discovery_module, "fetch_authorization_metadata", fake_metadata)

    found = await discover_oauth_from_mcp_url("https://api.githubcopilot.com/mcp/")
    assert found["available"] is True
    assert found["dcr_supported"] is False
    assert found["resource_scopes"] == ["repo", "read:org"]
    assert found["issuer"] == "https://github.com/login/oauth"


@pytest.mark.asyncio
async def test_start_custom_mcp_oauth_static_client_scope_and_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import octop.infra.connectors.oauth.registry as registry_module

    found = {
        "available": True,
        "issuer": "https://github.com/login/oauth",
        "resource": "https://api.githubcopilot.com/mcp/",
        "metadata": {
            "issuer": "https://github.com/login/oauth",
            "authorization_endpoint": "https://github.com/login/oauth/authorize",
            "token_endpoint": "https://github.com/login/oauth/access_token",
            "scopes_supported": ["offline_access"],
        },
        "scopes_supported": ["offline_access"],
        "resource_scopes": ["repo", "read:org"],
        "dcr_supported": False,
    }

    async def fake_discover(url: str) -> dict[str, object]:
        return found

    monkeypatch.setattr(registry_module, "discover_oauth_from_mcp_url", fake_discover)

    redirect = "http://127.0.0.1:8200/api/connectors/oauth/callback"
    url, _verifier, ctx = await registry_module.start_custom_mcp_oauth(
        server_name="github",
        mcp_url="https://api.githubcopilot.com/mcp/",
        redirect_uri=redirect,
        state="st",
        static_client={"client_id": "cid", "client_secret": "shh"},
    )
    assert url.startswith("https://github.com/login/oauth/authorize?")
    assert "scope=repo+read%3Aorg+offline_access" in url
    assert ctx["client_id"] == "cid"
    assert ctx["client_secret"] == "shh"

    with pytest.raises(ValueError, match="不支持动态客户端注册"):
        await registry_module.start_custom_mcp_oauth(
            server_name="github",
            mcp_url="https://api.githubcopilot.com/mcp/",
            redirect_uri=redirect,
            state="st",
        )
