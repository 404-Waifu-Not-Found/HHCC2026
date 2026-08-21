import type { AttemptGenerationAvailability } from "@clipquest/contracts";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { openLocalGenerationClientSettings } from "../generation/local-generation-client";
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
  const automaticRecoveryPossible =
    generation.retryAvailable === true ||
    isAutomaticRecoveryReason(generation.reasonCode);
  const needsAttention =
    generation.state === "action_required" ||
    (generation.state === "generation_failed" && !automaticRecoveryPossible);
  const label = generationLabel(generation, count, locale);
  const explanation = needsAttention
    ? generationReasonExplanation(
        generation.reasonCode,
        generation.retryAvailable,
        locale,
      )
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
          borderColor: needsAttention ? theme.warning : theme.borderStrong,
          boxShadow:
            theme.mode === "dark" ? shadows.darkFloating : shadows.floating,
        },
      ]}
    >
      <View style={styles.statusRow}>
        {needsAttention ? (
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
          onPress={openLocalGenerationClientSettings}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? theme.primaryPressed : theme.primary,
            },
          ]}
        >
          <Text style={[styles.actionText, { color: theme.textOnAction }]}>
            {locale === "zh-CN"
              ? Platform.OS !== "web"
                ? "打开本地 AI 设置"
                : "打开扩展设置"
              : Platform.OS !== "web"
                ? "Open Local AI settings"
                : "Open extension settings"}
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
    if (generation.recoveryPhase === "preparing") {
      const delaySeconds = generation.retryDelayMs
        ? Math.max(1, Math.ceil(generation.retryDelayMs / 1_000))
        : undefined;
      if (delaySeconds) {
        return chinese
          ? `第 ${ordinal} 题将在 ${delaySeconds} 秒后自动重试 · 已就绪 ${count}`
          : `Retrying question ${ordinal} in ${delaySeconds} seconds · ${count} ready`;
      }
      return chinese
        ? `正在准备重试第 ${ordinal} 题 · 已就绪 ${count}`
        : `Preparing retry for question ${ordinal} · ${count} ready`;
    }
    return chinese
      ? `正在自动重试第 ${ordinal} 题 · 已就绪 ${count}`
      : `Automatically retrying question ${ordinal} · ${count} ready`;
  }
  if (generation.state === "recovering") {
    if (generation.recoveryPhase === "preparing") {
      return chinese
        ? `正在准备自动恢复 · 已就绪 ${count}`
        : `Preparing automatic recovery · ${count} ready`;
    }
    if (
      generation.recoveryPhase === "dispatched" ||
      generation.recoveryPhase === "streaming"
    ) {
      const ordinal = generation.availableQuestions + 1;
      return chinese
        ? `正在恢复第 ${ordinal} 题 · 已就绪 ${count}`
        : `Recovering question ${ordinal} · ${count} ready`;
    }
    return chinese
      ? `正在此标签页恢复 · 已就绪 ${count}`
      : `Recovering this quiz in this tab · ${count} ready`;
  }
  if (generation.state === "cooldown") {
    return chinese
      ? `自动重试将在冷却后继续 · 已就绪 ${count}`
      : `Automatic retries resume after cooldown · ${count} ready`;
  }
  if (generation.state === "action_required") {
    return chinese
      ? `需要 DeepSeek 配置 · 已就绪 ${count}`
      : `DeepSeek configuration required · ${count} ready`;
  }
  if (generation.state === "generation_failed") {
    if (generation.retryAvailable === true) {
      return chinese
        ? `正在自动恢复 · 已就绪 ${count}`
        : `Automatically recovering · ${count} ready`;
    }
    return chinese
      ? `字幕无法补全本次测验 · 已就绪 ${count}`
      : `Captions could not complete this quiz · ${count} ready`;
  }
  if (generation.state === "retry_required") {
    return chinese
      ? `正在自动生成剩余题目 · 已就绪 ${count}`
      : `Automatically generating the remaining questions · ${count} ready`;
  }
  return chinese ? `已就绪 ${count} 道题` : `${count} questions ready`;
}

function isAutomaticRecoveryReason(reasonCode: string | undefined): boolean {
  return (
    reasonCode !== undefined &&
    ![
      "credential_required",
      "credential_invalid",
      "credential_missing",
      "billing_required",
      "cost_limit_reached",
      "non_instructional_source",
    ].includes(reasonCode)
  );
}

function generationReasonExplanation(
  reasonCode: string | undefined,
  retryAvailable: boolean | undefined,
  locale: "en" | "zh-CN",
): string {
  const chinese = locale === "zh-CN";
  if (retryAvailable === true) {
    return chinese
      ? "ClipQuest 将在后台自动生成剩余题目。"
      : "ClipQuest will keep generating the remaining questions automatically.";
  }
  if (reasonCode === "credential_required") {
    return chinese
      ? "请更新 ClipQuest 中的 DeepSeek 密钥；验证后会自动恢复。"
      : "Update the DeepSeek key in ClipQuest; generation resumes automatically after validation.";
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
  if (reasonCode === "non_instructional_source") {
    return chinese
      ? "字幕中没有足够的可测学习内容。"
      : "The captions do not contain enough testable learning material.";
  }
  if (retryAvailable === false)
    return chinese
      ? "ClipQuest 无法从现有字幕生成其余题目；不完整的测验不会计分。"
      : "ClipQuest cannot generate the remaining questions from these captions; the incomplete quiz will not be scored.";
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
