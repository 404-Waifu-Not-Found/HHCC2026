DROP INDEX IF EXISTS quiz_banks_passed_v2_idx;
DROP INDEX IF EXISTS quiz_banks_passed_v3_idx;
DROP INDEX IF EXISTS quiz_banks_passed_v4_idx;
DROP INDEX IF EXISTS generation_jobs_workflow_instance_idx;
DROP INDEX IF EXISTS generation_jobs_recovery_idx;

CREATE INDEX IF NOT EXISTS quiz_banks_passed_v5_idx
ON quiz_banks(user_id, video_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 5 AND quality_status = 'passed';
