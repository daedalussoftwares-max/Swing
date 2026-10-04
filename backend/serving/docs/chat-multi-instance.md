# Chat realtime with multiple backend instances

Today the realtime `Hub` is **in-process memory**. WebSocket connections and `hub.BroadcastToUser` only reach clients attached to **that** process.

## What breaks with 2+ instances

- User A on instance 1 sends a message; user B’s socket on instance 2 never receives `message.new`, `message.ack`, `typing`, or `presence.update`.
- Push stub may fire on the wrong instance’s view of “offline” (`IsOnline` is local only).
- Idempotent sends and Postgres state remain correct; only **delivery fan-out** is wrong.

## Later fix (Neon, no Redis)

1. Open a **dedicated `LISTEN` connection** to Postgres (Neon **direct** connection string, not pooler) in each instance.
2. On every event that today calls `hub.BroadcastToUser`, also `NOTIFY swing_chat`, payload JSON: `{type, user_id, data}`.
3. Each instance runs `LISTEN swing_chat`; on notification, decode and call local `hub.BroadcastToUser` for that `user_id`.
4. Keep `Hub` as the local fan-out layer; Postgres NOTIFY is the cross-instance bus (best-effort, low volume for 1:1 chat).

Optional: use a single row in `notifications` or an `outbox` table instead of NOTIFY if you need durability and replay.

## Socket protocol notes

- Server → client frames are `{"type": ..., "data": ...}`. Each socket has its own bounded send queue; a client that stops reading is disconnected (it resyncs over HTTP on reconnect), so broadcasts never block request handlers.
- Client → server frames: `{"type":"ping"}` (answered with `pong`) and `{"type":"typing","data":{"chatId":"…","isTyping":true}}`. Typing goes over the socket instead of `POST /v1/chats/{id}/typing` to avoid an HTTP round trip per keystroke; the HTTP route remains as a fallback.
- The handler clears the `http.Server` read/write deadlines before upgrading; otherwise every socket is cut at `server.read_timeout`.
- Chat membership (`account_a`/`account_b`) is cached in-process. It never changes after creation, so the cache is safe across instances.
