CREATE TABLE creation_card_meta_new (
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_type TEXT NOT NULL CHECK (card_type IN ('agent', 'app')),
    card_id TEXT NOT NULL,
    name TEXT,
    description TEXT,
    updated_at INTEGER NOT NULL,
    category TEXT CHECK (category IS NULL OR category IN ('platform', 'applet', 'service', 'repository')),
    PRIMARY KEY (owner_user_id, card_type, card_id)
);

INSERT INTO creation_card_meta_new
    (owner_user_id, card_type, card_id, name, description, updated_at, category)
SELECT owner_user_id, card_type, card_id, name, description, updated_at, category
FROM creation_card_meta;

DROP TABLE creation_card_meta;
ALTER TABLE creation_card_meta_new RENAME TO creation_card_meta;

CREATE TABLE IF NOT EXISTS email_verification_codes (
    email TEXT PRIMARY KEY,
    code_digest TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires
    ON email_verification_codes(expires_at);

CREATE TABLE IF NOT EXISTS admission_registration_sessions (
    session_id TEXT PRIMARY KEY,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_ref TEXT NOT NULL,
    application_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('identity', 'applications', 'form', 'review', 'completed')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
    summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
    pending_proposal_json TEXT CHECK (pending_proposal_json IS NULL OR json_valid(pending_proposal_json)),
    last_turn_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admission_registration_sessions_owner_expiry
    ON admission_registration_sessions(owner_user_id, expires_at);

CREATE TABLE IF NOT EXISTS admission_registration_turns (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES admission_registration_sessions(session_id) ON DELETE CASCADE,
    previous_turn_id TEXT,
    speaker TEXT NOT NULL CHECK (speaker IN ('patient', 'assistant', 'system')),
    utterance TEXT NOT NULL CHECK (length(utterance) <= 2000),
    response TEXT NOT NULL CHECK (length(response) <= 4000),
    action TEXT NOT NULL,
    fields_json TEXT NOT NULL CHECK (json_valid(fields_json)),
    status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'interrupted')),
    created_at INTEGER NOT NULL,
    UNIQUE (session_id, turn_id)
);
CREATE INDEX IF NOT EXISTS idx_admission_registration_turns_session_created
    ON admission_registration_turns(session_id, created_at);

UPDATE _schema_version SET version = 26;
