/**
 * Profile-setup — final step of the onboarding journey.
 *
 * Asks the user for:
 *   • Profile photo (camera-roll picker)
 *   • Name (required)
 *   • Username (required, unique, Reddit-style)
 *       - Live availability check against the mock username registry
 *       - "Suggest a username" button rolls a friendly random one
 *   • Date of birth (required, min 13 yrs)
 *   • Gender (Male / Female / Non-binary, required)
 *
 * On "Let's fly" we:
 *   1. Write all fields into the existing `UserSettings.user` object
 *      so the rest of the app reads them unchanged.
 *   2. Claim the username in the registry so other accounts can't
 *      take it.
 *   3. Call `markProfileComplete()` on AuthContext so the root layout's
 *      AuthGuard releases us into /(tabs).
 *
 * Interests / hashtags / status are intentionally NOT asked here — per
 * product spec they are nudged on the home screen instead (less
 * onboarding friction, contextual when relevant).
 */

import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import * as Haptics from '@/lib/native/haptics';
import * as ImagePicker from '@/lib/native/image-picker';
import { useRouter } from '@/lib/router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { BlockingLoader } from '@/components/blocking-loader';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { humanizeAuthError, useAuth } from '@/lib/auth-context';
import { isLocalImageUri } from '@/lib/upload-avatar';
import { authUserToLocalPatch } from '@/lib/profile-from-auth';
import { useUserSettings } from '@/lib/user-settings-context';
import {
  isUsernameAvailable,
  suggestAvailableUsername,
  validateUsername,
} from '@/lib/usernames';

import { Ionicons } from '@/lib/native/vector-icons';

/**
 * Discriminated union for the username field's UX state. Keeps the
 * inline status indicator + submit-gating logic concise — one state
 * value drives everything.
 */
type UsernameStatus =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' };

type Gender = 'M' | 'F' | 'NB';

const GENDERS: { key: Gender; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'M', label: 'Male', icon: 'male' },
  { key: 'F', label: 'Female', icon: 'female' },
  { key: 'NB', label: 'Non-binary', icon: 'transgender' },
];

export default function ProfileSetupScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { user, updateUser } = useUserSettings();
  const auth = useAuth();
  const { saveProfile, uploadAvatar } = auth;

  const [avatarUri, setAvatarUri] = useState<string | undefined>(user.avatarUri);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>({
    kind: 'idle',
  });
  const [suggesting, setSuggesting] = useState(false);
  // `dob` is the committed value (what the screen displays).
  // `tempDob` is the spinner's transient value while the iOS picker
  // modal is open. We need a temp because iOS only fires `onChange`
  // when the user actively scrolls the spinner — if they open the
  // modal and tap "Done" without touching anything, the default
  // displayed value would otherwise be lost.
  const [dob, setDob] = useState<Date | null>(null);
  const [tempDob, setTempDob] = useState<Date>(() => defaultDob());
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [gender, setGender] = useState<Gender | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live username availability check.
  //
  // We debounce by 400 ms so a fast-typing user doesn't fire a hit
  // per keystroke. The effect re-runs whenever the value changes;
  // the cleanup function cancels any in-flight check that becomes
  // stale, which prevents an older response from overwriting a newer
  // status (the classic stale-response race).
  useEffect(() => {
    const trimmed = username.trim().toLowerCase();
    if (trimmed.length === 0) {
      setUsernameStatus({ kind: 'idle' });
      return;
    }
    const localError = validateUsername(trimmed);
    if (localError) {
      setUsernameStatus({ kind: 'invalid', message: localError });
      return;
    }
    setUsernameStatus({ kind: 'checking' });
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(trimmed);
        if (cancelled) return;
        setUsernameStatus(ok ? { kind: 'available' } : { kind: 'taken' });
      } catch {
        if (!cancelled) setUsernameStatus({ kind: 'idle' });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  const handleSuggestUsername = async () => {
    Haptics.selectionAsync();
    setSuggesting(true);
    try {
      const next = await suggestAvailableUsername();
      // Note: assigning to `username` triggers the live-check effect,
      // which will mark the suggestion `available` (it was picked
      // precisely because it was free).
      setUsername(next);
    } finally {
      setSuggesting(false);
    }
  };

  const openDobPicker = () => {
    // Seed the spinner from the currently-committed value (or the
    // default if user hasn't picked yet). This is what gets committed
    // back to `dob` if the user taps Done without spinning.
    setTempDob(dob ?? defaultDob());
    setShowDobPicker(true);
  };

  const confirmDob = () => {
    setDob(tempDob);
    setShowDobPicker(false);
  };

  const cancelDob = () => {
    // Don't touch `dob` — user backed out of the picker.
    setShowDobPicker(false);
  };

  const canSubmit =
    name.trim().length > 0 &&
    usernameStatus.kind === 'available' &&
    !!dob &&
    !!gender &&
    !submitting;

  const pickAvatarFromGallery = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  const pickAvatar = () => {
    Haptics.selectionAsync();
    if (avatarUri) {
      Alert.alert('Profile photo', undefined, [
        { text: 'Update photo', onPress: () => void pickAvatarFromGallery() },
        {
          text: 'Remove photo',
          style: 'destructive',
          onPress: () => setAvatarUri(undefined),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert('Profile photo', undefined, [
      { text: 'Add photo', onPress: () => void pickAvatarFromGallery() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onDobChange = (e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      // Android shows a native dialog that auto-commits on OK / dismisses
      // on cancel — no temp state needed.
      setShowDobPicker(false);
      if (e.type === 'set' && date) setDob(date);
      return;
    }
    // iOS spinner — accumulate into `tempDob`; commit happens on Done.
    if (date) setTempDob(date);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const claimedUsername = username.trim().toLowerCase();
      // Re-verify availability right before claiming. The 400 ms
      // debounce check could be stale if another account on the same
      // device raced to the same name (rare, but cheap to guard).
      const stillFree = await isUsernameAvailable(claimedUsername);
      if (!stillFree) {
        setUsernameStatus({ kind: 'taken' });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const dobIso = dob!.toISOString().slice(0, 10);
      let saved = await saveProfile({
        name: name.trim(),
        username: claimedUsername,
        dob: dobIso,
        gender: gender ?? undefined,
        profileComplete: true,
      });

      if (avatarUri && isLocalImageUri(avatarUri)) {
        saved = await uploadAvatar(avatarUri);
      }

      updateUser({
        ...authUserToLocalPatch(saved),
        avatarUri: saved.avatarUrl ?? avatarUri,
        age: ageFromDob(dob!),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (e) {
      Alert.alert(
        'Could not save profile',
        humanizeAuthError(e, 'Something went wrong. Try again.'),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!submitting && !suggesting}
        >
          <ThemedText style={styles.title}>Tell us about you</ThemedText>
          <ThemedText style={[styles.subtitle, { color: c.textMuted }]}>
            Just the basics — you can edit anything later.
          </ThemedText>

          {/* Avatar */}
          <View style={styles.avatarBlock}>
            <Pressable onPress={pickAvatar} style={styles.avatarPress}>
              <Avatar name={name || '?'} uri={avatarUri} size={96} />
              <View style={[styles.avatarBadge, { backgroundColor: c.tint }]}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            </Pressable>
            <ThemedText style={[styles.avatarHelp, { color: c.textMuted }]}>
              Tap to add a photo
            </ThemedText>
          </View>

          {/* Name */}
          <View style={styles.field}>
            <ThemedText style={[styles.fieldLabel, { color: c.textMuted }]}>
              Name
            </ThemedText>
            <View
              style={[
                styles.fieldInputWrap,
                { backgroundColor: c.surfaceAlt, borderColor: c.border },
              ]}
            >
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="What should we call you?"
                placeholderTextColor={c.textSubtle}
                style={[styles.fieldInput, { color: c.text }]}
                autoCapitalize="words"
                autoComplete="name"
                maxLength={40}
              />
            </View>
          </View>

          {/* Username */}
          <View style={styles.field}>
            <View style={styles.usernameLabelRow}>
              <ThemedText style={[styles.fieldLabel, { color: c.textMuted }]}>
                Username
              </ThemedText>
              <Pressable
                onPress={handleSuggestUsername}
                disabled={suggesting}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.suggestBtn,
                  { backgroundColor: c.tintMuted, borderColor: c.tint + '55' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                {suggesting ? (
                  <ActivityIndicator size="small" color={c.tint} />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={12} color={c.tint} />
                    <ThemedText
                      style={[styles.suggestText, { color: c.tint }]}
                    >
                      Suggest
                    </ThemedText>
                  </>
                )}
              </Pressable>
            </View>
            <View
              style={[
                styles.fieldInputWrap,
                styles.fieldRow,
                {
                  backgroundColor: c.surfaceAlt,
                  // Outline the input in the danger / success colour so
                  // the status reads at a glance, even before the user
                  // looks at the text indicator below.
                  borderColor:
                    usernameStatus.kind === 'available'
                      ? c.success + '99'
                      : usernameStatus.kind === 'taken' ||
                          usernameStatus.kind === 'invalid'
                        ? c.danger + '88'
                        : c.border,
                },
              ]}
            >
              <ThemedText style={[styles.usernamePrefix, { color: c.textMuted }]}>
                @
              </ThemedText>
              <TextInput
                value={username}
                // Force the namespace lowercase as the user types so
                // the live-check doesn't bounce between "Invalid" (on
                // an uppercase keystroke) and "Available" (after we
                // lowercase it ourselves on submit).
                onChangeText={(t) => setUsername(t.toLowerCase())}
                placeholder="clever_otter_42"
                placeholderTextColor={c.textSubtle}
                style={[styles.fieldInput, { color: c.text }]}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="username-new"
                maxLength={20}
              />
              <UsernameStatusIcon status={usernameStatus} />
            </View>
            {/* Inline status line — colour matches the outline so the
                two read as a single signal. */}
            <UsernameStatusText status={usernameStatus} />
          </View>

          {/* DOB */}
          <View style={styles.field}>
            <ThemedText style={[styles.fieldLabel, { color: c.textMuted }]}>
              Date of birth
            </ThemedText>
            <Pressable
              onPress={openDobPicker}
              style={[
                styles.fieldInputWrap,
                styles.fieldRow,
                { backgroundColor: c.surfaceAlt, borderColor: c.border },
              ]}
            >
              <ThemedText
                style={[
                  styles.fieldInput,
                  { color: dob ? c.text : c.textSubtle },
                ]}
              >
                {dob ? formatDob(dob) : 'Select your birthday'}
              </ThemedText>
              <Ionicons name="calendar-outline" size={18} color={c.textMuted} />
            </Pressable>
          </View>

          {/* Gender */}
          <View style={styles.field}>
            <ThemedText style={[styles.fieldLabel, { color: c.textMuted }]}>
              Gender
            </ThemedText>
            <View style={styles.genderRow}>
              {GENDERS.map((g) => {
                const selected = gender === g.key;
                return (
                  <Pressable
                    key={g.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setGender(g.key);
                    }}
                    style={({ pressed }) => [
                      styles.genderPill,
                      {
                        backgroundColor: selected ? c.tint : c.surfaceAlt,
                        borderColor: selected ? c.tint : c.border,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={g.icon}
                      size={16}
                      color={selected ? '#fff' : c.textMuted}
                    />
                    <ThemedText
                      style={[
                        styles.genderText,
                        { color: selected ? '#fff' : c.text },
                      ]}
                    >
                      {g.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: canSubmit ? c.tint : c.borderStrong,
                opacity: pressed && canSubmit ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="paper-plane" size={16} color="#fff" />
                <ThemedText style={styles.primaryBtnText}>Let&apos;s fly</ThemedText>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* DOB picker — bottom sheet on iOS, native dialog on Android */}
      {showDobPicker && Platform.OS === 'ios' ? (
        <Modal transparent animationType="slide" visible>
          <View style={styles.dobBackdrop}>
            <View
              style={[
                styles.dobSheet,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View style={styles.dobHeader}>
                <Pressable onPress={cancelDob} hitSlop={8}>
                  <ThemedText style={[styles.dobAction, { color: c.textMuted }]}>
                    Cancel
                  </ThemedText>
                </Pressable>
                <ThemedText style={styles.dobTitle}>Date of birth</ThemedText>
                <Pressable onPress={confirmDob} hitSlop={8}>
                  <ThemedText style={[styles.dobAction, { color: c.tint }]}>
                    Done
                  </ThemedText>
                </Pressable>
              </View>
              <DateTimePicker
                value={tempDob}
                mode="date"
                display="spinner"
                maximumDate={minDob()}
                onChange={onDobChange}
                themeVariant={scheme}
              />
            </View>
          </View>
        </Modal>
      ) : showDobPicker && Platform.OS === 'android' ? (
        <DateTimePicker
          value={dob ?? defaultDob()}
          mode="date"
          display="default"
          maximumDate={minDob()}
          onChange={onDobChange}
        />
      ) : null}

      <BlockingLoader
        visible={submitting || suggesting}
        message={submitting ? 'Saving profile…' : 'Finding a username…'}
      />
    </SafeAreaView>
  );
}

// ── Helpers (mirror app/profile/edit.tsx so behaviour is consistent) ───────

// ── Username inline status helpers ─────────────────────────────────────────
//
// Split out as tiny presentational components so the main JSX above
// stays readable. Both read the discriminated `UsernameStatus` and
// pick the right colour/icon/copy — single source of truth.

function UsernameStatusIcon({ status }: { status: UsernameStatus }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  switch (status.kind) {
    case 'idle':
      return null;
    case 'checking':
      return <ActivityIndicator size="small" color={c.textMuted} />;
    case 'available':
      return <Ionicons name="checkmark-circle" size={18} color={c.success} />;
    case 'taken':
    case 'invalid':
      return <Ionicons name="close-circle" size={18} color={c.danger} />;
  }
}

function UsernameStatusText({ status }: { status: UsernameStatus }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  let text = '';
  let color = c.textMuted;
  switch (status.kind) {
    case 'idle':
      return null;
    case 'checking':
      text = 'Checking availability…';
      break;
    case 'available':
      text = 'Available — looks great';
      color = c.success;
      break;
    case 'taken':
      text = 'That username is already taken';
      color = c.danger;
      break;
    case 'invalid':
      text = status.message;
      color = c.danger;
      break;
  }
  return (
    <ThemedText style={[styles.usernameHint, { color }]}>{text}</ThemedText>
  );
}

function ageFromDob(d: Date): number {
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return Math.max(0, age);
}

function formatDob(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function defaultDob(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20);
  return d;
}

function minDob(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  return d;
}

// ── styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: Spacing.xl,
  },

  // Avatar
  avatarBlock: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  avatarPress: {
    position: 'relative',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  avatarHelp: {
    marginTop: Spacing.sm,
    fontSize: 12,
  },

  field: {
    marginBottom: Spacing.md,
  },

  // Username — label sits next to a "Suggest" chip on the same baseline,
  // input is a row with a leading "@" prefix and trailing status icon.
  usernameLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  suggestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 24,
    minWidth: 80,
    justifyContent: 'center',
  },
  suggestText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  usernamePrefix: {
    fontSize: 15,
    fontWeight: '600',
    marginRight: 2,
  },
  usernameHint: {
    fontSize: 11,
    marginTop: 6,
    marginLeft: 2,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  fieldInputWrap: {
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    minHeight: 50,
    justifyContent: 'center',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
  },

  genderRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  genderPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  genderText: {
    fontSize: 13,
    fontWeight: '600',
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: Radii.pill,
    marginTop: Spacing.xl,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // DOB picker modal (iOS)
  dobBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  dobSheet: {
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.lg,
  },
  dobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  dobTitle: { fontSize: 15, fontWeight: '700' },
  dobAction: { fontSize: 14, fontWeight: '600' },
});
