package accesslog

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"time"

	"serving/app/pkg/logx"
	"serving/app/pkg/requestid"
	"serving/config"
	"serving/web/middlewares/bearer"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the underlying connection
// (the WebSocket handler clears server read/write deadlines through it).
func (w *statusWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// WebSocket upgrade requires http.Hijacker on the same ResponseWriter chain.
func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("http.Hijacker not implemented")
	}
	return hj.Hijack()
}

func (w *statusWriter) Flush() {
	if fl, ok := w.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

// Middleware logs one line per HTTP request (no bodies). 4xx/5xx at warn/error.
func Middleware(next http.Handler) http.Handler {
	debugHTTP := config.DebugHTTP()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 0}
		next.ServeHTTP(sw, r)

		status := sw.status
		if status == 0 {
			status = http.StatusOK
		}
		dur := time.Since(start)
		reqID := requestid.FromContext(r.Context())

		attrs := []any{
			"request_id", reqID,
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"duration_ms", dur.Milliseconds(),
		}
		if uid, ok := bearer.UserIDFromContext(r.Context()); ok {
			attrs = append(attrs, "user_id", uid.String())
		}
		if debugHTTP {
			attrs = append(attrs, "query", r.URL.RawQuery)
			attrs = append(attrs, "remote", r.RemoteAddr)
		}

		// Upgraded connections (WebSocket) may never call WriteHeader on the wrapper.
		if status == 0 && r.Header.Get("Upgrade") != "" {
			status = http.StatusSwitchingProtocols
		}

		switch {
		case status >= 500:
			logx.Error("request failed", nil, attrs...)
		case status >= 400:
			logx.Warn("request rejected", attrs...)
		case debugHTTP:
			logx.Info("request", attrs...)
		}
	})
}
