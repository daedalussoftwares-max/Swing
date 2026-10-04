import { useCallback, useRef } from 'react';

import { useFocusEffect } from '@/lib/router';

const MIN_INTERVAL_MS = 8_000;

/** Refetch when a screen gains focus, at most once every 8s (avoids API spam). */
export function useRefreshOnFocus(refresh: () => void | Promise<void>) {
  const lastRun = useRef(0);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastRun.current < MIN_INTERVAL_MS) return;
      lastRun.current = now;
      void refresh();
    }, [refresh]),
  );
}
