-- Schema v21: self-service registration with admin approval (users.status).

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

UPDATE _schema_version SET version = 21;