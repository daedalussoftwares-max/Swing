/**
 * Notifications screen — opened by tapping the bell on the home header.
 *
 * Lists every event that ever happened to the user (plane accepts,
 * incoming planes, reactions, friend events, system messages).
 * Mocked for MVP; the data model matches what Firestore would emit so
 * swapping the source is the only change needed later.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useNotifications } from '@/lib/notifications-context';
import type { Notification, NotificationKind } from '@/types/notification';

export default function NotificationsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { notifications, markRead, markAllRead, dismiss, clearAll } =
    useNotifications();

  // Mark everything as read once the user lands here, mirroring how
  // Instagram clears the activity badge as soon as you open it.
  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  const handleOpen = (n: Notification) => {
    markRead(n.id);
    if (n.deepLink) {
      router.push(n.deepLink as Parameters<typeof router.push>[0]);
    }
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
        <ThemedText style={styles.title}>Activity</ThemedText>
        <Pressable
          onPress={() => clearAll()}
          hitSlop={12}
          disabled={notifications.length === 0}
        >
          <ThemedText
            style={[
              styles.clearText,
              { color: notifications.length === 0 ? c.textSubtle : c.tint },
            ]}
          >
            Clear all
          </ThemedText>
        </Pressable>
      </View>

      {notifications.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
            <Ionicons name="notifications-off-outline" size={32} color={c.textMuted} />
          </View>
          <ThemedText style={styles.emptyTitle}>Nothing yet</ThemedText>
          <ThemedText style={[styles.emptySub, { color: c.textMuted }]}>
            Activity from your planes and chats will show up here.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => n.id}
          renderItem={({ item }) => (
            <NotificationRow
              notification={item}
              onPress={() => handleOpen(item)}
              onDismiss={() => dismiss(item.id)}
            />
          )}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: c.border }]} />
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function NotificationRow({
  notification,
  onPress,
  onDismiss,
}: {
  notification: Notification;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { icon, tint } = iconFor(notification.kind, c);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? c.surfaceAlt : 'transparent' },
        !notification.read && { backgroundColor: c.tintMuted + '20' },
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: tint + '22', borderColor: tint + '55' },
        ]}
      >
        <Ionicons name={icon} size={20} color={tint} />
      </View>

      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle} numberOfLines={2}>
          {notification.title}
        </ThemedText>
        {notification.body ? (
          <ThemedText
            style={[styles.rowBody, { color: c.textMuted }]}
            numberOfLines={2}
          >
            {notification.body}
          </ThemedText>
        ) : null}
        <ThemedText style={[styles.rowTime, { color: c.textSubtle }]}>
          {timeAgo(notification.createdAt)}
        </ThemedText>
      </View>

      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        style={({ pressed }) => [
          styles.dismiss,
          pressed && { opacity: 0.5 },
        ]}
      >
        <Ionicons name="close" size={18} color={c.textSubtle} />
      </Pressable>
    </Pressable>
  );
}

function iconFor(
  kind: NotificationKind,
  c: (typeof Colors)['light'],
): { icon: keyof typeof Ionicons.glyphMap; tint: string } {
  switch (kind) {
    case 'plane-received':
      return { icon: 'paper-plane-outline', tint: c.tint };
    case 'plane-accepted':
      return { icon: 'checkmark-circle-outline', tint: c.success };
    case 'plane-rejected':
      return { icon: 'close-circle-outline', tint: c.danger };
    case 'message':
      return { icon: 'chatbubble-outline', tint: c.tint };
    case 'reaction':
      return { icon: 'heart-outline', tint: c.danger };
    case 'friend-online':
      return { icon: 'sparkles-outline', tint: c.success };
    case 'system':
      return { icon: 'information-circle-outline', tint: c.textMuted };
  }
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
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  clearText: { fontSize: 14, fontWeight: '600' },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radii.lg,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowBody: { fontSize: 13 },
  rowTime: { fontSize: 11, marginTop: 2 },
  dismiss: { paddingTop: 2 },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
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
