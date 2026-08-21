import { VoxelIcon } from "../../src/components/VoxelIcon";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Surface } from "../../src/components/Surface";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

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
      const result = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: "/reset-password",
      });
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
    <AuthShell
      title={t("forgotPassword")}
      subtitle={t("forgotPasswordSubtitle")}
    >
      <AppTextInput
        label={t("email")}
        value={email}
        onChangeText={setEmail}
        leading={<VoxelIcon name="mail" size={22} color={theme.textMuted} />}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        editable={!loading}
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />
      {message ? (
        <Surface tone="success" style={styles.status}>
          <View style={styles.statusRow}>
            <VoxelIcon name="correct" size={22} color={theme.success} />
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.statusText, { color: theme.text }]}
            >
              {message}
            </Text>
          </View>
        </Surface>
      ) : null}
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
        disabled={!email.includes("@")}
        leadingIcon={
          <VoxelIcon name="mail" size={21} color={theme.textOnAction} />
        }
        onPress={() => void submit()}
      >
        {t("sendResetLink")}
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
