import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { typography } from "../../src/theme/tokens";

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { theme } = useSettings();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!token) return setError("This reset link is missing its token.");
    setLoading(true);
    const result = await authClient.resetPassword({ token, newPassword: password });
    setLoading(false);
    if (result.error) return setError(result.error.message ?? "This reset link is invalid or expired.");
    router.replace("/(auth)/sign-in");
  };
  return (
    <AuthShell title="Choose a new password">
      <AppTextInput label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      {error ? <Text accessibilityRole="alert" style={{ color: theme.error, fontFamily: typography.bodyMedium }}>{error}</Text> : null}
      <PrimaryButton loading={loading} disabled={password.length < 8} onPress={() => void submit()}>Save new password</PrimaryButton>
    </AuthShell>
  );
}

