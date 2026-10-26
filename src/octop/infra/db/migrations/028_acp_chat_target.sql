ALTER TABLE threads ADD COLUMN acp_runner TEXT;
ALTER TABLE threads ADD COLUMN acp_model TEXT;

UPDATE _schema_version SET version = 28;
