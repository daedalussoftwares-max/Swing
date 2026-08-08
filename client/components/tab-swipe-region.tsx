/**
 * Transparent wrapper that turns any region into a "swipe to switch tab"
 * surface. Uses PanResponder (not RNGH Gesture) for New Architecture compatibility.
 */

import { useRouter } from '@/lib/router';
import { type ReactNode, useMemo, useRef } from 'react';
import { PanResponder, View, type ViewStyle } from 'react-native';

// Tab order — must match (tabs)/_layout.tsx left-to-right.
export const TAB_ROUTES = ['/', '/chats', '/send', '/explore', '/profile'] as const;
export type TabRoute = (typeof TAB_ROUTES)[number];

export type SwipeDirection = 'left' | 'right';

type Props = {
  currentRoute: TabRoute;
  children?: ReactNode;
  style?: ViewStyle;
  /** Reserved for horizontal lists — pan still works on surrounding areas. */
  withNativeScroll?: boolean;
  consumeSwipe?: (direction: SwipeDirection) => boolean;
};

const SWIPE_DIST = 36;
const FLICK_VEL = 600;

export function TabSwipeRegion({
  currentRoute,
  children,
  style,
  consumeSwipe,
}: Props) {
  const router = useRouter();
  const currentIndex = TAB_ROUTES.indexOf(currentRoute);
  const consumeSwipeRef = useRef(consumeSwipe);
  consumeSwipeRef.current = consumeSwipe;

  const panResponder = useMemo(() => {
    const navigateTo = (offset: number) => {
      const target = currentIndex + offset;
      if (target < 0 || target >= TAB_ROUTES.length) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.navigate(TAB_ROUTES[target] as any);
    };

    const handlePanEnd = (direction: SwipeDirection) => {
      if (consumeSwipeRef.current?.(direction)) return;
      navigateTo(direction === 'left' ? 1 : -1);
    };

    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > 10,
      onPanResponderRelease: (_, g) => {
        if (
          g.dx < -SWIPE_DIST ||
          (g.vx < -FLICK_VEL && g.dx < -10)
        ) {
          handlePanEnd('left');
        } else if (
          g.dx > SWIPE_DIST ||
          (g.vx > FLICK_VEL && g.dx > 10)
        ) {
          handlePanEnd('right');
        }
      },
    });
  }, [currentIndex, router]);

  return (
    <View style={style} {...panResponder.panHandlers}>
      {children}
    </View>
  );
}
