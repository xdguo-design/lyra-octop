from fastapi.testclient import TestClient

from admission_registration.main import app, store


def test_validation_and_mock_submission_are_rechecked_server_side() -> None:
    store.reset()
    client = TestClient(app)
    identity = client.post(
        "/api/admission-registration/v1/identity/verify", json={"method": "id_card"}
    )
    assert identity.status_code == 200
    verification = identity.json()
    fields = verification["fields"]
    fields.update(
        {
            "marriage": "未婚",
            "occupation": "职工",
            "emergencyContact": "王小明",
            "relationship": "子女",
        }
    )
    fields["phone"] = "bad"
    assert (
        client.post(
            "/api/admission-registration/v1/submissions",
            json={
                "identityToken": verification["identityToken"],
                "idempotencyKey": "intent-1",
                "fields": fields,
            },
        ).status_code
        == 422
    )
    fields["phone"] = "13800138000"
    response = client.post(
        "/api/admission-registration/v1/submissions",
        json={
            "identityToken": verification["identityToken"],
            "idempotencyKey": "intent-1",
            "fields": fields,
        },
    )
    assert response.status_code == 200
    assert response.json()["mock"] is True
    assert (
        client.post(
            "/api/admission-registration/v1/submissions",
            json={
                "identityToken": verification["identityToken"],
                "idempotencyKey": "intent-1",
                "fields": fields,
            },
        ).json()
        == response.json()
    )
    assert (
        client.post(
            "/api/admission-registration/v1/submissions/result",
            json={
                "identityToken": verification["identityToken"],
                "idempotencyKey": "intent-1",
            },
        ).json()
        == response.json()
    )


def test_identity_snapshot_cannot_be_replaced_by_client() -> None:
    store.reset()
    client = TestClient(app)
    verification = client.post(
        "/api/admission-registration/v1/identity/verify", json={"method": "id_card"}
    ).json()
    fields = verification["fields"]
    fields.update(
        {
            "phone": "13800138000",
            "marriage": "未婚",
            "occupation": "职工",
            "emergencyContact": "王小明",
            "relationship": "子女",
        }
    )
    fields["idNumber"] = "ATTACKER-CONTROLLED"
    response = client.post(
        "/api/admission-registration/v1/submissions",
        json={
            "identityToken": verification["identityToken"],
            "idempotencyKey": "intent-2",
            "fields": fields,
        },
    )
    assert response.status_code == 409


def test_idempotency_key_cannot_be_reused_for_different_payload() -> None:
    store.reset()
    client = TestClient(app)
    verification = client.post(
        "/api/admission-registration/v1/identity/verify", json={"method": "id_card"}
    ).json()
    fields = verification["fields"]
    fields.update(
        {
            "phone": "13800138000",
            "marriage": "未婚",
            "occupation": "职工",
            "emergencyContact": "王小明",
            "relationship": "子女",
        }
    )
    payload = {
        "identityToken": verification["identityToken"],
        "idempotencyKey": "intent-3",
        "fields": fields,
    }
    assert (
        client.post("/api/admission-registration/v1/submissions", json=payload).status_code == 200
    )
    payload["fields"] = {**fields, "addressDetail": "篡改的第二份请求"}
    assert (
        client.post("/api/admission-registration/v1/submissions", json=payload).status_code == 409
    )


def test_mock_scenarios_are_idempotent_and_isolated_to_each_identity_request() -> None:
    store.reset()
    client = TestClient(app)

    def submit(key: str, scenario: str) -> dict:
        verification = client.post(
            "/api/admission-registration/v1/identity/verify", json={"method": "id_card"}
        ).json()
        fields = verification["fields"]
        fields.update(
            {
                "phone": "13800138000",
                "marriage": "未婚",
                "occupation": "职工",
                "emergencyContact": "王小明",
                "relationship": "子女",
            }
        )
        return client.post(
            "/api/admission-registration/v1/submissions",
            json={
                "identityToken": verification["identityToken"],
                "idempotencyKey": key,
                "mockScenario": scenario,
                "fields": fields,
            },
        ).json()

    first = submit("patient-session-1", "success")
    already_registered = submit("patient-session-2", "already_registered")
    failed = submit("patient-session-3", "failed")
    assert first["status"] == "success"
    assert already_registered["status"] == "already_registered"
    assert already_registered["receiptId"] is None
    assert failed["status"] == "failed"

    store.reset()
    assert submit("patient-session-4", "unknown")["status"] == "unknown"
    assert submit("patient-session-5", "success")["status"] == "success"


def test_mock_identity_failed_and_missing_profile_do_not_issue_token() -> None:
    client = TestClient(app)
    failed = client.post(
        "/api/admission-registration/v1/identity/verify",
        json={"method": "id_card", "mockScenario": "failed"},
    )
    missing = client.post(
        "/api/admission-registration/v1/identity/verify",
        json={"method": "id_card", "mockScenario": "no_profile"},
    )
    assert failed.status_code == 422
    assert missing.status_code == 404
    assert "identityToken" not in failed.text + missing.text


def test_expired_mock_identity_cannot_submit_or_query(monkeypatch) -> None:
    import admission_registration.store as store_module

    store.reset()
    client = TestClient(app)
    verification = client.post(
        "/api/admission-registration/v1/identity/verify", json={"method": "id_card"}
    ).json()
    store.identities[verification["identityToken"]]["expiresAt"] = store_module.monotonic() - 1
    result = client.post(
        "/api/admission-registration/v1/submissions/result",
        json={"identityToken": verification["identityToken"], "idempotencyKey": "intent-4"},
    )
    assert result.status_code == 401
