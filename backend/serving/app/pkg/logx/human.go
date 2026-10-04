package logx

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

// humanHandler prints one readable line per log record (local dev).
type humanHandler struct {
	w     io.Writer
	level slog.Level
	mu    sync.Mutex
}

func newHumanHandler(w io.Writer, level slog.Level) *humanHandler {
	return &humanHandler{w: w, level: level}
}

func (h *humanHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *humanHandler) Handle(_ context.Context, r slog.Record) error {
	if !h.Enabled(context.Background(), r.Level) {
		return nil
	}

	attrs := collectAttrs(r)
	line := formatHumanLine(r.Time, r.Level, r.Message, attrs)

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := fmt.Fprintln(h.w, line)
	return err
}

func (h *humanHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h
}

func (h *humanHandler) WithGroup(_ string) slog.Handler {
	return h
}

func collectAttrs(r slog.Record) map[string]string {
	out := make(map[string]string)
	r.Attrs(func(a slog.Attr) bool {
		flattenAttr(a, out)
		return true
	})
	return out
}

func flattenAttr(a slog.Attr, out map[string]string) {
	if a.Equal(slog.Attr{}) {
		return
	}
	if a.Value.Kind() == slog.KindGroup {
		for _, ga := range a.Value.Group() {
			flattenAttr(ga, out)
		}
		return
	}
	out[a.Key] = a.Value.String()
}

func formatHumanLine(t time.Time, level slog.Level, msg string, attrs map[string]string) string {
	ts := t.Local().Format("15:04:05")
	lvl := strings.ToUpper(level.String())
	if len(lvl) > 5 {
		lvl = lvl[:5]
	}

	parts := []string{ts, padRight(lvl, 5), msg}

	if err := attrs["err"]; err != "" {
		parts = append(parts, "error="+quoteIfNeeded(err))
	}

	if method, path := attrs["method"], attrs["path"]; method != "" && path != "" {
		status := attrs["status"]
		dur := attrs["duration_ms"]
		httpBit := method + " " + path
		if status != "" {
			httpBit += " → " + status
		}
		if dur != "" {
			httpBit += " (" + dur + "ms)"
		}
		parts = append(parts, httpBit)
	}

	priority := []string{
		"op", "user_id", "chat_id", "message_id", "seq", "plane_id",
		"sender_id", "recipient_id", "count", "recipient_dummy",
		"request_id", "reason", "remote",
	}
	seen := map[string]bool{"err": true, "method": true, "path": true, "status": true, "duration_ms": true}
	for _, k := range priority {
		if v := attrs[k]; v != "" {
			parts = append(parts, k+"="+quoteIfNeeded(v))
			seen[k] = true
		}
	}
	for k, v := range attrs {
		if seen[k] || v == "" {
			continue
		}
		parts = append(parts, k+"="+quoteIfNeeded(v))
	}

	line := strings.Join(parts, "  ")
	return colorize(level, line)
}

func padRight(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return s + strings.Repeat(" ", n-len(s))
}

func quoteIfNeeded(s string) string {
	if s == "" {
		return s
	}
	if strings.ContainsAny(s, " \t\n\"") {
		return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return s
}

func colorize(level slog.Level, line string) string {
	if os.Getenv("NO_COLOR") != "" {
		return line
	}
	switch {
	case level >= slog.LevelError:
		return "\033[31m" + line + "\033[0m"
	case level >= slog.LevelWarn:
		return "\033[33m" + line + "\033[0m"
	case level >= slog.LevelInfo:
		return line
	default:
		return "\033[90m" + line + "\033[0m"
	}
}
