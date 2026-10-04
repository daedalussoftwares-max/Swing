import type { Notification } from '@/types/notification';

export function isPlaneReceivedNotification(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const n = data as Notification;
  return n.kind === 'plane-received';
}

export function isPlaneAcceptedNotification(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const n = data as Notification;
  return n.kind === 'plane-accepted';
}
