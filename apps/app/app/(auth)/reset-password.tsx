import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { typography } from "../../src/theme/tokens";

export default function ResetPasswordScreen() {
  const { token, error: linkError } = useLocalSearchParams<{ token?: string; error?: string }>();
  const { t, theme } = useSettings();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (linkError) setError(t("invalidResetLink"));
    else if (!token) setError(t("missingResetToken"));
  }, [linkError, t, token]);

  const submit = async () => {
    if (!token || linkError || password.length < 8 || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) return setError(result.error.message ?? t("invalidResetLink"));
      router.replace("/(auth)/sign-in");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("invalidResetLink"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title={t("chooseNewPassword")}>
      <AppTextInput label={t("newPassword")} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" editable={!loading && Boolean(token) && !linkError} returnKeyType="done" onSubmitEditing={() => void submit()} />
      {error ? <Text accessibilityRole="alert" style={{ color: theme.error, fontFamily: typography.bodyMedium }}>{error}</Text> : null}
      <PrimaryButton loading={loading} disabled={password.length < 8 || !token || Boolean(linkError)} onPress={() => void submit()}>{t("saveNewPassword")}</PrimaryButton>
    </AuthShell>
  );
}
