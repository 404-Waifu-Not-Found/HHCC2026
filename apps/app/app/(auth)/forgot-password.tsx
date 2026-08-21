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
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    await authClient.requestPasswordReset({ email: email.trim().toLowerCase(), redirectTo: "/(auth)/reset-password" });
    setLoading(false);
    setMessage("If that account exists, a password-reset link is on its way.");
  };
  return (
    <AuthShell title={t("forgotPassword")} subtitle="We’ll email you a short-lived reset link.">
      <AppTextInput label={t("email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      {message ? <Text accessibilityRole="alert" style={{ color: theme.success, fontFamily: typography.bodyMedium }}>{message}</Text> : null}
      <PrimaryButton loading={loading} disabled={!email.includes("@")} onPress={() => void submit()}>Send reset link</PrimaryButton>
    </AuthShell>
  );
}

