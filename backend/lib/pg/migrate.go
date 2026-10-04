package pg

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"path"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// Versioned schema migrations.
//
// Every file in migrations/ named NNNN_name.sql is one migration. They are
// applied in version order, each in its own transaction together with its
// schema_migrations row, so a migration is either fully applied and recorded
// or not at all. A transaction-scoped advisory lock serialises concurrent
// server instances. See migrations/README.md.

//go:embed migrations/*.sql
var migrationFiles embed.FS

// migrationLockKey is the pg_advisory_lock key guarding schema changes
// (arbitrary constant; "swing" + "mig" in ASCII).
const migrationLockKey int64 = 0x7377696e676d6967

var migrationFileRE = regexp.MustCompile(`^(\d{4,})_([a-z0-9_]+)\.sql$`)

// Migration is one numbered SQL file.
type Migration struct {
	Version int
	Name    string
	SQL     string
}

// loadMigrations reads and validates every migration in dir of fsys,
// sorted by version. Non-.sql files (README.md) are ignored.
func loadMigrations(fsys fs.FS, dir string) ([]Migration, error) {
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations: %w", err)
	}
	var out []Migration
	seen := map[int]string{}
	for _, e := range entries {
		if e.IsDir() || path.Ext(e.Name()) != ".sql" {
			continue
		}
		m := migrationFileRE.FindStringSubmatch(e.Name())
		if m == nil {
			return nil, fmt.Errorf("migration %q: name must look like 0001_snake_case.sql", e.Name())
		}
		v, err := strconv.Atoi(m[1])
		if err != nil || v <= 0 {
			return nil, fmt.Errorf("migration %q: version must be a positive integer", e.Name())
		}
		if prev, dup := seen[v]; dup {
			return nil, fmt.Errorf("migration version %d used twice (%s, %s)", v, prev, e.Name())
		}
		seen[v] = e.Name()
		body, err := fs.ReadFile(fsys, path.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("read migration %q: %w", e.Name(), err)
		}
		out = append(out, Migration{Version: v, Name: m[2], SQL: string(body)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// pendingMigrations returns, in order, the migrations whose version is not
// in applied. Versions present in applied but unknown to this binary (a
// newer deploy already migrated) are ignored.
func pendingMigrations(all []Migration, applied map[int]bool) []Migration {
	var out []Migration
	for _, m := range all {
		if !applied[m.Version] {
			out = append(out, m)
		}
	}
	return out
}

// querier is satisfied by *sql.DB, *sql.Conn and *sql.Tx.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

const createMigrationsTable = `
	CREATE TABLE IF NOT EXISTS schema_migrations (
		version INT PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	)`

func appliedVersions(ctx context.Context, q querier) (map[int]bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]bool{}
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = true
	}
	return out, rows.Err()
}

// applyMigrations creates schema_migrations, then runs every pending
// migration through inTx (one transaction per migration) and records it in
// the same transaction. Each transaction first takes a transaction-scoped
// advisory lock and re-checks schema_migrations, so concurrent instances
// never apply the same migration twice; xact locks (unlike session locks)
// are also safe behind a transaction-pooling PgBouncer such as Neon's pooler.
// It returns the versions it applied.
func applyMigrations(
	ctx context.Context,
	q querier,
	all []Migration,
	inTx func(ctx context.Context, fn func(querier) error) error,
) ([]int, error) {
	if err := inTx(ctx, func(tx querier) error {
		if err := lockMigrations(ctx, tx); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, createMigrationsTable)
		return err
	}); err != nil {
		return nil, fmt.Errorf("create schema_migrations: %w", err)
	}
	applied, err := appliedVersions(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	var done []int
	for _, m := range pendingMigrations(all, applied) {
		start := time.Now()
		ran := false
		err := inTx(ctx, func(tx querier) error {
			if err := lockMigrations(ctx, tx); err != nil {
				return err
			}
			// Another instance may have applied it while we waited.
			now, err := appliedVersions(ctx, tx)
			if err != nil {
				return err
			}
			if now[m.Version] {
				return nil
			}
			// Multi-statement body: lib/pq sends it as one simple query.
			if _, err := tx.ExecContext(ctx, m.SQL); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
				m.Version, m.Name); err != nil {
				return err
			}
			ran = true
			return nil
		})
		if err != nil {
			return done, fmt.Errorf("migration %04d_%s: %w", m.Version, m.Name, err)
		}
		if ran {
			log.Printf("db: applied migration %04d_%s (%s)", m.Version, m.Name, time.Since(start).Round(time.Millisecond))
			done = append(done, m.Version)
		}
	}
	return done, nil
}

func lockMigrations(ctx context.Context, tx querier) error {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, migrationLockKey); err != nil {
		return fmt.Errorf("migrations lock: %w", err)
	}
	return nil
}

// Migrate applies all pending embedded migrations, one transaction each.
func Migrate(ctx context.Context, db *sql.DB) error {
	all, err := loadMigrations(migrationFiles, "migrations")
	if err != nil {
		return err
	}
	inTx := func(ctx context.Context, fn func(querier) error) error {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if err := fn(tx); err != nil {
			_ = tx.Rollback()
			return err
		}
		return tx.Commit()
	}
	_, err = applyMigrations(ctx, db, all, inTx)
	return err
}
