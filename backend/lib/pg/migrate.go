package pg

import (
	"context"
	"database/sql"
	"fmt"
)

// prepareForSchema drops legacy refresh_tokens (user_id column) so schema.sql
// can create refresh_tokens with account_id.
func prepareForSchema(ctx context.Context, db *sql.DB) error {
	var hasLegacyRefresh bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = 'refresh_tokens'
			  AND column_name = 'user_id'
		)
	`).Scan(&hasLegacyRefresh)
	if err != nil {
		return fmt.Errorf("check legacy refresh_tokens: %w", err)
	}
	if hasLegacyRefresh {
		if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS refresh_tokens CASCADE`); err != nil {
			return fmt.Errorf("drop legacy refresh_tokens: %w", err)
		}
	}
	return nil
}

// migrateProfileColumns adds columns introduced after the initial profiles table.
func migrateProfileColumns(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `
		ALTER TABLE profiles ADD COLUMN IF NOT EXISTS interests TEXT NOT NULL DEFAULT ''
	`); err != nil {
		return fmt.Errorf("add profiles.interests: %w", err)
	}
	return nil
}

func migrateStatusItems(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS status_items (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
			media_key TEXT NOT NULL,
			content_type TEXT NOT NULL,
			posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("status_items table: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_status_items_account_expires
			ON status_items(account_id, expires_at)
	`); err != nil {
		return fmt.Errorf("status_items index: %w", err)
	}
	return nil
}

func migratePlanes(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS profile_stats (
			account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
			last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("profile_stats table: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS planes (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			message TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending', 'accepted', 'expired')),
			filters JSONB NOT NULL DEFAULT '{}',
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("planes table: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_planes_sender ON planes(sender_account_id, created_at DESC)
	`); err != nil {
		return fmt.Errorf("planes sender index: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_planes_status_expires ON planes(status, expires_at)
	`); err != nil {
		return fmt.Errorf("planes status index: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS plane_deliveries (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			plane_id UUID NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
			recipient_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'pending'
				CHECK (status IN ('pending', 'accepted', 'rejected')),
			delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			responded_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("plane_deliveries table: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_plane_deliveries_recipient
			ON plane_deliveries(recipient_account_id, status, delivered_at DESC)
	`); err != nil {
		return fmt.Errorf("plane_deliveries recipient index: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_plane_deliveries_plane
			ON plane_deliveries(plane_id, delivered_at DESC)
	`); err != nil {
		return fmt.Errorf("plane_deliveries plane index: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS friendships (
			account_a UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			account_b UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (account_a, account_b),
			CHECK (account_a < account_b)
		)
	`); err != nil {
		return fmt.Errorf("friendships table: %w", err)
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO profile_stats (account_id, last_active_at)
		SELECT account_id, created_at FROM profiles
		ON CONFLICT (account_id) DO NOTHING
	`); err != nil {
		return fmt.Errorf("backfill profile_stats: %w", err)
	}

	return nil
}

func migratePlaneEngineV2(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `
		ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT FALSE
	`); err != nil {
		return fmt.Errorf("profiles.is_dummy: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		ALTER TABLE profile_stats ADD COLUMN IF NOT EXISTS planes_remaining INT NOT NULL DEFAULT 5
	`); err != nil {
		return fmt.Errorf("profile_stats.planes_remaining: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		ALTER TABLE planes ADD COLUMN IF NOT EXISTS recipient_is_dummy BOOLEAN NOT NULL DEFAULT FALSE
	`); err != nil {
		return fmt.Errorf("planes.recipient_is_dummy: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS chats (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			account_a UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			account_b UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
			plane_id UUID REFERENCES planes(id) ON DELETE SET NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			CHECK (account_a < account_b),
			UNIQUE (account_a, account_b)
		)
	`); err != nil {
		return fmt.Errorf("chats table: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_chats_account_a ON chats(account_a)
	`); err != nil {
		return fmt.Errorf("chats account_a index: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		CREATE INDEX IF NOT EXISTS idx_chats_account_b ON chats(account_b)
	`); err != nil {
		return fmt.Errorf("chats account_b index: %w", err)
	}
	if _, err := db.ExecContext(ctx, `
		UPDATE profile_stats SET planes_remaining = 5 WHERE planes_remaining IS NULL
	`); err != nil {
		return fmt.Errorf("backfill planes_remaining: %w", err)
	}

	return seedDummyUsers(ctx, db)
}

func seedDummyUsers(ctx context.Context, db *sql.DB) error {
	type dummy struct {
		id, googleSub, email, username, name, gender, country, city, interests, bio string
		dob                                                                          string
	}
	dummies := []dummy{
		{
			id: "d1000001-0000-4000-8000-000000000001", googleSub: "swing-dummy-aanya",
			email: "dummy+aanya@swing.internal", username: "dummy_aanya", name: "Aanya",
			gender: "F", country: "India", city: "Mumbai",
			interests: "music,film,coffee", dob: "2004-03-12",
			bio: "Architecture student. Coffee snob. Will cry over a good sunset.",
		},
		{
			id: "d1000001-0000-4000-8000-000000000002", googleSub: "swing-dummy-kabir",
			email: "dummy+kabir@swing.internal", username: "dummy_kabir", name: "Kabir",
			gender: "M", country: "India", city: "Bengaluru",
			interests: "music,vinyl,biryani", dob: "2002-06-04",
			bio: "Music producer by night, engineer by day.",
		},
		{
			id: "d1000001-0000-4000-8000-000000000003", googleSub: "swing-dummy-mira",
			email: "dummy+mira@swing.internal", username: "dummy_mira", name: "Mira",
			gender: "NB", country: "India", city: "Goa",
			interests: "travel,writing,sunrises", dob: "1999-04-19",
			bio: "Traveller, ex-journalist, full-time noticer of small things.",
		},
		{
			id: "d1000001-0000-4000-8000-000000000004", googleSub: "swing-dummy-ishaan",
			email: "dummy+ishaan@swing.internal", username: "dummy_ishaan", name: "Ishaan",
			gender: "M", country: "India", city: "Delhi",
			interests: "books,poetry,chai", dob: "2003-01-15",
			bio: "Book nerd pretending to be a grown-up.",
		},
		{
			id: "d1000001-0000-4000-8000-000000000005", googleSub: "swing-dummy-priya",
			email: "dummy+priya@swing.internal", username: "dummy_priya", name: "Priya",
			gender: "F", country: "India", city: "Pune",
			interests: "design,photography,walks", dob: "2005-08-21",
			bio: "Designer who believes good type can fix most moods.",
		},
	}

	for _, d := range dummies {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO accounts (id, email, google_sub)
			VALUES ($1::uuid, $2, $3)
			ON CONFLICT (id) DO NOTHING
		`, d.id, d.email, d.googleSub); err != nil {
			return fmt.Errorf("seed dummy account %s: %w", d.username, err)
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO profiles (
				account_id, username, name, dob, gender, bio, interests,
				city, country, profile_complete, is_dummy
			)
			VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7, $8, $9, TRUE, TRUE)
			ON CONFLICT (account_id) DO NOTHING
		`, d.id, d.username, d.name, d.dob, d.gender, d.bio, d.interests, d.city, d.country); err != nil {
			return fmt.Errorf("seed dummy profile %s: %w", d.username, err)
		}
		if _, err := db.ExecContext(ctx, `
			INSERT INTO profile_stats (account_id, last_active_at, planes_remaining)
			VALUES ($1::uuid, NOW(), 0)
			ON CONFLICT (account_id) DO NOTHING
		`, d.id); err != nil {
			return fmt.Errorf("seed dummy stats %s: %w", d.username, err)
		}
	}
	return nil
}

// migrateFromLegacyUsers moves data from the old single-table `users` schema
// into accounts + profiles, then drops legacy tables.
func migrateFromLegacyUsers(ctx context.Context, db *sql.DB) error {
	var usersExists bool
	err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'users'
		)
	`).Scan(&usersExists)
	if err != nil {
		return fmt.Errorf("check legacy users: %w", err)
	}
	if !usersExists {
		return nil
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO accounts (id, email, password_hash, created_at, updated_at)
		SELECT id, email, password_hash, created_at, updated_at
		FROM users
		ON CONFLICT (id) DO NOTHING
	`); err != nil {
		return fmt.Errorf("migrate accounts: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO profiles (account_id, profile_complete, created_at, updated_at)
		SELECT id, profile_complete, created_at, updated_at
		FROM users
		ON CONFLICT (account_id) DO NOTHING
	`); err != nil {
		return fmt.Errorf("migrate profiles: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS refresh_tokens CASCADE`); err != nil {
		return fmt.Errorf("drop legacy refresh_tokens: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS users CASCADE`); err != nil {
		return fmt.Errorf("drop legacy users: %w", err)
	}

	return tx.Commit()
}
