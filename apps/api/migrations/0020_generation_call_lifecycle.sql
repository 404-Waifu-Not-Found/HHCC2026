-- Protocol 9 records dispatch before a model request and finalizes that same
-- privacy-safe row when the stream ends. Existing rows are historical terminal
-- events and remain readable without rewriting their classification or outcome.
ALTER TABLE quiz_generation_call_events ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'completed'
  CHECK(lifecycle_state IN ('started', 'completed', 'abandoned'));
ALTER TABLE quiz_generation_call_events ADD COLUMN dispatched_at INTEGER;
ALTER TABLE quiz_generation_call_events ADD COLUMN completed_at INTEGER;
ALTER TABLE quiz_generation_call_events ADD COLUMN last_stream_activity_at INTEGER;

UPDATE quiz_generation_call_events
SET dispatched_at = COALESCE(dispatched_at, created_at),
    completed_at = COALESCE(completed_at, created_at + elapsed_ms),
    last_stream_activity_at = COALESCE(last_stream_activity_at, created_at + elapsed_ms)
WHERE lifecycle_state = 'completed';

CREATE INDEX IF NOT EXISTS idx_quiz_generation_calls_lifecycle
ON quiz_generation_call_events(quiz_id, lifecycle_state, dispatched_at DESC);

-- Only privacy-safe aggregate source metadata is persisted. Subtitle text and
-- segment contents remain extension-local.
ALTER TABLE videos ADD COLUMN caption_source_category TEXT
  CHECK(caption_source_category IS NULL OR caption_source_category IN ('manual', 'automatic', 'local_transcription', 'unknown'));
ALTER TABLE videos ADD COLUMN caption_segment_count INTEGER
  CHECK(caption_segment_count IS NULL OR (caption_segment_count >= 0 AND caption_segment_count <= 100000));
ALTER TABLE videos ADD COLUMN caption_word_count INTEGER
  CHECK(caption_word_count IS NULL OR (caption_word_count >= 0 AND caption_word_count <= 5000000));
ALTER TABLE videos ADD COLUMN source_metadata_verified_at INTEGER;
