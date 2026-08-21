import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  controls,
  motion,
  radii,
  spacing,
  typography,
} from "../theme/tokens";

type Props = ComponentProps<typeof TextInput> & {
  label: string;
  error?: string;
  helperText?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  large?: boolean;
  labelPlacement?: "above" | "inside";
};

export function AppTextInput({
  label,
  error,
  helperText,
  leading,
  trailing,
  large = false,
  labelPlacement = "above",
  style,
  onFocus,
  onBlur,
  ...props
}: Props) {
  const { theme } = useSettings();
  const generatedId = useId();
  const [focused, setFocused] = useState(false);
  const inputId = props.nativeID ?? generatedId;
  const labelInside = labelPlacement === "inside";

  return (
    <View style={styles.wrap}>
      {!labelInside ? (
        <Text
          nativeID={`${inputId}-label`}
          style={[styles.label, { color: theme.text }]}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          large && styles.fieldLarge,
          {
            backgroundColor: theme.surface,
            borderColor: error
              ? theme.error
              : focused
                ? theme.primary
                : theme.borderStrong,
          },
          focused && styles.fieldFocused,
          Platform.OS === "web" && {
            transitionDuration: `${motion.fast}ms`,
            transitionProperty: "border-color, background-color",
          },
        ]}
      >
        {leading ? <View style={styles.adornment}>{leading}</View> : null}
        <TextInput
          {...props}
          nativeID={inputId}
          aria-labelledby={labelInside ? undefined : `${inputId}-label`}
          aria-describedby={
            error
              ? `${inputId}-error`
              : helperText
                ? `${inputId}-help`
                : undefined
          }
          accessibilityLabel={props.accessibilityLabel ?? label}
          accessibilityHint={props.accessibilityHint ?? helperText}
          placeholder={props.placeholder ?? (labelInside ? label : undefined)}
          placeholderTextColor={theme.textMuted}
          selectionColor={theme.primary}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            large && styles.inputLarge,
            Platform.OS === "web" && styles.webInput,
            { color: theme.text },
            style,
          ]}
        />
        {trailing ? <View style={styles.adornment}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text
          nativeID={`${inputId}-error`}
          accessibilityRole="alert"
          selectable
          style={[styles.support, { color: theme.error }]}
        >
          {error}
        </Text>
      ) : helperText ? (
        <Text
          nativeID={`${inputId}-help`}
          style={[styles.support, { color: theme.textMuted }]}
        >
          {helperText}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[2],
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  field: {
    minHeight: controls.inputHeight,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    paddingHorizontal: spacing[4],
  },
  fieldLarge: {
    minHeight: controls.urlInputHeight,
    borderRadius: radii.large,
    paddingHorizontal: spacing[5],
  },
  fieldFocused: {
    borderWidth: borders.selected,
  },
  input: {
    minWidth: 0,
    flex: 1,
    minHeight: controls.inputHeight - borders.standard * 2,
    paddingVertical: 0,
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  webInput: {
    outlineColor: "transparent",
    outlineStyle: "solid",
    outlineWidth: 0,
    userSelect: "text",
  },
  inputLarge: {
    minHeight: controls.urlInputHeight - borders.standard * 2,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.bodyLarge,
  },
  adornment: {
    width: controls.iconTarget,
    minHeight: controls.iconTarget,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  support: {
    fontFamily: typography.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
});
