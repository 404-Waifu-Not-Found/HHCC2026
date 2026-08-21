import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  type QuizQuestionType,
} from "@clipquest/contracts";
import { VoxelIcon } from "./VoxelIcon";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";
import { FeedbackMotion, MotionPressable } from "../motion/Motion";

const choices = [
  { type: "multiple_choice", label: "multipleChoice" },
  { type: "true_false", label: "trueFalse" },
  { type: "short_answer", label: "shortAnswer" },
] as const;

export function QuestionTypeSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: QuizQuestionType[];
  onChange(value: QuizQuestionType[]): void;
  disabled?: boolean;
}) {
  const { t, theme } = useSettings();
  const selected = new Set(value);
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={t("questionTypes")}
      style={styles.row}
    >
      {choices.map((choice) => {
        const active = selected.has(choice.type);
        return (
          <FeedbackMotion
            key={choice.type}
            signal={active ? choice.type : false}
            kind="attention"
          >
            <MotionPressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active, disabled }}
              disabled={disabled}
              onPress={() => {
                if (active && value.length === 1) return;
                const next = active
                  ? value.filter((type) => type !== choice.type)
                  : DEFAULT_QUIZ_QUESTION_TYPES.filter(
                      (type) => selected.has(type) || type === choice.type,
                    );
                onChange(next);
              }}
              style={({ pressed }) => [
                styles.choice,
                {
                  backgroundColor: active
                    ? theme.primarySoft
                    : theme.surfaceSunken,
                  borderColor: active ? theme.primary : theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <VoxelIcon
                name={active ? "selected" : "selected"}
                size={21}
                color={active ? theme.primary : theme.textMuted}
              />
              <Text style={[styles.label, { color: theme.text }]}>
                {t(choice.label)}
              </Text>
            </MotionPressable>
          </FeedbackMotion>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  choice: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    paddingHorizontal: spacing[4],
  },
  pressed: { opacity: 0.72 },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
