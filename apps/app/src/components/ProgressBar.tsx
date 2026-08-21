import { Platform, StyleSheet, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { controls, motion, radii } from "../theme/tokens";

export function ProgressBar({
  progress,
  accessibilityLabel,
  tone = "action",
  compact = false,
}: {
  progress: number;
  accessibilityLabel: string;
  tone?: "action" | "primary" | "success" | "secondary";
  compact?: boolean;
}) {
  const { theme, reduceMotion } = useSettings();
  const value = Math.max(0, Math.min(1, progress));
  const fillColor =
    tone === "primary"
      ? theme.primary
      : tone === "success"
        ? theme.success
        : tone === "secondary"
          ? theme.secondary
          : theme.action;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={[
        styles.track,
        compact && styles.trackCompact,
        { backgroundColor: theme.surfaceSunken },
      ]}
    >
      <View
        style={[
          styles.fill,
          { width: `${value * 100}%`, backgroundColor: fillColor },
          Platform.OS === "web" && !reduceMotion
            ? {
                transitionDuration: `${motion.route}ms`,
                transitionProperty: "width",
              }
            : null,
        ]}
      >
        <View style={styles.highlight} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: controls.progressHeight,
    overflow: "hidden",
    borderRadius: radii.pill,
  },
  trackCompact: {
    height: 8,
  },
  fill: {
    height: "100%",
    overflow: "hidden",
    borderRadius: radii.pill,
  },
  highlight: {
    height: 3,
    marginHorizontal: 5,
    marginTop: 2,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
});
