import { VoxelIcon } from "../../src/components/VoxelIcon";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Surface } from "../../src/components/Surface";
import { authClient } from "../../src/lib/auth-client";
import {
  parseNextPath,
  type AuthNextSearchParams,
} from "../../src/lib/auth-next";
import { useSettings } from "../../src/providers/SettingsProvider";
import { spacing, typography } from "../../src/theme/tokens";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<
    { email?: string } & AuthNextSearchParams
  >();
  const email = params.email;
  const next = parseNextPath(params);
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
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: "/sign-in",
      });
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
      <Surface elevated style={styles.actionCard}>
        <View
          style={[styles.mailBadge, { backgroundColor: theme.primarySoft }]}
        >
          <VoxelIcon name="mail" size={34} color={theme.primary} />
        </View>
        {email ? (
          <Surface tone="tinted" style={styles.emailCard}>
            <View style={styles.statusRow}>
              <Text selectable style={[styles.email, { color: theme.text }]}>
                {email}
              </Text>
            </View>
          </Surface>
        ) : null}
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
        <View style={styles.actions}>
          <PrimaryButton
            leadingIcon={
              <VoxelIcon name="sign-in" size={21} color={theme.textOnAction} />
            }
            onPress={() =>
              router.replace(
                next
                  ? { pathname: "/(auth)/sign-in", params: { next } }
                  : "/(auth)/sign-in",
              )
            }
          >
            {t("signIn")}
          </PrimaryButton>
          <PrimaryButton
            variant="ghost"
            loading={loading}
            disabled={!email}
            leadingIcon={<VoxelIcon name="mail" size={21} color={theme.text} />}
            onPress={() => void resend()}
          >
            {t("sendAgain")}
          </PrimaryButton>
        </View>
      </Surface>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    gap: spacing[4],
  },
  mailBadge: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  emailCard: { padding: spacing[4] },
  email: {
    flex: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  actions: { gap: spacing[3], marginTop: spacing[1] },
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
