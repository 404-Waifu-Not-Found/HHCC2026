import type { AttemptGenerationAvailability } from "@clipquest/contracts";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, shadows, spacing, typography } from "../theme/tokens";
import { VoxelIcon } from "./VoxelIcon";

export function QuestionStreamIndicator({
  generation,
  continuing = false,
  onContinue,
}: {
  generation: AttemptGenerationAvailability;
  continuing?: boolean;
  onContinue?: () => void;
}) {
  const { locale, theme } = useSettings();
  if (generation.state === "ready") return null;
  const count = `${generation.availableQuestions}/${generation.totalQuestions}`;
  const retryRequired = generation.state === "retry_required";
  const label = retryRequired
    ? locale === "zh-CN"
      ? `需要继续生成 · 已就绪 ${count}`
      : `Generation paused · ${count} ready`
    : generation.state === "retrying"
      ? locale === "zh-CN"
        ? `正在重试 · 已就绪 ${count}`
        : `Retrying · ${count} ready`
      : locale === "zh-CN"
        ? `已就绪 ${count} 道题`
        : `${count} questions ready`;

  return (
    <View
      testID="question-stream-indicator"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[
        styles.pill,
        {
          backgroundColor: theme.surfaceRaised,
          borderColor: retryRequired ? theme.warning : theme.borderStrong,
          boxShadow:
            theme.mode === "dark" ? shadows.darkFloating : shadows.floating,
        },
      ]}
    >
      <View style={styles.statusRow}>
        {retryRequired ? (
          <VoxelIcon name="warning" size={18} color={theme.warning} />
        ) : (
          <ActivityIndicator size="small" color={theme.primary} />
        )}
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      </View>
      {retryRequired && onContinue ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            locale === "zh-CN" ? "继续生成题目" : "Continue generating"
          }
          disabled={continuing}
          onPress={onContinue}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? theme.primaryPressed : theme.primary,
              opacity: continuing ? 0.6 : 1,
            },
          ]}
        >
          {continuing ? (
            <ActivityIndicator size="small" color={theme.textOnAction} />
          ) : null}
          <Text style={[styles.actionText, { color: theme.textOnAction }]}>
            {locale === "zh-CN" ? "继续生成" : "Continue generating"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    maxWidth: 290,
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: borders.hairline,
    borderRadius: radii.large,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  action: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
  },
  actionText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
});
