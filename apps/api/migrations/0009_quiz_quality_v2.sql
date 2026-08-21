ALTER TABLE generation_jobs
ADD COLUMN pipeline_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE generation_jobs
ADD COLUMN quality_summary_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE quiz_banks
ADD COLUMN pipeline_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE quiz_banks
ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE quiz_banks
ADD COLUMN quality_summary_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE questions
ADD COLUMN generation_metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS quiz_banks_passed_v2_idx
ON quiz_banks(user_id, video_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 2 AND quality_status = 'passed';
