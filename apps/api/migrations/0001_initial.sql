PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  username TEXT UNIQUE,
  display_username TEXT,
  age_confirmed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON session(user_id);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_id_idx ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('youtube', 'bilibili')),
  source_video_id TEXT NOT NULL,
  original_url TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_key TEXT,
  thumbnail_remote_url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  source_language TEXT,
  origin TEXT NOT NULL DEFAULT 'paste' CHECK(origin IN ('paste', 'youtube_history')),
  education_status TEXT NOT NULL DEFAULT 'unknown' CHECK(education_status IN ('unknown', 'educational', 'rejected')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, source, source_video_id)
);
CREATE INDEX IF NOT EXISTS videos_owner_idx ON videos(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued', 'running', 'complete', 'failed')),
  stage TEXT NOT NULL DEFAULT 'creating_questions',
  progress REAL NOT NULL DEFAULT 0,
  quiz_id TEXT,
  error_code TEXT,
  error_message TEXT,
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  quiz_language TEXT NOT NULL,
  session_length TEXT NOT NULL,
  watched INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS generation_jobs_user_idx ON generation_jobs(user_id, updated_at DESC);

-- Workplace is a synced chat surface: threads and messages are durable and
-- owned per-user, cascading on account deletion like the rest of ClipQuest's
-- user-scoped data. quiz_banks references workplace_threads below, so these
-- tables are created first.
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

CREATE TABLE IF NOT EXISTS quiz_banks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  session_length TEXT NOT NULL,
  primer TEXT NOT NULL,
  concepts_json TEXT NOT NULL,
  watched INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL DEFAULT 'quest' CHECK(origin IN ('quest', 'workplace')),
  affects_mastery INTEGER NOT NULL DEFAULT 1 CHECK(affects_mastery IN (0, 1)),
  workplace_thread_id TEXT REFERENCES workplace_threads(id) ON DELETE SET NULL,
  assessment_rationale TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_banks_video_idx ON quiz_banks(user_id, video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quiz_banks_workplace_thread_idx
  ON quiz_banks(workplace_thread_id)
  WHERE workplace_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  source_question_id TEXT NOT NULL,
  type TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  reformulated_prompt TEXT NOT NULL,
  options_json TEXT,
  items_json TEXT,
  correct_answer_json TEXT,
  rubric_json TEXT,
  explanation TEXT NOT NULL,
  evidence_segment_ids_json TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  UNIQUE(quiz_id, ordinal)
);
CREATE INDEX IF NOT EXISTS questions_quiz_idx ON questions(quiz_id, ordinal);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('learn', 'review')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'complete')),
  current_index INTEGER NOT NULL DEFAULT 0,
  current_variant INTEGER NOT NULL DEFAULT 0,
  retry_pending INTEGER NOT NULL DEFAULT 0,
  target_difficulty REAL NOT NULL DEFAULT 2,
  correct_count INTEGER NOT NULL DEFAULT 0,
  total_answered INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL,
  score REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS attempts_user_idx ON attempts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS attempt_items (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  PRIMARY KEY(attempt_id, ordinal)
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  feedback TEXT NOT NULL,
  variant_index INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS answers_attempt_idx ON answers(attempt_id, created_at);

CREATE TABLE IF NOT EXISTS mastery (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'not_started' CHECK(state IN ('not_started', 'basic', 'intermediate', 'expert', 'mastered')),
  best_score REAL,
  initial_passed_at INTEGER,
  review_passed_at INTEGER,
  next_review_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, video_id)
);
CREATE INDEX IF NOT EXISTS mastery_review_idx ON mastery(user_id, next_review_at);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  score REAL,
  scheduled_for INTEGER NOT NULL,
  notified_at INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS reviews_due_idx ON reviews(user_id, scheduled_for, completed_at);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  locale TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, token)
);

CREATE TABLE IF NOT EXISTS youtube_connections (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  encrypted_credentials TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source_video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail_remote_url TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  classification_reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, source_video_id)
);
CREATE INDEX IF NOT EXISTS youtube_candidates_user_idx ON youtube_candidates(user_id, selected, created_at DESC);
