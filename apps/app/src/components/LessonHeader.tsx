import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { spacing, typography } from "../theme/tokens";
import { IconButton } from "./IconButton";
import { ProgressBar } from "./ProgressBar";

export function LessonHeader({
  progress,
  progressLabel,
  onClose,
  statusLabel,
}: {
  progress: number;
  progressLabel: string;
  onClose(): void;
  statusLabel?: string;
}) {
  const { theme } = useSettings();
  return (
    <View style={styles.header}>
      <IconButton icon="close" label="Exit lesson" onPress={onClose} />
      <View style={styles.progress}>
        <ProgressBar progress={progress} accessibilityLabel={progressLabel} />
      </View>
      {statusLabel ? <Text style={[styles.status, { color: theme.textMuted }]}>{statusLabel}</Text> : <View style={styles.placeholder} />}
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
