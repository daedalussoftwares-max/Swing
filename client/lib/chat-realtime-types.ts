import type { ApiChatMessage } from '@/lib/api/chats-api';

export type RealtimeMessageNew = {
  chatId: string;
  message: ApiChatMessage;
};

export type RealtimeMessageAck = {
  client_msg_id: string;
  id: string;
  seq: number;
  created_at: string;
};

export type RealtimeMessageStatus = {
  chat_id?: string;
  message_id?: string;
  up_to_seq?: number;
  read_at?: string;
  delivered_at?: string;
};

export type RealtimeMessageReaction = {
  chatId: string;
  messageId: string;
  accountId: string;
  emoji: string;
};

export type RealtimeMessageEdited = {
  chatId: string;
  message: ApiChatMessage;
};

export type RealtimeMessageDeleted = {
  chatId: string;
  messageId: string;
  deletedAt: string;
};

export type RealtimeTyping = {
  chatId: string;
  userId: string;
  isTyping: boolean;
};

export type RealtimePresenceUpdate = {
  userId: string;
  online: boolean;
  lastActiveAt?: string;
};

export type RealtimeChatDeleted = {
  chatId: string;
};

export type RealtimeChatUpdated = {
  chatId: string;
  pinnedAt?: string | null;
};

export type RealtimeBlockUpdated = {
  userId: string;
  blocked: boolean;
};

export type RealtimeMessageViewed = {
  chatId: string;
  messageId: string;
  viewedAt: string;
};
