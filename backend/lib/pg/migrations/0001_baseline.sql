-- 0001 baseline: the complete schema as of the switch to versioned migrations.
--
-- Replaces lib/pg/schema.sql and the old imperative Go migrations
-- (prepareForSchema, migrateProfileColumns, migrateStatusItems, migratePlanes,
-- migratePlaneEngineV2, migrateChatMessaging, migrateChatV2, migratePlanesV3,
-- migrateChatV3, migrateFromLegacyUsers).
--
-- It MUST stay idempotent: databases created before schema_migrations existed
-- already contain most or all of this, so every statement is guarded
-- (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / guarded backfills). On an empty
-- database the CREATE TABLE statements produce the final shape directly and the
-- ALTER/backfill statements are no-ops.
--
-- All table references are unqualified (resolved via search_path).

-- ---------------------------------------------------------------------------
-- Legacy: very old DBs had refresh_tokens(user_id) pointing at a single
-- `users` table. Drop it so the account-based table below can be created.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'refresh_tokens'
          AND column_name = 'user_id'
    ) THEN
        DROP TABLE refresh_tokens CASCADE;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Identity + profile.
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    password_hash TEXT,
    google_sub TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT accounts_email_unique UNIQUE (email),
    CONSTRAINT accounts_google_sub_unique UNIQUE (google_sub),
    CONSTRAINT accounts_has_credential CHECK (
        password_hash IS NOT NULL OR google_sub IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS profiles (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    username TEXT,
    name TEXT,
    dob DATE,
    gender TEXT,
    bio TEXT NOT NULL DEFAULT '',
    interests TEXT NOT NULL DEFAULT '',
    city TEXT,
    country TEXT,
    avatar_url TEXT,
    profile_complete BOOLEAN NOT NULL DEFAULT FALSE,
    is_dummy BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    location_updated_at TIMESTAMPTZ,
    CONSTRAINT profiles_username_unique UNIQUE (username)
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS interests TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- Legacy: move the old single-table `users` schema into accounts + profiles.
DO $$
BEGIN
    IF to_regclass('users') IS NOT NULL THEN
        EXECUTE $q$
            INSERT INTO accounts (id, email, password_hash, created_at, updated_at)
            SELECT id, email, password_hash, created_at, updated_at FROM users
            ON CONFLICT (id) DO NOTHING
        $q$;
        EXECUTE $q$
            INSERT INTO profiles (account_id, profile_complete, created_at, updated_at)
            SELECT id, profile_complete, created_at, updated_at FROM users
            ON CONFLICT (account_id) DO NOTHING
        $q$;
        DROP TABLE users CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash)
);

-- Ephemeral status slides (24h). Media bytes live in R2 under status/{account_id}/...
CREATE TABLE IF NOT EXISTS status_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    media_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Planes (matching engine).
CREATE TABLE IF NOT EXISTS profile_stats (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    planes_remaining INT NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE profile_stats ADD COLUMN IF NOT EXISTS planes_remaining INT NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS planes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'expired')),
    filters JSONB NOT NULL DEFAULT '{}',
    recipient_is_dummy BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A plane is "searching" while status='pending' AND next_attempt_at IS NOT NULL.
    next_attempt_at TIMESTAMPTZ,
    dispatch_attempts INT NOT NULL DEFAULT 0
);
ALTER TABLE planes ADD COLUMN IF NOT EXISTS recipient_is_dummy BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE planes ADD COLUMN IF NOT EXISTS dispatch_attempts INT NOT NULL DEFAULT 0;

-- Each delivery attempt for a plane (reject -> next recipient).
CREATE TABLE IF NOT EXISTS plane_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plane_id UUID NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
    recipient_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Canonical friendship after a plane is accepted.
CREATE TABLE IF NOT EXISTS friendships (
    account_a UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    account_b UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_a, account_b),
    CHECK (account_a < account_b)
);

-- ---------------------------------------------------------------------------
-- Chat.
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_a UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    account_b UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plane_id UUID REFERENCES planes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_seq BIGINT NOT NULL DEFAULT 0,
    last_message_id UUID,
    last_message_at TIMESTAMPTZ,
    CHECK (account_a < account_b),
    UNIQUE (account_a, account_b)
);
ALTER TABLE chats ADD COLUMN IF NOT EXISTS next_seq BIGINT NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_id UUID;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seq BIGINT NOT NULL,
    client_msg_id TEXT,
    type TEXT NOT NULL DEFAULT 'text',
    media JSONB,
    reply_to_id UUID REFERENCES chat_messages(id),
    forwarded BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    view_once BOOLEAN NOT NULL DEFAULT FALSE,
    viewed_at TIMESTAMPTZ
);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS client_msg_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS media JSONB;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES chat_messages(id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS forwarded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS view_once BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
-- MVP text-only messages had body NOT NULL + a length CHECK; media messages need neither.
ALTER TABLE chat_messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_body_check;

-- Per-user read cursor for unread counts.
CREATE TABLE IF NOT EXISTS chat_read_state (
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_seq BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, account_id)
);
ALTER TABLE chat_read_state ADD COLUMN IF NOT EXISTS last_read_seq BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS chat_message_status (
    message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, account_id)
);

CREATE TABLE IF NOT EXISTS chat_message_reactions (
    message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, account_id)
);

CREATE TABLE IF NOT EXISTS chat_message_hidden (
    message_id UUID REFERENCES chat_messages(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, account_id)
);

CREATE TABLE IF NOT EXISTS chat_user_state (
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ,
    PRIMARY KEY (chat_id, account_id)
);

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- User reports (0003 relaxes the FKs and adds evidence snapshots).
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    reported_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_id UUID,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Notifications + push.
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    from_name TEXT,
    deep_link TEXT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_tokens (
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    token TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Backfills for databases that predate the columns above. Each one is guarded
-- so it only touches rows that still need it.

-- Every profile gets a stats row (new accounts get one at signup).
INSERT INTO profile_stats (account_id, last_active_at)
SELECT account_id, created_at FROM profiles
ON CONFLICT (account_id) DO NOTHING;

-- Chat v2: per-chat message sequence numbers.
UPDATE chat_messages m SET seq = r.rn
FROM (
    SELECT id, row_number() OVER (PARTITION BY chat_id ORDER BY created_at, id) AS rn
    FROM chat_messages
) r
WHERE m.id = r.id AND m.seq IS NULL;

-- Never lower a chat's counter; only raise it to cover backfilled seqs.
UPDATE chats c SET next_seq = s.max_seq
FROM (SELECT chat_id, max(seq) AS max_seq FROM chat_messages GROUP BY chat_id) s
WHERE s.chat_id = c.id AND c.next_seq < s.max_seq;

UPDATE chat_read_state crs SET last_read_seq = COALESCE(
    (SELECT max(m.seq) FROM chat_messages m
     WHERE m.chat_id = crs.chat_id AND m.created_at <= crs.last_read_at),
    0
)
WHERE crs.last_read_seq = 0;

ALTER TABLE chat_messages ALTER COLUMN seq SET NOT NULL;

-- Planes v3: a pending plane with no pending delivery must be searching.
UPDATE planes pl SET next_attempt_at = NOW()
WHERE pl.status = 'pending'
  AND pl.next_attempt_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM plane_deliveries pd
      WHERE pd.plane_id = pl.id AND pd.status = 'pending'
  );

-- Planes v3: keep only the newest pending delivery per plane (before the
-- unique index below).
UPDATE plane_deliveries pd
SET status = 'rejected', responded_at = COALESCE(pd.responded_at, NOW())
WHERE pd.status = 'pending'
  AND EXISTS (
      SELECT 1 FROM plane_deliveries newer
      WHERE newer.plane_id = pd.plane_id
        AND newer.status = 'pending'
        AND (newer.delivered_at, newer.id) > (pd.delivered_at, pd.id)
  );

-- ---------------------------------------------------------------------------
-- Indexes (after backfills so unique indexes see clean data).
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account_id ON refresh_tokens(account_id);

CREATE INDEX IF NOT EXISTS idx_status_items_account_expires
    ON status_items(account_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_profile_stats_last_active
    ON profile_stats(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_matchable
    ON profiles(is_dummy, gender) WHERE profile_complete;
CREATE INDEX IF NOT EXISTS idx_profiles_country_norm
    ON profiles(LOWER(TRIM(country))) WHERE profile_complete;
CREATE INDEX IF NOT EXISTS idx_profiles_geo
    ON profiles(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL AND profile_complete;

CREATE INDEX IF NOT EXISTS idx_planes_sender ON planes(sender_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planes_status_expires ON planes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_planes_searching
    ON planes(next_attempt_at) WHERE status = 'pending' AND next_attempt_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planes_pending_dummy
    ON planes(updated_at) WHERE status = 'pending' AND recipient_is_dummy;

CREATE INDEX IF NOT EXISTS idx_plane_deliveries_recipient
    ON plane_deliveries(recipient_account_id, status, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_plane_deliveries_plane
    ON plane_deliveries(plane_id, delivered_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plane_deliveries_one_pending
    ON plane_deliveries(plane_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(account_a);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(account_b);

CREATE INDEX IF NOT EXISTS idx_chats_account_a ON chats(account_a);
CREATE INDEX IF NOT EXISTS idx_chats_account_b ON chats(account_b);

CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created
    ON chat_messages(chat_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_chat_seq ON chat_messages(chat_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_id
    ON chat_messages(chat_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cms_unread ON chat_message_status(account_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_message_hidden_account ON chat_message_hidden(account_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_account_created
    ON notifications(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_tokens_account ON device_tokens(account_id);
