/**
 * Public profile of another user (plane sender, chat partner, outbox
 * recipient, notification deep link…).
 *
 * Renders instantly from whatever we already know (inbox cache / chat
 * partner) and then refreshes from GET /v1/users/{id}, so it works on a
 * cold start and for people we have no local data about.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { Image } from '@/lib/native/image';
import * as Haptics from '@/lib/native/haptics';
import { useLocalSearchParams, useRouter } from '@/lib/router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet, type ActionSheetItem } from '@/components/action-sheet';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type ApiPublicProfile, getUserProfile } from '@/lib/api/chats-api';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth-context';
import { getInitials } from '@/lib/initials';
import { useChatList, useChatsActions } from '@/lib/chats-context';
import { lookupSender } from '@/lib/planes-mapper';
import { useInboxPlanes } from '@/lib/inbox-planes-context';
import { withFlag } from '@/lib/countries';

type ViewModel = {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  bio?: string;
  interests: string[];
  age?: number;
  gender?: string;
  city?: string;
  country?: string;
  joinedAt?: string;
  lastActiveAt?: string;
  online: boolean;
  chatId?: string;
  blockedByMe: boolean;
};

const GENDER_LABEL: Record<string, string> = {
  M: 'Male',
  F: 'Female',
  NB: 'Non-binary',
  male: 'Male',
  female: 'Female',
  'non-binary': 'Non-binary',
};

function fromApi(p: ApiPublicProfile): ViewModel {
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    avatarUrl: p.avatarUrl,
    bio: p.bio,
    interests: p.interests ?? [],
    age: p.age,
    gender: p.gender,
    city: p.city,
    country: p.country,
    joinedAt: p.joinedAt,
    lastActiveAt: p.lastActiveAt,
    online: p.online,
    chatId: p.chatId,
    blockedByMe: p.blockedByMe,
  };
}

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const auth = useAuth();

  const { profileCache } = useInboxPlanes();
  const { setUserBlockedState } = useChatsActions();
  const chats = useChatList();
  const chat = userId ? chats.find((x) => x.partner.id === userId) : undefined;
  const cached = userId ? (lookupSender(profileCache, userId) ?? chat?.partner) : undefined;

  const [remote, setRemote] = useState<ViewModel | null>(null);
  const [error, setError] = useState<'not-found' | 'failed' | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = useCallback(async () => {
    if (!userId || auth.status !== 'signed-in') return;
    setError(null);
    try {
      setRemote(fromApi(await getUserProfile(userId)));
    } catch (e) {
      setError(e instanceof ApiError && e.httpStatus === 404 ? 'not-found' : 'failed');
    }
  }, [userId, auth.status]);

  useEffect(() => {
    void load();
  }, [load]);

  const fallback: ViewModel | null = cached
    ? {
        id: cached.id,
        name: cached.name,
        avatarUrl: cached.avatarUrl,
        bio: cached.bio,
        interests: cached.interests ?? [],
        city: cached.city,
        country: cached.country,
        joinedAt: cached.joinedAt,
        lastActiveAt: cached.lastSeenAt,
        online: !!cached.onlineNow,
        chatId: chat?.id,
        blockedByMe: !!chat?.isBlocked,
      }
    : null;
  const user = remote ?? fallback;
  // Live chat state (block toggles, presence) wins over the fetched copy.
  const blocked = chat ? !!chat.isBlocked : !!user?.blockedByMe;
  const online = !blocked && (chat ? !!chat.partner.onlineNow : !!user?.online);
  const chatId = chat?.id ?? user?.chatId;
  const isMe = !!userId && userId === auth.user?.id;

  if (!user) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <View style={styles.notFound}>
          {error ? (
            <>
              <ThemedText style={styles.notFoundText}>
                {error === 'not-found' ? 'User not found.' : "Couldn't load this profile."}
              </ThemedText>
              {error === 'failed' ? (
                <Pressable onPress={() => void load()}>
                  <ThemedText style={{ color: c.tint, marginTop: Spacing.md }}>
                    Try again
                  </ThemedText>
                </Pressable>
              ) : null}
              <Pressable onPress={() => router.back()}>
                <ThemedText style={{ color: c.textMuted, marginTop: Spacing.md }}>
                  Go back
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={c.tint} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const toggleBlock = () => {
    setShowMenu(false);
    if (blocked) {
      void setUserBlockedState(user.id, false)
        .then(() => setRemote((r) => (r ? { ...r, blockedByMe: false } : r)))
        .catch(() => {});
      return;
    }
    Alert.alert(
      `Block ${user.name}?`,
      "You won't receive their messages or planes, and they won't see when you're online. They won't be notified.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            void setUserBlockedState(user.id, true)
              .then(() => setRemote((r) => (r ? { ...r, blockedByMe: true, online: false } : r)))
              .catch(() => {});
          },
        },
      ],
    );
  };

  const menuItems: ActionSheetItem[] = [
    {
      id: 'block',
      icon: blocked ? 'lock-open-outline' : 'ban-outline',
      label: blocked ? `Unblock ${user.name}` : `Block ${user.name}`,
      destructive: !blocked,
      onPress: toggleBlock,
    },
    {
      id: 'report',
      icon: 'flag-outline',
      label: 'Report',
      onPress: () => {
        setShowMenu(false);
        setReporting(true);
      },
    },
  ];

  const meta = [
    user.age != null ? String(user.age) : null,
    user.gender ? (GENDER_LABEL[user.gender] ?? user.gender) : null,
    [user.city, user.country ? withFlag(user.country) : null].filter(Boolean).join(', ') || null,
  ].filter(Boolean);

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Top bar — back + overflow menu. Lives in the normal flex flow
          (NOT position-absolute) so iOS hit-testing routes taps straight
          to the buttons instead of letting them fall through to the
          ScrollView underneath. */}
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={16}
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: c.surfaceAlt,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={22} color={c.text} />
        </Pressable>
        {!isMe ? (
          <Pressable
            hitSlop={16}
            onPress={() => setShowMenu(true)}
            style={({ pressed }) => [
              styles.moreButton,
              {
                backgroundColor: c.surfaceAlt,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={c.text} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: large avatar + name + presence + meta */}
        <Animated.View entering={FadeIn.duration(220)} style={styles.hero}>
          <View
            style={[
              styles.bigAvatar,
              { backgroundColor: c.tintMuted, borderColor: c.surface },
            ]}
          >
            {user.avatarUrl ? (
              <Image
                source={{ uri: user.avatarUrl }}
                style={styles.bigAvatarImage}
                contentFit="cover"
              />
            ) : (
              <ThemedText
                style={[styles.bigAvatarInitial, { color: c.tintPressed }]}
                allowFontScaling={false}
              >
                {getInitials(user.name)}
              </ThemedText>
            )}
            {online ? (
              <View
                style={[
                  styles.onlineDot,
                  { backgroundColor: c.success, borderColor: c.background },
                ]}
              />
            ) : null}
          </View>

          <ThemedText style={styles.name}>{user.name}</ThemedText>
          {user.username ? (
            <ThemedText style={[styles.subname, { color: c.textMuted }]}>
              @{user.username}
            </ThemedText>
          ) : null}
          {meta.length > 0 ? (
            <ThemedText style={[styles.subname, { color: c.textMuted }]}>
              {meta.join(' · ')}
            </ThemedText>
          ) : null}

          {blocked ? (
            <View style={styles.presenceRow}>
              <Ionicons name="ban-outline" size={13} color={c.danger} />
              <ThemedText style={[styles.presenceText, { color: c.danger }]}>
                Blocked
              </ThemedText>
            </View>
          ) : online ? (
            <View style={styles.presenceRow}>
              <View style={[styles.miniDot, { backgroundColor: c.success }]} />
              <ThemedText style={[styles.presenceText, { color: c.success }]}>
                Online now
              </ThemedText>
            </View>
          ) : user.lastActiveAt ? (
            <ThemedText style={[styles.presenceText, { color: c.textMuted }]}>
              Active {timeAgo(user.lastActiveAt)}
            </ThemedText>
          ) : null}

          {!isMe && chatId && !blocked ? (
            <Pressable
              onPress={() => router.push(`/chat/${chatId}`)}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: c.tint, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="chatbubble-ellipses" size={18} color="#fff" />
              <ThemedText style={styles.primaryButtonText}>Message</ThemedText>
            </Pressable>
          ) : !isMe && blocked ? (
            <Pressable
              onPress={toggleBlock}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: c.tint, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <ThemedText style={[styles.secondaryButtonText, { color: c.tint }]}>
                Unblock
              </ThemedText>
            </Pressable>
          ) : null}
        </Animated.View>

        {/* Bio */}
        {user.bio ? (
          <View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <ThemedText style={[styles.cardTitle, { color: c.textMuted }]}>
              About
            </ThemedText>
            <ThemedText style={styles.bio}>{user.bio}</ThemedText>
          </View>
        ) : null}

        {/* Interests */}
        {user.interests.length > 0 ? (
          <View
            style={[
              styles.card,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <ThemedText style={[styles.cardTitle, { color: c.textMuted }]}>
              Interests
            </ThemedText>
            <View style={styles.tagsRow}>
              {user.interests.map((interest) => (
                <View
                  key={interest}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: c.tintMuted,
                      borderColor: c.borderStrong,
                    },
                  ]}
                >
                  <ThemedText
                    style={[styles.tagText, { color: c.tintPressed }]}
                  >
                    {interest}
                  </ThemedText>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Stats */}
        <View
          style={[
            styles.card,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          <View style={styles.statsRow}>
            <Stat
              icon="sparkles-outline"
              value={String(user.interests.length)}
              label="interests"
              color={c.tint}
              labelColor={c.textMuted}
            />
            <View style={[styles.statDivider, { backgroundColor: c.border }]} />
            <Stat
              icon="calendar-outline"
              value={user.joinedAt ? joinedAgo(user.joinedAt) : '—'}
              label="on Swing"
              color={c.tint}
              labelColor={c.textMuted}
            />
          </View>
        </View>

        {/* Footer hint */}
        <View style={styles.footerHint}>
          <Ionicons name="shield-checkmark-outline" size={16} color={c.textSubtle} />
          <ThemedText style={[styles.footerHintText, { color: c.textSubtle }]}>
            Be kind. Swing has zero tolerance for harassment.
          </ThemedText>
        </View>
      </ScrollView>

      <ActionSheet
        visible={showMenu}
        items={menuItems}
        onClose={() => setShowMenu(false)}
      />
      <ReportSheet
        visible={reporting}
        userId={user.id}
        userName={user.name}
        chatId={chatId}
        onClose={() => setReporting(false)}
        onReported={(didBlock) => {
          if (didBlock) {
            setRemote((r) => (r ? { ...r, blockedByMe: true, online: false } : r));
          }
        }}
      />
    </SafeAreaView>
  );
}

function Stat({
  icon,
  value,
  label,
  color,
  labelColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  color: string;
  labelColor: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={20} color={color} />
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText style={[styles.statLabel, { color: labelColor }]}>
        {label}
      </ThemedText>
    </View>
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
  return `${days}d ago`;
}

function joinedAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  return `${years}y`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['3xl'],
    gap: Spacing.lg,
  },
  hero: {
    alignItems: 'center',
    paddingTop: Spacing.lg,
    gap: 4,
  },
  bigAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    marginBottom: Spacing.md,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  bigAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 56,
  },
  bigAvatarInitial: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '700',
    includeFontPadding: false,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
  },
  name: {
    fontSize: 26,
    fontWeight: '700',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 12,
    borderRadius: Radii.pill,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 10,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  secondaryButtonText: { fontSize: 15, fontWeight: '600' },
  subname: {
    fontSize: 14,
    marginTop: 2,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.xs,
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  presenceText: {
    fontSize: 13,
    fontWeight: '500',
  },
  card: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  bio: {
    fontSize: 15,
    lineHeight: 22,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: 4,
  },
  tag: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
  },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  footerHintText: {
    fontSize: 12,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    fontSize: 16,
  },
});
