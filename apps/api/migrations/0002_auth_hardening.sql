CREATE TABLE IF NOT EXISTS rateLimit (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_last_request_idx ON rateLimit(last_request);
