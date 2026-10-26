"""The one-shot STT endpoint enforces an upload bound before provider calls."""

from __future__ import annotations

from typing import Any


async def test_stt_rejects_audio_larger_than_upload_limit(env: Any) -> None:
    client, _server, auth = env
    response = await client.post(
        "/api/voice/stt",
        headers=auth,
        files={"audio": ("oversized.wav", b"x" * (16 * 1024 * 1024 + 1), "audio/wav")},
    )

    assert response.status_code == 413, response.text
