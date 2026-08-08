/**
 * Third hero slide — illustrates what happens *after* a plane lands:
 * a real conversation. Two avatar circles sit on either side; tiny
 * chat bubbles spawn alternately from each side, float upward, then
 * fade out. A little heart-spark pulses in the middle when the
 * bubbles "meet" mid-canvas.
 *
 * Loop length matches the other two hero animations (~4s) so the
 * carousel feels rhythmically consistent when the user swipes.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = { height?: number };

const CYCLE_MS = 4400;

export function ChatSpark({ height = 220 }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Two synchronised drivers, offset by half a cycle so the bubbles
  // alternate (left side speaks, right side replies).
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const heart = useSharedValue(0);

  useEffect(() => {
    left.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    right.value = withDelay(
      CYCLE_MS / 2,
      withRepeat(
        withTiming(1, {
          duration: CYCLE_MS,
          easing: Easing.inOut(Easing.cubic),
        }),
        -1,
        false,
      ),
    );
    heart.value = withRepeat(
      withSequence(
        withDelay(
          CYCLE_MS / 2 - 200,
          withTiming(1, {
            duration: 240,
            easing: Easing.out(Easing.cubic),
          }),
        ),
        withTiming(0, { duration: 280, easing: Easing.in(Easing.cubic) }),
        withDelay(CYCLE_MS - (CYCLE_MS / 2 - 200) - 520, withTiming(0, { duration: 0 })),
      ),
      -1,
      false,
    );
  }, [left, right, heart]);

  const heartStyle = useAnimatedStyle(() => ({
    opacity: heart.value,
    transform: [{ scale: interpolate(heart.value, [0, 1], [0.6, 1.3]) }],
  }));

  return (
    <View style={[styles.canvas, { height }]} pointerEvents="none">
      <View style={styles.row}>
        {/* Left avatar */}
        <View style={styles.avatarColumn}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: c.tintMuted, borderColor: c.tint + '55' },
            ]}
          >
            <Ionicons name="person" size={20} color={c.tint} />
          </View>
        </View>

        {/* Bubbles + heart in centre */}
        <View style={styles.bubbleColumn}>
          <Bubble progress={left} side="left" color={c.tint} />
          <Bubble progress={right} side="right" color={c.tint} />

          <Animated.View
            style={[
              styles.heart,
              { backgroundColor: c.tint + '22', borderColor: c.tint },
              heartStyle,
            ]}
          >
            <Ionicons name="heart" size={14} color={c.tint} />
          </Animated.View>
        </View>

        {/* Right avatar */}
        <View style={styles.avatarColumn}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: c.tintMuted, borderColor: c.tint + '55' },
            ]}
          >
            <Ionicons name="happy" size={20} color={c.tint} />
          </View>
        </View>
      </View>
    </View>
  );
}

function Bubble({
  progress,
  side,
  color,
}: {
  progress: SharedValue<number>;
  side: 'left' | 'right';
  color: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const style = useAnimatedStyle(() => {
    // Bubble appears at low part of canvas, drifts up & fades.
    const op = interpolate(
      progress.value,
      [0, 0.15, 0.5, 0.7, 1],
      [0, 1, 1, 0, 0],
    );
    const y = interpolate(progress.value, [0, 1], [22, -22]);
    const xOffset = side === 'left' ? -30 : 30;
    const scale = interpolate(progress.value, [0, 0.2, 1], [0.7, 1, 1]);
    return {
      opacity: op,
      transform: [
        { translateX: xOffset },
        { translateY: y },
        { scale },
      ],
    };
  });

  // Visual: a small pill bubble with a ditto dot. Anchored to one side
  // via flex so the tail "points" toward the relevant avatar.
  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          backgroundColor: side === 'left' ? c.surfaceAlt : color,
          borderColor: c.border,
          alignSelf: side === 'left' ? 'flex-start' : 'flex-end',
        },
        style,
      ]}
    >
      <ThemedText
        style={[
          styles.bubbleDots,
          { color: side === 'left' ? c.text : '#fff' },
        ]}
      >
        • • •
      </ThemedText>
    </Animated.View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  avatarColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bubbleColumn: {
    flex: 1,
    height: '70%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bubble: {
    position: 'absolute',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 50,
    alignItems: 'center',
  },
  bubbleDots: {
    fontSize: 12,
    letterSpacing: 1,
    fontWeight: '700',
  },
  heart: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
