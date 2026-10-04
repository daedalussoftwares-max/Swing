/**
 * Plane detail screen — opened by tapping a card in the home carousel.
 *
 * Shows the full sender info + the full (un-trimmed) message + the same
 * accept/reject actions that were on the card. Accepting from here
 * goes straight into the chat thread.
 *
 * Read-only variant:
 *   The same route is reused when opening one of the user's OWN sent
 *   planes from the /planes outbox. In that mode (`?readOnly=1`) we
 *   skip the accept/reject bar and render the recipient + delivery
 *   status instead of the sender.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import { useLocalSearchParams, useRouter } from '@/lib/router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendsCelebration } from '@/components/friends-celebration';
import { describeSentFilters } from '@/components/plane-filter-model';
import {
  FlyingDots,
  passedOnLabel,
  planeStatusMeta,
} from '@/components/plane-status';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChatsActions } from '@/lib/chats-context';
import { useInboxPlanes } from '@/lib/inbox-planes-context';
import { useSentPlanes } from '@/lib/sent-planes-context';
import type { LiveSentPlane } from '@/lib/planes-mapper';
import type { Plane } from '@/types/plane';
import { withFlag } from '@/lib/countries';

export default function PlaneDetailScreen() {
  const { id, readOnly } = useLocalSearchParams<{
    id: string;
    readOnly?: string;
  }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { acceptPlane } = useChatsActions();
  const {
    planes: inboxPlanes,
    accept: acceptInboxPlane,
    reject: rejectInboxPlane,
  } = useInboxPlanes();
  const { sentPlanes } = useSentPlanes();
  // Friends celebration sits between "Accept" and "/chat" — same UX
  // as the home carousel accept. NOTE: this `useState` must live above
  // any early returns or React will yell about hook-order changes.
  const [celebrationChatId, setCelebrationChatId] = useState<string | null>(
    null,
  );
  // Snapshot of the plane being accepted — the inbox removes it
  // optimistically, but we still need it for the celebration dialog.
  const [held, setHeld] = useState<Plane | null>(null);
  const [busy, setBusy] = useState(false);

  // Try the inbound mock list first; fall back to the user's own outbox
  // if `readOnly=1` is set (or if the id matches an outgoing plane).
  const incoming = id ? inboxPlanes.find((p) => p.id === id) : undefined;
  const outgoing = id ? sentPlanes.find((p) => p.id === id) : undefined;
  const isReadOnly = readOnly === '1' || (!incoming && !!outgoing);

  if (isReadOnly && outgoing) {
    return <SentPlaneDetail plane={outgoing} />;
  }

  const plane = incoming ?? (held && held.id === id ? held : undefined);
  if (!plane) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <View style={styles.notFound}>
          <ThemedText style={styles.notFoundText}>Plane not found.</ThemedText>
          <Pressable onPress={() => router.back()}>
            <ThemedText style={{ color: c.tint, marginTop: Spacing.md }}>
              Go back
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    setHeld(plane);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const chatId = await acceptInboxPlane(plane.id);
      if (!chatId) {
        setHeld(null);
        return;
      }
      const chat = await acceptPlane(plane, chatId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCelebrationChatId(chat.id);
    } catch {
      // Inbox rolled the plane back; stay on screen.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setHeld(null);
    } finally {
      setBusy(false);
    }
  };

  const dismissCelebration = () => {
    // Cancel-style exit — drop the dialog and bounce back to home.
    // The chat has already been created, so the user can find it in
    // the Chats tab later.
    setCelebrationChatId(null);
    router.back();
  };

  const startCelebrationChat = () => {
    if (!celebrationChatId) return;
    const chatId = celebrationChatId;
    setCelebrationChatId(null);
    // Replace so the back button from chat lands on home, not on this
    // intermediate detail screen.
    router.replace(`/chat/${chatId}`);
  };

  const handleReject = () => {
    if (busy) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Leave first; the inbox drops the plane optimistically (and restores
    // it on the home carousel if the request fails).
    router.back();
    rejectInboxPlane(plane.id).catch(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    });
  };

  const openProfile = () => {
    router.push(`/profile/${plane.sender.id}`);
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Paper plane</ThemedText>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Sender card (tap → profile) */}
        <Pressable
          onPress={openProfile}
          style={({ pressed }) => [
            styles.senderCard,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: c.tintMuted }]}>
            <ThemedText style={[styles.avatarInitial, { color: c.tintPressed }]}>
              {plane.sender.name.charAt(0).toUpperCase()}
            </ThemedText>
          </View>
          <View style={styles.senderText}>
            <ThemedText style={styles.senderName}>{plane.sender.name}</ThemedText>
            <ThemedText style={[styles.senderMeta, { color: c.textMuted }]}>
              {[
                plane.sender.ageBadge || null,
                plane.sender.distanceKm > 0 ? `${plane.sender.distanceKm} km away` : null,
                [plane.sender.city, plane.sender.country ? withFlag(plane.sender.country) : null].filter(Boolean).join(', ') || null,
              ]
                .filter(Boolean)
                .join(' · ') || 'On Swing'}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textSubtle} />
        </Pressable>

        {/* The plane "paper" itself */}
        <Animated.View
          entering={FadeInDown.springify().damping(15)}
          style={[
            styles.paper,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <View style={styles.paperIconWrap}>
            <Ionicons name="paper-plane" size={28} color={c.tint} />
          </View>
          <ThemedText style={styles.message}>{plane.message}</ThemedText>

          {/* Dotted divider */}
          <View style={styles.dotsRow}>
            {Array.from({ length: 28 }).map((_, i) => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: c.borderStrong }]}
              />
            ))}
          </View>

          <ThemedText style={[styles.timestamp, { color: c.textMuted }]}>
            Sent {timeAgo(plane.sentAt)}
          </ThemedText>
        </Animated.View>
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.actionBar, { borderTopColor: c.border }]}>
        <SpringButton
          onPress={handleReject}
          disabled={busy}
          style={[
            styles.actionButton,
            styles.rejectButton,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <Ionicons name="close" size={22} color={c.danger} />
          <ThemedText style={[styles.actionLabel, { color: c.danger }]}>
            Pass it on
          </ThemedText>
        </SpringButton>
        <SpringButton
          onPress={handleAccept}
          disabled={busy}
          style={[
            styles.actionButton,
            styles.acceptButton,
            { backgroundColor: c.success, opacity: busy ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
          <ThemedText style={[styles.actionLabel, { color: '#fff' }]}>
            Accept
          </ThemedText>
        </SpringButton>
      </View>

      {/* Friends dialog — user picks whether to open the chat now or
          dismiss and continue browsing. No auto-navigation. */}
      <FriendsCelebration
        visible={celebrationChatId !== null}
        sender={plane.sender}
        onDismiss={dismissCelebration}
        onStartChat={startCelebrationChat}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Read-only variant — used when the user opens one of their OWN sent
// planes from the outbox. No accept/reject; just the message + status.
// ---------------------------------------------------------------------------

function SentPlaneDetail({ plane }: { plane: LiveSentPlane }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const meta = planeStatusMeta(plane, c);
  const passed = passedOnLabel(plane);

  const searching = plane.status === 'flying';
  const recipientName = plane.recipient?.name ?? plane.recipientName;
  const recipientLocation = plane.recipient?.location;
  const recipientId = searching ? undefined : plane.recipient?.id;
  const filterLabel = describeSentFilters(plane.filters);
  const live = plane.status === 'flying' || plane.status === 'pending';
  const expiresIn = live && plane.expiresAt ? timeUntil(plane.expiresAt) : null;

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <ThemedText style={styles.headerTitle}>Your plane</ThemedText>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status / recipient card — tap → profile when delivered. */}
        <Pressable
          onPress={
            recipientId ? () => router.push(`/profile/${recipientId}`) : undefined
          }
          disabled={!recipientId}
          style={({ pressed }) => [
            styles.senderCard,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              opacity: pressed && recipientId ? 0.85 : 1,
            },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: meta.tint + '1F' }]}>
            {searching || !recipientName ? (
              <Ionicons name={meta.icon} size={22} color={meta.tint} />
            ) : (
              <ThemedText style={[styles.avatarInitial, { color: meta.tint }]}>
                {recipientName.charAt(0).toUpperCase()}
              </ThemedText>
            )}
          </View>
          <View style={styles.senderText}>
            <View style={styles.statusRow}>
              <ThemedText style={[styles.senderName, { color: meta.tint }]}>
                {meta.label}
              </ThemedText>
              {meta.animated ? <FlyingDots color={meta.tint} /> : null}
            </View>
            <ThemedText style={[styles.senderMeta, { color: c.textMuted }]}>
              {searching
                ? 'Looking for the right person to catch it'
                : [recipientLocation, passed].filter(Boolean).join(' · ') ||
                  'Waiting on their reply'}
            </ThemedText>
          </View>
          {recipientId ? (
            <Ionicons name="chevron-forward" size={20} color={c.textSubtle} />
          ) : null}
        </Pressable>

        {/* The paper itself */}
        <Animated.View
          entering={FadeInDown.springify().damping(15)}
          style={[
            styles.paper,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <View style={styles.paperIconWrap}>
            <Ionicons name="paper-plane" size={28} color={c.tint} />
          </View>
          <ThemedText style={styles.message}>{plane.message}</ThemedText>

          <View style={styles.dotsRow}>
            {Array.from({ length: 28 }).map((_, i) => (
              <View
                key={i}
                style={[styles.dot, { backgroundColor: c.borderStrong }]}
              />
            ))}
          </View>

          <ThemedText style={[styles.timestamp, { color: c.textMuted }]}>
            Sent {timeAgo(plane.sentAt)}
            {plane.respondedAt && plane.status === 'accepted'
              ? ` · accepted ${timeAgo(plane.respondedAt)}`
              : ''}
            {expiresIn ? ` · expires in ${expiresIn}` : ''}
          </ThemedText>
        </Animated.View>

        {/* Journey stats */}
        <View
          style={[
            styles.filtersCard,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <ThemedText style={[styles.filtersTitle, { color: c.textMuted }]}>
            JOURNEY
          </ThemedText>
          <View style={styles.filtersChips}>
            <FilterChip
              icon="airplane-outline"
              label={`${plane.hops ?? 0} ${(plane.hops ?? 0) === 1 ? 'stop' : 'stops'}`}
            />
            <FilterChip
              icon="return-up-forward-outline"
              label={passed ?? 'Not passed on yet'}
            />
            {filterLabel ? <FilterChip icon="options-outline" label={filterLabel} /> : (
              <FilterChip icon="earth-outline" label="Anyone, anywhere" />
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View
      style={[
        styles.filterChip,
        { backgroundColor: c.surfaceAlt, borderColor: c.border },
      ]}
    >
      <Ionicons name={icon} size={13} color={c.textMuted} />
      <ThemedText style={[styles.filterChipText, { color: c.text }]}>
        {label}
      </ThemedText>
    </View>
  );
}

function SpringButton({
  onPress,
  disabled,
  style,
  children,
}: {
  onPress: () => void;
  disabled?: boolean;
  style: React.ComponentProps<typeof Animated.View>['style'];
  children: React.ReactNode;
}) {
  const press = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        press.value = withSpring(0.94, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        press.value = withSpring(1, { damping: 10, stiffness: 260 });
      }}
      style={styles.springWrap}
    >
      <Animated.View style={[style, animStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

function timeUntil(iso: string): string | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  return `${Math.round(mins / 60)}h`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerRight: {
    width: 26,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  senderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 20,
    fontWeight: '700',
  },
  senderText: {
    flex: 1,
  },
  senderName: {
    fontSize: 16,
    fontWeight: '600',
  },
  senderMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  paper: {
    padding: Spacing.xl,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '-0.6deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  paperIconWrap: {
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  message: {
    fontSize: 19,
    lineHeight: 28,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.xl,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
  timestamp: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
  actionBar: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radii.pill,
  },
  rejectButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  acceptButton: {},
  springWrap: { flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    fontSize: 16,
  },

  // Read-only variant
  filtersCard: {
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  filtersTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  filtersChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: { fontSize: 12, fontWeight: '500' },
});
