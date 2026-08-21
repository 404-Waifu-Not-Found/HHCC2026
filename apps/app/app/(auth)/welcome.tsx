import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { useSettings } from "../../src/providers/SettingsProvider";
import { typography } from "../../src/theme/tokens";

export default function WelcomeScreen() {
  const { t, theme } = useSettings();
  return (
    <AuthShell title={t("tagline")} subtitle={t("welcomeSubtitle")}>
      <Link href="/(auth)/sign-up" asChild>
        <PrimaryButton onPress={() => undefined}>{t("signUp")}</PrimaryButton>
      </Link>
      <Link href="/(auth)/sign-in" asChild>
        <PrimaryButton variant="ghost" onPress={() => undefined}>{t("signIn")}</PrimaryButton>
      </Link>
      <View style={styles.languages}>
        <LanguageButton locale="en" label="English" />
        <LanguageButton locale="zh-CN" label="简体中文" />
      </View>
    </AuthShell>
  );
}

function LanguageButton({ locale, label }: { locale: "en" | "zh-CN"; label: string }) {
  const settings = useSettings();
  return (
    <Text
      accessibilityRole="button"
      onPress={() => settings.setLocale(locale)}
      style={[
        styles.language,
        { color: settings.locale === locale ? settings.theme.text : settings.theme.textMuted },
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  languages: { flexDirection: "row", justifyContent: "center", gap: 22, marginTop: 4 },
  language: { minHeight: 44, paddingVertical: 12, fontFamily: typography.bodyBold, fontSize: 14 },
});
