/**
 * Send screen — write a note, pick who should catch it, launch.
 *
 *   ┌───────────────────────────────┐
 *   │ Send a plane            ✈ 4   │  header + balance pill
 *   │ ┌───────────────────────────┐ │
 *   │ │ ✈ To: someone new         │ │  composer "postcard"
 *   │ │ ───────────────────────── │ │  ruled lines, char meter
 *   │ └───────────────────────────┘ │
 *   │ Who catches it?   Anyone · …  │  filters (gender / age /
 *   │ [Any][Female][Male][NB]       │  distance / country)
 *   │ ( Launch plane ✈ )            │
 *   │ ✈ Flying — finding someone…   │  live status of last plane
 *   └───────────────────────────────┘
 *
 * Sending is optimistic: tap → haptic → the note folds into a plane and
 * flies off along `planePath` while POST /v1/planes runs in the
 * background (`useSentPlanes().launch`). On failure the message comes
 * back into the composer, the balance is restored and a toast explains.
 */

import * as Haptics from '@/lib/native/haptics';
import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

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
import {
  FlyingDots,
  passedOnLabel,
  planeStatusMeta,
} from '@/components/plane-status';
import { PlaneTrail } from '@/components/plane-trail';
import { TabNavHeader } from '@/components/tab-nav-header';
import { TabSwipeRegion } from '@/components/tab-swipe-region';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useTabFocusFade } from '@/hooks/use-tab-focus-fade';
import { syncLocationIfNeeded } from '@/lib/location';
import { usePlaneBalance } from '@/lib/plane-balance-context';
import { PLANE_ICON_ROTATION_OFFSET, planePath } from '@/lib/plane-path';
import type { LiveSentPlane } from '@/lib/planes-mapper';
import { type LaunchResult, useSentPlanes } from '@/lib/sent-planes-context';

const MAX_LENGTH = 200;
const LINE_HEIGHT = 28;
const PLANE_SIZE = 72;

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
        body: 'Your note is back in the composer. Grab more planes and launch it again.',
        tone: 'warning',
      };
    case 'NETWORK':
      return {
        id,
        icon: 'cloud-offline-outline',
        title: "Couldn't reach Swing",
        body: 'Your note is safe in the composer — check your connection and tap Launch to retry.',
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
        body: 'Your note is back in the composer — tap Launch to try again.',
        tone: 'danger',
      };
  }
}

export default function SendScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const fadeStyle = useTabFocusFade();
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
  /** Last launched plane: `key` = its temp id (stable across the swap), `id` = current id. */
  const [last, setLast] = useState<{ key: string; id: string } | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [flyingText, setFlyingText] = useState('');
  const toastSeq = useRef(0);

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

  // ── Fly-away animation (all UI thread) ─────────────────────────────────
  const rootRef = useRef<View>(null);
  const composerRef = useRef<View>(null);

  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const ghostW = useSharedValue(0);
  const ghostH = useSharedValue(0);
  const ghostProgress = useSharedValue(1); // 0 → 1 = fold away
  const planeOpacity = useSharedValue(0);
  const planeScale = useSharedValue(0.4);
  const flyProgress = useSharedValue(0);
  const trailOpacity = useSharedValue(0);
  const composerPop = useSharedValue(1);
  const shakeX = useSharedValue(0);

  const ghostStyle = useAnimatedStyle(() => {
    const p = ghostProgress.value;
    return {
      opacity: 1 - p,
      width: ghostW.value,
      height: ghostH.value,
      transform: [
        { translateX: originX.value - ghostW.value / 2 },
        { translateY: originY.value - ghostH.value / 2 - p * 30 },
        { scale: 1 - p * 0.78 },
        { rotate: `${-14 * p}deg` },
      ],
    };
  });

  const planeStyle = useAnimatedStyle(() => {
    const t = flyProgress.value;
    const pos = planePath(t);
    const dt = 0.005;
    const a = planePath(t - dt < 0 ? 0 : t - dt);
    const b = planePath(t + dt > 1 ? 1 : t + dt);
    const tangentDeg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    return {
      opacity: planeOpacity.value,
      transform: [
        { translateX: originX.value - PLANE_SIZE / 2 + pos.x },
        { translateY: originY.value - PLANE_SIZE / 2 + pos.y },
        { scale: planeScale.value },
        { rotate: `${tangentDeg + PLANE_ICON_ROTATION_OFFSET}deg` },
      ],
    };
  });

  const trailAnchorStyle = useAnimatedStyle(() => ({
    opacity: trailOpacity.value,
    transform: [{ translateX: originX.value }, { translateY: originY.value }],
  }));

  const composerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }, { scale: composerPop.value }],
  }));

  const runFlight = useCallback(
    (cx: number, cy: number, w: number, h: number) => {
      originX.value = cx;
      originY.value = cy;
      ghostW.value = w;
      ghostH.value = h;

      // 1. The note folds up (0–420ms).
      ghostProgress.value = 0;
      ghostProgress.value = withTiming(1, {
        duration: 420,
        easing: Easing.in(Easing.cubic),
      });

      // 2. A fresh sheet pops into the composer.
      composerPop.value = 0.94;
      composerPop.value = withDelay(180, withSpring(1, { damping: 12, stiffness: 180 }));

      // 3. Plane appears where the note was and takes off along the path.
      flyProgress.value = 0;
      flyProgress.value = withDelay(
        300,
        withTiming(1, { duration: 1250, easing: Easing.in(Easing.quad) }),
      );
      planeOpacity.value = 0;
      planeOpacity.value = withDelay(
        200,
        withSequence(
          withTiming(1, { duration: 180 }),
          withDelay(1000, withTiming(0, { duration: 300 })),
        ),
      );
      planeScale.value = 0.4;
      planeScale.value = withDelay(
        200,
        withSequence(
          withSpring(1.05, { damping: 9, stiffness: 220 }),
          withTiming(0.35, { duration: 1150 }),
        ),
      );
      trailOpacity.value = 1;
      trailOpacity.value = withDelay(1400, withTiming(0, { duration: 400 }));
    },
    [
      originX,
      originY,
      ghostW,
      ghostH,
      ghostProgress,
      composerPop,
      flyProgress,
      planeOpacity,
      planeScale,
      trailOpacity,
    ],
  );

  const startFlight = useCallback(
    (text: string) => {
      setFlyingText(text);
      const root = rootRef.current;
      const comp = composerRef.current;
      const fallback = () => runFlight(180, 300, 300, 200);
      if (!root || !comp) {
        fallback();
        return;
      }
      comp.measureLayout(
        root,
        (x, y, w, h) => runFlight(x + w / 2, y + h / 2, w, h),
        fallback,
      );
      // Second, softer tap as the plane leaves the hand.
      setTimeout(() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, 320);
    },
    [runFlight],
  );

  const shake = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    shakeX.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8, { duration: 60 }),
      withTiming(-5, { duration: 60 }),
      withTiming(0, { duration: 50 }),
    );
  }, [shakeX]);

  // ── Launch ─────────────────────────────────────────────────────────────
  const showToast = useCallback((t: Omit<ToastState, 'id'>) => {
    toastSeq.current += 1;
    setToast({ ...t, id: toastSeq.current });
  }, []);
  const hideToast = useCallback((id: number) => {
    setToast((t) => (t && t.id === id ? null : t));
  }, []);

  const handleLaunch = useCallback(() => {
    const text = message.trim();
    if (!text) {
      shake();
      return;
    }
    if (count <= 0) {
      showToast({
        icon: 'paper-plane-outline',
        title: "You're out of planes",
        body: 'Grab more planes to keep launching.',
        tone: 'warning',
      });
      return;
    }
    const l = launch(text, toApiFilters(filters));
    if (!l) return; // same note already in flight (double tap)

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();
    startFlight(text);
    setMessage('');
    setLast({ key: l.tempId, id: l.tempId });

    void l.result.then((res) => {
      if (res.ok) {
        setLast((cur) =>
          cur && cur.key === l.tempId ? { key: cur.key, id: res.plane.id } : cur,
        );
        return;
      }
      setLast((cur) => (cur && cur.key === l.tempId ? null : cur));
      // Restore the note unless the user already started a new one.
      setMessage((cur) => (cur.trim() ? cur : text));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toastSeq.current += 1;
      setToast(toastForFailure(res, toastSeq.current));
      if (res.code === 'NO_PLANES') void refreshBalance();
    });
  }, [message, count, launch, filters, startFlight, shake, showToast, refreshBalance]);

  const handleGetPlanes = useCallback(() => {
    Alert.alert(
      'Coming soon',
      'Rewarded ads to earn more planes will be available in a future update.',
    );
  }, []);

  const lastPlane = last ? sentPlanes.find((p) => p.id === last.id) : undefined;
  const openLastPlane = useCallback(() => {
    if (!lastPlane || lastPlane.optimistic) return;
    router.push({
      pathname: '/plane/[id]',
      params: { id: lastPlane.id, readOnly: '1' },
    });
  }, [lastPlane, router]);
  const openAllPlanes = useCallback(() => router.push('/planes'), [router]);

  const outOfPlanes = count <= 0;

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: c.background }]}>
      <View ref={rootRef} collapsable={false} style={styles.flex}>
      <TabSwipeRegion currentRoute="/send">
        <Animated.View style={fadeStyle}>
          <TabNavHeader route="/send">
            <ThemedText style={styles.title}>Send a plane</ThemedText>
            <PlaneBalance />
          </TabNavHeader>
        </Animated.View>
      </TabSwipeRegion>

      <TabSwipeRegion currentRoute="/send" style={styles.flex}>
        <Animated.View style={[styles.flex, fadeStyle]}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            showsVerticalScrollIndicator={false}
          >
            <View ref={composerRef} collapsable={false}>
              <Animated.View style={composerAnimStyle}>
                <Composer value={message} onChange={setMessage} c={c} />
              </Animated.View>
            </View>

            <FiltersCard
              filters={filters}
              onGender={setGender}
              onAge={setAge}
              onDistance={setDistance}
              onOpenCountry={openCountry}
              onReset={resetFilters}
              c={c}
            />

            {outOfPlanes ? (
              <OutOfPlanesCard onGetPlanes={handleGetPlanes} c={c} />
            ) : (
              <LaunchButton
                enabled={message.trim().length > 0}
                onPress={handleLaunch}
                c={c}
              />
            )}

            {lastPlane ? (
              <LastPlaneStatus
                key={last?.key}
                plane={lastPlane}
                onOpen={openLastPlane}
                onSeeAll={openAllPlanes}
                c={c}
              />
            ) : null}
          </ScrollView>
        </Animated.View>
      </TabSwipeRegion>

      {/* Flight overlay — sits above everything, never takes touches. */}
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.ghost,
            { backgroundColor: c.surface, borderColor: c.border },
            ghostStyle,
          ]}
        >
          <ThemedText style={[styles.ghostText, { color: c.text }]} numberOfLines={5}>
            {flyingText}
          </ThemedText>
        </Animated.View>
        <Animated.View style={[styles.trailAnchor, trailAnchorStyle]}>
          <PlaneTrail progress={flyProgress} color={c.tint} />
        </Animated.View>
        <Animated.View style={[styles.plane, planeStyle]}>
          <Ionicons name="paper-plane" size={PLANE_SIZE - 8} color={c.tint} />
        </Animated.View>
      </View>

      {toast ? <SendToast key={toast.id} toast={toast} onHide={hideToast} c={c} /> : null}

      </View>

      <CountrySheet
        visible={countryOpen}
        value={filters.country}
        onSelect={setCountry}
        onClose={closeCountry}
      />
    </SafeAreaView>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────

const Composer = memo(function Composer({
  value,
  onChange,
  c,
}: {
  value: string;
  onChange: (v: string) => void;
  c: Palette;
}) {
  const len = value.length;
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(len / MAX_LENGTH, { duration: 160 });
  }, [len, fill]);

  const tint = c.tint;
  const warning = c.warning;
  const danger = c.danger;
  const meterStyle = useAnimatedStyle(() => ({
    width: `${Math.min(1, fill.value) * 100}%`,
    backgroundColor: interpolateColor(
      fill.value,
      [0, 0.84, 0.85, 0.99, 1],
      [tint, tint, warning, warning, danger],
    ),
  }));

  const remaining = MAX_LENGTH - len;
  const counterColor =
    remaining <= 0 ? c.danger : remaining <= 30 ? c.warning : c.textSubtle;

  return (
    <View style={[styles.paper, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* Postcard header band */}
      <View style={[styles.paperBand, { backgroundColor: c.tintMuted }]}>
        <View style={[styles.stamp, { borderColor: c.tint }]}>
          <Ionicons name="paper-plane" size={14} color={c.tint} />
        </View>
        <View style={styles.flex}>
          <ThemedText style={[styles.bandTitle, { color: c.tintPressed }]}>
            To: someone new
          </ThemedText>
          <ThemedText style={[styles.bandSub, { color: c.textMuted }]}>
            One person catches it. If they pass, it flies on.
          </ThemedText>
        </View>
      </View>

      <View style={styles.writing}>
        {/* Ruled lines behind the text */}
        <View style={styles.lines}>
          {Array.from({ length: 5 }).map((_, i) => (
            <View
              key={i}
              style={[styles.rule, { top: (i + 1) * LINE_HEIGHT, backgroundColor: c.border }]}
            />
          ))}
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Write something kind, weird, or true…"
          placeholderTextColor={c.textSubtle}
          multiline
          maxLength={MAX_LENGTH}
          textAlignVertical="top"
          scrollEnabled={false}
          style={[styles.input, { color: c.text }]}
        />
      </View>

      <View style={styles.meterRow}>
        <View style={[styles.meterTrack, { backgroundColor: c.surfaceAlt }]}>
          <Animated.View style={[styles.meterFill, meterStyle]} />
        </View>
        <ThemedText style={[styles.counter, { color: counterColor }]}>
          {len}/{MAX_LENGTH}
        </ThemedText>
      </View>

      <View
        style={[styles.foldCorner, { borderColor: c.border, backgroundColor: c.surfaceAlt }]}
      />
    </View>
  );
});

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
            {filters.country ?? 'Anywhere'}
          </ThemedText>
          <Ionicons name="chevron-down" size={16} color={c.textSubtle} />
        </Pressable>
      </View>
    </View>
  );
});

// ── Launch button ───────────────────────────────────────────────────────────

const LaunchButton = memo(function LaunchButton({
  enabled,
  onPress,
  c,
}: {
  enabled: boolean;
  onPress: () => void;
  c: Palette;
}) {
  const press = useSharedValue(1);
  const on = useSharedValue(enabled ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(enabled ? 1 : 0, { duration: 200 });
  }, [enabled, on]);

  const idle = c.borderStrong;
  const active = c.tint;
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [idle, active]),
    shadowOpacity: 0.25 * on.value,
    transform: [{ scale: press.value }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (1 - press.value) * 40 },
      { translateY: -(1 - press.value) * 40 },
      { rotate: `${(1 - press.value) * -60}deg` },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        press.value = withSpring(0.95, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 10, stiffness: 260 });
      }}
      accessibilityRole="button"
      accessibilityLabel="Launch plane"
    >
      <Animated.View style={[styles.launch, { shadowColor: c.tint }, style]}>
        <ThemedText style={styles.launchLabel}>Launch plane</ThemedText>
        <Animated.View style={iconStyle}>
          <Ionicons name="paper-plane" size={20} color="#fff" />
        </Animated.View>
      </Animated.View>
    </Pressable>
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

// ── Live status of the last plane ───────────────────────────────────────────

function LastPlaneStatus({
  plane,
  onOpen,
  onSeeAll,
  c,
}: {
  plane: LiveSentPlane;
  onOpen: () => void;
  onSeeAll: () => void;
  c: Palette;
}) {
  const meta = planeStatusMeta(plane, c);
  const passed = passedOnLabel(plane);
  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} exiting={FadeOut}>
      <Pressable
        onPress={onOpen}
        disabled={plane.optimistic}
        style={({ pressed }) => [
          styles.status,
          { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={[styles.statusIcon, { backgroundColor: meta.tint + '1F' }]}>
          <Ionicons name={meta.icon} size={16} color={meta.tint} />
        </View>
        <View style={styles.flex}>
          <View style={styles.statusTitleRow}>
            <ThemedText style={[styles.statusTitle, { color: meta.tint }]} numberOfLines={1}>
              {meta.label}
            </ThemedText>
            {meta.animated ? <FlyingDots color={meta.tint} /> : null}
          </View>
          <ThemedText style={[styles.statusSub, { color: c.textMuted }]} numberOfLines={1}>
            {passed ? `${passed} · ` : ''}“{plane.message}”
          </ThemedText>
        </View>
        <Pressable onPress={onSeeAll} hitSlop={10}>
          <ThemedText style={[styles.seeAll, { color: c.tint }]}>All</ThemedText>
        </Pressable>
      </Pressable>
    </Animated.View>
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
  root: { flex: 1 },
  flex: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700' },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },

  // Composer
  paper: {
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  paperBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  stamp: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
  },
  bandTitle: { fontSize: 14, fontWeight: '700' },
  bandSub: { fontSize: 11, marginTop: 1 },
  writing: {
    minHeight: LINE_HEIGHT * 5 + Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  lines: {
    ...StyleSheet.absoluteFillObject,
    top: Spacing.sm + 2,
    left: Spacing.lg,
    right: Spacing.lg,
    pointerEvents: 'none',
  },
  rule: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.8,
  },
  input: {
    fontSize: 17,
    lineHeight: LINE_HEIGHT,
    minHeight: LINE_HEIGHT * 5,
    padding: 0,
    margin: 0,
    paddingTop: 4,
  },
  meterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    paddingRight: 44,
  },
  meterTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  meterFill: { height: 4, borderRadius: 2 },
  counter: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  foldCorner: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderTopLeftRadius: Radii.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },

  // Filters
  filtersCard: {
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  filtersHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  filtersTitle: { fontSize: 17, fontWeight: '700' },
  filtersSummary: { fontSize: 13, marginTop: 2 },
  reset: { fontSize: 13, fontWeight: '700' },
  countryBlock: { gap: Spacing.sm },
  countryLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countryLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  countryValue: { flex: 1, fontSize: 15, fontWeight: '600' },

  // Launch
  launch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 17,
    borderRadius: Radii.pill,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  launchLabel: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },

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
  outTitle: { fontSize: 15, fontWeight: '700' },
  outSub: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  outBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radii.pill,
  },
  outBtnLabel: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Live status
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  statusSub: { fontSize: 12, marginTop: 2 },
  seeAll: { fontSize: 13, fontWeight: '700' },

  // Flight overlay
  overlay: { ...StyleSheet.absoluteFillObject, pointerEvents: 'none' },
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  ghostText: { fontSize: 17, lineHeight: LINE_HEIGHT, fontStyle: 'italic' },
  trailAnchor: { position: 'absolute', left: 0, top: 0, width: 0, height: 0 },
  plane: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PLANE_SIZE,
    height: PLANE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Toast
  toastWrap: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.lg,
    right: Spacing.lg,
  },
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
  toastIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastTitle: { fontSize: 14, fontWeight: '700' },
  toastBody: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
