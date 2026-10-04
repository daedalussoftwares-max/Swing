/**
 * Inbound planes — loaded from GET /v1/planes/inbox.
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
  acceptPlaneApi,
  listInboxPlanes,
  rejectPlaneApi,
} from '@/lib/api/planes-api';
import { isPlaneReceivedNotification } from '@/lib/realtime-notification-sync';
import { connectRealtime, onRealtime } from '@/lib/realtime-ws';
import { logFailure } from '@/lib/debug-logger';
import {
  inboxPlaneFromApi,
  rememberSender,
  type ProfileCache,
} from '@/lib/planes-mapper';
import type { Plane } from '@/types/plane';

type InboxPlanesContextValue = {
  planes: Plane[];
  loading: boolean;
  refresh: () => Promise<void>;
  accept: (planeId: string) => Promise<string | undefined>;
  reject: (planeId: string) => Promise<void>;
  profileCache: ProfileCache;
};

const InboxPlanesContext = createContext<InboxPlanesContextValue | null>(null);

export function InboxPlanesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [planes, setPlanes] = useState<Plane[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileCache] = useState<ProfileCache>(() => new Map());

  const refresh = useCallback(async () => {
    if (status !== 'signed-in') {
      setPlanes([]);
      return;
    }
    setLoading(true);
    try {
      const apiPlanes = await listInboxPlanes();
      const mapped: Plane[] = [];
      for (const p of apiPlanes) {
        const plane = inboxPlaneFromApi(p);
        if (plane) {
          rememberSender(profileCache, plane.sender);
          mapped.push(plane);
        }
      }
      setPlanes(mapped);
    } catch (e) {
      logFailure({
        kind: 'api',
        message: e instanceof Error ? e.message : 'Inbox refresh failed',
        path: '/v1/planes/inbox',
      });
    } finally {
      setLoading(false);
    }
  }, [status, profileCache]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRefreshOnAppActive(refresh);

  useEffect(() => {
    if (status !== 'signed-in') return;
    void connectRealtime();
    return onRealtime((type, data) => {
      if (type === 'plane.inbox.updated') {
        void refresh();
        return;
      }
      if (type === 'notification.new' && isPlaneReceivedNotification(data)) {
        void refresh();
      }
    });
  }, [status, refresh]);

  /**
   * Optimistically drop a plane from the inbox; returns a rollback that
   * re-inserts it at its old position (unless a refresh brought it back).
   */
  const removeOptimistic = useCallback((planeId: string) => {
    let removed: { plane: Plane; index: number } | null = null;
    setPlanes((prev) => {
      const index = prev.findIndex((p) => p.id === planeId);
      if (index < 0) return prev;
      removed = { plane: prev[index], index };
      return prev.filter((p) => p.id !== planeId);
    });
    return () => {
      const r = removed as { plane: Plane; index: number } | null;
      if (!r) return;
      setPlanes((prev) => {
        if (prev.some((p) => p.id === r.plane.id)) return prev;
        const next = prev.slice();
        next.splice(Math.min(r.index, next.length), 0, r.plane);
        return next;
      });
    };
  }, []);

  const accept = useCallback(
    async (planeId: string) => {
      const rollback = removeOptimistic(planeId);
      try {
        const res = await acceptPlaneApi(planeId);
        return res.chatId;
      } catch (e) {
        rollback();
        throw e;
      }
    },
    [removeOptimistic],
  );

  const reject = useCallback(
    async (planeId: string) => {
      const rollback = removeOptimistic(planeId);
      try {
        await rejectPlaneApi(planeId);
      } catch (e) {
        rollback();
        throw e;
      }
    },
    [removeOptimistic],
  );

  const value = useMemo(
    () => ({
      planes,
      loading,
      refresh,
      accept,
      reject,
      profileCache,
    }),
    [planes, loading, refresh, accept, reject, profileCache],
  );

  return (
    <InboxPlanesContext.Provider value={value}>
      {children}
    </InboxPlanesContext.Provider>
  );
}

export function useInboxPlanes(): InboxPlanesContextValue {
  const ctx = useContext(InboxPlanesContext);
  if (!ctx) {
    throw new Error('useInboxPlanes must be used inside <InboxPlanesProvider>');
  }
  return ctx;
}
