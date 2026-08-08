/**
 * Celebration dialog shown the moment a plane is accepted.
 *
 * Shape: a centred modal card with the sender's mini-profile (avatar,
 * name, interests / hashtags) and a "you and {name} are now friends"
 * headline.
 *
 * Behaviour: the dialog is intentionally *passive* — it never auto-
 * navigates the user anywhere. We give them three explicit exits:
 *   - the X button (top-right)        → dismiss, stay where you are
 *   - "Not now" button (secondary)    → dismiss, stay where you are
 *   - "Start chatting" button (primary) → open the new chat thread
 *
 * The actual chat creation has already happened by the time this
 * mounts — this screen only sits between "tap Accept" and "land in
 * chat" so the user can decide if they want to dive in now or later.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Sender } from '@/types/plane';

type Props = {
  visible: boolean;
  sender: Sender | null;
  /** Fired when the user closes the dialog without starting a chat
   *  (X button or "Not now"). Host keeps user where they were. */
  onDismiss: () => void;
  /** Fired when the user explicitly opts in to chat now. Host
   *  navigates into the new chat thread. */
  onStartChat: () => void;
};

export function FriendsCelebration({
  visible,
  sender,
  onDismiss,
  onStartChat,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Card fade / scale — keeps the entrance feeling celebratory.
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.9);

  useEffect(() => {
    if (!visible) {
      opacity.value = 0;
      scale.value = 0.9;
      return;
    }
    opacity.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
    scale.value = withDelay(
      40,
      withTiming(1, {
        duration: 320,
        easing: Easing.out(Easing.back(1.2)),
      }),
    );
  }, [visible, opacity, scale]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!sender) return null;

  const interests = (sender.interests ?? []).slice(0, 6);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      {/* Tap-outside-to-close — feels natural for a dialog. */}
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        {/* Inner Pressable swallows taps so they don't dismiss the dialog. */}
        <Pressable onPress={() => {}}>
          <Animated.View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border },
              cardStyle,
            ]}
          >
            {/* X (close) — top-right corner */}
            <Pressable
              onPress={onDismiss}
              hitSlop={12}
              style={({ pressed }) => [
                styles.closeBtn,
                {
                  backgroundColor: c.surfaceAlt,
                  borderColor: c.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="close" size={18} color={c.text} />
            </Pressable>

            {/* Heart / sparkle topper */}
            <View
              style={[
                styles.sparkleRing,
                { backgroundColor: c.tintMuted, borderColor: c.tint + '55' },
              ]}
            >
              <Ionicons name="sparkles" size={20} color={c.tint} />
            </View>

            <View style={styles.avatarWrap}>
              <Avatar
                name={sender.name}
                uri={sender.avatarUrl}
                size={88}
                hasStatus
              />
            </View>

            <ThemedText style={styles.headline}>
              You and {sender.name} are now friends
            </ThemedText>
            <ThemedText style={[styles.sub, { color: c.textMuted }]}>
              {sender.city ? `${sender.city} · ` : ''}
              {sender.ageBadge}
              {sender.gender ? ` · ${sender.gender}` : ''}
            </ThemedText>

            {sender.bio ? (
              <ThemedText
                style={[styles.bio, { color: c.text }]}
                numberOfLines={2}
              >
                {sender.bio}
              </ThemedText>
            ) : null}

            {interests.length > 0 ? (
              <View style={styles.tagsRow}>
                {interests.map((tag) => (
                  <View
                    key={tag}
                    style={[
                      styles.tag,
                      { backgroundColor: c.surfaceAlt, borderColor: c.border },
                    ]}
                  >
                    <ThemedText
                      style={[styles.tagText, { color: c.textMuted }]}
                    >
                      #{tag}
                    </ThemedText>
                  </View>
                ))}
              </View>
            ) : null}

            <ThemedText style={[styles.prompt, { color: c.textMuted }]}>
              Want to start chatting now?
            </ThemedText>

            <View style={styles.actions}>
              <Pressable
                onPress={onDismiss}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  {
                    backgroundColor: c.surfaceAlt,
                    borderColor: c.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ThemedText style={[styles.secondaryBtnText, { color: c.text }]}>
                  Not now
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={onStartChat}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: c.tint,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Ionicons name="chatbubble-ellipses" size={16} color="#fff" />
                <ThemedText style={styles.primaryBtnText}>
                  Start chatting
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl + Spacing.md,
    paddingBottom: Spacing.lg,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  sparkleRing: {
    position: 'absolute',
    top: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: {
    marginBottom: Spacing.md,
  },
  headline: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  sub: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  bio: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: { fontSize: 11, fontWeight: '500' },

  prompt: {
    fontSize: 13,
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    width: '100%',
  },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  primaryBtn: {
    flex: 1.4,
    height: 44,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
