ALTER TABLE attempts ADD COLUMN start_key TEXT;
ALTER TABLE attempts ADD COLUMN start_request_json TEXT;
ALTER TABLE attempts ADD COLUMN start_response_json TEXT;
ALTER TABLE attempts ADD COLUMN grading_token TEXT;
ALTER TABLE attempts ADD COLUMN grading_expires_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS attempts_start_key_idx
ON attempts(user_id, start_key)
WHERE start_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS attempts_grading_expiry_idx
ON attempts(grading_expires_at)
WHERE grading_token IS NOT NULL;

-- Keep the five most recently refreshed devices for users who registered more
-- tokens before the per-user cap was introduced.
DELETE FROM device_tokens
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY updated_at DESC, id
      ) AS token_rank
    FROM device_tokens
  ) ranked_tokens
  WHERE token_rank > 5
);

CREATE INDEX IF NOT EXISTS device_tokens_user_updated_idx
ON device_tokens(user_id, updated_at DESC);
