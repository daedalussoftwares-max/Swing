/**
 * Chats tab — list of all accepted plane-conversations.
 *
 * Empty state shows the same placeholder as before. Once at least one
 * plane has been accepted, this turns into a WhatsApp / Instagram-style
 * list with avatar, name, latest message preview, time, unread dot.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import { useRouter } from '@/lib/router';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ChatActionMenu } from '@/components/chat-action-menu';
import { ChatListSkeleton } from '@/components/chat-list-skeleton';
import { SwipeSafePressable } from '@/components/swipe-safe-pressable';
import { TabNavHeader } from '@/components/tab-nav-header';
import { TabSwipeRegion } from '@/components/tab-swipe-region';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRealtimeConnected } from '@/hooks/use-realtime-connected';
import { useRefreshOnFocus } from '@/hooks/use-refresh-on-focus';
import { useTabFocusFade } from '@/hooks/use-tab-focus-fade';
import { useChats } from '@/lib/chats-context';
import { useUserSettings } from '@/lib/user-settings-context';
import type { Chat } from '@/types/chat';

export default function ChatsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { chats, refresh: refreshChats, loaded } = useChats();
  const connected = useRealtimeConnected();
  const { user } = useUserSettings();
  const fadeStyle = useTabFocusFade();

  useRefreshOnFocus(refreshChats);

  // Story entry — pushes the full-screen `/status` route where the
  // user can add or edit their status.
  const openStatusScreen = () => {
    Haptics.selectionAsync();
    router.push('/status');
  };

  // Long-press target for the chat-action sheet. `null` hides the sheet.
  const [actionChatId, setActionChatId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // WhatsApp-style search bar — filters by partner name OR message text.
  const [query, setQuery] = useState('');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await refreshChats();
    } finally {
      setRefreshing(false);
    }
  }, [refreshChats]);

  const openChat = useCallback(
    (chat: Chat) => {
      router.push(`/chat/${chat.id}`);
    },
    [router],
  );

  const openPartner = useCallback(
    (chat: Chat) => {
      Haptics.selectionAsync();
      if (!chat.isBlocked && chat.partner.hasStatus) {
        router.push(`/story/${chat.partner.id}`);
      } else {
        router.push(`/profile/${chat.partner.id}`);
      }
    },
    [router],
  );

  const openActions = useCallback((chat: Chat) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionChatId(chat.id);
  }, []);

  // Sort: pinned chats first (newest pin on top), then by last-message
  // freshness. Memoised so the FlatList doesn't re-sort every render.
  const sortedChats = useMemo(() => {
    const lastMsgTs = (chat: Chat) => {
      const m = chat.messages[chat.messages.length - 1];
      return m ? new Date(m.createdAt).getTime() : new Date(chat.createdAt).getTime();
    };
    return [...chats].sort((a, b) => {
      if (a.pinnedAt && !b.pinnedAt) return -1;
      if (!a.pinnedAt && b.pinnedAt) return 1;
      if (a.pinnedAt && b.pinnedAt) {
        return new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime();
      }
      return lastMsgTs(b) - lastMsgTs(a);
    });
  }, [chats]);

  // Filter on `query` — match against partner name OR any non-deleted
  // message text. Case-insensitive, trimmed.
  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedChats;
    return sortedChats.filter((chat) => {
      if (chat.partner.name.toLowerCase().includes(q)) return true;
      return chat.messages.some(
        (m) =>
          m.kind === 'text' &&
          !m.deletedAt &&
          m.text.toLowerCase().includes(q),
      );
    });
  }, [sortedChats, query]);

  // NOTE: we no longer short-circuit on `chats.length === 0` here — we
  // still want to render the header (and its status-upload + button) on
  // the empty state. The body switches to a placeholder instead.

  const chatsHeader = (
    <Animated.View style={fadeStyle}>
      <TabNavHeader route="/chats">
        <View style={styles.titleRow}>
          <ThemedText style={styles.title}>
            {!connected && loaded ? 'Connecting…' : 'Chats'}
          </ThemedText>
          {connected || !loaded ? (
            <View style={[styles.pill, { backgroundColor: c.surfaceAlt }]}>
              <ThemedText style={[styles.pillText, { color: c.textMuted }]}>
                {chats.length}
              </ThemedText>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={openStatusScreen}
          hitSlop={10}
          style={({ pressed }) => [
            styles.storyBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Avatar
            name={user.name}
            uri={user.avatarUri}
            size={36}
            hasStatus={(user.statusItems?.length ?? 0) > 0}
          />
          <View
            style={[
              styles.storyPlus,
              {
                backgroundColor: c.tint,
                borderColor: c.background,
              },
            ]}
          >
            <Ionicons name="add" size={12} color="#fff" />
          </View>
        </Pressable>
      </TabNavHeader>
    </Animated.View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <TabSwipeRegion
        currentRoute="/chats"
        style={styles.fill}
        withNativeScroll
      >
      {!loaded && chats.length === 0 ? (
        <ScrollView style={styles.fill} scrollEnabled={false}>
          {chatsHeader}
          <ChatListSkeleton />
        </ScrollView>
      ) : chats.length === 0 ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.emptyScroll}
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
          {chatsHeader}
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
              <Ionicons
                name="chatbubble-outline"
                size={32}
                color={c.tint}
              />
            </View>
            <ThemedText style={styles.emptyTitle}>No chats yet</ThemedText>
            <ThemedText
              style={[styles.emptySub, { color: c.textMuted }]}
            >
              Once you accept a paper plane, your conversations will land
              here. In the meantime — share a status from the
              <ThemedText style={{ fontWeight: '700' }}> + </ThemedText>
              up top.
            </ThemedText>
          </View>
        </ScrollView>
      ) : (
        <Animated.FlatList
          style={styles.fill}
          data={visibleChats}
          itemLayoutAnimation={LinearTransition.duration(220)}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.tint}
              colors={[c.tint]}
            />
          }
          ListHeaderComponent={
            <>
              {chatsHeader}
              <Animated.View style={fadeStyle}>
                <View
                  style={[
                    styles.searchBox,
                    styles.searchBoxInList,
                    { backgroundColor: c.surfaceAlt, borderColor: c.border },
                  ]}
                >
                  <Ionicons name="search" size={16} color={c.textMuted} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search chats or messages"
                    placeholderTextColor={c.textSubtle}
                    style={[styles.searchInput, { color: c.text }]}
                    returnKeyType="search"
                    autoCorrect={false}
                    autoCapitalize="none"
                  />
                  {query.length > 0 ? (
                    <Pressable hitSlop={8} onPress={() => setQuery('')}>
                      <Ionicons
                        name="close-circle"
                        size={16}
                        color={c.textMuted}
                      />
                    </Pressable>
                  ) : null}
                </View>
              </Animated.View>
            </>
          }
          renderItem={({ item }) => (
            <ChatRow
              chat={item}
              onPress={openChat}
              onAvatarPress={openPartner}
              onLongPress={openActions}
            />
          )}
          ItemSeparatorComponent={() => (
            <View
              style={[styles.separator, { backgroundColor: c.border }]}
            />
          )}
          ListEmptyComponent={() => (
            <View style={styles.searchEmpty}>
              <Ionicons name="search-outline" size={28} color={c.textMuted} />
              <ThemedText style={styles.searchEmptyTitle}>No matches</ThemedText>
              <ThemedText
                style={[styles.searchEmptySub, { color: c.textMuted }]}
              >
                Try a different name or word.
              </ThemedText>
            </View>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
      </TabSwipeRegion>

      <ChatActionMenu
        chatId={actionChatId}
        visible={actionChatId !== null}
        onClose={() => setActionChatId(null)}
      />
    </SafeAreaView>
  );
}

const ChatRow = memo(function ChatRow({
  chat,
  onPress,
  onAvatarPress,
  onLongPress,
}: {
  chat: Chat;
  onPress: (chat: Chat) => void;
  onAvatarPress: (chat: Chat) => void;
  onLongPress: (chat: Chat) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const lastMessage = chat.messages[chat.messages.length - 1];
  const lastFromMe = lastMessage?.authorId === 'me';
  const isPinned = !!chat.pinnedAt;
  const isBlocked = !!chat.isBlocked;

  // Body for the preview line — falls back to icon-prefixed labels for
  // non-text messages. View-once labels signal the tombstone state so
  // recipients can tell at a glance what's waiting in the thread.
  let previewBody: string;
  if (!lastMessage) {
    previewBody = 'Say hi 👋';
  } else if (lastMessage.deletedAt) {
    previewBody = 'Unsent message';
  } else if (lastMessage.kind === 'image') {
    previewBody = lastMessage.viewOnce
      ? lastMessage.viewedAt
        ? '📷 Photo · Opened'
        : '📷 Photo · View once'
      : '📷 Photo';
  } else if (lastMessage.kind === 'audio') {
    previewBody = lastMessage.viewOnce
      ? lastMessage.viewedAt
        ? '🎤 Voice · Opened'
        : '🎤 Voice · Listen once'
      : '🎤 Voice message';
  } else {
    previewBody = lastMessage.text;
  }
  const preview = previewBody;
  const ts = formatListTime(lastMessage?.createdAt ?? chat.createdAt);
  const unread = chat.unreadCount > 0 && !isBlocked;
  const tick =
    lastMessage && lastFromMe && !lastMessage.deletedAt && !isBlocked
      ? lastMessage.status
      : null;

  // Why two sibling Pressables instead of one wrapper?
  // The user wants the avatar circle to be a separate hit target so
  // tapping the status ring opens the story viewer (and a plain
  // avatar tap opens the partner's profile) without also opening the
  // chat. Two siblings = each touch target is unambiguous; long-press
  // is duplicated on both so the action menu still opens from
  // anywhere on the row.
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      style={[styles.row, isBlocked && { opacity: 0.55 }]}
    >
      <SwipeSafePressable
        onPress={() => onAvatarPress(chat)}
        onLongPress={() => onLongPress(chat)}
        delayLongPress={320}
        style={styles.avatarHit}
      >
        <Avatar
          uri={chat.partner.avatarUrl}
          name={chat.partner.name}
          size={56}
          hasStatus={!isBlocked && chat.partner.hasStatus}
          online={!isBlocked && chat.partner.onlineNow}
        />
      </SwipeSafePressable>

      <SwipeSafePressable
        onPress={() => onPress(chat)}
        onLongPress={() => onLongPress(chat)}
        delayLongPress={320}
        style={styles.rowContent}
      >
        <View style={styles.rowText}>
          <View style={styles.rowTop}>
            <ThemedText style={styles.rowName} numberOfLines={1}>
              {chat.partner.name}
            </ThemedText>
            {isPinned ? (
              <Ionicons name="pin" size={14} color={c.textMuted} />
            ) : null}
            {isBlocked ? (
              <Ionicons name="ban-outline" size={14} color={c.danger} />
            ) : null}
            <ThemedText
              style={[styles.rowTime, { color: unread ? c.tint : c.textMuted }]}
            >
              {ts}
            </ThemedText>
          </View>

          <View style={styles.rowBottom}>
            {tick && !chat.partnerTyping ? (
              <Ionicons
                name={
                  tick === 'failed'
                    ? 'alert-circle'
                    : tick === 'sending'
                      ? 'time-outline'
                      : tick === 'sent'
                        ? 'checkmark'
                        : 'checkmark-done'
                }
                size={15}
                color={
                  tick === 'failed'
                    ? c.danger
                    : tick === 'seen'
                      ? '#3B82F6'
                      : c.textMuted
                }
              />
            ) : null}
            <ThemedText
              numberOfLines={1}
              style={[
                styles.rowPreview,
                {
                  color: chat.partnerTyping && !isBlocked
                    ? c.tint
                    : unread
                      ? c.text
                      : c.textMuted,
                  fontWeight: unread ? '600' : '400',
                },
              ]}
            >
              {isBlocked
                ? 'Blocked'
                : chat.partnerTyping
                  ? 'typing…'
                  : preview}
            </ThemedText>
            {unread ? (
              <View style={[styles.unreadBadge, { backgroundColor: c.tint }]}>
                <ThemedText style={styles.unreadBadgeText}>
                  {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
      </SwipeSafePressable>
    </Animated.View>
  );
});

/** WhatsApp-style list timestamp: 14:05 · Yesterday · Mon · 12/03/26 */
function formatListTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayMs = 24 * 3600 * 1000;
  if (d >= startOfToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getTime() >= startOfToday.getTime() - dayMs) return 'Yesterday';
  if (d.getTime() >= startOfToday.getTime() - 6 * dayMs) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  return `${days}d`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  storyBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyPlus: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchBoxInList: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  searchEmpty: {
    alignItems: 'center',
    paddingVertical: Spacing.xl * 2,
    gap: 6,
  },
  searchEmptyTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  searchEmptySub: { fontSize: 13 },

  // Full empty state (zero chats at all) — sits below the header so the
  // status uploader stays accessible.
  emptyScroll: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
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
  emptySub: { fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    flexGrow: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    // Full-width — extends across the avatar column too, so the divider
    // visually "covers till" the avatar circle (per user request).
  },
  // Outer wrapper — only handles layout & blocked-opacity. Press
  // feedback lives on the two inner Pressables.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
  },
  // Dedicated tap target around the avatar. We use vertical padding
  // (no horizontal) so the avatar still aligns with the content
  // column to its right.
  avatarHit: {
    paddingVertical: Spacing.md,
    paddingRight: Spacing.md,
  },
  // Everything to the right of the avatar — name, preview, chevron.
  // This is the "open chat" tap target.
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radii.lg,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  rowTime: {
    fontSize: 12,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowPreview: {
    flex: 1,
    fontSize: 14,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});
