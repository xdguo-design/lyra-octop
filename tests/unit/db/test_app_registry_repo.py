from pathlib import Path

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.app_registry import AppRegistryRepo
from octop.infra.db.repos.users import UserRepo


def test_app_grants_are_scoped_expiring_and_revocable(tmp_path: Path) -> None:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    users = UserRepo(db)
    owner_id = users.create(username="app-owner", password_hash="h", role="user")
    other_id = users.create(username="app-other", password_hash="h", role="user")
    AgentRepo(db).create(agent_id="app-agent", user_id=owner_id, name="App agent")
    repo = AppRegistryRepo(db)

    app = repo.create_registration(
        owner_user_id=owner_id, app_key="admission-registration", display_name="Admission"
    )
    assert app is not None
    assert (
        repo.create_registration(
            owner_user_id=owner_id, app_key="admission-registration", display_name="Duplicate"
        )
        is None
    )
    assert (
        repo.get_registration(owner_user_id=other_id, registration_id=app["registration_id"])
        is None
    )
    assert (
        repo.save_grant(
            owner_user_id=other_id,
            registration_id=app["registration_id"],
            agent_id="app-agent",
            read_scopes=["admission.patient.read"],
            write_scopes=["admission.narrative.write"],
            expires_at=None,
        )
        is None
    )

    grant = repo.save_grant(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="app-agent",
        read_scopes=["admission.patient.read"],
        write_scopes=["admission.narrative.write"],
        expires_at=1001,
    )
    assert grant is not None
    snapshot = repo.effective_scope_snapshot(owner_user_id=owner_id, agent_id="app-agent", now=1000)
    assert snapshot == [
        {
            "registration_id": app["registration_id"],
            "app_key": "admission-registration",
            "grant_id": grant["grant_id"],
            "expires_at": 1001,
            "read_scopes": ["admission.patient.read"],
            "write_scopes": ["admission.narrative.write"],
        }
    ]
    assert (
        repo.effective_scope_snapshot(owner_user_id=owner_id, agent_id="app-agent", now=1001) == []
    )
    assert repo.allows(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="app-agent",
        scope="admission.patient.read",
        write=False,
        now=1000,
    )
    assert not repo.allows(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="app-agent",
        scope="admission.patient.read",
        write=True,
        now=1000,
    )
    assert not repo.allows(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="app-agent",
        scope="admission.patient.read",
        write=False,
        now=1001,
    )

    assert repo.set_enabled(
        owner_user_id=owner_id, registration_id=app["registration_id"], enabled=False
    )
    assert (
        repo.effective_scope_snapshot(owner_user_id=owner_id, agent_id="app-agent", now=1000) == []
    )
    assert not repo.allows(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="app-agent",
        scope="admission.patient.read",
        write=False,
        now=1000,
    )
    assert repo.set_enabled(
        owner_user_id=owner_id, registration_id=app["registration_id"], enabled=True
    )
    assert repo.revoke_grant(owner_user_id=owner_id, grant_id=grant["grant_id"])
    assert repo.revoke_grant(owner_user_id=owner_id, grant_id=grant["grant_id"])
    assert (
        repo.effective_scope_snapshot(owner_user_id=owner_id, agent_id="app-agent", now=1000) == []
    )
    assert not repo.allows(
        owner_user_id=owner_id,
        registration_id=app["registration_id"],
        agent_id="app-agent",
        scope="admission.patient.read",
        write=False,
        now=1000,
    )
