package pg

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// errNoDatabaseHostIP is returned when DNS has no usable address for the database host.
var errNoDatabaseHostIP = fmt.Errorf("database hostname has no IP address")

// resolveDatabaseURL rewrites remote URLs so lib/pq dials a concrete IP (hostaddr),
// preferring IPv4 when available, while keeping the original hostname for TLS (host query param).
func resolveDatabaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw, nil
	}

	u, err := url.Parse(raw)
	if err != nil {
		return raw, nil
	}

	host := u.Hostname()
	if host == "" || host == "localhost" || host == "127.0.0.1" {
		return raw, nil
	}

	q := u.Query()
	if q.Get("hostaddr") != "" {
		return raw, nil
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		return raw, fmt.Errorf("lookup database host %q: %w", host, err)
	}

	var dial net.IP
	for _, ip := range ips {
		if ip4 := ip.To4(); ip4 != nil {
			dial = ip4
			break
		}
	}
	if dial == nil {
		for _, ip := range ips {
			if ip.To4() == nil && ip.To16() != nil {
				dial = ip
				break
			}
		}
	}
	if dial == nil {
		return "", fmt.Errorf(
			"%w: %q — use Neon \"Pooled connection\" URL, add ?hostaddr=<IP>, or use local Postgres (see backend/docker-compose.yml)",
			errNoDatabaseHostIP,
			host,
		)
	}

	port := u.Port()
	if port == "" {
		port = "5432"
	}

	q.Set("host", host)
	q.Set("port", port)
	q.Set("hostaddr", dial.String())

	// lib/pq: put host in query params only so dial uses hostaddr (IPv4).
	out := url.URL{
		Scheme:   u.Scheme,
		User:     u.User,
		Path:     u.Path,
		RawQuery: q.Encode(),
	}
	if out.Path == "" {
		out.Path = "/"
	}

	return out.String(), nil
}
