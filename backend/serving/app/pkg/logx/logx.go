// Package logx provides structured server logging (stdlib slog).
package logx

import (
	"log/slog"
	"net/http"
	"os"

	"serving/app/pkg/requestid"
)

var logger *slog.Logger

func defaultLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
}

// Init sets log level and format. Dev/local uses human-readable lines; prod uses JSON.
func Init(dev bool) {
	level := slog.LevelInfo
	if dev {
		level = slog.LevelDebug
	}
	if dev || os.Getenv("SWING_LOG_TEXT") == "1" {
		logger = slog.New(newHumanHandler(os.Stdout, level))
		return
	}
	logger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
}

func ensureLogger() *slog.Logger {
	if logger == nil {
		logger = defaultLogger()
	}
	return logger
}

func Info(msg string, attrs ...any) {
	ensureLogger().Info(msg, attrs...)
}

func Warn(msg string, attrs ...any) {
	ensureLogger().Warn(msg, attrs...)
}

func Error(msg string, err error, attrs ...any) {
	args := attrs
	if err != nil {
		args = append([]any{"err", err.Error()}, args...)
	}
	ensureLogger().Error(msg, args...)
}

// RequestAttrs returns common HTTP fields for logs (no bodies, no passwords).
func RequestAttrs(r *http.Request) []any {
	if r == nil {
		return nil
	}
	attrs := []any{
		"method", r.Method,
		"path", r.URL.Path,
		"remote", r.RemoteAddr,
	}
	if id := requestid.FromContext(r.Context()); id != "" {
		attrs = append(attrs, "request_id", id)
	}
	return attrs
}
