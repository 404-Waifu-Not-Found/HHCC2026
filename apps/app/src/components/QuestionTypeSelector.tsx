import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  type QuizQuestionType,
} from "@clipquest/contracts";
import { VoxelIcon } from "./VoxelIcon";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  breakpoints,
  radii,
  spacing,
  typography,
} from "../theme/tokens";
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
  const { width } = useWindowDimensions();
  const compact = width < breakpoints.tablet;
  const selected = new Set(value);
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel={t("questionTypes")}
      style={styles.row}
    >
      {choices.map((choice, index) => {
        const active = selected.has(choice.type);
        return (
          <FeedbackMotion
            key={choice.type}
            signal={active ? choice.type : false}
            kind="attention"
            style={
              compact
                ? [
                    styles.choiceWrapCompact,
                    index === choices.length - 1 &&
                      styles.choiceWrapCompactLast,
                  ]
                : styles.choiceWrap
            }
          >
            <MotionPressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active, disabled }}
              aria-checked={active}
              aria-disabled={disabled}
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
                compact && styles.choiceCompact,
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
                name={active ? "checkbox-checked" : "checkbox-unchecked"}
                size={compact ? 18 : 21}
                color={active ? theme.primary : theme.textMuted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  compact && styles.labelCompact,
                  { color: theme.text },
                ]}
              >
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
  choiceWrap: { flexShrink: 0 },
  // Phones keep a deliberate two-up row plus one full-width row; the e2e
  // journey asserts this geometry, so only the chip styling varies here.
  choiceWrapCompact: { width: "48%" },
  choiceWrapCompactLast: { width: "100%" },
  choice: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    paddingHorizontal: spacing[4],
  },
  choiceCompact: {
    minHeight: 44,
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
  },
  pressed: { opacity: 0.72 },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  labelCompact: {
    flexShrink: 1,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
});
