from __future__ import annotations

import threading
from pathlib import Path

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.email_verification import EmailVerificationRepo


def _repo(tmp_path: Path) -> tuple[SqlitePool, EmailVerificationRepo]:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    return db, EmailVerificationRepo(db)


def test_reserve_cooldown_and_single_use(tmp_path: Path) -> None:
    _db, repo = _repo(tmp_path)
    assert repo.reserve("a@example.com", "digest", 100, 700, 60)
    assert not repo.reserve("a@example.com", "new", 159, 759, 60)
    assert repo.mark_sent("a@example.com", "digest", 101)
    assert not repo.mark_sent("a@example.com", "digest", 102)
    assert repo.consume("a@example.com", "digest", 102, 5)
    assert not repo.consume("a@example.com", "digest", 102, 5)


def test_wrong_attempts_exhaust_code(tmp_path: Path) -> None:
    _db, repo = _repo(tmp_path)
    assert repo.reserve("a@example.com", "digest", 100, 700, 60)
    assert repo.mark_sent("a@example.com", "digest", 100)
    for _ in range(5):
        assert not repo.consume("a@example.com", "wrong", 101, 5)
    assert not repo.consume("a@example.com", "digest", 101, 5)


def test_concurrent_consume_succeeds_once(tmp_path: Path) -> None:
    _db, repo = _repo(tmp_path)
    assert repo.reserve("a@example.com", "digest", 100, 700, 60)
    assert repo.mark_sent("a@example.com", "digest", 100)
    barrier = threading.Barrier(2)
    results: list[bool] = []

    def consume() -> None:
        barrier.wait()
        results.append(repo.consume("a@example.com", "digest", 101, 5))

    workers = [threading.Thread(target=consume) for _ in range(2)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()
    assert sorted(results) == [False, True]


def test_migration_repairs_missing_verification_table(tmp_path: Path) -> None:
    db, _ = _repo(tmp_path)
    with db.connect() as conn:
        conn.execute("DROP TABLE email_verification_codes")
    run_migrations(db)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            ("email_verification_codes",),
        ).fetchone()
    assert row is not None
