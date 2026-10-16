"""Publish an explicitly approved LYRA Skill as a review-only FreeLLM GitHub PR.

Never update FreeLLM's live catalog, main branch, or automatically merge a PR.
GitHub access is server-side; no authorization token reaches an Agent or browser.
"""
from __future__ import annotations

import base64
import hashlib
import os
import re
from typing import Any

import httpx

from octop.infra.skills.freellm_catalog import FreeLLMSyncError

_REPOSITORY_API = "https://api.github.com/repos/xdguo-design/freellm"
_ALLOWED_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{0,119}\Z")
_MAX_BYTES = 160_000


def submission_digest(markdown: str) -> str:
    return hashlib.sha256(markdown.encode("utf-8")).hexdigest()


def submission_path(slug: str) -> str:
    if not _ALLOWED_SLUG.fullmatch(slug):
        raise FreeLLMSyncError("invalid Skill submission slug")
    return f"data/lyra-submissions/{slug}.md"


async def submit_review_pull_request(
    *,
    slug: str,
    markdown: str,
    approved_digest: str,
    approved_publication: bool,
) -> dict[str, Any]:
    """Submit only when the owner confirms the exact bytes for public review."""
    path = submission_path(slug)
    data = markdown.encode("utf-8")
    digest = submission_digest(markdown)
    if len(data) > _MAX_BYTES:
        raise FreeLLMSyncError("Skill manifest exceeds public submission size limit")
    if not approved_publication or digest != approved_digest:
        raise FreeLLMSyncError("publication approval or reviewed content hash missing")
    token = os.environ.get("FREELLM_SYNC_GITHUB_TOKEN", "").strip()
    if not token:
        raise FreeLLMSyncError("FreeLLM GitHub submission is not configured")
    branch = f"lyra-review/{slug}-{digest[:12]}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=20, trust_env=False, follow_redirects=False) as client:
        async def github(method: str, endpoint: str, **kwargs: Any) -> dict[str, Any]:
            response = await client.request(method, _REPOSITORY_API + endpoint, headers=headers, **kwargs)
            if response.status_code < 200 or response.status_code >= 300:
                # Never expose GitHub's raw response, which may contain private details.
                raise FreeLLMSyncError(f"GitHub submission request failed: HTTP {response.status_code}")
            payload: Any = response.json()
            if not isinstance(payload, dict):
                raise FreeLLMSyncError("GitHub returned an invalid response")
            return payload

        dev = await github("GET", "/git/ref/heads/dev")
        base_sha = dev.get("object", {}).get("sha")
        if not isinstance(base_sha, str) or not re.fullmatch(r"[a-f0-9]{40}", base_sha):
            raise FreeLLMSyncError("Cannot resolve the FreeLLM dev branch")
        await github("POST", "/git/refs", json={"ref": f"refs/heads/{branch}", "sha": base_sha})
        await github(
            "PUT",
            "/contents/" + path,
            json={
                "message": f"docs(skills): propose {slug} from LYRA for review",
                "content": base64.b64encode(data).decode("ascii"),
                "branch": branch,
            },
        )
        pr = await github(
            "POST",
            "/pulls",
            json={
                "title": f"review(skills): LYRA submission {slug}",
                "head": branch,
                "base": "dev",
                "body": (
                    "Submitted from LYRA after the package owner's explicit review.\n\n"
                    f"- Original Skill slug: `{slug}`\n"
                    f"- SHA-256: `{digest}`\n"
                    "- Review provenance, author/license, secrets, prompt injection and "
                    "sidecar file dependencies before curating this into data/skills.json.\n"
                    "- Do not auto-publish this PR.\n"
                ),
                "draft": True,
            },
        )
    pr_url = pr.get("html_url")
    if not isinstance(pr_url, str) or not pr_url.startswith(
        "https://github.com/xdguo-design/freellm/pull/"
    ):
        raise FreeLLMSyncError("GitHub did not return a valid pull request URL")
    return {
        "status": "submitted_for_review",
        "published": False,
        "pull_request_url": pr_url,
        "digest": digest,
        "target_branch": "dev",
    }
