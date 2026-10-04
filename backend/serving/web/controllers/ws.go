package controllers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"lib/stdid"

	"serving/app/cmd/common"
	"serving/app/pkg/logx"
	"serving/app/pkg/realtime"
	"serving/app/pkg/requestid"
)

const (
	// wsPingInterval keeps NAT / mobile carrier mappings alive and detects
	// dead peers. The client also sends its own app-level pings.
	wsPingInterval = 25 * time.Second
	wsWriteTimeout = 10 * time.Second
)

// wsInbound is a client → server frame. Sending ephemeral events (typing,
// pings) over the socket avoids an HTTP round trip per keystroke.
type wsInbound struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type wsAppStateIn struct {
	Foreground   bool   `json:"foreground"`
	ActiveChatID string `json:"activeChatId"`
}

type wsTypingIn struct {
	ChatID   string `json:"chatId"`
	IsTyping bool   `json:"isTyping"`
}

func RealtimeWS(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("access_token"))
	if token == "" {
		header := r.Header.Get("Authorization")
		if strings.HasPrefix(header, "Bearer ") {
			token = strings.TrimPrefix(header, "Bearer ")
		}
	}
	if token == "" {
		logx.Warn("ws auth failed", "reason", "missing_token", "request_id", requestid.FromContext(r.Context()))
		http.Error(w, "missing access token", http.StatusUnauthorized)
		return
	}
	userID, err := common.Tokens.ParseAccess(token)
	if err != nil {
		logx.Warn("ws auth failed", "reason", "invalid_token", "request_id", requestid.FromContext(r.Context()))
		http.Error(w, "invalid access token", http.StatusUnauthorized)
		return
	}

	// http.Server Read/WriteTimeout deadlines survive the hijack; without
	// clearing them every socket is killed after ~60s.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		CompressionMode:    websocket.CompressionDisabled,
	})
	if err != nil {
		logx.Error("ws accept failed", err, "request_id", requestid.FromContext(r.Context()))
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	logx.Info("ws connected", "user_id", userID.String(), "request_id", requestid.FromContext(r.Context()))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	rtConn := realtime.NewConn(userID)
	firstConn := common.Realtime.ConnCount(userID) == 0
	common.Realtime.Register(rtConn)
	if common.Chats != nil && firstConn {
		go common.Chats.OnRealtimeConnect(context.Background(), userID)
	}
	defer func() {
		if common.Realtime.Unregister(rtConn) && common.Chats != nil {
			go common.Chats.OnRealtimeDisconnect(context.Background(), userID)
		}
	}()

	go wsWriteLoop(ctx, cancel, conn, rtConn)

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			logx.Info("ws closed", "user_id", userID.String(), "request_id", requestid.FromContext(r.Context()))
			return
		}
		handleWSInbound(ctx, userID, rtConn, data)
	}
}

func wsWriteLoop(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, rtConn *realtime.Conn) {
	defer cancel()
	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-rtConn.Done():
			_ = conn.Close(websocket.StatusPolicyViolation, "slow consumer")
			return
		case frame := <-rtConn.Outbound():
			wctx, wcancel := context.WithTimeout(ctx, wsWriteTimeout)
			err := conn.Write(wctx, websocket.MessageText, frame)
			wcancel()
			if err != nil {
				return
			}
		case <-ticker.C:
			pctx, pcancel := context.WithTimeout(ctx, wsWriteTimeout)
			err := conn.Ping(pctx)
			pcancel()
			if err != nil {
				return
			}
		}
	}
}

func handleWSInbound(ctx context.Context, userID stdid.UUID, rtConn *realtime.Conn, data []byte) {
	var in wsInbound
	if err := json.Unmarshal(data, &in); err != nil {
		return
	}
	switch in.Type {
	case "ping":
		if frame, err := realtime.Frame("pong", map[string]any{}); err == nil {
			rtConn.Enqueue(frame)
		}
	case "app_state":
		var st wsAppStateIn
		if err := json.Unmarshal(in.Data, &st); err != nil {
			return
		}
		rtConn.SetAppState(st.Foreground, strings.ToLower(strings.TrimSpace(st.ActiveChatID)))
	case "typing":
		var t wsTypingIn
		if err := json.Unmarshal(in.Data, &t); err != nil || common.Chats == nil {
			return
		}
		chatID, err := stdid.Parse(strings.TrimSpace(t.ChatID))
		if err != nil {
			return
		}
		_ = common.Chats.Typing(ctx, userID, chatID, t.IsTyping)
	}
}
