import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Surface } from "../../src/components/Surface";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";
import { FeedbackMotion, MotionView } from "../../src/motion/Motion";

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
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        editable={!loading}
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />
      {message ? (
        <FeedbackMotion signal={message} kind="success">
          <MotionView preset="rise" exiting>
            <Surface tone="success" style={styles.status}>
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.statusText, { color: theme.text }]}
              >
                {message}
              </Text>
            </Surface>
          </MotionView>
        </FeedbackMotion>
      ) : null}
      {error ? (
        <FeedbackMotion signal={error} kind="error">
          <MotionView preset="rise" exiting>
            <Surface tone="error" style={styles.status}>
              <Text
                accessibilityRole="alert"
                selectable
                style={[styles.statusText, { color: theme.text }]}
              >
                {error}
              </Text>
            </Surface>
          </MotionView>
        </FeedbackMotion>
      ) : null}
      <PrimaryButton
        loading={loading}
        disabled={!email.includes("@")}
        onPress={() => void submit()}
      >
        {t("sendResetLink")}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  status: { padding: spacing[4] },
  statusText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
});
