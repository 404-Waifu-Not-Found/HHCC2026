ALTER TABLE generation_jobs ADD COLUMN lease_token TEXT;
ALTER TABLE generation_jobs ADD COLUMN lease_expires_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN last_heartbeat_at INTEGER;
ALTER TABLE generation_jobs ADD COLUMN recovery_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS generation_jobs_recovery_idx
ON generation_jobs(state, lease_expires_at, updated_at);

CREATE INDEX IF NOT EXISTS quiz_banks_passed_v3_idx
ON quiz_banks(user_id, video_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 3 AND quality_status = 'passed';
