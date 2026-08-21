import AsyncStorage from "@react-native-async-storage/async-storage";
import { identifyVideoSource } from "@clipquest/contracts";
import { Link, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { SegmentedControl } from "../../src/components/SegmentedControl";
import { Surface } from "../../src/components/Surface";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

export default function WelcomeScreen() {
  const { t, theme, locale, setLocale } = useSettings();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const continueWithLink = async () => {
    const trimmed = url.trim();
    if (!identifyVideoSource(trimmed)) {
      setError(t("pasteError"));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await AsyncStorage.setItem("clipquest:pending-url:v1", trimmed);
      router.push("/(auth)/sign-up");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthShell
      variant="welcome"
      title={t("tagline")}
      subtitle={t("welcomeSubtitle")}
    >
      <Surface tone="tinted" style={styles.linkStarter}>
        <AppTextInput
          label={t("pastePlaceholder")}
          accessibilityLabel={t("pastePlaceholder")}
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setError(undefined);
          }}
          placeholder="https://youtube.com/watch?v=…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          editable={!saving}
          large
          error={error}
          onSubmitEditing={() => void continueWithLink()}
        />
        <PrimaryButton
          loading={saving}
          disabled={!url.trim()}
          onPress={() => void continueWithLink()}
        >
          {t("makeQuest")}
        </PrimaryButton>
        <Text style={[styles.privacyNote, { color: theme.textMuted }]}>
          {t("welcomePrivacy")}
        </Text>
      </Surface>
      <View style={styles.accountRow}>
        <Text style={[styles.accountText, { color: theme.textMuted }]}>
          {t("alreadyHaveAccount")}
        </Text>
        <Link
          href="/(auth)/sign-in"
          style={[styles.accountLink, { color: theme.primary }]}
        >
          {t("signIn")}
        </Link>
      </View>
      <View style={styles.languageBlock}>
        <SegmentedControl
          label={t("appLanguage")}
          value={locale}
          onChange={setLocale}
          options={
            [
              { value: "en", label: "English" },
              { value: "zh-CN", label: "简体中文" },
            ] as const
          }
        />
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  linkStarter: {
    gap: spacing[5],
    padding: spacing[6],
  },
  privacyNote: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  accountText: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  accountLink: {
    minHeight: 44,
    paddingVertical: spacing[3],
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  languageBlock: {
    width: 228,
    alignSelf: "center",
    marginTop: -spacing[2],
  },
});
