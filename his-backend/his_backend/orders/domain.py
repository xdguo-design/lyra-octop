from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TypeAlias

from his_backend.ontology.runtime import validate_relation


class OutpatientOrderType(StrEnum):
    WESTERN_MEDICINE = "WESTERN_MEDICINE"
    CHINESE_PATENT_MEDICINE = "CHINESE_PATENT_MEDICINE"
    CHINESE_HERBAL_MEDICINE = "CHINESE_HERBAL_MEDICINE"
    TREATMENT = "TREATMENT"
    EXAM = "EXAM"
    LAB = "LAB"
    SURGERY = "SURGERY"
    TRANSFUSION = "TRANSFUSION"


class OutpatientOrderStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    CANCELLED = "CANCELLED"


class OutpatientOrderAction(StrEnum):
    SAVE = "save"
    SUBMIT = "submit"
    CANCEL = "cancel"


class InpatientOrderKind(StrEnum):
    LONG_TERM = "LONG_TERM"
    TEMPORARY = "TEMPORARY"


class InpatientOrderStatus(StrEnum):
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    REJECTED = "REJECTED"
    APPROVED = "APPROVED"
    RECEIVED = "RECEIVED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    STOPPED = "STOPPED"
    CANCELLED = "CANCELLED"


class InpatientOrderAction(StrEnum):
    SUBMIT = "submit"
    REVIEW = "review"
    RECEIVE = "receive"
    EXECUTE = "execute"
    STOP = "stop"
    CANCEL = "cancel"
    CANCEL_EXECUTION = "cancel-execution"


class DrugKind(StrEnum):
    WESTERN_MEDICINE = "WESTERN_MEDICINE"
    CHINESE_PATENT_MEDICINE = "CHINESE_PATENT_MEDICINE"
    CHINESE_HERBAL_MEDICINE = "CHINESE_HERBAL_MEDICINE"


class ChargeStatus(StrEnum):
    UNKNOWN = "UNKNOWN"
    UNPAID = "UNPAID"
    PAID = "PAID"
    REFUNDED = "REFUNDED"


class OperationAction(StrEnum):
    LIST = "LIST"
    VIEW = "VIEW"
    CREATE = "CREATE"
    EDIT = "EDIT"
    SAVE = "SAVE"
    SIGN = "SIGN"
    SUBMIT = "SUBMIT"
    REVIEW = "REVIEW"
    RECEIVE = "RECEIVE"
    EXECUTE = "EXECUTE"
    STOP = "STOP"
    CANCEL = "CANCEL"
    CANCEL_EXECUTION = "CANCEL_EXECUTION"
    DELETE = "DELETE"
    PRINT = "PRINT"
    EXPORT = "EXPORT"
    CHARGE_LINK = "CHARGE_LINK"
    EXECUTION_LINK = "EXECUTION_LINK"
    EXTERNAL_CALLBACK = "EXTERNAL_CALLBACK"
    VALIDATE = "VALIDATE"


class OperationOutcome(StrEnum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    DENIED = "DENIED"


class OrderDomainError(ValueError):
    """An order or application violates a domain invariant."""


@dataclass(frozen=True, slots=True)
class CodedValue:
    system: str
    code: str
    display: str

    def __post_init__(self) -> None:
        if not self.system.strip() or not self.code.strip() or not self.display.strip():
            raise OrderDomainError("A coded value requires system, code, and display")


@dataclass(frozen=True, slots=True)
class ExternalCode:
    """Opaque external code; HIS does not own or validate its catalogue."""

    system: str
    code: str
    display: str | None = None

    def __post_init__(self) -> None:
        if not self.system.strip() or not self.code.strip():
            raise OrderDomainError("An external code requires system and code")


@dataclass(frozen=True, slots=True)
class DrugDetail:
    detail_id: str
    item: CodedValue
    kind: DrugKind


@dataclass(frozen=True, slots=True)
class ExamDetail:
    detail_id: str
    item: CodedValue
    sites: tuple[CodedValue, ...] = ()


@dataclass(frozen=True, slots=True)
class LabDetail:
    detail_id: str
    item: CodedValue
    specimen_type: CodedValue
    collection_container: ExternalCode | None = None


@dataclass(frozen=True, slots=True)
class SurgeryDetail:
    detail_id: str
    item: CodedValue
    consecutive_group_id: str | None = None
    sequence: int | None = None

    def __post_init__(self) -> None:
        grouped = self.consecutive_group_id is not None
        sequenced = self.sequence is not None
        if grouped != sequenced or (self.sequence is not None and self.sequence < 1):
            raise OrderDomainError("Consecutive surgery requires a group id and positive sequence")


@dataclass(frozen=True, slots=True)
class ServiceDetail:
    detail_id: str
    item: CodedValue


@dataclass(frozen=True, slots=True)
class TransfusionDetail:
    detail_id: str
    item: CodedValue


ApplicationDetail: TypeAlias = (
    DrugDetail | ExamDetail | LabDetail | SurgeryDetail | ServiceDetail | TransfusionDetail
)


def _validate_detail_ids(details: tuple[ApplicationDetail, ...]) -> None:
    if not details:
        raise OrderDomainError("An application must contain at least one detail")
    ids = [detail.detail_id for detail in details]
    if any(not item_id.strip() for item_id in ids) or len(ids) != len(set(ids)):
        raise OrderDomainError("Application detail identifiers must be non-empty and unique")


def _validate_application_id(application_id: str) -> None:
    if not application_id.strip():
        raise OrderDomainError("Application identifier is required")


@dataclass(frozen=True, slots=True)
class DrugApplication:
    application_id: str
    details: tuple[DrugDetail, ...]

    def __post_init__(self) -> None:
        _validate_application_id(self.application_id)
        _validate_detail_ids(self.details)


@dataclass(frozen=True, slots=True)
class ExamApplication:
    application_id: str
    details: tuple[ExamDetail, ...]

    def __post_init__(self) -> None:
        _validate_application_id(self.application_id)
        _validate_detail_ids(self.details)


@dataclass(frozen=True, slots=True)
class LabApplication:
    application_id: str
    details: tuple[LabDetail, ...]

    def __post_init__(self) -> None:
        _validate_application_id(self.application_id)
        _validate_detail_ids(self.details)


@dataclass(frozen=True, slots=True)
class SurgeryApplication:
    application_id: str
    details: tuple[SurgeryDetail, ...]

    def __post_init__(self) -> None:
        _validate_application_id(self.application_id)
        _validate_detail_ids(self.details)
        positions = [
            (detail.consecutive_group_id, detail.sequence)
            for detail in self.details
            if detail.consecutive_group_id is not None
        ]
        if len(positions) != len(set(positions)):
            raise OrderDomainError("Surgery sequence must be unique within a consecutive group")


@dataclass(frozen=True, slots=True)
class ServiceApplication:
    application_id: str
    details: tuple[ServiceDetail, ...]

    def __post_init__(self) -> None:
        _validate_application_id(self.application_id)
        _validate_detail_ids(self.details)


@dataclass(frozen=True, slots=True)
class TransfusionApplication:
    application_id: str
    details: tuple[TransfusionDetail, ...]

    def __post_init__(self) -> None:
        _validate_application_id(self.application_id)
        _validate_detail_ids(self.details)


OrderApplication: TypeAlias = (
    DrugApplication
    | ExamApplication
    | LabApplication
    | SurgeryApplication
    | ServiceApplication
    | TransfusionApplication
)


def _validate_order_identity(
    order_id: str, patient_id: str, encounter_id: str, practitioner_id: str, version: int
) -> None:
    if not all(value.strip() for value in (order_id, patient_id, encounter_id, practitioner_id)):
        raise OrderDomainError("Order, patient, encounter, and practitioner identifiers are required")
    if version < 0:
        raise OrderDomainError("Order version cannot be negative")


def _validate_outpatient_application(
    order_type: OutpatientOrderType, application: OrderApplication
) -> None:
    expected: type[OrderApplication]
    if order_type in {
        OutpatientOrderType.WESTERN_MEDICINE,
        OutpatientOrderType.CHINESE_PATENT_MEDICINE,
        OutpatientOrderType.CHINESE_HERBAL_MEDICINE,
    }:
        expected = DrugApplication
    elif order_type is OutpatientOrderType.EXAM:
        expected = ExamApplication
    elif order_type is OutpatientOrderType.LAB:
        expected = LabApplication
    elif order_type is OutpatientOrderType.SURGERY:
        expected = SurgeryApplication
    elif order_type is OutpatientOrderType.TRANSFUSION:
        expected = TransfusionApplication
    else:
        expected = ServiceApplication
    if not isinstance(application, expected):
        raise OrderDomainError("Outpatient order type must match its application type")
    if isinstance(application, DrugApplication):
        expected_kind = DrugKind(order_type.value)
        if any(detail.kind is not expected_kind for detail in application.details):
            raise OrderDomainError("Drug detail kind must match outpatient order type")


def _validate_application_semantics(
    order_type: str, application: OrderApplication
) -> None:
    application_type = type(application).__name__
    validate_relation(order_type, "hasApplication", application_type)
    ontology_detail_types = {
        DrugDetail: "DrugApplicationDetail",
        ExamDetail: "ExamApplicationDetail",
        LabDetail: "LabApplicationDetail",
        SurgeryDetail: "SurgeryApplicationDetail",
        ServiceDetail: "ServiceApplicationDetail",
        TransfusionDetail: "TransfusionApplicationDetail",
    }
    for detail in application.details:
        detail_type = ontology_detail_types[type(detail)]
        validate_relation(application_type, "hasApplicationDetail", detail_type)
        if isinstance(detail, ExamDetail):
            for _site in detail.sites:
                validate_relation(detail_type, "hasExamSite", "AnatomicalSite")
        if isinstance(detail, SurgeryDetail) and detail.consecutive_group_id:
            validate_relation(detail_type, "inSurgerySession", "SurgerySession")


@dataclass(frozen=True, slots=True, kw_only=True)
class OutpatientOrder:
    order_id: str
    patient_id: str
    encounter_id: str
    practitioner_id: str
    order_type: OutpatientOrderType
    application: OrderApplication
    status: OutpatientOrderStatus = OutpatientOrderStatus.DRAFT
    version: int = 0
    display_content: str | None = None

    def __post_init__(self) -> None:
        _validate_order_identity(
            self.order_id, self.patient_id, self.encounter_id, self.practitioner_id, self.version
        )
        _validate_outpatient_application(self.order_type, self.application)

    def validate_semantics(self) -> None:
        _validate_application_semantics("OutpatientOrder", self.application)


@dataclass(frozen=True, slots=True, kw_only=True)
class InpatientOrder:
    order_id: str
    patient_id: str
    encounter_id: str
    practitioner_id: str
    order_kind: InpatientOrderKind
    application: OrderApplication
    status: InpatientOrderStatus = InpatientOrderStatus.DRAFT
    version: int = 0
    display_content: str | None = None

    def __post_init__(self) -> None:
        _validate_order_identity(
            self.order_id, self.patient_id, self.encounter_id, self.practitioner_id, self.version
        )

    def validate_semantics(self) -> None:
        _validate_application_semantics("InpatientOrder", self.application)


def transition_outpatient_order(
    order: OutpatientOrder,
    action: OutpatientOrderAction,
    *,
    charge_status: ChargeStatus | None = None,
    cancellation_confirmed: bool = False,
) -> OutpatientOrder:
    if action is OutpatientOrderAction.SAVE:
        if order.status is not OutpatientOrderStatus.DRAFT:
            raise OrderDomainError("Only a draft outpatient order can be saved")
        return replace(order, version=order.version + 1)
    if action is OutpatientOrderAction.SUBMIT and order.status is OutpatientOrderStatus.DRAFT:
        return replace(order, status=OutpatientOrderStatus.SUBMITTED, version=order.version + 1)
    if action is OutpatientOrderAction.CANCEL:
        if order.status is OutpatientOrderStatus.DRAFT:
            return replace(order, status=OutpatientOrderStatus.CANCELLED, version=order.version + 1)
        if (
            order.status is OutpatientOrderStatus.SUBMITTED
            and charge_status is ChargeStatus.UNPAID
            and cancellation_confirmed
        ):
            return replace(order, status=OutpatientOrderStatus.CANCELLED, version=order.version + 1)
        raise OrderDomainError(
            "Submitted order cancellation requires an unpaid charge projection and charge confirmation"
        )
    raise OrderDomainError("Outpatient order does not allow this action in its current state")


def transition_inpatient_order(
    order: InpatientOrder,
    action: InpatientOrderAction,
    *,
    approved: bool | None = None,
    reason: str | None = None,
) -> InpatientOrder:
    status = order.status
    transitions: dict[InpatientOrderAction, tuple[set[InpatientOrderStatus], InpatientOrderStatus]] = {
        InpatientOrderAction.SUBMIT: ({InpatientOrderStatus.DRAFT}, InpatientOrderStatus.PENDING_REVIEW),
        InpatientOrderAction.RECEIVE: ({InpatientOrderStatus.APPROVED}, InpatientOrderStatus.RECEIVED),
        InpatientOrderAction.STOP: (
            {
                InpatientOrderStatus.APPROVED,
                InpatientOrderStatus.RECEIVED,
                InpatientOrderStatus.IN_PROGRESS,
            },
            InpatientOrderStatus.STOPPED,
        ),
        InpatientOrderAction.CANCEL: (
            {
                InpatientOrderStatus.DRAFT,
                InpatientOrderStatus.PENDING_REVIEW,
                InpatientOrderStatus.REJECTED,
            },
            InpatientOrderStatus.CANCELLED,
        ),
        InpatientOrderAction.CANCEL_EXECUTION: (
            {InpatientOrderStatus.IN_PROGRESS}, InpatientOrderStatus.RECEIVED
        ),
    }
    if action is InpatientOrderAction.EXECUTE:
        if status is InpatientOrderStatus.RECEIVED:
            next_status = InpatientOrderStatus.IN_PROGRESS
        elif status is InpatientOrderStatus.IN_PROGRESS:
            next_status = InpatientOrderStatus.COMPLETED
        else:
            raise OrderDomainError("Inpatient order does not allow this action in its current state")
    elif action is InpatientOrderAction.REVIEW:
        if status is not InpatientOrderStatus.PENDING_REVIEW or approved is None:
            raise OrderDomainError("Only a pending inpatient order can be reviewed")
        next_status = InpatientOrderStatus.APPROVED if approved else InpatientOrderStatus.REJECTED
    else:
        transition = transitions.get(action)
        if transition is None or status not in transition[0]:
            raise OrderDomainError("Inpatient order does not allow this action in its current state")
        next_status = transition[1]
    if (action is InpatientOrderAction.REVIEW and not approved) or action in {
        InpatientOrderAction.STOP,
        InpatientOrderAction.CANCEL,
        InpatientOrderAction.CANCEL_EXECUTION,
    }:
        if not reason or not reason.strip():
            raise OrderDomainError("This inpatient order action requires a reason")
    if action is InpatientOrderAction.STOP and order.order_kind is not InpatientOrderKind.LONG_TERM:
        raise OrderDomainError("Only a long-term inpatient order can be stopped")
    return replace(order, status=next_status, version=order.version + 1)


@dataclass(frozen=True, slots=True)
class ApplicationFee:
    fee_id: str
    application_detail_id: str | None
    code: str
    display: str
    amount: Decimal
    status: ChargeStatus

    def __post_init__(self) -> None:
        if not all(value.strip() for value in (self.fee_id, self.code, self.display)):
            raise OrderDomainError("Fee identity, code, and display are required")
        if not self.amount.is_finite() or self.amount < 0:
            raise OrderDomainError("Fee amount must be finite and non-negative")


@dataclass(frozen=True, slots=True)
class OrderEditView:
    order: OutpatientOrder | InpatientOrder
    application: OrderApplication
    fees: tuple[ApplicationFee, ...]
    display_content: str | None

    @classmethod
    def compose(
        cls,
        order: OutpatientOrder | InpatientOrder,
        fees: tuple[ApplicationFee, ...],
    ) -> OrderEditView:
        fee_ids = [fee.fee_id for fee in fees]
        if len(fee_ids) != len(set(fee_ids)):
            raise OrderDomainError("Fee identifiers must be unique in an edit view")
        detail_ids = {detail.detail_id for detail in order.application.details}
        if any(
            fee.application_detail_id is not None and fee.application_detail_id not in detail_ids
            for fee in fees
        ):
            raise OrderDomainError("Fee must belong to the order application or one of its details")
        return cls(order, order.application, fees, order.display_content)


class OperationTargetType(StrEnum):
    ORDER = "ORDER"
    APPLICATION = "APPLICATION"
    FEE = "FEE"
    EXECUTION = "EXECUTION"


@dataclass(frozen=True, slots=True)
class OrderOperation:
    operation_id: str
    target_type: OperationTargetType
    target_id: str
    actor_id: str
    action: OperationAction
    outcome: OperationOutcome
    occurred_at: datetime
    request_id: str | None = None
    previous_status: OutpatientOrderStatus | InpatientOrderStatus | None = None
    next_status: OutpatientOrderStatus | InpatientOrderStatus | None = None
    version: int | None = None
    reason: str | None = None

    def __post_init__(self) -> None:
        if not all(value.strip() for value in (self.operation_id, self.target_id, self.actor_id)):
            raise OrderDomainError("Operation, target, and actor identifiers are required")
        if self.occurred_at.tzinfo is None or self.occurred_at.utcoffset() is None:
            raise OrderDomainError("Operation timestamp must include a timezone")
        if self.version is not None and self.version < 0:
            raise OrderDomainError("Operation version cannot be negative")


@dataclass(frozen=True, slots=True)
class OrderOperationLog:
    records: tuple[OrderOperation, ...] = ()

    def append(self, operation: OrderOperation) -> OrderOperationLog:
        if any(record.operation_id == operation.operation_id for record in self.records):
            raise OrderDomainError("Operation identifiers must be unique")
        return OrderOperationLog(self.records + (operation,))
