/**
 * Tiny reanimated hook that produces a "screen content fades + slides in
 * by a hair" animated style every time a tab gains focus.
 *
 * Direction-aware: the content slides in from the LEFT when you go
 * back to a previous tab, and from the RIGHT when moving forward.
 * That subtle directional cue is what makes tab switching read as a
 * proper pager transition instead of a hard jump.
 *
 * Combined with the bottom tab bar's animated indicator and icon scaling,
 * this gives a clear "kuch hua, tab change ho gaya" feel — without needing
 * full pager-view tab swipes (optional future enhancement).
 *
 * Usage:
 *   const fadeStyle = useTabFocusFade();
 *   ...
 *   <Animated.View style={[styles.root, fadeStyle]}>...</Animated.View>
 */

import { useFocusEffect, usePathname } from '@/lib/router';
import { useCallback } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Tab order from left to right in the bottom tab bar — kept in sync with
// `tab-swipe-region.tsx`. Anything not in this list is treated as
// neutral and slides in from the right.
const TAB_ORDER = ['/', '/chats', '/send', '/explore', '/profile'] as const;

// Module-scoped "what was the last focused tab" so we can compute slide
// direction without each screen having to wire it up themselves.
let lastTabIndex: number | null = null;

const SLIDE_DISTANCE = 18;
const DURATION = 240;

export function useTabFocusFade() {
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);
  const pathname = usePathname();

  useFocusEffect(
    useCallback(() => {
      const idx = TAB_ORDER.indexOf(pathname as (typeof TAB_ORDER)[number]);
      // Direction: +1 forward, -1 back, 0 neutral (first focus / not a tab).
      const dir =
        lastTabIndex === null || idx === -1
          ? 1
          : idx > lastTabIndex
            ? 1
            : idx < lastTabIndex
              ? -1
              : 0;
      if (idx !== -1) lastTabIndex = idx;

      opacity.value = 0.45;
      translateX.value = SLIDE_DISTANCE * dir;
      opacity.value = withTiming(1, { duration: DURATION });
      translateX.value = withTiming(0, { duration: DURATION });
      // No cleanup — the next focus event resets the values.
    }, [opacity, translateX, pathname]),
  );

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));
}
