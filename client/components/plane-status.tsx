/**
 * Live delivery status for a plane the user SENT.
 *
 *   flying   → "Flying" + animated dots (looking for someone)
 *   pending  → "Delivered to X"
 *   accepted → "Accepted by X"
 *   expired  → "Expired"
 *   rejected → "Passed on"
 *
 * Plus "passed on N times" from `rejections`.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { LiveSentPlane } from '@/lib/planes-mapper';
import type { SentPlane, SentPlaneStatus } from '@/types/sent-plane';

type Palette = (typeof Colors)['light'];

export type PlaneStatusMeta = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Short label for compact pills. */
  short: string;
  tint: string;
  animated: boolean;
};

export function planeStatusMeta(
  plane: Pick<SentPlane, 'status' | 'recipientName' | 'recipient'> & {
    optimistic?: boolean;
  },
  c: Palette,
): PlaneStatusMeta {
  const name = plane.recipient?.name ?? plane.recipientName;
  return metaFor(plane.status, name, !!plane.optimistic, c);
}

function metaFor(
  status: SentPlaneStatus,
  name: string | undefined,
  optimistic: boolean,
  c: Palette,
): PlaneStatusMeta {
  switch (status) {
    case 'flying':
      return {
        icon: 'paper-plane',
        label: optimistic ? 'Taking off' : 'Flying — finding someone',
        short: optimistic ? 'Taking off' : 'Flying',
        tint: c.tint,
        animated: true,
      };
    case 'pending':
      return {
        icon: 'mail-unread-outline',
        label: name ? `Delivered to ${name}` : 'Delivered',
        short: 'Delivered',
        tint: c.warning,
        animated: false,
      };
    case 'accepted':
      return {
        icon: 'checkmark-circle',
        label: name ? `Accepted by ${name}` : 'Accepted',
        short: 'Accepted',
        tint: c.success,
        animated: false,
      };
    case 'expired':
      return {
        icon: 'time-outline',
        label: 'Expired',
        short: 'Expired',
        tint: c.textSubtle,
        animated: false,
      };
    case 'rejected':
    default:
      return {
        icon: 'return-up-forward-outline',
        label: 'Passed on',
        short: 'Passed on',
        tint: c.textMuted,
        animated: false,
      };
  }
}

export function passedOnLabel(plane: Pick<LiveSentPlane, 'rejections'>): string | null {
  const n = plane.rejections ?? 0;
  if (n <= 0) return null;
  return n === 1 ? 'Passed on once' : `Passed on ${n} times`;
}

// ── Animated "…" dots ───────────────────────────────────────────────────────

export const FlyingDots = memo(function FlyingDots({
  color,
  size = 4,
}: {
  color: string;
  size?: number;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(t);
  }, [t]);

  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} t={t} color={color} size={size} />
      ))}
    </View>
  );
});

function Dot({
  index,
  t,
  color,
  size,
}: {
  index: number;
  t: SharedValue<number>;
  color: string;
  size: number;
}) {
  const style = useAnimatedStyle(() => {
    // Each dot peaks a third of a cycle after the previous one.
    const phase = (t.value - index / 3 + 1) % 1;
    const lift = interpolate(phase, [0, 0.25, 0.5, 1], [0, 1, 0, 0]);
    return {
      opacity: 0.35 + lift * 0.65,
      transform: [{ translateY: -lift * 2.5 }],
    };
  });
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

// ── Pill ────────────────────────────────────────────────────────────────────

export const PlaneStatusPill = memo(function PlaneStatusPill({
  plane,
  compact,
}: {
  plane: LiveSentPlane;
  compact?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const meta = planeStatusMeta(plane, c);
  return (
    <View style={[styles.pill, { backgroundColor: meta.tint + '1F' }]}>
      <Ionicons name={meta.icon} size={12} color={meta.tint} />
      <ThemedText style={[styles.pillText, { color: meta.tint }]} numberOfLines={1}>
        {compact ? meta.short : meta.label}
      </ThemedText>
      {meta.animated ? <FlyingDots color={meta.tint} size={3} /> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  pillText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
});
