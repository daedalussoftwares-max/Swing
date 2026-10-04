/**
 * Maps a tapped push's data payload to a screen in the root stack.
 * Payload contract (backend/serving/app/cmd/push):
 *   chat_message   { chatId, messageId, senderId } → Chat
 *   plane_received { planeId }                     → PlaneDetail
 *   plane_accepted { planeId, chatId? }            → Chat, else Notifications
 */
import type { RootStackParamList } from '@/navigation/types';

export type PushTarget =
  | { name: 'Chat'; params: RootStackParamList['Chat'] }
  | { name: 'PlaneDetail'; params: RootStackParamList['PlaneDetail'] }
  | { name: 'Notifications'; params?: undefined };

type PushData = Record<string, string | object> | undefined;

function str(data: PushData, key: string): string {
  const v = data?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function pushTargetFromData(data: PushData): PushTarget | null {
  const type = str(data, 'type');
  const chatId = str(data, 'chatId');
  const planeId = str(data, 'planeId');
  switch (type) {
    case 'chat_message':
      return chatId ? { name: 'Chat', params: { chatId } } : null;
    case 'plane_received':
      return planeId
        ? { name: 'PlaneDetail', params: { id: planeId } }
        : { name: 'Notifications' };
    case 'plane_accepted':
      return chatId ? { name: 'Chat', params: { chatId } } : { name: 'Notifications' };
    default:
      return null;
  }
}
