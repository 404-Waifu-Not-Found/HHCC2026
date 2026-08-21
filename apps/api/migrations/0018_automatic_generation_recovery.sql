ALTER TABLE quiz_generation_call_events ADD COLUMN protocol_version INTEGER;
ALTER TABLE quiz_generation_call_events ADD COLUMN retry_kind TEXT;
ALTER TABLE quiz_generation_call_events ADD COLUMN ordinal_attempt INTEGER;
ALTER TABLE quiz_generation_call_events ADD COLUMN recovery_session_id TEXT;

ALTER TABLE quiz_generation_claims ADD COLUMN recovery_session_id TEXT;
ALTER TABLE quiz_generation_claims ADD COLUMN heartbeat_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_quiz_generation_claims_active_lease
ON quiz_generation_claims(lease_expires_at, quiz_id);

CREATE INDEX IF NOT EXISTS idx_quiz_generation_calls_recovery
ON quiz_generation_call_events(quiz_id, recovery_session_id, start_ordinal, ordinal_attempt);
