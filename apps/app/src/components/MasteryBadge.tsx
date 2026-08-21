import type { AppTheme } from "../theme/tokens";
import type { MessageKey } from "../i18n/messages";
import type { MasteryState } from "@clipquest/contracts";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, radii, spacing, typography } from "../theme/tokens";

type MasteryIcon = "correct" | "idea" | "progress" | "target" | "warning";

const masteryMetadata: Record<
  MasteryState,
  { labelKey: MessageKey; icon: MasteryIcon }
> = {
  not_started: { labelKey: "notStarted", icon: "progress" },
  basic: { labelKey: "basic", icon: "warning" },
  intermediate: { labelKey: "intermediate", icon: "progress" },
  expert: { labelKey: "expert", icon: "idea" },
  mastered: { labelKey: "mastered", icon: "correct" },
};

export function masteryPresentation(state: MasteryState) {
  return masteryMetadata[state];
}

export function masteryColors(
  state: MasteryState,
  theme: AppTheme,
): { color: string; backgroundColor: string } {
  switch (state) {
    case "mastered":
      return { color: theme.success, backgroundColor: theme.successSoft };
    case "expert":
      return { color: theme.secondary, backgroundColor: theme.secondarySoft };
    case "intermediate":
      return { color: theme.warningText, backgroundColor: theme.warningSoft };
    case "basic":
      return { color: theme.error, backgroundColor: theme.errorSoft };
    default:
      return { color: theme.textMuted, backgroundColor: theme.surfaceSunken };
  }
}

export function masteryTone(
  state: MasteryState,
): "primary" | "success" | "warning" | "secondary" | "error" {
  switch (state) {
    case "mastered":
      return "success";
    case "expert":
      return "secondary";
    case "intermediate":
      return "warning";
    case "basic":
      return "error";
    default:
      return "primary";
  }
}

export function MasteryBadge({
  state,
  compact = false,
}: {
  state: MasteryState;
  compact?: boolean;
}) {
  const { t, theme } = useSettings();
  const metadata = masteryPresentation(state);
  const colors = masteryColors(state, theme);
  return (
    <View
      accessibilityLabel={`${t("mastery")}: ${t(metadata.labelKey)}`}
      style={[
        styles.badge,
        compact && styles.badgeCompact,
        {
          backgroundColor: colors.backgroundColor,
          borderColor: colors.color,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: colors.color }]} />
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          compact && styles.labelCompact,
          { color: colors.color },
        ]}
      >
        {t(metadata.labelKey)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing[2],
    borderWidth: borders.hairline,
    borderRadius: radii.pill,
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
  },
  badgeCompact: {
    paddingHorizontal: spacing[2],
    paddingVertical: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: 11,
    lineHeight: 15,
  },
  labelCompact: {
    fontSize: 10,
    lineHeight: 14,
  },
});
