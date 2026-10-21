from __future__ import annotations

import json
from pathlib import Path

from octop.infra.admission_registration_demo import (
    REGIONS,
    DemoStore,
    accepted_candidates,
    candidate_result,
    regions_for,
    validate_fields,
)


def test_contract_rejects_unlisted_fields_and_ai_candidates_need_transcript_evidence() -> None:
    errors = validate_fields({"unexpected": "value"})
    assert errors["unexpected"] == "包含不支持的字段"
    assert "phone" in errors

    text = "联系电话13800138000，地址北京市朝阳区建国路1号"
    candidates = accepted_candidates(
        text,
        {
            "contact_phone": "13800138000",
            "address": "北京市朝阳区建国路1号",
            "relationship": "子女",
            "contact_name": "外部候选",
        },
    )
    assert candidates == {
        "phone": "13800138000",
        "addressDetail": "北京市朝阳区建国路1号",
    }
    assert accepted_candidates("联系电话13800138000或者13900139000", candidates) == {}


def test_labeled_single_phone_is_recovered_when_agent_omits_it() -> None:
    assert accepted_candidates("我的电话是13800138000", {}) == {"phone": "13800138000"}


def test_ai_candidates_explain_invalid_phone_and_unsupported_occupation() -> None:
    assert candidate_result("联系电话1234567890", {}, page=0) == (
        {},
        {"phone": "请输入有效的11位手机号码"},
    )
    assert candidate_result("职业护士", {"occupation": "学生"}, page=0) == (
        {},
        {"occupation": "请选择职业"},
    )


def test_ai_candidates_report_conflicting_enum_values_and_keep_supported_aliases() -> None:
    assert candidate_result("婚姻状况未婚又已婚", {"marriage": "已婚"}, page=0) == (
        {},
        {"marriage": "本次描述包含多个选项，请明确选择一项"},
    )
    assert accepted_candidates("与患者关系女儿", {"relationship": "子女"}, page=0) == {
        "relationship": "子女",
    }


def test_bare_single_phone_is_recovered_when_agent_masks_or_omits_it() -> None:
    # 推理模型可能按 PII 惯例把手机号打码（如 ****8813）后返回。
    assert accepted_candidates("13412348813。", {"contact_phone": "****8813"}) == {
        "phone": "13412348813"
    }
    assert accepted_candidates("13412348813。", {}) == {"phone": "13412348813"}


def test_phone_fallback_rejects_masked_ambiguous_and_other_person_numbers() -> None:
    assert accepted_candidates("我的电话是138****8000", {}) == {}
    assert accepted_candidates("我的电话是13800138000或13900139000", {}) == {}
    assert accepted_candidates("紧急联系人电话是13800138000", {}) == {}


def test_ai_page2_candidates_accept_enums_normalized_by_the_model() -> None:
    text = "紧急联系人王小明，她是我的女儿，已婚"
    candidates = accepted_candidates(
        text,
        {"emergency_contact": "王小明", "relationship": "子女", "marriage": "已婚"},
        page=2,
    )
    assert candidates == {
        "emergencyContact": "王小明",
        "relationship": "子女",
        "marriage": "已婚",
    }


def test_ai_maps_region_text_to_cascade_codes() -> None:
    candidates = accepted_candidates(
        "籍贯辽宁省沈阳市和平区，现住北京市朝阳区望京街道1号",
        {
            "native_region": "辽宁省沈阳市和平区",
            "resident_region": "北京市朝阳区",
            "address": "望京街道1号",
        },
    )
    assert candidates == {
        "nativeRegion": ["210000", "210100", "210102"],
        "residentRegion": ["110000", "110105"],
        "addressDetail": "望京街道1号",
    }


def test_ai_recovers_labeled_regions_when_model_puts_them_in_address() -> None:
    text = (
        "帮我记录一下电话13800138000，并且籍贯是辽宁省沈阳市沈河区，"
        "现住地址也是辽宁省沈阳市沈河区。"
    )
    candidates = accepted_candidates(
        text,
        {"contact_phone": "13800138000", "address": "辽宁省沈阳市沈河区"},
    )
    assert candidates == {
        "phone": "13800138000",
        "nativeRegion": ["210000", "210100", "210103"],
        "residentRegion": ["210000", "210100", "210103"],
    }


def test_ai_recovers_labeled_region_without_province_name() -> None:
    assert accepted_candidates("我的籍贯沈阳市沈河区", {}) == {
        "nativeRegion": ["210000", "210100", "210103"],
    }


def test_ai_does_not_guess_a_region_without_a_unique_city_path() -> None:
    assert accepted_candidates("我的籍贯长安区", {}) == {}


def test_region_tree_covers_mainland_hong_kong_and_macau_with_unique_codes() -> None:
    all_nodes = []
    stack = list(REGIONS)
    while stack:
        node = stack.pop()
        all_nodes.append(node)
        stack.extend(node.get("children", []))

    codes = [node["code"] for node in all_nodes]
    assert len(REGIONS) == 33
    assert len(all_nodes) == 3243
    assert sum(not node.get("children") for node in all_nodes) == 2877
    assert len(codes) == len(set(codes))
    assert "710000" not in codes
    assert regions_for("810000")[0] == {"value": "810001", "label": "中西区", "leaf": True}
    assert regions_for("820000")[0]["leaf"] is True
    repository_root = Path(__file__).resolve().parents[2]
    source_contract = json.loads(
        (repository_root / "demos/admission-registration/contracts/regions.mock.json").read_text(
            encoding="utf-8"
        )
    )
    assert source_contract == REGIONS
    fields = {
        "name": "演示患者",
        "idNumber": "DEMO-ID-0001",
        "phone": "13800138000",
        "nationality": "中国",
        "ethnicity": "汉族",
        "nativeRegion": [],
        "residentRegion": ["810000", "810001"],
        "addressDetail": "",
        "employerName": "",
        "employerAddress": "",
        "marriage": "未婚",
        "occupation": "职工",
        "emergencyContact": "王小明",
        "relationship": "子女",
    }
    assert validate_fields(fields) == {}
    fields["residentRegion"] = ["210000", "210100"]
    assert "residentRegion" in validate_fields(fields)


def test_region_without_explicit_field_label_is_not_assigned_to_cascades() -> None:
    candidates = accepted_candidates(
        "辽宁省沈阳市沈河区",
        {"address": "辽宁省沈阳市沈河区"},
    )
    assert candidates == {"addressDetail": "辽宁省沈阳市沈河区"}


def test_ai_keeps_unmatched_region_text_as_address_detail() -> None:
    candidates = accepted_candidates(
        "现住台湾省台北市大安区信义路1号",
        {"resident_region": "台湾省台北市大安区", "address": "信义路1号"},
    )
    assert candidates == {"addressDetail": "台湾省台北市大安区信义路1号"}


def test_identity_and_submission_records_are_scoped_to_the_user() -> None:
    store = DemoStore()
    verified = store.verify(1, "id_card")
    token = str(verified["identityToken"])
    fields = dict(verified["fields"])
    fields["nativeRegion"] = []

    assert store.identity(2, token) is None
    assert store.submit(2, token, "request-123", fields, "success") is None
    assert store.result(2, token, "request-123") is None

    result = store.submit(1, token, "request-123", fields, "success")
    assert result is not None
    fingerprint, payload = result
    assert payload["status"] == "success"
    assert store.result(1, token, "request-123") == payload
    assert store.submit(1, token, "request-123", fields, "success") == (
        fingerprint,
        payload,
    )


def test_mock_patient_records_are_isolated_between_users() -> None:
    store = DemoStore()
    first = store.verify(1, "id_card")
    second = store.verify(2, "id_card")
    fields = dict(first["fields"])

    first_result = store.submit(1, str(first["identityToken"]), "request-123", fields, "success")
    second_result = store.submit(2, str(second["identityToken"]), "request-456", fields, "success")

    assert first_result is not None and first_result[1]["status"] == "success"
    assert second_result is not None and second_result[1]["status"] == "success"


def test_admission_applications_are_identity_scoped_and_must_be_selected() -> None:
    store = DemoStore()
    first = store.verify(1, "id_card")
    second = store.verify(2, "id_card")
    first_token = str(first["identityToken"])
    second_token = str(second["identityToken"])

    applications = store.applications(1, first_token)
    assert len(applications) == 1
    application = applications[0]
    assert application["department"]
    assert application["plannedAdmissionAt"]
    assert store.applications(2, first_token) is None
    assert store.select_application(2, first_token, str(application["id"])) is None
    assert store.select_application(1, first_token, "forged-application") is None
    assert store.selected_application(1, first_token) is None
    assert store.select_application(1, first_token, str(application["id"])) == application
    assert store.selected_application(1, first_token) == application
    assert store.selected_application(2, second_token) is None


def test_demo_patient_and_application_are_stable_for_session_restore() -> None:
    store = DemoStore()
    first = store.verify(42, "id_card")
    first_identity = store.identity(42, str(first["identityToken"]))
    assert first_identity is not None

    store.reset()
    second = store.verify(42, "id_card")
    second_identity = store.identity(42, str(second["identityToken"]))
    assert second_identity is not None
    assert first_identity["patientRef"] == second_identity["patientRef"]
    assert first_identity["application"]["id"] == second_identity["application"]["id"]


def test_reverification_revokes_old_identity_token_and_its_submissions() -> None:
    store = DemoStore()
    unknown_identity = store.verify(1, "id_card")
    fields = dict(unknown_identity["fields"])

    old_submission = store.submit(
        1,
        str(unknown_identity["identityToken"]),
        "unknown-request",
        fields,
        "unknown",
    )
    success_identity = store.verify(1, "id_card")
    old_token_replay = store.submit(
        1,
        str(unknown_identity["identityToken"]),
        "replay-request",
        fields,
        "success",
    )
    success = store.submit(
        1,
        str(success_identity["identityToken"]),
        "success-request",
        fields,
        "success",
    )

    assert old_submission is not None and old_submission[1]["status"] == "unknown"
    assert store.identity(1, str(unknown_identity["identityToken"])) is None
    assert old_token_replay is None
    assert success is not None and success[1]["status"] == "success"


def test_reverification_does_not_revoke_another_users_identity() -> None:
    store = DemoStore()
    first = store.verify(1, "id_card")
    other = store.verify(2, "id_card")

    store.verify(1, "id_card")

    assert store.identity(1, str(first["identityToken"])) is None
    assert store.identity(2, str(other["identityToken"])) is not None
