-- Quest sharing: one stable public token per quiz bank, and one claim row per
-- recipient recording the bank that was cloned into their account.
CREATE TABLE IF NOT EXISTS quiz_shares (
  id TEXT PRIMARY KEY NOT NULL,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE(quiz_id)
);

CREATE TABLE IF NOT EXISTS quiz_share_claims (
  share_id TEXT NOT NULL REFERENCES quiz_shares(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  quiz_id TEXT NOT NULL REFERENCES quiz_banks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(share_id, user_id)
);
CREATE INDEX IF NOT EXISTS quiz_share_claims_quiz_idx
  ON quiz_share_claims(quiz_id);
