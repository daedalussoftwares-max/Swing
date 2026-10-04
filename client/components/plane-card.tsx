/**
 * Visual card for a single received paper plane.
 *
 * Pure presentational — receives a `Plane` and renders it. Three independent
 * tap targets, in order of "specificity wins" (RN press hits the innermost
 * pressable):
 *   1. Accept / Reject action buttons
 *   2. Avatar circle → opens the sender's profile screen
 *   3. The rest of the card body → opens the full plane-detail screen
 *
 * Accept / Reject play a short fly-off on the UI thread (accept: the
 * card lifts up and away like a launched plane; reject: it tips over and
 * drops) and only THEN call the handler, so the optimistic removal in
 * the inbox context never cuts the animation short.
 *
 * The message text on the card is intentionally TRIMMED with
 * `numberOfLines={3}` so the card stays consistent height; the full text
 * is visible on the detail screen.
 */

import * as Haptics from '@/lib/native/haptics';
import { Ionicons } from '@/lib/native/vector-icons';
import { memo, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SwipeSafePressable } from '@/components/swipe-safe-pressable';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Plane } from '@/types/plane';
import { withFlag } from '@/lib/countries';

type Props = {
  plane: Plane;
  onOpen?: (plane: Plane) => void;
  onOpenProfile?: (plane: Plane) => void;
  onAccept?: (plane: Plane) => void;
  onReject?: (plane: Plane) => void;
};

export const PlaneCard = memo(function PlaneCard({
  plane,
  onOpen,
  onOpenProfile,
  onAccept,
  onReject,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const avatarInitial = plane.sender.name.charAt(0).toUpperCase();

  // 0 = resting, 1 = accepted (flies up-right), -1 = rejected (drops left).
  const fly = useSharedValue(0);
  const busy = useSharedValue(false);
  const bob = useSharedValue(0);

  useEffect(() => {
    bob.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(bob);
  }, [bob]);

  const cardStyle = useAnimatedStyle(() => {
    const a = fly.value > 0 ? fly.value : 0;
    const r = fly.value < 0 ? -fly.value : 0;
    return {
      opacity: 1 - interpolate(a + r, [0, 0.6, 1], [0, 0.2, 1]),
      transform: [
        { translateX: a * 140 - r * 320 },
        { translateY: -a * 520 + r * 120 },
        { rotate: `${a * 14 - r * 18}deg` },
        { scale: 1 - a * 0.25 - r * 0.08 },
      ],
    };
  });

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -6 * bob.value },
      { rotate: `${-4 + 8 * bob.value}deg` },
    ],
  }));

  const finish = useCallback(
    (kind: 'accept' | 'reject') => {
      if (kind === 'accept') onAccept?.(plane);
      else onReject?.(plane);
      // If the plane is still here later (e.g. the request failed and was
      // rolled back without a remount), settle the card back in place.
      fly.value = withDelay(1500, withSpring(0, { damping: 14 }));
      busy.value = false;
    },
    [onAccept, onReject, plane, fly, busy],
  );

  const handleAccept = useCallback(() => {
    if (busy.value) return;
    busy.value = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    fly.value = withSequence(
      withTiming(-0.03, { duration: 90 }),
      withTiming(1, { duration: 380, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(finish)('accept');
      }),
    );
  }, [busy, fly, finish]);

  const handleReject = useCallback(() => {
    if (busy.value) return;
    busy.value = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fly.value = withTiming(-1, { duration: 340, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) runOnJS(finish)('reject');
    });
  }, [busy, fly, finish]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          backgroundColor: c.surface,
          borderColor: c.border,
        },
        cardStyle,
      ]}
    >
      <SwipeSafePressable
        onPress={() => onOpen?.(plane)}
        style={styles.cardBody}
      >
      {/* Top: sender info + age pill */}
      <View style={styles.topRow}>
        <View style={styles.senderRow}>
          <SwipeSafePressable
            onPress={() => onOpenProfile?.(plane)}
            style={[
              styles.avatar,
              { backgroundColor: c.tintMuted },
            ]}
          >
            <ThemedText style={[styles.avatarInitial, { color: c.tintPressed }]}>
              {avatarInitial}
            </ThemedText>
          </SwipeSafePressable>
          <View style={styles.senderText}>
            <ThemedText style={styles.senderName} numberOfLines={1}>
              {plane.sender.name}
            </ThemedText>
            <ThemedText style={[styles.distance, { color: c.textMuted }]}>
              {plane.sender.city && plane.sender.country
                ? `${plane.sender.city}, ${withFlag(plane.sender.country)}`
                : plane.sender.distanceKm > 0
                  ? `${plane.sender.distanceKm} km away`
                  : 'On Swing'}
            </ThemedText>
          </View>
        </View>

        {/* Corner pill — gender flag (M / F / NB). Falls back to the
            age string only when no gender has been set. Hidden when
            there's nothing to show. */}
        {plane.sender.gender || plane.sender.ageBadge ? (
          <View style={[styles.agePill, { backgroundColor: c.surfaceAlt }]}>
            <ThemedText style={[styles.ageText, { color: c.textMuted }]}>
              {plane.sender.gender ?? plane.sender.ageBadge}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* Gently bobbing plane */}
      <View style={styles.illustration}>
        <View style={[styles.illustrationGlow, { backgroundColor: c.tintMuted }]} />
        <Animated.View style={iconStyle}>
          <Ionicons name="paper-plane-outline" size={80} color={c.tint} />
        </Animated.View>
      </View>

      {/* Message — trimmed; tap card to read full. */}
      <ThemedText style={styles.message} numberOfLines={3}>
        {plane.message}
      </ThemedText>
      <ThemedText style={[styles.tapHint, { color: c.textSubtle }]}>
        Tap to read full
      </ThemedText>

      {/* Decorative dotted divider */}
      <View style={styles.dotsRow}>
        {Array.from({ length: 24 }).map((_, i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: c.borderStrong }]}
          />
        ))}
      </View>
      </SwipeSafePressable>

      {/* Action buttons — outside the card press target so Accept/Reject
          don't also open the plane-detail screen. */}
      <View style={styles.actions}>
        <ActionButton
          icon="close"
          color={c.danger}
          label="Pass"
          onPress={handleReject}
          bg={c.surface}
          border={c.border}
        />
        <ActionButton
          icon="checkmark"
          color={c.success}
          label="Accept"
          onPress={handleAccept}
          bg={c.surface}
          border={c.border}
        />
      </View>

      {/* Paper-fold corner accent (subtle visual nod to the design) */}
      <View
        style={[
          styles.foldCorner,
          { borderColor: c.border, backgroundColor: c.surfaceAlt },
        ]}
      />
    </Animated.View>
  );
});

function ActionButton({
  icon,
  color,
  label,
  onPress,
  bg,
  border,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  onPress: () => void;
  bg: string;
  border: string;
}) {
  const press = useSharedValue(1);
  const style = usePressStyle(press);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withSpring(0.86, { damping: 14, stiffness: 420 });
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 9, stiffness: 260 });
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View
        style={[styles.actionButton, { backgroundColor: bg, borderColor: border }, style]}
      >
        <Ionicons name={icon} size={28} color={color} />
      </Animated.View>
    </Pressable>
  );
}

function usePressStyle(press: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  cardBody: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  senderText: {
    flexShrink: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '700',
  },
  senderName: {
    fontSize: 16,
    fontWeight: '600',
  },
  distance: {
    fontSize: 13,
    marginTop: 2,
  },
  agePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.pill,
    minWidth: 40,
    alignItems: 'center',
  },
  ageText: {
    fontSize: 12,
    fontWeight: '600',
  },
  illustration: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
    height: 110,
  },
  illustrationGlow: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    opacity: 0.6,
  },
  message: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: Spacing.md,
  },
  tapHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: Spacing.sm,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.lg,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl,
    marginTop: Spacing.lg,
  },
  actionButton: {
    width: 56,
    height: 56,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  foldCorner: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderTopLeftRadius: Radii.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
});
