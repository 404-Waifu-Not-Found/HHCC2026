import {
  PushRegisterRequestSchema,
  type AppLanguage,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { useAdminCopy } from "../../src/admin/copy";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Screen } from "../../src/components/Screen";
import { SegmentedControl } from "../../src/components/SegmentedControl";
import { Surface } from "../../src/components/Surface";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { authClient, useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  getLocalModelStatus,
  removeLocalModel,
} from "../../src/transcription/local-transcriber";
import type { ModelStatus } from "../../src/transcription/types";
import {
  breakpoints,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";

export default function SettingsScreen() {
  const adminCopy = useAdminCopy();
  const {
    t,
    theme,
    locale,
    setLocale,
    themeMode,
    setThemeMode,
    reduceMotion,
    setReduceMotion,
  } = useSettings();
  const { data: session } = useAppSession();
  const { width } = useWindowDimensions();
  const desktop = width >= breakpoints.desktop;
  const [model, setModel] = useState<ModelStatus>({
    cached: false,
    sizeBytes: null,
  });
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");

  useEffect(() => {
    void getLocalModelStatus()
      .then(setModel)
      .catch(() => undefined);
  }, []);

  const removeModel = async () => {
    setBusy("model");
    setError(undefined);
    try {
      const removed = await removeLocalModel();
      setModel({ cached: false, sizeBytes: model.sizeBytes });
      setMessage(removed ? t("removeModelConfirm") : t("modelNotDownloaded"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("removeModelFailed"));
    } finally {
      setBusy(undefined);
    }
  };

  const registerPush = async () => {
    setBusy("push");
    setError(undefined);
    try {
      const Notifications = await import("expo-notifications");
      if (Platform.OS !== "web" && !Device.isDevice)
        throw new Error(t("pushPhysicalDevice"));
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted)
        throw new Error(t("notificationPermissionDenied"));
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("study-reviews", {
          name: t("notifications"),
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as
        string | undefined;
      if (!projectId || projectId.startsWith("00000000"))
        throw new Error(t("pushNeedsEas"));
      const token = (await Notifications.getExpoPushTokenAsync({ projectId }))
        .data;
      const platform =
        Platform.OS === "ios"
          ? "ios"
          : Platform.OS === "android"
            ? "android"
            : "web";
      await apiRequest("/api/push/register", {
        method: "POST",
        body: jsonBody(
          PushRegisterRequestSchema.parse({ token, platform, locale }),
        ),
      });
      setMessage(t("remindersEnabled"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("remindersFailed"));
    } finally {
      setBusy(undefined);
    }
  };

  const signOut = async () => {
    if (busy) return;
    setBusy("signout");
    setError(undefined);
    try {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error(result.error.message ?? t("signOutFailed"));
      router.replace("/(auth)/welcome");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("signOutFailed"));
    } finally {
      setBusy(undefined);
    }
  };

  const deleteAccount = async () => {
    if (deletePassword.length < 8 || busy) return;
    setBusy("delete");
    setError(undefined);
    try {
      const result = await authClient.deleteUser({ password: deletePassword });
      if (result.error)
        throw new Error(result.error.message ?? t("deleteAccountFailed"));
      router.replace("/(auth)/welcome");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("deleteAccountFailed"),
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Screen contentWidth="wide">
      <View style={styles.heading}>
        <View
          style={[styles.headingIcon, { backgroundColor: theme.primarySoft }]}
        >
          <MaterialCommunityIcons
            name="cog-outline"
            size={28}
            color={theme.primary}
          />
        </View>
        <View style={styles.headingCopy}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.text }]}
          >
            {t("settings")}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {t("settingsSubtitle")}
          </Text>
        </View>
      </View>

      {message ? (
        <Surface tone="success" style={styles.notice}>
          <Notice icon="check-circle" color={theme.success} text={message} />
        </Surface>
      ) : null}
      {error ? (
        <Surface tone="error" style={styles.notice}>
          <Notice icon="alert-circle" color={theme.error} text={error} alert />
        </Surface>
      ) : null}

      <View style={[styles.grid, desktop && styles.gridDesktop]}>
        <View style={styles.column}>
          <SettingsSection title={t("account")} icon="account-circle-outline">
            <View style={styles.accountRow}>
              <View
                style={[styles.avatar, { backgroundColor: theme.actionSoft }]}
              >
                <Text style={[styles.avatarText, { color: theme.text }]}>
                  {initials(session?.user.name ?? session?.user.email ?? "CQ")}
                </Text>
              </View>
              <View style={styles.accountCopy}>
                <Text style={[styles.accountName, { color: theme.text }]}>
                  {session?.user.name ?? t("appName")}
                </Text>
                <Text style={[styles.accountEmail, { color: theme.textMuted }]}>
                  {session?.user.email}
                </Text>
              </View>
            </View>
            {session?.user.role === "admin" ||
            session?.user.role === "owner" ? (
              <PrimaryButton
                variant="secondary"
                onPress={() => router.push("/admin" as never)}
              >
                {adminCopy.openOperations}
              </PrimaryButton>
            ) : null}
            <PrimaryButton
              variant="ghost"
              loading={busy === "signout"}
              onPress={() => void signOut()}
            >
              {t("signOut")}
            </PrimaryButton>
            {confirmingDelete ? (
              <Surface tone="error" style={styles.deletePanel}>
                <Text style={[styles.warning, { color: theme.error }]}>
                  {t("deleteAccountBody")}
                </Text>
                <AppTextInput
                  label={t("password")}
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                  secureTextEntry
                  autoComplete="current-password"
                  editable={busy !== "delete"}
                  returnKeyType="done"
                  onSubmitEditing={() => void deleteAccount()}
                />
                <View style={styles.deleteActions}>
                  <View style={styles.deleteAction}>
                    <PrimaryButton
                      variant="ghost"
                      disabled={busy === "delete"}
                      onPress={() => {
                        setConfirmingDelete(false);
                        setDeletePassword("");
                      }}
                    >
                      {t("cancel")}
                    </PrimaryButton>
                  </View>
                  <View style={styles.deleteAction}>
                    <PrimaryButton
                      variant="danger"
                      loading={busy === "delete"}
                      disabled={deletePassword.length < 8}
                      onPress={() => void deleteAccount()}
                    >
                      {t("confirmDeleteAccount")}
                    </PrimaryButton>
                  </View>
                </View>
              </Surface>
            ) : (
              <PrimaryButton
                variant="ghost"
                disabled={Boolean(busy)}
                onPress={() => setConfirmingDelete(true)}
              >
                {t("deleteAccount")}
              </PrimaryButton>
            )}
          </SettingsSection>

          <SettingsSection title={t("notifications")} icon="bell-outline">
            <Text style={[styles.help, { color: theme.textMuted }]}>
              {t("remindersHelp")}
            </Text>
            <PrimaryButton
              variant="secondary"
              loading={busy === "push"}
              onPress={() => void registerPush()}
            >
              {t("enableNotifications")}
            </PrimaryButton>
          </SettingsSection>
        </View>

        <View style={styles.column}>
          <SettingsSection title={t("appearance")} icon="palette-outline">
            <FieldLabel>{t("theme")}</FieldLabel>
            <SegmentedControl
              label={t("theme")}
              value={themeMode}
              onChange={setThemeMode}
              options={
                [
                  { value: "system", label: t("system") },
                  { value: "light", label: t("light") },
                  { value: "dark", label: t("dark") },
                ] as const
              }
            />
            <FieldLabel>{t("appLanguage")}</FieldLabel>
            <SegmentedControl
              label={t("appLanguage")}
              value={locale}
              onChange={(value) => setLocale(value as AppLanguage)}
              options={
                [
                  { value: "en", label: t("languageEnglish") },
                  { value: "zh-CN", label: t("languageChinese") },
                ] as const
              }
            />
            <SettingSwitch
              label={t("reducedMotion")}
              value={reduceMotion}
              onChange={setReduceMotion}
            />
          </SettingsSection>

          <SettingsSection
            title={t("privacyStorage")}
            icon="shield-lock-outline"
          >
            <View
              style={[
                styles.authNotice,
                { backgroundColor: theme.primarySoft },
              ]}
            >
              <MaterialCommunityIcons
                name="shield-check-outline"
                size={24}
                color={theme.primary}
              />
              <Text style={[styles.authNoticeText, { color: theme.text }]}>
                {t("youtubeAuthNotRequired")}
              </Text>
            </View>
            <View style={styles.modelRow}>
              <View style={styles.modelCopy}>
                <Text style={[styles.label, { color: theme.text }]}>
                  {t("speechModel")}
                </Text>
                <Text style={[styles.help, { color: theme.textMuted }]}>
                  {model.cached
                    ? `${t("cached")} · ${formatBytes(model.sizeBytes)}`
                    : t("modelNotDownloaded")}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={model.cached ? "check-circle" : "cloud-download-outline"}
                size={28}
                color={model.cached ? theme.success : theme.textMuted}
              />
            </View>
            <Text style={[styles.help, { color: theme.textMuted }]}>
              {t("privateTranscription")}
            </Text>
            <PrimaryButton
              variant="ghost"
              disabled={!model.cached}
              loading={busy === "model"}
              onPress={() => void removeModel()}
            >
              {t("removeModel")}
            </PrimaryButton>
          </SettingsSection>
        </View>
      </View>
    </Screen>
  );
}

function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon:
    | "account-circle-outline"
    | "palette-outline"
    | "shield-lock-outline"
    | "bell-outline";
  children: ReactNode;
}) {
  const { theme } = useSettings();
  return (
    <Surface style={styles.section}>
      <View
        style={[styles.sectionTitleRow, { borderBottomColor: theme.divider }]}
      >
        <View
          style={[styles.sectionIcon, { backgroundColor: theme.surfaceTint }]}
        >
          <MaterialCommunityIcons name={icon} size={22} color={theme.primary} />
        </View>
        <Text
          accessibilityRole="header"
          style={[styles.sectionTitle, { color: theme.text }]}
        >
          {title}
        </Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </Surface>
  );
}

function FieldLabel({ children }: { children: string }) {
  const { theme } = useSettings();
  return <Text style={[styles.label, { color: theme.text }]}>{children}</Text>;
}

function SettingSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  const { theme, t } = useSettings();
  return (
    <View style={[styles.switchRow, { borderTopColor: theme.divider }]}>
      <View style={styles.switchCopy}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.help, { color: theme.textMuted }]}>
          {t(value ? "reducedMotionOnHelp" : "reducedMotionOffHelp")}
        </Text>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.borderStrong, true: theme.primary }}
        thumbColor={theme.surface}
      />
    </View>
  );
}

function Notice({
  icon,
  color,
  text,
  alert = false,
}: {
  icon: "check-circle" | "alert-circle";
  color: string;
  text: string;
  alert?: boolean;
}) {
  return (
    <View style={styles.noticeRow}>
      <MaterialCommunityIcons name={icon} size={22} color={color} />
      <Text
        accessibilityRole={alert ? "alert" : undefined}
        accessibilityLiveRegion="polite"
        style={[styles.noticeText, { color }]}
      >
        {text}
      </Text>
    </View>
  );
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : value.slice(0, 2)
  ).toUpperCase();
}

function formatBytes(value: number | null): string {
  if (!value) return "~45 MB";
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    marginBottom: spacing[6],
  },
  headingIcon: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  headingCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  subtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  notice: {
    marginBottom: spacing[4],
    padding: spacing[4],
  },
  noticeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  noticeText: {
    minWidth: 0,
    flex: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  grid: {
    width: "100%",
    gap: spacing[4],
  },
  gridDesktop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[5],
  },
  column: {
    minWidth: 0,
    flex: 1,
    gap: spacing[5],
  },
  section: {
    padding: 0,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderBottomWidth: 1,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  sectionIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  sectionTitle: {
    minWidth: 0,
    flex: 1,
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  sectionBody: {
    gap: spacing[4],
    padding: spacing[5],
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  avatar: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  avatarText: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.bodyLarge,
  },
  accountCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  accountName: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
  },
  accountEmail: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
  },
  label: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  help: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  switchRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
    borderTopWidth: 1,
    paddingTop: spacing[4],
  },
  switchCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  modelCopy: {
    minWidth: 0,
    flex: 1,
    gap: spacing[1],
  },
  authNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderRadius: radii.medium,
    padding: spacing[4],
  },
  authNoticeText: {
    minWidth: 0,
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  warning: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  deletePanel: {
    gap: spacing[4],
    padding: spacing[4],
  },
  deleteActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
  },
  deleteAction: {
    flexGrow: 1,
    flexBasis: 180,
  },
});
