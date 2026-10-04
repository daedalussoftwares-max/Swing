import { authedFetch } from '@/lib/api/authed-fetch';
import type { Notification } from '@/types/notification';

export type ApiNotification = {
  id: string;
  kind: Notification['kind'];
  title: string;
  body?: string;
  fromName?: string;
  deepLink?: string;
  createdAt: string;
  read: boolean;
};

function mapNotification(n: ApiNotification): Notification {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    fromName: n.fromName,
    deepLink: n.deepLink,
    createdAt: n.createdAt,
    read: n.read,
  };
}

export async function listNotifications(): Promise<Notification[]> {
  const res = await authedFetch<{ notifications: ApiNotification[] }>(
    '/v1/notifications',
  );
  return (res.notifications ?? []).map(mapNotification);
}

export async function markNotificationRead(id: string): Promise<void> {
  await authedFetch(`/v1/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await authedFetch('/v1/notifications/read-all', { method: 'POST' });
}
