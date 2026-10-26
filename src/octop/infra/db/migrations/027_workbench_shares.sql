CREATE TABLE IF NOT EXISTS workbench_project_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES workbench_projects(project_id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workbench_project_shares_owner_project
    ON workbench_project_shares(owner_user_id, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workbench_project_knowledge_bases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES workbench_projects(project_id) ON DELETE CASCADE,
    knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(knowledge_base_id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    UNIQUE(project_id, knowledge_base_id)
);

CREATE INDEX IF NOT EXISTS idx_workbench_project_knowledge_bases_owner
    ON workbench_project_knowledge_bases(owner_user_id, project_id);

ALTER TABLE audit_log ADD COLUMN project_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_project_ts ON audit_log(project_id, ts);

UPDATE _schema_version SET version = 27;
