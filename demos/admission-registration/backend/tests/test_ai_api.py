import httpx
from fastapi.testclient import TestClient

from admission_registration import main
from admission_registration.ai import accepted_candidates
from admission_registration.contracts import REGIONS
from admission_registration.main import app


def _seed_identity() -> str:
    return main.store.verify("id_card")["identityToken"]


def _ai_payload(text: str, token: str, page: int = 1) -> dict:
    return {
        "text": text,
        "page": page,
        "identityToken": token,
        "sessionId": "session-demo-1",
        "turnId": "turn-demo-0001",
    }


class _SessionResponse:
    status_code = 200
    headers: dict = {}

    def raise_for_status(self):
        return None

    def json(self):
        return {"facts": {}, "summary": {}, "turns": []}


class _RegionsResponse:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        def convert(nodes):
            return [
                {
                    "value": node["code"],
                    "label": node["label"],
                    **({"children": convert(node["children"])} if node.get("children") else {}),
                }
                for node in nodes
            ]

        return {"mock": False, "items": convert(REGIONS)}


class _FakeUpstreamClient:
    def __init__(self, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def get(self, url, params, headers):
        return _RegionsResponse() if url.endswith("/regions") else _SessionResponse()


class _UnauthorizedSessionClient(_FakeUpstreamClient):
    async def get(self, url, params, headers):
        return type("Response", (), {"status_code": 401})()


def test_ai_recovers_labeled_region_without_province_name() -> None:
    assert accepted_candidates("我的籍贯沈阳市沈河区", {}) == {
        "nativeRegion": ["210000", "210100", "210103"],
    }
    assert accepted_candidates("我的籍贯长安区", {}) == {}


def test_ai_proxy_requires_platform_bearer_without_echoing_text() -> None:
    token = _seed_identity()
    client = TestClient(app)
    response = client.post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("演示患者电话13800138000", token),
    )
    assert response.status_code == 401
    assert "演示患者" not in response.text


def test_regions_endpoint_returns_complete_tree_from_configured_service(monkeypatch) -> None:
    monkeypatch.setattr(main.httpx, "AsyncClient", _FakeUpstreamClient)
    response = TestClient(app).get("/api/admission-registration/v1/regions")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mock"] is False
    assert payload["items"][0]["children"]
    assert any(
        city.get("children")
        for province in payload["items"]
        for city in province.get("children", [])
    )


def test_ai_proxy_rejects_unknown_or_expired_identity_session(monkeypatch) -> None:
    monkeypatch.setattr(main.httpx, "AsyncClient", _UnauthorizedSessionClient)
    client = TestClient(app)
    response = client.post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("联系电话13800138000", "missing-token"),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "身份核验或平台登录已失效，请重新登录"


def test_ai_proxy_targets_fixed_octop_extract_and_filters_response(monkeypatch) -> None:
    token = _seed_identity()
    captured = {}

    class FakeResponse:
        headers = {"X-Octop-Access-Token": "renewed-platform-token"}

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "fields": {
                    "contact_phone": "13800138000",
                    "id_number": "ATTACKER",
                    "emergency_phone": "13800138000",
                },
                "modelName": "Qwen Display",
            }

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            captured.update(
                {
                    "url": url,
                    "authorization": headers["Authorization"],
                    "text": json["text"],
                    "page": json["page"],
                }
            )
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("联系电话13800138000", token),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "fields": {"phone": "13800138000"},
        "clarificationChoices": [],
        "modelName": "Qwen Display",
        "turnCount": 0,
        "maxTurns": 20,
    }
    assert response.headers["X-Octop-Access-Token"] == "renewed-platform-token"
    assert captured["url"].endswith("/api/admission-demo/extract")
    assert captured["authorization"] == "Bearer platform-token"
    assert "联系电话13800138000" in captured["text"]
    assert "structured_data" in captured["text"]
    assert captured["page"] == 1


def test_ai_proxy_returns_reasons_for_rejected_candidates(monkeypatch) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {}}

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("职业外星人", token, page=2),
        headers={"Authorization": "Bearer platform-token"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "fields": {},
        "clarificationChoices": [],
        "errors": {"occupation": "请选择职业"},
        "turnCount": 0,
        "maxTurns": 20,
    }


def test_ai_proxy_reports_platform_auth_failure_separately_from_identity(monkeypatch) -> None:
    token = _seed_identity()

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            request = httpx.Request("POST", url)
            return httpx.Response(401, request=request)

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("联系电话13800138000", token),
        headers={"Authorization": "Bearer expired-platform-token"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "平台登录已失效，请重新登录"


def test_ai_proxy_blocks_the_21st_turn(monkeypatch) -> None:
    class FullSessionResponse(_SessionResponse):
        def json(self):
            return {
                "facts": {},
                "summary": {},
                "turns": [{"turnId": f"turn-{index}"} for index in range(20)],
            }

    class FakeClient(_FakeUpstreamClient):
        async def get(self, url, params, headers):
            return FullSessionResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("再补充一项", "not-local-but-session-owned"),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "ADMISSION_TURN_LIMIT"
    assert response.json()["detail"]["turnCount"] == 20


def test_turn_proxy_blocks_the_21st_saved_conversation_without_forwarding(monkeypatch) -> None:
    forwarded = False

    class FullSessionResponse(_SessionResponse):
        def json(self):
            return {
                "revision": 20,
                "lastTurnId": "turn-19",
                "facts": {},
                "summary": {},
                "turns": [{"turnId": f"turn-{index}"} for index in range(20)],
            }

    class FakeClient(_FakeUpstreamClient):
        async def get(self, url, params, headers):
            return FullSessionResponse()

        async def post(self, *args, **kwargs):
            nonlocal forwarded
            forwarded = True
            raise AssertionError("a turn beyond the limit must not be forwarded")

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/sessions/session-demo-1/turns",
        json={
            "identityToken": "identity-token",
            "expectedRevision": 20,
            "turnId": "turn-next-0001",
            "previousTurnId": "turn-19",
            "utterance": "再补充一项",
            "response": "收到",
            "action": "manual_turn",
            "fields": {},
        },
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "ADMISSION_TURN_LIMIT"
    assert not forwarded


def test_turn_proxy_forwards_allowed_turn_to_platform(monkeypatch) -> None:
    captured = {}

    class SavedResponse:
        status_code = 200

        def json(self):
            return {"sessionId": "session-demo-1", "revision": 1, "lastTurnId": "turn-00001"}

    class FakeClient(_FakeUpstreamClient):
        async def post(self, url, json, headers):
            captured.update({"url": url, "json": json, "authorization": headers["Authorization"]})
            return SavedResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    body = {
        "identityToken": "identity-token",
        "expectedRevision": 0,
        "turnId": "turn-00001",
        "previousTurnId": None,
        "utterance": "联系电话13800138000",
        "response": "已记录",
        "action": "voice_turn",
        "fields": {"phone": "13800138000"},
        "pendingProposal": None,
    }
    response = TestClient(app).post(
        "/api/admission-registration/v1/sessions/session-demo-1/turns",
        json=body,
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json()["revision"] == 1
    assert captured["url"].endswith("/sessions/session-demo-1/turns")
    assert captured["json"] == body
    assert captured["authorization"] == "Bearer platform-token"


def test_turn_limit_keeps_direct_page_edits_available_after_twenty_dialog_turns(
    monkeypatch,
) -> None:
    class FullDialogSession(_SessionResponse):
        def json(self):
            return {
                "revision": 20,
                "lastTurnId": "turn-19",
                "facts": {},
                "summary": {},
                "turns": [
                    {"turnId": f"turn-{index}", "action": "voice_turn"} for index in range(20)
                ],
            }

    class FakeClient(_FakeUpstreamClient):
        async def get(self, url, params, headers):
            return FullDialogSession()

        async def post(self, url, json, headers):
            return type(
                "SavedResponse",
                (),
                {"status_code": 200, "json": lambda self: {"revision": 21}},
            )()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/sessions/session-demo-1/turns",
        json={
            "identityToken": "identity-token",
            "expectedRevision": 20,
            "turnId": "manual-edit-0001",
            "previousTurnId": "turn-19",
            "utterance": "页面修改职业",
            "response": "已保存职业修改",
            "action": "manual_edit",
            "fields": {"occupation": "学生"},
        },
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200


def test_ai_proxy_extracts_both_pages_for_the_initial_answer_with_one_call(monkeypatch) -> None:
    pages = []

    class FakeResponse(_SessionResponse):
        def __init__(self, page):
            self.page = page
            self.headers = {}

        def json(self):
            fields = (
                {"contact_phone": "13800138000", "occupation": "学生"}
                if self.page == 0
                else {"contact_phone": "13800138000"}
                if self.page == 1
                else {"occupation": "学生"}
            )
            return {"fields": fields, "modelName": "Qwen Display"}

    class FakeClient(_FakeUpstreamClient):
        async def post(self, url, json, headers):
            pages.append(json["page"])
            return FakeResponse(json["page"])

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("联系电话13800138000，职业是学生", "not-local-but-session-owned", page=0),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert pages == [0]
    assert response.json()["fields"] == {"phone": "13800138000", "occupation": "学生"}


def test_ai_proxy_scopes_candidates_to_the_requested_page(monkeypatch) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {"relationship": "子女", "address": "北京市朝阳区"}}

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("女儿陪我办理", token, page=2),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "fields": {"relationship": "子女"},
        "clarificationChoices": [],
        "turnCount": 0,
        "maxTurns": 20,
    }


def test_ai_proxy_maps_region_text_to_cascade_codes(monkeypatch) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "fields": {
                    "resident_region": "北京市朝阳区",
                    "address": "望京街道1号",
                    "native_region": "辽宁省沈阳市和平区",
                }
            }

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("籍贯辽宁省沈阳市和平区，现住北京市朝阳区望京街道1号", token),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "fields": {
            "nativeRegion": ["210000", "210100", "210102"],
            "residentRegion": ["110000", "110105"],
            "addressDetail": "望京街道1号",
        },
        "clarificationChoices": [],
        "turnCount": 0,
        "maxTurns": 20,
    }


def test_ai_proxy_maps_regions_that_were_missing_from_the_old_sample_tree(monkeypatch) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {"resident_region": "上海市浦东新区", "address": "世纪大道100号"}}

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("现住上海市浦东新区世纪大道100号", token),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "fields": {
            "residentRegion": ["310000", "310115"],
            "addressDetail": "世纪大道100号",
        },
        "clarificationChoices": [],
        "turnCount": 0,
        "maxTurns": 20,
    }


def test_ai_proxy_uses_current_platform_regions_for_parsing_and_validation(monkeypatch) -> None:
    token = _seed_identity()
    captured = {}

    class DynamicRegionsResponse(_RegionsResponse):
        def json(self):
            return {
                "mock": False,
                "items": [
                    {
                        "value": "990000",
                        "label": "测试省",
                        "children": [
                            {
                                "value": "990100",
                                "label": "测试市",
                                "children": [{"value": "990101", "label": "测试区", "leaf": True}],
                            }
                        ],
                    }
                ],
            }

    class ExtractResponse:
        headers = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {"resident_region": "测试省测试市测试区"}}

    class FakeClient(_FakeUpstreamClient):
        async def get(self, url, params, headers):
            if url.endswith("/regions"):
                captured["region_url"] = url
                captured["region_headers"] = headers
                return DynamicRegionsResponse()
            return _SessionResponse()

        async def post(self, url, json, headers):
            return ExtractResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("现住测试省测试市测试区", token),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json()["fields"] == {"residentRegion": ["990000", "990100", "990101"]}
    assert captured["region_url"] == main.REGIONS_SERVICE_URL
    assert captured["region_headers"] == {}


def test_ai_proxy_still_extracts_phone_when_region_service_is_unavailable(monkeypatch) -> None:
    token = _seed_identity()

    class ExtractResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {"contact_phone": "13800138000"}}

    class FakeClient(_FakeUpstreamClient):
        async def get(self, url, params, headers):
            if url.endswith("/regions"):
                raise httpx.ConnectError("synthetic regions outage")
            return await super().get(url, params, headers)

        async def post(self, url, json, headers):
            return ExtractResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload(
            "联系电话13800138000，现住辽宁省沈阳市沈河区五爱街1号",
            token,
        ),
        headers={"Authorization": "Bearer platform-token"},
    )

    assert response.status_code == 200
    assert response.json()["fields"]["phone"] == "13800138000"


def test_ai_proxy_recovers_explicit_region_labels_when_model_only_returns_address(
    monkeypatch,
) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "fields": {
                    "contact_phone": "13478878803",
                    "address": "辽宁省沈阳市沈河区",
                }
            }

    class FakeClient(_FakeUpstreamClient):
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json, headers):
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = TestClient(app).post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload(
            "帮我记录一下电话13478878803，并且籍贯是辽宁省沈阳市沈河区，"
            "现住地址也是辽宁省沈阳市沈河区。",
            token,
        ),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "fields": {
            "phone": "13478878803",
            "nativeRegion": ["210000", "210100", "210103"],
            "residentRegion": ["210000", "210100", "210103"],
        },
        "clarificationChoices": [],
        "turnCount": 0,
        "maxTurns": 20,
    }
