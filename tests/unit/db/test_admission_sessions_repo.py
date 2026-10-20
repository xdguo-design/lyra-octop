from __future__ import annotations

from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.admission_sessions import AdmissionSessionRepo
from octop.infra.db.repos.users import UserRepo


@pytest.fixture
def repo(tmp_path: Path) -> tuple[AdmissionSessionRepo, int, int]:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    users = UserRepo(db)
    owner_id = users.create(username="admission-owner", password_hash="h", role="user")
    other_id = users.create(username="admission-other", password_hash="h", role="user")
    return AdmissionSessionRepo(db), owner_id, other_id


def test_session_and_turn_chain_are_persisted_and_owner_scoped(repo) -> None:
    sessions, owner_id, other_id = repo
    session = sessions.create(
        session_id="admission-session-1",
        owner_user_id=owner_id,
        patient_ref="patient-demo-1",
        application_id="APP-DEMO-1",
        phase="form",
        facts_json='{"phone":{"value":"13800138000","source_turn_id":"turn-1"}}',
        summary_json='{"department":"心内科"}',
        expires_at=4_000_000_000,
    )
    assert session.revision == 0
    assert sessions.get_owned(session.session_id, owner_id) == session
    assert sessions.get_owned(session.session_id, other_id) is None

    assert sessions.append_turn(
        session_id=session.session_id,
        owner_user_id=owner_id,
        expected_revision=0,
        turn_id="turn-1",
        previous_turn_id=None,
        speaker="patient",
        text="我的电话是13800138000",
        response="已记录联系电话。",
        action="fill_fields",
        fields_json='{"phone":"13800138000"}',
        status="completed",
        facts_json='{"phone":{"value":"13800138000","source_turn_id":"turn-1"}}',
        summary_json='{"phone":"13800138000"}',
        phase="form",
    )
    assert sessions.append_turn(
        session_id=session.session_id,
        owner_user_id=owner_id,
        expected_revision=0,
        turn_id="turn-1",
        previous_turn_id=None,
        speaker="patient",
        text="我的电话是13800138000",
        response="已记录联系电话。",
        action="fill_fields",
        fields_json='{"phone":"13800138000"}',
        status="completed",
        facts_json='{"phone":{"value":"13800138000","source_turn_id":"turn-1"}}',
        summary_json='{"phone":"13800138000"}',
        phase="form",
    )
    assert len(sessions.list_turns(session.session_id, owner_id)) == 1
    assert sessions.get_owned(session.session_id, owner_id).last_turn_id == "turn-1"


def test_session_revision_rejects_stale_or_foreign_turns(repo) -> None:
    sessions, owner_id, other_id = repo
    session = sessions.create(
        session_id="admission-session-2",
        owner_user_id=owner_id,
        patient_ref="patient-demo-1",
        application_id="APP-DEMO-1",
        phase="form",
        facts_json="{}",
        summary_json="{}",
        expires_at=4_000_000_000,
    )
    assert not sessions.append_turn(
        session_id=session.session_id,
        owner_user_id=other_id,
        expected_revision=0,
        turn_id="foreign-turn",
        previous_turn_id=None,
        speaker="patient",
        text="private",
        response="",
        action="none",
        fields_json="{}",
        status="completed",
        facts_json="{}",
        summary_json="{}",
        phase="form",
    )


def test_patient_sessions_can_be_deleted_without_touching_other_scopes(repo) -> None:
    sessions, owner_id, other_id = repo
    base = {
        "owner_user_id": owner_id,
        "patient_ref": "patient-demo-1",
        "application_id": "APP-DEMO-1",
        "phase": "form",
        "facts_json": "{}",
        "summary_json": "{}",
        "expires_at": 4_000_000_000,
    }
    old = sessions.create(session_id="admission-old", **base)
    other_patient = sessions.create(
        session_id="admission-other-patient", **{**base, "patient_ref": "patient-demo-2"}
    )
    other_owner = sessions.create(
        session_id="admission-other-owner",
        **{**base, "owner_user_id": other_id, "patient_ref": "patient-demo-1"},
    )
    other_application = sessions.create(
        session_id="admission-other-application",
        **{**base, "application_id": "APP-OTHER"},
    )
    assert sessions.append_turn(
        session_id=old.session_id,
        owner_user_id=owner_id,
        expected_revision=0,
        turn_id="old-turn",
        previous_turn_id=None,
        speaker="patient",
        text="旧对话",
        response="旧回复",
        action="voice_turn",
        fields_json='{"phone":"13800138000"}',
        status="completed",
        facts_json='{"phone":{"value":"13800138000"}}',
        summary_json='{"important":{"phone":"13800138000"}}',
        pending_proposal_json='{"occupation":"学生"}',
        phase="form",
    )

    assert sessions.delete_for_patient(owner_id, "patient-demo-1") == 2
    assert sessions.get_owned(old.session_id, owner_id) is None
    assert sessions.list_turns(old.session_id, owner_id) == []
    assert sessions.get_owned(other_patient.session_id, owner_id) == other_patient
    assert sessions.get_owned(other_owner.session_id, other_id) == other_owner
    assert sessions.get_owned(other_application.session_id, owner_id) is None


def test_create_or_get_is_idempotent_for_repeated_or_concurrent_selection(repo) -> None:
    from concurrent.futures import ThreadPoolExecutor

    sessions, owner_id, _other_id = repo
    values = {
        "session_id": "admission-concurrent-select",
        "owner_user_id": owner_id,
        "patient_ref": "patient-demo-1",
        "application_id": "APP-DEMO-1",
        "phase": "form",
        "facts_json": "{}",
        "summary_json": "{}",
        "expires_at": 4_000_000_000,
    }
    with ThreadPoolExecutor(max_workers=4) as executor:
        created = list(executor.map(lambda _: sessions.create_or_get(**values), range(8)))

    assert all(row is not None for row in created)
    assert {row.session_id for row in created if row is not None} == {values["session_id"]}
    assert sessions.get_owned(values["session_id"], owner_id).revision == 0


def test_final_review_is_revision_bound_and_requires_no_pending_proposal(repo) -> None:
    sessions, owner_id, _other_id = repo
    session = sessions.create(
        session_id="admission-session-review",
        owner_user_id=owner_id,
        patient_ref="patient-demo-1",
        application_id="APP-DEMO-1",
        phase="form",
        facts_json="{}",
        summary_json="{}",
        expires_at=4_000_000_000,
    )

    assert sessions.mark_reviewed(
        session_id=session.session_id,
        owner_user_id=owner_id,
        expected_revision=0,
        facts_json='{"phone":{"value":"13800138000","confirmed":true}}',
        summary_json='{"reviewFingerprint":"fingerprint-1"}',
    )
    reviewed = sessions.get_owned(session.session_id, owner_id)
    assert reviewed is not None and reviewed.phase == "review" and reviewed.revision == 1
    assert not sessions.mark_reviewed(
        session_id=session.session_id,
        owner_user_id=owner_id,
        expected_revision=0,
        facts_json="{}",
        summary_json="{}",
    )
    assert not sessions.append_turn(
        session_id=session.session_id,
        owner_user_id=owner_id,
        expected_revision=4,
        turn_id="stale-turn",
        previous_turn_id=None,
        speaker="patient",
        text="stale",
        response="",
        action="none",
        fields_json="{}",
        status="completed",
        facts_json="{}",
        summary_json="{}",
        phase="form",
    )
