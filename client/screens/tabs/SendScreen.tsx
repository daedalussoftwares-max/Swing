/**
 * Send screen — "sticky note, swipe up":
 *
 *   ┌───────────────────────────────┐
 *   │ [⚙]                     ✈ 4   │  filters button + balance
 *   │      To  Anyone · anywhere ⌄  │
 *   │    ┌─────────────────────┐    │
 *   │    │ Tell me one thing…  │    │  off-white paper note, slightly
 *   │    │              42/200 │    │  tilted, editable
 *   │    └─────────────────────┘    │
 *   │              ⌃                │
 *   │       Swipe up to send        │
 *   └───────────────────────────────┘
 *
 * Swipe the note up (it follows the finger) → its corners fold in and it
 * becomes a paper plane that hovers for a moment with a Cancel button →
 * then it takes off like a rocket and POST /v1/planes fires. Cancel
 * unfolds it back into the note. The text is kept after sending so it can
 * be re-used; "Clear" empties it. A "Plane sent!" modal (✕ to close) shows
 * the plane's live status.
 */

import * as Haptics from '@/lib/native/haptics';
import { Ionicons } from '@/lib/native/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useRouter } from '@/lib/router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { PlaneBalance } from '@/components/plane-balance';
import { FilterChipRow } from '@/components/plane-filter-chips';
import { CountrySheet } from '@/components/plane-filter-country-sheet';
import {
  AGE_OPTIONS,
  type AgeOption,
  DEFAULT_FILTERS,
  DISTANCE_OPTIONS,
  type DistanceOption,
  GENDER_OPTIONS,
  type GenderOption,
  isDefaultFilters,
  loadSavedFilters,
  type PlaneFilterState,
  saveFilters,
  summarizeFilters,
  toApiFilters,
} from '@/components/plane-filter-model';
import { FlyingDots } from '@/components/plane-status';
import { TabNavHeader } from '@/components/tab-nav-header';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { syncLocationIfNeeded } from '@/lib/location';
import { usePlaneBalance } from '@/lib/plane-balance-context';
import type { LiveSentPlane } from '@/lib/planes-mapper';
import { type LaunchResult, useSentPlanes } from '@/lib/sent-planes-context';
import { countryFlag, withFlag } from '@/lib/countries';

const MAX_LENGTH = 200;
/** Drag the note up this far (or flick) to send. */
const SWIPE_SEND_PX = 120;
const SWIPE_SEND_VELOCITY = 1.1;
/** How high the folded plane hovers while Cancel is offered. */
const HOVER_LIFT = 40;
const FOLD_MS = 520;
/** Time to change your mind before it takes off on its own. */
const UNDO_MS = 2500;
const LAUNCH_MS = 750;

type Phase = 'idle' | 'folded' | 'flying';

/** The plane the "sent" modal follows (key = temp id, id = real id). */
type SentInfo = {
  key: string;
  id: string;
};

/** Off-white "paper" that reads as a sheet on top of the page background. */
const PAPER = {
  light: { bg: '#FBF8F1', border: '#ECE6D8', fold: '#EFE8D7', shadow: '#7A6A45' },
  dark: { bg: '#1C1B19', border: '#2E2C28', fold: '#2A2824', shadow: '#000000' },
} as const;

type Palette = (typeof Colors)['light'];

type ToastState = {
  id: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  tone: 'danger' | 'warning';
};

function toastForFailure(
  res: Extract<LaunchResult, { ok: false }>,
  id: number,
): ToastState {
  switch (res.code) {
    case 'NO_PLANES':
      return {
        id,
        icon: 'paper-plane-outline',
        title: "You're out of planes",
        body: 'Your letter is still here. Grab more planes and send it again.',
        tone: 'warning',
      };
    case 'NETWORK':
      return {
        id,
        icon: 'cloud-offline-outline',
        title: "Couldn't reach Swing",
        body: 'Your letter is still here — check your connection and tap Send to retry.',
        tone: 'danger',
      };
    case 'INVALID_INPUT':
    case 'INVALID_BODY':
      return {
        id,
        icon: 'alert-circle-outline',
        title: "That plane couldn't take off",
        body: 'Check your note and filters, then try again.',
        tone: 'danger',
      };
    default:
      return {
        id,
        icon: 'alert-circle-outline',
        title: "Couldn't send your plane",
        body: 'Your letter is still here — tap Send to try again.',
        tone: 'danger',
      };
  }
}

export default function SendScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const paper = PAPER[scheme];
  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const { count, refresh: refreshBalance } = usePlaneBalance();
  const { launch, sentPlanes, refresh: refreshSent } = useSentPlanes();

  useRefreshOnFocus(() => {
    void refreshBalance();
    void refreshSent();
  });

  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState<PlaneFilterState>(DEFAULT_FILTERS);
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  /** idle → (swipe) folded: plane hovers, Cancel available → flying → idle */
  const [phase, setPhase] = useState<Phase>('idle');
  /** Plane shown in the "sent" confirmation (key = temp id, id = real id). */
  const [sent, setSent] = useState<SentInfo | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastSeq = useRef(0);

  useEffect(
    () => () => {
      for (const t of timers.current) clearTimeout(t);
    },
    [],
  );
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  // ── Filters: restore last-used, persist on change ──────────────────────
  useEffect(() => {
    let cancelled = false;
    void loadSavedFilters().then((saved) => {
      if (cancelled) return;
      if (saved) setFilters(saved);
      setFiltersLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (filtersLoaded) void saveFilters(filters);
  }, [filters, filtersLoaded]);

  const setGender = useCallback(
    (gender: GenderOption) => setFilters((f) => ({ ...f, gender })),
    [],
  );
  const setAge = useCallback(
    (age: AgeOption) => setFilters((f) => ({ ...f, age })),
    [],
  );
  const setDistance = useCallback((distance: DistanceOption) => {
    setFilters((f) => ({ ...f, distance }));
    // Warm up location (and its permission prompt) now rather than at send.
    if (distance !== 'anywhere') void syncLocationIfNeeded({ prompt: true });
  }, []);
  const setCountry = useCallback((country: string | null) => {
    setFilters((f) => ({ ...f, country }));
    setCountryOpen(false);
  }, []);
  const resetFilters = useCallback(() => {
    void Haptics.selectionAsync();
    setFilters(DEFAULT_FILTERS);
  }, []);
  const openCountry = useCallback(() => {
    void Haptics.selectionAsync();
    Keyboard.dismiss();
    setCountryOpen(true);
  }, []);
  const closeCountry = useCallback(() => setCountryOpen(false), []);
  const openFilters = useCallback(() => {
    void Haptics.selectionAsync();
    Keyboard.dismiss();
    setFiltersOpen(true);
  }, []);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);

  // ── Toast ──────────────────────────────────────────────────────────────
  const showToast = useCallback((t: Omit<ToastState, 'id'>) => {
    toastSeq.current += 1;
    setToast({ ...t, id: toastSeq.current });
  }, []);
  const hideToast = useCallback((id: number) => {
    setToast((t) => (t && t.id === id ? null : t));
  }, []);

  // ── Paper → plane → rocket animation (UI thread) ───────────────────────
  // dragY: note follows the finger; fold: corners fold in + paper narrows;
  // planeIn: the folded plane appears; lift: rocket launch; appear: the
  // fresh note fading back in.
  const dragY = useSharedValue(0);
  const fold = useSharedValue(0);
  const planeIn = useSharedValue(0);
  const lift = useSharedValue(0);
  const appear = useSharedValue(1);
  const shakeX = useSharedValue(0);

  const shake = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    shakeX.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 60 }),
      withTiming(-5, { duration: 60 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeX]);

  const springBack = useCallback(() => {
    dragY.value = withSpring(0, { damping: 14, stiffness: 180 });
  }, [dragY]);

  const resetNote = useCallback(() => {
    lift.value = 0;
    fold.value = 0;
    planeIn.value = 0;
    dragY.value = 0;
    appear.value = 0;
    appear.value = withTiming(1, { duration: 350 });
    setPhase('idle');
  }, [lift, fold, planeIn, dragY, appear]);

  /** Fires the request and the rocket at the same moment. */
  const takeOff = useCallback(() => {
    const text = message.trim();
    const l = launch(text, toApiFilters(filters));
    if (!l) {
      resetNote();
      return;
    }
    setPhase('flying');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    lift.value = withTiming(
      1,
      { duration: LAUNCH_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(resetNote)();
      },
    );
    const flight: SentInfo = { key: l.tempId, id: l.tempId };
    later(() => setSent(flight), LAUNCH_MS + 150);

    void l.result.then((res) => {
      if (res.ok) {
        setSent((cur) => (cur && cur.key === l.tempId ? { ...cur, id: res.plane.id } : cur));
        return;
      }
      setSent((cur) => (cur && cur.key === l.tempId ? null : cur));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toastSeq.current += 1;
      setToast(toastForFailure(res, toastSeq.current));
      if (res.code === 'NO_PLANES') void refreshBalance();
    });
  }, [message, launch, filters, lift, resetNote, later, refreshBalance]);

  /** Swipe released past the threshold: fold the paper into a plane. */
  const onSwipeSend = useCallback(() => {
    if (!message.trim()) {
      springBack();
      shake();
      return;
    }
    if (count <= 0) {
      springBack();
      showToast({
        icon: 'paper-plane-outline',
        title: "You're out of planes",
        body: 'Grab more planes to keep launching.',
        tone: 'warning',
      });
      return;
    }
    Keyboard.dismiss();
    setPhase('folded');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    dragY.value = withSpring(-HOVER_LIFT, { damping: 16, stiffness: 160 });
    fold.value = withTiming(1, { duration: FOLD_MS, easing: Easing.inOut(Easing.cubic) });
    planeIn.value = withDelay(
      FOLD_MS - 180,
      withSpring(1, { damping: 11, stiffness: 160 }),
    );
    later(() => void Haptics.selectionAsync(), FOLD_MS - 120);
    // Short window to change your mind, then it takes off on its own.
    later(takeOff, FOLD_MS + UNDO_MS);
  }, [message, count, springBack, shake, showToast, dragY, fold, planeIn, later, takeOff]);

  /** Cancel during the hover: unfold back into the note, nothing is sent. */
  const cancelLaunch = useCallback(() => {
    clearTimers();
    void Haptics.selectionAsync();
    planeIn.value = withTiming(0, { duration: 180 });
    fold.value = withDelay(80, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));
    dragY.value = withSpring(0, { damping: 15, stiffness: 170 });
    setPhase('idle');
  }, [clearTimers, planeIn, fold, dragY]);

  // Swipe-up gesture on the note (PanResponder: vertical, upward only).
  const handlersRef = useRef({ onSwipeSend, springBack });
  useEffect(() => {
    handlersRef.current = { onSwipeSend, springBack };
  }, [onSwipeSend, springBack]);
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Capture phase: claim a clearly-upward drag before the TextInput inside
  // the note can keep it; taps still reach the TextInput for typing.
  const isSwipeUp = (g: { dx: number; dy: number }) =>
    phaseRef.current === 'idle' && g.dy < -10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5;
  const [notePan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => isSwipeUp(g),
      onMoveShouldSetPanResponder: (_e, g) => isSwipeUp(g),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        // Rubber-band: follows the finger, resists the further it goes.
        const up = Math.min(0, g.dy);
        dragY.value = up > -SWIPE_SEND_PX ? up : -SWIPE_SEND_PX + (up + SWIPE_SEND_PX) * 0.35;
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -SWIPE_SEND_PX || g.vy < -SWIPE_SEND_VELOCITY) {
          handlersRef.current.onSwipeSend();
        } else {
          handlersRef.current.springBack();
        }
      },
      onPanResponderTerminate: () => handlersRef.current.springBack(),
    }),
  );

  // Keyboard: Android edge-to-edge doesn't resize the window, so lift the
  // content by however much of the keyboard overlaps this screen.
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const bodyRef = useRef<View>(null);
  const bodyBottomGap = useSharedValue(0);
  const measureBody = useCallback(() => {
    bodyRef.current?.measureInWindow((_x, y, _w, h) => {
      bodyBottomGap.value = Math.max(0, windowHeight - (y + h));
    });
  }, [bodyBottomGap, windowHeight]);
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - bodyBottomGap.value),
  }));

  // While a finger is on the note, tab swiping is paused so an upward
  // swipe can't be mistaken for a tab change.
  const navigation = useNavigation();
  const lockTabSwipe = useCallback(
    (locked: boolean) => navigation.setOptions({ swipeEnabled: !locked }),
    [navigation],
  );

  const launchDistance = windowHeight;
  const noteStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateX: shakeX.value },
      { translateY: dragY.value - lift.value * launchDistance },
      { scale: (1 - fold.value * 0.15) * (0.96 + appear.value * 0.04) },
    ],
  }));
  const paperStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fold.value, [0, 0.75, 0.95], [1, 1, 0], Extrapolation.CLAMP),
    transform: [
      { scaleX: 1 - fold.value * 0.55 },
      { scaleY: 1 - fold.value * 0.3 },
    ],
  }));
  const cornerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(fold.value, [0, 0.15], [0, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(fold.value, [0, 0.7], [0, 1], Extrapolation.CLAMP) }],
  }));
  const planeStyle = useAnimatedStyle(() => ({
    opacity: planeIn.value,
    transform: [
      { scale: 0.4 + planeIn.value * 0.6 - lift.value * 0.35 },
      { rotate: `${-45 + lift.value * 6}deg` },
    ],
  }));
  const trailStyle = useAnimatedStyle(() => ({
    opacity: interpolate(lift.value, [0, 0.1, 0.8, 1], [0, 0.9, 0.6, 0]),
    height: 20 + lift.value * 220,
  }));

  const handleGetPlanes = useCallback(() => {
    Alert.alert(
      'Coming soon',
      'Rewarded ads to earn more planes will be available in a future update.',
    );
  }, []);

  const sentPlane = sent ? sentPlanes.find((p) => p.id === sent.id) : undefined;
  const openAllPlanes = useCallback(() => {
    setSent(null);
    router.push('/planes');
  }, [router]);
  const closeSent = useCallback(() => setSent(null), []);
  const clearNote = useCallback(() => {
    void Haptics.selectionAsync();
    setMessage('');
  }, []);
  const filtersActive = !isDefaultFilters(filters);
  const outOfPlanes = count <= 0;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.background }]}>
      <TabNavHeader route="/send">
        <IconButton
          icon="options-outline"
          label="Who can catch it"
          active={filtersActive}
          onPress={openFilters}
          c={c}
        />
        <PlaneBalance />
      </TabNavHeader>

      <Animated.View
        ref={bodyRef}
        onLayout={measureBody}
        style={[styles.body, keyboardStyle]}
      >
      <Pressable style={styles.flex} onPress={Keyboard.dismiss} accessible={false}>
        <Pressable
          onPress={openFilters}
          hitSlop={8}
          style={({ pressed }) => [styles.toChip, { opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Change who can catch this plane"
        >
          <ThemedText style={[styles.toLabel, { color: c.textMuted }]}>To</ThemedText>
          <ThemedText style={[styles.toValue, { color: c.text }]} numberOfLines={1}>
            {summarizeFilters(filters)}
          </ThemedText>
          <Ionicons name="chevron-down" size={14} color={c.textSubtle} />
        </Pressable>

        <View style={styles.stage}>
          {/* Rocket trail under the plane while it climbs. */}
          <Animated.View style={[styles.trail, { backgroundColor: c.tint }, trailStyle]} />
          <Animated.View
            style={[styles.noteWrap, noteStyle]}
            onTouchStart={() => lockTabSwipe(true)}
            onTouchEnd={() => lockTabSwipe(false)}
            onTouchCancel={() => lockTabSwipe(false)}
            {...notePan.panHandlers}
          >
            <Animated.View
              style={[
                styles.note,
                { backgroundColor: paper.bg, borderColor: paper.border, shadowColor: paper.shadow },
                paperStyle,
              ]}
            >
              <TextInput
                value={message}
                onChangeText={setMessage}
                editable={phase === 'idle'}
                placeholder="Tell a stranger something kind, weird, or true…"
                placeholderTextColor={c.textSubtle}
                multiline
                scrollEnabled={false}
                maxLength={MAX_LENGTH}
                textAlignVertical="top"
                style={[styles.noteInput, { color: c.text }]}
                accessibilityLabel="Your note"
              />
              <View style={styles.noteFooter}>
                {message.length > 0 && phase === 'idle' ? (
                  <Pressable onPress={clearNote} hitSlop={10} accessibilityRole="button">
                    <ThemedText style={[styles.clear, { color: c.textMuted }]}>Clear</ThemedText>
                  </Pressable>
                ) : (
                  <View />
                )}
                <ThemedText style={[styles.counter, { color: c.textSubtle }]}>
                  {message.length}/{MAX_LENGTH}
                </ThemedText>
              </View>
              {/* Folding corners (the first two folds of a paper plane). */}
              <Animated.View
                pointerEvents="none"
                style={[styles.cornerLeft, { borderTopColor: paper.fold }, cornerStyle]}
              />
              <Animated.View
                pointerEvents="none"
                style={[styles.cornerRight, { borderTopColor: paper.fold }, cornerStyle]}
              />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.foldedPlane, planeStyle]}>
              <Ionicons name="paper-plane" size={96} color={c.tint} />
            </Animated.View>
          </Animated.View>
        </View>

        {/* Always-visible action area right under the note. */}
        <View style={styles.actionArea}>
          {phase === 'folded' ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.cancelWrap}>
              <Pressable
                onPress={cancelLaunch}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.cancelCircle,
                  { backgroundColor: c.surfaceAlt, borderColor: c.borderStrong, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Cancel sending"
              >
                <Ionicons name="close" size={26} color={c.text} />
              </Pressable>
              <ThemedText style={[styles.cancelLabel, { color: c.text }]}>Cancel</ThemedText>
              <ThemedText style={[styles.launching, { color: c.textMuted }]}>
                Taking off in a moment…
              </ThemedText>
            </Animated.View>
          ) : phase === 'idle' ? (
            outOfPlanes ? (
              <OutOfPlanesCard onGetPlanes={handleGetPlanes} c={c} />
            ) : (
              <SwipeHint color={c.tint} text={c.text} onPress={onSwipeSend} />
            )
          ) : null}
        </View>
      </Pressable>
      </Animated.View>

      {toast ? <SendToast key={toast.id} toast={toast} onHide={hideToast} c={c} /> : null}

      <SentModal
        visible={sent !== null}
        plane={sentPlane}
        onClose={closeSent}
        onSeeAll={openAllPlanes}
        c={c}
      />

      <FiltersSheet visible={filtersOpen} onClose={closeFilters} c={c}>
        <FiltersCard
          filters={filters}
          onGender={setGender}
          onAge={setAge}
          onDistance={setDistance}
          onOpenCountry={openCountry}
          onReset={resetFilters}
          c={c}
        />
      </FiltersSheet>

      <CountrySheet
        visible={countryOpen}
        value={filters.country}
        onSelect={setCountry}
        onClose={closeCountry}
      />
    </SafeAreaView>
  );
}

// ── Swipe hint ──────────────────────────────────────────────────────────────

function SwipeHint({
  color,
  text,
  onPress,
}: {
  color: string;
  text: string;
  onPress: () => void;
}) {
  const bounce = useSharedValue(0);
  useEffect(() => {
    bounce.value = withRepeat(
      withSequence(
        withTiming(-10, { duration: 600, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 600, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [bounce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bounce.value }] }));
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={styles.hint}
      accessibilityRole="button"
      accessibilityLabel="Send the note (or swipe it up)"
    >
      <Animated.View style={[styles.hintArrows, style]}>
        <Ionicons name="chevron-up" size={26} color={color} />
        <Ionicons name="chevron-up" size={26} color={color} style={styles.hintArrow2} />
      </Animated.View>
      <ThemedText style={[styles.hintText, { color: text }]}>Swipe up to send</ThemedText>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  active,
  onPress,
  c,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  onPress: () => void;
  c: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconBtn,
        { backgroundColor: active ? c.tintMuted : c.surfaceAlt, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? c.tint : c.text} />
      {active ? (
        <View style={[styles.filterDot, { backgroundColor: c.tint, borderColor: c.background }]} />
      ) : null}
    </Pressable>
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────

const FiltersCard = memo(function FiltersCard({
  filters,
  onGender,
  onAge,
  onDistance,
  onOpenCountry,
  onReset,
  c,
}: {
  filters: PlaneFilterState;
  onGender: (v: GenderOption) => void;
  onAge: (v: AgeOption) => void;
  onDistance: (v: DistanceOption) => void;
  onOpenCountry: () => void;
  onReset: () => void;
  c: Palette;
}) {
  const isDefault = isDefaultFilters(filters);
  return (
    <View style={[styles.filtersCard, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.filtersHeader}>
        <View style={styles.flex}>
          <ThemedText style={styles.filtersTitle}>Who catches it?</ThemedText>
          <ThemedText style={[styles.filtersSummary, { color: c.textMuted }]} numberOfLines={1}>
            {summarizeFilters(filters)}
          </ThemedText>
        </View>
        {!isDefault ? (
          <Pressable onPress={onReset} hitSlop={10}>
            <ThemedText style={[styles.reset, { color: c.tint }]}>Reset</ThemedText>
          </Pressable>
        ) : null}
      </View>

      <FilterChipRow
        label="Gender"
        icon="person-outline"
        options={GENDER_OPTIONS}
        value={filters.gender}
        onChange={onGender}
      />
      <FilterChipRow
        label="Age"
        icon="people-outline"
        options={AGE_OPTIONS}
        value={filters.age}
        onChange={onAge}
      />
      <FilterChipRow
        label="Distance"
        icon="navigate-outline"
        options={DISTANCE_OPTIONS}
        value={filters.distance}
        onChange={onDistance}
        hint={filters.distance !== 'anywhere' ? 'Uses your approx. location' : undefined}
      />

      <View style={styles.countryBlock}>
        <View style={styles.countryLabelRow}>
          <Ionicons name="globe-outline" size={14} color={c.textMuted} />
          <ThemedText style={[styles.countryLabel, { color: c.textMuted }]}>Country</ThemedText>
        </View>
        <Pressable
          onPress={onOpenCountry}
          style={({ pressed }) => [
            styles.countryBtn,
            {
              backgroundColor: filters.country ? c.tintMuted : c.surfaceAlt,
              borderColor: filters.country ? c.tint : c.border,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons
            name={filters.country ? 'flag' : 'earth'}
            size={16}
            color={filters.country ? c.tint : c.textMuted}
          />
          <ThemedText
            style={[
              styles.countryValue,
              { color: filters.country ? c.tintPressed : c.text },
            ]}
            numberOfLines={1}
          >
            {filters.country ? withFlag(filters.country) : 'Anywhere'}
          </ThemedText>
          <Ionicons name="chevron-down" size={16} color={c.textSubtle} />
        </Pressable>
      </View>
    </View>
  );
});

function OutOfPlanesCard({ onGetPlanes, c }: { onGetPlanes: () => void; c: Palette }) {
  return (
    <View style={[styles.outCard, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
      <View style={[styles.outIcon, { backgroundColor: c.surface }]}>
        <Ionicons name="paper-plane-outline" size={22} color={c.textSubtle} />
      </View>
      <View style={styles.flex}>
        <ThemedText style={styles.outTitle}>You&apos;re out of planes</ThemedText>
        <ThemedText style={[styles.outSub, { color: c.textMuted }]}>
          Your note will wait here. Watch a short ad for 5 more.
        </ThemedText>
      </View>
      <Pressable
        onPress={onGetPlanes}
        style={({ pressed }) => [
          styles.outBtn,
          { backgroundColor: c.tint, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Ionicons name="play" size={14} color="#fff" />
        <ThemedText style={styles.outBtnLabel}>Get 5</ThemedText>
      </Pressable>
    </View>
  );
}

// ── "Plane sent" confirmation ──────────────────────────────────────────────

function SentModal({
  visible,
  plane,
  onClose,
  onSeeAll,
  c,
}: {
  visible: boolean;
  plane?: LiveSentPlane;
  onClose: () => void;
  onSeeAll: () => void;
  c: Palette;
}) {
  const recipient = plane?.recipient;
  const location = recipient?.location ? locationWithFlag(recipient.location) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          entering={FadeInDown.springify().damping(16)}
          style={[styles.modalCard, { backgroundColor: c.background }]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={[styles.modalClose, { backgroundColor: c.surfaceAlt }]}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={18} color={c.text} />
          </Pressable>

          {recipient ? (
            <>
              <Avatar uri={recipient.avatarUrl} name={recipient.name} size={76} />
              <ThemedText style={[styles.modalKicker, { color: c.textMuted }]}>
                Your plane landed with
              </ThemedText>
              <ThemedText style={styles.modalName} numberOfLines={1}>
                {recipient.name}
              </ThemedText>
              <View style={styles.modalFacts}>
                <View style={[styles.modalFact, { backgroundColor: c.surfaceAlt }]}>
                  <Ionicons name="calendar-outline" size={14} color={c.textMuted} />
                  <ThemedText style={[styles.modalFactText, { color: c.text }]}>
                    {recipient.age != null ? `${recipient.age} yrs` : 'Age hidden'}
                  </ThemedText>
                </View>
                <View style={[styles.modalFact, { backgroundColor: c.surfaceAlt }]}>
                  <Ionicons name="location-outline" size={14} color={c.textMuted} />
                  <ThemedText style={[styles.modalFactText, { color: c.text }]} numberOfLines={1}>
                    {location ?? 'Somewhere'}
                  </ThemedText>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.modalPlane, { backgroundColor: c.tintMuted }]}>
                <Ionicons name="paper-plane" size={34} color={c.tint} />
              </View>
              <View style={styles.modalSearching}>
                <ThemedText style={styles.modalName}>Finding someone</ThemedText>
                <FlyingDots color={c.tint} />
              </View>
              <ThemedText style={[styles.modalKicker, { color: c.textMuted }]}>
                You&apos;ll see who caught it here and in your planes.
              </ThemedText>
            </>
          )}

          <Pressable
            onPress={onSeeAll}
            style={({ pressed }) => [
              styles.modalPrimary,
              { backgroundColor: c.tint, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
          >
            <ThemedText style={styles.modalPrimaryLabel}>View all planes</ThemedText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** "Mumbai, India" → "Mumbai, 🇮🇳 India" when the country is known. */
function locationWithFlag(location: string): string {
  const parts = location.split(',').map((p) => p.trim());
  const last = parts[parts.length - 1];
  const flag = countryFlag(last);
  if (!flag) return location;
  parts[parts.length - 1] = `${flag} ${last}`;
  return parts.join(', ');
}

// ── Filters sheet ───────────────────────────────────────────────────────────

function FiltersSheet({
  visible,
  onClose,
  c,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  c: Palette;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close filters" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, paddingBottom: insets.bottom + Spacing.md },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: c.borderStrong }]} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
            {children}
          </ScrollView>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.sheetDone,
              { backgroundColor: c.tint, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <ThemedText style={styles.sheetDoneLabel}>Done</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Toast ───────────────────────────────────────────────────────────────────

function SendToast({
  toast,
  onHide,
  c,
}: {
  toast: ToastState;
  onHide: (id: number) => void;
  c: Palette;
}) {
  const y = useSharedValue(-140);
  const id = toast.id;

  useEffect(() => {
    y.value = withSequence(
      withSpring(0, { damping: 16, stiffness: 180 }),
      withDelay(
        3800,
        withTiming(-140, { duration: 260 }, (finished) => {
          if (finished) runOnJS(onHide)(id);
        }),
      ),
    );
  }, [y, id, onHide]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  const tint = toast.tone === 'warning' ? c.warning : c.danger;

  return (
    <Animated.View style={[styles.toastWrap, style]}>
      <Pressable
        onPress={() => {
          y.value = withTiming(-140, { duration: 200 }, (finished) => {
            if (finished) runOnJS(onHide)(id);
          });
        }}
        style={[styles.toast, { backgroundColor: c.surface, borderColor: tint }]}
      >
        <View style={[styles.toastIcon, { backgroundColor: tint + '22' }]}>
          <Ionicons name={toast.icon} size={18} color={tint} />
        </View>
        <View style={styles.flex}>
          <ThemedText style={styles.toastTitle}>{toast.title}</ThemedText>
          <ThemedText style={[styles.toastBody, { color: c.textMuted }]}>{toast.body}</ThemedText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  actionArea: { height: 132, alignItems: 'center', justifyContent: 'center', paddingTop: Spacing.md },
  body: { flex: 1, paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg },
  cancelCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  cancelWrap: { alignItems: 'center', gap: 4 },
  clear: { fontSize: 13, fontWeight: '600' },
  cornerLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    borderTopWidth: 140,
    borderRightWidth: 140,
    borderRightColor: 'transparent',
  },
  cornerRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderTopWidth: 140,
    borderLeftWidth: 140,
    borderLeftColor: 'transparent',
  },
  counter: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  countryBlock: { gap: Spacing.sm },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  countryLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  countryLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countryValue: { flex: 1, fontSize: 15, fontWeight: '600' },
  filterDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  filtersCard: {
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  filtersHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  filtersSummary: { fontSize: 13, marginTop: 2 },
  filtersTitle: { fontSize: 17, fontWeight: '700' },
  flex: { flex: 1 },
  foldedPlane: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hint: { alignItems: 'center', gap: Spacing.xs },
  hintArrow2: { marginTop: -14, opacity: 0.5 },
  hintArrows: { alignItems: 'center' },
  hintText: { fontSize: 15, fontWeight: '700' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  launching: { fontSize: 12 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: { width: '100%', maxWidth: 360, borderRadius: Radii.xl, paddingHorizontal: Spacing.xl, paddingTop: Spacing['2xl'], paddingBottom: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
  modalClose: { position: 'absolute', top: Spacing.md, right: Spacing.md, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  modalFact: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radii.pill, maxWidth: '100%' },
  modalFactText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  modalFacts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  modalKicker: { fontSize: 13, textAlign: 'center', marginTop: Spacing.xs },
  modalName: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  modalPlane: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  modalPrimary: { alignSelf: 'stretch', height: 50, borderRadius: Radii.pill, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg },
  modalPrimaryLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  modalSearching: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  note: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    overflow: 'hidden',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  noteFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.sm },
  noteInput: { flex: 1, fontSize: 18, lineHeight: 28, padding: 0, margin: 0 },
  noteWrap: { flex: 1, maxHeight: 400, alignItems: 'center', justifyContent: 'center' },
  outBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radii.pill,
  },
  outBtnLabel: { color: '#fff', fontSize: 13, fontWeight: '700' },
  outCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  outIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outSub: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  outTitle: { fontSize: 15, fontWeight: '700' },
  reset: { fontSize: 13, fontWeight: '700' },
  root: { flex: 1 },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheetContent: { paddingBottom: Spacing.md },
  sheetDone: {
    height: 48,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDoneLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.md,
  },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  stage: { flex: 1, minHeight: 140, alignItems: 'stretch', justifyContent: 'center' },
  toChip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: Spacing.xs, paddingBottom: Spacing.lg, alignSelf: 'center', maxWidth: '100%' },
  toLabel: { fontSize: 13, fontWeight: '600' },
  toValue: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  toastBody: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  toastIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastTitle: { fontSize: 14, fontWeight: '700' },
  toastWrap: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  trail: { position: 'absolute', alignSelf: 'center', bottom: '50%', width: 4, borderRadius: 2 },
});
