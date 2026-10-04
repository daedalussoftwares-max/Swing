package realtime

import (
	"encoding/json"
	"sync"

	"lib/stdid"
)

// sendBuffer is how many outbound frames a single socket may have queued
// before it is considered a slow consumer and dropped. The client resyncs
// via HTTP on reconnect, so dropping a stuck socket never loses data.
const sendBuffer = 256

// Hub fans out JSON events to every live WebSocket for a given account.
//
// Broadcasts never block on network I/O: each connection owns a buffered
// queue drained by its own writer goroutine (see controllers.RealtimeWS).
// That keeps HTTP handlers (send message, typing, read receipts) fast even
// when the partner is on a flaky mobile network.
type Hub struct {
	mu    sync.RWMutex
	conns map[stdid.UUID]map[*Conn]struct{}
}

func NewHub() *Hub {
	return &Hub{conns: make(map[stdid.UUID]map[*Conn]struct{})}
}

type Conn struct {
	UserID stdid.UUID

	stateMu      sync.Mutex
	foreground   bool
	activeChatID string

	out       chan []byte
	closeOnce sync.Once
	done      chan struct{}
}

func NewConn(userID stdid.UUID) *Conn {
	return &Conn{
		UserID:     userID,
		foreground: true,
		out:        make(chan []byte, sendBuffer),
		done:       make(chan struct{}),
	}
}

// SetAppState records what the client reported: whether the app is in
// the foreground and which chat (if any) is on screen.
func (c *Conn) SetAppState(foreground bool, activeChatID string) {
	c.stateMu.Lock()
	c.foreground = foreground
	c.activeChatID = activeChatID
	c.stateMu.Unlock()
}

func (c *Conn) appState() (bool, string) {
	c.stateMu.Lock()
	defer c.stateMu.Unlock()
	return c.foreground, c.activeChatID
}

// Outbound is the queue the socket writer drains.
func (c *Conn) Outbound() <-chan []byte { return c.out }

// Done is closed when the hub gives up on this connection (slow consumer).
func (c *Conn) Done() <-chan struct{} { return c.done }

func (c *Conn) Close() {
	c.closeOnce.Do(func() { close(c.done) })
}

// Enqueue queues a raw frame without blocking. Returns false when the
// connection is closed or its queue is full (and closes it in that case).
func (c *Conn) Enqueue(frame []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}
	select {
	case c.out <- frame:
		return true
	default:
		c.Close()
		return false
	}
}

func (h *Hub) Register(c *Conn) {
	if c == nil || c.UserID.IsZero() {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.UserID]
	if set == nil {
		set = make(map[*Conn]struct{})
		h.conns[c.UserID] = set
	}
	set[c] = struct{}{}
}

// Unregister removes the connection and reports whether the user has no
// other live sockets left (i.e. they actually went offline).
func (h *Hub) Unregister(c *Conn) (lastConn bool) {
	if c == nil || c.UserID.IsZero() {
		return false
	}
	c.Close()
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.UserID]
	if set == nil {
		return true
	}
	delete(set, c)
	if len(set) == 0 {
		delete(h.conns, c.UserID)
		return true
	}
	return false
}

// ConnCount returns how many live sockets the user has.
func (h *Hub) ConnCount(userID stdid.UUID) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID])
}

func (h *Hub) IsOnline(userID stdid.UUID) bool {
	if userID.IsZero() {
		return false
	}
	return h.ConnCount(userID) > 0
}

// IsForeground reports whether any of the user's sockets belongs to an
// app that is currently in the foreground. Push notifications are only
// needed when this is false.
func (h *Hub) IsForeground(userID stdid.UUID) bool {
	for _, c := range h.snapshot(userID) {
		if fg, _ := c.appState(); fg {
			return true
		}
	}
	return false
}

// IsViewingChat reports whether the user has this chat open on screen in
// a foregrounded app.
func (h *Hub) IsViewingChat(userID stdid.UUID, chatID string) bool {
	for _, c := range h.snapshot(userID) {
		if fg, active := c.appState(); fg && active != "" && active == chatID {
			return true
		}
	}
	return false
}

func (h *Hub) snapshot(userID stdid.UUID) []*Conn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	set := h.conns[userID]
	out := make([]*Conn, 0, len(set))
	for c := range set {
		out = append(out, c)
	}
	return out
}

// Frame encodes an event envelope once so it can be fanned out cheaply.
func Frame(eventType string, payload any) ([]byte, error) {
	return json.Marshal(map[string]any{
		"type": eventType,
		"data": payload,
	})
}

func (h *Hub) BroadcastToUser(userID stdid.UUID, eventType string, payload any) {
	if userID.IsZero() {
		return
	}
	body, err := Frame(eventType, payload)
	if err != nil {
		return
	}
	for _, c := range h.snapshot(userID) {
		c.Enqueue(body)
	}
}
