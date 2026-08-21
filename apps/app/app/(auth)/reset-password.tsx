import { VoxelIcon } from "../../src/components/VoxelIcon";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Surface } from "../../src/components/Surface";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

export default function ResetPasswordScreen() {
  const { token, error: linkError } = useLocalSearchParams<{
    token?: string;
    error?: string;
  }>();
  const { t, theme } = useSettings();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(() =>
    linkError
      ? t("invalidResetLink")
      : !token
        ? t("missingResetToken")
        : undefined,
  );
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!token || linkError || password.length < 8 || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      if (result.error)
        return setError(result.error.message ?? t("invalidResetLink"));
      router.replace("/(auth)/sign-in");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("invalidResetLink"));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title={t("chooseNewPassword")}>
      <AppTextInput
        label={t("newPassword")}
        value={password}
        onChangeText={setPassword}
        leading={
          <VoxelIcon name="password" size={22} color={theme.textMuted} />
        }
        secureTextEntry
        autoComplete="new-password"
        editable={!loading && Boolean(token) && !linkError}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {error ? (
        <Surface tone="error" style={styles.status}>
          <View style={styles.statusRow}>
            <VoxelIcon name="error" size={22} color={theme.error} />
            <Text
              accessibilityRole="alert"
              selectable
              style={[styles.statusText, { color: theme.text }]}
            >
              {error}
            </Text>
          </View>
        </Surface>
      ) : null}
      <PrimaryButton
        loading={loading}
        disabled={password.length < 8 || !token || Boolean(linkError)}
        leadingIcon={
          <VoxelIcon name="password" size={21} color={theme.textOnAction} />
        }
        onPress={() => void submit()}
      >
        {t("saveNewPassword")}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  status: { padding: spacing[4] },
  statusRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
  },
  statusText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
