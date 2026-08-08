/**
 * Pill-shaped indicator showing how many planes the user has left.
 * Reads from `usePlaneBalance` so it stays in sync everywhere.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePlaneBalance } from '@/lib/plane-balance-context';

export function PlaneBalance() {
  const { count } = usePlaneBalance();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const isEmpty = count <= 0;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isEmpty ? c.surfaceAlt : c.tintMuted,
          borderColor: isEmpty ? c.border : c.tint,
        },
      ]}
    >
      <Ionicons
        name="paper-plane"
        size={14}
        color={isEmpty ? c.textSubtle : c.tintPressed}
      />
      <ThemedText
        style={[styles.count, { color: isEmpty ? c.textSubtle : c.tintPressed }]}
      >
        {count}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: {
    fontSize: 14,
    fontWeight: '700',
  },
});
