import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { breakpoints, borders, radii, spacing, typography } from "../theme/tokens";
import { Mascot } from "./Mascot";
import { Screen } from "./Screen";

export function AuthShell({ title, subtitle, children, footer }: PropsWithChildren<{ title: string; subtitle?: string; footer?: ReactNode }>) {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;
  return (
    <Screen contentWidth="wide" centered>
      <View style={[styles.page, desktop && styles.pageWide]}>
        <View style={[styles.intro, { backgroundColor: theme.backgroundAccent, borderColor: theme.border }]}> 
          <View style={styles.artRow}>
            <Mascot mood="ready" size={desktop ? 230 : 116} />
          </View>
          <View style={styles.brandCopy}>
            <View style={styles.kickerRow}>
              <MaterialCommunityIcons name="play-box-multiple" size={20} color={theme.primary} />
              <Text style={[styles.kicker, { color: theme.primary }]}>{t("appName")}</Text>
            </View>
            <Text style={[styles.tagline, { color: theme.text }]}>{t("authShellTagline")}</Text>
            <Text style={[styles.detail, { color: theme.textMuted }]}>Turn one useful video into a focused lesson you can finish.</Text>
          </View>
        </View>
        <View style={styles.formColumn}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, { color: theme.textMuted }]}>{subtitle}</Text> : null}
          <View style={styles.form}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: {
    width: "100%",
    alignItems: "stretch",
    justifyContent: "center",
    gap: spacing[8],
    paddingVertical: spacing[4],
  },
  pageWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[16],
    paddingVertical: spacing[10],
  },
  intro: {
    flex: 1.1,
    minWidth: 0,
    maxWidth: 560,
    alignSelf: "center",
    overflow: "hidden",
    borderWidth: borders.standard,
    borderRadius: radii.modal,
    padding: spacing[8],
    gap: spacing[5],
  },
  artRow: {
    alignItems: "center",
  },
  brandCopy: {
    gap: spacing[2],
  },
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  kicker: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  tagline: {
    maxWidth: 420,
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
    letterSpacing: typography.tracking.tight,
  },
  detail: {
    maxWidth: 420,
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formColumn: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: spacing[2],
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  form: {
    gap: spacing[4],
    marginTop: spacing[6],
  },
  footer: {
    marginTop: spacing[5],
  },
});
