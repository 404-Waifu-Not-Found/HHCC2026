-- ClipQuest accepts verified subtitle text only. Normalize the privacy-safe
-- aggregate label left by the retired local audio path; no caption text is
-- stored in this table.
UPDATE videos
SET caption_source_category = 'unknown',
    updated_at = unixepoch() * 1000
WHERE caption_source_category = 'local_transcription';
