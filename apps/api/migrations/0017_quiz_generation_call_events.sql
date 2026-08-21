PRAGMA foreign_keys = ON;

-- Privacy-safe, request-accurate telemetry for extension-local DeepSeek calls.
-- This table intentionally cannot store prompts, captions, model bodies,
-- questions, answers, credentials, authorization headers, or raw errors.
CREATE TABLE IF NOT EXISTS quiz_generation_call_events (
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  generation_session_id TEXT NOT NULL,
  call_index INTEGER NOT NULL CHECK(call_index >= 0 AND call_index <= 127),
  start_ordinal INTEGER NOT NULL CHECK(start_ordinal >= 0 AND start_ordinal <= 14),
  requested_count INTEGER NOT NULL CHECK(requested_count >= 1 AND requested_count <= 3),
  accepted_count INTEGER NOT NULL CHECK(accepted_count >= 0 AND accepted_count <= requested_count),
  classification TEXT NOT NULL CHECK(classification IN ('primary', 'automatic_retry', 'manual_continuation')),
  outcome_code TEXT NOT NULL CHECK(length(outcome_code) BETWEEN 1 AND 64),
  retry_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK(retry_delay_ms >= 0 AND retry_delay_ms <= 300000),
  elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms >= 0 AND elapsed_ms <= 900000),
  input_tokens INTEGER CHECK(input_tokens >= 0 AND input_tokens <= 20000000),
  output_tokens INTEGER CHECK(output_tokens >= 0 AND output_tokens <= 2000000),
  reasoning_tokens INTEGER CHECK(reasoning_tokens >= 0 AND reasoning_tokens <= 2000000),
  usage_complete INTEGER NOT NULL CHECK(usage_complete IN (0, 1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (quiz_id, generation_session_id, call_index)
);

CREATE INDEX IF NOT EXISTS quiz_generation_call_events_quiz_created_idx
ON quiz_generation_call_events(quiz_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_generation_claims (
  quiz_id TEXT PRIMARY KEY NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  generation_session_id TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS quiz_generation_claim_key_idx
ON quiz_generation_claims(claim_key);

CREATE INDEX IF NOT EXISTS quiz_generation_claim_lease_idx
ON quiz_generation_claims(lease_expires_at);
