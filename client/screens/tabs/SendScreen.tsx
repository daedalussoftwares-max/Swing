/**
 * Send screen — compose and launch a paper plane.
 *
 * Top-right: a `PlaneBalance` pill showing how many planes are left.
 *
 * If count > 0:
 *   - Render an aesthetic white "paper" card with a multiline text input
 *   - A Send button below the card
 *   - Tapping Send plays the fold-and-fly animation:
 *       1. The paper card scales down + rotates (suggests folding)
 *       2. A paper-plane icon fades in over the same position
 *       3. The plane flies up + right off-screen
 *       4. Balance decrements, input clears, ready for next plane
 *
 * If count = 0:
 *   - Render an empty state with a "Watch ad" CTA that grants 5 planes
 *     (real rewarded-ad SDK comes later)
 */

import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaneBalance } from '@/components/plane-balance';
import { PlaneTrail } from '@/components/plane-trail';
import { TabNavHeader } from '@/components/tab-nav-header';
import { TabSwipeRegion } from '@/components/tab-swipe-region';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabFocusFade } from '@/hooks/use-tab-focus-fade';
import { usePlaneBalance } from '@/lib/plane-balance-context';
import { PLANE_ICON_ROTATION_OFFSET, planePath } from '@/lib/plane-path';
import { useSentPlanes } from '@/lib/sent-planes-context';

const MAX_LENGTH = 200;

export default function SendScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { count, spendOne, add } = usePlaneBalance();
  const { recordSent } = useSentPlanes();
  const fadeStyle = useTabFocusFade();

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  // The compose modal opens when the user taps the placeholder card.
  // It hosts the actual TextInput + X / Send buttons. Animation still
  // plays on the main tab after we dismiss the modal.
  const [composerOpen, setComposerOpen] = useState(false);
  const composerInputRef = useRef<TextInput | null>(null);
  // Captured at send time so the animation completion handler still has
  // it after the input was cleared.
  const pendingMessageRef = useRef('');

  // Animation shared values
  const cardScale = useSharedValue(1);
  const cardOpacity = useSharedValue(1);
  const cardRotate = useSharedValue(0);

  const planeScale = useSharedValue(0);
  const planeOpacity = useSharedValue(0);
  // 0 → 1 along the curvy path. Drives BOTH the live plane position and
  // the trail-dot reveal — they trace the exact same curve.
  const flyProgress = useSharedValue(0);
  // Fades the entire trail out at the end of the flight.
  const trailOpacity = useSharedValue(1);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [
      { scale: cardScale.value },
      { rotate: `${cardRotate.value}deg` },
    ],
  }));

  const planeStyle = useAnimatedStyle(() => {
    // Position and rotation both come from the parametric path, so the
    // plane visually flies along the same curve the trail is tracing.
    // Rotation is computed inline from the path tangent (no helper
    // worklet calls, which Reanimated 4 doesn't always bundle reliably).
    const t = flyProgress.value;
    const pos = planePath(t);

    const dt = 0.005;
    const tA = t - dt < 0 ? 0 : t - dt;
    const tB = t + dt > 1 ? 1 : t + dt;
    const a = planePath(tA);
    const b = planePath(tB);
    const tangentDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const rot = tangentDeg + PLANE_ICON_ROTATION_OFFSET;

    return {
      opacity: planeOpacity.value,
      transform: [
        { translateX: pos.x },
        { translateY: pos.y },
        { scale: planeScale.value },
        { rotate: `${rot}deg` },
      ],
    };
  });

  const trailLayerStyle = useAnimatedStyle(() => ({
    opacity: trailOpacity.value,
  }));

  const finishFlight = () => {
    // Spend the plane only AFTER the flight, so the animation can't be
    // interrupted by the count hitting 0 and unmounting the animated tree.
    spendOne();
    // Record the outgoing plane so it shows up in /planes and the
    // profile-tab "Planes" segment.
    if (pendingMessageRef.current) {
      recordSent(pendingMessageRef.current);
      pendingMessageRef.current = '';
    }
    cardScale.value = 1;
    cardOpacity.value = 1;
    cardRotate.value = 0;
    planeScale.value = 0;
    planeOpacity.value = 0;
    flyProgress.value = 0;
    trailOpacity.value = 1;
    setMessage('');
    setIsSending(false);
  };

  const handleSend = () => {
    if (!message.trim() || isSending) return;
    if (count <= 0) return;

    setIsSending(true);
    pendingMessageRef.current = message.trim();
    Keyboard.dismiss();
    // Close the composer BEFORE the animation kicks in so the user sees
    // the fold-and-fly happening on the main tab card.
    setComposerOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // PHASE 1 (0–500ms): the paper folds — scales down, rotates, fades out.
    cardScale.value = withTiming(0.4, { duration: 500 });
    cardRotate.value = withTiming(-15, { duration: 500 });
    cardOpacity.value = withTiming(0, { duration: 500 });

    // PHASE 2 + 3 (300–2150ms): the plane fades in, follows the curvy
    // path, then fades out at its destination.
    // We must CHAIN with `withSequence` here — reassigning the same shared
    // value cancels the previous animation, which is what was breaking the
    // "fly" half before.
    planeOpacity.value = withDelay(
      300,
      withSequence(
        withTiming(1, { duration: 250 }),
        withDelay(
          1300,
          withTiming(0, { duration: 300 }, (finished) => {
            if (finished) {
              runOnJS(finishFlight)();
            }
          }),
        ),
      ),
    );

    planeScale.value = withDelay(
      300,
      withSequence(
        withTiming(1, { duration: 250 }),
        withTiming(0.35, { duration: 1500 }),
      ),
    );

    // The path itself — plane position, rotation, AND trail reveal all
    // derive from this single shared value, so they stay in lockstep.
    flyProgress.value = withDelay(550, withTiming(1, { duration: 1500 }));

    // The whole trail fades out together with the plane at the end.
    trailOpacity.value = withDelay(1900, withTiming(0, { duration: 300 }));
  };

  const handleWatchAd = () => {
    // TODO: replace with real rewarded-ad SDK (AdMob) once monetization is wired up
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    add(5);
  };

  const openComposer = () => {
    if (isSending || count <= 0) return;
    Haptics.selectionAsync();
    setComposerOpen(true);
  };

  // Auto-focus the textarea the moment the composer modal mounts.
  useEffect(() => {
    if (!composerOpen) return;
    const t = setTimeout(() => composerInputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [composerOpen]);

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.background }]}>
      {/* Header is its own swipe surface — swiping over the title / balance
          pill switches tabs; swipe over the paper card / input is ignored
          (only horizontal pans >20px past 15px-of-vertical-tolerance fire
          a tab change, so taps and typing on the input still work fine). */}
      <TabSwipeRegion currentRoute="/send" style={styles.headerSwipe}>
        <Animated.View style={fadeStyle}>
          <TabNavHeader route="/send">
            <ThemedText style={styles.title}>Send a plane</ThemedText>
            <PlaneBalance />
          </TabNavHeader>
        </Animated.View>
      </TabSwipeRegion>

      {count <= 0 ? (
        <OutOfPlanes onWatchAd={handleWatchAd} />
      ) : (
        // Wrap body in a TabSwipeRegion so any horizontal pan over the
        // card area switches tabs. Vertical drags and taps still pass
        // through to the Pressable card.
        <TabSwipeRegion currentRoute="/send" style={styles.flex}>
          <Animated.View style={[styles.body, fadeStyle]}>
            {/* Paper card + plane overlay share the same area so the
                fold-then-fly animation reads as a single transformation. */}
            <View style={styles.cardArea}>
              <Animated.View
                style={[
                  styles.paper,
                  {
                    backgroundColor: c.surface,
                    borderColor: c.border,
                  },
                  cardStyle,
                ]}
              >
                {/* The card is now a tap-target — tapping anywhere on it
                    opens the full-screen composer. No inline Send button
                    anymore. */}
                <Pressable
                  onPress={openComposer}
                  disabled={isSending}
                  style={styles.cardPress}
                >
                  {message.trim().length === 0 ? (
                    <View style={styles.cardEmpty}>
                      <Ionicons
                        name="create-outline"
                        size={28}
                        color={c.textSubtle}
                      />
                      <ThemedText
                        style={[styles.cardEmptyTitle, { color: c.text }]}
                      >
                        Tap to write
                      </ThemedText>
                      <ThemedText
                        style={[styles.cardEmptyHint, { color: c.textMuted }]}
                      >
                        Something kind, weird, or true.
                      </ThemedText>
                    </View>
                  ) : (
                    <>
                      <ThemedText
                        style={[styles.cardPreview, { color: c.text }]}
                        numberOfLines={8}
                      >
                        {message}
                      </ThemedText>
                      <ThemedText
                        style={[styles.counter, { color: c.textMuted }]}
                      >
                        {message.length} / {MAX_LENGTH}
                      </ThemedText>
                    </>
                  )}
                </Pressable>
              </Animated.View>

              {/* Dotted curvy trail draws itself behind the flying plane. */}
              <Animated.View style={[styles.trailLayer, trailLayerStyle]}>
                <PlaneTrail progress={flyProgress} color={c.tint} />
              </Animated.View>

              <Animated.View style={[styles.planeOverlay, planeStyle]}>
                <Ionicons name="paper-plane" size={80} color={c.tint} />
              </Animated.View>
            </View>
          </Animated.View>
        </TabSwipeRegion>
      )}

      {/* Full-screen composer modal — only mounted when open so its
          inputs/keyboard listeners don't interfere with the main tab. */}
      <ComposerModal
        visible={composerOpen}
        message={message}
        onChange={setMessage}
        onClose={() => {
          Keyboard.dismiss();
          setComposerOpen(false);
        }}
        onSend={handleSend}
        inputRef={composerInputRef}
        canSend={message.trim().length > 0 && !isSending}
      />
    </SafeAreaView>
  );
}

// ── Composer modal ──────────────────────────────────────────────────────────

function ComposerModal({
  visible,
  message,
  onChange,
  onClose,
  onSend,
  inputRef,
  canSend,
}: {
  visible: boolean;
  message: string;
  onChange: (next: string) => void;
  onClose: () => void;
  onSend: () => void;
  inputRef: React.MutableRefObject<TextInput | null>;
  canSend: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Track the keyboard height manually instead of relying on
  // `KeyboardAvoidingView` (which fights with iOS' modal presentation
  // and used to leave the X / Send buttons hidden behind the keyboard).
  // We pad the bottom of the modal by exactly the keyboard height so
  // the action bar always rides just above the on-screen keyboard.
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!visible) {
      setKbHeight(0);
      return;
    }
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      // Full-screen on both platforms — formSheet on iOS has its own
      // keyboard handling that fought with ours.
      presentationStyle="fullScreen"
      transparent={false}
    >
      <SafeAreaView
        edges={['top']}
        style={[styles.composerRoot, { backgroundColor: c.background }]}
      >
        <View style={[styles.flex, { paddingBottom: kbHeight }]}>
          <View
            style={[
              styles.composerPaper,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <TextInput
              ref={inputRef}
              value={message}
              onChangeText={onChange}
              placeholder="Write something kind, weird, or true..."
              placeholderTextColor={c.textSubtle}
              multiline
              maxLength={MAX_LENGTH}
              textAlignVertical="top"
              style={[styles.composerInput, { color: c.text }]}
            />
            {/* Char counter — tucked into the absolute bottom-right
                corner of the paper so the input itself gets full width. */}
            <ThemedText
              style={[styles.counterCorner, { color: c.textMuted }]}
            >
              {message.length}/{MAX_LENGTH}
            </ThemedText>
          </View>

          {/* Bottom bar — X (cancel) on the left, send arrow on the
              right. No labels, just iconography. */}
          <View style={styles.composerBar}>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [
                styles.composerIconBtn,
                { backgroundColor: c.surfaceAlt, borderColor: c.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="close" size={22} color={c.text} />
            </Pressable>

            <Pressable
              onPress={onSend}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.composerSendBtn,
                {
                  backgroundColor: canSend ? c.tint : c.borderStrong,
                  opacity: pressed && canSend ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name="paper-plane" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function OutOfPlanes({ onWatchAd }: { onWatchAd: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <TabSwipeRegion currentRoute="/send" style={styles.flex}>
      <View style={styles.emptyBody}>
        <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
          <Ionicons name="paper-plane-outline" size={48} color={c.textSubtle} />
        </View>
        <ThemedText style={styles.emptyTitle}>You&apos;re out of planes</ThemedText>
        <ThemedText style={[styles.emptySubtitle, { color: c.textMuted }]}>
          Watch a short ad and we&apos;ll give you 5 fresh planes to launch.
        </ThemedText>
        <Pressable
          onPress={onWatchAd}
          style={({ pressed }) => [
            styles.watchAdButton,
            { backgroundColor: c.tint, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="play" size={16} color="#fff" />
          <ThemedText style={styles.watchAdLabel}>Watch ad — get 5 planes</ThemedText>
        </Pressable>
      </View>
    </TabSwipeRegion>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  headerSwipe: {
    // Header is fixed height; no `flex: 1` here.
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    justifyContent: 'space-between',
  },
  cardArea: {
    flex: 1,
    position: 'relative',
    alignItems: 'stretch',
    justifyContent: 'center',
  },
  paper: {
    minHeight: 280,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xl,
    // Subtle "loose sheet of paper" lift
    transform: [{ rotate: '-1.2deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardPress: {
    flex: 1,
    minHeight: 200,
    justifyContent: 'center',
  },
  cardEmpty: {
    alignItems: 'center',
    gap: 6,
  },
  cardEmptyTitle: { fontSize: 18, fontWeight: '700' },
  cardEmptyHint: { fontSize: 13 },
  cardPreview: {
    fontSize: 18,
    lineHeight: 26,
    minHeight: 100,
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: Spacing.sm,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  planeOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  trailLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    pointerEvents: 'none',
  },
  // Composer modal
  composerRoot: { flex: 1 },
  composerPaper: {
    flex: 1,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    // Tight padding so the typing area gets maximum room — counter
    // sits in the corner absolutely, not inline.
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: 22, // leave just enough room for the corner counter
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  composerInput: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    padding: 0,
    margin: 0,
  },
  counterCorner: {
    position: 'absolute',
    right: Spacing.sm + 2,
    bottom: 4,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  composerIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  composerSendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  // Empty state
  emptyBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  watchAdButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radii.pill,
    marginTop: Spacing.lg,
  },
  watchAdLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
