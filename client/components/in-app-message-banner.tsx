/**
 * Heads-up banner for messages that arrive while the app is open but the
 * conversation isn't on screen (the OS push is suppressed in foreground).
 * Tap opens the chat; it auto-hides after a few seconds.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type IncomingMessageEvent, useChats } from '@/lib/chats-context';
import * as Haptics from '@/lib/native/haptics';
import { useRouter } from '@/lib/router';

const VISIBLE_MS = 3500;

export function InAppMessageBanner() {
  const { subscribeIncoming } = useChats();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [current, setCurrent] = useState<(IncomingMessageEvent & { key: number }) | null>(
    null,
  );
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setCurrent(null);
  }, []);

  useEffect(
    () =>
      subscribeIncoming((e) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCurrent({ ...e, key: Date.now() });
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          setCurrent(null);
        }, VISIBLE_MS);
      }),
    [subscribeIncoming],
  );

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  if (!current) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 6 }]}>
      <Animated.View
        key={current.key}
        entering={SlideInUp.springify().damping(18)}
        exiting={SlideOutUp.duration(180)}
        style={[
          styles.card,
          { backgroundColor: c.surface, borderColor: c.border, shadowColor: '#000' },
        ]}
      >
        <Pressable
          style={styles.row}
          onPress={() => {
            hide();
            router.push(`/chat/${current.chatId}`);
          }}
          accessibilityRole="button"
          accessibilityLabel={`New message from ${current.partnerName}`}
        >
          <Avatar uri={current.partnerAvatarUrl} name={current.partnerName} size={40} />
          <View style={styles.text}>
            <ThemedText style={styles.name} numberOfLines={1}>
              {current.partnerName}
            </ThemedText>
            <ThemedText style={[styles.preview, { color: c.textMuted }]} numberOfLines={2}>
              {current.preview}
            </ThemedText>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 1000,
    elevation: 1000,
  },
  card: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  text: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  preview: { fontSize: 13, marginTop: 2 },
});
