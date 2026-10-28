from typing import Any

from tests.support.auth import create_agent, create_user, resolve_user_id


async def test_app_registration_grants_are_owner_scoped_and_rechecked(
    env_with_agent: Any,
) -> None:
    client, server, auth, agent_id = env_with_agent
    created = await client.post(
        "/api/apps",
        headers=auth,
        json={"app_key": "admission-registration", "display_name": "Admission"},
    )
    assert created.status_code == 201, created.text
    app = created.json()
    registration_id = app["registration_id"]
    assert app["adapter_kind"] == "mock"
    duplicate = await client.post(
        "/api/apps",
        headers=auth,
        json={"app_key": "admission-registration", "display_name": "Again"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "APP_REGISTRATION_EXISTS"

    invalid = await client.post(
        f"/api/apps/{registration_id}/grants",
        headers=auth,
        json={"agent_id": agent_id, "read_scopes": ["admission.narrative.write"]},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "APP_SCOPE_INVALID"

    grant_response = await client.post(
        f"/api/apps/{registration_id}/grants",
        headers=auth,
        json={
            "agent_id": agent_id,
            "read_scopes": ["admission.patient.read"],
            "write_scopes": ["admission.narrative.write"],
        },
    )
    assert grant_response.status_code == 201, grant_response.text
    grant = grant_response.json()
    assert grant["read_scopes"] == ["admission.patient.read"]
    assert grant["write_scopes"] == ["admission.narrative.write"]
    repo = server.services.app_registry_repo
    owner_id = await resolve_user_id(client, auth, "admin")
    assert repo.allows(
        owner_user_id=owner_id,
        registration_id=registration_id,
        agent_id=agent_id,
        scope="admission.patient.read",
        write=False,
    )
    assert not repo.allows(
        owner_user_id=owner_id,
        registration_id=registration_id,
        agent_id=agent_id,
        scope="admission.narrative.write",
        write=False,
    )

    peer_auth = await create_user(client, auth, username="app-registry-peer")
    other_agent = await create_agent(client, peer_auth)
    hidden = await client.post(
        f"/api/apps/{registration_id}/grants",
        headers=peer_auth,
        json={"agent_id": other_agent, "read_scopes": ["admission.patient.read"]},
    )
    assert hidden.status_code == 404
    hidden_app = await client.get(f"/api/apps/{registration_id}/grants", headers=peer_auth)
    assert hidden_app.status_code == 404

    revoked = await client.delete(f"/api/apps/grants/{grant['grant_id']}", headers=auth)
    assert revoked.status_code == 204
    assert (
        await client.delete(f"/api/apps/grants/{grant['grant_id']}", headers=auth)
    ).status_code == 204
    assert not repo.allows(
        owner_user_id=owner_id,
        registration_id=registration_id,
        agent_id=agent_id,
        scope="admission.patient.read",
        write=False,
    )


async def test_app_registration_rejects_blank_name_and_past_expiry(env_with_agent: Any) -> None:
    client, _server, auth, agent_id = env_with_agent
    blank = await client.post(
        "/api/apps", headers=auth, json={"app_key": "admission-registration", "display_name": "   "}
    )
    assert blank.status_code == 422
    assert blank.json()["error"]["code"] == "APP_DISPLAY_NAME_INVALID"
    app = await client.post(
        "/api/apps",
        headers=auth,
        json={"app_key": "admission-registration", "display_name": "Admission"},
    )
    assert app.status_code == 201, app.text
    expired = await client.post(
        f"/api/apps/{app.json()['registration_id']}/grants",
        headers=auth,
        json={"agent_id": agent_id, "read_scopes": ["admission.patient.read"], "expires_at": 1},
    )
    assert expired.status_code == 422
    assert expired.json()["error"]["code"] == "APP_GRANT_EXPIRY_INVALID"
