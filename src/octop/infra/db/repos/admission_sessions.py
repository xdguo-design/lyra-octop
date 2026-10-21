"""Persistence for short-lived admission registration facts and linked turns."""

from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import uuid4

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, now_ts


@dataclass(frozen=True)
class AdmissionSessionRow:
    session_id: str
    owner_user_id: int
    patient_ref: str
    application_id: str
    phase: str
    revision: int
    facts_json: str
    summary_json: str
    pending_proposal_json: str | None
    last_turn_id: str | None
    expires_at: int
    created_at: int
    updated_at: int

    @classmethod
    def from_row(cls, row: DbRow) -> AdmissionSessionRow:
        return cls(**{field: row[field] for field in cls.__dataclass_fields__})


@dataclass(frozen=True)
class AdmissionTurnRow:
    turn_id: str
    session_id: str
    previous_turn_id: str | None
    speaker: str
    utterance: str
    response: str
    action: str
    fields_json: str
    status: str
    created_at: int

    @classmethod
    def from_row(cls, row: DbRow) -> AdmissionTurnRow:
        return cls(**{field: row[field] for field in cls.__dataclass_fields__})


class AdmissionSessionRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def create(
        self,
        *,
        session_id: str | None = None,
        owner_user_id: int,
        patient_ref: str,
        application_id: str,
        phase: str,
        facts_json: str,
        summary_json: str,
        expires_at: int,
    ) -> AdmissionSessionRow:
        session_id = session_id or f"adm_{uuid4().hex}"
        now = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO admission_registration_sessions "
                "(session_id, owner_user_id, patient_ref, application_id, phase, revision, "
                "facts_json, summary_json, expires_at, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
                (
                    session_id,
                    owner_user_id,
                    patient_ref,
                    application_id,
                    phase,
                    facts_json,
                    summary_json,
                    expires_at,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM admission_registration_sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        return AdmissionSessionRow.from_row(row)

    def create_or_get(
        self,
        *,
        session_id: str,
        owner_user_id: int,
        patient_ref: str,
        application_id: str,
        phase: str,
        facts_json: str,
        summary_json: str,
        expires_at: int,
    ) -> AdmissionSessionRow | None:
        now = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO admission_registration_sessions "
                "(session_id, owner_user_id, patient_ref, application_id, phase, revision, "
                "facts_json, summary_json, expires_at, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) "
                "ON CONFLICT(session_id) DO NOTHING",
                (
                    session_id,
                    owner_user_id,
                    patient_ref,
                    application_id,
                    phase,
                    facts_json,
                    summary_json,
                    expires_at,
                    now,
                    now,
                ),
            )
            row = conn.execute(
                "SELECT * FROM admission_registration_sessions WHERE session_id = ? "
                "AND owner_user_id = ? AND patient_ref = ? AND application_id = ? "
                "AND expires_at > ?",
                (session_id, owner_user_id, patient_ref, application_id, now),
            ).fetchone()
        return AdmissionSessionRow.from_row(row) if row else None

    def get_owned(
        self, session_id: str, owner_user_id: int, *, now: int | None = None
    ) -> AdmissionSessionRow | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM admission_registration_sessions WHERE session_id = ? "
                "AND owner_user_id = ? AND expires_at > ?",
                (session_id, owner_user_id, now if now is not None else now_ts()),
            ).fetchone()
        return AdmissionSessionRow.from_row(row) if row else None

    def delete_for_patient(self, owner_user_id: int, patient_ref: str) -> int:
        with self._db.transaction() as conn:
            return int(
                conn.execute(
                    "DELETE FROM admission_registration_sessions "
                    "WHERE owner_user_id = ? AND patient_ref = ?",
                    (owner_user_id, patient_ref),
                ).rowcount
            )

    def append_turn(
        self,
        *,
        session_id: str,
        owner_user_id: int,
        expected_revision: int,
        turn_id: str,
        previous_turn_id: str | None,
        speaker: str,
        text: str,
        response: str,
        action: str,
        fields_json: str,
        status: str,
        facts_json: str,
        summary_json: str,
        phase: str,
        pending_proposal_json: str | None = None,
    ) -> bool:
        if len(text) > 2000 or len(response) > 4000:
            raise ValueError("admission turn exceeds the storage limit")
        json.loads(fields_json)
        json.loads(facts_json)
        json.loads(summary_json)
        now = now_ts()
        with self._db.transaction() as conn:
            session = conn.execute(
                "SELECT revision, last_turn_id FROM admission_registration_sessions "
                "WHERE session_id = ? AND owner_user_id = ? AND expires_at > ?",
                (session_id, owner_user_id, now),
            ).fetchone()
            if session is None:
                return False
            existing = conn.execute(
                "SELECT * FROM admission_registration_turns WHERE session_id = ? AND turn_id = ?",
                (session_id, turn_id),
            ).fetchone()
            if existing:
                expected = {
                    "previous_turn_id": previous_turn_id,
                    "speaker": speaker,
                    "utterance": text,
                    "response": response,
                    "action": action,
                    "fields_json": fields_json,
                    "status": status,
                }
                return (
                    int(session["revision"]) == expected_revision + 1
                    and session["last_turn_id"] == turn_id
                    and all(existing[key] == value for key, value in expected.items())
                )
            if (
                int(session["revision"]) != expected_revision
                or session["last_turn_id"] != previous_turn_id
            ):
                return False
            conn.execute(
                "INSERT INTO admission_registration_turns "
                "(turn_id, session_id, previous_turn_id, speaker, utterance, response, action, "
                "fields_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    turn_id,
                    session_id,
                    previous_turn_id,
                    speaker,
                    text,
                    response,
                    action,
                    fields_json,
                    status,
                    now,
                ),
            )
            updated = conn.execute(
                "UPDATE admission_registration_sessions SET phase = ?, revision = revision + 1, "
                "facts_json = ?, summary_json = ?, pending_proposal_json = ?, "
                "last_turn_id = ?, updated_at = ? "
                "WHERE session_id = ? AND owner_user_id = ? AND revision = ? "
                "AND expires_at > ?",
                (
                    phase,
                    facts_json,
                    summary_json,
                    pending_proposal_json,
                    turn_id,
                    now,
                    session_id,
                    owner_user_id,
                    expected_revision,
                    now,
                ),
            ).rowcount
            if updated != 1:
                raise RuntimeError("admission session changed during turn append")
        return True

    def list_turns(self, session_id: str, owner_user_id: int) -> list[AdmissionTurnRow]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT t.* FROM admission_registration_turns t "
                "JOIN admission_registration_sessions s ON s.session_id = t.session_id "
                "WHERE t.session_id = ? AND s.owner_user_id = ? AND s.expires_at > ? "
                "ORDER BY t.created_at, t.turn_id",
                (session_id, owner_user_id, now_ts()),
            ).fetchall()
        return [AdmissionTurnRow.from_row(row) for row in rows]

    def delete_expired(self, *, now: int | None = None) -> int:
        with self._db.transaction() as conn:
            return int(
                conn.execute(
                    "DELETE FROM admission_registration_sessions WHERE expires_at <= ?",
                    (now if now is not None else now_ts(),),
                ).rowcount
            )

    def mark_reviewed(
        self,
        *,
        session_id: str,
        owner_user_id: int,
        expected_revision: int,
        facts_json: str,
        summary_json: str,
    ) -> bool:
        json.loads(facts_json)
        json.loads(summary_json)
        with self._db.transaction() as conn:
            row = conn.execute(
                "UPDATE admission_registration_sessions SET phase = 'review', "
                "revision = revision + 1, facts_json = ?, summary_json = ?, updated_at = ? "
                "WHERE session_id = ? AND owner_user_id = ? AND revision = ? "
                "AND pending_proposal_json IS NULL AND expires_at > ? "
                "AND phase IN ('form', 'review')",
                (
                    facts_json,
                    summary_json,
                    now_ts(),
                    session_id,
                    owner_user_id,
                    expected_revision,
                    now_ts(),
                ),
            ).rowcount
        return bool(row == 1)
