import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { typography } from "../../src/theme/tokens";

export default function SignInScreen() {
  const { t, theme } = useSettings();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const canSubmit = Boolean(identifier.trim() && password.length >= 8);

  const submit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = identifier.includes("@")
        ? await authClient.signIn.email({ email: identifier.trim().toLowerCase(), password })
        : await authClient.signIn.username({ username: identifier.trim().toLowerCase(), password });
      if (result.error) {
        setError(result.error.message ?? t("signInFailed"));
        return;
      }
      router.replace("/(tabs)");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signInFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("signIn")}
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>{t("newToClipQuest")}</Text>
          <Link href="/(auth)/sign-up" style={[styles.link, styles.footerLink, { color: theme.text }]}>{t("signUp")}</Link>
        </View>
      }
    >
      <AppTextInput
        label={`${t("email")} / ${t("username")}`}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoComplete="username"
        returnKeyType="next"
        editable={!loading}
      />
      <AppTextInput
        label={t("password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        returnKeyType="done"
        editable={!loading}
        onSubmitEditing={() => void submit()}
      />
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
      <Pressable accessibilityRole="link" onPress={() => router.push("/(auth)/forgot-password")} style={styles.forgot}>
        <Text style={[styles.link, { color: theme.text }]}>{t("forgotPassword")}</Text>
      </Pressable>
      <PrimaryButton loading={loading} disabled={!canSubmit} onPress={() => void submit()}>
        {t("signIn")}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { fontFamily: typography.bodyMedium, fontSize: 14 },
  forgot: { minHeight: 44, justifyContent: "center", alignSelf: "flex-end" },
  link: { fontFamily: typography.bodyBold, fontSize: 14 },
  footer: { marginTop: 22, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 6 },
  footerText: { fontFamily: typography.body, fontSize: 14 },
  footerLink: { minHeight: 44, paddingVertical: 12 },
});
