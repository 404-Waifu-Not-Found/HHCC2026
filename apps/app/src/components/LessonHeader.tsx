import { Platform, StyleSheet, Text, View } from "react-native";
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
import { MotionPressable, MotionView } from "../motion/Motion";
import { VoxelIcon } from "./VoxelIcon";

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
  const { theme } = useSettings();
  return (
    <View style={styles.header}>
      <MotionPressable
        pressScale={motion.scale.iconPress}
        pressDepth={0}
        testID="quiz-close-button"
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        onPress={onClose}
        style={({ pressed, hovered }) => [
          styles.closeButton,
          {
            backgroundColor: hovered ? theme.surfaceTint : "transparent",
            borderColor: pressed ? theme.borderStrong : "transparent",
            opacity: pressed ? 0.74 : 1,
          },
          Platform.OS === "web" && {
            transitionDuration: `${motion.fast}ms`,
            transitionProperty: "transform, background-color, border-color",
            outlineColor: theme.focus,
          },
        ]}
      >
        <VoxelIcon name="close" size={24} color={theme.textMuted} />
      </MotionPressable>
      <MotionView preset="from-left" style={styles.progress}>
        <ProgressBar progress={progress} accessibilityLabel={progressLabel} />
      </MotionView>
      {statusLabel ? (
        <MotionView key={statusLabel} preset="pop">
          <Text style={[styles.status, { color: theme.textMuted }]}>
            {statusLabel}
          </Text>
        </MotionView>
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
