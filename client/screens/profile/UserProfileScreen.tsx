/**
 * Public profile screen for another user (a sender of a plane, or a chat
 * partner). Opens from an avatar tap on the home card or in the chat
 * header.
 *
 * Data is hard-coded via `findSenderById`; once Firestore is wired up
 * this becomes a `doc(users, uid)` read.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { Image } from '@/lib/native/image';
import { useLocalSearchParams, useRouter } from '@/lib/router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getInitials } from '@/lib/initials';
import { findSenderById } from '@/lib/mock-planes';

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  const user = userId ? findSenderById(userId) : undefined;

  if (!user) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <View style={styles.notFound}>
          <ThemedText style={styles.notFoundText}>User not found.</ThemedText>
          <Pressable onPress={() => router.back()}>
            <ThemedText style={{ color: c.tint, marginTop: Spacing.md }}>
              Go back
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
        <Pressable
          hitSlop={16}
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
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: large avatar + name + presence + meta */}
        <View style={styles.hero}>
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
            {user.onlineNow ? (
              <View
                style={[
                  styles.onlineDot,
                  { backgroundColor: c.success, borderColor: c.background },
                ]}
              />
            ) : null}
          </View>

          <ThemedText style={styles.name}>{user.name}</ThemedText>
          <ThemedText style={[styles.subname, { color: c.textMuted }]}>
            {user.ageBadge} · {user.city ?? '—'}
            {user.country ? `, ${user.country}` : ''}
          </ThemedText>

          {user.onlineNow ? (
            <View style={styles.presenceRow}>
              <View style={[styles.miniDot, { backgroundColor: c.success }]} />
              <ThemedText style={[styles.presenceText, { color: c.success }]}>
                Online now
              </ThemedText>
            </View>
          ) : user.lastSeenAt ? (
            <ThemedText style={[styles.presenceText, { color: c.textMuted }]}>
              Last seen {timeAgo(user.lastSeenAt)}
            </ThemedText>
          ) : null}
        </View>

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
        {user.interests && user.interests.length > 0 ? (
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
              icon="location-outline"
              value={`${user.distanceKm} km`}
              label="away"
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
