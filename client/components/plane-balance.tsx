/**
 * Pill-shaped indicator showing how many planes the user has left.
 * Reads from `usePlaneBalance` so it stays in sync everywhere (including
 * optimistic spends). The pill does a little bump whenever the count
 * changes.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePlaneBalance } from '@/lib/plane-balance-context';

export function PlaneBalance() {
  const { count } = usePlaneBalance();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const isEmpty = count <= 0;

  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  const prev = useRef(count);
  useEffect(() => {
    if (prev.current === count) return;
    const spent = count < prev.current;
    prev.current = count;
    scale.value = withSequence(
      withTiming(spent ? 0.86 : 1.18, { duration: 110 }),
      withSpring(1, { damping: 8, stiffness: 260 }),
    );
    if (spent) {
      lift.value = withSequence(
        withTiming(-6, { duration: 140 }),
        withSpring(0, { damping: 10, stiffness: 200 }),
      );
    }
  }, [count, scale, lift]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { translateX: -lift.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: isEmpty ? c.surfaceAlt : c.tintMuted,
          borderColor: isEmpty ? c.border : c.tint,
        },
        pillStyle,
      ]}
      accessibilityLabel={`${count} planes left`}
    >
      <Animated.View style={iconStyle}>
        <Ionicons
          name="paper-plane"
          size={14}
          color={isEmpty ? c.textSubtle : c.tintPressed}
        />
      </Animated.View>
      <ThemedText
        style={[styles.count, { color: isEmpty ? c.textSubtle : c.tintPressed }]}
      >
        {count}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
