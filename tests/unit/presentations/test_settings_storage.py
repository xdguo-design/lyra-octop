from __future__ import annotations

from pathlib import Path

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.settings import SettingsRepo


def test_document_cas_and_literal_namespace(tmp_path: Path) -> None:
    pool = SqlitePool(tmp_path / "presentations.db")
    run_migrations(pool)
    repo = SettingsRepo(pool)
    repo.set("presentation/7/a/deck", '{"revision":1}')
    repo.set("presentation/8/a/deck", '{"revision":1}')
    repo.set("literal_%/deck", "first")
    repo.set("literal_other/deck", "other")
    assert repo.list_prefix("presentation/7/") == {"presentation/7/a/deck": '{"revision":1}'}
    assert repo.list_prefix("literal_%/") == {"literal_%/deck": "first"}
    assert repo.compare_and_set("presentation/7/a/deck", '{"revision":1}', '{"revision":2}')
    assert not repo.compare_and_set("presentation/7/a/deck", '{"revision":1}', '{"revision":3}')
    assert repo.get("presentation/7/a/deck") == '{"revision":2}'
