ALTER TABLE creation_card_meta
ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IS NULL OR category IN ('platform', 'applet'));

UPDATE _schema_version SET version = 25;
