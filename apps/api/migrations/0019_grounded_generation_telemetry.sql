-- Protocol 8 records the bounded purpose of every extension-local model call.
-- No prompt, caption, model response, question, answer, credential, or raw
-- error data is permitted in this table.
ALTER TABLE quiz_generation_call_events ADD COLUMN purpose TEXT
  CHECK(purpose IS NULL OR purpose = 'generation');

CREATE INDEX IF NOT EXISTS idx_quiz_generation_calls_protocol_purpose
ON quiz_generation_call_events(quiz_id, protocol_version, purpose, call_index);
