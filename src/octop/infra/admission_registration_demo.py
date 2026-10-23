"""Mock domain rules for the Vue admission-registration prototype."""

from __future__ import annotations

import json
import re
import threading
from copy import deepcopy
from hashlib import sha256
from importlib.resources import files
from time import monotonic
from typing import Any, cast
from uuid import uuid4

from jsonschema import Draft202012Validator

SESSION_TTL_SECONDS = 30 * 60
MAX_SESSIONS = 500
MAX_SUBMISSIONS = 2000
_SCHEMA_DIR = files("octop.infra")
FIELD_SCHEMA = json.loads(
    _SCHEMA_DIR.joinpath("admission_registration_fields.schema.json").read_text(encoding="utf-8")
)
REGIONS = json.loads(
    _SCHEMA_DIR.joinpath("admission_registration_regions.json").read_text(encoding="utf-8")
)
_VALIDATOR = Draft202012Validator(FIELD_SCHEMA)
_PHONE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_LABELED_PHONE = re.compile(
    r"(?<!紧急联系人)(?<!联系人)(?:我(?:的)?|本人(?:的)?)?"
    r"(?:联系电话|联系手机|手机号|手机号码|电话号码|电话|手机)"
    # 单一字符类分隔符，避免相邻两个 \s* 产生多项式回溯（py/polynomial-redos）。
    r"[\s:：是为]*(1[3-9]\d{9})(?!\d)"
)
_TEXT_SOURCES = {
    "address": "addressDetail",
    "employer_name": "employerName",
    "employer_address": "employerAddress",
    "emergency_contact": "emergencyContact",
}
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


class StoreCapacityError(Exception):
    """The bounded in-memory mock store is full."""


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


def regions_for(parent_code: str | None) -> list[dict[str, object]]:
    nodes: list[dict[str, Any]] = REGIONS
    if parent_code:
        node = _find_region(nodes, parent_code)
        if node is None:
            raise KeyError(parent_code)
        nodes = node.get("children", [])
    return [
        {"value": node["code"], "label": node["label"], "leaf": not node.get("children")}
        for node in nodes
    ]


def _find_region(nodes: list[dict[str, Any]], code: str) -> dict[str, Any] | None:
    for node in nodes:
        if node["code"] == code:
            return node
        found = _find_region(node.get("children", []), code)
        if found:
            return found
    return None


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


def accepted_candidates(text: str, extracted: Any, page: int = 1) -> dict[str, Any]:
    """Map model output to form fields for the current page, keeping only safe values."""
    return candidate_result(text, extracted, page)[0]


def candidate_result(
    text: str, extracted: Any, page: int = 1, uncertain_fields: list[str] | None = None
) -> tuple[dict[str, Any], dict[str, str]]:
    """Return accepted fields and field-specific reasons for understood but invalid values."""
    if not isinstance(extracted, dict):
        return {}, {}
    errors = _enum_conflicts(text, page)
    if uncertain_fields is None and any(term in text for term in _AMBIGUOUS):
        return {}, errors
    if page == 0:
        values = _page2_values(text, extracted)
        values.pop("addressDetail", None)
        values.update(_page1_values(text, extracted))
    else:
        values = _page1_values(text, extracted) if page == 1 else _page2_values(text, extracted)
    if uncertain_fields is not None:
        uncertain_targets = {
            _UNCERTAIN_FIELD_TARGETS[key]
            for key in uncertain_fields
            if key in _UNCERTAIN_FIELD_TARGETS
        }
        values = {key: value for key, value in values.items() if key not in uncertain_targets}
    accepted: dict[str, Any] = {}
    for key, value in values.items():
        error = validate_fields({**_base_fields(), key: value}).get(key)
        if key in errors:
            continue
        if key == "phone" and len(_PHONE.findall(text)) > 1:
            errors[key] = "一次请提供一个11位手机号码"
        elif error:
            errors[key] = error
        else:
            accepted[key] = value
    return accepted, errors


def _page1_values(text: str, extracted: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    phone = _substring(extracted.get("contact_phone"), text)
    if phone and len(phone) == 11 and _PHONE.findall(text) == [phone]:
        values["phone"] = phone
    elif len(_PHONE.findall(text)) == 1:
        labeled_phones = list(_LABELED_PHONE.finditer(text))
        if len(labeled_phones) == 1:
            values["phone"] = labeled_phones[0].group(1)
        else:
            match = next(_PHONE.finditer(text))
            # 模型可能按 PII 惯例把手机号打码（如 ****8813）导致子串校验失败；
            # 原话恰好只有一个 11 位号码时无需模型指认，联系人口径的号码除外。
            if "联系人" not in text[max(0, match.start() - 8) : match.start()]:
                values["phone"] = match.group(0)
    else:
        labeled_phone = _labeled_phone_input(text)
        if labeled_phone is not None:
            values["phone"] = labeled_phone
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
        explicit_value = _labeled_enum_value(text, key)
        value = explicit_value or extracted.get(key)
        if explicit_value:
            value = _ENUM_ALIASES.get(key, {}).get(explicit_value, explicit_value)
        if isinstance(value, str) and 0 < len(value.strip()) <= 20:
            values[key] = value.strip()
    return values


def _labeled_phone_input(text: str) -> str | None:
    match = re.search(r"联系电话|联系手机|手机号|手机号码|电话号码|电话|手机", text)
    if not match or "联系人" in text[max(0, match.start() - 8) : match.start()]:
        return None
    segment = re.split(r"[，,。；;！？!?]", text[match.end() :], maxsplit=1)[0]
    number = re.search(r"\d[\d -]{0,18}\d|\d", segment)
    return re.sub(r"[ -]", "", number.group(0)) if number else None


def _labeled_enum_value(text: str, key: str) -> str | None:
    for label in _ENUM_LABELS[key]:
        start = text.find(label)
        if start >= 0:
            segment = re.split(r"[，,。；;！？!?]", text[start + len(label) :], maxsplit=1)[0]
            return re.sub(r"^[\s:：是为改成改为叫做]+", "", segment).strip() or None
    return None


def _enum_conflicts(text: str, page: int) -> dict[str, str]:
    if page not in (0, 2):
        return {}
    errors = {}
    for key, options in _ENUM_OPTIONS.items():
        value = _labeled_enum_value(text, key) or ""
        remaining = value
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


def _region_codes(text: str | None) -> list[str] | None:
    """Match free-form 省市区原文 against the mock region tree; None when it does not exist."""
    if not text:
        return None
    match = _region_prefix(text)
    return match[1] if match else None


def _region_prefix(text: str) -> tuple[int, list[str]] | None:
    codes: list[str] = []
    nodes: list[dict[str, Any]] = REGIONS
    rest = text
    previous = ""
    matched_length = 0
    while len(codes) < 3:
        match = _region_node_prefix(rest, nodes)
        if match is None:
            if not codes:
                matches = set()
                for province in REGIONS:
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
            codes.append(str(filler["code"]))
            nodes = filler.get("children", []) or []
            continue
        node, length = match
        codes.append(str(node["code"]))
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
    full = [(node, len(node["label"])) for node in nodes if text.startswith(node["label"])]
    if full:
        return full[0] if len(full) == 1 else None
    shortened = [
        (node, size)
        for node in nodes
        for size in range(2, len(node["label"]))
        if text.startswith(node["label"][:size])
    ]
    if not shortened:
        return None
    longest = max(size for _, size in shortened)
    candidates = [item for item in shortened if item[1] == longest]
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


class DemoStore:
    """Process-local fake identity and idempotency records, isolated per Octop user."""

    def __init__(self) -> None:
        self.identities: dict[str, dict[str, object]] = {}
        self.submissions: dict[tuple[int, str, str], tuple[str, dict[str, object]]] = {}
        self._lock = threading.RLock()

    def verify(self, user_id: int, method: str) -> dict[str, object]:
        with self._lock:
            self._prune()
            patient_ref = f"patient_demo_{user_id}"
            old_tokens = [
                token
                for token, identity in self.identities.items()
                if identity["userId"] == user_id and identity["patientRef"] == patient_ref
            ]
            if len(self.identities) - len(old_tokens) >= MAX_SESSIONS:
                raise StoreCapacityError
            for token in old_tokens:
                self.identities.pop(token, None)
            for record_key in list(self.submissions):
                if record_key[0] == user_id and record_key[1] in old_tokens:
                    self.submissions.pop(record_key, None)
            token = str(uuid4())
            fields: dict[str, object] = {
                "name": "演示患者",
                "idNumber": "DEMO-ID-0001",
                "phone": "",
                "nationality": "中国",
                "ethnicity": "汉族",
                "nativeRegion": [],
                "residentRegion": [],
                "addressDetail": "",
                "employerName": "",
                "employerAddress": "",
                "marriage": "",
                "occupation": "",
                "emergencyContact": "",
                "relationship": "",
            }
            self.identities[token] = {
                "userId": user_id,
                "method": method,
                "fields": deepcopy(fields),
                "application": {
                    "id": f"APP-DEMO-{user_id}",
                    "patientName": "演**者",
                    "department": "心内科",
                    "plannedAdmissionAt": "2026-10-22 09:00",
                    "doctor": "王医生",
                    "orderedAt": "2026-10-19 15:30",
                    "type": "普通住院",
                    "diagnosis": "冠心病待查",
                    "ward": "心内科一区",
                    "status": "有效",
                },
                "selectedApplicationId": "",
                "patientRef": patient_ref,
                "admissionSessionId": "",
                "expiresAt": monotonic() + SESSION_TTL_SECONDS,
            }
            return {
                "mock": True,
                "verified": True,
                "identityToken": token,
                "fields": fields,
            }

    def identity(self, user_id: int, token: str) -> dict[str, object] | None:
        with self._lock:
            self._prune()
            identity = self.identities.get(token)
            return identity if identity and identity["userId"] == user_id else None

    def applications(self, user_id: int, token: str) -> list[dict[str, object]] | None:
        with self._lock:
            identity = self.identity(user_id, token)
            if identity is None:
                return None
            application = cast(dict[str, object], identity["application"])
            return [deepcopy(application)] if application["status"] == "有效" else []

    def select_application(
        self, user_id: int, token: str, application_id: str
    ) -> dict[str, object] | None:
        with self._lock:
            identity = self.identity(user_id, token)
            if identity is None:
                return None
            application = cast(dict[str, object], identity["application"])
            if application["id"] != application_id or application["status"] != "有效":
                return None
            identity["selectedApplicationId"] = application_id
            return deepcopy(application)

    def selected_application(self, user_id: int, token: str) -> dict[str, object] | None:
        with self._lock:
            identity = self.identity(user_id, token)
            if identity is None:
                return None
            application = cast(dict[str, object], identity["application"])
            if (
                identity["selectedApplicationId"] != application["id"]
                or application["status"] != "有效"
            ):
                return None
            return deepcopy(application)

    def admission_session_id(self, user_id: int, token: str) -> str | None:
        with self._lock:
            identity = self.identity(user_id, token)
            if identity is None or self.selected_application(user_id, token) is None:
                return None
            session_id = cast(str, identity["admissionSessionId"])
            if not session_id:
                session_id = f"adm_{uuid4().hex}"
                identity["admissionSessionId"] = session_id
            return session_id

    def submit(
        self,
        user_id: int,
        token: str,
        key: str,
        fields: dict[str, object],
        scenario: str,
    ) -> tuple[str, dict[str, object]] | None:
        with self._lock:
            identity = self.identity(user_id, token)
            if identity is None:
                return None
            record_key = (user_id, token, key)
            fingerprint = sha256(
                json.dumps([fields, scenario], ensure_ascii=False, sort_keys=True).encode("utf-8")
            ).hexdigest()
            if record_key in self.submissions:
                previous_fingerprint, previous_result = self.submissions[record_key]
                return previous_fingerprint, deepcopy(previous_result)
            if len(self.submissions) >= MAX_SUBMISSIONS:
                raise StoreCapacityError
            result: dict[str, object] = {"mock": True, "status": scenario}
            if scenario == "success":
                result.update(
                    {
                        "receiptId": f"SIM-{uuid4().hex[:10].upper()}",
                        "notificationSent": False,
                        "printSucceeded": False,
                    }
                )
            self.submissions[record_key] = (fingerprint, result)
            return fingerprint, deepcopy(result)

    def result(self, user_id: int, token: str, key: str) -> dict[str, object] | None:
        with self._lock:
            self._prune()
            if self.identity(user_id, token) is None:
                return None
            record = self.submissions.get((user_id, token, key))
            return deepcopy(record[1]) if record else None

    def reset(self) -> None:
        with self._lock:
            self.identities.clear()
            self.submissions.clear()

    def _prune(self) -> None:
        expired = [
            token
            for token, data in self.identities.items()
            if cast(float, data["expiresAt"]) <= monotonic()
        ]
        for token in expired:
            self.identities.pop(token, None)
        if expired:
            for record_key in list(self.submissions):
                if record_key[1] in expired:
                    self.submissions.pop(record_key, None)


demo_store = DemoStore()
