import type { ComponentProps } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, controls, motion, radii } from "../theme/tokens";

export function IconButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "neutral",
  size = 22,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  onPress(): void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
  size?: number;
}) {
  const { theme, reduceMotion } = useSettings();
  const foreground = disabled ? theme.textSubtle : tone === "danger" ? theme.error : tone === "primary" ? theme.primary : theme.textMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.button,
        {
          backgroundColor: hovered && !disabled ? theme.surfaceTint : "transparent",
          borderColor: pressed ? theme.borderStrong : "transparent",
          transform: [{ scale: pressed && !reduceMotion ? 0.94 : 1 }],
        },
        Platform.OS === "web" && {
          transitionDuration: `${motion.fast}ms`,
          transitionProperty: "transform, background-color, border-color",
          outlineColor: theme.focus,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={size} color={foreground} />
    </Pressable>
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
