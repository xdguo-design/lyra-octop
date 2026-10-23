from __future__ import annotations

from pathlib import Path

import pytest

from octop.infra.creations import capture_trusted_local_thumbnail


@pytest.mark.asyncio
async def test_trusted_thumbnail_rejects_unconfigured_or_non_loopback_targets(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "thumb.jpg"
    destination.write_bytes(b"stale")

    ok = await capture_trusted_local_thumbnail(
        "http://127.0.0.1:8200/",
        ("http://127.0.0.1:8201",),
        destination,
    )

    assert not ok
    assert not destination.exists()
