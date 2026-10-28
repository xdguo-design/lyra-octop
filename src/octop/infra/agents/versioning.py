"""Capture and read encrypted immutable Agent configuration snapshots."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet

from octop.infra.agents.settings.profile import id_list_from_row, parse_config_json
from octop.infra.db.repos.agent_versions import AgentVersionRepo, AgentVersionRow
from octop.infra.db.repos.agents import AgentRow
from octop.infra.db.repos.secrets import SecretRepo

_SCHEMA_VERSION = 1
_FERNET_KEY = "agent_version_fernet"


def _fernet(secret_repo: SecretRepo) -> Fernet:
    return Fernet(secret_repo.get_or_create(_FERNET_KEY, Fernet.generate_key))


def _snapshot(row: AgentRow) -> dict[str, Any]:
    return {
        "schema_version": _SCHEMA_VERSION,
        "agent_id": row.agent_id,
        "name": row.name,
        "description": row.description,
        "persona_mbti": row.persona_mbti,
        "default_model": row.default_model,
        "system_prompt": row.system_prompt,
        "config": parse_config_json(row.config_json),
        "kind": row.kind,
        "skill_package_ids": id_list_from_row(row, "skill_package_ids"),
        "published_expert_id": row.published_expert_id,
        "knowledge_base_ids": id_list_from_row(row, "knowledge_base_ids"),
        "mcp_servers": id_list_from_row(row, "mcp_servers"),
    }


def capture_agent_version(
    row: AgentRow,
    *,
    created_by: int,
    version_repo: AgentVersionRepo,
    secret_repo: SecretRepo,
) -> AgentVersionRow:
    serialized = json.dumps(
        _snapshot(row), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return version_repo.capture(
        agent_id=row.agent_id,
        created_by=created_by,
        schema_version=_SCHEMA_VERSION,
        content_hash=hashlib.sha256(serialized.encode("utf-8")).hexdigest(),
        snapshot_blob=_fernet(secret_repo).encrypt(serialized.encode("utf-8")),
    )


def read_agent_version_snapshot(
    version: AgentVersionRow,
    *,
    secret_repo: SecretRepo,
) -> dict[str, Any]:
    payload = json.loads(_fernet(secret_repo).decrypt(version.snapshot_blob))
    if not isinstance(payload, dict) or payload.get("schema_version") != version.schema_version:
        raise ValueError("Unsupported AgentVersion snapshot")
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if hashlib.sha256(serialized.encode("utf-8")).hexdigest() != version.content_hash:
        raise ValueError("AgentVersion snapshot hash mismatch")
    return payload
