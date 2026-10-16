"""Read-only, pinned-origin FreeLLM Skill directory integration.

Remote SKILL.md content is untrusted. Fetching or previewing never executes it.
Publishing requires a separate, explicitly approved workflow.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx

_ORIGIN = "https://freellm.top"
_CATALOG_PATH = "/data/skills.json"
_SKILL_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,119}\Z")
_MAX_CATALOG_BYTES = 2_000_000
_MAX_SKILL_BYTES = 160_000


class FreeLLMSyncError(ValueError):
    pass


def normalize_catalog(raw: object) -> list[dict[str, str]]:
    """Reject malformed entries; only list verifiable, source-linked records."""
    if not isinstance(raw, list):
        raise FreeLLMSyncError("invalid FreeLLM catalog")
    if len(raw) > 5000:
        raise FreeLLMSyncError("FreeLLM catalog exceeds entry limit")
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        skill_id = entry.get("id")
        if not isinstance(skill_id, str) or not _SKILL_ID.fullmatch(skill_id):
            continue
        if skill_id in seen or entry.get("status") != "verified":
            continue
        path = entry.get("contentPath")
        if path != f"skill-content/{skill_id}.md":
            continue
        source = entry.get("githubUrl")
        if not isinstance(source, str) or not source.startswith("https://github.com/"):
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        seen.add(skill_id)
        result.append({
            "id": skill_id,
            "name": name[:160],
            "description": str(entry.get("description") or "")[:450],
            "category": str(entry.get("category") or "")[:64],
            "status": "verified",
            "github_url": source[:1024],
            "content_path": path,
            "last_checked_at": str(entry.get("lastCheckedAt") or "")[:32],
        })
    return result


async def _fetch_from_freellm(path: str, max_bytes: int) -> bytes:
    # Both URL paths are constructed by us; callers cannot supply host or redirects.
    async with (
        httpx.AsyncClient(timeout=12, follow_redirects=False, trust_env=False) as client,
        client.stream(
            "GET", _ORIGIN + path, headers={"Accept": "application/json, text/plain"}
        ) as response,
    ):
            if response.status_code != 200:
                raise FreeLLMSyncError(f"FreeLLM returned HTTP {response.status_code}")
            if response.headers.get("content-length") and int(response.headers["content-length"]) > max_bytes:
                raise FreeLLMSyncError("FreeLLM response exceeds size limit")
            chunks: list[bytes] = []
            size = 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > max_bytes:
                    raise FreeLLMSyncError("FreeLLM response exceeds size limit")
                chunks.append(chunk)
    return b"".join(chunks)


async def list_freellm_skills() -> list[dict[str, str]]:
    try:
        raw = json.loads((await _fetch_from_freellm(_CATALOG_PATH, _MAX_CATALOG_BYTES)).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FreeLLMSyncError("FreeLLM returned an invalid catalog") from exc
    return normalize_catalog(raw)


async def preview_freellm_skill(skill_id: str) -> dict[str, Any]:
    if not _SKILL_ID.fullmatch(skill_id):
        raise FreeLLMSyncError("invalid FreeLLM skill id")
    catalog = await list_freellm_skills()
    entry = next((item for item in catalog if item["id"] == skill_id), None)
    if entry is None:
        raise FreeLLMSyncError("skill not available in verified FreeLLM catalog")
    content = await _fetch_from_freellm(f"/data/{entry['content_path']}", _MAX_SKILL_BYTES)
    try:
        markdown = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise FreeLLMSyncError("Skill content is not valid UTF-8") from exc
    if not markdown.startswith("---\n") or len(markdown) < 20:
        raise FreeLLMSyncError("Skill content is not a SKILL.md manifest")
    return {**entry, "markdown": markdown, "content_bytes": len(content)}
