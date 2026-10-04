/**
 * Outgoing planes — GET /v1/planes/outbox + live `plane.outbox.updated`.
 *
 * Sending is optimistic (`launch`): a placeholder entry (temp id, status
 * 'flying') is inserted and a plane is spent from the balance
 * immediately; POST /v1/planes runs in the background. On success the
 * placeholder is swapped for the server plane and the balance adopts
 * `planesRemaining`; on failure both are rolled back and the caller gets
 * the error to restore the composer.
 *
 * Also keeps the server's idea of our location fresh (radius filter):
 * on sign-in / app foreground, and right before a radius-filtered send.
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
} from 'react';

import { useRefreshOnAppActive } from '@/hooks/use-refresh-on-app-active';
import { ApiError } from '@/lib/api/client';
import { listOutboxPlanes, sendPlane } from '@/lib/api/planes-api';
import type { ApiOutboxUpdate } from '@/lib/api/planes-types';
import { useAuth } from '@/lib/auth-context';
import { logFailure } from '@/lib/debug-logger';
import { resetLocationSync, syncLocationIfNeeded } from '@/lib/location';
import { usePlaneBalance } from '@/lib/plane-balance-context';
import {
  applyOutboxUpdate,
  type LiveSentPlane,
  outboxPlaneFromApi,
  parseOutboxUpdate,
} from '@/lib/planes-mapper';
import { isPlaneAcceptedNotification } from '@/lib/realtime-notification-sync';
import { connectRealtime, onRealtime } from '@/lib/realtime-ws';
import type { SentPlane, SentPlaneStatus } from '@/types/sent-plane';

export type { LiveSentPlane } from '@/lib/planes-mapper';

/** Pre-send location sync never holds the POST longer than this. */
const PRESEND_LOCATION_TIMEOUT_MS = 4000;

export type LaunchResult =
  | { ok: true; plane: LiveSentPlane }
  | { ok: false; error: unknown; code: string };

export type Launch = {
  /** Id of the optimistic placeholder (present in `sentPlanes` right away). */
  tempId: string;
  result: Promise<LaunchResult>;
};

type SentPlanesContextValue = {
  sentPlanes: LiveSentPlane[];
  loading: boolean;
  refresh: () => Promise<void>;
  /**
   * Optimistic send. Returns synchronously with the placeholder id, or
   * `null` if the exact same message is already in flight (double tap).
   */
  launch: (message: string, filters?: SentPlane['filters']) => Launch | null;
  /** Legacy awaitable send — resolves with the server plane, throws on error. */
  recordSent: (message: string, filters?: SentPlane['filters']) => Promise<SentPlane>;
  updateStatus: (
    id: string,
    status: SentPlaneStatus,
    recipientName?: string,
  ) => void;
  total: number;
  acceptedCount: number;
  pendingCount: number;
  /** Planes still looking for someone (incl. optimistic ones). */
  flyingCount: number;
};

const SentPlanesContext = createContext<SentPlanesContextValue | null>(null);

let tempSeq = 0;
function newTempId() {
  tempSeq += 1;
  return `tmp_${Date.now().toString(36)}_${tempSeq}`;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

export function SentPlanesProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { spendOptimistic } = usePlaneBalance();
  const [sentPlanes, setSentPlanes] = useState<LiveSentPlane[]>([]);
  const [loading, setLoading] = useState(false);

  /** temp id → message, for sends whose POST hasn't returned yet. */
  const inFlightRef = useRef(new Map<string, string>());
  /** Realtime updates that arrived before we knew the plane's real id. */
  const earlyUpdatesRef = useRef(new Map<string, ApiOutboxUpdate>());
  /** Mirror of `sentPlanes` for realtime handlers (updated after commit). */
  const planesRef = useRef<LiveSentPlane[]>([]);
  useEffect(() => {
    planesRef.current = sentPlanes;
  }, [sentPlanes]);

  const refresh = useCallback(async () => {
    if (status !== 'signed-in') {
      setSentPlanes([]);
      return;
    }
    setLoading(true);
    try {
      const apiPlanes = await listOutboxPlanes();
      const server = apiPlanes.map(outboxPlaneFromApi);
      setSentPlanes((prev) => {
        // Keep placeholders for sends still in flight, unless the server
        // already lists a matching plane (POST landed, response pending).
        const pending = prev.filter((p) => {
          if (!p.optimistic || !inFlightRef.current.has(p.id)) return false;
          const sentAt = new Date(p.sentAt).getTime();
          return !server.some(
            (s) =>
              s.message === p.message &&
              Math.abs(new Date(s.sentAt).getTime() - sentAt) < 120_000,
          );
        });
        return pending.length ? [...pending, ...server] : server;
      });
    } catch (e) {
      logFailure({
        kind: 'api',
        message: e instanceof Error ? e.message : 'Outbox refresh failed',
        path: '/v1/planes/outbox',
      });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRefreshOnAppActive(refresh);

  // ── Location: on sign-in and whenever the app comes to the foreground.
  const syncLocationOnActive = useCallback(() => {
    if (status !== 'signed-in') return;
    void syncLocationIfNeeded();
  }, [status]);

  useEffect(() => {
    if (status === 'signed-out') {
      void resetLocationSync();
      return;
    }
    syncLocationOnActive();
  }, [status, syncLocationOnActive]);

  useRefreshOnAppActive(syncLocationOnActive);

  // ── Realtime
  useEffect(() => {
    if (status !== 'signed-in') return;
    void connectRealtime();
    return onRealtime((type, data) => {
      if (type === 'plane.outbox.updated') {
        const update = parseOutboxUpdate(data);
        if (!update) return;
        const known = planesRef.current.some((p) => p.id === update.planeId);
        if (known) {
          setSentPlanes((prev) =>
            prev.map((p) =>
              p.id === update.planeId ? applyOutboxUpdate(p, update) : p,
            ),
          );
        } else if (inFlightRef.current.size > 0) {
          // Probably our own just-launched plane whose POST hasn't
          // returned yet — apply once we learn the real id.
          earlyUpdatesRef.current.set(update.planeId, update);
        } else {
          void refresh();
        }
        return;
      }
      if (type === 'notification.new' && isPlaneAcceptedNotification(data)) {
        void refresh();
      }
    });
  }, [status, refresh]);

  const launch = useCallback(
    (message: string, filters?: SentPlane['filters']): Launch | null => {
      const text = message.trim();
      if (!text) return null;
      for (const m of inFlightRef.current.values()) {
        if (m === text) return null; // same message already in flight
      }

      const tempId = newTempId();
      const placeholder: LiveSentPlane = {
        id: tempId,
        message: text,
        sentAt: new Date().toISOString(),
        status: 'flying',
        filters,
        rejections: 0,
        hops: 0,
        optimistic: true,
      };
      inFlightRef.current.set(tempId, text);
      setSentPlanes((prev) => [placeholder, ...prev]);
      const spend = spendOptimistic();

      const result = (async (): Promise<LaunchResult> => {
        try {
          if (filters?.radiusKm) {
            // Best-effort: make sure the server knows where we are so the
            // radius works. Never hold the send for long; if permission is
            // denied the server simply drops the radius constraint.
            await withTimeout(
              syncLocationIfNeeded({ prompt: true }),
              PRESEND_LOCATION_TIMEOUT_MS,
              false,
            );
          }
          const res = await sendPlane(text, filters ?? {});
          let mapped = outboxPlaneFromApi(res.plane);
          const early = earlyUpdatesRef.current.get(mapped.id);
          if (early) {
            earlyUpdatesRef.current.delete(mapped.id);
            mapped = applyOutboxUpdate(mapped, early);
          }
          const final = mapped;
          setSentPlanes((prev) => {
            const idx = prev.findIndex((p) => p.id === tempId);
            const rest = prev.filter((p) => p.id !== tempId && p.id !== final.id);
            if (idx < 0) return [final, ...rest];
            const next = rest.slice();
            next.splice(Math.min(idx, next.length), 0, final);
            return next;
          });
          spend.commit(res.planesRemaining);
          return { ok: true, plane: final };
        } catch (error) {
          setSentPlanes((prev) => prev.filter((p) => p.id !== tempId));
          spend.rollback();
          const code = error instanceof ApiError ? error.code : 'UNKNOWN';
          return { ok: false, error, code };
        } finally {
          inFlightRef.current.delete(tempId);
          if (inFlightRef.current.size === 0 && earlyUpdatesRef.current.size > 0) {
            // Updates for planes we never matched — resync.
            earlyUpdatesRef.current.clear();
            void refresh();
          }
        }
      })();

      return { tempId, result };
    },
    [spendOptimistic, refresh],
  );

  const recordSent = useCallback(
    async (message: string, filters?: SentPlane['filters']) => {
      const l = launch(message, filters);
      if (!l) throw new ApiError('INVALID_INPUT', 'This plane is already on its way.');
      const res = await l.result;
      if (!res.ok) throw res.error;
      return res.plane;
    },
    [launch],
  );

  const updateStatus = useCallback(
    (id: string, status: SentPlaneStatus, recipientName?: string) => {
      setSentPlanes((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                status,
                recipientName: recipientName ?? p.recipientName,
              }
            : p,
        ),
      );
    },
    [],
  );

  const counts = useMemo(() => {
    let accepted = 0;
    let pending = 0;
    let flying = 0;
    for (const p of sentPlanes) {
      if (p.status === 'accepted') accepted += 1;
      else if (p.status === 'pending') pending += 1;
      else if (p.status === 'flying') flying += 1;
    }
    return { accepted, pending, flying };
  }, [sentPlanes]);

  const value = useMemo<SentPlanesContextValue>(
    () => ({
      sentPlanes,
      loading,
      refresh,
      launch,
      recordSent,
      updateStatus,
      total: sentPlanes.length,
      acceptedCount: counts.accepted,
      pendingCount: counts.pending,
      flyingCount: counts.flying,
    }),
    [sentPlanes, loading, refresh, launch, recordSent, updateStatus, counts],
  );

  return (
    <SentPlanesContext.Provider value={value}>
      {children}
    </SentPlanesContext.Provider>
  );
}

export function useSentPlanes(): SentPlanesContextValue {
  const ctx = useContext(SentPlanesContext);
  if (!ctx) {
    throw new Error(
      'useSentPlanes must be used inside <SentPlanesProvider>',
    );
  }
  return ctx;
}
