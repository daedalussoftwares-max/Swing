/**
 * Outbox / Planes screen — list of every plane the local user has sent.
 *
 * Reachable from:
 *   - The plane icon on the home header (next to the bell)
 *   - The "Planes" segment on the profile tab
 *
 * The list is grouped into just TWO buckets so the user sees what
 * matters:
 *   1. ✅ Accepted  (green) — planes that landed and started a chat
 *   2. 🟡 On air    (yellow) — flying / pending
 *
 * Rejected / expired planes are intentionally hidden from this view —
 * they live in the data but don't clutter the outbox.
 *
 * Tapping a row opens the existing plane-detail screen in READ-ONLY mode
 * (no accept / reject buttons) — the route honours a `?readOnly=1`
 * query string.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { SwipeSafePressable } from '@/components/swipe-safe-pressable';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSentPlanes } from '@/lib/sent-planes-context';
import type { SentPlane } from '@/types/sent-plane';

export default function PlanesScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { sentPlanes } = useSentPlanes();

  // Partition into the two visible buckets — rejected/expired planes
  // are intentionally excluded from this screen.
  const buckets = useMemo(() => {
    const accepted: SentPlane[] = [];
    const onAir: SentPlane[] = [];
    for (const p of sentPlanes) {
      if (p.status === 'accepted') accepted.push(p);
      else if (p.status === 'flying' || p.status === 'pending') onAir.push(p);
    }
    const sortNewestFirst = (a: SentPlane, b: SentPlane) =>
      new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
    accepted.sort(sortNewestFirst);
    onAir.sort(sortNewestFirst);
    return { accepted, onAir };
  }, [sentPlanes]);

  const visibleCount = buckets.accepted.length + buckets.onAir.length;

  const openPlane = (plane: SentPlane) => {
    // Real planes have an "incoming" detail route — for the user's own
    // outbox we just reuse the same route in read-only mode.
    router.push({
      pathname: '/plane/[id]',
      params: { id: plane.id, readOnly: '1' },
    });
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.title}>Your planes</ThemedText>
        </View>
      </View>

      {visibleCount === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
            <Ionicons name="paper-plane-outline" size={32} color={c.tint} />
          </View>
          <ThemedText style={styles.emptyTitle}>Nothing here</ThemedText>
          <ThemedText style={[styles.emptySub, { color: c.textMuted }]}>
            You haven&apos;t sent any planes yet.
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <Section
            title="Accepted"
            tint={c.success}
            icon="checkmark-circle"
            items={buckets.accepted}
            emptyHint="No-one's accepted yet. Keep sending."
            onOpen={openPlane}
          />
          <Section
            title="On air"
            tint={c.warning}
            icon="paper-plane"
            items={buckets.onAir}
            emptyHint="No planes in flight. Send another one."
            onOpen={openPlane}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  tint,
  icon,
  items,
  emptyHint,
  onOpen,
}: {
  title: string;
  tint: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: SentPlane[];
  emptyHint?: string;
  onOpen: (plane: SentPlane) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Hide entirely when there are no items AND no emptyHint provided.
  if (items.length === 0 && !emptyHint) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, { backgroundColor: tint }]} />
        <Ionicons name={icon} size={16} color={tint} />
        <ThemedText style={[styles.sectionTitle, { color: tint }]}>
          {title}
        </ThemedText>
        <View
          style={[
            styles.sectionCount,
            { backgroundColor: tint + '22' },
          ]}
        >
          <ThemedText style={[styles.sectionCountText, { color: tint }]}>
            {items.length}
          </ThemedText>
        </View>
      </View>

      {items.length === 0 ? (
        <View
          style={[
            styles.sectionEmpty,
            { backgroundColor: c.surfaceAlt, borderColor: c.border },
          ]}
        >
          <ThemedText style={[styles.sectionEmptyText, { color: c.textMuted }]}>
            {emptyHint}
          </ThemedText>
        </View>
      ) : (
        <View
          style={[
            styles.sectionList,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {items.map((plane, i) => (
            <PlaneRow
              key={plane.id}
              plane={plane}
              isLast={i === items.length - 1}
              onPress={() => onOpen(plane)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function PlaneRow({
  plane,
  isLast,
  onPress,
}: {
  plane: SentPlane;
  isLast: boolean;
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const filterLabel = (() => {
    if (!plane.filters) return null;
    const parts: string[] = [];
    if (plane.filters.country) parts.push(plane.filters.country);
    if (plane.filters.radiusKm) parts.push(`${plane.filters.radiusKm}km`);
    if (plane.filters.ageRange) {
      const [a, b] = plane.filters.ageRange;
      parts.push(`${a}–${b}`);
    }
    return parts.join(' · ');
  })();

  return (
    <SwipeSafePressable
      onPress={onPress}
      style={[
        styles.row,
        !isLast && {
          borderBottomColor: c.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      {/* Recipient avatar — the system always pairs the plane with a
          real user, so we always have someone to show. */}
      <Avatar
        name={plane.recipient?.name ?? plane.recipientName ?? '?'}
        uri={plane.recipient?.avatarUrl}
        size={40}
      />

      <View style={styles.rowText}>
        {/* Per-row status label intentionally removed — the section
            header already calls out Accepted vs On air, so repeating
            it on every row is just noise. We keep only the recipient +
            send time on top. */}
        <View style={styles.rowTop}>
          <ThemedText
            style={styles.rowRecipient}
            numberOfLines={1}
          >
            {plane.recipientName
              ? `To ${plane.recipientName}`
              : 'Looking for a recipient…'}
          </ThemedText>
          <ThemedText style={[styles.rowTime, { color: c.textMuted }]}>
            {timeAgo(plane.sentAt)}
          </ThemedText>
        </View>

        <ThemedText style={styles.rowMessage} numberOfLines={3}>
          {plane.message}
        </ThemedText>

        {filterLabel ? (
          <ThemedText style={[styles.rowMeta, { color: c.textMuted }]}>
            {filterLabel}
          </ThemedText>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
    </SwipeSafePressable>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: { fontSize: 20, fontWeight: '700' },

  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },

  section: { gap: Spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: Spacing.xs,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    flex: 1,
  },
  sectionCount: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  sectionCountText: { fontSize: 11, fontWeight: '700' },
  sectionEmpty: {
    padding: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  sectionEmptyText: { fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  sectionList: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
  },
  rowText: { flex: 1, gap: 4 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowRecipient: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  rowTime: { fontSize: 11, marginLeft: Spacing.sm },
  rowMessage: { fontSize: 14, lineHeight: 20 },
  rowMeta: { fontSize: 11, marginTop: 2 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.xl,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptySub: { fontSize: 14, textAlign: 'center' },
});
