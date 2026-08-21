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
  const explanation = retryRequired
    ? generationReasonExplanation(generation.reasonCode, locale)
    : undefined;
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
      {explanation ? (
        <Text style={[styles.explanation, { color: theme.textMuted }]}>
          {explanation}
        </Text>
      ) : null}
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

function generationReasonExplanation(
  reasonCode: string | undefined,
  locale: "en" | "zh-CN",
): string {
  const chinese = locale === "zh-CN";
  if (reasonCode === "empty_content") {
    return chinese
      ? "DeepSeek 没有返回可用 JSON；ClipQuest 未进行盲目重试。"
      : "DeepSeek returned no usable JSON; ClipQuest did not retry blindly.";
  }
  if (reasonCode === "truncated_json" || reasonCode === "finish_length") {
    return chinese
      ? "JSON 在完成前中断；已接收的题目仍然保留。"
      : "The JSON ended before completion; accepted questions are preserved.";
  }
  if (
    reasonCode === "schema_invalid" ||
    reasonCode === "type_or_order_mismatch" ||
    reasonCode === "duplicate_question" ||
    reasonCode === "answer_mapping_invalid"
  ) {
    return chinese
      ? "模型输出未通过严格验证；ClipQuest 未自动重新请求。"
      : "Model output failed strict validation; no automatic request was sent.";
  }
  if (reasonCode === "credential_required") {
    return chinese
      ? "请在 ClipQuest Local AI 扩展中检查 DeepSeek 密钥。"
      : "Check the DeepSeek key in the ClipQuest Local AI extension.";
  }
  if (reasonCode === "billing_required") {
    return chinese
      ? "DeepSeek 计费需要恢复后才能继续。"
      : "DeepSeek billing must be restored before continuing.";
  }
  if (reasonCode === "local_state_conflict") {
    return chinese
      ? "原生成标签页已停止；继续操作将明确重新认领此测验。"
      : "The original generation tab stopped; Continue will explicitly reclaim this attempt.";
  }
  if (reasonCode === "append_conflict") {
    return chinese
      ? "已存储题目状态发生变化；继续前将从服务器重新读取进度。"
      : "Stored question state changed; continuation will reload the server frontier.";
  }
  if (reasonCode === "generation_stalled") {
    return chinese
      ? "本地生成流已停止更新；继续操作将重新认领此测验。"
      : "The local stream stopped updating; Continue will reclaim this attempt.";
  }
  if (
    reasonCode === "transient_http" ||
    reasonCode === "network_interrupted" ||
    reasonCode === "timeout"
  ) {
    return chinese
      ? "唯一允许的临时自动重试已结束；后续请求需要你的确认。"
      : "The one permitted transient retry ended; another request needs your confirmation.";
  }
  return chinese
    ? "已接收的题目仍可作答；继续操作只生成缺失部分。"
    : "Ready questions remain usable; Continue generates only the missing suffix.";
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
  explanation: {
    fontFamily: typography.body,
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
