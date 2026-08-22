ALTER TABLE attempts ADD COLUMN video_duration_seconds INTEGER;

CREATE INDEX IF NOT EXISTS attempts_completed_duration_idx
  ON attempts(user_id, status, video_duration_seconds);
