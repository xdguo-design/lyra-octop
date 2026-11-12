from __future__ import annotations

from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from his_backend.doctor_station.domain import (
    DiagnosisAssertion,
    DiagnosisRuleError,
    TerminologyConceptRef,
)
from his_backend.doctor_station.service import DoctorStationOntologyService
from his_backend.ontology.runtime import (
    OntologyValidationError,
    list_classes,
    list_relations,
    validate_relation,
)

app = FastAPI(
    title="HIS Ontology Backend",
    version="0.1.0",
    description="Shared HIS ontology and safe doctor-station semantic validation.",
)
doctor_station_ontology = DoctorStationOntologyService()


class RelationCheck(BaseModel):
    subject_type: str
    predicate: str
    object_type: str


class DiagnosisCheck(BaseModel):
    diagnosis_id: str
    patient_id: str
    encounter_id: str
    practitioner_id: str
    concept_uri: str
    concept_type: str
    is_primary: bool = False


@app.get("/api/v1/ontology", summary="读取 HIS 本体概念和关系")
def get_ontology() -> dict[str, object]:
    return {
        "classes": list_classes(),
        "relations": [asdict(relation) for relation in list_relations()],
    }


@app.post("/api/v1/ontology/validate", summary="校验本体关系的类型约束")
def validate_ontology_relation(request: RelationCheck) -> dict[str, bool]:
    try:
        validate_relation(request.subject_type, request.predicate, request.object_type)
    except OntologyValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True}


@app.post("/api/v1/doctor-station/diagnoses/validate", summary="校验医生站诊断概念关系")
def validate_diagnosis(request: DiagnosisCheck) -> dict[str, bool]:
    try:
        doctor_station_ontology.validate_diagnosis(
            DiagnosisAssertion(
                diagnosis_id=request.diagnosis_id,
                patient_id=request.patient_id,
                encounter_id=request.encounter_id,
                practitioner_id=request.practitioner_id,
                condition=TerminologyConceptRef(
                    uri=request.concept_uri,
                    concept_type=request.concept_type,
                ),
                is_primary=request.is_primary,
            )
        )
    except (OntologyValidationError, DiagnosisRuleError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"valid": True}


@app.get("/api/v1/doctor-station/capabilities", summary="读取医生站后端能力门禁")
def doctor_station_capabilities() -> dict[str, object]:
    return {
        "ontology_validation": True,
        "order_domain_models": True,
        "clinical_write_enabled": False,
        "order_write_enabled": False,
        "write_block_reason": "PRD gate #36 and clinical authorization contract are not signed in this repository.",
    }
