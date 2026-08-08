/**
 * Hero animation shown above the signup / signin forms.
 *
 * Concept: two paper planes start at opposite ends of the canvas,
 * gently fly toward each other along arc-shaped paths, and meet in
 * the middle. On meeting they pause, a soft sparkle pulses, then the
 * loop restarts from a fade-out.
 *
 * Implementation notes:
 *   - Pure Reanimated 4 worklets — runs on UI thread, no jank.
 *   - The arc is built from a sine wave so each plane dips slightly
 *     as it travels (more visually interesting than a straight line).
 *   - Rotation tilts each plane toward its direction of travel; the
 *     left plane is mirrored so its nose points right.
 *   - Loop period is intentionally slow (~4s) so the screen feels
 *     calm — this is signup, not a game.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  /** Outer container height — width is taken from the parent. */
  height?: number;
};

const CYCLE_MS = 4400;

export function PaperPlaneMeet({ height = 220 }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // `progress` goes 0 → 1 → 0 (eased) on a loop. We derive plane
  // positions, opacity and the sparkle pulse from this single driver.
  const progress = useSharedValue(0);
  // Separate sharedValue for the "meet" sparkle so it can pulse only
  // around progress ≈ 1, not throughout the loop.
  const sparkle = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: CYCLE_MS * 0.55,
          easing: Easing.inOut(Easing.cubic),
        }),
        // Hold at the meeting point for a beat — feels intentional.
        withDelay(450, withTiming(1, { duration: 0 })),
        withTiming(0, { duration: CYCLE_MS * 0.25, easing: Easing.in(Easing.cubic) }),
        withDelay(300, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
    // Sparkle: a small pulse triggered right around the meeting moment.
    sparkle.value = withRepeat(
      withSequence(
        withDelay(
          CYCLE_MS * 0.5,
          withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
        ),
        withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) }),
        withDelay(CYCLE_MS - CYCLE_MS * 0.5 - 540, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, [progress, sparkle]);

  // Left plane: starts at x = -50%, rises slightly, ends at center.
  const leftStyle = useAnimatedStyle(() => {
    const x = interpolate(progress.value, [0, 1], [-130, 0]);
    const dipY = Math.sin(progress.value * Math.PI) * 18; // arc dip
    // Slight tilt as it travels.
    const rot = interpolate(progress.value, [0, 0.5, 1], [-8, -2, 6]);
    const op = interpolate(progress.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0.85]);
    return {
      transform: [
        { translateX: x },
        { translateY: -dipY },
        { rotate: `${rot}deg` },
      ],
      opacity: op,
    };
  });

  // Right plane: mirrored — starts at +50% from center, ends at center.
  const rightStyle = useAnimatedStyle(() => {
    const x = interpolate(progress.value, [0, 1], [130, 0]);
    const dipY = Math.sin(progress.value * Math.PI) * 18;
    const rot = interpolate(progress.value, [0, 0.5, 1], [188, 182, 174]); // mirrored
    const op = interpolate(progress.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0.85]);
    return {
      transform: [
        { translateX: x },
        { translateY: -dipY },
        { rotate: `${rot}deg` },
      ],
      opacity: op,
    };
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    opacity: sparkle.value,
    transform: [
      { scale: interpolate(sparkle.value, [0, 1], [0.6, 1.4]) },
    ],
  }));

  return (
    <View style={[styles.canvas, { height }]} pointerEvents="none">
      {/* Subtle dotted trail behind each plane — gives a sense of
          motion even at the static frames. We render simple aligned
          dots; their opacity is driven off `progress` indirectly via
          parent opacity. */}
      <View style={styles.row}>
        <Animated.View style={[styles.plane, leftStyle]}>
          <Ionicons name="paper-plane" size={36} color={c.tint} />
        </Animated.View>

        {/* Sparkle pulse — small accent dot that pops on meet. */}
        <Animated.View
          style={[
            styles.sparkle,
            { backgroundColor: c.tint + '33', borderColor: c.tint },
            sparkleStyle,
          ]}
        />

        <Animated.View style={[styles.plane, rightStyle]}>
          <Ionicons name="paper-plane" size={36} color={c.tint} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Each plane is centred on the row; `translateX` drives its position.
  plane: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkle: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
  },
});
