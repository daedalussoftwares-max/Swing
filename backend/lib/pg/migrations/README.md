# Database migrations

All schema changes live here as numbered SQL files, embedded into the binary
and applied by `pg.Migrate` (called from `pg.Open`) on every server start.

- `NNNN_snake_case_name.sql` — version `NNNN` (4+ digits, contiguous from `0001`),
  name in lowercase snake_case.
- Applied in version order. Each file runs in **its own transaction** together
  with its row in `schema_migrations(version, name, applied_at)`: it is either
  fully applied and recorded, or not at all.
- A transaction-scoped Postgres advisory lock (`pg_advisory_xact_lock`) plus a
  re-check of `schema_migrations` means several server instances starting at
  once never apply the same migration twice (works behind PgBouncer too).
- Applied migrations are never re-run, so a startup with nothing pending costs
  only a couple of round trips.

## Adding a migration

1. Create the next file, e.g. `0004_add_profile_pronouns.sql`. Never edit or
   renumber a migration that has been applied anywhere (dev DB included) —
   add a new one instead.
2. Write plain SQL. Do **not** add `BEGIN`/`COMMIT` (the runner wraps the file).
   Multiple statements and `DO $$ … $$` blocks are fine.
3. Keep table names unqualified (resolved via `search_path`).
4. Prefer guarded statements (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `DROP CONSTRAINT IF EXISTS`, backfills with `WHERE col IS NULL`) so a
   half-hand-applied dev DB doesn't break startup.
5. Statements that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`,
   `ALTER TYPE … ADD VALUE` on old Postgres) are not supported by this runner;
   use a normal `CREATE INDEX` or do it by hand.
6. `go test ./pg/` (in `backend/lib`) checks file naming, numbering and that
   no file manages its own transaction.

## Files

| Version | What |
|---|---|
| `0001_baseline` | Full schema as of the switch to versioned migrations (replaces `schema.sql` + the old Go `migrate*` functions). Idempotent against databases created by the old code; includes the legacy `users`/`refresh_tokens` conversion and the chat-seq / plane-dispatch backfills. |
| `0002_seed_dummy_users` | 365 dummy users (5 original + 30 countries × 3 genders × 4 age bands) the plane engine falls back to. Keep countries in sync with `client/lib/countries.ts`. |
| `0003_reports_keep_evidence` | `reports` FKs → `ON DELETE SET NULL`; adds `reported_snapshot` / `messages_snapshot`. |
