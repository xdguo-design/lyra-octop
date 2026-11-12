from __future__ import annotations

from his_backend.doctor_station.domain import (
    DiagnosisAssertion,
    EncounterDiagnosisSet,
)


class DoctorStationOntologyService:
    """Validates doctor-station facts against the shared HIS semantic model."""

    def validate_diagnosis(self, assertion: DiagnosisAssertion) -> None:
        assertion.validate_semantics()

    def validate_order_submission(self, diagnoses: EncounterDiagnosisSet) -> None:
        diagnoses.validate_for_submission()
