/**
 * Filter chip row for the send screen — a wrapping row of pill chips
 * with a single selected value. Selection colour + a little press
 * squish run on the UI thread; rows are memoised so typing in the
 * composer doesn't re-render them.
 */

import * as Haptics from '@/lib/native/haptics';
import { Ionicons } from '@/lib/native/vector-icons';
import { memo, useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { ChipOption } from '@/components/plane-filter-model';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type RowProps<T extends string> = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  options: ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  hint?: string;
};

function FilterChipRowInner<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
  hint,
}: RowProps<T>) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <Ionicons name={icon} size={14} color={c.textMuted} />
        <ThemedText style={[styles.label, { color: c.textMuted }]}>{label}</ThemedText>
        {hint ? (
          <ThemedText style={[styles.hint, { color: c.textSubtle }]} numberOfLines={1}>
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.chips}>
        {options.map((o) => (
          <FilterChip
            key={o.value}
            value={o.value}
            label={o.label}
            selected={o.value === value}
            onSelect={onChange as (v: string) => void}
          />
        ))}
      </View>
    </View>
  );
}

export const FilterChipRow = memo(FilterChipRowInner) as typeof FilterChipRowInner;

type ChipProps = {
  value: string;
  label: string;
  selected: boolean;
  onSelect: (value: string) => void;
};

export const FilterChip = memo(function FilterChip({
  value,
  label,
  selected,
  onSelect,
}: ChipProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const sel = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(1);

  useEffect(() => {
    sel.value = withTiming(selected ? 1 : 0, { duration: 180 });
  }, [selected, sel]);

  const idleBg = c.surfaceAlt;
  const activeBg = c.tint;
  const idleBorder = c.border;
  const activeBorder = c.tint;
  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [idleBg, activeBg]),
    borderColor: interpolateColor(sel.value, [0, 1], [idleBorder, activeBorder]),
    transform: [{ scale: press.value }],
  }));

  const onPressIn = useCallback(() => {
    press.value = withSpring(0.92, { damping: 15, stiffness: 400 });
  }, [press]);
  const onPressOut = useCallback(() => {
    press.value = withSpring(1, { damping: 12, stiffness: 300 });
  }, [press]);
  const onPress = useCallback(() => {
    if (!selected) void Haptics.selectionAsync();
    onSelect(value);
  }, [onSelect, selected, value]);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Animated.View style={[styles.chip, style]}>
        <ThemedText
          style={[
            styles.chipText,
            { color: selected ? '#fff' : c.text },
            selected && styles.chipTextSelected,
          ]}
        >
          {label}
        </ThemedText>
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { gap: Spacing.sm },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  hint: { fontSize: 11, marginLeft: 'auto', flexShrink: 1 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  chipTextSelected: { fontWeight: '700' },
});
