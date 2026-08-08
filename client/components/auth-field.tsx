import { type ReactNode } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type AuthFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'email' | 'password' | 'password-new' | 'name' | 'off';
  secureTextEntry?: boolean;
  rightAdornment?: ReactNode;
};

export function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  secureTextEntry,
  rightAdornment,
}: AuthFieldProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.field}>
      <ThemedText style={[styles.fieldLabel, { color: c.textMuted }]}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.fieldInputWrap,
          { backgroundColor: c.surfaceAlt, borderColor: c.border },
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.textSubtle}
          style={[styles.fieldInput, { color: c.text }]}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          secureTextEntry={secureTextEntry}
        />
        {rightAdornment ? (
          <View style={styles.fieldAdornment}>{rightAdornment}</View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  fieldInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    height: 50,
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
  },
  fieldAdornment: {
    paddingLeft: Spacing.sm,
  },
});
