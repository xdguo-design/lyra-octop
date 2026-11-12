from datetime import UTC, datetime
from decimal import Decimal
import unittest

from his_backend.orders.domain import (
    ApplicationFee,
    ChargeStatus,
    CodedValue,
    DrugApplication,
    DrugDetail,
    DrugKind,
    ExamApplication,
    ExamDetail,
    InpatientOrder,
    InpatientOrderAction,
    InpatientOrderKind,
    InpatientOrderStatus,
    LabApplication,
    LabDetail,
    OperationAction,
    OperationOutcome,
    OperationTargetType,
    OrderEditView,
    OrderOperation,
    OrderOperationLog,
    OutpatientOrder,
    OutpatientOrderAction,
    OutpatientOrderStatus,
    OutpatientOrderType,
    ExternalCode,
    transition_inpatient_order,
    transition_outpatient_order,
)
from his_backend.ontology.runtime import validate_relation


def drug_application() -> DrugApplication:
    return DrugApplication(
        application_id="app-1",
        details=(
            DrugDetail(
                detail_id="line-1",
                item=CodedValue(system="hospital-drugs", code="D1", display="药品"),
                kind=DrugKind.CHINESE_HERBAL_MEDICINE,
            ),
        ),
    )


class OrderDomainTests(unittest.TestCase):
    def test_ontology_connects_order_subtypes_to_their_application(self) -> None:
        validate_relation("OutpatientOrder", "hasApplication", "DrugApplication")
        validate_relation("InpatientOrder", "hasApplication", "OrderApplication")

    def test_outpatient_order_submits_and_cannot_be_edited_after_submit(self) -> None:
        order = OutpatientOrder(
            order_id="order-1",
            patient_id="patient-1",
            encounter_id="encounter-1",
            practitioner_id="doctor-1",
            order_type=OutpatientOrderType.CHINESE_HERBAL_MEDICINE,
            application=drug_application(),
        )
        order.validate_semantics()

        submitted = transition_outpatient_order(order, OutpatientOrderAction.SUBMIT)
        self.assertEqual(submitted.status, OutpatientOrderStatus.SUBMITTED)
        with self.assertRaises(ValueError):
            transition_outpatient_order(submitted, OutpatientOrderAction.SAVE)

    def test_submitted_outpatient_cancel_needs_charge_domain_confirmation(self) -> None:
        order = OutpatientOrder(
            order_id="order-cancel",
            patient_id="patient-1",
            encounter_id="encounter-1",
            practitioner_id="doctor-1",
            order_type=OutpatientOrderType.CHINESE_HERBAL_MEDICINE,
            application=drug_application(),
            status=OutpatientOrderStatus.SUBMITTED,
        )
        with self.assertRaises(ValueError):
            transition_outpatient_order(
                order, OutpatientOrderAction.CANCEL, charge_status=ChargeStatus.UNPAID
            )
        cancelled = transition_outpatient_order(
            order,
            OutpatientOrderAction.CANCEL,
            charge_status=ChargeStatus.UNPAID,
            cancellation_confirmed=True,
        )
        self.assertEqual(cancelled.status, OutpatientOrderStatus.CANCELLED)

    def test_inpatient_order_uses_old_status_enum_and_transition_rules(self) -> None:
        order = InpatientOrder(
            order_id="order-2",
            patient_id="patient-1",
            encounter_id="encounter-2",
            practitioner_id="doctor-1",
            order_kind=InpatientOrderKind.LONG_TERM,
            application=drug_application(),
        )

        pending = transition_inpatient_order(order, InpatientOrderAction.SUBMIT)
        approved = transition_inpatient_order(pending, InpatientOrderAction.REVIEW, approved=True)
        received = transition_inpatient_order(approved, InpatientOrderAction.RECEIVE)
        executing = transition_inpatient_order(received, InpatientOrderAction.EXECUTE)
        completed = transition_inpatient_order(executing, InpatientOrderAction.EXECUTE)
        self.assertEqual(approved.status, InpatientOrderStatus.APPROVED)
        self.assertEqual(completed.status, InpatientOrderStatus.COMPLETED)
        with self.assertRaises(ValueError):
            transition_inpatient_order(order, InpatientOrderAction.EXECUTE)

    def test_application_type_and_details_must_match_order_type(self) -> None:
        exam_application = ExamApplication(
            application_id="app-exam",
            details=(ExamDetail(detail_id="exam-1", item=CodedValue("catalog", "XR", "X光")),),
        )
        with self.assertRaises(ValueError):
            OutpatientOrder(
                order_id="order-3",
                patient_id="patient-1",
                encounter_id="encounter-1",
                practitioner_id="doctor-1",
                order_type=OutpatientOrderType.LAB,
                application=exam_application,
            )

    def test_exam_detail_supports_multiple_sites(self) -> None:
        detail = ExamDetail(
            detail_id="exam-1",
            item=CodedValue("catalog", "CT", "CT"),
            sites=(CodedValue("site", "L", "左侧"), CodedValue("site", "R", "右侧")),
        )
        self.assertEqual(len(detail.sites), 2)

    def test_lab_tube_is_external_pass_through_value(self) -> None:
        application = LabApplication(
            application_id="app-lab",
            details=(
                LabDetail(
                    detail_id="lab-1",
                    item=CodedValue("lab", "CBC", "血常规"),
                    specimen_type=CodedValue("specimen", "WHOLE_BLOOD", "全血"),
                    collection_container=ExternalCode("lis-vendor", "EDTA_PURPLE", "紫管"),
                ),
            ),
        )
        self.assertEqual(application.details[0].collection_container.code, "EDTA_PURPLE")

    def test_edit_view_composes_application_details_and_fees(self) -> None:
        order = OutpatientOrder(
            order_id="order-4",
            patient_id="patient-1",
            encounter_id="encounter-1",
            practitioner_id="doctor-1",
            order_type=OutpatientOrderType.CHINESE_HERBAL_MEDICINE,
            application=drug_application(),
            display_content="展示用" * 3000,
        )
        fee = ApplicationFee("fee-1", "line-1", "F1", "药品费用", Decimal("12.50"), ChargeStatus.UNPAID)
        view = OrderEditView.compose(order, (fee,))
        self.assertEqual(len(view.application.details), 1)
        self.assertEqual(view.fees[0].amount, Decimal("12.50"))
        self.assertGreater(len(view.display_content), 4000)

    def test_operation_log_is_append_only_and_covers_read_and_failed_actions(self) -> None:
        at = datetime.now(UTC)
        viewed = OrderOperation(
            operation_id="op-1",
            target_type=OperationTargetType.ORDER,
            target_id="order-1",
            actor_id="staff-1",
            action=OperationAction.VIEW,
            outcome=OperationOutcome.SUCCEEDED,
            occurred_at=at,
        )
        denied = OrderOperation(
            operation_id="op-2",
            target_type=OperationTargetType.ORDER,
            target_id="order-1",
            actor_id="staff-2",
            action=OperationAction.EDIT,
            outcome=OperationOutcome.DENIED,
            occurred_at=at,
        )
        log = OrderOperationLog().append(viewed).append(denied)
        self.assertEqual(len(log.records), 2)
        with self.assertRaises(ValueError):
            log.append(viewed)


if __name__ == "__main__":
    unittest.main()
