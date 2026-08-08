/**
 * Reusable avatar component.
 *
 * Renders a circle with either the user's photo (when `uri` is set) or a
 * coloured initial fallback. Optionally wraps itself in a "status" ring
 * (WhatsApp/Insta style) when `hasStatus` is true — the ring uses the
 * theme's dark accent so it reads as "unseen status".
 *
 * Optional decorations:
 *   - `onlineDot`: small green dot in the bottom-right corner.
 *   - `onPress` / `onLongPress`: makes the avatar pressable.
 */

import { Image } from '@/lib/native/image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getInitials } from '@/lib/initials';

type Props = {
  /** Avatar image URI (file:// or http(s)). When undefined, fall back to initial. */
  uri?: string;
  /** Used for the initial fallback. */
  name: string;
  /** Diameter of the avatar (including the status ring). */
  size?: number;
  /** Thickness of the ring around the avatar. Defaults to 2.5. */
  ringWidth?: number;
  /** Show the WhatsApp-style "unseen status" ring around the avatar. */
  hasStatus?: boolean;
  /** Show a small green online dot. */
  online?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function Avatar({
  uri,
  name,
  size = 52,
  ringWidth = 2.5,
  hasStatus,
  online,
  onPress,
  onLongPress,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const innerSize = hasStatus ? size - (ringWidth + 2) * 2 : size;
  const initial = getInitials(name);
  const initialFontSize =
    initial.length > 1 ? innerSize * 0.32 : innerSize * 0.38;
  const initialLineHeight =
    initial.length > 1 ? innerSize * 0.36 : innerSize * 0.42;

  const inner = (
    <View
      style={[
        styles.inner,
        {
          width: innerSize,
          height: innerSize,
          borderRadius: innerSize / 2,
          backgroundColor: c.tintMuted,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
          }}
          contentFit="cover"
        />
      ) : (
        <ThemedText
          style={[
            styles.initial,
            {
              color: c.tintPressed,
              fontSize: initialFontSize,
              lineHeight: initialLineHeight,
              width: innerSize,
              textAlign: 'center',
            },
          ]}
          allowFontScaling={false}
        >
          {initial}
        </ThemedText>
      )}
    </View>
  );

  // Outer wrapper hosts the optional status ring AND the online dot. The
  // dot lives at this level (not inside `inner`) so it isn't clipped by
  // the avatar's circular `overflow: hidden`.
  const wrapper = (
    <View
      style={[
        styles.outer,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: hasStatus ? ringWidth : 0,
          // Use the dark "pressed" tint so the ring reads as a strong,
          // intentional accent against either light or dark mode.
          borderColor: hasStatus ? c.tintPressed : 'transparent',
        },
      ]}
    >
      {inner}
      {online ? (
        <View
          style={[
            styles.onlineDot,
            {
              width: Math.max(10, size * 0.22),
              height: Math.max(10, size * 0.22),
              borderRadius: Math.max(5, size * 0.11),
              backgroundColor: c.success,
              borderColor: c.background,
            },
          ]}
        />
      ) : null}
    </View>
  );

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        hitSlop={4}
        style={({ pressed }) => [pressed && { opacity: 0.75 }]}
      >
        {wrapper}
      </Pressable>
    );
  }

  return wrapper;
}

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initial: {
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    borderWidth: 2,
  },
});
