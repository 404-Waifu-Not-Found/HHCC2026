import { VoxelIcon } from "./VoxelIcon";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";
import { FeedbackMotion, StaggerItem } from "../motion/Motion";

export type ProcessingStepState = "complete" | "active" | "upcoming" | "error";

export function ProcessingSteps({
  steps,
}: {
  steps: readonly {
    label: string;
    state: ProcessingStepState;
    detail?: string;
  }[];
}) {
  const { theme } = useSettings();
  return (
    <View accessibilityLiveRegion="polite" style={styles.list}>
      {steps.map((step, index) => {
        const color =
          step.state === "complete"
            ? theme.success
            : step.state === "error"
              ? theme.error
              : step.state === "active"
                ? theme.primary
                : theme.borderStrong;
        const icon =
          step.state === "complete"
            ? "correct"
            : step.state === "error"
              ? "error"
              : step.state === "active"
                ? "processing"
                : "progress";
        return (
          <StaggerItem
            key={`${step.label}-${index}`}
            index={index}
            style={styles.row}
          >
            <View style={styles.rail}>
              <FeedbackMotion
                signal={
                  step.state === "active" || step.state === "complete"
                    ? step.state
                    : false
                }
                kind={step.state === "complete" ? "success" : "progress"}
                style={[
                  styles.marker,
                  {
                    borderColor: color,
                    backgroundColor:
                      step.state === "upcoming" ? theme.surface : color,
                  },
                ]}
              >
                <VoxelIcon
                  name={icon}
                  size={18}
                  color={
                    step.state === "upcoming" ? theme.textMuted : theme.surface
                  }
                />
              </FeedbackMotion>
              {index < steps.length - 1 ? (
                <View
                  style={[
                    styles.line,
                    {
                      backgroundColor:
                        step.state === "complete"
                          ? theme.success
                          : theme.divider,
                    },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.copy}>
              <Text
                style={[
                  styles.label,
                  {
                    color:
                      step.state === "upcoming" ? theme.textMuted : theme.text,
                  },
                ]}
              >
                {step.label}
              </Text>
              {step.detail ? (
                <Text style={[styles.detail, { color: theme.textMuted }]}>
                  {step.detail}
                </Text>
              ) : null}
            </View>
          </StaggerItem>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 0,
  },
  row: {
    minHeight: 62,
    flexDirection: "row",
    gap: spacing[4],
  },
  rail: {
    width: 36,
    alignItems: "center",
  },
  marker: {
    zIndex: 1,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: radii.pill,
  },
  line: {
    width: borders.standard,
    flex: 1,
  },
  copy: {
    flex: 1,
    paddingTop: spacing[1],
    paddingBottom: spacing[5],
    gap: spacing[1],
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  detail: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
