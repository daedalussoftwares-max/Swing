/**
 * Outbox / Planes screen — every plane the local user has sent, with
 * live delivery status (patched in place by `plane.outbox.updated`).
 *
 * Reachable from:
 *   - The plane icon on the home header (next to the bell)
 *   - The "Planes" segment on the profile tab
 *
 * Buckets:
 *   1. In the air — flying (looking for someone, animated dots) or
 *      delivered to someone and waiting on them
 *   2. Accepted   — landed and started a chat
 *   3. Expired    — 24h passed without anyone accepting
 *
 * Each row shows "passed on N times" when recipients rejected it and it
 * flew on. Tapping a row opens plane-detail in read-only mode.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { describeSentFilters } from '@/components/plane-filter-model';
import { passedOnLabel, PlaneStatusPill } from '@/components/plane-status';
import { SwipeSafePressable } from '@/components/swipe-safe-pressable';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { LiveSentPlane } from '@/lib/planes-mapper';
import { useSentPlanes } from '@/lib/sent-planes-context';

export default function PlanesScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { sentPlanes, refresh } = useSentPlanes();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const buckets = useMemo(() => {
    const inAir: LiveSentPlane[] = [];
    const accepted: LiveSentPlane[] = [];
    const expired: LiveSentPlane[] = [];
    for (const p of sentPlanes) {
      if (p.status === 'accepted') accepted.push(p);
      else if (p.status === 'flying' || p.status === 'pending') inAir.push(p);
      else expired.push(p);
    }
    const newestFirst = (a: LiveSentPlane, b: LiveSentPlane) =>
      new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
    inAir.sort(newestFirst);
    accepted.sort(newestFirst);
    expired.sort(newestFirst);
    return { inAir, accepted, expired };
  }, [sentPlanes]);

  const openPlane = useCallback(
    (plane: LiveSentPlane) => {
      if (plane.optimistic) return;
      router.push({
        pathname: '/plane/[id]',
        params: { id: plane.id, readOnly: '1' },
      });
    },
    [router],
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <View style={styles.flex}>
          <ThemedText style={styles.title}>Your planes</ThemedText>
        </View>
      </View>

      {sentPlanes.length === 0 ? (
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.tint}
              colors={[c.tint]}
            />
          }
        >
          <Section
            title="In the air"
            tint={c.tint}
            icon="paper-plane"
            items={buckets.inAir}
            emptyHint="No planes in flight. Send another one."
            onOpen={openPlane}
          />
          <Section
            title="Accepted"
            tint={c.success}
            icon="checkmark-circle"
            items={buckets.accepted}
            emptyHint="No-one's accepted yet. Keep sending."
            onOpen={openPlane}
          />
          <Section
            title="Expired"
            tint={c.textSubtle}
            icon="time-outline"
            items={buckets.expired}
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
  items: LiveSentPlane[];
  emptyHint?: string;
  onOpen: (plane: LiveSentPlane) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (items.length === 0 && !emptyHint) return null;

  return (
    <Animated.View style={styles.section} layout={LinearTransition}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={15} color={tint} />
        <ThemedText style={[styles.sectionTitle, { color: tint }]}>
          {title}
        </ThemedText>
        <View style={[styles.sectionCount, { backgroundColor: tint + '22' }]}>
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
              onOpen={onOpen}
            />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

const PlaneRow = memo(function PlaneRow({
  plane,
  isLast,
  onOpen,
}: {
  plane: LiveSentPlane;
  isLast: boolean;
  onOpen: (plane: LiveSentPlane) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const filterLabel = describeSentFilters(plane.filters);
  const passed = passedOnLabel(plane);
  const recipientName = plane.recipient?.name ?? plane.recipientName;
  const showRecipient = !!recipientName && plane.status !== 'flying';

  return (
    <Animated.View entering={FadeIn.duration(220)}>
      <SwipeSafePressable
        onPress={() => onOpen(plane)}
        disabled={plane.optimistic}
        style={[
          styles.row,
          !isLast && {
            borderBottomColor: c.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {showRecipient ? (
          <Avatar name={recipientName ?? '?'} uri={plane.recipient?.avatarUrl} size={40} />
        ) : (
          <View style={[styles.flyingAvatar, { backgroundColor: c.tintMuted }]}>
            <Ionicons
              name={plane.status === 'expired' ? 'time-outline' : 'paper-plane'}
              size={18}
              color={plane.status === 'expired' ? c.textSubtle : c.tint}
            />
          </View>
        )}

        <View style={styles.rowText}>
          <View style={styles.rowTop}>
            <View style={styles.flex}>
              <PlaneStatusPill plane={plane} />
            </View>
            <ThemedText style={[styles.rowTime, { color: c.textMuted }]}>
              {plane.optimistic ? 'now' : timeAgo(plane.sentAt)}
            </ThemedText>
          </View>

          <ThemedText style={styles.rowMessage} numberOfLines={3}>
            {plane.message}
          </ThemedText>

          {filterLabel || passed ? (
            <View style={styles.metaRow}>
              {passed ? (
                <View style={styles.metaItem}>
                  <Ionicons name="return-up-forward" size={12} color={c.textMuted} />
                  <ThemedText style={[styles.rowMeta, { color: c.textMuted }]}>
                    {passed}
                  </ThemedText>
                </View>
              ) : null}
              {filterLabel ? (
                <View style={styles.metaItem}>
                  <Ionicons name="options-outline" size={12} color={c.textSubtle} />
                  <ThemedText
                    style={[styles.rowMeta, { color: c.textSubtle }]}
                    numberOfLines={1}
                  >
                    {filterLabel}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {!plane.optimistic ? (
          <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
        ) : null}
      </SwipeSafePressable>
    </Animated.View>
  );
});

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
  flex: { flex: 1 },
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
    gap: Spacing.xl,
  },

  section: { gap: Spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: Spacing.xs,
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
  flyingAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 6 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowTime: { fontSize: 11 },
  rowMessage: { fontSize: 14, lineHeight: 20 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  rowMeta: { fontSize: 11 },

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
