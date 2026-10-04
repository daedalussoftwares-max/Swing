/**
 * Notifications — GET /v1/notifications + WebSocket notification.new.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useRefreshOnAppActive } from '@/hooks/use-refresh-on-app-active';
import { useAuth } from '@/lib/auth-context';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications-api';
import {
  connectRealtime,
  onRealtime,
} from '@/lib/realtime-ws';
import type { Notification } from '@/types/notification';

type NotificationsContextValue = {
  notifications: Notification[];
  loading: boolean;
  unreadCount: number;
  refresh: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (status !== 'signed-in') {
      setNotifications([]);
      return;
    }
    setLoading(true);
    try {
      setNotifications(await listNotifications());
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRefreshOnAppActive(refresh);

  useEffect(() => {
    if (status !== 'signed-in') return;
    void connectRealtime();
    return onRealtime((type, data) => {
      if (type !== 'notification.new' || !data) return;
      const n = data as Notification;
      if (!n.id) return;
      setNotifications((prev) => {
        if (prev.some((x) => x.id === n.id)) return prev;
        return [n, ...prev];
      });
    });
  }, [status]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    void markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    void markAllNotificationsRead();
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    void markNotificationRead(id);
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const value = useMemo<NotificationsContextValue>(
    () => ({
      notifications,
      loading,
      unreadCount,
      refresh,
      markRead,
      markAllRead,
      dismiss,
      clearAll,
    }),
    [
      notifications,
      loading,
      unreadCount,
      refresh,
      markRead,
      markAllRead,
      dismiss,
      clearAll,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      'useNotifications must be used inside <NotificationsProvider>',
    );
  }
  return ctx;
}
