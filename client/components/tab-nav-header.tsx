/**
 * Shared tab-screen header chrome: optional back (previous tab) + children.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TAB_ROUTES, type TabRoute } from '@/components/tab-swipe-region';

const BACK_SLOT = 40;

type Props = {
  route: TabRoute;
  children: React.ReactNode;
  style?: ViewStyle;
  /** Tighter horizontal inset — home logo / icons flush to screen edges. */
  compact?: boolean;
};

export function TabNavHeader({ route, children, style, compact }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const index = TAB_ROUTES.indexOf(route);
  const canBack = index > 0;

  const goBack = () => {
    if (!canBack) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.navigate(TAB_ROUTES[index - 1] as any);
  };

  return (
    <View
      style={[
        styles.row,
        compact ? styles.rowCompact : null,
        style,
      ]}
    >
      {canBack ? (
        <Pressable
          onPress={goBack}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backBtn,
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  rowCompact: {
    paddingHorizontal: Spacing.sm,
  },
  backBtn: {
    width: BACK_SLOT,
    height: BACK_SLOT,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -4,
  },
  backSlot: {
    width: BACK_SLOT,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minWidth: 0,
  },
});
