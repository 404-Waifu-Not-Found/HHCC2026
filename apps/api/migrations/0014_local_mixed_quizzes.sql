DROP INDEX IF EXISTS quiz_banks_passed_v5_idx;

CREATE INDEX IF NOT EXISTS quiz_banks_passed_v7_idx
ON quiz_banks(user_id, video_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 7 AND quality_status = 'passed';
