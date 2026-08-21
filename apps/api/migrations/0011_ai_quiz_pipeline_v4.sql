ALTER TABLE generation_jobs ADD COLUMN workflow_instance_id TEXT;
ALTER TABLE generation_jobs ADD COLUMN model TEXT;
ALTER TABLE generation_jobs ADD COLUMN reasoning_effort TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS generation_jobs_workflow_instance_idx
ON generation_jobs(workflow_instance_id)
WHERE workflow_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quiz_banks_passed_v4_idx
ON quiz_banks(user_id, video_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 4 AND quality_status = 'passed';
