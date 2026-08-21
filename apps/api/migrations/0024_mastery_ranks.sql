-- Replace the legacy learning state with score-based mastery ranks.
CREATE TABLE mastery_v2 (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'not_started' CHECK(state IN ('not_started', 'basic', 'intermediate', 'expert', 'mastered')),
  best_score REAL,
  initial_passed_at INTEGER,
  review_passed_at INTEGER,
  next_review_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, video_id)
);

INSERT INTO mastery_v2 (
  user_id,
  video_id,
  state,
  best_score,
  initial_passed_at,
  review_passed_at,
  next_review_at,
  updated_at
)
SELECT
  user_id,
  video_id,
  CASE
    WHEN best_score >= 100 THEN 'mastered'
    WHEN best_score >= 90 THEN 'expert'
    WHEN best_score >= 80 THEN 'intermediate'
    WHEN state = 'learning' OR best_score IS NOT NULL THEN 'basic'
    WHEN state = 'mastered' THEN 'mastered'
    ELSE 'not_started'
  END,
  best_score,
  initial_passed_at,
  review_passed_at,
  next_review_at,
  updated_at
FROM mastery;

DROP TABLE mastery;
ALTER TABLE mastery_v2 RENAME TO mastery;
CREATE INDEX IF NOT EXISTS mastery_review_idx ON mastery(user_id, next_review_at);
