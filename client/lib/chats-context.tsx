/**
 * Chats — backed by /v1/chats + WebSocket chat events.
 *
 * Design notes (why it is shaped like this):
 * - Every send is optimistic and goes through a per-chat FIFO queue, so
 *   rapid-fire messages keep their order and never block the UI.
 * - Failed sends stay in the thread as `failed` (tap to retry) instead of
 *   vanishing behind an alert.
 * - Message status only ever moves forward (sending → sent → delivered →
 *   seen) no matter which of HTTP response / WS ack / receipt lands first.
 * - Delivered + read receipts are batched and debounced.
 * - After every WebSocket reconnect we resync over HTTP, so nothing sent
 *   while the socket was down is lost.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Alert, AppState } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { InAppMessageBanner } from '@/components/in-app-message-banner';
import { useAuth } from '@/lib/auth-context';
import type {
  ApiChatMessage,
  ApiChatMedia,
  ApiChatSummary,
} from '@/lib/api/chats-api';
import {
  deleteChatMessage,
  editChatMessage,
  listChatMessages,
  listChats,
  markChatDelivered,
  markChatRead,
  removeChatReaction,
  sendChatMessage,
  deleteChatApi,
  openViewOnceApi,
  sendChatTyping,
  setChatPinned,
  setChatReaction,
  setUserBlocked,
} from '@/lib/api/chats-api';
import type {
  RealtimeBlockUpdated,
  RealtimeChatDeleted,
  RealtimeChatUpdated,
  RealtimeMessageAck,
  RealtimeMessageDeleted,
  RealtimeMessageEdited,
  RealtimeMessageNew,
  RealtimeMessageReaction,
  RealtimeMessageStatus,
  RealtimeMessageViewed,
  RealtimePresenceUpdate,
  RealtimeTyping,
} from '@/lib/chat-realtime-types';
import {
  connectRealtime,
  disconnectRealtime,
  onRealtime,
  onRealtimeStatus,
  sendRealtime,
  setRealtimeActiveChat,
} from '@/lib/realtime-ws';
import { isPlaneAcceptedNotification } from '@/lib/realtime-notification-sync';
import { newRequestId } from '@/lib/request-id';
import { ApiError } from '@/lib/api/client';
import { isLocalMediaUri, uploadChatMedia } from '@/lib/upload-media';
import { logFailure } from '@/lib/debug-logger';
import type {
  Chat,
  ChatMessage,
  ChatMessageKind,
  ChatMessageStatus,
} from '@/types/chat';
import type { Plane } from '@/types/plane';

function normChatId(id: string): string {
  return id.trim().toLowerCase();
}

export type SendPayload = {
  kind?: ChatMessageKind;
  text?: string;
  imageUri?: string;
  audioUri?: string;
  audioDurationMs?: number;
  mediaKey?: string;
  replyToMessageId?: string;
  viewOnce?: boolean;
};

/** Everything you can DO with chats. The object is stable: components that
 *  only need actions never re-render because a message arrived. */
export type ChatsActions = {
  refresh: () => Promise<void>;
  getChat: (chatId: string) => Chat | undefined;
  /** Fetches the latest page if not loaded yet, otherwise a delta. */
  loadMessages: (chatId: string) => Promise<void>;
  loadOlderMessages: (chatId: string) => Promise<void>;
  syncChatDelta: (chatId: string) => Promise<void>;
  acceptPlane: (plane: Plane, chatId: string) => Promise<Chat>;
  sendMessage: (chatId: string, payload: SendPayload | string) => Promise<void>;
  retryMessage: (chatId: string, clientMsgId: string) => void;
  discardMessage: (chatId: string, clientMsgId: string) => void;
  editMessage: (chatId: string, messageId: string, newText: string) => void;
  deleteMessage: (chatId: string, messageId: string) => void;
  openViewOnce: (chatId: string, messageId: string) => Promise<string | null>;
  markChatOpened: (chatId: string) => void;
  /** The chat currently on screen (incoming messages are read instantly). */
  setActiveChat: (chatId: string | null) => void;
  setTyping: (chatId: string, isTyping: boolean) => void;
  addReaction: (chatId: string, messageId: string, emoji: string) => void;
  pinChat: (chatId: string) => void;
  unpinChat: (chatId: string) => void;
  /** Deletes the conversation for both people. */
  deleteChat: (chatId: string) => void;
  blockChat: (chatId: string) => void;
  unblockChat: (chatId: string) => void;
  setUserBlockedState: (userId: string, blocked: boolean) => Promise<void>;
  /** In-app banner feed: partner messages for chats not on screen. */
  subscribeIncoming: (fn: IncomingListener) => () => void;
};

type ChatsMeta = {
  loading: boolean;
  /** False until the first chat-list fetch (or cache restore) after sign-in. */
  loaded: boolean;
};

/** Back-compat shape of `useChats()` (subscribes to everything). */
type ChatsContextValue = ChatsActions & ChatsMeta & { chats: Chat[] };

/** Tiny external store: chats live outside React state so each screen can
 *  subscribe to just the slice it renders (see the selector hooks). */
type ChatsStore = {
  get: () => Chat[];
  subscribe: (fn: () => void) => () => void;
};

export type IncomingMessageEvent = {
  chatId: string;
  partnerName: string;
  partnerAvatarUrl?: string;
  preview: string;
};

type IncomingListener = (e: IncomingMessageEvent) => void;

const ActionsContext = createContext<ChatsActions | null>(null);
const StoreContext = createContext<ChatsStore | null>(null);
const MetaContext = createContext<ChatsMeta>({ loading: false, loaded: false });

const PAGE_SIZE = 50;
/** On-device cache of the chat list (+ latest messages) for instant start. */
const CACHE_PREFIX = 'swing.chats.v1:';
const CACHE_MESSAGES_PER_CHAT = 30;
const CACHE_WRITE_DEBOUNCE_MS = 1_000;

/** What we persist: confirmed messages only, newest N per chat. */
function toCacheable(chats: Chat[]): Chat[] {
  return chats.map((chat) => {
    const confirmed = chat.messages.filter(
      (m) => m.seq != null && m.status !== 'failed' && m.status !== 'sending',
    );
    const kept = confirmed.slice(-CACHE_MESSAGES_PER_CHAT);
    const keptMax = maxSeqOf(kept);
    return {
      ...chat,
      partnerTyping: false,
      messages: kept,
      hasOlder: chat.hasOlder || confirmed.length > kept.length,
      lastSyncedSeq: chat.historyLoaded ? keptMax : chat.lastSyncedSeq,
    };
  });
}
/** Partner "typing…" auto-clears if the stop event never arrives. */
const TYPING_TTL_MS = 6_000;
const RECEIPT_DEBOUNCE_MS = 250;

function nowIso() {
  return new Date().toISOString();
}

function mapKind(type: string): ChatMessageKind {
  if (type === 'image') return 'image';
  if (type === 'audio') return 'audio';
  return 'text';
}

const STATUS_RANK: Record<ChatMessageStatus, number> = {
  failed: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  seen: 4,
};

function maxStatus(
  a: ChatMessageStatus,
  b: ChatMessageStatus,
): ChatMessageStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function tickStatus(m: ApiChatMessage, myUserId: string): ChatMessageStatus {
  if (m.senderId !== myUserId) {
    return 'delivered';
  }
  const partner = m.status?.find((s) => s.accountId !== myUserId);
  if (!partner) return 'sent';
  if (partner.readAt) return 'seen';
  if (partner.deliveredAt) return 'delivered';
  return 'sent';
}

function apiMessageToLocal(m: ApiChatMessage, myUserId: string): ChatMessage {
  const kind = mapKind(m.type);
  const text = m.deletedAt ? '' : (m.body ?? (kind === 'text' ? '' : kind));
  const local: ChatMessage = {
    id: m.id,
    seq: m.seq,
    clientMsgId: m.clientMsgId,
    authorId: m.senderId === myUserId ? 'me' : m.senderId,
    kind,
    text: typeof text === 'string' ? text : '',
    createdAt: m.createdAt,
    status: tickStatus(m, myUserId),
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    replyToMessageId: m.replyToId,
    viewOnce: m.viewOnce || undefined,
    viewedAt: m.viewedAt,
  };
  if (m.media?.url) {
    if (kind === 'image') local.imageUri = m.media.url;
    if (kind === 'audio') local.audioUri = m.media.url;
    local.mediaKey = m.media.r2_key;
  }
  if (m.media?.duration) {
    local.audioDurationMs = m.media.duration;
  }
  const theirs = m.reactions?.find((r) => r.accountId !== myUserId);
  if (theirs?.emoji) {
    local.reaction = theirs.emoji;
  }
  return local;
}

/**
 * Canonical thread order. Confirmed messages are ordered by server seq.
 * A pending/failed message (no seq yet) keeps the spot where it was sent:
 * right after the confirmed message it was anchored to (`anchorSeq`), so
 * later messages appear BELOW a failed one instead of it jumping to the
 * bottom. Anchoring on seq (not timestamps) is immune to device clock skew.
 */
function orderMessages(list: ChatMessage[]): ChatMessage[] {
  const confirmed: ChatMessage[] = [];
  const pending: ChatMessage[] = [];
  for (const m of list) (m.seq != null ? confirmed : pending).push(m);
  confirmed.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (pending.length === 0) return confirmed;
  pending.sort((a, b) => {
    const d = (a.anchorSeq ?? 0) - (b.anchorSeq ?? 0);
    return d !== 0 ? d : a.createdAt.localeCompare(b.createdAt);
  });
  const out: ChatMessage[] = [];
  let i = 0;
  for (const m of confirmed) {
    while (i < pending.length && (pending[i].anchorSeq ?? 0) < (m.seq ?? 0)) {
      out.push(pending[i++]);
    }
    out.push(m);
  }
  while (i < pending.length) out.push(pending[i++]);
  return out;
}

/** Server copy wins for content, but local-only bits are preserved. */
function reconcile(prev: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  if (!prev) return next;
  return {
    ...next,
    status: maxStatus(prev.status, next.status),
    // Keep the already-rendered local file while the presigned URL is new,
    // so the bubble doesn't flash/reload right after sending.
    imageUri: prev.imageUri && prev.authorId === 'me' ? prev.imageUri : next.imageUri,
    audioUri: prev.audioUri && prev.authorId === 'me' ? prev.audioUri : next.audioUri,
    audioDurationMs: next.audioDurationMs ?? prev.audioDurationMs,
    viewOnce: next.viewOnce ?? prev.viewOnce,
    viewedAt: next.viewedAt ?? prev.viewedAt,
    reaction: next.reaction ?? prev.reaction,
  };
}

function mergeMessages(
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  const idByClient = new Map<string, string>();
  for (const m of existing) {
    if (m.clientMsgId) idByClient.set(m.clientMsgId, m.id);
  }
  for (const m of incoming) {
    let prev = byId.get(m.id);
    if (!prev && m.clientMsgId) {
      const localId = idByClient.get(m.clientMsgId);
      if (localId) {
        prev = byId.get(localId);
        byId.delete(localId);
      }
    }
    byId.set(m.id, reconcile(prev, m));
  }
  return orderMessages([...byId.values()]);
}

function maxSeqOf(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) n = Math.max(n, m.seq ?? 0);
  return n;
}

function minSeqOf(messages: ChatMessage[]): number | undefined {
  let n: number | undefined;
  for (const m of messages) {
    if (m.seq != null && (n == null || m.seq < n)) n = m.seq;
  }
  return n;
}

function partnerOnline(s: ApiChatSummary): boolean {
  return !!s.partner.online;
}

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const myUserId = user?.id ?? '';
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const incomingListeners = useRef(new Set<IncomingListener>());
  const fetchedOnce = useRef(false);
  const cacheUserRef = useRef<string | null>(null);

  // Source of truth for chats. Writes are applied synchronously, so reads
  // right after a write (even across `await`) see the new value, and only
  // subscribers whose slice changed re-render.
  const chatsRef = useRef<Chat[]>([]);
  const [listeners] = useState(() => new Set<() => void>());
  const [store] = useState<ChatsStore>(() => ({
    get: () => chatsRef.current,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  }));
  const setChats = useCallback(
    (updater: (prev: Chat[]) => Chat[]) => {
      const next = updater(chatsRef.current);
      if (next === chatsRef.current) return;
      chatsRef.current = next;
      for (const fn of listeners) fn();
    },
    [listeners],
  );

  const activeChatRef = useRef<string | null>(null);
  const sendQueues = useRef(new Map<string, Promise<void>>());
  const pendingPayloads = useRef(new Map<string, SendPayload>());
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const deliverQueue = useRef(new Map<string, Set<string>>());
  const deliverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastReadSent = useRef(new Map<string, number>());
  const loadingHistory = useRef(new Set<string>());

  const findChat = useCallback((chatId: string) => {
    const key = normChatId(chatId);
    return chatsRef.current.find((c) => normChatId(c.id) === key);
  }, []);

  const updateChat = useCallback(
    (chatId: string, updater: (chat: Chat) => Chat) => {
      const key = normChatId(chatId);
      setChats((prev) => {
        let changed = false;
        const next = prev.map((chat) => {
          if (normChatId(chat.id) !== key) return chat;
          const updated = updater(chat);
          if (updated !== chat) changed = true;
          return updated;
        });
        return changed ? next : prev;
      });
    },
    [setChats],
  );

  // ── Receipts ──────────────────────────────────────────────────────────

  const flushDelivered = useCallback(() => {
    deliverTimer.current = null;
    const batches = [...deliverQueue.current.entries()];
    deliverQueue.current.clear();
    for (const [chatId, ids] of batches) {
      if (ids.size === 0) continue;
      void markChatDelivered(chatId, [...ids]).catch(() => {});
    }
  }, []);

  const queueDelivered = useCallback(
    (chatId: string, ids: string[]) => {
      if (ids.length === 0) return;
      let set = deliverQueue.current.get(chatId);
      if (!set) {
        set = new Set();
        deliverQueue.current.set(chatId, set);
      }
      for (const id of ids) set.add(id);
      if (!deliverTimer.current) {
        deliverTimer.current = setTimeout(flushDelivered, RECEIPT_DEBOUNCE_MS);
      }
    },
    [flushDelivered],
  );

  /** Debounced read receipt up to the newest loaded message. */
  const scheduleRead = useCallback(
    (chatId: string) => {
      const key = normChatId(chatId);
      const existing = readTimers.current.get(key);
      if (existing) clearTimeout(existing);
      readTimers.current.set(
        key,
        setTimeout(() => {
          readTimers.current.delete(key);
          const chat = findChat(chatId);
          if (!chat) return;
          const upTo = Math.max(maxSeqOf(chat.messages), chat.lastSyncedSeq ?? 0);
          if (upTo <= (lastReadSent.current.get(key) ?? 0)) return;
          lastReadSent.current.set(key, upTo);
          void markChatRead(chat.id, upTo).catch(() => {
            lastReadSent.current.delete(key);
          });
        }, RECEIPT_DEBOUNCE_MS),
      );
    },
    [findChat],
  );

  const isViewing = useCallback((chatId: string) => {
    return (
      activeChatRef.current != null &&
      normChatId(activeChatRef.current) === normChatId(chatId) &&
      AppState.currentState === 'active'
    );
  }, []);

  // ── Loading ───────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (status !== 'signed-in' || !myUserId) {
      return;
    }
    setLoading(true);
    try {
      const summaries = await listChats();
      setChats((prev) => {
        const byId = new Map(prev.map((c) => [normChatId(c.id), c]));
        return summaries.map((s) => {
          const existing = byId.get(normChatId(s.id));
          let messages = existing?.messages ?? [];
          if (s.lastMessage) {
            // Seed the list preview without pretending history is loaded.
            messages = mergeMessages(messages, [
              apiMessageToLocal(s.lastMessage, myUserId),
            ]);
          }
          const viewing = isViewing(s.id);
          return {
            id: s.id,
            nextSeq: s.nextSeq,
            lastSyncedSeq: existing?.lastSyncedSeq,
            historyLoaded: existing?.historyLoaded,
            hasOlder: existing?.hasOlder,
            partner: {
              ...(existing?.partner ?? {}),
              id: s.partner.id,
              name: s.partner.name,
              avatarUrl: s.partner.avatarUrl,
              distanceKm: existing?.partner.distanceKm ?? 0,
              ageBadge: existing?.partner.ageBadge ?? '',
              city: s.partner.city,
              country: s.partner.country,
              onlineNow: partnerOnline(s) && !s.blockedByMe,
            },
            messages,
            unreadCount: viewing ? 0 : s.unreadCount,
            partnerTyping: existing?.partnerTyping ?? false,
            createdAt: s.createdAt,
            pinnedAt: s.pinnedAt,
            isBlocked: !!s.blockedByMe,
          };
        });
      });
    } catch {
      logFailure({
        kind: 'api',
        message: 'Failed to load chat list',
        path: '/v1/chats',
      });
    } finally {
      setLoading(false);
      setLoaded(true);
      fetchedOnce.current = true;
    }
  }, [status, myUserId, setChats, isViewing]);

  // Instant start: show the cached list while the network refresh runs.
  useEffect(() => {
    if (status !== 'signed-in' || !myUserId) return;
    cacheUserRef.current = myUserId;
    let cancelled = false;
    void AsyncStorage.getItem(CACHE_PREFIX + myUserId)
      .then((raw) => {
        if (cancelled || !raw || fetchedOnce.current || chatsRef.current.length > 0) {
          return;
        }
        const cached = JSON.parse(raw) as Chat[];
        if (!Array.isArray(cached) || cached.length === 0) return;
        setChats(() => cached);
        setLoaded(true);
      })
      .catch(() => {
        /* corrupt / unavailable cache — the network load still runs */
      });
    return () => {
      cancelled = true;
    };
  }, [status, myUserId, setChats]);

  // Persist (debounced) whenever chats change.
  useEffect(() => {
    if (status !== 'signed-in' || !myUserId || !loaded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const persist = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void AsyncStorage.setItem(
          CACHE_PREFIX + myUserId,
          JSON.stringify(toCacheable(chatsRef.current)),
        ).catch(() => {});
      }, CACHE_WRITE_DEBOUNCE_MS);
    };
    persist();
    const off = store.subscribe(persist);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [store, status, myUserId, loaded]);

  const applyIncoming = useCallback(
    (chatId: string, rows: ApiChatMessage[]) => {
      if (!myUserId || rows.length === 0) return;
      const locals = rows.map((m) => apiMessageToLocal(m, myUserId));
      const fromPartner = rows.filter((m) => m.senderId !== myUserId);
      queueDelivered(
        chatId,
        fromPartner.filter((m) => !m.deletedAt).map((m) => m.id),
      );
      const maxSeq = rows.reduce((n, m) => Math.max(n, m.seq ?? 0), 0);
      const key = normChatId(chatId);
      const viewing = isViewing(chatId);
      if (!findChat(chatId)) {
        // Brand-new chat (e.g. partner accepted my plane and wrote first):
        // fetch the real summary so name/avatar are right.
        void refresh();
        return;
      }
      setChats((prev) =>
        prev.map((chat) => {
          if (normChatId(chat.id) !== key) return chat;
          const known = new Set(chat.messages.map((m) => m.id));
          const freshFromPartner = fromPartner.filter(
            (m) => !known.has(m.id) && (m.seq ?? 0) > (chat.lastSyncedSeq ?? 0),
          ).length;
          return {
            ...chat,
            messages: mergeMessages(chat.messages, locals),
            lastSyncedSeq: Math.max(chat.lastSyncedSeq ?? 0, maxSeq),
            nextSeq: Math.max(chat.nextSeq ?? 0, maxSeq),
            unreadCount: viewing ? 0 : chat.unreadCount + freshFromPartner,
            partnerTyping: fromPartner.length > 0 ? false : chat.partnerTyping,
          };
        }),
      );
      if (viewing && fromPartner.length > 0) scheduleRead(chatId);
    },
    [myUserId, queueDelivered, isViewing, findChat, refresh, setChats, scheduleRead],
  );

  const syncChatDelta = useCallback(
    async (chatId: string) => {
      if (!myUserId) return;
      const chat = findChat(chatId);
      if (!chat?.historyLoaded) return;
      let after = chat.lastSyncedSeq ?? maxSeqOf(chat.messages);
      try {
        // Page forward until caught up (long offline periods).
        for (let i = 0; i < 10; i++) {
          const rows = await listChatMessages(chatId, {
            afterSeq: after,
            limit: 100,
          });
          if (rows.length === 0) break;
          applyIncoming(chatId, rows);
          after = rows.reduce((n, m) => Math.max(n, m.seq ?? 0), after);
          if (rows.length < 100) break;
        }
      } catch {
        /* best effort */
      }
    },
    [myUserId, findChat, applyIncoming],
  );

  const loadMessages = useCallback(
    async (chatId: string) => {
      if (!myUserId) return;
      const existing = findChat(chatId);
      if (existing?.historyLoaded) {
        await syncChatDelta(chatId);
        return;
      }
      const key = normChatId(chatId);
      if (loadingHistory.current.has(key)) return;
      loadingHistory.current.add(key);
      try {
        const rows = await listChatMessages(chatId, { limit: PAGE_SIZE });
        const incoming = rows.map((m) => apiMessageToLocal(m, myUserId));
        const maxSeq = rows.reduce((n, m) => Math.max(n, m.seq ?? 0), 0);
        queueDelivered(
          chatId,
          rows.filter((m) => m.senderId !== myUserId).map((m) => m.id),
        );
        setChats((prev) =>
          prev.map((c) =>
            normChatId(c.id) === key
              ? {
                  ...c,
                  messages: mergeMessages(c.messages, incoming),
                  lastSyncedSeq: Math.max(c.lastSyncedSeq ?? 0, maxSeq),
                  historyLoaded: true,
                  hasOlder: rows.length >= PAGE_SIZE,
                }
              : c,
          ),
        );
        if (isViewing(chatId)) scheduleRead(chatId);
      } catch {
        logFailure({
          kind: 'api',
          message: 'Failed to load chat messages',
          path: `/v1/chats/${chatId}/messages`,
        });
      } finally {
        loadingHistory.current.delete(key);
      }
    },
    [myUserId, findChat, syncChatDelta, queueDelivered, setChats, isViewing, scheduleRead],
  );

  const loadOlderMessages = useCallback(
    async (chatId: string) => {
      if (!myUserId) return;
      const chat = findChat(chatId);
      if (!chat?.historyLoaded || chat.hasOlder === false) return;
      const key = normChatId(chatId);
      if (loadingHistory.current.has(key)) return;
      const beforeSeq = minSeqOf(chat.messages);
      if (beforeSeq == null || beforeSeq <= 1) {
        updateChat(chatId, (c) => ({ ...c, hasOlder: false }));
        return;
      }
      loadingHistory.current.add(key);
      try {
        const rows = await listChatMessages(chatId, {
          beforeSeq,
          limit: PAGE_SIZE,
        });
        const incoming = rows.map((m) => apiMessageToLocal(m, myUserId));
        updateChat(chatId, (c) => ({
          ...c,
          messages: mergeMessages(c.messages, incoming),
          hasOlder: rows.length >= PAGE_SIZE,
        }));
      } catch {
        /* user can scroll again to retry */
      } finally {
        loadingHistory.current.delete(key);
      }
    },
    [myUserId, findChat, updateChat],
  );

  // ── Lifecycle ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (status !== 'signed-in' || !myUserId) {
      if (status !== 'signed-in') {
        setChats(() => []);
        setLoaded(false);
        fetchedOnce.current = false;
        lastReadSent.current.clear();
        // Don't leave someone's conversations on a shared phone.
        if (cacheUserRef.current) {
          void AsyncStorage.removeItem(CACHE_PREFIX + cacheUserRef.current).catch(() => {});
          cacheUserRef.current = null;
        }
      }
      return;
    }
    void refresh();
  }, [status, myUserId, refresh, setChats]);

  // Resync after every reconnect: list + open threads catch up on
  // anything that happened while the socket was down.
  useEffect(() => {
    if (status !== 'signed-in' || !myUserId) return;
    let wasConnected = true;
    return onRealtimeStatus((connected) => {
      if (connected && !wasConnected) {
        void refresh();
        for (const chat of chatsRef.current) {
          if (chat.historyLoaded) void syncChatDelta(chat.id);
        }
      }
      wasConnected = connected;
    });
  }, [status, myUserId, refresh, syncChatDelta]);

  const clearTypingLater = useCallback(
    (chatId: string) => {
      const key = normChatId(chatId);
      const prev = typingTimers.current.get(key);
      if (prev) clearTimeout(prev);
      typingTimers.current.set(
        key,
        setTimeout(() => {
          typingTimers.current.delete(key);
          updateChat(chatId, (chat) =>
            chat.partnerTyping ? { ...chat, partnerTyping: false } : chat,
          );
        }, TYPING_TTL_MS),
      );
    },
    [updateChat],
  );

  useEffect(() => {
    if (status !== 'signed-in') {
      disconnectRealtime();
      return;
    }
    void connectRealtime();
    return onRealtime((type, data) => {
      if (!data || typeof data !== 'object' || !myUserId) return;

      if (type === 'message.new') {
        const payload = data as RealtimeMessageNew;
        if (!payload.chatId || !payload.message) return;
        applyIncoming(payload.chatId, [payload.message]);
        const m = payload.message;
        if (
          m.senderId !== myUserId &&
          !m.deletedAt &&
          AppState.currentState === 'active' &&
          !isViewing(payload.chatId)
        ) {
          const chat = findChat(payload.chatId);
          if (chat && !chat.isBlocked) {
            const preview =
              m.type === 'image'
                ? '📷 Photo'
                : m.type === 'audio'
                  ? '🎤 Voice message'
                  : (m.body ?? '');
            for (const fn of incomingListeners.current) {
              fn({
                chatId: chat.id,
                partnerName: chat.partner.name,
                partnerAvatarUrl: chat.partner.avatarUrl,
                preview,
              });
            }
          }
        }
        return;
      }

      if (type === 'message.viewed') {
        const v = data as RealtimeMessageViewed;
        if (!v.chatId || !v.messageId) return;
        updateChat(v.chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((m) =>
            m.id === v.messageId && !m.viewedAt ? { ...m, viewedAt: v.viewedAt } : m,
          ),
        }));
        return;
      }

      if (type === 'chat.deleted') {
        const d = data as RealtimeChatDeleted;
        if (!d.chatId) return;
        const key = normChatId(d.chatId);
        setChats((prev) =>
          prev.some((c) => normChatId(c.id) === key)
            ? prev.filter((c) => normChatId(c.id) !== key)
            : prev,
        );
        return;
      }

      if (type === 'chat.updated') {
        const u = data as RealtimeChatUpdated;
        if (!u.chatId) return;
        updateChat(u.chatId, (chat) => ({
          ...chat,
          pinnedAt: u.pinnedAt ?? undefined,
        }));
        return;
      }

      if (type === 'block.updated') {
        const b = data as RealtimeBlockUpdated;
        if (!b.userId) return;
        setChats((prev) => {
          let changed = false;
          const next = prev.map((chat) => {
            if (chat.partner.id !== b.userId || !!chat.isBlocked === b.blocked) {
              return chat;
            }
            changed = true;
            return { ...chat, isBlocked: b.blocked, partnerTyping: false };
          });
          return changed ? next : prev;
        });
        return;
      }

      if (type === 'message.ack') {
        const ack = data as RealtimeMessageAck;
        for (const chat of chatsRef.current) {
          const local = chat.messages.find(
            (m) => m.clientMsgId === ack.client_msg_id,
          );
          if (!local) continue;
          updateChat(chat.id, (c) => ({
            ...c,
            messages: mergeMessages(c.messages, [
              {
                ...local,
                id: ack.id,
                seq: ack.seq,
                createdAt: ack.created_at,
                status: maxStatus(local.status, 'sent'),
              },
            ]),
            lastSyncedSeq: Math.max(c.lastSyncedSeq ?? 0, ack.seq),
          }));
          break;
        }
        return;
      }

      if (type === 'message.status') {
        const st = data as RealtimeMessageStatus;
        if (st.up_to_seq && st.chat_id && st.read_at) {
          const upTo = st.up_to_seq;
          updateChat(st.chat_id, (chat) => ({
            ...chat,
            messages: chat.messages.map((m) =>
              m.authorId === 'me' && m.seq != null && m.seq <= upTo && m.status !== 'seen'
                ? { ...m, status: 'seen' }
                : m,
            ),
          }));
        }
        if (st.message_id && st.delivered_at) {
          const apply = (chat: Chat): Chat => {
            let hit = false;
            const messages = chat.messages.map((m) => {
              if (m.id !== st.message_id || m.authorId !== 'me') return m;
              hit = true;
              return { ...m, status: maxStatus(m.status, 'delivered') };
            });
            return hit ? { ...chat, messages } : chat;
          };
          if (st.chat_id) updateChat(st.chat_id, apply);
          else setChats((prev) => prev.map(apply));
        }
        return;
      }

      if (type === 'message.reaction') {
        const r = data as RealtimeMessageReaction;
        if (!r.chatId || !r.messageId || r.accountId === myUserId) return;
        updateChat(r.chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((m) =>
            m.id === r.messageId ? { ...m, reaction: r.emoji || undefined } : m,
          ),
        }));
        return;
      }

      if (type === 'message.edited') {
        const payload = data as RealtimeMessageEdited;
        if (!payload.chatId || !payload.message) return;
        const local = apiMessageToLocal(payload.message, myUserId);
        updateChat(payload.chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((m) =>
            m.id === local.id ? reconcile(m, local) : m,
          ),
        }));
        return;
      }

      if (type === 'message.deleted') {
        const payload = data as RealtimeMessageDeleted;
        if (!payload.chatId || !payload.messageId) return;
        updateChat(payload.chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((m) =>
            m.id === payload.messageId
              ? { ...m, text: '', deletedAt: payload.deletedAt }
              : m,
          ),
        }));
        return;
      }

      if (type === 'typing') {
        const t = data as RealtimeTyping;
        if (!t.chatId || t.userId === myUserId) return;
        updateChat(t.chatId, (chat) =>
          chat.partnerTyping === t.isTyping
            ? chat
            : { ...chat, partnerTyping: t.isTyping },
        );
        if (t.isTyping) clearTypingLater(t.chatId);
        return;
      }

      if (type === 'presence.update') {
        const p = data as RealtimePresenceUpdate;
        if (!p.userId) return;
        setChats((prev) => {
          let changed = false;
          const next = prev.map((chat) => {
            if (chat.partner.id !== p.userId) return chat;
            if (chat.partner.onlineNow === p.online) return chat;
            changed = true;
            return {
              ...chat,
              partner: { ...chat.partner, onlineNow: p.online },
              partnerTyping: p.online ? chat.partnerTyping : false,
            };
          });
          return changed ? next : prev;
        });
        return;
      }

      if (type === 'notification.new' && isPlaneAcceptedNotification(data)) {
        // My plane was accepted → a new chat exists for me.
        void refresh();
      }
    });
  }, [status, myUserId, applyIncoming, refresh, updateChat, setChats, clearTypingLater, findChat, isViewing]);

  // Flush pending receipts on unmount.
  useEffect(
    () => () => {
      if (deliverTimer.current) clearTimeout(deliverTimer.current);
      for (const t of readTimers.current.values()) clearTimeout(t);
      for (const t of typingTimers.current.values()) clearTimeout(t);
    },
    [],
  );

  const getChat = useCallback((chatId: string) => findChat(chatId), [findChat]);

  const acceptPlane = useCallback(
    async (plane: Plane, chatId: string): Promise<Chat> => {
      await refresh();
      const found = findChat(chatId);
      if (found) {
        void loadMessages(chatId);
        return found;
      }
      const fallback: Chat = {
        id: chatId,
        partner: plane.sender,
        messages: [],
        unreadCount: 0,
        partnerTyping: false,
        createdAt: nowIso(),
      };
      setChats((prev) =>
        prev.some((c) => normChatId(c.id) === normChatId(chatId))
          ? prev
          : [fallback, ...prev],
      );
      void loadMessages(chatId);
      return fallback;
    },
    [refresh, findChat, loadMessages, setChats],
  );

  const setActiveChat = useCallback(
    (chatId: string | null) => {
      activeChatRef.current = chatId;
      setRealtimeActiveChat(chatId);
      if (chatId) {
        updateChat(chatId, (c) => (c.unreadCount ? { ...c, unreadCount: 0 } : c));
        scheduleRead(chatId);
      }
    },
    [updateChat, scheduleRead],
  );

  const markChatOpened = useCallback(
    (chatId: string) => {
      updateChat(chatId, (c) => (c.unreadCount ? { ...c, unreadCount: 0 } : c));
      scheduleRead(chatId);
    },
    [updateChat, scheduleRead],
  );

  // Typing goes over the socket (no HTTP per keystroke). HTTP fallback only
  // for the "stopped" edge so the partner's indicator doesn't stick.
  const setTyping = useCallback((chatId: string, isTyping: boolean) => {
    if (sendRealtime('typing', { chatId, isTyping })) return;
    if (!isTyping) void sendChatTyping(chatId, false).catch(() => {});
  }, []);

  // ── Sending ───────────────────────────────────────────────────────────

  const buildMedia = (
    kind: ChatMessageKind,
    p: SendPayload,
  ): ApiChatMedia | undefined => {
    if (!p.mediaKey) return undefined;
    const mime =
      kind === 'image'
        ? 'image/jpeg'
        : kind === 'audio'
          ? 'audio/mp4'
          : 'application/octet-stream';
    return {
      r2_key: p.mediaKey,
      mime,
      size: 0,
      ...(kind === 'audio' && p.audioDurationMs
        ? { duration: Math.round(p.audioDurationMs) }
        : {}),
    };
  };

  /** Runs `task` after every earlier send in the same chat finished. */
  const enqueueSend = useCallback((chatId: string, task: () => Promise<void>) => {
    const key = normChatId(chatId);
    const prev = sendQueues.current.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    sendQueues.current.set(key, next);
    void next.finally(() => {
      if (sendQueues.current.get(key) === next) sendQueues.current.delete(key);
    });
    return next;
  }, []);

  const markFailed = useCallback(
    (chatId: string, clientMsgId: string, e: unknown) => {
      logFailure({
        kind: 'api',
        code: e instanceof ApiError ? e.code : 'UNKNOWN',
        message: e instanceof Error ? e.message : 'Send failed',
        path: `/v1/chats/${chatId}/messages`,
      });
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
          m.clientMsgId === clientMsgId && m.status === 'sending'
            ? { ...m, status: 'failed' }
            : m,
        ),
      }));
    },
    [updateChat],
  );

  /** Uploads local media for a pending message (outside the send queue,
   *  so a slow photo upload doesn't hold back text messages). */
  const ensureUploaded = useCallback(
    async (chatId: string, p: SendPayload) => {
      if (p.mediaKey || (p.kind !== 'image' && p.kind !== 'audio')) return;
      const uri = p.kind === 'image' ? p.imageUri : p.audioUri;
      if (!uri || !isLocalMediaUri(uri)) return;
      const uploaded = await uploadChatMedia(chatId, uri, p.kind);
      p.mediaKey = uploaded.mediaKey;
    },
    [],
  );

  const deliver = useCallback(
    async (chatId: string, clientMsgId: string) => {
      const p = pendingPayloads.current.get(clientMsgId);
      if (!p) return;
      try {
        await ensureUploaded(chatId, p);
      } catch (e) {
        markFailed(chatId, clientMsgId, e);
        return;
      }
      await enqueueSend(chatId, async () => {
        if (!pendingPayloads.current.has(clientMsgId)) return;
        const kind: ChatMessageKind = p.kind ?? 'text';
        const text = (p.text ?? '').trim();
        const msgType =
          kind === 'image' ? 'image' : kind === 'audio' ? 'audio' : 'text';
        try {
          const saved = await sendChatMessage(chatId, {
            text: kind === 'text' ? text : text || undefined,
            client_msg_id: clientMsgId,
            type: msgType,
            media: buildMedia(kind, p),
            reply_to_id: p.replyToMessageId,
            view_once: p.viewOnce,
          });
          pendingPayloads.current.delete(clientMsgId);
          const local = apiMessageToLocal(saved, myUserId || saved.senderId);
          updateChat(chatId, (chat) => ({
            ...chat,
            messages: mergeMessages(chat.messages, [local]),
            lastSyncedSeq: Math.max(chat.lastSyncedSeq ?? 0, saved.seq ?? 0),
            nextSeq: Math.max(chat.nextSeq ?? 0, saved.seq ?? 0),
          }));
        } catch (e) {
          markFailed(chatId, clientMsgId, e);
        }
      });
    },
    [ensureUploaded, enqueueSend, markFailed, myUserId, updateChat],
  );

  const sendMessage = useCallback(
    async (chatId: string, payload: SendPayload | string) => {
      const p: SendPayload =
        typeof payload === 'string' ? { kind: 'text', text: payload } : payload;
      const kind: ChatMessageKind = p.kind ?? 'text';
      const text = (p.text ?? '').trim();
      if (kind === 'text' && !text) return;

      const clientMsgId = newRequestId();
      pendingPayloads.current.set(clientMsgId, { ...p, text });

      const optimistic: ChatMessage = {
        id: `local_${clientMsgId}`,
        clientMsgId,
        authorId: 'me',
        kind,
        text: kind === 'text' ? text : kind,
        imageUri: p.imageUri,
        audioUri: p.audioUri,
        audioDurationMs: p.audioDurationMs,
        mediaKey: p.mediaKey,
        createdAt: nowIso(),
        status: 'sending',
        replyToMessageId: p.replyToMessageId,
        viewOnce: p.viewOnce,
      };
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: [...chat.messages, { ...optimistic, anchorSeq: maxSeqOf(chat.messages) }],
      }));
      setTyping(chatId, false);
      await deliver(chatId, clientMsgId);
    },
    [updateChat, deliver, setTyping],
  );

  const retryMessage = useCallback(
    (chatId: string, clientMsgId: string) => {
      if (!pendingPayloads.current.has(clientMsgId)) return;
      updateChat(chatId, (chat) => {
        const idx = chat.messages.findIndex((m) => m.clientMsgId === clientMsgId);
        if (idx < 0) return chat;
        // Re-sending gives it the next seq on the server, so it moves to
        // the bottom now (same as WhatsApp).
        const rest = chat.messages.filter((_, i) => i !== idx);
        const msg: ChatMessage = {
          ...chat.messages[idx],
          status: 'sending',
          createdAt: nowIso(),
          anchorSeq: maxSeqOf(rest),
        };
        return { ...chat, messages: [...rest, msg] };
      });
      void deliver(chatId, clientMsgId);
    },
    [updateChat, deliver],
  );

  const discardMessage = useCallback(
    (chatId: string, clientMsgId: string) => {
      pendingPayloads.current.delete(clientMsgId);
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.filter(
          (m) => !(m.clientMsgId === clientMsgId && m.status === 'failed'),
        ),
      }));
    },
    [updateChat],
  );

  const addReaction = useCallback(
    (chatId: string, messageId: string, emoji: string) => {
      const msg = findChat(chatId)?.messages.find((m) => m.id === messageId);
      const removing = msg?.reaction === emoji;
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
          m.id === messageId ? { ...m, reaction: removing ? undefined : emoji } : m,
        ),
      }));
      void (removing
        ? removeChatReaction(chatId, messageId)
        : setChatReaction(chatId, messageId, emoji)
      ).catch(() => {});
    },
    [findChat, updateChat],
  );

  const editMessage = useCallback(
    (chatId: string, messageId: string, newText: string) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
          m.id === messageId ? { ...m, text: trimmed, editedAt: nowIso() } : m,
        ),
      }));
      void editChatMessage(chatId, messageId, trimmed).catch(() => {});
    },
    [updateChat],
  );

  const deleteMessage = useCallback(
    (chatId: string, messageId: string) => {
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
          m.id === messageId ? { ...m, text: '', deletedAt: nowIso() } : m,
        ),
      }));
      void deleteChatMessage(chatId, messageId, 'everyone').catch(() => {});
    },
    [updateChat],
  );

  const markViewedLocally = useCallback(
    (chatId: string, messageId: string, viewedAt: string) => {
      updateChat(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
          m.id === messageId && !m.viewedAt ? { ...m, viewedAt } : m,
        ),
      }));
    },
    [updateChat],
  );

  /** Opens a view-once message (recipient). Returns the one-time media URL,
   *  or null if it can't be opened (already viewed / offline). */
  const openViewOnce = useCallback(
    async (chatId: string, messageId: string): Promise<string | null> => {
      try {
        const res = await openViewOnceApi(chatId, messageId);
        markViewedLocally(chatId, messageId, res.viewedAt);
        return res.url;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'ALREADY_VIEWED') {
          markViewedLocally(chatId, messageId, nowIso());
        } else {
          Alert.alert('Could not open', 'Check your connection and try again.');
        }
        return null;
      }
    },
    [markViewedLocally],
  );

  const setPinned = useCallback(
    (chatId: string, pinned: boolean) => {
      const before = findChat(chatId)?.pinnedAt;
      updateChat(chatId, (chat) => ({
        ...chat,
        pinnedAt: pinned ? nowIso() : undefined,
      }));
      setChatPinned(chatId, pinned).catch(() => {
        updateChat(chatId, (chat) => ({ ...chat, pinnedAt: before }));
        Alert.alert(
          pinned ? 'Could not pin chat' : 'Could not unpin chat',
          'Check your connection and try again.',
        );
      });
    },
    [findChat, updateChat],
  );

  const pinChat = useCallback((chatId: string) => setPinned(chatId, true), [setPinned]);
  const unpinChat = useCallback((chatId: string) => setPinned(chatId, false), [setPinned]);

  const deleteChat = useCallback(
    (chatId: string) => {
      const key = normChatId(chatId);
      const removed = findChat(chatId);
      setChats((prev) => prev.filter((c) => normChatId(c.id) !== key));
      deleteChatApi(chatId).catch(() => {
        if (removed) {
          setChats((prev) =>
            prev.some((c) => normChatId(c.id) === key) ? prev : [removed, ...prev],
          );
        }
        Alert.alert('Could not delete chat', 'Check your connection and try again.');
      });
    },
    [findChat, setChats],
  );

  /** Blocks/unblocks a person (by user id); updates every chat with them. */
  const setUserBlockedState = useCallback(
    async (userId: string, blocked: boolean) => {
      const apply = (value: boolean) =>
        setChats((prev) => {
          let changed = false;
          const next = prev.map((chat) => {
            if (chat.partner.id !== userId || !!chat.isBlocked === value) return chat;
            changed = true;
            return {
              ...chat,
              isBlocked: value,
              partnerTyping: value ? false : chat.partnerTyping,
              partner: value ? { ...chat.partner, onlineNow: false } : chat.partner,
            };
          });
          return changed ? next : prev;
        });
      apply(blocked);
      try {
        await setUserBlocked(userId, blocked);
        if (!blocked) void refresh();
      } catch (e) {
        apply(!blocked);
        Alert.alert(
          blocked ? 'Could not block' : 'Could not unblock',
          'Check your connection and try again.',
        );
        throw e;
      }
    },
    [setChats, refresh],
  );

  const blockChat = useCallback(
    (chatId: string) => {
      const partnerId = findChat(chatId)?.partner.id;
      if (partnerId) void setUserBlockedState(partnerId, true).catch(() => {});
    },
    [findChat, setUserBlockedState],
  );

  const unblockChat = useCallback(
    (chatId: string) => {
      const partnerId = findChat(chatId)?.partner.id;
      if (partnerId) void setUserBlockedState(partnerId, false).catch(() => {});
    },
    [findChat, setUserBlockedState],
  );

  const subscribeIncoming = useCallback((fn: IncomingListener) => {
    incomingListeners.current.add(fn);
    return () => {
      incomingListeners.current.delete(fn);
    };
  }, []);

  const actions = useMemo<ChatsActions>(
    () => ({
      refresh,
      getChat,
      loadMessages,
      loadOlderMessages,
      syncChatDelta,
      acceptPlane,
      sendMessage,
      retryMessage,
      discardMessage,
      editMessage,
      deleteMessage,
      openViewOnce,
      markChatOpened,
      setActiveChat,
      setTyping,
      addReaction,
      pinChat,
      unpinChat,
      deleteChat,
      blockChat,
      unblockChat,
      setUserBlockedState,
      subscribeIncoming,
    }),
    [
      refresh,
      getChat,
      loadMessages,
      loadOlderMessages,
      syncChatDelta,
      acceptPlane,
      sendMessage,
      retryMessage,
      discardMessage,
      editMessage,
      deleteMessage,
      openViewOnce,
      markChatOpened,
      setActiveChat,
      setTyping,
      addReaction,
      pinChat,
      unpinChat,
      deleteChat,
      blockChat,
      unblockChat,
      setUserBlockedState,
      subscribeIncoming,
    ],
  );

  const meta = useMemo<ChatsMeta>(() => ({ loading, loaded }), [loading, loaded]);

  return (
    <StoreContext.Provider value={store}>
      <ActionsContext.Provider value={actions}>
        <MetaContext.Provider value={meta}>
          {children}
          {status === 'signed-in' ? <InAppMessageBanner /> : null}
        </MetaContext.Provider>
      </ActionsContext.Provider>
    </StoreContext.Provider>
  );
}

function useStore(): ChatsStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('Chats hooks must be used inside <ChatsProvider>');
  return store;
}

/** Stable actions — never re-renders on chat updates. */
export function useChatsActions(): ChatsActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useChatsActions must be used inside <ChatsProvider>');
  return ctx;
}

/** Loading flags (change only around fetches). */
export function useChatsMeta(): ChatsMeta {
  return useContext(MetaContext);
}

/** Full chat list — re-renders whenever any chat changes. */
export function useChatList(): Chat[] {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.get);
}

/** One chat — re-renders only when THAT chat changes. */
export function useChat(chatId: string | null | undefined): Chat | undefined {
  const store = useStore();
  const key = chatId ? normChatId(chatId) : null;
  const getSnapshot = useCallback(
    () => (key ? store.get().find((c) => normChatId(c.id) === key) : undefined),
    [store, key],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/** Unread total for the tab badge — re-renders only when the number changes. */
export function useChatsUnreadTotal(): number {
  const store = useStore();
  const getSnapshot = useCallback(
    () => store.get().reduce((sum, c) => sum + (c.isBlocked ? 0 : c.unreadCount), 0),
    [store],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot);
}

/**
 * @deprecated Subscribes to every chat change. Prefer `useChatsActions` +
 * `useChat` / `useChatList` / `useChatsUnreadTotal`.
 */
export function useChats(): ChatsContextValue {
  const actions = useChatsActions();
  const meta = useChatsMeta();
  const chats = useChatList();
  return useMemo(() => ({ ...actions, ...meta, chats }), [actions, meta, chats]);
}
