package realtime

import (
	"testing"

	"lib/stdid"
)

func newID(t *testing.T) stdid.UUID {
	t.Helper()
	id, err := stdid.New()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func isClosed(c *Conn) bool {
	select {
	case <-c.Done():
		return true
	default:
		return false
	}
}

func TestHub_CloseAll(t *testing.T) {
	h := NewHub()
	a, b := newID(t), newID(t)
	conns := []*Conn{NewConn(a), NewConn(a), NewConn(b)}
	for _, c := range conns {
		h.Register(c)
	}
	if got := h.CloseAll(); got != 3 {
		t.Fatalf("CloseAll = %d, want 3", got)
	}
	for i, c := range conns {
		if !isClosed(c) {
			t.Errorf("conn %d not closed", i)
		}
	}
	// Handlers still unregister normally afterwards.
	h.Unregister(conns[0])
	if !h.Unregister(conns[1]) {
		t.Error("last conn of user a should report lastConn")
	}

	// New connections during shutdown are closed immediately.
	late := NewConn(newID(t))
	h.Register(late)
	if !isClosed(late) || h.ConnCount(late.UserID) != 0 {
		t.Error("connection registered after CloseAll should be closed and not tracked")
	}
	if late.Enqueue([]byte("x")) {
		t.Error("enqueue on a closed conn should fail")
	}
}
