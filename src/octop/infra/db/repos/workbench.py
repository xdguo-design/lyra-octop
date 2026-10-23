"""Account-owned workbench projects, folders, and thread assignments."""

from __future__ import annotations

from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.utils.ulid import new_short_id


class WorkbenchRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list_index(self, owner_user_id: int) -> dict[str, list[dict[str, Any]]]:
        with self._db.connect() as conn:
            projects = conn.execute(
                "SELECT project_id, name, icon, parent_id, external_url, code_enabled, created_at, updated_at "
                "FROM workbench_projects WHERE owner_user_id = ? ORDER BY created_at, project_id",
                (owner_user_id,),
            ).fetchall()
            folders = conn.execute(
                "SELECT folder_id, project_id, name, created_at, updated_at "
                "FROM workbench_folders WHERE owner_user_id = ? AND deleted_at IS NULL "
                "ORDER BY created_at, folder_id",
                (owner_user_id,),
            ).fetchall()
            recycled_folders = conn.execute(
                "SELECT folder_id, project_id, name, created_at, updated_at "
                "FROM workbench_folders WHERE owner_user_id = ? AND deleted_at IS NOT NULL "
                "ORDER BY deleted_at DESC, folder_id",
                (owner_user_id,),
            ).fetchall()
            assignments = conn.execute(
                "SELECT thread_id, project_id, folder_id FROM workbench_thread_assignments "
                "WHERE owner_user_id = ?",
                (owner_user_id,),
            ).fetchall()
            knowledge_bases = conn.execute(
                "SELECT project_id, knowledge_base_id FROM workbench_project_knowledge_bases "
                "WHERE owner_user_id = ? ORDER BY project_id, knowledge_base_id",
                (owner_user_id,),
            ).fetchall()
        knowledge_by_project: dict[str, list[str]] = {}
        for row in knowledge_bases:
            knowledge_by_project.setdefault(str(row["project_id"]), []).append(
                str(row["knowledge_base_id"])
            )
        project_rows = [
            {
                **dict(row),
                "knowledge_base_ids": knowledge_by_project.get(str(row["project_id"]), []),
            }
            for row in projects
        ]
        return {
            "projects": project_rows,
            "folders": [dict(row) for row in folders],
            "recycled_folders": [dict(row) for row in recycled_folders],
            "assignments": [dict(row) for row in assignments],
        }

    def create_project(
        self,
        *,
        owner_user_id: int,
        name: str,
        icon: str,
        parent_id: str | None = None,
        external_url: str | None = None,
    ) -> dict[str, Any] | None:
        project_id = new_short_id()
        ts = now_ts()
        with self._db.transaction() as conn:
            if parent_id is not None and not self._owns_project(conn, owner_user_id, parent_id):
                return None
            conn.execute(
                "INSERT INTO workbench_projects(project_id, owner_user_id, name, icon, parent_id, external_url, code_enabled, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    project_id,
                    owner_user_id,
                    name,
                    icon,
                    parent_id,
                    external_url,
                    int(name == "星球"),
                    ts,
                    ts,
                ),
            )
        return {
            "project_id": project_id,
            "name": name,
            "icon": icon,
            "parent_id": parent_id,
            "external_url": external_url,
            "code_enabled": name == "星球",
            "created_at": ts,
            "updated_at": ts,
        }

    def find_project_by_external_url(
        self, *, owner_user_id: int, external_url: str
    ) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT project_id, name, icon, parent_id, external_url, code_enabled, created_at, updated_at "
                "FROM workbench_projects WHERE owner_user_id = ? AND external_url = ?",
                (owner_user_id, external_url),
            ).fetchone()
        return dict(row) if row is not None else None

    def import_legacy_projects(self, *, owner_user_id: int, projects: list[dict[str, Any]]) -> None:
        """Import the former browser-local project list once per account."""
        with self._db.transaction() as conn:
            imported = conn.execute(
                "SELECT 1 FROM workbench_project_imports WHERE owner_user_id = ?",
                (owner_user_id,),
            ).fetchone()
            if imported is not None:
                return
            has_remote_projects = conn.execute(
                "SELECT 1 FROM workbench_projects WHERE owner_user_id = ? LIMIT 1",
                (owner_user_id,),
            ).fetchone()
            if has_remote_projects is None:
                for legacy in projects:
                    project_id = new_short_id()
                    ts = now_ts()
                    conn.execute(
                        "INSERT INTO workbench_projects(project_id, owner_user_id, name, icon, code_enabled, created_at, updated_at) "
                        "VALUES (?, ?, ?, '📁', ?, ?, ?)",
                        (
                            project_id,
                            owner_user_id,
                            legacy["name"],
                            int(legacy["name"] == "星球"),
                            ts,
                            ts,
                        ),
                    )
                    for thread_id in legacy["thread_ids"]:
                        thread = conn.execute(
                            "SELECT 1 FROM threads WHERE thread_id = ? AND user_id = ?",
                            (thread_id, owner_user_id),
                        ).fetchone()
                        if thread is not None:
                            conn.execute(
                                "INSERT INTO workbench_thread_assignments "
                                "(thread_id, owner_user_id, project_id, folder_id, updated_at) "
                                "VALUES (?, ?, ?, NULL, ?) ON CONFLICT(thread_id) DO NOTHING",
                                (thread_id, owner_user_id, project_id, ts),
                            )
            conn.execute(
                "INSERT INTO workbench_project_imports(owner_user_id, imported_at) VALUES (?, ?)",
                (owner_user_id, now_ts()),
            )

    def update_project(
        self,
        *,
        owner_user_id: int,
        project_id: str,
        name: str,
        icon: str,
        parent_id: str | None = None,
        parent_id_set: bool = False,
    ) -> bool:
        with self._db.transaction() as conn:
            if parent_id_set:
                if parent_id is not None and not self._owns_project(conn, owner_user_id, parent_id):
                    return False
                cur = conn.execute(
                    "UPDATE workbench_projects SET name = ?, icon = ?, parent_id = ?, updated_at = ? "
                    "WHERE owner_user_id = ? AND project_id = ?",
                    (name, icon, parent_id, now_ts(), owner_user_id, project_id),
                )
            else:
                cur = conn.execute(
                    "UPDATE workbench_projects SET name = ?, icon = ?, updated_at = ? "
                    "WHERE owner_user_id = ? AND project_id = ?",
                    (name, icon, now_ts(), owner_user_id, project_id),
                )
        return bool(cur.rowcount > 0)

    def owns_code_project(self, *, owner_user_id: int, project_id: str) -> bool:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM workbench_projects WHERE owner_user_id = ? "
                "AND project_id = ? AND code_enabled = 1",
                (owner_user_id, project_id),
            ).fetchone()
        return row is not None

    def create_project_share(
        self,
        *,
        owner_user_id: int,
        project_id: str,
        token_hash: str,
        expires_at: int,
    ) -> dict[str, Any] | None:
        share_id = new_short_id()
        created_at = now_ts()
        with self._db.transaction() as conn:
            if not self._owns_project(conn, owner_user_id, project_id):
                return None
            conn.execute(
                "INSERT INTO workbench_project_shares "
                "(share_id, project_id, owner_user_id, token_hash, created_at, expires_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (share_id, project_id, owner_user_id, token_hash, created_at, expires_at),
            )
        return {
            "share_id": share_id,
            "project_id": project_id,
            "created_at": created_at,
            "expires_at": expires_at,
            "revoked_at": None,
        }

    def list_project_shares(self, *, owner_user_id: int, project_id: str) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT share_id, project_id, created_at, expires_at, revoked_at "
                "FROM workbench_project_shares WHERE owner_user_id = ? AND project_id = ? "
                "ORDER BY created_at DESC, share_id",
                (owner_user_id, project_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def revoke_project_share(self, *, owner_user_id: int, project_id: str, share_id: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "UPDATE workbench_project_shares SET revoked_at = ? "
                "WHERE owner_user_id = ? AND project_id = ? AND share_id = ? "
                "AND revoked_at IS NULL",
                (now_ts(), owner_user_id, project_id, share_id),
            )
        return bool(cur.rowcount)

    def get_project_share(self, token_hash: str, *, now: int) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT s.share_id, s.project_id, s.owner_user_id, s.expires_at, "
                "p.name, p.icon, p.parent_id "
                "FROM workbench_project_shares s "
                "JOIN workbench_projects p ON p.project_id = s.project_id "
                "WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?",
                (token_hash, now),
            ).fetchone()
        if row is None:
            return None
        values = dict(row)
        project = {
            "project_id": values["project_id"],
            "name": values["name"],
            "icon": values["icon"],
            "parent_id": values["parent_id"],
        }
        return {
            "share_id": values["share_id"],
            "project_id": values["project_id"],
            "owner_user_id": values["owner_user_id"],
            "expires_at": values["expires_at"],
            "project": project,
        }

    def get_shared_project_data(self, *, owner_user_id: int, project_id: str) -> dict[str, Any]:
        with self._db.connect() as conn:
            projects = conn.execute(
                "WITH RECURSIVE project_tree(project_id, name, icon, parent_id) AS ("
                "SELECT project_id, name, icon, parent_id FROM workbench_projects "
                "WHERE project_id = ? AND owner_user_id = ? "
                "UNION SELECT p.project_id, p.name, p.icon, p.parent_id "
                "FROM workbench_projects p JOIN project_tree t ON p.parent_id = t.project_id "
                "WHERE p.owner_user_id = ?) "
                "SELECT project_id, name, icon, parent_id FROM project_tree",
                (project_id, owner_user_id, owner_user_id),
            ).fetchall()
            project_ids = [str(row["project_id"]) for row in projects]
            if not project_ids:
                return {"projects": [], "folders": [], "threads": []}
            placeholders = ",".join("?" for _ in project_ids)
            folders = conn.execute(
                "SELECT folder_id, project_id, name FROM workbench_folders "
                f"WHERE owner_user_id = ? AND project_id IN ({placeholders}) "
                "ORDER BY created_at, folder_id",
                (owner_user_id, *project_ids),
            ).fetchall()
            threads = conn.execute(
                "SELECT t.thread_id, t.title, a.project_id, a.folder_id "
                "FROM workbench_thread_assignments a JOIN threads t ON t.thread_id = a.thread_id "
                f"WHERE a.owner_user_id = ? AND a.project_id IN ({placeholders}) "
                "ORDER BY t.created_at, t.thread_id",
                (owner_user_id, *project_ids),
            ).fetchall()
        return {
            "projects": [dict(row) for row in projects],
            "folders": [dict(row) for row in folders],
            "threads": [dict(row) for row in threads],
        }

    def set_project_knowledge_bases(
        self, *, owner_user_id: int, project_id: str, knowledge_base_ids: list[str]
    ) -> bool:
        ts = now_ts()
        with self._db.transaction() as conn:
            if not self._owns_project(conn, owner_user_id, project_id):
                return False
            conn.execute(
                "DELETE FROM workbench_project_knowledge_bases "
                "WHERE owner_user_id = ? AND project_id = ?",
                (owner_user_id, project_id),
            )
            for knowledge_base_id in dict.fromkeys(knowledge_base_ids):
                conn.execute(
                    "INSERT INTO workbench_project_knowledge_bases "
                    "(owner_user_id, project_id, knowledge_base_id, created_at) VALUES (?, ?, ?, ?)",
                    (owner_user_id, project_id, knowledge_base_id, ts),
                )
        return True

    def knowledge_base_ids_for_thread(self, *, owner_user_id: int, thread_id: str) -> list[str]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT kb.knowledge_base_id FROM workbench_thread_assignments a "
                "JOIN workbench_project_knowledge_bases kb "
                "ON kb.project_id = a.project_id AND kb.owner_user_id = a.owner_user_id "
                "WHERE a.owner_user_id = ? AND a.thread_id = ? "
                "ORDER BY kb.knowledge_base_id",
                (owner_user_id, thread_id),
            ).fetchall()
        return [str(row["knowledge_base_id"]) for row in rows]

    def delete_project(self, *, owner_user_id: int, project_id: str) -> bool:
        with self._db.transaction() as conn:
            if not self._owns_project(conn, owner_user_id, project_id):
                return False
            # Children move back to the top level when their parent disappears.
            conn.execute(
                "UPDATE workbench_projects SET parent_id = NULL "
                "WHERE owner_user_id = ? AND parent_id = ?",
                (owner_user_id, project_id),
            )
            conn.execute(
                "DELETE FROM workbench_thread_assignments WHERE owner_user_id = ? AND project_id = ?",
                (owner_user_id, project_id),
            )
            conn.execute(
                "DELETE FROM workbench_projects WHERE owner_user_id = ? AND project_id = ?",
                (owner_user_id, project_id),
            )
        return True

    def create_folder(
        self, *, owner_user_id: int, project_id: str, name: str
    ) -> dict[str, Any] | None:
        folder_id = new_short_id()
        ts = now_ts()
        with self._db.transaction() as conn:
            if not self._owns_project(conn, owner_user_id, project_id):
                return None
            conn.execute(
                "INSERT INTO workbench_folders(folder_id, owner_user_id, project_id, name, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (folder_id, owner_user_id, project_id, name, ts, ts),
            )
        return {
            "folder_id": folder_id,
            "project_id": project_id,
            "name": name,
            "created_at": ts,
            "updated_at": ts,
        }

    def update_folder(self, *, owner_user_id: int, folder_id: str, name: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "UPDATE workbench_folders SET name = ?, updated_at = ? "
                "WHERE owner_user_id = ? AND folder_id = ?",
                (name, now_ts(), owner_user_id, folder_id),
            )
        return bool(cur.rowcount > 0)

    def delete_folder(self, *, owner_user_id: int, folder_id: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "UPDATE workbench_folders SET deleted_at = ? "
                "WHERE owner_user_id = ? AND folder_id = ? AND deleted_at IS NULL",
                (now_ts(), owner_user_id, folder_id),
            )
        return bool(cur.rowcount > 0)

    def restore_folder(self, *, owner_user_id: int, folder_id: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "UPDATE workbench_folders SET deleted_at = NULL "
                "WHERE owner_user_id = ? AND folder_id = ? AND deleted_at IS NOT NULL",
                (owner_user_id, folder_id),
            )
        return bool(cur.rowcount > 0)

    def assign_thread(
        self,
        *,
        owner_user_id: int,
        thread_id: str,
        project_id: str | None,
        folder_id: str | None,
    ) -> bool:
        ts = now_ts()
        with self._db.transaction() as conn:
            thread = conn.execute(
                "SELECT 1 FROM threads WHERE thread_id = ? AND user_id = ?",
                (thread_id, owner_user_id),
            ).fetchone()
            if thread is None:
                return False
            if project_id is None:
                if folder_id is not None:
                    return False
                conn.execute(
                    "DELETE FROM workbench_thread_assignments WHERE owner_user_id = ? AND thread_id = ?",
                    (owner_user_id, thread_id),
                )
                return True
            if not self._owns_project(conn, owner_user_id, project_id):
                return False
            if folder_id:
                folder = conn.execute(
                    "SELECT 1 FROM workbench_folders WHERE owner_user_id = ? AND project_id = ? "
                    "AND folder_id = ? AND deleted_at IS NULL",
                    (owner_user_id, project_id, folder_id),
                ).fetchone()
                if folder is None:
                    return False
            conn.execute(
                "INSERT INTO workbench_thread_assignments(thread_id, owner_user_id, project_id, folder_id, updated_at) "
                "VALUES (?, ?, ?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET "
                "owner_user_id = excluded.owner_user_id, project_id = excluded.project_id, "
                "folder_id = excluded.folder_id, updated_at = excluded.updated_at",
                (thread_id, owner_user_id, project_id, folder_id, ts),
            )
        return True

    @staticmethod
    def _owns_project(conn: Any, owner_user_id: int, project_id: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM workbench_projects WHERE owner_user_id = ? AND project_id = ?",
            (owner_user_id, project_id),
        ).fetchone()
        return row is not None
