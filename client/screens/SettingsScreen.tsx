/**
 * Settings screen — opened from the profile tab.
 *
 * MVP toggles:
 *   - Sound effects        (mock — wired to `useUserSettings`)
 *   - Push notifications   (mock)
 *   - Dark mode            (overrides system theme)
 *   - Account deletion     (red, confirmation-guarded)
 *
 * Reads/writes to `UserSettingsContext`. Persistence (SecureStore)
 * is a follow-up.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { useRouter } from '@/lib/router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlockingLoader } from '@/components/blocking-loader';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { humanizeAuthError, useAuth } from '@/lib/auth-context';
import { useUserSettings } from '@/lib/user-settings-context';

export default function SettingsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const {
    sound,
    setSound,
    pushNotifications,
    setPushNotifications,
    themePref,
    setThemePref,
    user,
    deleteAccount,
  } = useUserSettings();
  const { signOut, deleteAccountRemote } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const busy = deleting || signingOut;

  const isDarkMode = themePref === 'dark';

  const handleToggleDark = (next: boolean) => {
    setThemePref(next ? 'dark' : 'light');
  };

  const handleResetTheme = () => {
    setThemePref('system');
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      "This will permanently remove your profile, chats and planes. You can't undo this.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccountRemote();
              deleteAccount();
              Alert.alert(
                'Account deleted',
                'Your account and data have been permanently removed.',
              );
            } catch (e) {
              Alert.alert(
                'Could not delete',
                humanizeAuthError(
                  e,
                  'Something went wrong. Try again when you are back online.',
                ),
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} disabled={busy}>
          <Ionicons name="arrow-back" size={24} color={c.text} />
        </Pressable>
        <ThemedText style={styles.title}>Settings</ThemedText>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!busy}
      >
        {/* Account card */}
        <View
          style={[
            styles.accountCard,
            { backgroundColor: c.surfaceAlt, borderColor: c.border },
          ]}
        >
          <View style={[styles.accountAvatar, { backgroundColor: c.tintMuted }]}>
            <ThemedText
              style={[styles.accountInitial, { color: c.tintPressed }]}
            >
              {user.name.charAt(0).toUpperCase()}
            </ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={styles.accountName}>{user.name}</ThemedText>
            <ThemedText
              style={[styles.accountSub, { color: c.textMuted }]}
              numberOfLines={1}
            >
              @{user.username} · joined {new Date(user.joinedAt).toLocaleDateString()}
            </ThemedText>
          </View>
        </View>

        {/* Preferences */}
        <Section title="Preferences">
          <ToggleRow
            icon="volume-high-outline"
            label="Sounds"
            description="Tap & send feedback inside Swing"
            value={sound}
            onValueChange={setSound}
          />
          <ToggleRow
            icon="notifications-outline"
            label="Push notifications"
            description="New planes, accepts, reactions"
            value={pushNotifications}
            onValueChange={setPushNotifications}
          />
          <ToggleRow
            icon="moon-outline"
            label="Dark mode"
            description={
              themePref === 'system'
                ? 'Following system'
                : isDarkMode
                  ? 'On'
                  : 'Off'
            }
            value={isDarkMode}
            onValueChange={handleToggleDark}
          />
          {themePref !== 'system' ? (
            <Pressable onPress={handleResetTheme} style={styles.subActionRow}>
              <Ionicons name="refresh-outline" size={16} color={c.tint} />
              <ThemedText style={[styles.subActionText, { color: c.tint }]}>
                Reset to system theme
              </ThemedText>
            </Pressable>
          ) : null}
        </Section>

        {/* Privacy / support */}
        <Section title="About">
          <ListRow
            icon="lock-closed-outline"
            label="Privacy"
            onPress={() =>
              Alert.alert('Coming soon', 'Privacy controls land with the backend.')
            }
          />
          <ListRow
            icon="document-text-outline"
            label="Terms of service"
            onPress={() =>
              Alert.alert('Coming soon', 'Will open the hosted terms page.')
            }
          />
          <ListRow
            icon="help-circle-outline"
            label="Help & feedback"
            onPress={() =>
              Alert.alert(
                'Help & feedback',
                'Email us at hello@swing.app — we read everything.',
              )
            }
          />
        </Section>

        {/* Account */}
        <Section title="Account">
          <ListRow
            icon="log-out-outline"
            label="Log out"
            onPress={() =>
              Alert.alert(
                'Log out?',
                "You'll need to sign in again with your email.",
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Log out',
                    style: 'destructive',
                    onPress: async () => {
                      setSigningOut(true);
                      try {
                        await signOut();
                        // AuthGuard redirects to /(auth)/splash.
                      } finally {
                        setSigningOut(false);
                      }
                    },
                  },
                ],
              )
            }
          />
          <ListRow
            icon="trash-outline"
            label="Delete account"
            destructive
            onPress={confirmDelete}
          />
        </Section>

        <View style={styles.footer}>
          <ThemedText style={[styles.footerText, { color: c.textSubtle }]}>
            Swing · v0.1.0
          </ThemedText>
        </View>
      </ScrollView>

      <BlockingLoader
        visible={busy}
        message={deleting ? 'Deleting account…' : 'Signing out…'}
      />
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={styles.section}>
      <ThemedText style={[styles.sectionTitle, { color: c.textMuted }]}>
        {title.toUpperCase()}
      </ThemedText>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: c.surface, borderColor: c.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.row, { borderBottomColor: c.border }]}>
      <Ionicons name={icon} size={20} color={c.text} />
      <View style={styles.rowText}>
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
        {description ? (
          <ThemedText style={[styles.rowDesc, { color: c.textMuted }]}>
            {description}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: c.borderStrong, true: c.tint }}
        thumbColor="#fff"
        ios_backgroundColor={c.borderStrong}
      />
    </View>
  );
}

function ListRow({
  icon,
  label,
  destructive,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const color = destructive ? c.danger : c.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.surfaceAlt },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowLabel, { color }]}>{label}</ThemedText>
      </View>
      {!destructive ? (
        <Ionicons name="chevron-forward" size={18} color={c.textSubtle} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700' },
  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },

  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.lg,
  },
  accountAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInitial: { fontSize: 20, fontWeight: '700' },
  accountName: { fontSize: 15, fontWeight: '700' },
  accountSub: { fontSize: 12, marginTop: 2 },

  section: { marginBottom: Spacing.lg },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginLeft: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  sectionCard: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowDesc: { fontSize: 12, marginTop: 2 },

  subActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  subActionText: { fontSize: 13, fontWeight: '600' },

  footer: { alignItems: 'center', paddingVertical: Spacing.lg },
  footerText: { fontSize: 12 },
});
