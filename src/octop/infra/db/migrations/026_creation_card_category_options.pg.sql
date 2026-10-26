ALTER TABLE creation_card_meta
DROP CONSTRAINT IF EXISTS creation_card_meta_category_check;

ALTER TABLE creation_card_meta
ADD CONSTRAINT creation_card_meta_category_check
CHECK (category IS NULL OR category IN ('platform', 'applet', 'service', 'repository'));

CREATE TABLE IF NOT EXISTS email_verification_codes (
    email TEXT PRIMARY KEY,
    code_digest TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires
    ON email_verification_codes(expires_at);

CREATE TABLE IF NOT EXISTS admission_registration_sessions (
    session_id TEXT PRIMARY KEY,
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_ref TEXT NOT NULL,
    application_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK (phase IN ('identity', 'applications', 'form', 'review', 'completed')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    facts_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    pending_proposal_json TEXT,
    last_turn_id TEXT,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admission_registration_sessions_owner_expiry
    ON admission_registration_sessions(owner_user_id, expires_at);

CREATE TABLE IF NOT EXISTS admission_registration_turns (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES admission_registration_sessions(session_id) ON DELETE CASCADE,
    previous_turn_id TEXT,
    speaker TEXT NOT NULL CHECK (speaker IN ('patient', 'assistant', 'system')),
    utterance TEXT NOT NULL CHECK (char_length(utterance) <= 2000),
    response TEXT NOT NULL CHECK (char_length(response) <= 4000),
    action TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'interrupted')),
    created_at BIGINT NOT NULL,
    UNIQUE (session_id, turn_id)
);
CREATE INDEX IF NOT EXISTS idx_admission_registration_turns_session_created
    ON admission_registration_turns(session_id, created_at);

UPDATE _schema_version SET version = 26;
