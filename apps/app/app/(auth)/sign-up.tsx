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
import { borders, radii, spacing, typography } from "../../src/theme/tokens";

export default function SignUpScreen() {
  const { t, theme } = useSettings();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const canSubmit =
    ageConfirmed &&
    username.trim().length >= 3 &&
    email.includes("@") &&
    password.length >= 8;

  const submit = async () => {
    if (loading) return;
    if (!ageConfirmed) {
      setError(t("ageRequired"));
      return;
    }
    if (!canSubmit) return;
    setLoading(true);
    setError(undefined);
    try {
      const normalizedUsername = username.trim().toLowerCase();
      const normalizedEmail = email.trim().toLowerCase();
      const result = await authClient.signUp.email({
        name: username.trim(),
        username: normalizedUsername,
        displayUsername: username.trim(),
        email: normalizedEmail,
        password,
        ageConfirmed,
        callbackURL: "/sign-in",
      });
      if (result.error) {
        setError(result.error.message ?? t("signUpFailed"));
        return;
      }
      router.replace({
        pathname: "/(auth)/verify-email",
        params: { email: normalizedEmail },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signUpFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("signUp")}
      subtitle={t("authCrossDevice")}
      footer={
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: theme.textMuted }]}>
            {t("alreadyHaveAccount")}
          </Text>
          <Link
            href="/(auth)/sign-in"
            style={[styles.link, styles.footerLink, { color: theme.text }]}
          >
            {t("signIn")}
          </Link>
        </View>
      }
    >
      <AppTextInput
        label={t("username")}
        labelPlacement="inside"
        value={username}
        onChangeText={setUsername}
        leading={
          <VoxelIcon name="registration" size={22} color={theme.textMuted} />
        }
        autoCapitalize="none"
        autoComplete="username-new"
        maxLength={24}
        editable={!loading}
      />
      <AppTextInput
        label={t("email")}
        labelPlacement="inside"
        value={email}
        onChangeText={setEmail}
        leading={<VoxelIcon name="mail" size={22} color={theme.textMuted} />}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        editable={!loading}
      />
      <AppTextInput
        label={t("password")}
        labelPlacement="inside"
        value={password}
        onChangeText={setPassword}
        leading={
          <VoxelIcon name="password" size={22} color={theme.textMuted} />
        }
        secureTextEntry
        autoComplete="new-password"
        returnKeyType="done"
        editable={!loading}
        onSubmitEditing={() => void submit()}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ageConfirmed, disabled: loading }}
        disabled={loading}
        onPress={() => setAgeConfirmed((value) => !value)}
        style={({ pressed, hovered }) => [
          styles.checkboxRow,
          {
            backgroundColor: ageConfirmed
              ? theme.actionSoft
              : hovered
                ? theme.surfaceTint
                : theme.surface,
            borderColor: ageConfirmed
              ? theme.actionPressed
              : theme.borderStrong,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
          loading && styles.disabled,
        ]}
      >
        <VoxelIcon
          name={ageConfirmed ? "selected" : "selected"}
          size={29}
          color={ageConfirmed ? theme.actionPressed : theme.textMuted}
        />
        <Text style={[styles.checkboxText, { color: theme.text }]}>
          {t("ageConfirmation")}
        </Text>
      </Pressable>
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
        disabled={!canSubmit}
        leadingIcon={
          <VoxelIcon name="registration" size={21} color={theme.textOnAction} />
        }
        onPress={() => void submit()}
      >
        {t("signUp")}
      </PrimaryButton>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  checkboxRow: {
    minHeight: 64,
    borderWidth: borders.standard,
    borderRadius: radii.large,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  checkboxText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  disabled: { opacity: 0.6 },
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
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  footerText: { fontFamily: typography.body, fontSize: typography.size.label },
  link: { fontFamily: typography.bodyBold, fontSize: typography.size.label },
  footerLink: { minHeight: 44, paddingVertical: spacing[3] },
});
