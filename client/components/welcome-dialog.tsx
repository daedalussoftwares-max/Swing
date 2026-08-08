/**
 * Welcome dialog shown the first time a fresh user lands on the home
 * tab post-signup. Purpose:
 *   1. Nudge them to complete the rest of their profile (interests,
 *      bio, status, etc.) — those weren't part of the onboarding flow
 *      because we wanted that flow to be tight.
 *   2. Trigger the permission prompts that gate the core experience:
 *      push notifications (so plane delivery feels real) and location
 *      (so radius-based matching can work).
 *
 * Behaviour:
 *   • Renders once per user — host stores a "seen" flag in AsyncStorage.
 *   • User has three explicit exits: complete profile, skip for now,
 *     or close (X).
 *   • Permission prompts are kicked off automatically after dismissal
 *     (we don't want to bombard with three native dialogs at once;
 *     they're sequenced).
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  visible: boolean;
  userName?: string;
  onComplete: () => void; // tapped "Complete profile"
  onLater: () => void; // tapped "Maybe later" or X
};

export function WelcomeDialog({
  visible,
  userName,
  onComplete,
  onLater,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

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

  const handleComplete = () => {
    onComplete();
    router.push('/profile/edit');
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onLater}
    >
      <Pressable style={styles.backdrop} onPress={onLater}>
        <Pressable onPress={() => {}}>
          <Animated.View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border },
              cardStyle,
            ]}
          >
            {/* X close button */}
            <Pressable
              onPress={onLater}
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

            <ThemedText style={styles.headline}>
              {userName ? `Welcome, ${userName} 👋` : 'Welcome to Swing 👋'}
            </ThemedText>
            <ThemedText style={[styles.sub, { color: c.textMuted }]}>
              Add a few details so people get the right vibe when your
              plane lands.
            </ThemedText>

            {/* Bullet list */}
            <View style={styles.bullets}>
              <Bullet
                icon="pricetags-outline"
                title="Interests"
                body="Pick what you love — better matches, better chats."
              />
              <Bullet
                icon="image-outline"
                title="Status"
                body="Share a moment with friends, 24-hour expiry."
              />
              <Bullet
                icon="text-outline"
                title="Bio"
                body="A line that tells strangers who you are."
              />
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={onLater}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  {
                    backgroundColor: c.surfaceAlt,
                    borderColor: c.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ThemedText
                  style={[styles.secondaryBtnText, { color: c.text }]}
                >
                  Maybe later
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleComplete}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: c.tint,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <ThemedText style={styles.primaryBtnText}>
                  Complete profile
                </ThemedText>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Bullet({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletIcon, { backgroundColor: c.surfaceAlt }]}>
        <Ionicons name={icon} size={16} color={c.tint} />
      </View>
      <View style={styles.bulletText}>
        <ThemedText style={styles.bulletTitle}>{title}</ThemedText>
        <ThemedText style={[styles.bulletBody, { color: c.textMuted }]}>
          {body}
        </ThemedText>
      </View>
    </View>
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
    maxWidth: 380,
    paddingHorizontal: Spacing.xl,
    // Top padding sized to give the close button breathing room now
    // that the plane crest is gone — headline sits a bit lower.
    paddingTop: Spacing.xl + Spacing.lg,
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
  headline: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  sub: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: Spacing.lg,
  },
  bullets: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: { flex: 1 },
  bulletTitle: { fontSize: 13, fontWeight: '700' },
  bulletBody: { fontSize: 12, lineHeight: 16 },

  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    flex: 1.4,
    height: 46,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
