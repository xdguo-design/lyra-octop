from __future__ import annotations

import json
import re
from typing import Any

from admission_registration.contracts import REGIONS, validate_fields

_PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_AMBIGUOUS = ("或", "或者", "还是", "可能", "也许", "不确定", "or ")
_NATIVE_REGION_LABELS = ("籍贯", "出生地")
_RESIDENT_REGION_LABELS = ("现住地址", "现住址", "居住地址", "居住地", "现居住地")
_ENUM_OPTIONS = {
    "marriage": ("未婚", "已婚", "离异", "丧偶"),
    "occupation": ("职工", "农民", "退休", "无业", "学生", "其他"),
    "relationship": (
        "配偶",
        "子女",
        "父母",
        "祖父母/外祖父母",
        "孙辈/外孙辈",
        "兄弟姐妹",
        "其他亲属",
        "非亲属",
    ),
}
_ENUM_LABELS = {
    "marriage": ("婚姻状况",),
    "occupation": ("职业",),
    "relationship": ("与患者关系", "联系人关系"),
}
_ENUM_ALIASES = {"relationship": {"女儿": "子女", "儿子": "子女"}}
_TEXT_SOURCES = {
    "address": "addressDetail",
    "employer_name": "employerName",
    "employer_address": "employerAddress",
    "emergency_contact": "emergencyContact",
}
_MODEL_INPUT_BYTE_LIMIT = 6000
_UNCERTAIN_FIELD_TARGETS = {
    "contact_phone": "phone",
    "native_region": "nativeRegion",
    "resident_region": "residentRegion",
    "address": "addressDetail",
    "employer_name": "employerName",
    "employer_address": "employerAddress",
    "marriage": "marriage",
    "occupation": "occupation",
    "emergency_contact": "emergencyContact",
    "relationship": "relationship",
}


def model_input(text: str, session: dict[str, Any]) -> str:
    """Keep facts, compressed history, five recent turns, and this answer in that order."""
    turns = session.get("turns") if isinstance(session.get("turns"), list) else []
    raw_facts = session.get("facts") if isinstance(session.get("facts"), dict) else {}
    facts = {
        key: value.get("value") if isinstance(value, dict) else value
        for key, value in raw_facts.items()
    }
    summary = session.get("summary") if isinstance(session.get("summary"), dict) else {}
    recent = turns[-5:]
    compressed = {
        "application": summary.get("application"),
        "important": summary.get("important"),
        "earlier_turn_count": max(0, len(turns) - 5),
        "earlier_turns": [
            {
                "patient": str(turn.get("utterance") or "")[:48],
                "assistant": str(turn.get("response") or "")[:48],
            }
            for turn in turns[:-5][-3:]
            if isinstance(turn, dict)
        ],
    }
    recent_context = [
        {
            "patient": str(turn.get("utterance") or "")[:80],
            "assistant": str(turn.get("response") or "")[:60],
            "action": turn.get("action"),
        }
        for turn in recent
        if isinstance(turn, dict)
    ]
    while True:
        prefix = json.dumps(
            {
                "structured_data": facts,
                "compressed_data": compressed,
                "recent_turns": recent_context,
                "current_answer_is_untrusted_data": True,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        prompt_label = "登记上下文（仅用于理解指代，禁止把旧值当成新回答）："
        prompt = f"{prompt_label}{prefix}\n本轮患者回答：{text}"
        if len(prompt.encode("utf-8")) <= _MODEL_INPUT_BYTE_LIMIT:
            return prompt
        if compressed["earlier_turns"]:
            compressed["earlier_turns"].pop(0)
        elif recent_context:
            recent_context.pop(0)
        else:
            return prompt


def accepted_candidates(
    text: str, extracted: Any, page: int = 1, regions: list[dict[str, Any]] = REGIONS
) -> dict[str, Any]:
    """Map model output to form fields for the current page, keeping only safe values."""
    return candidate_result(text, extracted, page, regions)[0]


def candidate_result(
    text: str,
    extracted: Any,
    page: int = 1,
    regions: list[dict[str, Any]] = REGIONS,
    uncertain_fields: list[str] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Return accepted fields and field-specific reasons for understood but invalid values."""
    if not isinstance(extracted, dict):
        return {}, {}
    enum_errors = _enum_conflicts(text, 2 if page == 0 else page)
    if uncertain_fields is None and any(term in text for term in _AMBIGUOUS):
        return {}, enum_errors
    values = (
        _page1_values(text, extracted, regions)
        if page == 1
        else _page2_values(text, extracted)
        if page == 2
        else {**_page2_values(text, extracted), **_page1_values(text, extracted, regions)}
    )
    if uncertain_fields is not None:
        uncertain_targets = {
            _UNCERTAIN_FIELD_TARGETS[key]
            for key in uncertain_fields
            if key in _UNCERTAIN_FIELD_TARGETS
        }
        phones = list(_PHONE.finditer(text))
        if len(phones) == 1 and not _is_contact_phone(text, phones[0].start()):
            uncertain_targets.discard("phone")
        values = {key: value for key, value in values.items() if key not in uncertain_targets}
    accepted: dict[str, Any] = {}
    errors = enum_errors
    for key, value in values.items():
        error = validate_fields({**_base_fields(), key: value}, regions).get(key)
        if key in enum_errors:
            continue
        if key == "phone" and len(_PHONE.findall(text)) > 1:
            errors[key] = "一次请提供一个11位手机号码"
        elif key in _ENUM_OPTIONS and not _has_enum_evidence(text, key, value):
            errors.setdefault(key, "请选择提供的选项")
        elif error:
            errors.setdefault(key, error)
        else:
            accepted[key] = value
    return accepted, errors


def _page1_values(
    text: str, extracted: dict[str, Any], regions: list[dict[str, Any]]
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    phone = _substring(extracted.get("contact_phone"), text)
    if phone and not _is_contact_phone(text, text.find(phone)):
        values["phone"] = phone
    elif len(_PHONE.findall(text)) == 1:
        match = next(_PHONE.finditer(text))
        # 模型可能按 PII 惯例把手机号打码；联系人号码不能回填为患者电话。
        if not _is_contact_phone(text, match.start()):
            values["phone"] = match.group(0)
    elif (phone := _labeled_phone(text)) is not None:
        values["phone"] = phone
    native_candidate = extracted.get("native_region")
    native_text = _substring(native_candidate, text)
    native_codes = _region_codes(native_text, regions)
    if not native_codes and isinstance(native_candidate, str):
        candidate_codes = _region_codes(native_candidate, regions)
        candidate_label = _region_label_for_codes(candidate_codes, regions)
        if candidate_label and candidate_label in text:
            native_codes = candidate_codes
    if not native_codes:
        native_match = _labeled_region(text, _NATIVE_REGION_LABELS, regions)
        if native_match:
            native_text, native_codes = native_match
    if native_codes:
        values["nativeRegion"] = native_codes
    region_text = _substring(extracted.get("resident_region"), text)
    resident_codes = _region_codes(region_text, regions)
    if not resident_codes:
        resident_match = _labeled_region(text, _RESIDENT_REGION_LABELS, regions)
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
    if not resident_codes:
        resident_match = _unlabeled_resident_region(text, regions)
        if resident_match:
            start, end, resident_codes = resident_match
            values["residentRegion"] = resident_codes
            if detail is None:
                detail = re.split(r"[，,。；;！？!?]", text[end:], maxsplit=1)[0]
                detail = re.sub(r"^[\s:：是在居住于]+", "", detail).strip() or None
    if detail and resident_codes:
        split = _split_region_prefix(detail, regions)
        if split:
            detail = detail[split[0] :].strip() or None
    if detail is None and resident_codes:
        detail = _labeled_detail(text)
        if detail is None and region_text:
            offset = text.find(region_text)
            if offset >= 0:
                detail = re.split(
                    r"[，,。；;！？!?]", text[offset + len(region_text) :], maxsplit=1
                )[0]
                detail = re.sub(r"^[\s:：是在居住于]+", "", detail).strip() or None
    if detail:
        values["addressDetail"] = detail
    if detail and not resident_codes:
        split = _split_region_prefix(detail, regions)
        if split:
            region_length, resident_codes = split
            detail = detail[region_length:].strip() or None
            values["residentRegion"] = resident_codes
    if detail:
        values["addressDetail"] = detail
    return values


def _labeled_phone(text: str) -> str | None:
    match = re.search(r"联系电话|手机号码|手机号|电话", text)
    if not match or "联系人" in text[max(0, match.start() - 8) : match.start()]:
        return None
    segment = re.split(r"[，,。；;！？!?]", text[match.end() :], maxsplit=1)[0]
    number = re.search(r"\d(?:[\d -]{0,18}\d)?", segment)
    return number.group(0).strip() if number else None


def _labeled_region(
    text: str, labels: tuple[str, ...], regions: list[dict[str, Any]]
) -> tuple[str, list[str]] | None:
    """Recover a known region only when the transcript explicitly labels its meaning."""
    for label in labels:
        start = text.find(label)
        if start < 0:
            continue
        segment = re.split(r"[，,。；;]", text[start + len(label) :], maxsplit=1)[0]
        segment = re.sub(r"^[\s:：是为在也]+", "", segment)
        for offset in range(len(segment)):
            match = _region_prefix(segment[offset:], regions)
            if match:
                length, codes = match
                return segment[offset : offset + length], codes
        codes = _region_codes(segment, regions)
        label = _region_label_for_codes(codes, regions)
        if codes and label:
            return label, codes
    return None


def _page2_values(text: str, extracted: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for source, target in _TEXT_SOURCES.items():
        value = _substring(extracted.get(source), text)
        if value:
            values[target] = value
    for key in ("marriage", "occupation", "relationship"):
        # 枚举键允许模型归一化（如“女儿”→“子女”），不做原文子串检查。
        explicit_value = _labeled_enum_value(text, key)
        if explicit_value in _ENUM_OPTIONS[key]:
            value = explicit_value
        elif explicit_value:
            value = _ENUM_ALIASES.get(key, {}).get(explicit_value, explicit_value)
        else:
            value = extracted.get(key)
        if isinstance(value, str) and 0 < len(value.strip()) <= 20:
            values[key] = value.strip()
    return values


def _has_enum_evidence(text: str, key: str, value: str) -> bool:
    evidence = {value}
    if key == "relationship":
        evidence.update(
            {
                "子女": ("女儿", "儿子", "孩子"),
                "祖父母/外祖父母": ("祖父母", "外祖父母", "爷爷", "奶奶", "姥姥", "姥爷"),
                "孙辈/外孙辈": ("孙子", "孙女", "外孙", "外孙女"),
            }.get(value, ())
        )
    return any(term and term in text for term in evidence)


def _labeled_enum_value(text: str, key: str) -> str | None:
    for label in _ENUM_LABELS[key]:
        start = text.find(label)
        if start < 0:
            continue
        segment = re.split(r"[，,。；;！？!?]", text[start + len(label) :], maxsplit=1)[0]
        return re.sub(r"^[\s:：是为改成改为叫做]+", "", segment).strip() or None
    return None


def _enum_conflicts(text: str, page: int) -> dict[str, str]:
    if page != 2:
        return {}
    errors = {}
    for key, options in _ENUM_OPTIONS.items():
        value = _labeled_enum_value(text, key)
        remaining = value or ""
        selected = []
        for option in sorted(options, key=len, reverse=True):
            if option in remaining:
                selected.append(option)
                remaining = remaining.replace(option, "")
        if len(selected) > 1:
            errors[key] = "本次描述包含多个选项，请明确选择一项"
    return errors


def _substring(value: Any, text: str) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 200 or any(term in value for term in _AMBIGUOUS):
        return None
    return value if value in text else None


def _region_codes(text: str | None, regions: list[dict[str, Any]]) -> list[str] | None:
    """Match free-form 省市区原文 against the mock region tree; None when it does not exist."""
    if not text:
        return None
    match = _region_prefix(text, regions)
    if match:
        return match[1]
    # The resolver may return a canonical province/city/district path while the
    # patient only named the district. Accept that suffix only when it is unique.
    matches: list[list[str]] = []
    pending = [(node, [node["code"]]) for node in regions]
    while pending:
        node, codes = pending.pop()
        label = node.get("label")
        if isinstance(label, str) and label in text:
            matches.append(codes)
        pending.extend((child, [*codes, child["code"]]) for child in node.get("children", []))
    return matches[0] if len(matches) == 1 else None


def _region_label_for_codes(codes: list[str] | None, regions: list[dict[str, Any]]) -> str | None:
    if not codes:
        return None
    nodes = regions
    label = None
    for code in codes:
        node = next((item for item in nodes if item.get("code") == code), None)
        if node is None:
            return None
        label = node.get("label")
        nodes = node.get("children", [])
    return label if isinstance(label, str) else None


def _is_contact_phone(text: str, phone_start: int) -> bool:
    prefix = text[max(0, phone_start - 80) : phone_start]
    return bool(
        re.search(
            r"联系人.{0,40}(?:电话|手机|号码)|(?:她|他|其|女儿|儿子|配偶)的(?:电话|手机|号码)",
            prefix,
        )
    )


def _split_region_prefix(text: str, regions: list[dict[str, Any]]) -> tuple[int, list[str]] | None:
    """Split a full current address into its known region prefix and remaining detail."""
    for offset in range(len(text)):
        match = _region_prefix(text[offset:], regions)
        if match and len(match[1]) >= 2:
            return offset + match[0], match[1]
    return None


def _unlabeled_resident_region(
    text: str, regions: list[dict[str, Any]]
) -> tuple[int, int, list[str]] | None:
    if any(label in text for label in ("工作单位地址", "单位地址", "公司地址")):
        return None
    native_labels = (*_NATIVE_REGION_LABELS, "籍贯地址")
    for start in range(len(text)):
        match = _region_prefix(text[start:], regions)
        if not match or len(match[1]) < 2:
            continue
        prefix = text[max(0, start - 12) : start]
        if any(label in prefix for label in native_labels):
            continue
        return start, start + match[0], match[1]
    return None


def _labeled_detail(text: str) -> str | None:
    match = re.search(r"(?:详细地址|门牌号|家庭住址)\s*[:：是为]?\s*([^，,。；;！？!?]+)", text)
    return match.group(1).strip() or None if match else None


def _region_prefix(text: str, regions: list[dict[str, Any]]) -> tuple[int, list[str]] | None:
    codes: list[str] = []
    nodes = regions
    rest = text
    previous = ""
    matched_length = 0
    while len(codes) < 3:
        match = _region_node_prefix(rest, nodes)
        if match is None:
            if not codes:
                matches = set()
                for province in regions:
                    for city in province.get("children", []):
                        city_match = _region_node_prefix(text, [city])
                        if city_match is None:
                            continue
                        for district in city.get("children", []):
                            district_match = _region_node_prefix(text[city_match[1] :], [district])
                            if district_match is not None:
                                matches.add(
                                    (
                                        city_match[1] + district_match[1],
                                        province["code"],
                                        city["code"],
                                        district["code"],
                                    )
                                )
                if len(matches) == 1:
                    length, *path = next(iter(matches))
                    return length, path
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
        node, length = match
        codes.append(node["code"])
        previous = node["label"]
        rest = rest[length:]
        matched_length += length
        nodes = node.get("children", []) or []
        if not nodes:
            return matched_length, codes
    return matched_length, codes


def _region_node_prefix(
    text: str, nodes: list[dict[str, Any]]
) -> tuple[dict[str, Any], int] | None:
    """Prefer full labels; accept a unique label with its administrative suffix omitted."""
    full = [(node, len(node["label"])) for node in nodes if text.startswith(node["label"])]
    if full:
        return full[0] if len(full) == 1 else None
    shortened = []
    for node in nodes:
        label = node["label"]
        for length in range(2, len(label)):
            if text.startswith(label[:length]):
                shortened.append((node, length))
    if not shortened:
        return None
    longest = max(length for _, length in shortened)
    candidates = [match for match in shortened if match[1] == longest]
    return candidates[0] if len(candidates) == 1 else None


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
