import type { AppLanguage } from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import { ProfileAvatar } from "../../src/components/ProfileAvatar";
import { apiBinaryRequest, apiMultipartRequest } from "../../src/lib/api";
import { pickWebFile } from "../../src/lib/web-file-picker";
import { ProfileAvatarResponseSchema } from "@clipquest/contracts";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { File as ExpoFile } from "expo-file-system";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  Platform,
} from "react-native";
import { AppTextInput } from "../../src/components/AppTextInput";
import { useAdminCopy } from "../../src/admin/copy";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Screen } from "../../src/components/Screen";
import { SegmentedControl } from "../../src/components/SegmentedControl";
import { Surface } from "../../src/components/Surface";
import { authClient, useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { clearPendingVideoHandoffs } from "../../src/state/pending-video-handoff";
import { clearAccountCreationState } from "../../src/state/creation";
import { clearAccountAttemptState } from "../../src/state/attempt";
import {
  FeedbackMotion,
  MotionPressable,
  MotionView,
} from "../../src/motion/Motion";
import { removeLocalGenerationCredential } from "../../src/generation/local-generation-client";
import { clearNativeGenerationOutboxes } from "../../src/generation/android-generation-outbox";
import { cancelPreGenerationForAccount } from "../../src/generation/prework";
import {
  disableReviewReminders,
  enableReviewReminders,
  reviewRemindersEnabled,
} from "../../src/notifications/review-reminders";
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
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [avatarRevision, setAvatarRevision] = useState<
    string | null | undefined
  >(undefined);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web" || !session?.user.id) return;
    let active = true;
    void reviewRemindersEnabled(session.user.id).then((enabled) => {
      if (active) setNotificationsEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  const effectiveAvatarRevision =
    avatarRevision === undefined
      ? (session?.user.image ?? null)
      : avatarRevision;

  const uploadAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      if (Platform.OS === "web") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        const selected = await pickWebFile(input);
        if (!selected) return;
        body.append("file", await normalizeWebAvatar(selected), "avatar.webp");
      } else {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted)
          throw new Error("Allow photo access to choose a profile picture.");
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 1,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return;
        const edge = Math.min(asset.width || 512, asset.height || 512);
        const output = await ImageManipulator.manipulateAsync(
          asset.uri,
          [
            {
              crop: {
                originX: Math.max(0, ((asset.width || edge) - edge) / 2),
                originY: Math.max(0, ((asset.height || edge) - edge) / 2),
                width: edge,
                height: edge,
              },
            },
            { resize: { width: 512, height: 512 } },
          ],
          { compress: 0.86, format: ImageManipulator.SaveFormat.WEBP },
        );
        // Expo's native fetch serializer accepts File/Blob parts, but not the
        // legacy React Native `{ uri, name, type }` FormData shape.
        body.append("file", new ExpoFile(output.uri), "avatar.webp");
      }
      const response = await apiMultipartRequest(
        "/api/profile/avatar",
        body,
        ProfileAvatarResponseSchema,
      );
      setAvatarRevision(response.revision);
      await authClient.getSession();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Profile picture upload failed.",
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    if (avatarBusy || !effectiveAvatarRevision) return;
    setAvatarBusy(true);
    setError(undefined);
    try {
      await apiBinaryRequest("/api/profile/avatar", { method: "DELETE" });
      setAvatarRevision(null);
      await authClient.getSession();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Profile picture removal failed.",
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  const signOut = async () => {
    if (busy) return;
    setBusy("signout");
    setError(undefined);
    try {
      const userId = session?.user.id;
      if (userId && Platform.OS !== "web") {
        await disableReviewReminders(userId);
        await removeLocalGenerationCredential(userId);
      }
      const result = await authClient.signOut();
      if (result.error)
        throw new Error(result.error.message ?? t("signOutFailed"));
      if (userId) cancelPreGenerationForAccount(userId);
      await Promise.allSettled([
        userId ? clearNativeGenerationOutboxes(userId) : Promise.resolve(),
        userId ? clearAccountCreationState(userId) : Promise.resolve(),
        userId ? clearAccountAttemptState(userId) : Promise.resolve(),
        clearPendingVideoHandoffs(),
      ]);
      router.replace("/(auth)/sign-in");
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
      const userId = session?.user.id;
      if (userId && Platform.OS !== "web") {
        await disableReviewReminders(userId);
        await removeLocalGenerationCredential(userId);
      }
      const result = await authClient.deleteUser({ password: deletePassword });
      if (result.error)
        throw new Error(result.error.message ?? t("deleteAccountFailed"));
      if (userId) cancelPreGenerationForAccount(userId);
      await Promise.allSettled([
        userId ? clearNativeGenerationOutboxes(userId) : Promise.resolve(),
        userId ? clearAccountCreationState(userId) : Promise.resolve(),
        userId ? clearAccountAttemptState(userId) : Promise.resolve(),
        clearPendingVideoHandoffs(),
      ]);
      router.replace("/(auth)/sign-in");
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
      <MotionView preset="from-left" style={styles.heading}>
        <View
          style={[styles.headingIcon, { backgroundColor: theme.primarySoft }]}
        >
          <VoxelIcon name="settings" size={28} color={theme.primary} />
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
      </MotionView>

      {error ? (
        <FeedbackMotion signal={error} kind="error">
          <MotionView preset="rise" exiting>
            <Surface tone="error" style={styles.notice}>
              <Notice icon="error" color={theme.error} text={error} alert />
            </Surface>
          </MotionView>
        </FeedbackMotion>
      ) : null}

      <View style={[styles.grid, desktop && styles.gridDesktop]}>
        <MotionView
          preset="from-left"
          delay={44}
          style={[styles.column, desktop && styles.columnDesktop]}
        >
          <SettingsSection title={t("account")} icon="people">
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel={t("openProfile")}
              onPress={() => router.push("/profile" as never)}
              style={({ hovered, pressed }) => [
                styles.accountRow,
                {
                  backgroundColor: hovered
                    ? theme.surfaceSunken
                    : "transparent",
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <ProfileAvatar
                name={session?.user.name ?? session?.user.email ?? "CQ"}
                image={effectiveAvatarRevision}
                size={64}
              />
              <View style={styles.accountCopy}>
                <Text style={[styles.accountName, { color: theme.text }]}>
                  {session?.user.name ?? t("appName")}
                </Text>
                <Text style={[styles.accountEmail, { color: theme.textMuted }]}>
                  {session?.user.email}
                </Text>
              </View>
            </MotionPressable>
            <View style={styles.avatarActions}>
              <PrimaryButton
                variant="secondary"
                loading={avatarBusy}
                onPress={() => void uploadAvatar()}
              >
                {effectiveAvatarRevision
                  ? t("replacePicture")
                  : t("uploadPicture")}
              </PrimaryButton>
              {effectiveAvatarRevision ? (
                <PrimaryButton
                  variant="ghost"
                  disabled={avatarBusy}
                  onPress={() => void removeAvatar()}
                >
                  {t("removePicture")}
                </PrimaryButton>
              ) : null}
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
            {Platform.OS !== "web" ? (
              <PrimaryButton
                variant="secondary"
                onPress={() => router.push("/local-ai" as never)}
              >
                {"Local AI"}
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
              <MotionView preset="rise" exiting>
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
              </MotionView>
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
        </MotionView>

        <MotionView
          preset="from-right"
          delay={88}
          style={[styles.column, desktop && styles.columnDesktop]}
        >
          <SettingsSection title={t("appearance")} icon="appearance">
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
              options={[{ value: "en", label: t("languageEnglish") }] as const}
            />
            <SettingSwitch
              label={t("reducedMotion")}
              value={reduceMotion}
              onChange={setReduceMotion}
            />
            {Platform.OS !== "web" && session?.user.id ? (
              <SettingSwitch
                label={t("notifications")}
                help={t("remindersHelp")}
                value={notificationsEnabled}
                onChange={(enabled) => {
                  if (busy) return;
                  setBusy("notifications");
                  setError(undefined);
                  void (
                    enabled
                      ? enableReviewReminders(session.user.id, "en")
                      : disableReviewReminders(session.user.id)
                  )
                    .then(() => setNotificationsEnabled(enabled))
                    .catch((cause) =>
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Review reminders could not be updated.",
                      ),
                    )
                    .finally(() => setBusy(undefined));
                }}
              />
            ) : null}
          </SettingsSection>
        </MotionView>
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
  icon: "people" | "appearance";
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
          <VoxelIcon name={icon} size={22} color={theme.primary} />
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
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  const { theme, t } = useSettings();
  return (
    <View style={[styles.switchRow, { borderTopColor: theme.divider }]}>
      <View style={styles.switchCopy}>
        <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
        <Text style={[styles.help, { color: theme.textMuted }]}>
          {help ?? t(value ? "reducedMotionOnHelp" : "reducedMotionOffHelp")}
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
  icon: "correct" | "error";
  color: string;
  text: string;
  alert?: boolean;
}) {
  return (
    <View style={styles.noticeRow}>
      <VoxelIcon name={icon} size={22} color={color} />
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

async function normalizeWebAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const edge = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot process this image.");
  context.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    512,
    512,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not process this image.")),
      "image/webp",
      0.86,
    ),
  );
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
    gap: spacing[5],
  },
  columnDesktop: {
    flex: 1,
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
  avatarActions: {
    flexDirection: "row",
    flexWrap: "wrap",
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
