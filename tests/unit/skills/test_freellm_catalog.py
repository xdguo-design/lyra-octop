"""FreeLLM catalog is untrusted remote input: reject unsafe fields before use."""
from __future__ import annotations

import pytest

from octop.infra.skills.freellm_catalog import FreeLLMSyncError, normalize_catalog


def record(skill_id: str = "safe-skill", **extra: object) -> dict[str, object]:
    return {
        "id": skill_id,
        "name": "Example",
        "status": "verified",
        "contentPath": f"skill-content/{skill_id}.md",
        "githubUrl": "https://github.com/example/skills/tree/main",
        "description": "A reviewed listing",
        **extra,
    }


def test_verified_catalog_and_dedupe() -> None:
    assert normalize_catalog([record(), record(), record("other")]) == [
        {
            "id": "safe-skill", "name": "Example", "description": "A reviewed listing",
            "category": "", "status": "verified", "github_url": "https://github.com/example/skills/tree/main",
            "content_path": "skill-content/safe-skill.md", "last_checked_at": "",
        },
        {
            "id": "other", "name": "Example", "description": "A reviewed listing",
            "category": "", "status": "verified", "github_url": "https://github.com/example/skills/tree/main",
            "content_path": "skill-content/other.md", "last_checked_at": "",
        },
    ]


@pytest.mark.parametrize("unsafe", [
    record("../secrets"),
    record("bad/slug"),
    record("safe-skill", contentPath="skill-content/../../secret.md"),
    record("safe-skill", githubUrl="http://localhost/unsafe"),
    record("safe-skill", status="needs_review"),
    record("safe-skill", name=""),
])
def test_reject_untrusted_catalog_records(unsafe: dict[str, object]) -> None:
    assert normalize_catalog([unsafe]) == []


def test_reject_giant_catalog() -> None:
    with pytest.raises(FreeLLMSyncError, match="entry limit"):
        normalize_catalog([record()] * 5001)
