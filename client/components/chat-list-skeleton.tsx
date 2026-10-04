/**
 * Placeholder rows shown while the chat list loads for the first time
 * after launch (same idea as WhatsApp / Instagram shimmer rows).
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const ROWS = 8;

export function ChatListSkeleton() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={pulseStyle} accessibilityLabel="Loading chats">
      {Array.from({ length: ROWS }).map((_, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: c.surfaceAlt }]} />
          <View style={styles.lines}>
            <View
              style={[
                styles.line,
                { width: `${45 + ((i * 17) % 30)}%`, backgroundColor: c.surfaceAlt },
              ]}
            />
            <View
              style={[
                styles.line,
                styles.lineShort,
                { width: `${60 + ((i * 11) % 30)}%`, backgroundColor: c.surfaceAlt },
              ]}
            />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  lines: { flex: 1, gap: 8 },
  line: { height: 12, borderRadius: 6 },
  lineShort: { height: 10 },
});
