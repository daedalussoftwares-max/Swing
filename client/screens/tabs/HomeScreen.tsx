/**
 * Home screen — the inbox of received paper planes.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │ Swing ✈            🔔(3)    │  header
 *   │                             │
 *   │  ←  ┌────────────────┐  →   │  card carousel (fixed height)
 *   │     │   plane card   │      │  side arrows enable when applicable
 *   │     └────────────────┘      │
 *   │     ─── • • • • ───         │  animated page dots (smooth slide)
 *   │                             │
 *   └─────────────────────────────┘
 *
 * Card carousel uses a horizontal `Animated.FlatList`. `scrollX` (shared
 * value) drives the page-dot animation in real time so the active dot
 * smoothly slides between positions, not snap.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import { Image } from '@/lib/native/image';
import { useRouter } from '@/lib/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendsCelebration } from '@/components/friends-celebration';
import { PlaneCard } from '@/components/plane-card';
import { TabNavHeader } from '@/components/tab-nav-header';
import { TabSwipeRegion } from '@/components/tab-swipe-region';
import { ThemedText } from '@/components/themed-text';
import { WelcomeDialog } from '@/components/welcome-dialog';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabFocusFade } from '@/hooks/use-tab-focus-fade';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/lib/auth-context';
import { useChats } from '@/lib/chats-context';
import { MOCK_PLANES } from '@/lib/mock-planes';
import { useNotifications } from '@/lib/notifications-context';
import { runFirstTimePermissionFlow } from '@/lib/permissions';
import { useSentPlanes } from '@/lib/sent-planes-context';
import { useUserSettings } from '@/lib/user-settings-context';
import type { Plane } from '@/types/plane';

/**
 * Per-user "we've already shown the welcome dialog" set. Persisted in
 * AsyncStorage so the dialog appears exactly once for a given account,
 * surviving app relaunches and hot reloads. Stored as an array of
 * user ids; we keep it tiny by design.
 */
const WELCOME_SEEN_KEY = 'swing/v1/home/welcome-seen';

async function readWelcomeSeen(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(WELCOME_SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function markWelcomeSeen(userId: string): Promise<void> {
  try {
    const list = await readWelcomeSeen();
    if (!list.includes(userId)) {
      list.push(userId);
      await AsyncStorage.setItem(WELCOME_SEEN_KEY, JSON.stringify(list));
    }
  } catch {
    /* best-effort */
  }
}

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList<Plane>);

const CARD_HORIZONTAL_PADDING = Spacing.xl;
const CARD_AREA_HEIGHT = 480;

export default function HomeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Plane>>(null);
  const [index, setIndex] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const fadeStyle = useTabFocusFade();
  const router = useRouter();
  const { acceptPlane, chats } = useChats();
  const { unreadCount } = useNotifications();
  const { total: sentTotal } = useSentPlanes();
  const { user } = useUserSettings();
  // The seen-set is keyed by the *auth* account id (e.g. "u_17xxxxxx")
  // and NOT by the local user-settings id (which is always 'me' until
  // user-settings gets persisted per-account). Keying by auth id is
  // what makes the dialog show once per real account rather than once
  // ever across all signups on this device.
  const auth = useAuth();
  const authUserId = auth.status === 'signed-in' ? auth.user.id : null;

  // Welcome dialog — shown exactly once per auth account (persisted in
  // AsyncStorage). We delay the open slightly so it doesn't fight
  // the home tab's mount animations, and we *don't* set
  // `showWelcome=true` synchronously; instead we wait for the
  // AsyncStorage read so we never flash the dialog and then hide it.
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      const seen = await readWelcomeSeen();
      if (cancelled) return;
      if (!seen.includes(authUserId)) {
        timer = setTimeout(() => {
          if (!cancelled) setShowWelcome(true);
        }, 500);
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [authUserId]);

  const closeWelcome = () => {
    setShowWelcome(false);
    if (authUserId) void markWelcomeSeen(authUserId);
    // Kick off the (sequenced, idempotent) notifications + location
    // permission flow. It's fire-and-forget — the UI doesn't block on
    // the prompt outcomes; we'll re-check granted state lazily when
    // the features that need them are actually used.
    void runFirstTimePermissionFlow();
  };
  // Locally rejected ids; combined with accepted-sender ids (derived from
  // `chats`) to filter the inbox. Using `chats` as part of the source of
  // truth means accepts done from the plane-detail screen also propagate
  // back here automatically.
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(() => new Set());
  const acceptedSenderIds = useMemo(
    () => new Set(chats.map((c) => c.partner.id)),
    [chats],
  );
  const visiblePlanes = useMemo<Plane[]>(
    () =>
      MOCK_PLANES.filter(
        (p) => !rejectedIds.has(p.id) && !acceptedSenderIds.has(p.sender.id),
      ),
    [rejectedIds, acceptedSenderIds],
  );

  const openPlane = (plane: Plane) => {
    router.push(`/plane/${plane.id}`);
  };

  const openProfile = (plane: Plane) => {
    router.push(`/profile/${plane.sender.id}`);
  };

  // Friends-celebration overlay shown for 3s between "tap Accept" and
  // "land in chat". The chat itself is created synchronously; we just
  // hold the celebration card on screen before navigating.
  const [celebrationFor, setCelebrationFor] = useState<{
    plane: Plane;
    chatId: string;
  } | null>(null);

  const handleAccept = (plane: Plane) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const chat = acceptPlane(plane);
    setCelebrationFor({ plane, chatId: chat.id });
  };

  const dismissCelebration = () => {
    // Cancel-style exit — close the dialog, stay on home. The chat
    // thread has already been created, so the user can find it later
    // from the Chats tab whenever they're ready.
    setCelebrationFor(null);
  };

  const startCelebrationChat = () => {
    if (!celebrationFor) return;
    const { chatId } = celebrationFor;
    setCelebrationFor(null);
    router.push(`/chat/${chatId}`);
  };

  const handleReject = (plane: Plane) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRejectedIds((prev) => {
      const next = new Set(prev);
      next.add(plane.id);
      return next;
    });
    // Keep the carousel index sensible after removal.
    setIndex((i) => Math.max(0, Math.min(i, visiblePlanes.length - 2)));
  };

  // Live horizontal scroll offset. Drives the animated page dots so they
  // slide smoothly while the user is still dragging.
  const scrollX = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  const total = visiblePlanes.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newIndex !== index) setIndex(newIndex);
  };

  const goPrev = () => {
    if (!hasPrev) return;
    listRef.current?.scrollToIndex({ index: index - 1, animated: true });
  };

  const goNext = () => {
    if (!hasNext) return;
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRejectedIds(new Set());
    setIndex(0);
    scrollX.value = 0;
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
    setRefreshing(false);
  }, [scrollX]);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.refreshScroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.tint}
            colors={[c.tint]}
          />
        }
      >
      {/* Header is its own tab-swipe region. The card carousel below has
          its own horizontal FlatList for card-by-card swiping, so wrapping
          it in TabSwipeRegion would fight the FlatList's pan. Wrapping the
          header + dots as separate swipe regions gives the user "swipe
          anywhere except on a card to change tab" — Instagram-style. */}
      <TabSwipeRegion currentRoute="/">
        <Animated.View style={fadeStyle}>
          <TabNavHeader route="/" compact>
            <Image
              source={require('@/assets/images/swing-logo.png')}
              style={styles.brandLogo}
              contentFit="contain"
            />
            <View style={styles.headerActions}>
            <Pressable
              hitSlop={10}
              style={styles.headerIconBtn}
              onPress={() => router.push('/planes')}
            >
              <Ionicons name="paper-plane-outline" size={22} color={c.text} />
              {sentTotal > 0 ? (
                <View
                  style={[styles.badge, { backgroundColor: c.tint }]}
                >
                  <ThemedText style={styles.badgeText}>
                    {sentTotal > 9 ? '9+' : sentTotal}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>

            <Pressable
              hitSlop={10}
              style={styles.headerIconBtn}
              onPress={() => router.push('/notifications')}
            >
              <Ionicons
                name="notifications-outline"
                size={24}
                color={c.text}
              />
              {unreadCount > 0 ? (
                <View style={[styles.badge, { backgroundColor: c.danger }]}>
                  <ThemedText style={styles.badgeText}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          </View>
          </TabNavHeader>
        </Animated.View>
      </TabSwipeRegion>

      {/* Body fills the space between header and bottom-tab-bar, and
          vertically centres the (carousel + dots) block inside it.
          Wrapped in a TabSwipeRegion so the empty space above/below the
          carousel — plus the area around the side arrows — is a tab-swipe
          surface. The native FlatList still wins touches that start on a
          card itself, so card-to-card paging is unaffected. */}
      <TabSwipeRegion currentRoute="/" style={styles.body}>
      {/* Card carousel — horizontal paged FlatList. */}
      <View style={styles.carouselContainer}>
        {visiblePlanes.length === 0 ? (
          <View style={styles.emptyInbox}>
            <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
              <Ionicons name="paper-plane-outline" size={40} color={c.textSubtle} />
            </View>
            <ThemedText style={styles.emptyTitle}>Inbox empty</ThemedText>
            <ThemedText style={[styles.emptySubtitle, { color: c.textMuted }]}>
              New paper planes will land here as people send them your way.
            </ThemedText>
          </View>
        ) : (
          <AnimatedFlatList
            ref={listRef as React.RefObject<FlatList<Plane>>}
            data={visiblePlanes}
            keyExtractor={(p) => p.id}
            extraData={visiblePlanes.length}
            renderItem={({ item }) => (
              <View style={[styles.page, { width }]}>
                <PlaneCard
                  plane={item}
                  onOpen={openPlane}
                  onOpenProfile={openProfile}
                  onAccept={handleAccept}
                  onReject={handleReject}
                />
              </View>
            )}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            onMomentumScrollEnd={handleMomentumEnd}
            decelerationRate="fast"
          />
        )}

        <Pressable
          onPress={goPrev}
          disabled={!hasPrev}
          hitSlop={12}
          style={[
            styles.sideArrow,
            styles.prevArrow,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              opacity: hasPrev ? 1 : 0.35,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={22} color={c.textMuted} />
        </Pressable>

        <Pressable
          onPress={goNext}
          disabled={!hasNext}
          hitSlop={12}
          style={[
            styles.sideArrow,
            styles.nextArrow,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              opacity: hasNext ? 1 : 0.35,
            },
          ]}
        >
          <Ionicons name="chevron-forward" size={22} color={c.textMuted} />
        </Pressable>
      </View>

      {/* Animated page dots — each dot's width / colour interpolates as
          `scrollX` slides through page boundaries. Wrapped in a TabSwipeRegion
          so the bottom band below the cards is also a tab-swipe surface. */}
      <View style={styles.dotsSwipe}>
        <View style={styles.dots}>
          {visiblePlanes.map((_, i) => (
            <PageDot
              key={i}
              index={i}
              pageWidth={width}
              scrollX={scrollX}
              activeColor={c.tint}
              inactiveColor={c.borderStrong}
            />
          ))}
        </View>
      </View>
      </TabSwipeRegion>
      </ScrollView>

      {/* Mini-profile dialog shown after accepting a plane. The chat
          thread is already created; the user decides whether to dive
          into it now or dismiss and find it in the Chats tab later. */}
      <FriendsCelebration
        visible={celebrationFor !== null}
        sender={celebrationFor?.plane.sender ?? null}
        onDismiss={dismissCelebration}
        onStartChat={startCelebrationChat}
      />

      {/* First-visit welcome — invites the user to round out their
          profile (interests / status / bio) and warms up the native
          permission prompts. Only shows once per user per session. */}
      <WelcomeDialog
        visible={showWelcome}
        userName={user.name}
        onComplete={closeWelcome}
        onLater={closeWelcome}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// PageDot — single animated dot that grows / colours based on how close the
// scroll is to its index.
// ---------------------------------------------------------------------------

type PageDotProps = {
  index: number;
  pageWidth: number;
  scrollX: SharedValue<number>;
  activeColor: string;
  inactiveColor: string;
};

function PageDot({ index, pageWidth, scrollX, activeColor, inactiveColor }: PageDotProps) {
  const animatedStyle = useAnimatedStyle(() => {
    // Three reference points: prev page centre, this dot's page centre,
    // next page centre. Width / colour peak when scroll is exactly on
    // this index, and decay to the inactive values one page away.
    const inputRange = [
      (index - 1) * pageWidth,
      index * pageWidth,
      (index + 1) * pageWidth,
    ];
    const width = interpolate(
      scrollX.value,
      inputRange,
      [6, 18, 6],
      Extrapolation.CLAMP,
    );
    const backgroundColor = interpolateColor(
      scrollX.value,
      inputRange,
      [inactiveColor, activeColor, inactiveColor],
    );
    return { width, backgroundColor };
  });

  return <Animated.View style={[styles.dot, animatedStyle]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  refreshScroll: {
    flexGrow: 1,
  },
  brandLogo: {
    height: 40,
    width: 120,
    alignSelf: 'flex-start',
    marginLeft: -2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginLeft: 'auto',
    marginRight: -2,
  },
  headerIconBtn: { padding: 2 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  carouselContainer: {
    height: CARD_AREA_HEIGHT,
    position: 'relative',
  },
  page: {
    paddingHorizontal: CARD_HORIZONTAL_PADDING,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  sideArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  prevArrow: { left: Spacing.sm },
  nextArrow: { right: Spacing.sm },
  emptyInbox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  dotsSwipe: {
    // Extra vertical padding turns the dots into a wider, more forgiving
    // swipe target. The whole body is also a TabSwipeRegion now, but this
    // band reads as the obvious "swipe here" spot.
    paddingVertical: Spacing.sm,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
