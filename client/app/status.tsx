/**
 * Full-screen status page (Insta / WhatsApp story-style).
 *
 * Slides:
 *   - Existing posted items (read from `user.statusItems`)
 *   - Plus any "draft" items the user has picked but hasn't uploaded
 *   The two lists are concatenated into one swipeable horizontal pager
 *   so the user can flick between EVERY status slide — already-posted
 *   AND not-yet-uploaded.
 *
 * Bottom bar:
 *   - "+" pill on the left  → opens the gallery to add another draft
 *   - 🗑 in the middle      → deletes the currently-visible slide; if
 *                            it's a draft we just drop it locally, if
 *                            it's an already-posted slide we remove it
 *                            from the saved list
 *   - "Upload" on the right → commits ALL pending drafts to the user
 *                            profile and pops the screen
 *
 * Empty state (no posted items AND no drafts):
 *   - Big "+" sign centred with helper copy. Tapping it opens the
 *     gallery and seeds the first draft.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import { Image } from '@/lib/native/image';
import * as ImagePicker from '@/lib/native/image-picker';
import { useFocusEffect, useRouter } from '@/lib/router';
import { useVideoPlayer, VideoView } from '@/lib/native/video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockingLoader } from '@/components/blocking-loader';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteStatusItem, listMyStatus } from '@/lib/api/media-api';
import { humanizeAuthError, useAuth } from '@/lib/auth-context';
import { readTokens } from '@/lib/api/token-storage';
import { apiStatusToLocal } from '@/lib/status-from-api';
import { uploadStatusDraft } from '@/lib/upload-media';
import {
  type StatusDraft,
  type StatusItem,
  useUserSettings,
} from '@/lib/user-settings-context';

type MediaKind = 'image' | 'video';

type SlideItem = {
  uri: string;
  kind: MediaKind;
  /** Posted-at ISO if this slide is already live; undefined for drafts. */
  postedAt?: string;
  /** Local-only flag so we can render a "Draft" pill + know which
   *  storage to mutate on remove. */
  draft: boolean;
};

export default function StatusScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const auth = useAuth();
  const { user, updateUser } = useUserSettings();
  const [uploading, setUploading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (auth.status !== 'signed-in') return;
      (async () => {
        try {
          const { accessToken } = await readTokens();
          if (!accessToken) return;
          const items = await listMyStatus(accessToken);
          updateUser({ statusItems: items.map(apiStatusToLocal) });
        } catch {
          /* keep local cache */
        }
      })();
    }, [auth.status, updateUser]),
  );

  // Drafts live on the user object (context) — that way picking an
  // image, navigating to another tab, and coming back still shows the
  // drafts. Posted items also come from user object.
  const posted = useMemo(() => user.statusItems ?? [], [user.statusItems]);
  const drafts = useMemo(() => user.statusDrafts ?? [], [user.statusDrafts]);
  const setDrafts = useCallback(
    (updater: (prev: StatusDraft[]) => StatusDraft[]) => {
      updateUser({ statusDrafts: updater(user.statusDrafts ?? []) });
    },
    [updateUser, user.statusDrafts],
  );

  const [picking, setPicking] = useState(false);
  // When the screen first opens we land on the first draft (if any) —
  // the user came back specifically to see / extend their drafts, so
  // jumping past already-posted slides feels right.
  const [activeIndex, setActiveIndex] = useState(() =>
    (user.statusDrafts?.length ?? 0) > 0 ? (user.statusItems?.length ?? 0) : 0,
  );
  const listRef = useRef<FlatList<SlideItem>>(null);
  const { width } = useWindowDimensions();

  // After the FlatList mounts, sync its scroll position with the
  // initial activeIndex so the user actually lands on the first draft.
  useEffect(() => {
    if (activeIndex > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({
          index: activeIndex,
          animated: false,
        });
      });
    }
    // Run once on mount — subsequent index changes are driven by the
    // user's own swipes / pickers and don't need this re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slides = useMemo<SlideItem[]>(
    () => [
      ...posted.map((s) => ({
        uri: s.uri,
        kind: s.kind,
        postedAt: s.postedAt,
        draft: false,
      })),
      ...drafts.map((d) => ({ uri: d.uri, kind: d.kind, draft: true })),
    ],
    [posted, drafts],
  );

  const hasDrafts = drafts.length > 0;
  const hasAny = slides.length > 0;
  const current = slides[activeIndex];

  const launchPicker = async () => {
    Haptics.selectionAsync();
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          'Allow access to your library to add a status.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.85,
        videoMaxDuration: 30,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const newDraft = {
        uri: asset.uri,
        kind: asset.type === 'video' ? ('video' as const) : ('image' as const),
      };
      setDrafts((d) => [...d, newDraft]);
      // Jump the pager to the freshly-added draft so the user sees
      // their pick — much less confusing than landing on slide 0.
      const newIndex = slides.length; // slides hasn't re-rendered yet
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index: newIndex, animated: true });
        setActiveIndex(newIndex);
      });
    } finally {
      setPicking(false);
    }
  };

  const removeCurrent = () => {
    if (!current) return;
    const performRemove = async () => {
      if (current.draft) {
        // Compute the draft's position inside the drafts array.
        const draftOffset = activeIndex - posted.length;
        setDrafts((arr) => arr.filter((_, i) => i !== draftOffset));
      } else {
        const target = posted[activeIndex];
        if (target?.id && auth.status === 'signed-in') {
          try {
            const { accessToken } = await readTokens();
            if (accessToken) {
              await deleteStatusItem(accessToken, target.id);
            }
          } catch (e) {
            Alert.alert(
              'Could not remove',
              humanizeAuthError(e, 'Something went wrong. Try again.'),
            );
            return;
          }
        }
        updateUser({
          statusItems: posted.filter((_, i) => i !== activeIndex),
        });
      }
      // After removal, snap to the previous slide if any.
      const nextIndex = Math.max(0, activeIndex - 1);
      requestAnimationFrame(() => {
        if (slides.length - 1 > 0) {
          listRef.current?.scrollToIndex({ index: nextIndex, animated: false });
        }
        setActiveIndex(nextIndex);
      });
      Haptics.selectionAsync();
    };

    Alert.alert(
      current.draft ? 'Discard draft?' : 'Remove status?',
      current.draft
        ? 'This draft will not be uploaded.'
        : 'Your friends won\u2019t see this anymore.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: current.draft ? 'Discard' : 'Remove',
          style: 'destructive',
          onPress: performRemove,
        },
      ],
    );
  };

  const handleUpload = async () => {
    if (!hasDrafts) return;

    if (auth.status !== 'signed-in') {
      const now = new Date().toISOString();
      const newItems: StatusItem[] = drafts.map((d) => ({
        uri: d.uri,
        kind: d.kind,
        postedAt: now,
      }));
      updateUser({
        statusItems: [...posted, ...newItems],
        statusDrafts: [],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      return;
    }

    setUploading(true);
    try {
      const { accessToken } = await readTokens();
      if (!accessToken) throw new Error('no token');
      const uploaded: StatusItem[] = [];
      for (const d of drafts) {
        const item = await uploadStatusDraft(accessToken, d.uri, d.kind);
        uploaded.push(apiStatusToLocal(item));
      }
      updateUser({
        statusItems: [...posted, ...uploaded],
        statusDrafts: [],
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Alert.alert(
        'Could not upload',
        humanizeAuthError(e, 'Something went wrong. Try again.'),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setUploading(false);
    }
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== activeIndex) setActiveIndex(i);
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <ThemedText style={styles.title}>Your status</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      {/* Canvas — pager OR empty state */}
      {hasAny ? (
        <View style={styles.canvas}>
          {/* Progress segments — one per slide, current is highlighted. */}
          <View style={styles.progressRow}>
            {slides.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressSeg,
                  {
                    backgroundColor:
                      i === activeIndex ? c.tint : c.borderStrong,
                  },
                ]}
              />
            ))}
          </View>

          <FlatList
            ref={listRef}
            data={slides}
            keyExtractor={(s, i) => `${s.uri}-${i}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumScrollEnd}
            renderItem={({ item }) => (
              <Slide item={item} width={width} />
            )}
            getItemLayout={(_, i) => ({
              length: width,
              offset: width * i,
              index: i,
            })}
            decelerationRate="fast"
          />

          {/* Counter overlay (n/m) so the user knows where they are */}
          {slides.length > 1 ? (
            <View
              style={[
                styles.counter,
                { backgroundColor: 'rgba(0,0,0,0.55)' },
              ]}
              pointerEvents="none"
            >
              <ThemedText style={styles.counterText}>
                {activeIndex + 1} / {slides.length}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.canvas}>
          <Pressable
            onPress={launchPicker}
            disabled={picking}
            style={({ pressed }) => [
              styles.empty,
              { backgroundColor: c.surfaceAlt, borderColor: c.border },
              pressed && { opacity: 0.85 },
            ]}
          >
            {picking ? (
              <ActivityIndicator color={c.tint} size="large" />
            ) : (
              <>
                <View style={[styles.bigPlus, { backgroundColor: c.tint }]}>
                  <Ionicons name="add" size={56} color="#fff" />
                </View>
                <ThemedText style={styles.emptyTitle}>
                  Add photos / videos for status
                </ThemedText>
                <ThemedText style={[styles.emptySub, { color: c.textMuted }]}>
                  Tap the + to open your gallery. Stays up for 24 hours.
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>
      )}

      {/* Bottom action bar — visible the moment there's anything at all */}
      {hasAny ? (
        <View style={styles.bottomBar}>
          <Pressable
            onPress={launchPicker}
            disabled={picking}
            style={({ pressed }) => [
              styles.smallPlus,
              { backgroundColor: c.surfaceAlt, borderColor: c.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            {picking ? (
              <ActivityIndicator color={c.tint} />
            ) : (
              <Ionicons name="add" size={22} color={c.tint} />
            )}
          </Pressable>

          <Pressable
            onPress={removeCurrent}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: c.surfaceAlt, borderColor: c.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="trash-outline" size={20} color={c.danger} />
          </Pressable>

          <View style={{ flex: 1 }} />

          <Pressable
            onPress={() => void handleUpload()}
            disabled={!hasDrafts || uploading}
            style={({ pressed }) => [
              styles.uploadBtn,
              {
                backgroundColor: hasDrafts ? c.tint : c.borderStrong,
                opacity: pressed && hasDrafts ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <ThemedText style={styles.uploadBtnText}>
              {hasDrafts
                ? `Upload${drafts.length > 1 ? ` (${drafts.length})` : ''}`
                : 'Uploaded'}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <BlockingLoader visible={uploading} message="Uploading status…" />
    </SafeAreaView>
  );
}

// ── A single slide ─────────────────────────────────────────────────────────

function Slide({ item, width }: { item: SlideItem; width: number }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Each slide is exactly one screen wide so the FlatList `pagingEnabled`
  // snaps cleanly. The actual media is padded inside so it looks like a
  // floating card.
  return (
    <View
      style={[
        styles.slide,
        {
          width,
          paddingHorizontal: Spacing.lg,
        },
      ]}
    >
      <View
        style={[
          styles.previewFrame,
          { borderColor: c.border },
        ]}
      >
        {item.kind === 'video' ? (
          <SlideVideo uri={item.uri} />
        ) : (
          <Image
            source={{ uri: item.uri }}
            style={styles.previewMedia}
            contentFit="cover"
          />
        )}

        {item.draft ? (
          <View style={[styles.badge, { backgroundColor: c.warning }]}>
            <ThemedText style={styles.badgeDark}>Draft</ThemedText>
          </View>
        ) : item.postedAt ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
            <Ionicons name="time-outline" size={12} color="#fff" />
            <ThemedText style={styles.badgeLight}>
              {niceTime(item.postedAt)}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SlideVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.previewMedia}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function niceTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleString();
}

// ── styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
  },

  canvas: {
    flex: 1,
    paddingBottom: Spacing.md,
  },

  // Top progress bar — one segment per slide.
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: Spacing.lg + 4,
    marginBottom: Spacing.sm,
  },
  progressSeg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },

  // Empty state — fills the canvas with a big + and instructional copy.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    borderRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    padding: Spacing.xl,
    margin: Spacing.lg,
  },
  bigPlus: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },

  // Slide container in the pager.
  slide: {
    flex: 1,
    paddingVertical: 0,
  },
  previewFrame: {
    flex: 1,
    borderRadius: Radii.xl,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewMedia: { width: '100%', height: '100%' },

  // Badge — top-left chip on each slide
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  badgeLight: { color: '#fff', fontSize: 11, fontWeight: '500' },
  badgeDark: { color: '#000', fontSize: 11, fontWeight: '700' },

  // n/m counter top-right
  counter: {
    position: 'absolute',
    top: 12,
    right: Spacing.lg + 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  counterText: { color: '#fff', fontSize: 11, fontWeight: '600' },

  // Bottom action bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
  },
  smallPlus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    height: 44,
    borderRadius: 22,
  },
  uploadBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
