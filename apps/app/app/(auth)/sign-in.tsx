import { VoxelIcon } from "../../src/components/VoxelIcon";
import { Link, router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { AuthShell } from "../../src/components/AuthShell";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Surface } from "../../src/components/Surface";
import { authClient } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { radii, spacing, typography } from "../../src/theme/tokens";

export default function SignInScreen() {
  const { t, theme } = useSettings();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const canSubmit = Boolean(identifier.trim() && password.length >= 8);

  const submit = async () => {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = identifier.includes("@")
        ? await authClient.signIn.email({
            email: identifier.trim().toLowerCase(),
            password,
          })
        : await authClient.signIn.username({
            username: identifier.trim().toLowerCase(),
            password,
          });
      if (result.error) {
        setError(result.error.message ?? t("signInFailed"));
        return;
      }
      router.replace("/(tabs)");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signInFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("welcomeBack")}
      subtitle={t("welcomeBackSubtitle")}
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>
            {t("newToClipQuest")}
          </Text>
          <Link
            href="/(auth)/sign-up"
            style={[styles.link, styles.footerLink, { color: theme.text }]}
          >
            {t("signUp")}
          </Link>
        </View>
      }
    >
      <AppTextInput
        label={`${t("email")} / ${t("username")}`}
        labelPlacement="inside"
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoComplete="username"
        returnKeyType="next"
        editable={!loading}
      />
      <AppTextInput
        label={t("password")}
        labelPlacement="inside"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        returnKeyType="done"
        editable={!loading}
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
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push("/(auth)/forgot-password")}
        style={({ pressed }) => [
          styles.forgot,
          { backgroundColor: pressed ? theme.surfaceTint : "transparent" },
        ]}
      >
        <Text style={[styles.link, { color: theme.primary }]}>
          {t("forgotPassword")}
        </Text>
      </Pressable>
      <PrimaryButton
        loading={loading}
        disabled={!canSubmit}
        onPress={() => void submit()}
      >
        {t("signIn")}
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
  forgot: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    borderRadius: radii.medium,
    paddingHorizontal: spacing[2],
  },
  link: { fontFamily: typography.bodyBold, fontSize: typography.size.label },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  footerText: { fontFamily: typography.body, fontSize: typography.size.label },
  footerLink: { minHeight: 44, paddingVertical: spacing[3] },
});
