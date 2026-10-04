package logx

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestFormatHumanLine_httpError(t *testing.T) {
	attrs := map[string]string{
		"method":      "POST",
		"path":        "/v1/chats/x/messages",
		"status":      "500",
		"duration_ms": "2834",
		"err":         "pq: invalid input syntax for type json",
		"request_id":  "abc-123",
		"op":          "chats.send",
	}
	line := formatHumanLine(time.Now(), slog.LevelError, "http request failed", attrs)
	if !strings.Contains(line, "POST /v1/chats/x/messages") {
		t.Fatalf("missing path: %s", line)
	}
	if !strings.Contains(line, "500") {
		t.Fatalf("missing status: %s", line)
	}
	if !strings.Contains(line, "chats.send") {
		t.Fatalf("missing op: %s", line)
	}
}
