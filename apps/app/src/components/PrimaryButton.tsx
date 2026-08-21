import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, controls, motion, radii, typography } from "../theme/tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type Props = PropsWithChildren<{
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  accessibilityLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  compact?: boolean;
}> &
  Pick<ComponentProps<typeof Pressable>, "testID">;

export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
  accessibilityLabel,
  leadingIcon,
  trailingIcon,
  compact = false,
  testID,
}: Props) {
  const { theme, reduceMotion } = useSettings();
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || loading;

  const colors =
    variant === "primary"
      ? {
          background: theme.action,
          depth: theme.actionPressed,
          border: theme.actionPressed,
          text: theme.textOnAction,
        }
      : variant === "secondary"
        ? {
            background: theme.primary,
            depth: theme.primaryPressed,
            border: theme.primaryPressed,
            text: theme.textOnPrimary,
          }
        : variant === "danger"
          ? {
              background: theme.error,
              depth: theme.errorPressed,
              border: theme.errorPressed,
              text: "#FFFFFF",
            }
          : {
              background: theme.surface,
              depth: theme.borderStrong,
              border: theme.borderStrong,
              text: theme.text,
            };

  if (unavailable) {
    colors.background = theme.disabled;
    colors.depth = theme.disabledDepth;
    colors.border = theme.disabledDepth;
    colors.text = theme.textMuted;
  }

  return (
    <View style={[styles.slot, compact && styles.slotCompact]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: unavailable, busy: loading }}
        disabled={unavailable}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed, hovered }) => [
          styles.button,
          compact && styles.buttonCompact,
          {
            backgroundColor: colors.background,
            borderColor: focused ? theme.focus : colors.border,
            borderBottomColor: colors.depth,
            borderBottomWidth: pressed
              ? borders.standard
              : borders.tactileDepth + borders.standard,
            transform: [
              {
                translateY: pressed
                  ? borders.tactileDepth
                  : hovered && !reduceMotion
                    ? -1
                    : 0,
              },
            ],
          },
          Platform.OS === "web" && {
            transitionDuration: `${motion.fast}ms`,
            transitionProperty: "transform, background-color, border-color",
          },
          focused && styles.focused,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <View style={styles.labelRow}>
            {leadingIcon}
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                compact && styles.labelCompact,
                { color: colors.text },
              ]}
            >
              {children}
            </Text>
            {trailingIcon}
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    minHeight: controls.buttonHeightDesktop + borders.tactileDepth,
  },
  slotCompact: {
    minHeight: controls.iconTarget + borders.tactileDepth,
  },
  button: {
    minHeight: controls.buttonHeightDesktop,
    borderRadius: radii.medium,
    borderWidth: borders.standard,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCompact: {
    minHeight: controls.iconTarget,
    paddingHorizontal: 14,
  },
  focused: {
    borderWidth: borders.selected,
  },
  labelRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  label: {
    flexShrink: 1,
    fontFamily: typography.bodyBold,
    fontSize: 16,
    lineHeight: 20,
    textAlign: "center",
  },
  labelCompact: {
    fontSize: 14,
    lineHeight: 18,
  },
});
