-- 0003: reports must survive account / chat deletion.
--
-- Previously reporter_id / reported_id were ON DELETE CASCADE, so a harasser
-- deleting their account wiped every report against them. Now the account
-- reference is nulled instead, and the evidence is frozen at report time:
--   reported_snapshot : reported user's public profile (name, username, bio, avatar_url)
--   messages_snapshot : last ~50 messages of the reported chat (incl. deleted ones)
-- chat_id stays a plain uuid (no FK), so deleting the chat keeps the id.

ALTER TABLE reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN reported_id DROP NOT NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reporter_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reported_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reported_id_fkey
    FOREIGN KEY (reported_id) REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_snapshot JSONB;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS messages_snapshot JSONB;
