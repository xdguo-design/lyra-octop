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
                "FROM workbench_folders WHERE owner_user_id = ? ORDER BY created_at, folder_id",
                (owner_user_id,),
            ).fetchall()
            assignments = conn.execute(
                "SELECT thread_id, project_id, folder_id FROM workbench_thread_assignments "
                "WHERE owner_user_id = ?",
                (owner_user_id,),
            ).fetchall()
        return {
            "projects": [dict(row) for row in projects],
            "folders": [dict(row) for row in folders],
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
                "DELETE FROM workbench_folders WHERE owner_user_id = ? AND folder_id = ?",
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
                    "SELECT 1 FROM workbench_folders WHERE owner_user_id = ? AND project_id = ? AND folder_id = ?",
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
