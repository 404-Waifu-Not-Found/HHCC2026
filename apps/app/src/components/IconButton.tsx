import type { ComponentProps } from "react";
import { VoxelIcon } from "./VoxelIcon";
import { Platform, StyleSheet } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, controls, motion, radii } from "../theme/tokens";
import { MotionPressable } from "../motion/Motion";

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "neutral",
  size = 22,
}: {
  icon: ComponentProps<typeof VoxelIcon>["name"];
  label: string;
  onPress(): void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  size?: number;
}) {
  const { theme } = useSettings();
  const foreground = disabled
    ? theme.textSubtle
    : tone === "danger"
      ? theme.error
      : tone === "primary"
        ? theme.primary
        : theme.textMuted;

  return (
    <MotionPressable
      pressScale={motion.scale.iconPress}
      pressDepth={0}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.button,
        {
          backgroundColor:
            hovered && !disabled ? theme.surfaceTint : "transparent",
          borderColor: pressed ? theme.borderStrong : "transparent",
          opacity: pressed ? 0.76 : 1,
        },
        Platform.OS === "web" && {
          transitionDuration: `${motion.fast}ms`,
          transitionProperty: "transform, background-color, border-color",
          outlineColor: theme.focus,
        },
      ]}
    >
      <VoxelIcon name={icon} size={size} color={foreground} />
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: controls.iconTarget,
    height: controls.iconTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.medium,
  },
});
