-- Schema v24: conversation file identities, immutable revisions, segments, and tasks.

CREATE TABLE IF NOT EXISTS chat_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    thread_id TEXT REFERENCES threads(thread_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    current_revision_id TEXT REFERENCES chat_file_revisions(revision_id) ON DELETE SET NULL,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(file_id, user_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_files_thread ON chat_files(user_id, agent_id, thread_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_file_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id TEXT NOT NULL UNIQUE,
    file_id TEXT NOT NULL REFERENCES chat_files(file_id) ON DELETE CASCADE,
    parent_revision_id TEXT REFERENCES chat_file_revisions(revision_id),
    workspace_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    origin_kind TEXT NOT NULL,
    source_refs_json TEXT NOT NULL DEFAULT '[]',
    parse_version INTEGER,
    read_status TEXT NOT NULL DEFAULT 'stored',
    coverage_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    UNIQUE(file_id, revision_id),
    UNIQUE(workspace_path)
);
CREATE INDEX IF NOT EXISTS idx_chat_file_revisions_file ON chat_file_revisions(file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_file_revisions_parent ON chat_file_revisions(parent_revision_id);

CREATE TABLE IF NOT EXISTS chat_file_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id TEXT NOT NULL REFERENCES chat_file_revisions(revision_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    locator_json TEXT NOT NULL,
    text TEXT NOT NULL,
    char_count INTEGER NOT NULL CHECK (char_count >= 0),
    UNIQUE(revision_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_chat_file_segments_revision ON chat_file_segments(revision_id, ordinal);

CREATE TABLE IF NOT EXISTS chat_file_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
    file_id TEXT REFERENCES chat_files(file_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    input_revision_id TEXT REFERENCES chat_file_revisions(revision_id),
    output_revision_id TEXT REFERENCES chat_file_revisions(revision_id),
    status TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
    lease_until INTEGER,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    request_spec_json TEXT NOT NULL,
    progress_json TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, thread_id, kind, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_chat_file_tasks_queue ON chat_file_tasks(status, lease_until, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_file_tasks_user ON chat_file_tasks(user_id, status, created_at);

CREATE TRIGGER IF NOT EXISTS chat_files_current_revision_insert
BEFORE INSERT ON chat_files WHEN NEW.current_revision_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM chat_file_revisions r
        WHERE r.revision_id = NEW.current_revision_id AND r.file_id = NEW.file_id
    ) THEN RAISE(ABORT, 'current revision must belong to file') END;
END;

CREATE TRIGGER IF NOT EXISTS chat_files_current_revision_update
BEFORE UPDATE OF current_revision_id ON chat_files WHEN NEW.current_revision_id IS NOT NULL
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM chat_file_revisions r
        WHERE r.revision_id = NEW.current_revision_id AND r.file_id = NEW.file_id
    ) THEN RAISE(ABORT, 'current revision must belong to file') END;
END;

UPDATE _schema_version SET version = 24;
