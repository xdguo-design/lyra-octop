ALTER TABLE threads ADD COLUMN IF NOT EXISTS acp_runner TEXT;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS acp_model TEXT;

UPDATE _schema_version SET version = 28;
