import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import {
  borders,
  controls,
  motion,
  radii,
  spacing,
  typography,
} from "../theme/tokens";

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
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed, hovered }) => [
              styles.option,
              {
                backgroundColor: selected ? theme.surface : "transparent",
                borderColor: selected ? theme.primary : "transparent",
                transform: [{ translateY: pressed ? 1 : hovered ? -1 : 0 }],
              },
              selected && styles.selected,
              Platform.OS === "web" && {
                transitionDuration: `${motion.fast}ms`,
                transitionProperty: "transform, background-color, border-color",
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
          </Pressable>
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
    borderRadius: radii.small,
    paddingHorizontal: spacing[2],
    alignItems: "center",
    justifyContent: "center",
  },
  selected: {
    borderBottomWidth: borders.tactileDepth,
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
    textAlign: "center",
  },
});
