package pg

import (
	"regexp"
	"strings"
	"testing"
	"testing/fstest"
)

func TestLoadMigrations_SortsAndParses(t *testing.T) {
	fsys := fstest.MapFS{
		"m/0010_ten.sql":        {Data: []byte("SELECT 10;")},
		"m/0002_two_words.sql":  {Data: []byte("SELECT 2;")},
		"m/0001_baseline.sql":   {Data: []byte("SELECT 1;")},
		"m/README.md":           {Data: []byte("docs")},
		"m/notes.txt":           {Data: []byte("ignored")},
		"m/sub/0003_nested.sql": {Data: []byte("ignored: subdirectory")},
	}
	got, err := loadMigrations(fsys, "m")
	if err != nil {
		t.Fatal(err)
	}
	want := []Migration{
		{1, "baseline", "SELECT 1;"},
		{2, "two_words", "SELECT 2;"},
		{10, "ten", "SELECT 10;"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d migrations, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("migration %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestLoadMigrations_RejectsBadFiles(t *testing.T) {
	cases := map[string]fstest.MapFS{
		"duplicate version": {
			"m/0001_a.sql": {Data: []byte("x")},
			"m/0001_b.sql": {Data: []byte("y")},
		},
		"same number different padding": {
			"m/0002_a.sql":  {Data: []byte("x")},
			"m/00002_b.sql": {Data: []byte("y")},
		},
		"missing number": {"m/baseline.sql": {Data: []byte("x")}},
		"short number":   {"m/01_a.sql": {Data: []byte("x")}},
		"uppercase name": {"m/0001_Init.sql": {Data: []byte("x")}},
		"dash in name":   {"m/0001_add-col.sql": {Data: []byte("x")}},
		"zero version":   {"m/0000_zero.sql": {Data: []byte("x")}},
	}
	for name, fsys := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := loadMigrations(fsys, "m"); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestPendingMigrations(t *testing.T) {
	all := []Migration{{Version: 1}, {Version: 2}, {Version: 3}, {Version: 5}}
	cases := []struct {
		name    string
		applied map[int]bool
		want    []int
	}{
		{"fresh db", map[int]bool{}, []int{1, 2, 3, 5}},
		{"partially applied", map[int]bool{1: true, 2: true}, []int{3, 5}},
		{"gap is filled in order", map[int]bool{1: true, 3: true}, []int{2, 5}},
		{"all applied", map[int]bool{1: true, 2: true, 3: true, 5: true}, nil},
		{"db ahead of binary", map[int]bool{1: true, 2: true, 3: true, 5: true, 6: true}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := pendingMigrations(all, c.applied)
			if len(got) != len(c.want) {
				t.Fatalf("got %+v, want versions %v", got, c.want)
			}
			for i, v := range c.want {
				if got[i].Version != v {
					t.Fatalf("got %+v, want versions %v", got, c.want)
				}
			}
		})
	}
}

// The embedded migrations are what ships; keep them well-formed.
func TestEmbeddedMigrations(t *testing.T) {
	all, err := loadMigrations(migrationFiles, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) == 0 {
		t.Fatal("no embedded migrations")
	}
	// The runner wraps each file in its own transaction; a file must not
	// manage transactions itself.
	txStmt := regexp.MustCompile(`(?im)^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;`)
	for i, m := range all {
		if m.Version != i+1 {
			t.Errorf("migration versions must be contiguous from 1: position %d has %04d_%s", i, m.Version, m.Name)
		}
		if strings.TrimSpace(m.SQL) == "" {
			t.Errorf("%04d_%s is empty", m.Version, m.Name)
		}
		if txStmt.MatchString(m.SQL) {
			t.Errorf("%04d_%s must not contain BEGIN/COMMIT/ROLLBACK", m.Version, m.Name)
		}
	}
	if all[0].Name != "baseline" {
		t.Errorf("first migration should be the baseline, got %s", all[0].Name)
	}
}
