import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { breakpoints, spacing, typography } from "../theme/tokens";
import { LearningPrism } from "./LearningPrism";
import { Screen } from "./Screen";

type AuthShellVariant = "form" | "welcome";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  variant = "form",
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  variant?: AuthShellVariant;
}>) {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;
  const welcome = variant === "welcome";

  return (
    <Screen contentWidth={welcome ? "wide" : "auth"} centered>
      <View
        style={[
          styles.page,
          welcome && styles.welcomePage,
          welcome && desktop && styles.welcomePageWide,
          !welcome && styles.formPage,
        ]}
      >
        {welcome && desktop ? (
          <View style={styles.intro}>
            <LearningPrism size={292} variant="hero" />
            <View style={styles.brandCopy}>
              <Text style={[styles.kicker, { color: theme.primary }]}>
                {t("appName")}
              </Text>
              <Text style={[styles.tagline, { color: theme.text }]}>
                {t("authShellTagline")}
              </Text>
              <Text style={[styles.detail, { color: theme.textMuted }]}>
                {t("authShellDetail")}
              </Text>
            </View>
          </View>
        ) : (
          <View style={[styles.compactBrand, welcome && styles.welcomeBrand]}>
            <LearningPrism size={welcome ? 72 : 64} />
            <Text style={[styles.compactBrandName, { color: theme.primary }]}>
              {t("appName")}
            </Text>
          </View>
        )}
        <View style={[styles.formColumn, welcome && styles.welcomeColumn]}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              !welcome && styles.formTitle,
              { color: theme.text },
            ]}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                !welcome && styles.formSubtitle,
                { color: theme.textMuted },
              ]}
            >
              {subtitle}
            </Text>
          ) : null}
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
  },
  welcomePage: {
    gap: spacing[7],
    paddingVertical: spacing[4],
  },
  welcomePageWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[20],
    paddingVertical: spacing[12],
  },
  formPage: {
    paddingVertical: spacing[10],
  },
  intro: {
    flex: 1,
    minWidth: 0,
    maxWidth: 500,
    alignItems: "center",
    gap: spacing[6],
  },
  brandCopy: {
    width: "100%",
    maxWidth: 460,
    gap: spacing[2],
  },
  compactBrand: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    marginBottom: spacing[8],
  },
  welcomeBrand: {
    marginBottom: 0,
  },
  compactBrandName: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  kicker: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    letterSpacing: typography.tracking.wide,
    textTransform: "uppercase",
  },
  tagline: {
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
    letterSpacing: typography.tracking.tight,
  },
  detail: {
    maxWidth: 400,
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formColumn: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  welcomeColumn: {
    maxWidth: 460,
  },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    letterSpacing: -0.5,
  },
  formTitle: {
    textAlign: "center",
  },
  subtitle: {
    marginTop: spacing[2],
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  formSubtitle: {
    textAlign: "center",
  },
  form: {
    gap: spacing[4],
    marginTop: spacing[6],
  },
  footer: {
    marginTop: spacing[5],
  },
});
