from __future__ import annotations

import json
from itertools import count

import pytest
from fastapi.testclient import TestClient

from administrative_regions.main import app
from administrative_regions.service import RegionService, normalize_tree

TOKEN = "r" * 48


def _upstream_tree() -> list[dict[str, object]]:
    ids = count(1)
    provinces = []
    for province in range(30):
        province_code = f"{next(ids):06d}000000"
        city_code = f"{next(ids):06d}000000"
        districts = [
            {"code": f"{next(ids):06d}000000", "name": f"区县{province}-{index}", "children": []}
            for index in range(99)
        ]
        provinces.append(
            {
                "code": province_code,
                "name": f"省份{province}",
                "children": [{"code": city_code, "name": f"城市{province}", "children": districts}],
            }
        )
    return provinces


def _official_payload() -> dict[str, object]:
    provinces = _upstream_tree()
    provinces[0] = {
        "code": "210000000000",
        "name": "辽宁省",
        "children": [
            {
                "code": "210100000000",
                "name": "沈阳市",
                "children": [
                    {"code": "210104000000", "name": "大东区", "children": []},
                    {"code": "210103000000", "name": "沈河区", "children": []},
                ],
            },
            {
                "code": "211300000000",
                "name": "朝阳市",
                "children": [{"code": "211321000000", "name": "朝阳县", "children": []}],
            },
            *provinces[0]["children"][0]["children"][2:],
        ],
    }
    provinces[1] = {
        "code": "110000000000",
        "name": "北京市",
        "children": [
            {
                "code": "110100000000",
                "name": "北京市",
                "children": [
                    {"code": "110105000000", "name": "朝阳区", "children": []},
                    *provinces[1]["children"][0]["children"],
                ],
            }
        ],
    }
    provinces.append({"code": "资料暂缺", "name": "台湾省", "children": None})
    return {"status": 200, "data": {"code": "00", "children": provinces}}


def test_normalize_checks_complete_tree_and_resolves_abbreviated_path() -> None:
    tree = normalize_tree(_official_payload())
    service = RegionService.__new__(RegionService)
    service.regions = tree
    assert tree[0]["code"] == "210000"
    assert service.resolve("我在辽宁省沈阳市大东") == {
        "codes": ["210000", "210100", "210104"],
        "labels": ["辽宁省", "沈阳市", "大东区"],
        "path": "辽宁省沈阳市大东区",
        "start": 2,
        "end": 10,
    }
    spaced = service.resolve("我在 辽宁省 沈阳市 大东")
    assert spaced is not None
    assert "我在 辽宁省 沈阳市 大东"[spaced["start"] : spaced["end"]] == "辽宁省 沈阳市 大东"
    assert service.resolve("和平") is None


def test_resolve_returns_candidate_paths_for_ambiguous_names() -> None:
    service = RegionService.__new__(RegionService)
    service.regions = normalize_tree(_official_payload())

    assert service.resolve("北京市朝阳区")["path"] == "北京市朝阳区"

    result = service.resolve("朝阳")

    assert result is not None
    assert result["ambiguous"] is True
    assert result["candidate_count"] == 3
    assert result["truncated"] is False
    assert {candidate["path"] for candidate in result["candidates"]} == {
        "北京市朝阳区",
        "辽宁省朝阳市",
        "辽宁省朝阳市朝阳县",
    }


def test_resolve_caps_ambiguous_candidate_list() -> None:
    service = RegionService.__new__(RegionService)
    service.regions = [
        {
            "code": "100000",
            "label": "Province",
            "children": [
                {
                    "code": f"100{index:03}",
                    "label": f"City {index}",
                    "children": [{"code": f"200{index:03}", "label": "Spring District"}],
                }
                for index in range(12)
            ],
        }
    ]

    result = service.resolve("Spring")

    assert result is not None
    assert result["ambiguous"] is True
    assert result["candidate_count"] == 12
    assert len(result["candidates"]) == 10
    assert result["truncated"] is True


def test_invalid_cache_is_ignored(tmp_path) -> None:
    cache_path = tmp_path / "regions.json"
    cache_path.write_text(
        json.dumps({"synced_at": "2026-01-01", "regions": [{"code": "210000", "label": "辽宁省"}]}),
        encoding="utf-8",
    )
    service = RegionService(tmp_path)
    assert service.regions == []
    assert service.last_error is not None


def test_valid_cache_loads_after_restart(tmp_path) -> None:
    initial = RegionService(tmp_path)
    tree = normalize_tree(_official_payload())
    initial._write_atomic(tree, "2026-01-01T00:00:00+00:00")
    restored = RegionService(tmp_path)
    assert restored.regions == tree
    assert restored.synced_at == "2026-01-01T00:00:00+00:00"


def test_normalize_rejects_bad_tree_and_does_not_guess_missing_codes() -> None:
    with pytest.raises(ValueError, match="重复"):
        normalize_tree(
            {
                "status": 200,
                "data": {
                    "code": "00",
                    "children": [
                        {"code": "110000000000", "name": "北京", "children": []},
                        {"code": "110000000000", "name": "重复", "children": []},
                    ],
                },
            }
        )
    with pytest.raises(ValueError, match="不完整"):
        normalize_tree(
            {
                "status": 200,
                "data": {
                    "code": "00",
                    "children": [
                        {"code": "110000000000", "name": "北京", "children": []},
                    ],
                },
            }
        )


@pytest.mark.asyncio
async def test_failed_sync_keeps_existing_cache(tmp_path, monkeypatch) -> None:
    service = RegionService(tmp_path)
    service.regions = normalize_tree(_official_payload())
    service.synced_at = "2026-01-01T00:00:00+00:00"
    monkeypatch.setattr(
        service, "_download", lambda: (_ for _ in ()).throw(ValueError("bad upstream"))
    )
    with pytest.raises(ValueError, match="bad upstream"):
        await service.sync()
    assert service.synced_at == "2026-01-01T00:00:00+00:00"
    assert not service.cache_path.exists()


def test_admin_api_mcp_auth_and_manual_sync(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("ADMIN_TOKEN", TOKEN)
    monkeypatch.setenv("REGIONS_DATA_DIR", str(tmp_path))

    async def fake_sync(self):
        self.regions = [{"code": "210000", "label": "辽宁省"}]
        self.synced_at = "2026-01-01T00:00:00+00:00"
        return self.status()

    monkeypatch.setattr(RegionService, "sync", fake_sync)
    with TestClient(app) as client:
        assert client.get("/api/status").status_code == 401
        assert (
            client.post("/api/sync", headers={"Authorization": f"Bearer {TOKEN}"}).status_code
            == 200
        )
        assert client.get("/api/regions").json()["items"][0]["code"] == "210000"
        listed = client.post(
            "/mcp",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        assert {item["name"] for item in listed.json()["result"]["tools"]} == {
            "regions_list",
            "regions_resolve",
            "regions_status",
            "regions_sync",
        }
        resolved = client.post(
            "/mcp",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "regions_status", "arguments": {}},
            },
        )
        assert resolved.status_code == 200
        assert "syncedAt" in json.loads(resolved.json()["result"]["content"][0]["text"])
        client.app.state.regions.regions = normalize_tree(_official_payload())
        ambiguous = client.post(
            "/mcp",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "regions_resolve",
                    "arguments": {"text": "朝阳"},
                },
            },
        )
        candidates = json.loads(ambiguous.json()["result"]["content"][0]["text"])
        assert candidates["ambiguous"] is True
        assert {item["path"] for item in candidates["candidates"]} >= {
            "北京市朝阳区",
            "辽宁省朝阳市",
        }
