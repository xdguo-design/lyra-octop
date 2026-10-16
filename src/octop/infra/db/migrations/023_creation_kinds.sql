-- Schema v23: "applet" creation kind + per-account built-in card meta.

ALTER TABLE creation_items RENAME TO creation_items_old;

CREATE TABLE creation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('platform', 'service', 'applet')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    url TEXT,
    folder_id TEXT REFERENCES creation_folders(folder_id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK (kind != 'service' OR url IS NOT NULL)
);

INSERT INTO creation_items (id, item_id, owner_user_id, kind, name, description, url, folder_id, created_at, updated_at)
SELECT id, item_id, owner_user_id, kind, name, description, url, folder_id, created_at, updated_at
FROM creation_items_old;

DROP TABLE creation_items_old;

CREATE INDEX IF NOT EXISTS idx_creation_items_owner ON creation_items(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_creation_items_folder ON creation_items(folder_id);

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
