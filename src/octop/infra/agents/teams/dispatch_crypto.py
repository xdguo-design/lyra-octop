"""Encryption for queued Team inbox payloads that may contain user data."""

from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet

from octop.infra.db.repos.secrets import SecretRepo

_FERNET_KEY = "team_dispatch_payload_fernet"
_MAX_PAYLOAD_BYTES = 1_048_576


def encrypt_dispatch(secret_repo: SecretRepo, payload: dict[str, Any]) -> bytes:
    serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(serialized) > _MAX_PAYLOAD_BYTES:
        raise ValueError("Team dispatch payload is too large to persist")
    key = secret_repo.get_or_create(_FERNET_KEY, Fernet.generate_key)
    return Fernet(key).encrypt(serialized)


def decrypt_dispatch(secret_repo: SecretRepo, encrypted: bytes) -> dict[str, Any]:
    if len(encrypted) > _MAX_PAYLOAD_BYTES + 2048:
        raise ValueError("Invalid encrypted Team dispatch payload")
    key = secret_repo.get_or_create(_FERNET_KEY, Fernet.generate_key)
    payload = json.loads(Fernet(key).decrypt(encrypted))
    if not isinstance(payload, dict):
        raise ValueError("Invalid encrypted Team dispatch payload")
    return payload
