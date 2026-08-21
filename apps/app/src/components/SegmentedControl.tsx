import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { radii, typography } from "../theme/tokens";

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
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.group, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.value)}
            style={[styles.option, selected && { backgroundColor: theme.primary }]}
          >
            <Text style={[styles.label, { color: theme.text }]} numberOfLines={2}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", borderWidth: 2, borderRadius: radii.medium, padding: 4, gap: 4 },
  option: { flex: 1, minHeight: 46, borderRadius: radii.small, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: typography.bodyBold, fontSize: 13, textAlign: "center" },
});
