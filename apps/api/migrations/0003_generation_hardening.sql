ALTER TABLE generation_jobs ADD COLUMN transcript_key TEXT;
ALTER TABLE generation_jobs ADD COLUMN idempotency_key TEXT;
ALTER TABLE generation_jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;

UPDATE generation_jobs
SET transcript_key = 'transcripts/' || user_id || '/' || video_id || '.json'
WHERE transcript_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_idempotency_idx
ON generation_jobs(user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
