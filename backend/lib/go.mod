module lib

go 1.25.0

// Third-party modules are kept at the lib boundary for audit/vendor:
// Postgres driver and golang.org/x/crypto (bcrypt for stdpasswd).
require (
	github.com/lib/pq v1.10.9
	golang.org/x/crypto v0.54.0
)
