import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { spacing, typography } from "../theme/tokens";

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  const { theme } = useSettings();
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  copy: { flex: 1, gap: spacing[1] },
  title: { fontFamily: typography.displayMedium, fontSize: typography.size.titleSmall, lineHeight: typography.lineHeight.titleSmall },
  subtitle: { fontFamily: typography.body, fontSize: typography.size.label, lineHeight: typography.lineHeight.label },
});
