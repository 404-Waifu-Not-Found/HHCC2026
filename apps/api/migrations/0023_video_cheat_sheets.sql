CREATE TABLE IF NOT EXISTS video_cheat_sheets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  source_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready', 'failed', 'none')) DEFAULT 'none',
  notes_key TEXT,
  pdf_key TEXT,
  content_hash TEXT,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  generated_at INTEGER,
  last_error TEXT,
  UNIQUE(user_id, video_id, source_revision)
);

CREATE INDEX IF NOT EXISTS video_cheat_sheets_user_idx
  ON video_cheat_sheets(user_id, updated_at DESC);
