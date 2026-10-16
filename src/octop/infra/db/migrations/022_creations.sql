-- Schema v22: account-owned creations and folders.

CREATE TABLE IF NOT EXISTS creation_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_creation_folders_owner ON creation_folders(owner_user_id, name);

CREATE TABLE IF NOT EXISTS creation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('platform', 'service')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    url TEXT,
    folder_id TEXT REFERENCES creation_folders(folder_id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (kind != 'service' OR url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_creation_items_owner ON creation_items(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_items_folder ON creation_items(folder_id);

CREATE TABLE IF NOT EXISTS creation_card_folders (
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_type TEXT NOT NULL CHECK (card_type IN ('agent', 'app')),
    card_id TEXT NOT NULL,
    folder_id TEXT NOT NULL REFERENCES creation_folders(folder_id) ON DELETE CASCADE,
    PRIMARY KEY (owner_user_id, card_type, card_id)
);

CREATE INDEX IF NOT EXISTS idx_creation_card_folders_folder ON creation_card_folders(folder_id);

CREATE TABLE IF NOT EXISTS workbench_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '📁',
    code_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workbench_projects_owner
    ON workbench_projects(owner_user_id, created_at);

CREATE TABLE IF NOT EXISTS workbench_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES workbench_projects(project_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workbench_folders_project
    ON workbench_folders(owner_user_id, project_id, created_at);

CREATE TABLE IF NOT EXISTS workbench_thread_assignments (
    thread_id TEXT PRIMARY KEY REFERENCES threads(thread_id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES workbench_projects(project_id) ON DELETE SET NULL,
    folder_id TEXT REFERENCES workbench_folders(folder_id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL,
    CHECK (folder_id IS NULL OR project_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_workbench_thread_assignments_owner
    ON workbench_thread_assignments(owner_user_id, project_id, folder_id);

CREATE TABLE IF NOT EXISTS workbench_project_imports (
    owner_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    imported_at INTEGER NOT NULL
);

UPDATE _schema_version SET version = 22;
