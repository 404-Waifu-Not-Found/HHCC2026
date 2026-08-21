import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { typography } from "../theme/tokens";

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const { theme } = useSettings();
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, fontFamily: typography.displayMedium, fontSize: 22, lineHeight: 27 },
});
