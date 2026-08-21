import type { ComponentProps } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { radii, typography } from "../theme/tokens";

type Props = ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
};

export function AppTextInput({ label, error, style, ...props }: Props) {
  const { theme } = useSettings();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={theme.textMuted}
        selectionColor={theme.secondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.surface, borderColor: error ? theme.error : theme.border },
          style,
        ]}
      />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7 },
  label: { fontFamily: typography.bodyBold, fontSize: 14 },
  input: {
    minHeight: 52,
    borderWidth: 2,
    borderRadius: radii.medium,
    paddingHorizontal: 16,
    fontFamily: typography.body,
    fontSize: 16,
  },
  error: { fontFamily: typography.bodyMedium, fontSize: 13 },
});

