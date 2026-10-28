from __future__ import annotations

import pytest

from octop.infra.ehr_public import (
    PUBLIC_EHR_TYPES,
    PublicEhrRateLimiter,
    project_public_search_response,
    public_search_payload,
)


def test_public_search_payload_forces_medical_scope() -> None:
    assert public_search_payload("阿司匹林", 12) == {
        "query": "阿司匹林",
        "filters": {"type": sorted(PUBLIC_EHR_TYPES)},
        "top_k": 12,
    }


def test_public_search_projection_removes_private_types_and_paths() -> None:
    payload = {
        "results": [
            {
                "id": "drug:1",
                "type": "drug",
                "title": "阿司匹林",
                "score": 0.9,
                "vector_score": 0.8,
                "keyword_score": 0.7,
                "snippet": "药品说明",
                "meta": {
                    "manufacturer": "示例药厂",
                    "path": "/srv/private/drugs.json",
                    "secret": {"token": "do-not-expose"},
                },
            },
            {
                "id": "code:1",
                "type": "code",
                "title": "PrivateService.java",
                "snippet": "private source",
                "meta": {"path": "/srv/private/repository"},
            },
        ]
    }

    projected = project_public_search_response("阿司匹林", payload)

    assert projected["total"] == 1
    assert projected["results"][0]["meta"] == {"manufacturer": "示例药厂"}
    assert "private" not in str(projected)
    assert "token" not in str(projected)


def test_public_search_projection_caps_untrusted_upstream_results() -> None:
    payload = {
        "results": [
            {
                "id": f"drug:{index}",
                "type": "drug",
                "title": "药品",
                "snippet": "说明",
            }
            for index in range(20)
        ]
    }

    projected = project_public_search_response("药品", payload)

    assert projected["total"] == 12


def test_public_search_projection_rejects_malformed_upstream() -> None:
    with pytest.raises(ValueError, match="invalid EHR search response"):
        project_public_search_response("query", {"results": "not-a-list"})


def test_public_search_rate_limiter_recovers_after_window() -> None:
    now = [100.0]
    limiter = PublicEhrRateLimiter(limit=2, window_seconds=10, now=lambda: now[0])

    assert limiter.allow("203.0.113.10")
    assert limiter.allow("203.0.113.10")
    assert not limiter.allow("203.0.113.10")
    now[0] = 111.0
    assert limiter.allow("203.0.113.10")


def test_public_search_rate_limiter_reclaims_stale_clients() -> None:
    now = [100.0]
    limiter = PublicEhrRateLimiter(
        limit=1,
        window_seconds=10,
        max_clients=1,
        now=lambda: now[0],
    )

    assert limiter.allow("203.0.113.10")
    assert not limiter.allow("203.0.113.11")
    now[0] = 111.0
    assert limiter.allow("203.0.113.11")
