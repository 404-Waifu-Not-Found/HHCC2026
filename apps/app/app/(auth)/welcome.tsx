import AsyncStorage from "@react-native-async-storage/async-storage";
import { identifyVideoSource } from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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
    <AuthShell title={t("tagline")} subtitle={t("welcomeSubtitle")}>
      <Surface tone="tinted" style={styles.linkStarter}>
        <View style={styles.linkHeading}>
          <View style={[styles.linkIcon, { backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons
              name="link-variant"
              size={23}
              color={theme.primary}
            />
          </View>
          <View style={styles.linkHeadingCopy}>
            <Text style={[styles.linkTitle, { color: theme.text }]}>
              {t("startWithVideo")}
            </Text>
            <Text style={[styles.linkHelp, { color: theme.textMuted }]}>
              {t("youtubeAuthNotRequired")}
            </Text>
          </View>
        </View>
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
          leading={
            <MaterialCommunityIcons
              name="play-box-multiple-outline"
              size={23}
              color={theme.textMuted}
            />
          }
          onSubmitEditing={() => void continueWithLink()}
        />
        <PrimaryButton
          loading={saving}
          disabled={!url.trim()}
          trailingIcon={
            <MaterialCommunityIcons
              name="arrow-right"
              size={21}
              color={theme.textOnAction}
            />
          }
          onPress={() => void continueWithLink()}
        >
          {t("makeQuest")}
        </PrimaryButton>
      </Surface>
      <View style={styles.orRow}>
        <View style={[styles.orLine, { backgroundColor: theme.divider }]} />
        <Text style={[styles.orText, { color: theme.textMuted }]}>
          {t("orContinue")}
        </Text>
        <View style={[styles.orLine, { backgroundColor: theme.divider }]} />
      </View>
      <Link href="/(auth)/sign-up" asChild>
        <PrimaryButton
          leadingIcon={
            <MaterialCommunityIcons
              name="account-plus-outline"
              size={21}
              color={theme.textOnAction}
            />
          }
          onPress={() => undefined}
        >
          {t("signUp")}
        </PrimaryButton>
      </Link>
      <Link href="/(auth)/sign-in" asChild>
        <PrimaryButton
          variant="ghost"
          leadingIcon={
            <MaterialCommunityIcons name="login" size={21} color={theme.text} />
          }
          onPress={() => undefined}
        >
          {t("signIn")}
        </PrimaryButton>
      </Link>
      <Surface tone="tinted" style={styles.reassurance}>
        <View style={styles.reassuranceRow}>
          <MaterialCommunityIcons
            name="account-lock-outline"
            size={24}
            color={theme.primary}
          />
          <Text style={[styles.reassuranceText, { color: theme.text }]}>
            {t("authCrossDevice")}
          </Text>
        </View>
      </Surface>
      <View style={styles.languageBlock}>
        <Text style={[styles.languageLabel, { color: theme.textMuted }]}>
          {t("appLanguage")}
        </Text>
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
    gap: spacing[4],
    padding: spacing[5],
  },
  linkHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  linkIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  linkHeadingCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  linkTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.bodyLarge,
    lineHeight: typography.lineHeight.bodyLarge,
  },
  linkHelp: {
    fontFamily: typography.body,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  orRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  orLine: {
    height: 1,
    flex: 1,
  },
  orText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    textTransform: "uppercase",
  },
  reassurance: {
    padding: spacing[4],
  },
  reassuranceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  reassuranceText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  languageBlock: {
    gap: spacing[2],
    marginTop: spacing[1],
  },
  languageLabel: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
});
