package pg

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// errIPv6OnlyHost is returned when DNS has no A record for the database host.
var errIPv6OnlyHost = fmt.Errorf("database hostname has no IPv4 address")

// resolveDatabaseURL rewrites Neon-style URLs so lib/pq dials IPv4 (hostaddr)
// while keeping the original hostname for TLS (host query param).
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

	var v4 net.IP
	for _, ip := range ips {
		if ip4 := ip.To4(); ip4 != nil {
			v4 = ip4
			break
		}
	}
	if v4 == nil {
		return "", fmt.Errorf(
			"%w: %q — use Neon \"Pooled connection\" URL, add ?hostaddr=<IPv4>, or use local Postgres (see postman/README or docker-compose)",
			errIPv6OnlyHost,
			host,
		)
	}

	port := u.Port()
	if port == "" {
		port = "5432"
	}

	q.Set("host", host)
	q.Set("port", port)
	q.Set("hostaddr", v4.String())

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
