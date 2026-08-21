import { StyleSheet, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, controls, radii } from "../theme/tokens";
import { MotionProgressFill } from "../motion/Motion";

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
  const { theme } = useSettings();
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
        { backgroundColor: theme.surfaceSunken, borderColor: theme.border },
      ]}
    >
      <MotionProgressFill
        progress={value}
        color={fillColor}
        style={styles.fill}
      >
        <View style={styles.highlight} />
      </MotionProgressFill>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: controls.progressHeight,
    overflow: "hidden",
    borderWidth: borders.hairline,
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
