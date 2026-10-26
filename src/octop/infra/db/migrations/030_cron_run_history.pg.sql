CREATE TABLE IF NOT EXISTS cron_runs (
    run_id TEXT PRIMARY KEY,
    cron_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    user_id BIGINT NOT NULL,
    instance_id TEXT NOT NULL DEFAULT 'legacy',
    trigger_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS cron_instances (
    instance_id TEXT PRIMARY KEY,
    heartbeat_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_owner_history
    ON cron_runs(user_id, agent_id, cron_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_active ON cron_runs(status, started_at);

UPDATE _schema_version SET version = 30;
