ALTER TABLE workbench_folders ADD COLUMN deleted_at INTEGER;
ALTER TABLE agents ADD COLUMN chat_visible INTEGER NOT NULL DEFAULT 1;

UPDATE _schema_version SET version = 29;
