"""Security boundary for the anonymous EHR knowledge surface."""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

PUBLIC_EHR_TYPES = frozenset(
    {"drug", "clinic_item", "diagnosis", "knowledge", "frequency", "usage"}
)
_PUBLIC_META_KEYS = frozenset(
    {"category", "department", "item_type", "manufacturer", "insurance", "form", "flags", "spec"}
)


def public_search_payload(query: str, top_k: int) -> dict[str, Any]:
    """Force anonymous searches into the curated medical-only scope."""
    return {
        "query": query,
        "filters": {"type": sorted(PUBLIC_EHR_TYPES)},
        "top_k": top_k,
    }


def project_public_search_response(query: str, payload: object) -> dict[str, Any]:
    """Fail closed and remove paths or non-medical records from an upstream response."""
    if not isinstance(payload, dict):
        raise ValueError("invalid EHR search response")
    raw_results = payload.get("results")
    if not isinstance(raw_results, list):
        raise ValueError("invalid EHR search response")

    projected: list[dict[str, Any]] = []
    for raw in raw_results[:12]:
        if not isinstance(raw, dict) or raw.get("type") not in PUBLIC_EHR_TYPES:
            continue
        result_id = raw.get("id")
        title = raw.get("title")
        snippet = raw.get("snippet")
        if (
            not isinstance(result_id, str)
            or not isinstance(title, str)
            or not isinstance(snippet, str)
        ):
            continue
        raw_meta = raw.get("meta")
        meta = {}
        if isinstance(raw_meta, dict):
            for key, value in raw_meta.items():
                if key in _PUBLIC_META_KEYS:
                    safe_value = _public_meta_value(value)
                    if safe_value is not None:
                        meta[key] = safe_value
        projected.append(
            {
                "id": result_id[:200],
                "type": raw["type"],
                "title": title[:300],
                "score": _number(raw.get("score")),
                "vector_score": _number(raw.get("vector_score")),
                "keyword_score": _number(raw.get("keyword_score")),
                "snippet": snippet[:4000],
                "meta": meta,
            }
        )

    return {"query": query, "total": len(projected), "results": projected}


def _number(value: object) -> float:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0.0


def _public_meta_value(value: object) -> str | int | float | bool | list[str] | None:
    if isinstance(value, str):
        return value[:500]
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, list) and all(isinstance(item, str) for item in value[:20]):
        return [item[:200] for item in value[:20]]
    return None


@dataclass
class PublicEhrRateLimiter:
    """Bound anonymous search cost per trusted client address."""

    limit: int = 30
    window_seconds: float = 60.0
    max_clients: int = 10_000
    now: Callable[[], float] = field(default=time.monotonic)
    _requests: dict[str, deque[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def allow(self, client_id: str) -> bool:
        now = self.now()
        cutoff = now - self.window_seconds
        with self._lock:
            bucket = self._requests.get(client_id)
            if bucket is None:
                if len(self._requests) >= self.max_clients:
                    stale = [
                        key
                        for key, requests in self._requests.items()
                        if not requests or requests[-1] <= cutoff
                    ]
                    for key in stale:
                        del self._requests[key]
                    if len(self._requests) >= self.max_clients:
                        return False
                bucket = deque()
                self._requests[client_id] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                return False
            bucket.append(now)
            return True
