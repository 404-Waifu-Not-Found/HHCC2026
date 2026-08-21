import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Mascot } from "./Mascot";
import { Screen } from "./Screen";
import { useSettings } from "../providers/SettingsProvider";
import { typography } from "../theme/tokens";

export function AuthShell({ title, subtitle, children, footer }: PropsWithChildren<{ title: string; subtitle?: string; footer?: ReactNode }>) {
  const { theme } = useSettings();
  const { width } = useWindowDimensions();
  return (
    <Screen>
      <View style={[styles.page, width >= 900 && styles.pageWide]}>
        <View style={styles.intro}>
          <Mascot mood="ready" size={110} />
          <Text style={[styles.brand, { color: theme.text }]}>ClipQuest</Text>
          <Text style={[styles.tagline, { color: theme.textMuted }]}>Paste a video → quiz → build mastery</Text>
        </View>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
          {subtitle ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text> : null}
          <View style={styles.form}>{children}</View>
          {footer}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    paddingVertical: 24,
  },
  pageWide: { flexDirection: "row", gap: 44, paddingVertical: 30 },
  intro: { flexShrink: 1, alignItems: "center", width: "100%", maxWidth: 430, gap: 8 },
  brand: { fontFamily: typography.display, fontSize: 44, letterSpacing: -1.5, textAlign: "center" },
  tagline: { fontFamily: typography.bodyMedium, fontSize: 17, textAlign: "center" },
  card: {
    width: "100%",
    minWidth: 0,
    maxWidth: 460,
    padding: 26,
    borderRadius: 26,
    borderWidth: 2,
  },
  title: { fontFamily: typography.display, fontSize: 31, marginBottom: 4 },
  subtitle: { fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  form: { gap: 16, marginTop: 22 },
});
