from __future__ import annotations

import re
from typing import Any

from admission_registration.contracts import REGIONS, validate_fields

_PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_AMBIGUOUS = ("或", "或者", "还是", "可能", "也许", "不确定", "or ")
_NATIVE_REGION_LABELS = ("籍贯", "出生地")
_RESIDENT_REGION_LABELS = ("现住地址", "现住址", "居住地址", "居住地", "现居住地")
_TEXT_SOURCES = {
    "address": "addressDetail",
    "employer_name": "employerName",
    "employer_address": "employerAddress",
    "emergency_contact": "emergencyContact",
}


def accepted_candidates(text: str, extracted: Any, page: int = 1) -> dict[str, Any]:
    """Map model output to form fields for the current page, keeping only safe values."""
    if not isinstance(extracted, dict) or any(term in text for term in _AMBIGUOUS):
        return {}
    values = _page1_values(text, extracted) if page == 1 else _page2_values(text, extracted)
    return {
        key: value
        for key, value in values.items()
        if not validate_fields({**_base_fields(), key: value}).get(key)
    }


def _page1_values(text: str, extracted: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    phone = _substring(extracted.get("contact_phone"), text)
    if phone and len(phone) == 11 and _PHONE.findall(text) == [phone]:
        values["phone"] = phone
    native_text = _substring(extracted.get("native_region"), text)
    native_codes = _region_codes(native_text)
    if not native_codes:
        native_match = _labeled_region(text, _NATIVE_REGION_LABELS)
        if native_match:
            native_text, native_codes = native_match
    if native_codes:
        values["nativeRegion"] = native_codes
    region_text = _substring(extracted.get("resident_region"), text)
    resident_codes = _region_codes(region_text)
    if not resident_codes:
        resident_match = _labeled_region(text, _RESIDENT_REGION_LABELS)
        if resident_match:
            region_text, resident_codes = resident_match
    if resident_codes:
        values["residentRegion"] = resident_codes
    detail = _substring(extracted.get("address"), text)
    if detail and region_text and detail.startswith(region_text):
        detail = detail[len(region_text) :].strip() or None
    if not resident_codes and region_text:
        # 省市区不在模拟地区库里时把原文并入详细地址，避免把地址整段丢掉。
        concatenated = region_text + (detail or "")
        if concatenated in text:
            detail = concatenated
        elif detail is None:
            detail = region_text
    if detail:
        values["addressDetail"] = detail
    return values


def _labeled_region(text: str, labels: tuple[str, ...]) -> tuple[str, list[str]] | None:
    """Recover a known region only when the transcript explicitly labels its meaning."""
    for label in labels:
        start = text.find(label)
        if start < 0:
            continue
        segment = re.split(r"[，,。；;]", text[start + len(label) :], maxsplit=1)[0]
        segment = re.sub(r"^[\s:：是为在也]+", "", segment)
        for offset in range(len(segment)):
            match = _region_prefix(segment[offset:])
            if match:
                length, codes = match
                return segment[offset : offset + length], codes
    return None


def _page2_values(text: str, extracted: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for source, target in _TEXT_SOURCES.items():
        value = _substring(extracted.get(source), text)
        if value:
            values[target] = value
    for key in ("marriage", "occupation", "relationship"):
        # 枚举键允许模型归一化（如“女儿”→“子女”），不做原文子串检查。
        value = extracted.get(key)
        if isinstance(value, str) and 0 < len(value.strip()) <= 20:
            values[key] = value.strip()
    return values


def _substring(value: Any, text: str) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 200 or any(term in value for term in _AMBIGUOUS):
        return None
    return value if value in text else None


def _region_codes(text: str | None) -> list[str] | None:
    """Match free-form 省市区原文 against the mock region tree; None when it does not exist."""
    if not text:
        return None
    match = _region_prefix(text)
    return match[1] if match else None


def _region_prefix(text: str) -> tuple[int, list[str]] | None:
    codes: list[str] = []
    nodes = REGIONS
    rest = text
    previous = ""
    matched_length = 0
    while len(codes) < 3:
        node = next((item for item in nodes if rest.startswith(item["label"])), None)
        if node is None:
            # 直辖市口语常省略与省同名的市级（“北京市朝阳区”），跳过该级占位。
            filler = next(
                (
                    item
                    for item in nodes
                    if len(nodes) == 1 and item["label"] == previous and len(codes) == 1
                ),
                None,
            )
            if filler is None:
                return None
            codes.append(filler["code"])
            nodes = filler.get("children", []) or []
            continue
        codes.append(node["code"])
        previous = node["label"]
        rest = rest[len(node["label"]) :]
        matched_length += len(node["label"])
        nodes = node.get("children", []) or []
        if not nodes:
            return matched_length, codes
    return matched_length, codes


def _base_fields() -> dict[str, Any]:
    return {
        "name": "演示患者",
        "idNumber": "DEMO-ID-0001",
        "phone": "13800138000",
        "nationality": "中国",
        "ethnicity": "汉族",
        "nativeRegion": [],
        "residentRegion": [],
        "addressDetail": "",
        "employerName": "",
        "employerAddress": "",
        "marriage": "未婚",
        "occupation": "职工",
        "emergencyContact": "演示联系人",
        "relationship": "子女",
    }
