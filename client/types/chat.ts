/**
 * Chat domain types — kept intentionally small for MVP.
 *
 * One Chat corresponds to a 1-on-1 conversation that opened because the
 * receiver accepted a paper plane. Messages are stored inline on the
 * chat for simplicity; once Firestore lands they'll move to a
 * subcollection.
 */

import type { Sender } from '@/types/plane';

export type ChatMessageStatus =
  | 'sending' // optimistic, not yet "delivered" by the mock layer
  | 'sent' // single tick
  | 'delivered' // double tick (gray)
  | 'seen' // double tick (blue)
  | 'failed'; // send failed — tap to retry

export type ChatMessageKind = 'text' | 'image' | 'audio';

export type ChatMessage = {
  id: string;
  seq?: number;
  clientMsgId?: string;
  /** Sender of this individual message. `'me'` for the local user,
   *  otherwise the partner's user id. */
  authorId: 'me' | string;
  /** What kind of payload this message carries. Default is text. */
  kind: ChatMessageKind;
  /** Text body for `kind === 'text'`; also used as alt-text fallback. */
  text: string;
  /** View URL for image media (local while sending, presigned after upload). */
  imageUri?: string;
  /** View URL for voice clip media. */
  audioUri?: string;
  /** R2 object key — used to refresh expired presigned view URLs. */
  mediaKey?: string;
  /** Duration of the voice clip in milliseconds. */
  audioDurationMs?: number;
  /** ISO timestamp. */
  createdAt: string;
  status: ChatMessageStatus;
  /** Optional reaction emoji from the other side. */
  reaction?: string;

  // --- Lightweight message-management metadata ---
  /** If set, this message is a reply to the message with this id. */
  replyToMessageId?: string;
  /** ISO timestamp the message was last edited (text-kind only). */
  editedAt?: string;
  /** ISO timestamp the message was soft-deleted. The bubble is replaced
   *  with an "Unsent" placeholder instead of being removed, so the chat
   *  history stays continuous. */
  deletedAt?: string;

  /** Instagram-style "view once" — the receiver can open the media
   *  exactly once. After opening, the body is destroyed and the bubble
   *  shows a "viewed" placeholder. Only applies to image / audio. */
  viewOnce?: boolean;
  /** ISO timestamp the receiver opened a view-once message. */
  viewedAt?: string;
};

export type Chat = {
  id: string;
  /** Server seq cursor (chats.next_seq). */
  nextSeq?: number;
  /** Highest seq loaded locally for delta sync. */
  lastSyncedSeq?: number;
  /** True once the latest page of history was fetched (not just the
   *  list-preview message). */
  historyLoaded?: boolean;
  /** False once paging backwards reached the first message. */
  hasOlder?: boolean;
  /** The other person in this chat. */
  partner: Sender;
  /** Full message log, oldest first. */
  messages: ChatMessage[];
  /** How many partner-messages the local user hasn't opened yet. */
  unreadCount: number;
  /** Drives a "typing..." bubble while a mock auto-reply is in flight. */
  partnerTyping: boolean;
  /** ISO timestamp the chat was created (i.e. the plane was accepted). */
  createdAt: string;

  // --- Per-thread management ---
  /** ISO timestamp when the user pinned this chat. Pinned chats float to
   *  the top of the chats list. */
  pinnedAt?: string;
  /** When true, the partner is blocked; the chat row renders muted and
   *  tapping is disabled. */
  isBlocked?: boolean;
};
