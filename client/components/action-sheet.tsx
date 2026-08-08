/**
 * Lightweight bottom-sheet style modal for action menus.
 *
 * Used by:
 *   - ChatActionMenu (Pin / Delete / Block / Report)
 *   - SendModeSheet (Send / Send once / Cancel)
 *
 * Renders a translucent backdrop + a card pinned to the bottom of the
 * screen with a list of actions. Tap on the backdrop OR Cancel
 * dismisses; the host owns each row's `onPress`.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type ActionSheetItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Renders in danger red (e.g. Delete). */
  destructive?: boolean;
  /** Renders in tint color (highlights, e.g. primary action). */
  primary?: boolean;
  onPress: () => void;
  /** Optional sub-label rendered in muted text below the main label. */
  subtitle?: string;
};

type Props = {
  visible: boolean;
  title?: string;
  items: ActionSheetItem[];
  onClose: () => void;
  showCancel?: boolean;
};

export function ActionSheet({
  visible,
  title,
  items,
  onClose,
  showCancel = true,
}: Props) {
  const scheme = useColorScheme();
  const c = Colors[scheme];

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Inner Pressable absorbs taps on the sheet body so they don't
            close the modal. */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={['bottom']}>
            <View
              style={[
                styles.sheet,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              {title ? (
                <View
                  style={[styles.titleWrap, { borderBottomColor: c.border }]}
                >
                  <View
                    style={[
                      styles.handle,
                      { backgroundColor: c.borderStrong },
                    ]}
                  />
                  <ThemedText style={[styles.title, { color: c.textMuted }]}>
                    {title}
                  </ThemedText>
                </View>
              ) : (
                <View
                  style={[styles.handle, { backgroundColor: c.borderStrong }]}
                />
              )}

              {items.map((item, i) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    item.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    i < items.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: c.border,
                    },
                    { backgroundColor: pressed ? c.surfaceAlt : 'transparent' },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={22}
                    color={
                      item.destructive
                        ? c.danger
                        : item.primary
                          ? c.tint
                          : c.text
                    }
                  />
                  <View style={styles.itemText}>
                    <ThemedText
                      style={[
                        styles.itemLabel,
                        {
                          color: item.destructive
                            ? c.danger
                            : item.primary
                              ? c.tint
                              : c.text,
                        },
                      ]}
                    >
                      {item.label}
                    </ThemedText>
                    {item.subtitle ? (
                      <ThemedText
                        style={[styles.itemSub, { color: c.textMuted }]}
                      >
                        {item.subtitle}
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              ))}

              {showCancel ? (
                <Pressable
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.item,
                    styles.cancel,
                    { borderTopColor: c.border },
                    { backgroundColor: pressed ? c.surfaceAlt : 'transparent' },
                  ]}
                >
                  <ThemedText
                    style={[styles.cancelLabel, { color: c.text }]}
                  >
                    Cancel
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  titleWrap: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 16,
  },
  itemText: { flex: 1 },
  itemLabel: { fontSize: 16, fontWeight: '500' },
  itemSub: { fontSize: 12, marginTop: 2 },
  cancel: {
    justifyContent: 'center',
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelLabel: { fontSize: 16, fontWeight: '600' },
});
