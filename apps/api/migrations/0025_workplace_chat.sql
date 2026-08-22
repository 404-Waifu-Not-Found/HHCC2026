PRAGMA foreign_keys = ON;

-- Workplace is a synced chat surface: threads and messages are durable and
-- owned per-user, cascading on account deletion like the rest of ClipQuest's
-- user-scoped data.
CREATE TABLE IF NOT EXISTS workplace_threads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workplace_threads_user_idx
  ON workplace_threads(user_id, updated_at DESC);

-- Messages are appended in strict per-thread order. `ordinal` gives every
-- message a stable sort/cursor key, and `client_message_id` makes resending
-- an in-flight local message idempotent. Message bodies are sanitized
-- WorkplaceMessagePart[] JSON validated by @clipquest/contracts before this
-- table ever sees them: no API keys, raw caption arrays, transcripts, note
-- documents, or hidden answers are stored here, only bounded learner-visible
-- text, citations, sanitized tool status, and validated practice artifacts.
CREATE TABLE IF NOT EXISTS workplace_messages (
  id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL REFERENCES workplace_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  client_message_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  parts_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(thread_id, ordinal),
  UNIQUE(thread_id, client_message_id)
);
CREATE INDEX IF NOT EXISTS workplace_messages_thread_order_idx
  ON workplace_messages(thread_id, ordinal DESC);
CREATE INDEX IF NOT EXISTS workplace_messages_thread_created_idx
  ON workplace_messages(thread_id, created_at DESC);

-- quiz_banks gains Workplace-origin tracking. SQLite/D1 ALTER TABLE cannot add
-- a UNIQUE or PRIMARY KEY column, cannot use a non-constant DEFAULT, and any
-- NOT NULL column needs a default so every pre-existing row stays valid --
-- so `origin`/`affects_mastery` use plain constant defaults with a
-- same-column CHECK, and `workplace_thread_id` is left nullable. SQLite
-- allows a REFERENCES clause on an ADD COLUMN (existing rows are assigned
-- NULL, which always satisfies a foreign key), so it can safely reference
-- workplace_threads created earlier in this same migration.
ALTER TABLE quiz_banks
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'quest' CHECK(origin IN ('quest', 'workplace'));
ALTER TABLE quiz_banks
  ADD COLUMN affects_mastery INTEGER NOT NULL DEFAULT 1 CHECK(affects_mastery IN (0, 1));
ALTER TABLE quiz_banks
  ADD COLUMN workplace_thread_id TEXT REFERENCES workplace_threads(id) ON DELETE SET NULL;
ALTER TABLE quiz_banks
  ADD COLUMN assessment_rationale TEXT;

CREATE INDEX IF NOT EXISTS quiz_banks_workplace_thread_idx
  ON quiz_banks(workplace_thread_id)
  WHERE workplace_thread_id IS NOT NULL;
