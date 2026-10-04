/**
 * Bottom-sheet country picker for the send-screen filters.
 * "Anywhere" (null) + the curated list from `lib/countries.ts`, with a
 * quick search box.
 */

import * as Haptics from '@/lib/native/haptics';
import { Ionicons } from '@/lib/native/vector-icons';
import { memo, useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { COUNTRIES, withFlag } from '@/lib/countries';

type Props = {
  visible: boolean;
  value: string | null;
  onSelect: (country: string | null) => void;
  onClose: () => void;
};

type Row = { key: string; label: string; value: string | null };

const ANYWHERE: Row = { key: '__anywhere__', label: '🌍 Anywhere', value: null };
const ALL_ROWS: Row[] = [
  ANYWHERE,
  ...[...COUNTRIES].sort().map((c) => ({ key: c, label: withFlag(c), value: c })),
];

export function CountrySheet({ visible, value, onSelect, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_ROWS;
    return ALL_ROWS.filter(
      (r) => r.value !== null && r.label.toLowerCase().includes(q),
    );
  }, [query]);

  const close = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  const pick = useCallback(
    (v: string | null) => {
      void Haptics.selectionAsync();
      setQuery('');
      onSelect(v);
    },
    [onSelect],
  );

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <SafeAreaView
          edges={['bottom']}
          style={[
            styles.sheet,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              maxHeight: height * 0.72,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.borderStrong }]} />
          <View style={styles.titleRow}>
            <ThemedText style={styles.title}>Send it to…</ThemedText>
            <Pressable onPress={close} hitSlop={10}>
              <Ionicons name="close" size={22} color={c.textMuted} />
            </Pressable>
          </View>
          <View
            style={[
              styles.search,
              { backgroundColor: c.surfaceAlt, borderColor: c.border },
            ]}
          >
            <Ionicons name="search" size={16} color={c.textSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search countries"
              placeholderTextColor={c.textSubtle}
              style={[styles.searchInput, { color: c.text }]}
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <CountryRow
                row={item}
                selected={item.value === value}
                onPick={pick}
              />
            )}
            ListEmptyComponent={
              <ThemedText style={[styles.empty, { color: c.textMuted }]}>
                No match — try another name.
              </ThemedText>
            }
            contentContainerStyle={styles.list}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const CountryRow = memo(function CountryRow({
  row,
  selected,
  onPick,
}: {
  row: Row;
  selected: boolean;
  onPick: (v: string | null) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={() => onPick(row.value)}
      style={({ pressed }) => [
        styles.row,
        selected && { backgroundColor: c.tintMuted },
        pressed && !selected && { backgroundColor: c.surfaceAlt },
      ]}
    >
      <Ionicons
        name={row.value === null ? 'earth' : 'flag-outline'}
        size={18}
        color={selected ? c.tint : c.textMuted}
      />
      <ThemedText
        style={[
          styles.rowLabel,
          selected && { color: c.tint, fontWeight: '700' },
        ]}
      >
        {row.label}
      </ThemedText>
      {selected ? <Ionicons name="checkmark" size={20} color={c.tint} /> : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: Spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: { fontSize: 18, fontWeight: '700' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 15 },
  list: { paddingHorizontal: Spacing.sm, paddingBottom: Spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
    borderRadius: Radii.md,
  },
  rowLabel: { flex: 1, fontSize: 15 },
  empty: { textAlign: 'center', paddingVertical: Spacing.xl, fontSize: 14 },
});
