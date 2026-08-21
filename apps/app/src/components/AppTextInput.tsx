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
import { FeedbackMotion, MotionView } from "../motion/Motion";

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
      <FeedbackMotion signal={error} kind="error">
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
            Platform.OS === "web" && {
              transitionDuration: `${motion.fast}ms`,
              transitionProperty: "border-color, background-color",
            },
          ]}
        >
          {leading ? <View style={styles.adornment}>{leading}</View> : null}
          <TextInput
            {...props}
            secureTextEntry={props.secureTextEntry === true}
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
          {focused ? (
            <MotionView
              preset="fade"
              duration={motion.quick}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.focusRing,
                large && styles.focusRingLarge,
                { borderColor: error ? theme.error : theme.primary },
              ]}
            />
          ) : null}
        </View>
      </FeedbackMotion>
      {error ? (
        <MotionView preset="rise" exiting>
          <Text
            nativeID={`${inputId}-error`}
            accessibilityRole="alert"
            selectable
            style={[styles.support, { color: theme.error }]}
          >
            {error}
          </Text>
        </MotionView>
      ) : helperText ? (
        <MotionView preset="fade">
          <Text
            nativeID={`${inputId}-help`}
            style={[styles.support, { color: theme.textMuted }]}
          >
            {helperText}
          </Text>
        </MotionView>
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
    position: "relative",
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
  focusRing: {
    pointerEvents: "none",
    position: "absolute",
    top: -borders.standard,
    right: -borders.standard,
    bottom: -borders.standard,
    left: -borders.standard,
    borderWidth: borders.selected,
    borderRadius: radii.medium,
  },
  focusRingLarge: {
    borderRadius: radii.large,
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
