import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";

export function StatTile({ value, label, icon, tone = "primary" }: { value: string; label: string; icon?: ReactNode; tone?: "primary" | "success" | "warning" | "secondary" }) {
  const { theme } = useSettings();
  const color = tone === "success" ? theme.success : tone === "warning" ? theme.warning : tone === "secondary" ? theme.secondary : theme.primary;
  return (
    <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}> 
      <View style={styles.valueRow}>{icon}<Text style={[styles.value, { color }]}>{value}</Text></View>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    minWidth: 132,
    flex: 1,
    gap: spacing[1],
    borderWidth: borders.standard,
    borderRadius: radii.large,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  value: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  label: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
