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
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const resend = async () => {
    if (!email || loading) return;
    setLoading(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: "/sign-in" });
      if (result.error) {
        setError(result.error.message ?? t("emailSendFailed"));
        return;
      }
      setMessage(t("verificationSentAgain"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("emailSendFailed"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title={t("verifyEmail")} subtitle={t("verifyEmailBody")}>
      {email ? <Text style={{ color: theme.text, fontFamily: typography.bodyBold }}>{email}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.success, fontFamily: typography.bodyMedium }}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.error, fontFamily: typography.bodyMedium }}>{error}</Text> : null}
      <PrimaryButton variant="ghost" loading={loading} disabled={!email} onPress={() => void resend()}>{t("sendAgain")}</PrimaryButton>
      <PrimaryButton onPress={() => router.replace("/(auth)/sign-in")}>{t("signIn")}</PrimaryButton>
    </AuthShell>
  );
}
