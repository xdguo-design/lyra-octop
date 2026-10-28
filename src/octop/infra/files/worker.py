"""Run parsers in a bounded, killable child process."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from octop.infra.files.parse import (
    DEFAULT_PARSE_LIMITS,
    FileParseError,
    FileParseResult,
    FileSegment,
    ParseCoverage,
    ParseLimits,
    UnsupportedFileTypeError,
)

_WORKSPACE_ROOT = Path(__file__).resolve().parents[4]
_WORKER_TIMEOUT_SECONDS = 30
_MAX_WORKER_OUTPUT_BYTES = 4 * 1024 * 1024


class FileWorkerError(RuntimeError):
    """The isolated parser failed, timed out, or returned invalid output."""


def _worker_environment() -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": os.pathsep.join(
            [str(_WORKSPACE_ROOT / "src"), *(path for path in sys.path if path)]
        ),
        "PYTHONIOENCODING": "utf-8",
    }
    for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP"):
        if value := os.environ.get(key):
            env[key] = value
    return env


def run_process(
    command: Sequence[str],
    *,
    timeout_seconds: float,
    input_text: str = "",
) -> str:
    process = subprocess.Popen(
        list(command),
        cwd=_WORKSPACE_ROOT,
        env=_worker_environment(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        shell=False,
    )
    try:
        stdout, _stderr = process.communicate(input_text, timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.communicate()
        raise FileWorkerError("file parser timed out") from exc
    if process.returncode != 0:
        raise FileWorkerError("file parser failed")
    if len(stdout.encode("utf-8")) > _MAX_WORKER_OUTPUT_BYTES:
        raise FileWorkerError("file parser output exceeded limit")
    return stdout


def parse_file_in_worker(
    path: Path,
    *,
    limits: ParseLimits = DEFAULT_PARSE_LIMITS,
    timeout_seconds: float = _WORKER_TIMEOUT_SECONDS,
) -> FileParseResult:
    payload = json.dumps({"path": str(Path(path).resolve()), "limits": limits.__dict__})
    stdout = run_process(
        [sys.executable, "-m", "octop.infra.files.worker"],
        timeout_seconds=timeout_seconds,
        input_text=payload,
    )
    try:
        data = json.loads(stdout)
        if data.get("error") == "unsupported":
            raise UnsupportedFileTypeError("unsupported document format")
        if data.get("error") == "unreadable":
            raise FileParseError("file cannot be read")
        segments = tuple(
            FileSegment(text=str(item["text"]), locator=dict(item["locator"]))
            for item in data["segments"]
        )
        coverage = ParseCoverage(**data["coverage"])
        return FileParseResult(segments=segments, coverage=coverage)
    except FileParseError:
        raise
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise FileWorkerError("file parser returned invalid output") from exc


def main() -> None:
    from octop.infra.files.parse import parse_file

    try:
        payload: dict[str, Any] = json.load(sys.stdin)
        limits = ParseLimits(**payload["limits"])
        result = parse_file(Path(payload["path"]), limits=limits)
        output = {
            "segments": [
                {"text": segment.text, "locator": segment.locator} for segment in result.segments
            ],
            "coverage": {
                "complete": result.coverage.complete,
                "characters": result.coverage.characters,
                "total_units": result.coverage.total_units,
                "processed_units": result.coverage.processed_units,
                "empty_units": result.coverage.empty_units,
                "truncated": result.coverage.truncated,
                "parser_version": result.coverage.parser_version,
                "ocr_needed_units": result.coverage.ocr_needed_units,
            },
        }
        json.dump(output, sys.stdout, ensure_ascii=True, separators=(",", ":"))
    except UnsupportedFileTypeError:
        json.dump({"error": "unsupported"}, sys.stdout)
    except FileParseError:
        json.dump({"error": "unreadable"}, sys.stdout)
    except Exception:
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
