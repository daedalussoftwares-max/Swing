/**
 * Second hero slide — illustrates the *outgoing* side of the product:
 * a single paper plane traces a gentle arc across the canvas, leaving
 * a fading dotted trail behind it.
 *
 * Design language matches `PaperPlaneMeet` so the carousel feels like
 * one coherent set: same Reanimated driver pattern, same brand-tint
 * dots, similar loop length (~4s).
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = { height?: number };

/** Number of trail dots. Each dot turns on at a different point in the
 *  loop — the plane "leaves" them behind as it moves. */
const TRAIL_DOTS = 7;

const CYCLE_MS = 4400;

export function PlaneJourney({ height = 220 }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Single driver — 0 → 1 → 0 on a loop.
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, {
        duration: CYCLE_MS,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      false,
    );
  }, [t]);

  // Plane position — sweeps from -120 to +120 along x, with a sine
  // dip on y so the path looks arched.
  const planeStyle = useAnimatedStyle(() => {
    const x = interpolate(t.value, [0, 1], [-130, 130]);
    const y = -Math.sin(t.value * Math.PI) * 28;
    const rot = interpolate(t.value, [0, 0.5, 1], [-12, 0, 12]);
    // Quick fade-in at the very start so the loop reset isn't jarring.
    const op = interpolate(t.value, [0, 0.08, 0.92, 1], [0, 1, 1, 0]);
    return {
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${rot}deg` }],
      opacity: op,
    };
  });

  return (
    <View style={[styles.canvas, { height }]} pointerEvents="none">
      <View style={styles.row}>
        {/* Trail dots — each dot's "appearance window" is centred on
            the moment the plane was at that x position. */}
        {Array.from({ length: TRAIL_DOTS }).map((_, i) => (
          <TrailDot
            key={i}
            index={i}
            total={TRAIL_DOTS}
            progress={t}
            color={c.tint}
          />
        ))}

        <Animated.View style={[styles.plane, planeStyle]}>
          <Ionicons name="paper-plane" size={36} color={c.tint} />
        </Animated.View>
      </View>
    </View>
  );
}

function TrailDot({
  index,
  total,
  progress,
  color,
}: {
  index: number;
  total: number;
  progress: SharedValue<number>;
  color: string;
}) {
  // Each dot sits at a fixed x along the path. When the plane reaches
  // that x, the dot fades in; shortly after it fades back out.
  const dotProgress = (index + 1) / (total + 1); // (0, 1) excluding ends
  const x = interpolate(dotProgress, [0, 1], [-110, 110]);
  const y = -Math.sin(dotProgress * Math.PI) * 28 + 18; // sits slightly below path

  const style = useAnimatedStyle(() => {
    // Window of visibility: opens just before the plane passes,
    // closes ~200ms after.
    const start = dotProgress - 0.05;
    const peak = dotProgress + 0.05;
    const end = dotProgress + 0.35;
    const op = interpolate(
      progress.value,
      [start, peak, end],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    return { opacity: op };
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color, transform: [{ translateX: x }, { translateY: y }] },
        style,
      ]}
    />
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
  plane: {
    position: 'absolute',
  },
  dot: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
