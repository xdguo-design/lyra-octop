from __future__ import annotations

import sys
from pathlib import Path

import pytest

from octop.infra.files.worker import FileWorkerError, parse_file_in_worker, run_process


def test_parser_worker_returns_bounded_structured_result(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("alpha\nbeta\n", encoding="utf-8")

    result = parse_file_in_worker(path)

    assert [segment.text for segment in result.segments] == ["alpha", "beta"]
    assert result.coverage.complete is True


def test_worker_timeout_kills_and_waits_for_child() -> None:
    with pytest.raises(FileWorkerError, match="timed out"):
        run_process(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            timeout_seconds=0.1,
        )
