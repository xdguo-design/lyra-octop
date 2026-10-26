"""Integration tests for dashboard chat attachments in agent workspace."""

from __future__ import annotations

import re
from typing import Any


async def test_upload_and_workspace_download(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    files = {"file": ("note.txt", b"hello attachment", "text/plain")}
    r = await client.post(f"/api/agents/{aid}/upload", files=files, headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["path"] == body["workspace_path"]
    assert body["access_url"].startswith(f"/api/agents/{aid}/workspace/download")
    assert body["filename"] == "note.txt"
    assert body["media_type"] == "text/plain"
    assert body["workspace_path"].endswith(".txt")
    assert body["workspace_path"].startswith("inbound/")
    assert re.search(r"inbound/\d{10,}_note\.txt$", body["workspace_path"])
    assert body["file_id"]
    assert body["revision_id"]
    record = srv.services.chat_file_repo.get(body["file_id"])
    assert record is not None
    assert record.current_revision_id == body["revision_id"]
    assert record.user_id > 0
    assert record.agent_id == aid
    assert "legacy_url" not in body

    r2 = await client.get(body["access_url"], headers=auth)
    assert r2.status_code == 200, r2.text
    assert r2.content == b"hello attachment"


async def test_upload_pdf_workspace_path(env_with_agent: Any) -> None:
    client, _srv, auth, aid = env_with_agent
    files = {"file": ("report.pdf", b"%PDF-1.4", "application/pdf")}
    r = await client.post(f"/api/agents/{aid}/upload", files=files, headers=auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["workspace_path"].endswith(".pdf")
    assert body["filename"] == "report.pdf"

    r2 = await client.get(body["access_url"], headers=auth)
    assert r2.status_code == 200, r2.text
    assert r2.content == b"%PDF-1.4"


async def test_uploaded_text_can_be_read_with_source_locations(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    upload = await client.post(
        f"/api/agents/{aid}/upload",
        files={"file": ("note.txt", b"first line\n\nthird line", "text/plain")},
        headers=auth,
    )
    assert upload.status_code == 200, upload.text
    record = srv.services.chat_file_repo.get(upload.json()["file_id"])
    assert record is not None
    thread_id = "file-read-thread"
    srv.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=aid,
        user_id=record.user_id,
        channel_type="dashboard",
        session_key=thread_id,
    )
    assert srv.services.chat_file_repo.bind_thread(
        record.file_id,
        user_id=record.user_id,
        agent_id=aid,
        thread_id=thread_id,
        revision_id=upload.json()["revision_id"],
        workspace_path=upload.json()["workspace_path"],
    )

    read = await client.post(
        f"/api/agents/{aid}/files/{record.file_id}/read",
        headers=auth,
        json={"thread_id": thread_id, "revision_id": upload.json()["revision_id"]},
    )

    assert read.status_code == 200, read.text
    body = read.json()
    assert [segment["text"] for segment in body["segments"]] == ["first line", "third line"]
    assert body["segments"][1]["locator_json"] == '{"kind":"text_line","start":3,"end":3}'
    assert body["coverage"]["complete"] is True

    repeated = await client.post(
        f"/api/agents/{aid}/files/{record.file_id}/read",
        headers=auth,
        json={"thread_id": thread_id, "revision_id": upload.json()["revision_id"]},
    )
    assert repeated.status_code == 200, repeated.text
    assert [item["ordinal"] for item in repeated.json()["segments"]] == [0, 1]

    denied = await client.post(
        f"/api/agents/{aid}/files/{record.file_id}/read",
        headers=auth,
        json={"thread_id": "another-thread", "revision_id": upload.json()["revision_id"]},
    )
    assert denied.status_code == 404


async def test_upload_requires_auth(env: Any) -> None:
    client, _srv, _auth = env
    files = {"file": ("note.txt", b"x", "text/plain")}
    r = await client.post("/api/agents/NOPE/upload", files=files)
    assert r.status_code == 401, r.text
