/**
 * Shared empty-state for screens that aren't built yet.
 * Replace with real screens as the MVP grows.
 *
 * Wraps content in a TabSwipeRegion so users can swipe horizontally
 * anywhere on the empty screen to switch tabs (Instagram-style),
 * and applies the tab-focus fade so a switch always feels animated.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TabNavHeader } from '@/components/tab-nav-header';
import { TabSwipeRegion, type TabRoute } from '@/components/tab-swipe-region';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTabFocusFade } from '@/hooks/use-tab-focus-fade';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  title: string;
  subtitle: string;
  icon: IoniconName;
  currentRoute: TabRoute;
};

export function ScreenPlaceholder({ title, subtitle, icon, currentRoute }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const fadeStyle = useTabFocusFade();

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <TabSwipeRegion currentRoute={currentRoute} style={styles.fill}>
        <TabNavHeader route={currentRoute}>
          <View style={styles.headerSpacer} />
        </TabNavHeader>
        <Animated.View style={[styles.body, fadeStyle]}>
          <View style={[styles.iconCircle, { backgroundColor: c.tintMuted }]}>
            <Ionicons name={icon} size={36} color={c.tint} />
          </View>
          <ThemedText style={styles.title}>{title}</ThemedText>
          <ThemedText style={[styles.subtitle, { color: c.textMuted }]}>
            {subtitle}
          </ThemedText>
        </Animated.View>
      </TabSwipeRegion>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  headerSpacer: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
