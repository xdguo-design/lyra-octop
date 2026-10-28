"""CNB repository credentials used by the Creations project updater."""

from __future__ import annotations

from typing import Any


def list_tools() -> list[dict[str, Any]]:
    return []


def call_tool(_creds: dict[str, Any], name: str, _args: dict[str, Any]) -> str:
    raise ValueError(f"unknown tool: {name}")


def probe_credentials(creds: dict[str, Any]) -> None:
    if not str(creds.get("token") or "").strip():
        raise ValueError("CNB Access Token is required")
