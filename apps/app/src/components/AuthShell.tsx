import type { PropsWithChildren, ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSettings } from "../providers/SettingsProvider";
import { breakpoints, spacing, typography } from "../theme/tokens";
import { BrandLockup } from "./BrandLockup";
import { Screen } from "./Screen";
import { MotionView } from "../motion/Motion";

type AuthShellVariant = "form" | "welcome" | "split";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  cornerAction,
  variant = "form",
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  cornerAction?: ReactNode;
  variant?: AuthShellVariant;
}>) {
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;
  const welcome = variant === "welcome";
  const splitDesktop = variant === "split" && desktop;

  const formColumn = (
    <MotionView
      preset={splitDesktop ? "from-right" : "rise"}
      delay={80}
      style={[styles.formColumn, welcome && styles.welcomeColumn]}
    >
      <MotionView preset="rise" delay={120}>
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
      </MotionView>
      {subtitle ? (
        <MotionView preset="rise" delay={164}>
          <Text
            style={[
              styles.subtitle,
              !welcome && styles.formSubtitle,
              { color: theme.textMuted },
            ]}
          >
            {subtitle}
          </Text>
        </MotionView>
      ) : null}
      <MotionView preset="rise" delay={208} style={styles.form}>
        {children}
      </MotionView>
      {footer ? (
        <MotionView preset="fade" delay={252} style={styles.footer}>
          {footer}
        </MotionView>
      ) : null}
    </MotionView>
  );

  const screen = (
    <Screen
      contentWidth={splitDesktop ? "full" : welcome ? "wide" : "auth"}
      centered
      padded={!splitDesktop}
    >
      <View
        style={[
          styles.page,
          Platform.OS === "web" && styles.webNoSelection,
          welcome && styles.welcomePage,
          welcome && desktop && styles.welcomePageWide,
          !welcome && !splitDesktop && styles.formPage,
          splitDesktop && styles.splitPage,
        ]}
      >
        {splitDesktop ? (
          <>
            <MotionView
              preset="from-left"
              testID="auth-split-brand-pane"
              style={[
                styles.splitPane,
                { backgroundColor: theme.surfaceSunken },
              ]}
            >
              <View style={styles.splitBrand}>
                <BrandLockup
                  centered
                  size="hero"
                  testID="clipquest-auth-wordmark"
                />
                <View style={styles.splitBrandCopy}>
                  <Text
                    testID="auth-split-tagline"
                    style={[styles.splitTagline, { color: theme.text }]}
                  >
                    {t("authShellTagline")}
                  </Text>
                </View>
              </View>
            </MotionView>
            <MotionView
              preset="fade"
              delay={140}
              testID="auth-split-divider"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.splitDivider,
                { backgroundColor: theme.divider },
                Platform.OS === "web"
                  ? {
                      boxShadow:
                        theme.mode === "dark"
                          ? "28px 0 28px -10px rgba(0, 0, 0, 0.42)"
                          : "24px 0 24px -8px rgba(25, 104, 58, 0.18)",
                    }
                  : {
                      shadowColor:
                        theme.mode === "dark"
                          ? theme.surfaceSunken
                          : theme.primaryPressed,
                      shadowOffset: { width: 24, height: 0 },
                      shadowOpacity: 0.3,
                      shadowRadius: 20,
                      elevation: 8,
                    },
              ]}
            />
            <MotionView
              preset="from-right"
              testID="auth-split-form-pane"
              style={[
                styles.splitPane,
                {
                  backgroundColor:
                    theme.mode === "dark"
                      ? theme.backgroundAccent
                      : theme.background,
                },
              ]}
            >
              {formColumn}
            </MotionView>
          </>
        ) : (
          <>
            {welcome && desktop ? (
              <MotionView preset="from-left" style={styles.intro}>
                <BrandLockup centered size="hero" />
                <View style={styles.brandCopy}>
                  <Text style={[styles.tagline, { color: theme.text }]}>
                    {t("authShellTagline")}
                  </Text>
                  <Text style={[styles.detail, { color: theme.textMuted }]}>
                    {t("authShellDetail")}
                  </Text>
                </View>
              </MotionView>
            ) : (
              <MotionView
                preset="drop"
                style={[styles.compactBrand, welcome && styles.welcomeBrand]}
              >
                <BrandLockup centered size={welcome ? "standard" : "compact"} />
              </MotionView>
            )}
            {formColumn}
            {cornerAction && !desktop ? (
              <MotionView
                preset="fade"
                delay={260}
                style={styles.cornerActionInline}
              >
                {cornerAction}
              </MotionView>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );

  return (
    <View style={[styles.shell, { backgroundColor: theme.background }]}>
      {screen}
      {cornerAction && desktop ? (
        <MotionView
          preset="from-right"
          delay={260}
          style={styles.cornerActionDesktop}
        >
          {cornerAction}
        </MotionView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    position: "relative",
  },
  page: {
    width: "100%",
    alignItems: "stretch",
    justifyContent: "center",
  },
  webNoSelection: {
    userSelect: "none",
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
  splitPage: {
    position: "relative",
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
  },
  splitPane: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[12],
    paddingVertical: spacing[10],
  },
  splitDivider: {
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    zIndex: 1,
    width: 1,
  },
  splitBrand: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[6],
  },
  splitBrandCopy: {
    alignItems: "center",
    gap: spacing[2],
  },
  splitTagline: {
    maxWidth: 440,
    textAlign: "center",
    fontFamily: typography.displayMedium,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
    letterSpacing: -0.5,
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
  cornerActionDesktop: {
    position: "absolute",
    right: spacing[8],
    bottom: spacing[8],
    zIndex: 2,
    alignItems: "flex-end",
  },
  cornerActionInline: {
    alignItems: "flex-end",
    marginTop: spacing[1],
  },
});
