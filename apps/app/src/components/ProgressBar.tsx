import { StyleSheet, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { radii } from "../theme/tokens";

export function ProgressBar({ progress, accessibilityLabel }: { progress: number; accessibilityLabel: string }) {
  const { theme } = useSettings();
  const value = Math.max(0, Math.min(1, progress));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={[styles.track, { backgroundColor: theme.border }]}
    >
      <View style={[styles.fill, { width: `${value * 100}%`, backgroundColor: theme.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 12, overflow: "hidden", borderRadius: radii.pill },
  fill: { height: "100%", borderRadius: radii.pill },
});
