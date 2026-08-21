import type { AttemptGenerationAvailability } from "@clipquest/contracts";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { openClipQuestExtensionSettings } from "../transcription/clipquest-extension";
import { borders, radii, shadows, spacing, typography } from "../theme/tokens";
import { VoxelIcon } from "./VoxelIcon";

export function QuestionStreamIndicator({
  generation,
}: {
  generation: AttemptGenerationAvailability;
}) {
  const { locale, theme } = useSettings();
  if (generation.state === "ready") return null;
  const count = `${generation.availableQuestions}/${generation.totalQuestions}`;
  const stopped =
    generation.state === "action_required" ||
    generation.state === "generation_failed";
  const label = generationLabel(generation, count, locale);
  const explanation = stopped
    ? generationReasonExplanation(generation.reasonCode, locale)
    : undefined;

  return (
    <View
      testID="question-stream-indicator"
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[
        styles.pill,
        {
          backgroundColor: theme.surfaceRaised,
          borderColor: stopped ? theme.warning : theme.borderStrong,
          boxShadow:
            theme.mode === "dark" ? shadows.darkFloating : shadows.floating,
        },
      ]}
    >
      <View style={styles.statusRow}>
        {stopped ? (
          <VoxelIcon name="warning" size={18} color={theme.warning} />
        ) : (
          <ActivityIndicator size="small" color={theme.primary} />
        )}
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      </View>
      {explanation ? (
        <Text style={[styles.explanation, { color: theme.textMuted }]}>
          {explanation}
        </Text>
      ) : null}
      {generation.state === "action_required" ? (
        <Pressable
          accessibilityRole="button"
          onPress={openClipQuestExtensionSettings}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? theme.primaryPressed : theme.primary,
            },
          ]}
        >
          <Text style={[styles.actionText, { color: theme.textOnAction }]}>
            {locale === "zh-CN" ? "打开扩展设置" : "Open extension settings"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function generationLabel(
  generation: AttemptGenerationAvailability,
  count: string,
  locale: "en" | "zh-CN",
): string {
  const chinese = locale === "zh-CN";
  if (generation.state === "retrying") {
    const ordinal =
      generation.retryOrdinal ?? generation.availableQuestions + 1;
    return chinese
      ? `正在自动修复第 ${ordinal} 题 · 已就绪 ${count}`
      : `Automatically repairing question ${ordinal} · ${count} ready`;
  }
  if (generation.state === "recovering") {
    return chinese
      ? `正在此标签页恢复 · 已就绪 ${count}`
      : `Recovering this quiz in this tab · ${count} ready`;
  }
  if (generation.state === "action_required") {
    return chinese
      ? `需要 DeepSeek 配置 · 已就绪 ${count}`
      : `DeepSeek configuration required · ${count} ready`;
  }
  if (generation.state === "generation_failed") {
    return chinese
      ? `生成无法完成 · 已就绪 ${count}`
      : `Generation could not complete · ${count} ready`;
  }
  if (generation.state === "retry_required") {
    return chinese
      ? `正在自动接管旧版生成 · 已就绪 ${count}`
      : `Recovering legacy generation automatically · ${count} ready`;
  }
  return chinese ? `已就绪 ${count} 道题` : `${count} questions ready`;
}

function generationReasonExplanation(
  reasonCode: string | undefined,
  locale: "en" | "zh-CN",
): string {
  const chinese = locale === "zh-CN";
  if (reasonCode === "credential_required") {
    return chinese
      ? "请更新 ClipQuest Local AI 中的 DeepSeek 密钥；验证后会自动恢复。"
      : "Update the DeepSeek key in ClipQuest Local AI; generation resumes automatically after validation.";
  }
  if (reasonCode === "billing_required") {
    return chinese
      ? "恢复 DeepSeek 计费后，ClipQuest 会自动继续。"
      : "Restore DeepSeek billing and ClipQuest will resume automatically.";
  }
  if (reasonCode === "source_unavailable") {
    return chinese
      ? "YouTube 来源或文字记录已不可用。"
      : "The YouTube source or transcript is no longer available.";
  }
  if (
    reasonCode === "recovery_budget_exhausted" ||
    reasonCode === "automatic_retries_exhausted"
  ) {
    return chinese
      ? "自动修复预算已用完；已接收的题目不会被计分为完整测验。"
      : "The automatic repair budget was exhausted; the partial bank cannot be scored.";
  }
  return chinese
    ? "已接收的题目仍可作答，但测验不会以不完整状态计分。"
    : "Ready questions remain usable, but this incomplete quiz cannot be scored.";
}

const styles = StyleSheet.create({
  pill: {
    maxWidth: 320,
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
  explanation: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  action: {
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[3],
    borderRadius: radii.pill,
  },
  actionText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
});
