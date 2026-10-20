from __future__ import annotations

import json
from copy import deepcopy
from hashlib import sha256
from time import monotonic
from uuid import uuid4

SESSION_TTL_SECONDS = 30 * 60
MAX_SESSIONS = 500
MAX_SUBMISSIONS = 2000


class StoreCapacityError(Exception):
    pass


class DemoStore:
    """Process-local fake identity and idempotency records; contains no real patient data."""

    def __init__(self) -> None:
        self.identities: dict[str, dict[str, object]] = {}
        self.submissions: dict[tuple[str, str], tuple[str, dict[str, object]]] = {}

    def verify(self, method: str) -> dict[str, object]:
        self._prune()
        if len(self.identities) >= MAX_SESSIONS:
            raise StoreCapacityError
        token = str(uuid4())
        fields: dict[str, object] = {
            "name": "吴晓东",
            "idNumber": "211003198709081234",
            "phone": "13841928804",
            "nationality": "中国",
            "ethnicity": "汉族",
            "nativeRegion": [],
            "residentRegion": [],
            "addressDetail": "",
            "employerName": "",
            "employerAddress": "",
            "marriage": "",
            "occupation": "",
            "emergencyContact": "",
            "relationship": "",
        }
        self.identities[token] = {
            "method": method,
            "fields": deepcopy(fields),
            "expiresAt": monotonic() + SESSION_TTL_SECONDS,
        }
        return {"mock": True, "verified": True, "identityToken": token, "fields": fields}

    def identity(self, token: str) -> dict[str, object] | None:
        self._prune()
        return self.identities.get(token)

    def submit(
        self, token: str, key: str, fields: dict[str, object], scenario: str
    ) -> tuple[str, dict[str, object]] | None:
        identity = self.identity(token)
        if identity is None:
            return None
        record_key = (token, key)
        fingerprint = sha256(
            json.dumps([fields, scenario], ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        if record_key in self.submissions:
            previous_fingerprint, previous_result = self.submissions[record_key]
            return previous_fingerprint, deepcopy(previous_result)
        if len(self.submissions) >= MAX_SUBMISSIONS:
            raise StoreCapacityError
        result: dict[str, object] = {"mock": True, "status": scenario}
        if scenario == "success":
            result.update(
                {
                    "receiptId": f"SIM-{uuid4().hex[:10].upper()}",
                    "notificationSent": False,
                    "printSucceeded": False,
                }
            )
        self.submissions[record_key] = (fingerprint, result)
        return fingerprint, deepcopy(result)

    def result(self, token: str, key: str) -> dict[str, object] | None:
        self._prune()
        record = self.submissions.get((token, key))
        return deepcopy(record[1]) if record else None

    def reset(self) -> None:
        self.identities.clear()
        self.submissions.clear()

    def _prune(self) -> None:
        expired = [
            token for token, data in self.identities.items() if data["expiresAt"] <= monotonic()
        ]
        for token in expired:
            self.identities.pop(token, None)
        if expired:
            for record_key in list(self.submissions):
                if record_key[0] in expired:
                    self.submissions.pop(record_key, None)
