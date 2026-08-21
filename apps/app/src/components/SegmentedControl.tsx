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
import { FeedbackMotion, MotionPressable } from "../motion/Motion";

export type Segment<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly Segment<T>[];
  onChange(value: T): void;
  label: string;
}) {
  const { theme } = useSettings();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        styles.group,
        { borderColor: theme.border, backgroundColor: theme.surfaceSunken },
      ]}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <FeedbackMotion
            key={option.value}
            signal={selected ? option.value : false}
            kind="attention"
            style={styles.optionWrap}
          >
            <MotionPressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed, hovered }) => [
                styles.option,
                {
                  backgroundColor: selected
                    ? theme.surface
                    : hovered
                      ? theme.surfaceTint
                      : "transparent",
                  borderColor: selected ? theme.primary : "transparent",
                  opacity: pressed ? 0.82 : 1,
                },
                Platform.OS === "web" && {
                  transitionDuration: `${motion.fast}ms`,
                  transitionProperty: "opacity, background-color, border-color",
                },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: selected ? theme.primary : theme.textMuted },
                ]}
                numberOfLines={2}
              >
                {option.label}
              </Text>
            </MotionPressable>
          </FeedbackMotion>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    borderWidth: borders.standard,
    borderRadius: radii.large,
    padding: spacing[1],
    gap: spacing[1],
  },
  option: {
    flex: 1,
    minHeight: controls.buttonHeight,
    borderWidth: borders.standard,
    borderBottomWidth: borders.tactileDepth,
    borderRadius: radii.small,
    paddingHorizontal: spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  optionWrap: { flex: 1 },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
    textAlign: "center",
  },
});
