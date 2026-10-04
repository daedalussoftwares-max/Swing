import { useEffect, useState } from 'react';

import { isRealtimeConnected, onRealtimeStatus } from '@/lib/realtime-ws';

/**
 * Live WebSocket status. Debounced on the way down so a quick reconnect
 * doesn't flash a "Connecting…" label.
 */
export function useRealtimeConnected(graceMs = 1500): boolean {
  const [connected, setConnected] = useState(isRealtimeConnected);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onRealtimeStatus((next) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (next) setConnected(true);
      else timer = setTimeout(() => setConnected(false), graceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [graceMs]);
  return connected;
}
