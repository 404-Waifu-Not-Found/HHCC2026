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

  const submit = async () => {
    setLoading(true);
    setError(undefined);
    const result = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier.trim(), password })
      : await authClient.signIn.username({ username: identifier.trim().toLowerCase(), password });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-in failed.");
      return;
    }
    router.replace("/(tabs)");
  };

  return (
    <AuthShell
      title={t("signIn")}
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>New to ClipQuest?</Text>
          <Link href="/(auth)/sign-up" style={[styles.link, { color: theme.text }]}>{t("signUp")}</Link>
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
      />
      <AppTextInput
        label={t("password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={() => void submit()}
      />
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
      <Pressable accessibilityRole="link" onPress={() => router.push("/(auth)/forgot-password")} style={styles.forgot}>
        <Text style={[styles.link, { color: theme.text }]}>{t("forgotPassword")}</Text>
      </Pressable>
      <PrimaryButton loading={loading} disabled={!identifier.trim() || password.length < 8} onPress={() => void submit()}>
        {t("signIn")}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  error: { fontFamily: typography.bodyMedium, fontSize: 14 },
  forgot: { minHeight: 44, justifyContent: "center", alignSelf: "flex-end" },
  link: { fontFamily: typography.bodyBold, fontSize: 14 },
  footer: { marginTop: 22, flexDirection: "row", justifyContent: "center", gap: 6 },
  footerText: { fontFamily: typography.body, fontSize: 14 },
});

