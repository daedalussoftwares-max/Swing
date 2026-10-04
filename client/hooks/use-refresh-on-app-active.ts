import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Refetch when the app returns to foreground (WS may have missed events). */
export function useRefreshOnAppActive(refresh: () => void | Promise<void>) {
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') void refresh();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);
}
