-- Schema v23: "applet" creation kind + per-account built-in card meta.

ALTER TABLE creation_items DROP CONSTRAINT IF EXISTS creation_items_kind_check;
ALTER TABLE creation_items ADD CONSTRAINT creation_items_kind_check
    CHECK (kind IN ('platform', 'service', 'applet'));
ALTER TABLE creation_items DROP CONSTRAINT IF EXISTS creation_items_check;
ALTER TABLE creation_items ADD CONSTRAINT creation_items_check
    CHECK (kind != 'service' OR url IS NOT NULL);

CREATE TABLE IF NOT EXISTS creation_card_meta (
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_type TEXT NOT NULL CHECK (card_type IN ('agent', 'app')),
    card_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_user_id, card_type, card_id)
);

UPDATE _schema_version SET version = 23;
