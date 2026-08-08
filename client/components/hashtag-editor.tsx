/**
 * Bottom-sheet style editor for tag lists ("interests", "vibes", etc.).
 *
 * UX:
 *   - Top row: search input + Add button. Typing filters the suggestion
 *     list; pressing Add commits whatever's in the field as a new tag.
 *   - Mid section: "Selected" chips with an X to remove.
 *   - Bottom section: suggestion chips (filtered by search). Tap to add.
 *
 * Stateless wrapper — the host owns the tag list. We only emit
 * `onChange(nextTags)` whenever something changes so the host can
 * decide when to persist.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useEffect, useState } from 'react';
import {
  AppState,
  Dimensions,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const SUGGESTED_TAGS = [
  'music',
  'movies',
  'books',
  'photography',
  'travel',
  'food',
  'art',
  'design',
  'tech',
  'gaming',
  'sports',
  'fitness',
  'coffee',
  'tea',
  'yoga',
  'meditation',
  'late-night walks',
  'sunrises',
  'sunsets',
  'philosophy',
  'writing',
  'jazz',
  'lo-fi',
  'indie',
  'dancing',
  'cooking',
  'hiking',
  'cycling',
  'startups',
  'crypto',
  'AI',
  'history',
];

type Props = {
  visible: boolean;
  /** Currently selected tags. Always normalised to lower-case. */
  tags: string[];
  /** Fires whenever the tag set changes — host owns persistence. */
  onChange: (next: string[]) => void;
  onClose: () => void;
  /** Optional cap. Defaults to 8. */
  max?: number;
};

const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/^#+/, '') // strip leading hashes
    .replace(/\s+/g, ' ');

export function HashtagEditor({
  visible,
  tags,
  onChange,
  onClose,
  max = 8,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [query, setQuery] = useState('');
  // Track the keyboard height manually instead of relying on
  // KeyboardAvoidingView. The latter was causing a visible "open big,
  // then shrink" pop when the modal mounted — the layout pass would
  // first include the full screen height, then re-measure with the
  // keyboard padding applied. Tracking it ourselves means the sheet
  // mounts at its final size from frame 1.
  const [kbHeight, setKbHeight] = useState(0);

  // Reset the search field every time the sheet is opened so the user
  // doesn't see stale text the moment it slides up — this was the
  // earlier "glitch" symptom.
  useEffect(() => {
    if (visible) setQuery('');
    else Keyboard.dismiss();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    // App-state guard: if the user backgrounds the app while the
    // keyboard is up, we won't always get a `keyboardWillHide` event
    // back. Reset manually so we don't reopen with a stale padding.
    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        Keyboard.dismiss();
        setKbHeight(0);
      }
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      appSub.remove();
    };
  }, [visible]);

  const screenH = Dimensions.get('window').height;
  // Cap the sheet to ~85% of the screen so the suggestion list scrolls
  // instead of pushing the modal up off-screen.
  const sheetMaxHeight = Math.round(screenH * 0.85);

  const trimmed = normalize(query);
  const isQueryValid = trimmed.length >= 2 && trimmed.length <= 24;
  const alreadyAdded = tags.includes(trimmed);
  const canCommit = isQueryValid && !alreadyAdded && tags.length < max;

  const suggestions = SUGGESTED_TAGS.filter((t) => {
    if (tags.includes(t)) return false;
    if (!trimmed) return true;
    return t.includes(trimmed);
  }).slice(0, 20);

  const addTag = (tag: string) => {
    const n = normalize(tag);
    if (!n || tags.includes(n) || tags.length >= max) return;
    onChange([...tags, n]);
    setQuery('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop sits absolutely behind everything so it doesn't fight
          the sheet's intrinsic height. */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* The wrap is pinned to the bottom and grows from there. We push
          it up by the live keyboard height — no jumpy re-layout pass. */}
      <View
        style={[styles.kbWrap, { paddingBottom: kbHeight }]}
        pointerEvents="box-none"
      >
        <View
          style={[styles.sheetWrap, { maxHeight: sheetMaxHeight }]}
          pointerEvents="box-none"
        >
          <SafeAreaView edges={kbHeight > 0 ? [] : ['bottom']}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                styles.sheet,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
                <View
                  style={[styles.handle, { backgroundColor: c.borderStrong }]}
                />

                {/* Header */}
                <View style={styles.headerRow}>
                  <ThemedText style={styles.title}>Edit tags</ThemedText>
                  <ThemedText
                    style={[styles.count, { color: c.textMuted }]}
                  >
                    {tags.length}/{max}
                  </ThemedText>
                </View>

                {/* Search + add */}
                <View
                  style={[
                    styles.searchBox,
                    { backgroundColor: c.surfaceAlt, borderColor: c.border },
                  ]}
                >
                  <Ionicons name="pricetag-outline" size={16} color={c.textMuted} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search or add a tag"
                    placeholderTextColor={c.textSubtle}
                    style={[styles.searchInput, { color: c.text }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onSubmitEditing={() => canCommit && addTag(trimmed)}
                    returnKeyType="done"
                  />
                  <Pressable
                    onPress={() => canCommit && addTag(trimmed)}
                    disabled={!canCommit}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.addBtn,
                      {
                        backgroundColor: canCommit ? c.tint : c.borderStrong,
                        opacity: pressed && canCommit ? 0.85 : 1,
                      },
                    ]}
                  >
                    <ThemedText style={styles.addBtnText}>
                      {alreadyAdded ? 'Added' : 'Add'}
                    </ThemedText>
                  </Pressable>
                </View>

                {/* Currently selected tags */}
                {tags.length > 0 ? (
                  <View style={styles.section}>
                    <ThemedText
                      style={[styles.sectionTitle, { color: c.textMuted }]}
                    >
                      YOUR TAGS
                    </ThemedText>
                    <View style={styles.chipWrap}>
                      {tags.map((tag) => (
                        <Pressable
                          key={tag}
                          onPress={() => removeTag(tag)}
                          style={[
                            styles.selectedChip,
                            { backgroundColor: c.tint, borderColor: c.tint },
                          ]}
                        >
                          <ThemedText style={styles.selectedChipText}>
                            #{tag}
                          </ThemedText>
                          <Ionicons name="close" size={12} color="#fff" />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}

                {/* Suggestions */}
                <View style={styles.section}>
                  <ThemedText
                    style={[styles.sectionTitle, { color: c.textMuted }]}
                  >
                    SUGGESTED
                  </ThemedText>
                  <ScrollView
                    style={{ maxHeight: 220 }}
                    contentContainerStyle={styles.chipWrap}
                    keyboardShouldPersistTaps="handled"
                  >
                    {suggestions.length === 0 ? (
                      <ThemedText
                        style={[styles.empty, { color: c.textMuted }]}
                      >
                        No matches — press Add to create
                        {trimmed ? ` "#${trimmed}"` : ' a new one'}.
                      </ThemedText>
                    ) : (
                      suggestions.map((tag) => (
                        <Pressable
                          key={tag}
                          onPress={() => addTag(tag)}
                          disabled={tags.length >= max}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: c.surfaceAlt,
                              borderColor: c.border,
                              opacity: tags.length >= max ? 0.5 : 1,
                            },
                          ]}
                        >
                          <ThemedText
                            style={[styles.chipText, { color: c.text }]}
                          >
                            #{tag}
                          </ThemedText>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </View>

                {/* Done button */}
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.doneBtn,
                    {
                      backgroundColor: c.surfaceAlt,
                      opacity: pressed ? 0.85 : 1,
                    },
                  ]}
                >
                  <ThemedText style={[styles.doneText, { color: c.text }]}>
                    Done
                  </ThemedText>
                </Pressable>
            </Pressable>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kbWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheetWrap: {},
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  count: { fontSize: 12, fontWeight: '600' },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  addBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  addBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  section: { gap: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '500' },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectedChipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { fontSize: 13, fontStyle: 'italic' },

  doneBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: Radii.md,
    marginTop: 4,
  },
  doneText: { fontSize: 15, fontWeight: '700' },
});
