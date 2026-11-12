from __future__ import annotations

from dataclasses import dataclass

from his_backend.ontology.runtime import validate_relation


class DiagnosisRuleError(ValueError):
    """A doctor-station diagnosis action violates a confirmed PRD rule."""


@dataclass(frozen=True, slots=True)
class TerminologyConceptRef:
    uri: str
    concept_type: str = "ConditionTerminologyConcept"

    def __post_init__(self) -> None:
        if not self.uri.strip():
            raise DiagnosisRuleError("A diagnosis must reference a terminology concept")


@dataclass(frozen=True, slots=True)
class DiagnosisAssertion:
    """Patient-specific diagnosis fact; distinct from the coded medical concept."""

    diagnosis_id: str
    patient_id: str
    encounter_id: str
    practitioner_id: str
    condition: TerminologyConceptRef
    is_primary: bool = False
    revision: int = 1
    supersedes_id: str | None = None

    def __post_init__(self) -> None:
        if not all((self.diagnosis_id, self.patient_id, self.encounter_id, self.practitioner_id)):
            raise DiagnosisRuleError(
                "Diagnosis identity, patient, encounter and practitioner are required"
            )
        if self.revision < 1:
            raise DiagnosisRuleError("Diagnosis revision must be positive")

    def validate_semantics(self) -> None:
        validate_relation("Patient", "hasEncounter", "OutpatientEncounter")
        validate_relation("OutpatientEncounter", "hasDiagnosis", "DiagnosisAssertion")
        validate_relation("DiagnosisAssertion", "aboutPatient", "Patient")
        validate_relation("DiagnosisAssertion", "inEncounter", "OutpatientEncounter")
        validate_relation("DiagnosisAssertion", "assertsCondition", self.condition.concept_type)
        validate_relation("DiagnosisAssertion", "recordedBy", "Practitioner")


@dataclass(frozen=True, slots=True)
class EncounterDiagnosisSet:
    """DDD aggregate for one encounter; revisions preserve prior diagnosis facts."""

    encounter_id: str
    patient_id: str
    records: tuple[DiagnosisAssertion, ...] = ()

    def __post_init__(self) -> None:
        if not self.encounter_id or not self.patient_id:
            raise DiagnosisRuleError("Encounter and patient are required")
        if any(
            record.encounter_id != self.encounter_id or record.patient_id != self.patient_id
            for record in self.records
        ):
            raise DiagnosisRuleError("All diagnoses in the aggregate must share its patient and encounter")
        ids = [record.diagnosis_id for record in self.records]
        if len(ids) != len(set(ids)):
            raise DiagnosisRuleError("Diagnosis identifiers must be unique within an encounter")
        superseded = [record.supersedes_id for record in self.records if record.supersedes_id]
        if len(superseded) != len(set(superseded)):
            raise DiagnosisRuleError("A diagnosis revision can supersede a record only once")
        records_by_id = {record.diagnosis_id: record for record in self.records}
        for record in self.records:
            if record.supersedes_id is None:
                if record.revision != 1:
                    raise DiagnosisRuleError("An original diagnosis must start at revision one")
                continue
            previous = records_by_id.get(record.supersedes_id)
            if previous is None:
                raise DiagnosisRuleError("A diagnosis revision must reference an existing record")
            if record.revision != previous.revision + 1:
                raise DiagnosisRuleError("A diagnosis revision must increment the version by one")

    @property
    def active_records(self) -> tuple[DiagnosisAssertion, ...]:
        superseded_ids = {record.supersedes_id for record in self.records if record.supersedes_id}
        return tuple(record for record in self.records if record.diagnosis_id not in superseded_ids)

    def add(self, record: DiagnosisAssertion) -> EncounterDiagnosisSet:
        record.validate_semantics()
        if record.encounter_id != self.encounter_id or record.patient_id != self.patient_id:
            raise DiagnosisRuleError("Diagnosis belongs to a different patient or encounter")
        if any(item.diagnosis_id == record.diagnosis_id for item in self.records):
            raise DiagnosisRuleError("Diagnosis identifier already exists")
        if record.supersedes_id is not None:
            raise DiagnosisRuleError("Use revise() to create a diagnosis revision")
        if record.is_primary and any(item.is_primary for item in self.active_records):
            raise DiagnosisRuleError("An encounter can have only one active primary diagnosis")
        return EncounterDiagnosisSet(self.encounter_id, self.patient_id, self.records + (record,))

    def revise(self, diagnosis_id: str, replacement: DiagnosisAssertion) -> EncounterDiagnosisSet:
        previous = next((item for item in self.active_records if item.diagnosis_id == diagnosis_id), None)
        if previous is None:
            raise DiagnosisRuleError("Only an active diagnosis can be revised")
        if replacement.supersedes_id != previous.diagnosis_id:
            raise DiagnosisRuleError("A revision must explicitly reference the diagnosis it replaces")
        if replacement.revision != previous.revision + 1:
            raise DiagnosisRuleError("A diagnosis revision must increment the version by one")
        if replacement.patient_id != self.patient_id or replacement.encounter_id != self.encounter_id:
            raise DiagnosisRuleError("A diagnosis revision must stay within its patient and encounter")
        replacement.validate_semantics()
        return EncounterDiagnosisSet(self.encounter_id, self.patient_id, self.records + (replacement,))

    def validate_for_submission(self) -> None:
        active = self.active_records
        if not active:
            raise DiagnosisRuleError("A diagnosis is required before submitting outpatient orders")
        if sum(record.is_primary for record in active) != 1:
            raise DiagnosisRuleError("Exactly one active primary diagnosis is required")
