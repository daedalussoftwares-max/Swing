-- accounts: signup / login identity (email, password, or Google).
-- profiles: public + rich profile (1:1 with accounts).

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
    CONSTRAINT profiles_username_unique UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_account_id ON refresh_tokens(account_id);

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

CREATE INDEX IF NOT EXISTS idx_status_items_account_expires
    ON status_items(account_id, expires_at);

-- Matching + activity signals for the plane engine.
CREATE TABLE IF NOT EXISTS profile_stats (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    planes_remaining INT NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Paper planes sent between users.
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_planes_sender ON planes(sender_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planes_status_expires ON planes(status, expires_at);

-- Each delivery attempt for a plane (reject → next recipient).
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

CREATE INDEX IF NOT EXISTS idx_plane_deliveries_recipient
    ON plane_deliveries(recipient_account_id, status, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_plane_deliveries_plane
    ON plane_deliveries(plane_id, delivered_at DESC);

-- Canonical friendship after a plane is accepted.
CREATE TABLE IF NOT EXISTS friendships (
    account_a UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    account_b UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_a, account_b),
    CHECK (account_a < account_b)
);

CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(account_a);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(account_b);

-- 1:1 chats opened after a plane is accepted.
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_a UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    account_b UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    plane_id UUID REFERENCES planes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (account_a < account_b),
    UNIQUE (account_a, account_b)
);

CREATE INDEX IF NOT EXISTS idx_chats_account_a ON chats(account_a);
CREATE INDEX IF NOT EXISTS idx_chats_account_b ON chats(account_b);
