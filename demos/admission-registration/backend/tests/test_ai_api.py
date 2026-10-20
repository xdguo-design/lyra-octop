from fastapi.testclient import TestClient

from admission_registration import main
from admission_registration.main import app


def _seed_identity() -> str:
    return main.store.verify("id_card")["identityToken"]


def _ai_payload(text: str, token: str, page: int = 1) -> dict:
    return {"text": text, "page": page, "identityToken": token}


def test_ai_proxy_requires_platform_bearer_without_echoing_text() -> None:
    token = _seed_identity()
    client = TestClient(app)
    response = client.post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("演示患者电话13800138000", token),
    )
    assert response.status_code == 401
    assert "演示患者" not in response.text


def test_ai_proxy_rejects_unknown_or_expired_identity_session() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/admission-registration/v1/ai/candidates",
        json=_ai_payload("联系电话13800138000", "missing-token"),
        headers={"Authorization": "Bearer platform-token"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "身份核验已失效，请重新核验"


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
                }
            }

    class FakeClient:
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
    assert response.json() == {"fields": {"phone": "13800138000"}}
    assert response.headers["X-Octop-Access-Token"] == "renewed-platform-token"
    assert captured["url"].endswith("/api/admission-demo/extract")
    assert captured["authorization"] == "Bearer platform-token"
    assert captured["text"] == "联系电话13800138000"
    assert captured["page"] == 1


def test_ai_proxy_scopes_candidates_to_the_requested_page(monkeypatch) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {"relationship": "子女", "address": "北京市朝阳区"}}

    class FakeClient:
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
    assert response.json() == {"fields": {"relationship": "子女"}}


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

    class FakeClient:
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
        }
    }


def test_ai_proxy_maps_regions_that_were_missing_from_the_old_sample_tree(monkeypatch) -> None:
    token = _seed_identity()

    class FakeResponse:
        headers: dict = {}

        def raise_for_status(self):
            return None

        def json(self):
            return {"fields": {"resident_region": "上海市浦东新区", "address": "世纪大道100号"}}

    class FakeClient:
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
        }
    }


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

    class FakeClient:
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
        }
    }
