"""Safe outbound FreeLLM submission requires exact-content public consent."""

from __future__ import annotations

import pytest

from octop.infra.skills.freellm_catalog import FreeLLMSyncError
from octop.infra.skills.freellm_submission import (
    submission_digest,
    submission_path,
    submit_review_pull_request,
)


def test_submission_path_rejects_traversal() -> None:
    assert submission_path("freellm-safe") == "data/lyra-submissions/freellm-safe.md"
    for slug in ("../../users", "foo/bar", "UPPER", "", ".env"):
        with pytest.raises(FreeLLMSyncError, match="slug"):
            submission_path(slug)


@pytest.mark.asyncio
async def test_public_consent_and_exact_digest_are_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FREELLM_SYNC_GITHUB_TOKEN", "non-production-fixture")
    with pytest.raises(FreeLLMSyncError, match="approval"):
        await submit_review_pull_request(
            slug="demo",
            markdown="---\nname: demo\n---\n",
            approved_digest=submission_digest("different"),
            approved_publication=True,
        )
    with pytest.raises(FreeLLMSyncError, match="approval"):
        await submit_review_pull_request(
            slug="demo",
            markdown="---\nname: demo\n---\n",
            approved_digest=submission_digest("---\nname: demo\n---\n"),
            approved_publication=False,
        )


@pytest.mark.asyncio
async def test_no_submission_without_server_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("FREELM_SYNC_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("FREELLM_SYNC_GITHUB_TOKEN", raising=False)
    markdown = "---\nname: demo\n---\n"
    with pytest.raises(FreeLLMSyncError, match="not configured"):
        await submit_review_pull_request(
            slug="demo",
            markdown=markdown,
            approved_digest=submission_digest(markdown),
            approved_publication=True,
        )
