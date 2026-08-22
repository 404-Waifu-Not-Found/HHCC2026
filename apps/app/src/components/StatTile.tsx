import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";

export function StatTile({
  value,
  label,
  icon,
  tone = "primary",
  emphasis = false,
}: {
  value: string;
  label: string;
  icon?: ReactNode;
  tone?: "primary" | "success" | "warning" | "secondary" | "error";
  /** Lead stat: tinted surface, coloured rule, larger display value. */
  emphasis?: boolean;
}) {
  const { theme } = useSettings();
  const color =
    tone === "success"
      ? theme.success
      : tone === "warning"
        ? theme.warningText
        : tone === "secondary"
          ? theme.secondary
          : tone === "error"
            ? theme.error
            : theme.primary;
  const soft =
    tone === "success"
      ? theme.successSoft
      : tone === "warning"
        ? theme.warningSoft
        : tone === "secondary"
          ? theme.secondarySoft
          : tone === "error"
            ? theme.errorSoft
            : theme.primarySoft;
  return (
    <View
      style={[
        styles.tile,
        emphasis && styles.tileEmphasis,
        {
          backgroundColor: emphasis ? soft : theme.surface,
          borderColor: emphasis ? color : theme.border,
        },
      ]}
    >
      <View style={styles.valueRow}>
        {icon}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          style={[styles.value, emphasis && styles.valueEmphasis, { color }]}
        >
          {value}
        </Text>
      </View>
      <Text
        style={[
          styles.label,
          { color: emphasis ? theme.text : theme.textMuted },
        ]}
      >
        {label}
      </Text>
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
  tileEmphasis: {
    borderBottomWidth: borders.tactileDepth,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  value: {
    flexShrink: 1,
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  valueEmphasis: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  label: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
