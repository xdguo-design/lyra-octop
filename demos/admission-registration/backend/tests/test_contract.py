from admission_registration.contracts import validate_fields


def valid_fields() -> dict[str, object]:
    return {
        "name": "演示患者",
        "idNumber": "DEMO-ID-0001",
        "phone": "13800138000",
        "nationality": "中国",
        "ethnicity": "汉族",
        "nativeRegion": [],
        "residentRegion": ["110000", "110105"],
        "addressDetail": "建国路 1 号",
        "employerName": "示例医院",
        "employerAddress": "北京市朝阳区",
        "marriage": "未婚",
        "occupation": "职工",
        "emergencyContact": "王小明",
        "relationship": "子女",
    }


def test_shared_contract_accepts_valid_mock_fields() -> None:
    assert validate_fields(valid_fields()) == {}


def test_shared_contract_rejects_phone_and_unknown_properties() -> None:
    fields = valid_fields()
    fields["phone"] = "1380013800"
    fields["extra"] = "unexpected"
    errors = validate_fields(fields)
    assert "phone" in errors
    assert "extra" in errors


def test_shared_contract_rejects_cross_branch_region_path() -> None:
    fields = valid_fields()
    fields["residentRegion"] = ["110000", "210100", "210112"]
    assert "residentRegion" in validate_fields(fields)


def test_shared_contract_accepts_two_level_region_path() -> None:
    fields = valid_fields()
    fields["residentRegion"] = ["810000", "810001"]
    assert validate_fields(fields) == {}


def test_shared_contract_rejects_paths_that_stop_before_a_leaf() -> None:
    fields = valid_fields()
    fields["residentRegion"] = ["210000", "210100"]
    assert "residentRegion" in validate_fields(fields)
