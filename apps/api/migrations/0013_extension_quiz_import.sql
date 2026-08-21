ALTER TABLE quiz_banks ADD COLUMN import_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS quiz_banks_import_key_idx
ON quiz_banks(user_id, import_key)
WHERE import_key IS NOT NULL;
