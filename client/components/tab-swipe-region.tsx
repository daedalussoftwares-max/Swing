/**
 * Legacy wrapper from the old "fake" tab swipe (PanResponder + navigate on
 * release). Tab swiping is now native and finger-following: MainTabNavigator
 * is a material-top-tabs navigator backed by react-native-pager-view, so this
 * component is a plain passthrough View kept only so existing screens compile
 * with an identical layout. `consumeSwipe` / `withNativeScroll` are ignored —
 * nested horizontal ScrollViews/FlatLists win their own touches natively.
 *
 * New code should not use it.
 */

import { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

// Tab order — must match MainTabNavigator left-to-right.
export const TAB_ROUTES = ['/', '/chats', '/send', '/explore', '/profile'] as const;
export type TabRoute = (typeof TAB_ROUTES)[number];

export type SwipeDirection = 'left' | 'right';

type Props = {
  currentRoute: TabRoute;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** @deprecated No-op; kept for source compatibility. */
  withNativeScroll?: boolean;
  /** @deprecated No-op; kept for source compatibility. */
  consumeSwipe?: (direction: SwipeDirection) => boolean;
};

/** @deprecated Passthrough View — tab swiping is handled by the pager. */
export function TabSwipeRegion({ children, style }: Props) {
  return <View style={style}>{children}</View>;
}
