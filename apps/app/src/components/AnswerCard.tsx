import { VoxelIcon } from "./VoxelIcon";
import type { ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { FeedbackMotion, MotionPressable, MotionView } from "../motion/Motion";
import {
  borders,
  controls,
  motion,
  radii,
  spacing,
  typography,
} from "../theme/tokens";

export type AnswerState =
  "default" | "selected" | "correct" | "incorrect" | "disabled";

export function AnswerCard({
  label,
  onPress,
  state = "default",
  indexLabel,
  supporting,
  leading,
}: {
  label: string;
  onPress(): void;
  state?: AnswerState;
  indexLabel?: string;
  supporting?: string;
  leading?: ReactNode;
}) {
  const { theme } = useSettings();
  const disabled = state === "disabled";
  const selected = state !== "default" && state !== "disabled";
  const backgroundColor =
    state === "correct"
      ? theme.successSoft
      : state === "incorrect"
        ? theme.errorSoft
        : state === "selected"
          ? theme.primarySoft
          : theme.surface;
  const borderColor =
    state === "correct"
      ? theme.success
      : state === "incorrect"
        ? theme.error
        : state === "selected"
          ? theme.primary
          : theme.borderStrong;
  const depthColor =
    state === "correct"
      ? theme.successPressed
      : state === "incorrect"
        ? theme.errorPressed
        : state === "selected"
          ? theme.primaryPressed
          : theme.borderStrong;
  return (
    <FeedbackMotion
      signal={selected ? state : false}
      kind={
        state === "correct"
          ? "success"
          : state === "incorrect"
            ? "error"
            : "attention"
      }
      style={styles.feedbackWrap}
    >
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed, hovered }) => [
          styles.card,
          {
            backgroundColor: disabled ? theme.surfaceSunken : backgroundColor,
            borderColor,
            borderBottomColor: depthColor,
            borderBottomWidth: borders.tactileDepth + borders.standard,
            opacity: disabled ? 0.7 : 1,
          },
          Platform.OS === "web" && {
            transitionDuration: `${motion.fast}ms`,
            transitionProperty: "transform, background-color, border-color",
            outlineColor: theme.focus,
          },
        ]}
      >
        {indexLabel ? (
          <View
            style={[
              styles.index,
              {
                backgroundColor: selected ? borderColor : theme.surfaceSunken,
                borderColor,
              },
            ]}
          >
            <Text
              style={[
                styles.indexText,
                { color: selected ? theme.textOnPrimary : theme.textMuted },
              ]}
            >
              {indexLabel}
            </Text>
          </View>
        ) : leading ? (
          <View style={styles.leading}>{leading}</View>
        ) : null}
        <View style={styles.copy}>
          <Text
            style={[
              styles.label,
              { color: disabled ? theme.textMuted : theme.text },
            ]}
          >
            {label}
          </Text>
          {supporting ? (
            <Text style={[styles.supporting, { color: theme.textMuted }]}>
              {supporting}
            </Text>
          ) : null}
        </View>
        {selected ? (
          <MotionView preset="pop" exiting>
            <VoxelIcon
              name={
                state === "correct"
                  ? "correct"
                  : state === "incorrect"
                    ? "error"
                    : "correct"
              }
              size={24}
              color={
                state === "correct"
                  ? theme.success
                  : state === "incorrect"
                    ? theme.error
                    : theme.primary
              }
            />
          </MotionView>
        ) : null}
      </MotionPressable>
    </FeedbackMotion>
  );
}

const styles = StyleSheet.create({
  feedbackWrap: { width: "100%" },
  card: {
    minHeight: controls.answerMinHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    borderWidth: borders.standard,
    borderRadius: radii.large,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  index: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.small,
  },
  indexText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
  },
  leading: {
    minWidth: 34,
    alignItems: "center",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  supporting: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
