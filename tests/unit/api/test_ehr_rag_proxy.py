from octop.api.deps import is_jwt_exempt_path
from octop.api.routers.ehr_rag import _allowed, public_router, router


def test_ehr_rag_proxy_only_allows_required_routes() -> None:
    assert _allowed("POST", "api/search")
    assert _allowed("GET", "api/graph/subgraph/drug:123")
    assert not _allowed("GET", "api/graph/export")
    assert not _allowed("POST", "api/admin/delete")
    assert not _allowed("DELETE", "api/search")


def test_ehr_rag_proxy_openapi_operations_have_unique_ids() -> None:
    routes = [route for route in router.routes if getattr(route, "operation_id", None)]
    operation_ids = [route.operation_id for route in routes]

    assert len(operation_ids) == len(set(operation_ids))
    assert {"GET", "POST"} == set().union(*(route.methods or set() for route in routes))


def test_public_ehr_surface_is_narrow_and_does_not_require_jwt() -> None:
    paths = {route.path for route in public_router.routes}

    assert paths == {"/health", "/search"}
    assert is_jwt_exempt_path("/api/public/ehr/health")
    assert is_jwt_exempt_path("/api/public/ehr/search")
    assert not is_jwt_exempt_path("/api/ehr-rag/api/search")
