ALTER TABLE workbench_folders ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS chat_visible SMALLINT NOT NULL DEFAULT 1;

UPDATE _schema_version SET version = 29;
