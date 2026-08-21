import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { borders, layout, spacing, typography } from "../theme/tokens";

export function FeedbackPanel({
  status,
  title,
  detail,
  action,
  children,
}: PropsWithChildren<{
  status: "correct" | "incorrect" | "neutral";
  title: string;
  detail?: string;
  action?: ReactNode;
}>) {
  const { theme } = useSettings();
  const isCorrect = status === "correct";
  const isIncorrect = status === "incorrect";
  const color = isCorrect ? theme.success : isIncorrect ? theme.error : theme.primary;
  const background = isCorrect ? theme.successSoft : isIncorrect ? theme.errorSoft : theme.surface;
  const icon = isCorrect ? "check-circle" : isIncorrect ? "alert-circle" : "lightbulb-on";

  return (
    <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={[styles.panel, { backgroundColor: background, borderTopColor: color }]}> 
      <View style={styles.inner}>
        <View style={[styles.icon, { borderColor: color }]}> 
          <MaterialCommunityIcons name={icon} color={color} size={28} />
        </View>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color }]}>{title}</Text>
          {detail ? <Text selectable style={[styles.detail, { color: theme.text }]}>{detail}</Text> : null}
          {children}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    minHeight: layout.feedbackMinHeight,
    borderTopWidth: borders.selected,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[4],
  },
  inner: {
    width: "100%",
    maxWidth: layout.lesson,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[4],
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: borders.standard,
    borderRadius: 23,
    backgroundColor: "rgba(255,255,255,0.68)",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[2],
  },
  title: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  detail: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  action: {
    minWidth: 180,
  },
});
