"""Integration tests for the conversation file read surface (T04)."""

from __future__ import annotations

from typing import Any

from tests.support.auth import create_user


async def _upload_and_bind(
    client: Any,
    srv: Any,
    auth: dict[str, str],
    agent_id: str,
    *,
    filename: str = "note.txt",
    data: bytes = b"alpha beta\n\ngamma beta\n",
    thread_id: str = "files-thread",
) -> dict[str, Any]:
    upload = await client.post(
        f"/api/agents/{agent_id}/upload",
        files={"file": (filename, data, "text/plain")},
        headers=auth,
    )
    assert upload.status_code == 200, upload.text
    body = upload.json()
    record = srv.services.chat_file_repo.get(body["file_id"])
    assert record is not None
    srv.services.thread_repo.insert(
        thread_id=thread_id,
        agent_id=agent_id,
        user_id=record.user_id,
        channel_type="dashboard",
        session_key=thread_id,
    )
    assert srv.services.chat_file_repo.bind_thread(
        record.file_id,
        user_id=record.user_id,
        agent_id=agent_id,
        thread_id=thread_id,
        revision_id=body["revision_id"],
        workspace_path=body["workspace_path"],
    )
    read = await client.post(
        f"/api/agents/{agent_id}/files/{record.file_id}/read",
        headers=auth,
        json={"thread_id": thread_id, "revision_id": body["revision_id"]},
    )
    assert read.status_code == 200, read.text
    return {**body, "file_id": record.file_id, "thread_id": thread_id}


async def test_upload_reports_file_identity_size_and_read_status(
    env_with_agent: Any,
) -> None:
    client, srv, auth, aid = env_with_agent
    body = await _upload_and_bind(client, srv, auth, aid)
    assert body["file_id"]
    assert body["revision_id"]
    assert int(body["size"]) == len(b"alpha beta\n\ngamma beta\n")
    assert body["read_status"] == "stored"


async def test_thread_files_list_and_detail_hide_host_paths(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    body = await _upload_and_bind(client, srv, auth, aid)

    listing = await client.get(f"/api/agents/{aid}/threads/{body['thread_id']}/files", headers=auth)
    assert listing.status_code == 200, listing.text
    assert listing.headers["cache-control"] == "private, no-store"
    rows = listing.json()
    assert [row["file_id"] for row in rows] == [body["file_id"]]
    assert rows[0]["display_name"] == "note.txt"
    assert rows[0]["read_status"] == "ready"
    assert "workspace_path" not in rows[0]

    detail = await client.get(f"/api/agents/{aid}/files/{body['file_id']}", headers=auth)
    assert detail.status_code == 200, detail.text
    payload = detail.json()
    assert payload["current_revision_id"] == body["revision_id"]
    assert payload["coverage"]["complete"] is True
    assert [item["revision_id"] for item in payload["revisions"]] == [body["revision_id"]]
    assert "workspace_path" not in payload
    assert all("workspace_path" not in item for item in payload["revisions"])


async def test_segments_paginate_with_next_offset(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    body = await _upload_and_bind(client, srv, auth, aid)

    first = await client.get(
        f"/api/agents/{aid}/files/{body['file_id']}/segments",
        params={"limit": 1},
        headers=auth,
    )
    assert first.status_code == 200, first.text
    page = first.json()
    assert [item["ordinal"] for item in page["segments"]] == [0]
    assert page["next_offset"] == 1
    assert "workspace_path" not in page["segments"][0]

    second = await client.get(
        f"/api/agents/{aid}/files/{body['file_id']}/segments",
        params={"limit": 1, "offset": 1},
        headers=auth,
    )
    assert second.status_code == 200, second.text
    assert [item["ordinal"] for item in second.json()["segments"]] == [1]
    assert second.json()["next_offset"] is None


async def test_search_returns_bounded_case_insensitive_matches(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    body = await _upload_and_bind(client, srv, auth, aid)

    found = await client.post(
        f"/api/agents/{aid}/files/{body['file_id']}/search",
        headers=auth,
        json={"query": "BETA"},
    )
    assert found.status_code == 200, found.text
    matches = found.json()["matches"]
    assert [item["ordinal"] for item in matches] == [0, 1]
    assert all("workspace_path" not in item for item in matches)

    wildcard = await client.post(
        f"/api/agents/{aid}/files/{body['file_id']}/search",
        headers=auth,
        json={"query": "%"},
    )
    assert wildcard.status_code == 200, wildcard.text
    assert wildcard.json()["matches"] == []


async def test_read_surface_rejects_unbound_draft(env_with_agent: Any) -> None:
    client, _srv, auth, aid = env_with_agent
    upload = await client.post(
        f"/api/agents/{aid}/upload",
        files={"file": ("draft.txt", b"draft body", "text/plain")},
        headers=auth,
    )
    assert upload.status_code == 200, upload.text
    file_id = upload.json()["file_id"]

    # Metadata is the owner's own data and stays available for drafts.
    detail = await client.get(f"/api/agents/{aid}/files/{file_id}", headers=auth)
    assert detail.status_code == 200, detail.text
    assert detail.json()["current_revision_id"] == upload.json()["revision_id"]

    # Derived body content requires the thread binding, like read does.
    for call in (
        client.get(f"/api/agents/{aid}/files/{file_id}/segments", headers=auth),
        client.post(
            f"/api/agents/{aid}/files/{file_id}/search",
            headers=auth,
            json={"query": "draft"},
        ),
    ):
        response = await call
        assert response.status_code == 404, response.text


async def test_workspace_mutations_cannot_change_registered_file_revision(
    env_with_agent: Any,
) -> None:
    client, srv, auth, aid = env_with_agent
    body = await _upload_and_bind(client, srv, auth, aid)
    revision = srv.services.chat_file_repo.get_revision(body["revision_id"])
    assert revision is not None
    path = f"/{revision.workspace_path}"

    overwritten = await client.put(
        f"/api/agents/{aid}/workspace/file",
        params={"path": path, "from_workspace": "true"},
        headers=auth,
        json={"content": "tampered replacement"},
    )
    assert overwritten.status_code == 403, overwritten.text

    deleted = await client.delete(
        f"/api/agents/{aid}/workspace/file",
        params={"path": path, "from_workspace": "true"},
        headers=auth,
    )
    assert deleted.status_code == 403, deleted.text

    moved = await client.post(
        f"/api/agents/{aid}/workspace/move",
        params={"path": path, "from_workspace": "true"},
        headers=auth,
        json={"destination": "/inbound/renamed.txt"},
    )
    assert moved.status_code == 403, moved.text

    read = await client.get(
        f"/api/agents/{aid}/workspace/download",
        params={"path": path, "from_workspace": "true"},
        headers=auth,
    )
    assert read.status_code == 200, read.text
    assert read.content == b"alpha beta\n\ngamma beta\n"


async def test_delete_draft_only_deletes_owned_unbound_files(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    upload = await client.post(
        f"/api/agents/{aid}/upload",
        files={"file": ("draft.txt", b"draft body", "text/plain")},
        headers=auth,
    )
    assert upload.status_code == 200, upload.text
    draft_id = upload.json()["file_id"]
    url = f"/api/agents/{aid}/files/{draft_id}/draft"

    deleted = await client.delete(url, headers=auth)
    assert deleted.status_code == 204
    row = srv.services.chat_file_repo.get(draft_id)
    assert row is not None and row.deleted_at is not None
    assert (await client.delete(url, headers=auth)).status_code == 404
    assert (
        await client.get(f"/api/agents/{aid}/files/{draft_id}", headers=auth)
    ).status_code == 404

    bound = await _upload_and_bind(client, srv, auth, aid, filename="bound.txt")
    bound_delete = await client.delete(
        f"/api/agents/{aid}/files/{bound['file_id']}/draft", headers=auth
    )
    assert bound_delete.status_code == 404
    bound_row = srv.services.chat_file_repo.get(bound["file_id"])
    assert bound_row is not None and bound_row.deleted_at is None

    foreign_upload = await client.post(
        f"/api/agents/{aid}/upload",
        files={"file": ("foreign.txt", b"owned by admin", "text/plain")},
        headers=auth,
    )
    intruder = await create_user(client, auth, username="draft-delete-intruder")
    foreign_url = f"/api/agents/{aid}/files/{foreign_upload.json()['file_id']}/draft"
    foreign_delete = await client.delete(foreign_url, headers=intruder)
    # The agent-level guard may reject this user before file ownership lookup.
    assert foreign_delete.status_code in (403, 404)
    foreign_row = srv.services.chat_file_repo.get(foreign_upload.json()["file_id"])
    assert foreign_row is not None and foreign_row.deleted_at is None


async def test_read_surface_hides_other_users_files(env_with_agent: Any) -> None:
    client, srv, auth, aid = env_with_agent
    body = await _upload_and_bind(client, srv, auth, aid)
    intruder = await create_user(client, auth, username="intruder")

    detail = await client.get(f"/api/agents/{aid}/files/{body['file_id']}", headers=intruder)
    assert detail.status_code in (403, 404)

    segments = await client.get(
        f"/api/agents/{aid}/files/{body['file_id']}/segments", headers=intruder
    )
    assert segments.status_code in (403, 404)

    search = await client.post(
        f"/api/agents/{aid}/files/{body['file_id']}/search",
        headers=intruder,
        json={"query": "beta"},
    )
    assert search.status_code in (403, 404)


async def test_read_surface_requires_login(env_with_agent: Any) -> None:
    client, _srv, _auth, aid = env_with_agent
    response = await client.get(f"/api/agents/{aid}/files/nope")
    assert response.status_code == 401
