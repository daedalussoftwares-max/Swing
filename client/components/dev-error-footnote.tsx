import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { errorDebugDetails } from '@/lib/debug-logger';

type Props = {
  error: unknown;
};

/** Shown under user-facing error copy when SWING_DEBUG_ERRORS is enabled. */
export function DevErrorFootnote({ error }: Props) {
  const details = errorDebugDetails(error);
  if (!details) return null;

  return (
    <View style={styles.wrap}>
      <ThemedText style={styles.label}>Debug (share with backend)</ThemedText>
      <ThemedText style={styles.mono} selectable>
        {details}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  label: {
    fontSize: 12,
    opacity: 0.7,
  },
  mono: {
    fontSize: 11,
    fontFamily: 'Menlo',
    opacity: 0.85,
  },
});
