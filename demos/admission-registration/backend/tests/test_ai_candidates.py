from admission_registration.ai import accepted_candidates, candidate_result, model_input


def test_ai_page1_accepts_explicit_allowlisted_values() -> None:
    result = accepted_candidates(
        "联系电话13800138000，地址北京市朝阳区建国路1号",
        {
            "contact_phone": "13800138000",
            "address": "北京市朝阳区建国路1号",
            "id_number": "fake",
            "unexpected": "ignored",
        },
    )
    assert result == {
        "phone": "13800138000",
        "residentRegion": ["110000", "110105"],
        "addressDetail": "建国路1号",
    }


def test_ai_page2_accepts_enums_normalized_by_the_model() -> None:
    result = accepted_candidates(
        "紧急联系人王小明，她是我的女儿",
        {
            "emergency_contact": "王小明",
            "relationship": "子女",
            "address": "北京市朝阳区建国路1号",
        },
        page=2,
    )
    assert result == {
        "emergencyContact": "王小明",
        "relationship": "子女",
    }


def test_ai_page_zero_extracts_fields_from_both_form_pages() -> None:
    assert accepted_candidates(
        "联系电话13800138000，现住地址辽宁省沈阳市大东区黎明广场，职业是学生，联系人王小明是我女儿",
        {
            "contact_phone": "13800138000",
            "resident_region": "辽宁省沈阳市大东区",
            "address": "辽宁省沈阳市大东区黎明广场",
            "occupation": "学生",
            "emergency_contact": "王小明",
            "relationship": "子女",
        },
        page=0,
    ) == {
        "phone": "13800138000",
        "residentRegion": ["210000", "210100", "210104"],
        "addressDetail": "黎明广场",
        "occupation": "学生",
        "emergencyContact": "王小明",
        "relationship": "子女",
    }


def test_ai_context_orders_facts_compressed_history_recent_five_then_latest_answer() -> None:
    turns = [
        {"utterance": f"回答{i}", "response": f"追问{i}", "action": "voice_turn"} for i in range(7)
    ]
    result = model_input(
        "本轮答案",
        {"facts": {"phone": {"value": "13800138000"}}, "summary": {}, "turns": turns},
    )
    assert result.index('"structured_data"') < result.index('"compressed_data"')
    assert result.index('"compressed_data"') < result.index('"recent_turns"')
    assert '"patient":"回答2"' in result
    assert '"patient":"回答6"' in result
    assert result.rstrip().endswith("本轮患者回答：本轮答案")


def test_ai_context_drops_old_turns_to_stay_within_the_input_budget(monkeypatch) -> None:
    monkeypatch.setattr("admission_registration.ai._MODEL_INPUT_BYTE_LIMIT", 1800)
    turns = [
        {"utterance": f"患者{i}" + "甲" * 80, "response": "乙" * 60, "action": "voice_turn"}
        for i in range(20)
    ]

    result = model_input("本轮答案", {"facts": {}, "summary": {}, "turns": turns})

    assert len(result.encode("utf-8")) <= 1800
    assert '"patient":"患者19' in result
    assert '"patient":"患者0' not in result
    assert result.endswith("本轮患者回答：本轮答案")


def test_ai_does_not_fill_inferred_or_ambiguous_data() -> None:
    result = accepted_candidates(
        "联系人可能是王小明，手机号尾号8000",
        {"contact_phone": "13800138000", "emergency_contact": "王小明", "relationship": "朋友"},
    )
    assert result == {}


def test_ai_splits_a_bare_full_address_without_guessing_birthplace() -> None:
    assert accepted_candidates("辽宁省沈阳市大东区黎明广场", {}) == {
        "residentRegion": ["210000", "210100", "210104"],
        "addressDetail": "黎明广场",
    }
    assert accepted_candidates("籍贯辽宁省沈阳市沈河区", {}) == {
        "nativeRegion": ["210000", "210100", "210103"],
    }


def test_ai_matches_region_names_with_omitted_administrative_suffixes() -> None:
    expected = {"residentRegion": ["210000", "210100", "210104"]}
    assert accepted_candidates("辽宁省沈阳市大东", {}) == expected
    assert accepted_candidates("沈阳大东区", {}) == expected
    assert accepted_candidates("沈阳大东", {}) == expected
    assert accepted_candidates("北京朝阳区", {}) == {
        "residentRegion": ["110000", "110105"],
    }
    assert accepted_candidates("辽宁省沈阳市", {}) == {}


def test_ai_rejects_multiple_phone_candidates() -> None:
    assert (
        accepted_candidates(
            "我的号码是13800138000，也可能是13900139000",
            {"contact_phone": "13800138000"},
        )
        == {}
    )


def test_ai_recovers_single_phone_when_model_masks_or_omits_it() -> None:
    # 模型可能按 PII 惯例把手机号打码（如 ****8813）导致子串校验失败。
    assert accepted_candidates("13412348813。", {"contact_phone": "****8813"}) == {
        "phone": "13412348813"
    }
    assert accepted_candidates("我的电话是13800138000", {}) == {"phone": "13800138000"}
    assert accepted_candidates("紧急联系人电话是13800138000", {}) == {}


def test_ai_keeps_unambiguous_phone_when_model_marks_it_uncertain() -> None:
    assert candidate_result(
        "我的手机号是13900008888", {"contact_phone": "****8888"}, uncertain_fields=["contact_phone"]
    ) == ({"phone": "13900008888"}, {})
    assert candidate_result(
        "紧急联系人电话是13900008888",
        {"contact_phone": "****8888"},
        uncertain_fields=["contact_phone"],
    ) == ({}, {})
    assert candidate_result(
        "我的手机号是13900008888或13800138000",
        {"contact_phone": "****8888"},
        uncertain_fields=["contact_phone"],
    ) == ({}, {})


def test_ai_returns_field_specific_reasons_for_invalid_phone_and_occupation() -> None:
    assert candidate_result("联系电话1234567890", {"contact_phone": "1234567890"}) == (
        {},
        {"phone": "请输入有效的11位手机号码"},
    )
    assert candidate_result("联系电话1234567890", {}) == (
        {},
        {"phone": "请输入有效的11位手机号码"},
    )
    assert candidate_result("职业外星人", {}, page=2) == (
        {},
        {"occupation": "请选择职业"},
    )
    assert candidate_result("职业护士", {"occupation": "学生"}, page=2) == (
        {},
        {"occupation": "请选择职业"},
    )
    assert candidate_result("婚姻状况未婚又已婚", {"marriage": "已婚"}, page=2) == (
        {},
        {"marriage": "本次描述包含多个选项，请明确选择一项"},
    )
    assert candidate_result("与患者关系女儿", {"relationship": "子女"}, page=2) == (
        {"relationship": "子女"},
        {},
    )
