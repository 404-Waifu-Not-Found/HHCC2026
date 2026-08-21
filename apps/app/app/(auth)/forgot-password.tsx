import { useState } from "react";
import { Text } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { typography } from "../../src/theme/tokens";

export default function ForgotPasswordScreen() {
  const { t, theme } = useSettings();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!email.includes("@") || loading) return;
    setLoading(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim().toLowerCase(), redirectTo: "/reset-password" });
      if (result.error) {
        setError(result.error.message ?? t("emailSendFailed"));
        return;
      }
      setMessage(t("resetEmailSent"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("emailSendFailed"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title={t("forgotPassword")} subtitle={t("forgotPasswordSubtitle")}>
      <AppTextInput label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!loading} returnKeyType="send" onSubmitEditing={() => void submit()} />
      {message ? <Text accessibilityLiveRegion="polite" style={{ color: theme.success, fontFamily: typography.bodyMedium }}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.error, fontFamily: typography.bodyMedium }}>{error}</Text> : null}
      <PrimaryButton loading={loading} disabled={!email.includes("@")} onPress={() => void submit()}>{t("sendResetLink")}</PrimaryButton>
    </AuthShell>
  );
}
