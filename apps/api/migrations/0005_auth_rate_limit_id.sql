CREATE TABLE rateLimit_next (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);

INSERT INTO rateLimit_next (id, key, count, last_request)
SELECT key, key, count, last_request FROM rateLimit;

DROP TABLE rateLimit;
ALTER TABLE rateLimit_next RENAME TO rateLimit;
CREATE INDEX rate_limit_last_request_idx ON rateLimit(last_request);
