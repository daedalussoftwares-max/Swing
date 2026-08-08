/**
 * Edit profile screen — opened from the profile tab's "Edit profile" button.
 *
 * Fields:
 *   - Avatar (image picker)
 *   - Name, Username, Status (bio), Age
 *   - City + Country (picker)
 *   - Phone, Email
 *   - Password (mock — opens a "Change password" alert)
 *   - Tags (opens the HashtagEditor bottom sheet)
 *
 * Form is a local draft until Save is pressed; cancelling discards changes.
 */

import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@/lib/native/vector-icons';
import * as Haptics from '@/lib/native/haptics';
import * as ImagePicker from '@/lib/native/image-picker';
import { useFocusEffect, useRouter } from '@/lib/router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { HashtagEditor } from '@/components/hashtag-editor';
import { ImageViewerModal } from '@/components/image-viewer-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ProfilePatchBody } from '@/lib/api/auth-types';
import { humanizeAuthError, useAuth } from '@/lib/auth-context';
import { joinInterests, parseInterests } from '@/lib/interests';
import { COUNTRIES } from '@/lib/countries';
import { authUserToLocalPatch } from '@/lib/profile-from-auth';
import { isUsernameAvailable } from '@/lib/usernames';
import { type LocalUser, useUserSettings } from '@/lib/user-settings-context';

export default function EditProfileScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { user, updateUser } = useUserSettings();
  const auth = useAuth();
  const saveProfile = auth.saveProfile;

  // Local draft — commits to API on save (not AsyncStorage alone).
  const [draft, setDraft] = useState<LocalUser>(user);
  const [saving, setSaving] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setDraft(user);
    }, [user]),
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showHashtagEditor, setShowHashtagEditor] = useState(false);
  const [showDobPicker, setShowDobPicker] = useState(false);
  // Spinner-only transient. See profile-setup screen for the rationale
  // — iOS won't fire onChange unless the wheel actually moves, so the
  // displayed default would be lost if the user just taps Done.
  const [tempDob, setTempDob] = useState<Date>(() => defaultDob());

  const set = <K extends keyof LocalUser>(key: K, value: LocalUser[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  /** Apply a new DOB and re-derive `age` from it. */
  const setDob = (date: Date) => {
    const iso = date.toISOString().slice(0, 10);
    const age = ageFromDob(iso);
    setDraft((d) => ({ ...d, dob: iso, age }));
  };

  const openDobPicker = () => {
    setTempDob(draft.dob ? new Date(draft.dob) : defaultDob());
    setShowDobPicker(true);
  };

  const confirmDob = () => {
    setDob(tempDob);
    setShowDobPicker(false);
  };

  const cancelDob = () => {
    setShowDobPicker(false);
  };

  const handleDobChange = (event: DateTimePickerEvent, date?: Date) => {
    // Android fires `set` (user tapped OK) or `dismissed` (cancelled);
    // it auto-commits, so we don't need temp state there.
    if (Platform.OS === 'android') {
      setShowDobPicker(false);
      if (event.type === 'set' && date) setDob(date);
      return;
    }
    // iOS spinner — accumulate in `tempDob`; commit happens on Done.
    if (date) setTempDob(date);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(user);

  const handleSave = async () => {
    if (auth.status !== 'signed-in') {
      Alert.alert('Not signed in', 'Please sign in again.');
      return;
    }

    setSaving(true);
    try {
      const nextUsername = draft.username.trim().toLowerCase();
      const currentUsername = auth.user.username?.toLowerCase() ?? '';
      if (nextUsername && nextUsername !== currentUsername) {
        const free = await isUsernameAvailable(nextUsername);
        if (!free) {
          Alert.alert('Username taken', 'That username is already in use.');
          return;
        }
      }

      const patch: ProfilePatchBody = {
        name: draft.name.trim() || undefined,
        username: nextUsername || undefined,
        bio: draft.bio.trim(),
        city: draft.city?.trim() || undefined,
        country: draft.country?.trim() || undefined,
        dob: draft.dob,
        gender: draft.gender,
        interests: draft.interests ?? '',
      };

      const saved = await saveProfile(patch);
      updateUser({
        ...authUserToLocalPatch(saved),
        avatarUri: draft.avatarUri,
        interests: saved.interests ?? draft.interests ?? '',
        phone: draft.phone,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Alert.alert(
        'Could not save',
        humanizeAuthError(e, 'Something went wrong. Try again.'),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(
      'Discard changes?',
      "You'll lose what you just edited.",
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => router.back(),
        },
      ],
    );
  };

  const handleAvatarLongPress = () => {
    if (!draft.avatarUri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAvatarPreviewUri(draft.avatarUri);
  };

  const handleChangeAvatar = async () => {
    Haptics.selectionAsync();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        'Allow Swing to access your photos to change your profile picture.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    set('avatarUri', asset.uri);

    if (auth.status !== 'signed-in') return;

    setUploadingAvatar(true);
    try {
      const saved = await auth.uploadAvatar(asset.uri, asset.mimeType ?? undefined);
      set('avatarUri', saved.avatarUrl ?? asset.uri);
      updateUser(authUserToLocalPatch(saved));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(
        'Could not upload',
        humanizeAuthError(e, 'Something went wrong. Try again.'),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleChangePassword = () => {
    Alert.alert(
      'Change password',
      'Password reset will be available once the backend is live.',
    );
  };

  // ── Detect location stub ─────────────────────────────────────────
  const handleDetectLocation = () => {
    Alert.alert(
      'Detect location',
      'Real location detection (via expo-location) lands with the backend. For now, pick a country manually.',
      [
        { text: 'OK', style: 'cancel' },
        {
          text: 'Pick country',
          onPress: () => setShowCountryPicker(true),
        },
      ],
    );
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Pressable onPress={handleCancel} hitSlop={10} disabled={saving}>
            <ThemedText style={[styles.headerAction, { color: c.text }]}>
              Cancel
            </ThemedText>
          </Pressable>
          <ThemedText style={styles.title}>Edit profile</ThemedText>
          <Pressable
            onPress={handleSave}
            hitSlop={10}
            disabled={!dirty || saving}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={c.tint} />
            ) : (
              <ThemedText
                style={[
                  styles.headerAction,
                  styles.saveText,
                  { color: dirty ? c.tint : c.textSubtle },
                ]}
              >
                Save
              </ThemedText>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!saving}
        >
          {/* Avatar */}
          <View style={styles.avatarBlock}>
            <Avatar
              uri={draft.avatarUri}
              name={draft.name || 'You'}
              size={96}
              onPress={handleChangeAvatar}
              onLongPress={handleAvatarLongPress}
            />
            <Pressable onPress={handleChangeAvatar} hitSlop={10}>
              <ThemedText style={[styles.changePhoto, { color: c.tint }]}>
                Change profile photo
              </ThemedText>
            </Pressable>
          </View>

          {/* Public info */}
          <Section title="Public">
            <Field
              label="Name"
              value={draft.name}
              onChangeText={(v) => set('name', v)}
              placeholder="Your name"
              autoCapitalize="words"
            />
            <Field
              label="Username"
              value={draft.username}
              onChangeText={(v) =>
                set('username', v.replace(/[^a-z0-9._-]/gi, '').toLowerCase())
              }
              placeholder="lowercase, no spaces"
              autoCapitalize="none"
            />
            <Field
              label="Status"
              value={draft.bio}
              onChangeText={(v) => {
                // Single-line: strip newlines so paste / IME suggestions can't
                // sneak a line-break in and grow the row.
                set('bio', v.replace(/\r?\n/g, ' '));
              }}
              placeholder="A short vibe for your profile"
            />
            <RowAction
              icon="calendar-outline"
              label="Date of birth"
              valuePreview={
                draft.dob
                  ? `${formatDob(draft.dob)} · ${ageFromDob(draft.dob)} yrs`
                  : 'Tap to set'
              }
              onPress={openDobPicker}
            />

            <RowAction
              icon="pricetags-outline"
              label="Tags"
              valuePreview={
                parseInterests(draft.interests).length > 0
                  ? parseInterests(draft.interests)
                      .map((t) => `#${t}`)
                      .join(' · ')
                  : 'Add a few interests'
              }
              onPress={() => setShowHashtagEditor(true)}
            />
          </Section>

          {/* Location */}
          <Section title="Location">
            <RowAction
              icon="globe-outline"
              label="Country"
              valuePreview={draft.country ?? 'Not set'}
              onPress={() => setShowCountryPicker(true)}
            />
            <Field
              label="City"
              value={draft.city ?? ''}
              onChangeText={(v) => set('city', v || undefined)}
              placeholder="e.g. Bengaluru"
              autoCapitalize="words"
            />
            <RowAction
              icon="locate-outline"
              label="Detect location"
              onPress={handleDetectLocation}
              chevron
            />
          </Section>

          {/* Account */}
          <Section title="Account">
            <Field
              label="Phone"
              value={draft.phone ?? ''}
              onChangeText={(v) => set('phone', v || undefined)}
              placeholder="+91 ..."
              keyboardType="phone-pad"
            />
            <Field
              label="Email"
              value={draft.email ?? ''}
              onChangeText={(v) => set('email', v || undefined)}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <RowAction
              icon="key-outline"
              label="Password"
              valuePreview="••••••••"
              onPress={handleChangePassword}
              chevron
            />
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country picker */}
      <CountryPicker
        visible={showCountryPicker}
        selected={draft.country}
        onSelect={(country) => {
          set('country', country);
          setShowCountryPicker(false);
        }}
        onClose={() => setShowCountryPicker(false)}
      />

      {/* Hashtag editor */}
      <HashtagEditor
        visible={showHashtagEditor}
        tags={parseInterests(draft.interests)}
        onChange={(next) => set('interests', joinInterests(next))}
        onClose={() => setShowHashtagEditor(false)}
      />

      {/* Date-of-birth picker.
          - iOS: spinner inside a bottom sheet with a Done button.
          - Android: native dialog (the picker shows itself when mounted). */}
      {showDobPicker ? (
        Platform.OS === 'ios' ? (
          <Modal transparent animationType="slide" onRequestClose={cancelDob}>
            <Pressable style={styles.backdrop} onPress={cancelDob}>
              <Pressable onPress={(e) => e.stopPropagation()}>
                <SafeAreaView edges={['bottom']}>
                  <View
                    style={[
                      styles.dobSheet,
                      { backgroundColor: c.surface, borderColor: c.border },
                    ]}
                  >
                    <View style={styles.dobHeader}>
                      <Pressable onPress={cancelDob} hitSlop={8}>
                        <ThemedText style={{ color: c.textMuted }}>Cancel</ThemedText>
                      </Pressable>
                      <ThemedText style={styles.dobTitle}>Date of birth</ThemedText>
                      <Pressable onPress={confirmDob} hitSlop={8}>
                        <ThemedText style={{ color: c.tint, fontWeight: '700' }}>
                          Done
                        </ThemedText>
                      </Pressable>
                    </View>
                    <DateTimePicker
                      value={tempDob}
                      mode="date"
                      display="spinner"
                      maximumDate={minDob()}
                      onChange={handleDobChange}
                      themeVariant={scheme === 'dark' ? 'dark' : 'light'}
                    />
                  </View>
                </SafeAreaView>
              </Pressable>
            </Pressable>
          </Modal>
        ) : (
          <DateTimePicker
            value={draft.dob ? new Date(draft.dob) : defaultDob()}
            mode="date"
            display="default"
            maximumDate={minDob()}
            onChange={handleDobChange}
          />
        )
      ) : null}

      <BlockingLoader
        visible={saving || uploadingAvatar}
        message={uploadingAvatar ? 'Uploading photo…' : 'Saving profile…'}
      />

      {avatarPreviewUri ? (
        <ImageViewerModal
          uri={avatarPreviewUri}
          align="top"
          onClose={() => setAvatarPreviewUri(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ── DOB helpers ─────────────────────────────────────────────────────────

/** Compute integer age (years) from a yyyy-mm-dd DOB. */
function ageFromDob(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

/** Human format: "15 Aug 2001". */
function formatDob(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Sensible default — 20 years before today. */
function defaultDob(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20);
  return d;
}

/** Maximum DOB allowed: today minus 13 years (matches Swing's age policy). */
function minDob(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  return d;
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

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'words' | 'sentences';
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.fieldRow, { borderBottomColor: c.border }]}>
      <ThemedText style={[styles.fieldLabel, { color: c.textMuted }]}>
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textSubtle}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[
          styles.fieldInput,
          { color: c.text },
          multiline && { minHeight: 40 },
        ]}
      />
    </View>
  );
}

function RowAction({
  icon,
  label,
  valuePreview,
  onPress,
  chevron,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  valuePreview?: string;
  onPress: () => void;
  chevron?: boolean;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.fieldRow,
        { borderBottomColor: c.border },
        pressed && { backgroundColor: c.surfaceAlt },
      ]}
    >
      <Ionicons name={icon} size={18} color={c.text} />
      <ThemedText style={[styles.fieldLabel, { color: c.text, marginLeft: 6 }]}>
        {label}
      </ThemedText>
      {valuePreview ? (
        <ThemedText
          style={[styles.fieldValuePreview, { color: c.textMuted }]}
          numberOfLines={1}
        >
          {valuePreview}
        </ThemedText>
      ) : null}
      {chevron || valuePreview ? (
        <Ionicons name="chevron-forward" size={16} color={c.textSubtle} />
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Country picker modal — a simple searchable list.
// ---------------------------------------------------------------------------

function CountryPicker({
  visible,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  selected?: string;
  onSelect: (country: string) => void;
  onClose: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [q, setQ] = useState('');

  const filtered = COUNTRIES.filter((country) =>
    country.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()}>
          <SafeAreaView edges={['bottom']}>
            <View
              style={[
                styles.pickerSheet,
                { backgroundColor: c.surface, borderColor: c.border },
              ]}
            >
              <View
                style={[styles.handle, { backgroundColor: c.borderStrong }]}
              />
              <View style={styles.pickerHeader}>
                <ThemedText style={styles.pickerTitle}>Select country</ThemedText>
                <Pressable hitSlop={8} onPress={onClose}>
                  <Ionicons name="close" size={22} color={c.text} />
                </Pressable>
              </View>

              <View
                style={[
                  styles.searchBox,
                  { backgroundColor: c.surfaceAlt, borderColor: c.border },
                ]}
              >
                <Ionicons name="search" size={16} color={c.textMuted} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search country"
                  placeholderTextColor={c.textSubtle}
                  style={[styles.searchInput, { color: c.text }]}
                  autoCapitalize="words"
                />
              </View>

              <FlatList
                data={filtered}
                keyExtractor={(item) => item}
                style={{ maxHeight: 420 }}
                renderItem={({ item }) => {
                  const active = item === selected;
                  return (
                    <Pressable
                      onPress={() => onSelect(item)}
                      style={({ pressed }) => [
                        styles.countryRow,
                        { borderBottomColor: c.border },
                        (pressed || active) && { backgroundColor: c.surfaceAlt },
                      ]}
                    >
                      <ThemedText style={styles.countryName}>
                        {item}
                      </ThemedText>
                      {active ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={c.tint}
                        />
                      ) : null}
                    </Pressable>
                  );
                }}
                ListEmptyComponent={() => (
                  <ThemedText
                    style={[styles.empty, { color: c.textMuted }]}
                  >
                    No matches
                  </ThemedText>
                )}
              />
            </View>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '700' },
  headerAction: { fontSize: 15 },
  saveText: { fontWeight: '700' },

  scroll: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },

  avatarBlock: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: 6,
  },
  changePhoto: { fontSize: 14, fontWeight: '600' },

  section: { marginTop: Spacing.lg },
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
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldLabel: { fontSize: 14, width: 90 },
  fieldInput: { flex: 1, fontSize: 14, padding: 0 },
  fieldValuePreview: { flex: 1, fontSize: 13, textAlign: 'right' },

  // Country picker
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
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
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: { fontSize: 16, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 2 },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  countryName: { flex: 1, fontSize: 14 },
  empty: { textAlign: 'center', fontSize: 13, paddingVertical: Spacing.lg },

  // DOB picker sheet
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
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  dobTitle: { fontSize: 15, fontWeight: '700' },
});
