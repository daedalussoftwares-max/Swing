/**
 * Single shared WebSocket to /v1/ws.
 *
 * - Reconnects forever with capped, jittered backoff (mobile networks drop
 *   sockets constantly; giving up means chat silently stops updating).
 * - Reconnects immediately when the app returns to the foreground.
 * - App-level heartbeat detects half-open sockets that never fire `onclose`.
 * - `onRealtimeStatus` lets consumers resync over HTTP after a reconnect so
 *   nothing sent while the socket was down is missed.
 * - `sendRealtime` carries cheap ephemeral events (typing) without an HTTP
 *   round trip.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { getApiBaseUrl } from '@/lib/api/client';
import { getFreshAccessToken } from '@/lib/api/session';
import { logFailure } from '@/lib/debug-logger';

export type RealtimeHandler = (type: string, data: unknown) => void;
export type RealtimeStatusHandler = (connected: boolean) => void;

const HEARTBEAT_MS = 20_000;
/** No frame (incl. pong) for this long → socket is dead, reconnect. */
const STALE_MS = 50_000;
const MAX_BACKOFF_MS = 15_000;

let socket: WebSocket | null = null;
let connected = false;
let wanted = false;
let connecting = false;
let handlers: RealtimeHandler[] = [];
let statusHandlers: RealtimeStatusHandler[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
let lastFrameAt = 0;
let appStateSub: { remove: () => void } | null = null;
let activeChatId: string | null = null;

/** Tells the server whether we're foreground and which chat is on screen,
 *  so it only sends push notifications when they're actually useful. */
function sendAppState() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(
      JSON.stringify({
        type: 'app_state',
        data: {
          foreground: AppState.currentState === 'active',
          activeChatId: activeChatId ?? '',
        },
      }),
    );
  } catch {
    /* onclose will handle it */
  }
}

export function setRealtimeActiveChat(chatId: string | null) {
  activeChatId = chatId ? chatId.toLowerCase() : null;
  sendAppState();
}

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const h of statusHandlers) h(next);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastFrameAt > STALE_MS) {
      dropSocket();
      scheduleReconnect(0);
      return;
    }
    try {
      socket.send(JSON.stringify({ type: 'ping' }));
    } catch {
      /* onclose will handle it */
    }
  }, HEARTBEAT_MS);
}

function dropSocket() {
  stopHeartbeat();
  if (socket) {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
  setConnected(false);
}

function scheduleReconnect(delayOverride?: number) {
  clearReconnectTimer();
  if (!wanted) return;
  const base = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** reconnectAttempts);
  const delayMs = delayOverride ?? base / 2 + Math.random() * (base / 2);
  reconnectAttempts = Math.min(reconnectAttempts + 1, 10);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void open();
  }, delayMs);
}

function wsUrl(accessToken: string): string {
  const base = getApiBaseUrl().replace(/^http/, 'ws');
  return `${base}/v1/ws?access_token=${encodeURIComponent(accessToken)}`;
}

async function open(): Promise<void> {
  if (!wanted || connecting) return;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  connecting = true;
  let accessToken: string | null;
  try {
    accessToken = await getFreshAccessToken();
  } catch {
    accessToken = null;
  } finally {
    connecting = false;
  }
  if (!wanted) return;
  if (!accessToken) {
    scheduleReconnect();
    return;
  }

  clearReconnectTimer();
  dropSocket();

  const ws = new WebSocket(wsUrl(accessToken));
  socket = ws;
  ws.onopen = () => {
    if (socket !== ws) return;
    reconnectAttempts = 0;
    lastFrameAt = Date.now();
    startHeartbeat();
    sendAppState();
    setConnected(true);
  };
  ws.onerror = () => {
    if (socket !== ws) return;
    logFailure({
      kind: 'ws',
      message: 'WebSocket connection error',
      path: '/v1/ws',
    });
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    stopHeartbeat();
    setConnected(false);
    scheduleReconnect();
  };
  ws.onmessage = (ev) => {
    if (socket !== ws) return;
    lastFrameAt = Date.now();
    let parsed: { type?: string; data?: unknown };
    try {
      parsed = JSON.parse(String(ev.data));
    } catch {
      logFailure({
        kind: 'ws',
        message: 'Malformed WebSocket payload',
        path: '/v1/ws',
      });
      return;
    }
    if (!parsed.type || parsed.type === 'pong') return;
    for (const h of handlers) {
      try {
        h(parsed.type, parsed.data);
      } catch (e) {
        logFailure({
          kind: 'ws',
          message: `Realtime handler failed: ${String(e)}`,
          path: '/v1/ws',
        });
      }
    }
  };
}

function onAppStateChange(state: AppStateStatus) {
  sendAppState();
  if (state !== 'active' || !wanted) return;
  // Sockets are frequently killed while backgrounded without a close
  // event reaching JS — reconnect right away on resume.
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    reconnectAttempts = 0;
    clearReconnectTimer();
    void open();
  } else if (Date.now() - lastFrameAt > HEARTBEAT_MS) {
    try {
      socket.send(JSON.stringify({ type: 'ping' }));
    } catch {
      dropSocket();
      void open();
    }
  }
}

/** Idempotent — safe to call from every provider that needs realtime. */
export async function connectRealtime(): Promise<void> {
  wanted = true;
  if (!appStateSub) {
    appStateSub = AppState.addEventListener('change', onAppStateChange);
  }
  await open();
}

export function disconnectRealtime() {
  wanted = false;
  clearReconnectTimer();
  reconnectAttempts = 0;
  appStateSub?.remove();
  appStateSub = null;
  if (socket) {
    const ws = socket;
    dropSocket();
    try {
      ws.close(1000);
    } catch {
      /* ignore */
    }
  }
}

export function isRealtimeConnected() {
  return connected;
}

/** Fire-and-forget event to the server. Returns false if not connected. */
export function sendRealtime(type: string, data: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify({ type, data }));
    return true;
  } catch {
    return false;
  }
}

export function onRealtime(handler: RealtimeHandler) {
  handlers.push(handler);
  return () => {
    handlers = handlers.filter((h) => h !== handler);
  };
}

/** Notified on every connect / disconnect transition. */
export function onRealtimeStatus(handler: RealtimeStatusHandler) {
  statusHandlers.push(handler);
  return () => {
    statusHandlers = statusHandlers.filter((h) => h !== handler);
  };
}
