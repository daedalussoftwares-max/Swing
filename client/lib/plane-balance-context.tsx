/**
 * Plane balance from the server (`/v1/me.planesRemaining`), with
 * optimistic adjustments so sending feels instant.
 *
 *   count = max(0, base - inFlightSpends)
 *   base  = latest server count from a send response (`setServerCount`)
 *           while the auth user's value hasn't changed since; otherwise
 *           `useAuth().user.planesRemaining`.
 *
 * The override is keyed by the auth value at the time it was set, so a
 * later `refreshUser()` (new auth value) silently supersedes it — no
 * effect / auth-context changes needed.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '@/lib/auth-context';

export type PlaneSpend = {
  /** Give the plane back (send failed). Idempotent. */
  rollback: () => void;
  /** Send succeeded; optionally adopt the server's fresh count. Idempotent. */
  commit: (serverCount?: number) => void;
};

type PlaneBalance = {
  count: number;
  refresh: () => Promise<void>;
  /** Decrement immediately; settle later with `commit` / `rollback`. */
  spendOptimistic: () => PlaneSpend;
  /** Adopt a server-reported count until the auth user value changes. */
  setServerCount: (n: number) => void;
};

type Override = { authAt: number | undefined; count: number };

const PlaneBalanceContext = createContext<PlaneBalance | null>(null);

export function PlaneBalanceProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const authCount = user?.planesRemaining;
  const [override, setOverride] = useState<Override | null>(null);
  const [inFlight, setInFlight] = useState(0);

  const setServerCount = useCallback(
    (n: number) => {
      if (!Number.isFinite(n)) return;
      setOverride({ authAt: authCount, count: Math.max(0, Math.floor(n)) });
    },
    [authCount],
  );

  const spendOptimistic = useCallback((): PlaneSpend => {
    let settled = false;
    setInFlight((n) => n + 1);
    const release = () => {
      if (settled) return false;
      settled = true;
      setInFlight((n) => Math.max(0, n - 1));
      return true;
    };
    return {
      rollback: () => {
        release();
      },
      commit: (serverCount?: number) => {
        if (!release()) return;
        if (typeof serverCount === 'number') setServerCount(serverCount);
      },
    };
  }, [setServerCount]);

  const refresh = useCallback(async () => {
    await refreshUser();
  }, [refreshUser]);

  const base =
    override && override.authAt === authCount ? override.count : (authCount ?? 0);
  const count = Math.max(0, base - inFlight);

  const value = useMemo<PlaneBalance>(
    () => ({ count, refresh, spendOptimistic, setServerCount }),
    [count, refresh, spendOptimistic, setServerCount],
  );

  return (
    <PlaneBalanceContext.Provider value={value}>
      {children}
    </PlaneBalanceContext.Provider>
  );
}

export function usePlaneBalance(): PlaneBalance {
  const ctx = useContext(PlaneBalanceContext);
  if (!ctx) {
    throw new Error('usePlaneBalance must be used inside <PlaneBalanceProvider>');
  }
  return ctx;
}
