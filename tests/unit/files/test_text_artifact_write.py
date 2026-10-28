from __future__ import annotations

import pytest

from octop.api.routers.files import _validate_text_artifact
from octop.infra.errors import ErrorCode, OctopError


@pytest.mark.parametrize(
    ("filename", "expected_type"),
    [
        ("note.txt", "text/plain"),
        ("note.md", "text/markdown"),
        ("table.csv", "text/csv"),
    ],
)
def test_text_artifact_accepts_only_supported_text_extensions(
    filename: str, expected_type: str
) -> None:
    assert _validate_text_artifact(filename, "héllo", max_bytes=20) == (
        expected_type,
        "héllo".encode(),
    )


@pytest.mark.parametrize(
    ("filename", "content", "max_bytes", "expected_code"),
    [
        ("program.py", "print(1)", 100, ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE),
        ("note.txt", "nul\x00byte", 100, ErrorCode.ATTACHMENT_UNSUPPORTED_TYPE),
        ("note.txt", "long", 3, ErrorCode.ATTACHMENT_TOO_LARGE),
    ],
)
def test_text_artifact_rejects_unsafe_or_oversized_input(
    filename: str, content: str, max_bytes: int, expected_code: ErrorCode
) -> None:
    with pytest.raises(OctopError) as error:
        _validate_text_artifact(filename, content, max_bytes=max_bytes)

    assert error.value.code == expected_code
