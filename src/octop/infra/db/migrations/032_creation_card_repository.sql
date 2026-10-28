ALTER TABLE creation_card_meta ADD COLUMN repository_url TEXT;
ALTER TABLE creation_card_meta ADD COLUMN repository_branch TEXT;
ALTER TABLE runs ADD COLUMN lease_owner TEXT;
ALTER TABLE runs ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE runs ADD COLUMN max_runtime_seconds INTEGER NOT NULL DEFAULT 3600;
ALTER TABLE runs ADD COLUMN run_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN agent_version_id TEXT;
ALTER TABLE runs ADD COLUMN capability_scopes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE runs ADD COLUMN thread_id TEXT;

CREATE TABLE IF NOT EXISTS team_dispatch_payloads (
    inbox_id TEXT PRIMARY KEY,
    step_id TEXT NOT NULL UNIQUE REFERENCES run_steps(step_id) ON DELETE CASCADE,
    payload_blob BLOB NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hitl_approvals (
    pending_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
    session_key TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    resume_agent_id TEXT,
    resume_thread_id TEXT,
    run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    step_id TEXT REFERENCES run_steps(step_id) ON DELETE SET NULL,
    request_blob BLOB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_versions (
    version_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    content_hash TEXT NOT NULL,
    snapshot_blob BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(agent_id, content_hash)
);

CREATE TABLE IF NOT EXISTS agent_version_aliases (
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    version_id TEXT NOT NULL REFERENCES agent_versions(version_id) ON DELETE CASCADE,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(agent_id, alias)
);

CREATE TABLE IF NOT EXISTS app_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    adapter_kind TEXT NOT NULL CHECK (adapter_kind = 'mock'),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(owner_user_id, app_key)
);

CREATE TABLE IF NOT EXISTS capability_grants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grant_id TEXT NOT NULL UNIQUE,
    registration_id TEXT NOT NULL REFERENCES app_registrations(registration_id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    read_scopes_json TEXT NOT NULL DEFAULT '[]',
    write_scopes_json TEXT NOT NULL DEFAULT '[]',
    expires_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(registration_id, owner_user_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_hitl_approvals_thread_pending
    ON hitl_approvals(user_id, agent_id, thread_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_hitl_approvals_session_pending
    ON hitl_approvals(user_id, session_key, agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_created
    ON agent_versions(agent_id, created_at DESC, version_id DESC);
CREATE INDEX IF NOT EXISTS idx_capability_grants_owner_agent
    ON capability_grants(owner_user_id, agent_id, registration_id);

CREATE TABLE IF NOT EXISTS run_effects (
    effect_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    step_id TEXT REFERENCES run_steps(step_id) ON DELETE SET NULL,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL REFERENCES app_registrations(registration_id),
    approval_id TEXT NOT NULL,
    approved_by_user_id INTEGER NOT NULL REFERENCES users(id),
    approval_expires_at INTEGER NOT NULL,
    scope TEXT NOT NULL,
    resource_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_hash TEXT,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested', 'succeeded', 'failed', 'unknown')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(registration_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_run_effects_run_created
    ON run_effects(run_id, created_at, effect_id);

CREATE TABLE IF NOT EXISTS run_artifacts (
    artifact_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    file_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, revision_id),
    FOREIGN KEY (file_id, revision_id)
        REFERENCES chat_file_revisions(file_id, revision_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_artifacts_run_created
    ON run_artifacts(run_id, created_at, artifact_id);

UPDATE _schema_version SET version = 32;
