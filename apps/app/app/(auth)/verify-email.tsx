import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { typography } from "../../src/theme/tokens";

export default function VerifyEmailScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { t, theme } = useSettings();
  const [message, setMessage] = useState<string>();
  const resend = async () => {
    if (!email) return;
    await authClient.sendVerificationEmail({ email, callbackURL: "/" });
    setMessage("Verification email sent again.");
  };
  return (
    <AuthShell title={t("verifyEmail")} subtitle={t("verifyEmailBody")}>
      {email ? <Text style={{ color: theme.text, fontFamily: typography.bodyBold }}>{email}</Text> : null}
      {message ? <Text accessibilityRole="alert" style={{ color: theme.success, fontFamily: typography.bodyMedium }}>{message}</Text> : null}
      <PrimaryButton variant="ghost" disabled={!email} onPress={() => void resend()}>Send again</PrimaryButton>
      <PrimaryButton onPress={() => router.replace("/(auth)/sign-in")}>{t("signIn")}</PrimaryButton>
    </AuthShell>
  );
}

