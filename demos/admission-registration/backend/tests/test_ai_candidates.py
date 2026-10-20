from admission_registration.ai import accepted_candidates


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
        "addressDetail": "北京市朝阳区建国路1号",
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


def test_ai_does_not_fill_inferred_or_ambiguous_data() -> None:
    result = accepted_candidates(
        "联系人可能是王小明，手机号尾号8000",
        {"contact_phone": "13800138000", "emergency_contact": "王小明", "relationship": "朋友"},
    )
    assert result == {}


def test_ai_rejects_multiple_phone_candidates() -> None:
    assert (
        accepted_candidates(
            "我的号码是13800138000，也可能是13900139000",
            {"contact_phone": "13800138000"},
        )
        == {}
    )
