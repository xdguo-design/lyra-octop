"""Encryption for durable HITL request payloads."""

from __future__ import annotations

import json
from typing import Any

from cryptography.fernet import Fernet

from octop.infra.db.repos.secrets import SecretRepo

_FERNET_KEY = "hitl_pending_fernet"


def encrypt_pending(secret_repo: SecretRepo, payload: dict[str, Any]) -> bytes:
    key = secret_repo.get_or_create(_FERNET_KEY, Fernet.generate_key)
    serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    return Fernet(key).encrypt(serialized.encode("utf-8"))


def decrypt_pending(secret_repo: SecretRepo, encrypted: bytes) -> dict[str, Any]:
    key = secret_repo.get_or_create(_FERNET_KEY, Fernet.generate_key)
    payload = json.loads(Fernet(key).decrypt(encrypted))
    if not isinstance(payload, dict):
        raise ValueError("Invalid encrypted HITL payload")
    return payload
