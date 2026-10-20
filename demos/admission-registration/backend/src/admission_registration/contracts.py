from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[3]
FIELD_SCHEMA = json.loads(
    (ROOT / "contracts" / "admission-fields.schema.json").read_text(encoding="utf-8")
)
REGIONS = json.loads((ROOT / "contracts" / "regions.mock.json").read_text(encoding="utf-8"))
_VALIDATOR = Draft202012Validator(FIELD_SCHEMA)


def validate_fields(fields: Any) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not isinstance(fields, dict):
        return {"_": "登记信息格式不正确"}
    for error in _VALIDATOR.iter_errors(fields):
        path = next(iter(error.path), None)
        if error.validator == "additionalProperties":
            for extra in set(fields) - set(FIELD_SCHEMA["properties"]):
                errors[extra] = "包含不支持的字段"
        elif path is not None:
            key = str(path)
            errors.setdefault(key, _friendly_message(key, error.validator))
        else:
            for key in FIELD_SCHEMA["required"]:
                if key not in fields:
                    errors[key] = "此项格式不正确"
    for key in ("nativeRegion", "residentRegion"):
        value = fields.get(key)
        if isinstance(value, list) and value and not _region_path_exists(REGIONS, value):
            errors[key] = "请选择有效的省、市、区组合"
    return errors


def _region_path_exists(nodes: list[dict[str, Any]], path: list[str]) -> bool:
    current = nodes
    for code in path:
        node = next((item for item in current if item["code"] == code), None)
        if node is None:
            return False
        current = node.get("children", [])
    return len(path) in (2, 3) and not current


def _friendly_message(key: str, validator: str) -> str:
    labels = {
        "phone": "请输入有效的11位手机号码",
        "addressDetail": "详细地址不能超过200个字符",
        "employerName": "仅支持中英文、数字、空格、中点和括号",
        "employerAddress": "仅支持中英文、数字、空格、中点和括号",
        "emergencyContact": "请输入有效的紧急联系人姓名",
        "marriage": "请选择婚姻状况",
        "occupation": "请选择职业",
        "relationship": "请选择与患者的关系",
    }
    return labels.get(key, "此项格式不正确")
