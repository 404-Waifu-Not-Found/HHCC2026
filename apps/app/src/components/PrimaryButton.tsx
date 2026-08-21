import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  breakpoints,
  controls,
  motion,
  radii,
  typography,
} from "../theme/tokens";
import { MotionPressable, MotionView } from "../motion/Motion";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

let focusCameFromKeyboard = true;
let focusModalityListenersInstalled = false;

function installFocusModalityListeners() {
  if (
    Platform.OS !== "web" ||
    focusModalityListenersInstalled ||
    typeof document === "undefined"
  ) {
    return;
  }

  document.addEventListener(
    "keydown",
    () => {
      focusCameFromKeyboard = true;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      focusCameFromKeyboard = false;
    },
    true,
  );
  focusModalityListenersInstalled = true;
}

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
  Pick<ComponentProps<typeof MotionPressable>, "testID">;

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
  const { theme } = useSettings();
  const { width } = useWindowDimensions();
  const mobile = width < breakpoints.tablet;
  const [focused, setFocused] = useState(false);
  const unavailable = disabled || loading;

  useEffect(installFocusModalityListeners, []);

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
    <View
      style={[
        styles.slot,
        mobile && styles.slotMobile,
        compact && styles.slotCompact,
      ]}
    >
      <MotionPressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: unavailable, busy: loading }}
        disabled={unavailable}
        onPress={onPress}
        onPressIn={() => {
          if (Platform.OS === "web" && !focusCameFromKeyboard) {
            setFocused(false);
          }
        }}
        onFocus={() =>
          setFocused(Platform.OS !== "web" || focusCameFromKeyboard)
        }
        onBlur={() => setFocused(false)}
        style={({ pressed, hovered }) => [
          styles.button,
          mobile && styles.buttonMobile,
          compact && styles.buttonCompact,
          {
            backgroundColor: colors.background,
            borderColor: focused ? theme.focus : colors.border,
            borderBottomColor: colors.depth,
            borderBottomWidth: borders.tactileDepth + borders.standard,
            opacity: pressed ? 0.94 : hovered ? 0.98 : 1,
          },
          Platform.OS === "web" && {
            transitionDuration: `${motion.fast}ms`,
            transitionProperty: "transform, background-color, border-color",
          },
        ]}
      >
        <MotionView
          key={loading ? "loading" : "label"}
          preset="fade"
          duration={motion.fast}
          style={styles.labelMotion}
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
        </MotionView>
      </MotionPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    minHeight: controls.buttonHeightDesktop + borders.tactileDepth,
  },
  slotMobile: {
    minHeight: controls.buttonHeight + borders.tactileDepth,
  },
  slotCompact: {
    minHeight: controls.iconTarget + borders.tactileDepth,
  },
  button: {
    minHeight: controls.buttonHeightDesktop,
    borderRadius: radii.medium,
    borderWidth: borders.selected,
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonMobile: {
    minHeight: controls.buttonHeight,
    paddingHorizontal: 18,
  },
  buttonCompact: {
    minHeight: controls.iconTarget,
    paddingHorizontal: 14,
  },
  labelRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  labelMotion: {
    alignItems: "center",
    justifyContent: "center",
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
