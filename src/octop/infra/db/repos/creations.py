"""Account-owned creation folders, platform plans, and deployed links."""

from __future__ import annotations

from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.utils.ulid import new_short_id


class CreationRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list_folders(self, owner_user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT folder_id, name, created_at, updated_at "
                "FROM creation_folders WHERE owner_user_id = ? ORDER BY name, created_at",
                (owner_user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_folder(self, *, owner_user_id: int, name: str) -> dict[str, Any]:
        folder_id = new_short_id()
        ts = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO creation_folders(folder_id, owner_user_id, name, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (folder_id, owner_user_id, name, ts, ts),
            )
        return {"folder_id": folder_id, "name": name, "created_at": ts, "updated_at": ts}

    def rename_folder(self, *, owner_user_id: int, folder_id: str, name: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "UPDATE creation_folders SET name = ?, updated_at = ? "
                "WHERE owner_user_id = ? AND folder_id = ?",
                (name, now_ts(), owner_user_id, folder_id),
            )
        return bool(cur.rowcount > 0)

    def delete_folder(self, *, owner_user_id: int, folder_id: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "DELETE FROM creation_folders WHERE owner_user_id = ? AND folder_id = ?",
                (owner_user_id, folder_id),
            )
        return bool(cur.rowcount > 0)

    def list_items(self, owner_user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT item_id, kind, name, description, url, folder_id, created_at, updated_at "
                "FROM creation_items WHERE owner_user_id = ? ORDER BY updated_at DESC, created_at DESC",
                (owner_user_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_item(
        self,
        *,
        owner_user_id: int,
        kind: str,
        name: str,
        description: str,
        url: str | None,
        folder_id: str | None,
    ) -> dict[str, Any] | None:
        item_id = new_short_id()
        ts = now_ts()
        with self._db.transaction() as conn:
            if folder_id and not self._owns_folder(conn, owner_user_id, folder_id):
                return None
            conn.execute(
                "INSERT INTO creation_items(item_id, owner_user_id, kind, name, description, url, "
                "folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item_id, owner_user_id, kind, name, description, url, folder_id, ts, ts),
            )
        return {
            "item_id": item_id,
            "kind": kind,
            "name": name,
            "description": description,
            "url": url,
            "folder_id": folder_id,
            "created_at": ts,
            "updated_at": ts,
        }

    def update_item(
        self,
        *,
        owner_user_id: int,
        item_id: str,
        values: dict[str, Any],
    ) -> bool:
        with self._db.transaction() as conn:
            if (
                "folder_id" in values
                and values["folder_id"]
                and not self._owns_folder(conn, owner_user_id, values["folder_id"])
            ):
                return False
            assignments = [f"{key} = ?" for key in values]
            params = [*values.values(), now_ts(), owner_user_id, item_id]
            cur = conn.execute(
                "UPDATE creation_items SET "
                + ", ".join(assignments)
                + ", updated_at = ? WHERE owner_user_id = ? AND item_id = ?",
                params,
            )
        return bool(cur.rowcount > 0)

    def delete_item(self, *, owner_user_id: int, item_id: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "DELETE FROM creation_items WHERE owner_user_id = ? AND item_id = ?",
                (owner_user_id, item_id),
            )
        return bool(cur.rowcount > 0)

    def list_card_folders(self, owner_user_id: int) -> dict[str, str]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT card_type, card_id, folder_id FROM creation_card_folders "
                "WHERE owner_user_id = ?",
                (owner_user_id,),
            ).fetchall()
        return {f"{row['card_type']}:{row['card_id']}": str(row["folder_id"]) for row in rows}

    def list_card_meta(self, owner_user_id: int) -> dict[str, dict[str, str | None]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT card_type, card_id, name, description, category FROM creation_card_meta "
                "WHERE owner_user_id = ?",
                (owner_user_id,),
            ).fetchall()
        return {
            f"{row['card_type']}:{row['card_id']}": {
                "name": row["name"],
                "description": row["description"],
                "category": row["category"],
            }
            for row in rows
        }

    def set_card_meta(
        self,
        *,
        owner_user_id: int,
        card_type: str,
        card_id: str,
        name: str | None,
        description: str | None,
        category: str | None,
    ) -> bool:
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO creation_card_meta(owner_user_id, card_type, card_id, name, description, category, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_user_id, card_type, card_id) "
                "DO UPDATE SET name = excluded.name, description = excluded.description, "
                "category = COALESCE(excluded.category, creation_card_meta.category), "
                "updated_at = excluded.updated_at",
                (owner_user_id, card_type, card_id, name, description, category, now_ts()),
            )
        return True

    def set_card_folder(
        self,
        *,
        owner_user_id: int,
        card_type: str,
        card_id: str,
        folder_id: str | None,
    ) -> bool:
        with self._db.transaction() as conn:
            if folder_id and not self._owns_folder(conn, owner_user_id, folder_id):
                return False
            if folder_id is None:
                conn.execute(
                    "DELETE FROM creation_card_folders WHERE owner_user_id = ? "
                    "AND card_type = ? AND card_id = ?",
                    (owner_user_id, card_type, card_id),
                )
                return True
            conn.execute(
                "INSERT INTO creation_card_folders(owner_user_id, card_type, card_id, folder_id) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(owner_user_id, card_type, card_id) "
                "DO UPDATE SET folder_id = excluded.folder_id",
                (owner_user_id, card_type, card_id, folder_id),
            )
        return True

    @staticmethod
    def _owns_folder(conn: Any, owner_user_id: int, folder_id: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM creation_folders WHERE owner_user_id = ? AND folder_id = ?",
            (owner_user_id, folder_id),
        ).fetchone()
        return row is not None
