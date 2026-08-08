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
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendsCelebration } from '@/components/friends-celebration';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChats } from '@/lib/chats-context';
import { findPlaneById } from '@/lib/mock-planes';
import { useSentPlanes } from '@/lib/sent-planes-context';
import type { SentPlane, SentPlaneStatus } from '@/types/sent-plane';

export default function PlaneDetailScreen() {
  const { id, readOnly } = useLocalSearchParams<{
    id: string;
    readOnly?: string;
  }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { acceptPlane } = useChats();
  const { sentPlanes } = useSentPlanes();
  // Friends celebration sits between "Accept" and "/chat" — same UX
  // as the home carousel accept. NOTE: this `useState` must live above
  // any early returns or React will yell about hook-order changes.
  const [celebrationChatId, setCelebrationChatId] = useState<string | null>(
    null,
  );

  // Try the inbound mock list first; fall back to the user's own outbox
  // if `readOnly=1` is set (or if the id matches an outgoing plane).
  const incoming = id ? findPlaneById(id) : undefined;
  const outgoing = id ? sentPlanes.find((p) => p.id === id) : undefined;
  const isReadOnly = readOnly === '1' || (!incoming && !!outgoing);

  if (isReadOnly && outgoing) {
    return <SentPlaneDetail plane={outgoing} />;
  }

  const plane = incoming;
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

  const handleAccept = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const chat = acceptPlane(plane);
    setCelebrationChatId(chat.id);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
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
              {plane.sender.ageBadge} · {plane.sender.distanceKm} km away
              {plane.sender.city ? ` · ${plane.sender.city}` : ''}
            </ThemedText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={c.textSubtle} />
        </Pressable>

        {/* The plane "paper" itself */}
        <View
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
        </View>
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.actionBar, { borderTopColor: c.border }]}>
        <Pressable
          onPress={handleReject}
          style={({ pressed }) => [
            styles.actionButton,
            styles.rejectButton,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="close" size={22} color={c.danger} />
          <ThemedText style={[styles.actionLabel, { color: c.danger }]}>
            Pass
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={handleAccept}
          style={({ pressed }) => [
            styles.actionButton,
            styles.acceptButton,
            {
              backgroundColor: c.success,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="checkmark" size={22} color="#fff" />
          <ThemedText style={[styles.actionLabel, { color: '#fff' }]}>
            Accept
          </ThemedText>
        </Pressable>
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

function SentPlaneDetail({ plane }: { plane: SentPlane }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const meta = STATUS_META[plane.status];
  const tint = meta.tint(c);

  // Resolve a name + avatar fallback. Every sent plane has a recipient
  // since the system pairs each launch with a real user — but for older
  // mock entries we may only have `recipientName`.
  const recipientName =
    plane.recipient?.name ?? plane.recipientName ?? 'Anonymous';
  const recipientLocation = plane.recipient?.location;
  const recipientId = plane.recipient?.id;

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
        {/* Recipient card (same shape as the inbound sender card) —
            tap → profile when we have a real id. */}
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
          <View style={[styles.avatar, { backgroundColor: c.tintMuted }]}>
            <ThemedText
              style={[styles.avatarInitial, { color: c.tintPressed }]}
            >
              {recipientName.charAt(0).toUpperCase()}
            </ThemedText>
          </View>
          <View style={styles.senderText}>
            <ThemedText style={styles.senderName}>
              To {recipientName}
            </ThemedText>
            <ThemedText style={[styles.senderMeta, { color: c.textMuted }]}>
              {recipientLocation ? `${recipientLocation} · ` : ''}
              <ThemedText
                style={[styles.senderMeta, { color: tint, fontWeight: '600' }]}
              >
                {meta.label}
              </ThemedText>
            </ThemedText>
          </View>
          {recipientId ? (
            <Ionicons name="chevron-forward" size={20} color={c.textSubtle} />
          ) : null}
        </Pressable>

        {/* The paper itself — visually identical to the inbound detail */}
        <View
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
          </ThemedText>
        </View>

        {/* Filters used at send-time */}
        {plane.filters ? (
          <View
            style={[
              styles.filtersCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <ThemedText style={[styles.filtersTitle, { color: c.textMuted }]}>
              SEND FILTERS
            </ThemedText>
            <View style={styles.filtersChips}>
              {plane.filters.country ? (
                <FilterChip icon="globe-outline" label={plane.filters.country} />
              ) : null}
              {plane.filters.radiusKm ? (
                <FilterChip
                  icon="location-outline"
                  label={`${plane.filters.radiusKm} km`}
                />
              ) : null}
              {plane.filters.gender ? (
                <FilterChip
                  icon="person-outline"
                  label={plane.filters.gender}
                />
              ) : null}
              {plane.filters.ageRange ? (
                <FilterChip
                  icon="people-outline"
                  label={`${plane.filters.ageRange[0]}–${plane.filters.ageRange[1]}`}
                />
              ) : null}
            </View>
          </View>
        ) : null}
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

// Recipient-visible label only ever surfaces two states — Accepted or
// On air. Internally we still track flying / pending / rejected /
// expired (for analytics, future expiry sweeps, etc.), but the user
// sees a clean two-state label.
const STATUS_META: Record<
  SentPlaneStatus,
  {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    tint: (c: (typeof Colors)['light']) => string;
  }
> = {
  flying: {
    icon: 'paper-plane-outline',
    label: 'On air',
    tint: (c) => c.warning,
  },
  pending: {
    icon: 'paper-plane-outline',
    label: 'On air',
    tint: (c) => c.warning,
  },
  accepted: {
    icon: 'checkmark-circle',
    label: 'Accepted',
    tint: (c) => c.success,
  },
  rejected: {
    icon: 'paper-plane-outline',
    label: 'On air',
    tint: (c) => c.warning,
  },
  expired: {
    icon: 'paper-plane-outline',
    label: 'On air',
    tint: (c) => c.warning,
  },
};

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
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  acceptButton: {
    flex: 2,
  },
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
