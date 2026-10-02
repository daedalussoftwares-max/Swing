package pg

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

//go:embed schema.sql
var schemaSQL string

// DB wraps database/sql for Postgres (driver lives in lib module only).
type DB struct {
	sql *sql.DB
}

func Open(ctx context.Context, databaseURL string) (*DB, error) {
	databaseURL, err := resolveDatabaseURL(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("database url: %w", err)
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	if err := prepareForSchema(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("prepare schema: %w", err)
	}
	if _, err := db.ExecContext(ctx, schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	if err := migrateProfileColumns(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("profile columns: %w", err)
	}
	if err := migrateStatusItems(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("status items: %w", err)
	}
	if err := migratePlanes(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("planes: %w", err)
	}
	if err := migratePlaneEngineV2(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("plane engine v2: %w", err)
	}
	if err := migrateFromLegacyUsers(ctx, db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("legacy migrate: %w", err)
	}
	return &DB{sql: db}, nil
}

func (d *DB) SQL() *sql.DB {
	return d.sql
}

func (d *DB) Close() error {
	return d.sql.Close()
}
