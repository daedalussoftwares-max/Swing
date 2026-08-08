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
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ChatActionMenu } from '@/components/chat-action-menu';
import { SwipeSafePressable } from '@/components/swipe-safe-pressable';
import { TabNavHeader } from '@/components/tab-nav-header';
import { TabSwipeRegion } from '@/components/tab-swipe-region';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabFocusFade } from '@/hooks/use-tab-focus-fade';
import { useChats } from '@/lib/chats-context';
import { useUserSettings } from '@/lib/user-settings-context';
import type { Chat } from '@/types/chat';

export default function ChatsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { chats } = useChats();
  const { user } = useUserSettings();
  const fadeStyle = useTabFocusFade();

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
    await new Promise<void>((resolve) => setTimeout(resolve, 650));
    setRefreshing(false);
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
          <ThemedText style={styles.title}>Chats</ThemedText>
          <View style={[styles.pill, { backgroundColor: c.surfaceAlt }]}>
            <ThemedText style={[styles.pillText, { color: c.textMuted }]}>
              {chats.length}
            </ThemedText>
          </View>
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
      {chats.length === 0 ? (
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
        <FlatList
          style={styles.fill}
          data={visibleChats}
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
              onPress={() => {
                if (item.isBlocked) {
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Warning,
                  );
                  setActionChatId(item.id);
                  return;
                }
                router.push(`/chat/${item.id}`);
              }}
              onAvatarPress={() => {
                if (item.isBlocked) {
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Warning,
                  );
                  return;
                }
                Haptics.selectionAsync();
                if (item.partner.hasStatus) {
                  router.push(`/story/${item.partner.id}`);
                } else {
                  router.push(`/profile/${item.partner.id}`);
                }
              }}
              onLongPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setActionChatId(item.id);
              }}
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

function ChatRow({
  chat,
  onPress,
  onAvatarPress,
  onLongPress,
}: {
  chat: Chat;
  onPress: () => void;
  onAvatarPress: () => void;
  onLongPress: () => void;
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
  const preview = lastMessage && lastFromMe
    ? `You: ${previewBody}`
    : previewBody;
  const ts = lastMessage ? timeAgo(lastMessage.createdAt) : '';

  // Why two sibling Pressables instead of one wrapper?
  // The user wants the avatar circle to be a separate hit target so
  // tapping the status ring opens the story viewer (and a plain
  // avatar tap opens the partner's profile) without also opening the
  // chat. Two siblings = each touch target is unambiguous; long-press
  // is duplicated on both so the action menu still opens from
  // anywhere on the row.
  return (
    <View style={[styles.row, isBlocked && { opacity: 0.55 }]}>
      <SwipeSafePressable
        onPress={onAvatarPress}
        onLongPress={onLongPress}
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
        onPress={onPress}
        onLongPress={onLongPress}
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
            <ThemedText style={[styles.rowTime, { color: c.textMuted }]}>
              {ts}
            </ThemedText>
          </View>

          <View style={styles.rowBottom}>
            <ThemedText
              numberOfLines={1}
              style={[
                styles.rowPreview,
                {
                  color: chat.unreadCount > 0 && !isBlocked ? c.text : c.textMuted,
                  fontWeight: chat.unreadCount > 0 && !isBlocked ? '600' : '400',
                },
              ]}
            >
              {isBlocked
                ? 'Blocked'
                : chat.partnerTyping
                  ? 'typing…'
                  : preview}
            </ThemedText>
            {chat.unreadCount > 0 && !isBlocked ? (
              <View style={[styles.unreadBadge, { backgroundColor: c.tint }]}>
                <ThemedText style={styles.unreadBadgeText}>
                  {chat.unreadCount}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
      </SwipeSafePressable>
    </View>
  );
}

function timeAgo(iso: string): string {
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
