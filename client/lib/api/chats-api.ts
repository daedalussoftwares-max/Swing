import { authedFetch } from '@/lib/api/authed-fetch';

export type ApiChatPartner = {
  id: string;
  name: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
  lastActiveAt?: string;
  /** Live WebSocket presence at the time of the list call. */
  online?: boolean;
};

export type ApiChatMedia = {
  r2_key: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  thumb_key?: string;
  file_name?: string;
  url?: string;
};

export type ApiMessageReaction = {
  accountId: string;
  emoji: string;
  createdAt: string;
};

export type ApiMessageStatus = {
  accountId: string;
  deliveredAt?: string;
  readAt?: string;
};

export type ApiChatMessage = {
  id: string;
  chatId: string;
  seq: number;
  clientMsgId?: string;
  senderId: string;
  type: string;
  body?: string;
  media?: ApiChatMedia;
  replyToId?: string;
  forwarded?: boolean;
  viewOnce?: boolean;
  viewedAt?: string;
  editedAt?: string;
  deletedAt?: string;
  createdAt: string;
  reactions?: ApiMessageReaction[];
  status?: ApiMessageStatus[];
};

export type ApiChatSummary = {
  id: string;
  partner: ApiChatPartner;
  createdAt: string;
  lastMessage?: ApiChatMessage;
  unreadCount: number;
  nextSeq: number;
  planeId?: string;
  pinnedAt?: string;
  blockedByMe?: boolean;
};

export type ApiPublicProfile = {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  bio?: string;
  interests: string[];
  age?: number;
  gender?: string;
  city?: string;
  country?: string;
  joinedAt: string;
  lastActiveAt?: string;
  online: boolean;
  isFriend: boolean;
  chatId?: string;
  blockedByMe: boolean;
};

export type SendChatMessageInput = {
  text?: string;
  client_msg_id?: string;
  type?: string;
  media?: ApiChatMedia;
  reply_to_id?: string;
  forwarded?: boolean;
  view_once?: boolean;
};

export async function listChats(): Promise<ApiChatSummary[]> {
  const res = await authedFetch<{ chats: ApiChatSummary[] }>('/v1/chats');
  return res.chats ?? [];
}

export async function listChatMessages(
  chatId: string,
  opts?: { beforeSeq?: number; afterSeq?: number; limit?: number },
): Promise<ApiChatMessage[]> {
  const params = new URLSearchParams();
  if (opts?.beforeSeq != null) {
    params.set('before_seq', String(opts.beforeSeq));
  }
  if (opts?.afterSeq != null) {
    params.set('after_seq', String(opts.afterSeq));
  }
  if (opts?.limit != null) {
    params.set('limit', String(opts.limit));
  }
  const qs = params.toString();
  const path = `/v1/chats/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ''}`;
  const res = await authedFetch<{ messages: ApiChatMessage[] }>(path);
  return res.messages ?? [];
}

export async function sendChatMessage(
  chatId: string,
  input: SendChatMessageInput,
): Promise<ApiChatMessage> {
  const res = await authedFetch<{ message: ApiChatMessage }>(
    `/v1/chats/${encodeURIComponent(chatId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        text: input.text ?? '',
        client_msg_id: input.client_msg_id,
        type: input.type ?? 'text',
        ...(input.media?.r2_key ? { media: input.media } : {}),
        ...(input.reply_to_id ? { reply_to_id: input.reply_to_id } : {}),
        forwarded: input.forwarded ?? false,
        ...(input.view_once ? { view_once: true } : {}),
      }),
    },
  );
  return res.message;
}

export async function markChatRead(
  chatId: string,
  upToSeq: number,
): Promise<void> {
  await authedFetch(`/v1/chats/${encodeURIComponent(chatId)}/read`, {
    method: 'POST',
    body: JSON.stringify({ up_to_seq: upToSeq }),
  });
}

export async function markChatDelivered(
  chatId: string,
  messageIds: string[],
): Promise<void> {
  await authedFetch(`/v1/chats/${encodeURIComponent(chatId)}/delivered`, {
    method: 'POST',
    body: JSON.stringify({ message_ids: messageIds }),
  });
}

export async function setChatReaction(
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await authedFetch(
    `/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reaction`,
    {
      method: 'PUT',
      body: JSON.stringify({ emoji }),
    },
  );
}

export async function removeChatReaction(
  chatId: string,
  messageId: string,
): Promise<void> {
  await authedFetch(
    `/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reaction`,
    { method: 'DELETE' },
  );
}

export async function editChatMessage(
  chatId: string,
  messageId: string,
  body: string,
): Promise<ApiChatMessage> {
  const res = await authedFetch<{ message: ApiChatMessage }>(
    `/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    },
  );
  return res.message;
}

export async function deleteChatMessage(
  chatId: string,
  messageId: string,
  scope: 'me' | 'everyone',
): Promise<void> {
  await authedFetch(
    `/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}?scope=${scope}`,
    { method: 'DELETE' },
  );
}

export async function sendChatTyping(
  chatId: string,
  isTyping: boolean,
): Promise<void> {
  await authedFetch(`/v1/chats/${encodeURIComponent(chatId)}/typing`, {
    method: 'POST',
    body: JSON.stringify({ is_typing: isTyping }),
  });
}

/** Burns a view-once message (recipient only) and returns its media URL. */
export async function openViewOnceApi(
  chatId: string,
  messageId: string,
): Promise<{ url: string; viewedAt: string }> {
  return authedFetch<{ url: string; viewedAt: string }>(
    `/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/view`,
    { method: 'POST' },
  );
}

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'inappropriate'
  | 'fake_profile'
  | 'underage'
  | 'other';

export async function createReport(input: {
  userId: string;
  chatId?: string;
  reason: ReportReason;
  details?: string;
  alsoBlock?: boolean;
}): Promise<void> {
  await authedFetch('/v1/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function setChatPinned(
  chatId: string,
  pinned: boolean,
): Promise<string | undefined> {
  const res = await authedFetch<{ pinnedAt?: string | null }>(
    `/v1/chats/${encodeURIComponent(chatId)}/pin`,
    { method: pinned ? 'PUT' : 'DELETE' },
  );
  return res?.pinnedAt ?? undefined;
}

/** Deletes the whole conversation for BOTH people. */
export async function deleteChatApi(chatId: string): Promise<void> {
  await authedFetch(`/v1/chats/${encodeURIComponent(chatId)}`, {
    method: 'DELETE',
  });
}

export async function setUserBlocked(
  userId: string,
  blocked: boolean,
): Promise<void> {
  await authedFetch(`/v1/users/${encodeURIComponent(userId)}/block`, {
    method: blocked ? 'POST' : 'DELETE',
  });
}

export async function getUserProfile(userId: string): Promise<ApiPublicProfile> {
  const res = await authedFetch<{ user: ApiPublicProfile }>(
    `/v1/users/${encodeURIComponent(userId)}`,
  );
  return res.user;
}

export async function registerDevice(
  token: string,
  platform: string,
): Promise<void> {
  await authedFetch('/v1/devices', {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
}
