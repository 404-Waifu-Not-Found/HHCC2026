import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { radii, typography } from "../../src/theme/tokens";

export default function SignUpScreen() {
  const { t, theme } = useSettings();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(undefined);
    const normalizedUsername = username.trim().toLowerCase();
    const result = await authClient.signUp.email({
      name: username.trim(),
      username: normalizedUsername,
      displayUsername: username.trim(),
      email: email.trim().toLowerCase(),
      password,
      ageConfirmed,
      callbackURL: "/",
    });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Account creation failed.");
      return;
    }
    router.replace({ pathname: "/(auth)/verify-email", params: { email: email.trim() } });
  };

  return (
    <AuthShell
      title={t("signUp")}
      subtitle="Your progress stays synced across web, iPhone, and Android."
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>Already have an account?</Text>
          <Link href="/(auth)/sign-in" style={[styles.link, { color: theme.text }]}>{t("signIn")}</Link>
        </View>
      }
    >
      <AppTextInput
        label={t("username")}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoComplete="username-new"
        maxLength={24}
      />
      <AppTextInput
        label={t("email")}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <AppTextInput
        label={t("password")}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ageConfirmed }}
        onPress={() => setAgeConfirmed((value) => !value)}
        style={[styles.checkboxRow, { borderColor: theme.border }]}
      >
        <MaterialCommunityIcons
          name={ageConfirmed ? "checkbox-marked" : "checkbox-blank-outline"}
          size={27}
          color={ageConfirmed ? theme.secondary : theme.textMuted}
        />
        <Text style={[styles.checkboxText, { color: theme.text }]}>{t("ageConfirmation")}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
      <PrimaryButton
        loading={loading}
        disabled={!ageConfirmed || username.trim().length < 3 || !email.includes("@") || password.length < 8}
        onPress={() => void submit()}
      >
        {t("signUp")}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  checkboxRow: { minHeight: 52, borderWidth: 2, borderRadius: radii.medium, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  checkboxText: { flex: 1, fontFamily: typography.bodyMedium, fontSize: 14, lineHeight: 20 },
  error: { fontFamily: typography.bodyMedium, fontSize: 14 },
  footer: { marginTop: 22, flexDirection: "row", justifyContent: "center", gap: 6 },
  footerText: { fontFamily: typography.body, fontSize: 14 },
  link: { fontFamily: typography.bodyBold, fontSize: 14 },
});

