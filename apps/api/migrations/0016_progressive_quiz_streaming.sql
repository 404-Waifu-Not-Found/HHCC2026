-- Pipeline 7 remains readable for existing completed quizzes. Pipeline 8 was
-- an unreleased progressive prototype and intentionally has no current index.
CREATE INDEX IF NOT EXISTS quiz_banks_passed_v9_idx
ON quiz_banks(user_id, video_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 9 AND quality_status = 'passed';

CREATE INDEX IF NOT EXISTS quiz_banks_generating_v9_idx
ON quiz_banks(user_id, quality_status, pipeline_version, created_at DESC)
WHERE pipeline_version = 9 AND quality_status = 'generating';
