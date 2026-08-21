import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  controls,
  motion,
  radii,
  spacing,
  typography,
} from "../theme/tokens";
import { ProgressBar } from "./ProgressBar";

export function LessonHeader({
  progress,
  progressLabel,
  onClose,
  statusLabel,
  closeLabel = "Exit lesson",
}: {
  progress: number;
  progressLabel: string;
  onClose(): void;
  statusLabel?: string;
  closeLabel?: string;
}) {
  const { theme, reduceMotion } = useSettings();
  return (
    <View style={styles.header}>
      <Pressable
        testID="quiz-close-button"
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={({ pressed, hovered }) => [
          styles.closeButton,
          {
            backgroundColor: hovered ? theme.surfaceTint : "transparent",
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
        <Text style={[styles.closeGlyph, { color: theme.textMuted }]}>×</Text>
      </Pressable>
      <View style={styles.progress}>
        <ProgressBar progress={progress} accessibilityLabel={progressLabel} />
      </View>
      {statusLabel ? (
        <Text style={[styles.status, { color: theme.textMuted }]}>
          {statusLabel}
        </Text>
      ) : (
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
  },
  closeButton: {
    width: controls.iconTarget,
    height: controls.iconTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.medium,
  },
  closeGlyph: {
    fontFamily: typography.body,
    fontSize: 30,
    lineHeight: 32,
    textAlign: "center",
  },
  progress: {
    flex: 1,
  },
  status: {
    minWidth: 44,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    textAlign: "right",
  },
  placeholder: {
    width: 44,
  },
});
