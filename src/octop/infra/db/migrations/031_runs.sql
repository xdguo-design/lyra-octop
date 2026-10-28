CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL,
    project_id TEXT,
    agent_id TEXT NOT NULL,
    parent_run_id TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
    input_ref TEXT,
    project_context_json TEXT,
    source_file_revisions_json TEXT NOT NULL DEFAULT '[]',
    idempotency_key TEXT,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'created', 'queued', 'running', 'waiting_approval', 'succeeded', 'failed',
        'cancel_requested', 'cancelled', 'interrupted', 'unknown_external_effect'
    )),
    version INTEGER NOT NULL DEFAULT 0,
    next_event_sequence INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    UNIQUE(owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_runs_owner_created ON runs(owner_user_id, created_at DESC, run_id DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project_created ON runs(project_id, created_at DESC, run_id DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status_updated ON runs(status, updated_at);

ALTER TABLE workbench_projects ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE workbench_projects ADD COLUMN instructions_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chat_file_revisions ADD COLUMN parse_lease_until INTEGER;

CREATE TABLE IF NOT EXISTS run_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    parent_step_id TEXT REFERENCES run_steps(step_id) ON DELETE SET NULL,
    inbox_id TEXT,
    kind TEXT NOT NULL,
    executor TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'queued', 'running', 'waiting_approval', 'succeeded', 'failed',
        'cancel_requested', 'cancelled', 'interrupted'
    )),
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
    version INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id, created_at, step_id);

CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    step_id TEXT REFERENCES run_steps(step_id) ON DELETE SET NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    UNIQUE(run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_sequence ON run_events(run_id, sequence);

UPDATE _schema_version SET version = 31;
