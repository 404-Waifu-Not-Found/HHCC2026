import {
  PushRegisterRequestSchema,
  YouTubeDeviceStartResponseSchema,
  YouTubeDeviceStatusSchema,
  type AppLanguage,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Screen } from "../../src/components/Screen";
import { SegmentedControl } from "../../src/components/SegmentedControl";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { authClient, useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import { getLocalModelStatus, removeLocalModel } from "../../src/transcription/local-transcriber";
import type { ModelStatus } from "../../src/transcription/types";
import { radii, typography } from "../../src/theme/tokens";

type YouTubeFlow = {
  flowId: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds: number;
};

export default function SettingsScreen() {
  const { t, theme, locale, setLocale, themeMode, setThemeMode, reduceMotion, setReduceMotion } = useSettings();
  const { data: session } = useAppSession();
  const [model, setModel] = useState<ModelStatus>({ cached: false, sizeBytes: null });
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [youtubeAvailable, setYoutubeAvailable] = useState(true);
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const [flow, setFlow] = useState<YouTubeFlow>();

  useEffect(() => { void getLocalModelStatus().then(setModel).catch(() => undefined); }, []);

  useEffect(() => {
    if (!flow || youtubeConnected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const status = await apiRequest(`/api/youtube/device/status?flowId=${encodeURIComponent(flow.flowId)}`, {}, YouTubeDeviceStatusSchema);
        if (!active) return;
        if (status.state === "connected") {
          setYoutubeConnected(true);
          setFlow(undefined);
          setMessage(`${t("youtubeConnected")} · ${status.importedCandidates ?? 0}`);
          return;
        }
        if (status.state === "failed" || status.state === "expired") {
          setError(status.message ?? "YouTube authorization expired.");
          setFlow(undefined);
          return;
        }
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Could not check YouTube authorization.");
        setFlow(undefined);
      }
      if (active) timer = setTimeout(check, Math.max(2, flow.intervalSeconds) * 1_000);
    };
    timer = setTimeout(check, Math.max(1, flow.intervalSeconds) * 1_000);
    return () => { active = false; clearTimeout(timer); };
  }, [flow, t, youtubeConnected]);

  const removeModel = async () => {
    setBusy("model"); setError(undefined);
    try {
      const removed = await removeLocalModel();
      setModel({ cached: false, sizeBytes: model.sizeBytes });
      setMessage(removed ? t("removeModelConfirm") : t("modelNotDownloaded"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove the model."); }
    finally { setBusy(undefined); }
  };

  const registerPush = async () => {
    setBusy("push"); setError(undefined);
    try {
      const Notifications = await import("expo-notifications");
      if (Platform.OS !== "web" && !Device.isDevice) throw new Error("Push reminders require a physical device.");
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) throw new Error("Notification permission was not granted.");
      if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("study-reviews", { name: "Study reviews", importance: Notifications.AndroidImportance.DEFAULT });
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId || projectId.startsWith("00000000")) throw new Error("Push reminders will be available after the EAS project is linked.");
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
      await apiRequest("/api/push/register", { method: "POST", body: jsonBody(PushRegisterRequestSchema.parse({ token, platform, locale })) });
      setMessage("Review reminders enabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not enable reminders."); }
    finally { setBusy(undefined); }
  };

  const connectYouTube = async () => {
    setBusy("youtube"); setError(undefined);
    try {
      const started = await apiRequest("/api/youtube/device/start", { method: "POST" }, YouTubeDeviceStartResponseSchema);
      setFlow(started);
      await Clipboard.setStringAsync(started.userCode);
      await Linking.openURL(started.verificationUrl);
    } catch (cause) {
      const next = cause instanceof Error ? cause.message : "YouTube demo history is unavailable.";
      setError(next);
      if (next.toLowerCase().includes("not enabled") || next.toLowerCase().includes("hidden")) setYoutubeAvailable(false);
    } finally { setBusy(undefined); }
  };

  const disconnectYouTube = async () => {
    setBusy("youtube"); setError(undefined);
    try {
      await apiRequest("/api/youtube/connection", { method: "DELETE" });
      setYoutubeConnected(false); setFlow(undefined); setMessage(t("youtubeDisconnected"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not disconnect YouTube."); }
    finally { setBusy(undefined); }
  };

  const signOut = async () => {
    setBusy("signout");
    await authClient.signOut();
    router.replace("/(auth)/welcome");
  };

  return (
    <Screen>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{t("settings")}</Text>
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: theme.success }]}>{message}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: theme.error }]}>{error}</Text> : null}

      <SettingsSection title={t("account")} icon="account-circle-outline">
        <Text style={[styles.accountName, { color: theme.text }]}>{session?.user.name}</Text>
        <Text style={[styles.accountEmail, { color: theme.textMuted }]}>{session?.user.email}</Text>
        <PrimaryButton variant="ghost" loading={busy === "signout"} onPress={() => void signOut()}>{t("signOut")}</PrimaryButton>
      </SettingsSection>

      <SettingsSection title={t("appearance")} icon="palette-outline">
        <Text style={[styles.label, { color: theme.text }]}>{t("theme")}</Text>
        <SegmentedControl label={t("theme")} value={themeMode} onChange={setThemeMode} options={[{ value: "system", label: t("system") }, { value: "light", label: t("light") }, { value: "dark", label: t("dark") }] as const} />
        <Text style={[styles.label, { color: theme.text }]}>{t("appLanguage")}</Text>
        <SegmentedControl label={t("appLanguage")} value={locale} onChange={(value) => setLocale(value as AppLanguage)} options={[{ value: "en", label: t("languageEnglish") }, { value: "zh-CN", label: t("languageChinese") }] as const} />
        <SettingSwitch label={t("reducedMotion")} value={reduceMotion} onChange={setReduceMotion} />
      </SettingsSection>

      <SettingsSection title={t("privacyStorage")} icon="shield-lock-outline">
        <View style={styles.modelRow}>
          <View style={styles.modelCopy}>
            <Text style={[styles.label, { color: theme.text }]}>{t("speechModel")}</Text>
            <Text style={[styles.help, { color: theme.textMuted }]}>{model.cached ? `${t("cached")} · ${formatBytes(model.sizeBytes)}` : t("modelNotDownloaded")}</Text>
          </View>
          <MaterialCommunityIcons name={model.cached ? "check-circle" : "cloud-download-outline"} size={28} color={model.cached ? theme.success : theme.textMuted} />
        </View>
        <Text style={[styles.help, { color: theme.textMuted }]}>{t("privateTranscription")}</Text>
        <PrimaryButton variant="ghost" disabled={!model.cached} loading={busy === "model"} onPress={() => void removeModel()}>{t("removeModel")}</PrimaryButton>
      </SettingsSection>

      <SettingsSection title={t("notifications")} icon="bell-outline">
        <Text style={[styles.help, { color: theme.textMuted }]}>ClipQuest only sends reminders when a mastery review is due.</Text>
        <PrimaryButton variant="secondary" loading={busy === "push"} onPress={() => void registerPush()}>{t("enableNotifications")}</PrimaryButton>
      </SettingsSection>

      {youtubeAvailable ? (
        <SettingsSection title={`${t("connectYouTube")} · ${t("experimental")}`} icon="youtube">
          <Text style={[styles.warning, { color: theme.error }]}>{t("youtubeWarning")}</Text>
          {flow ? (
            <View style={[styles.codeCard, { backgroundColor: theme.elevated, borderColor: theme.border }]}>
              <Text style={[styles.help, { color: theme.textMuted }]}>{t("youtubeCode")}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Copy YouTube device code" onPress={() => void Clipboard.setStringAsync(flow.userCode)} style={styles.codeRow}>
                <Text style={[styles.code, { color: theme.text }]}>{flow.userCode}</Text>
                <MaterialCommunityIcons name="content-copy" size={22} color={theme.text} />
              </Pressable>
              <PrimaryButton variant="secondary" onPress={() => void Linking.openURL(flow.verificationUrl)}>{t("openGoogle")}</PrimaryButton>
            </View>
          ) : youtubeConnected ? (
            <PrimaryButton variant="ghost" loading={busy === "youtube"} onPress={() => void disconnectYouTube()}>{t("disconnect")}</PrimaryButton>
          ) : (
            <PrimaryButton loading={busy === "youtube"} onPress={() => void connectYouTube()}>{t("connectYouTube")}</PrimaryButton>
          )}
        </SettingsSection>
      ) : null}
    </Screen>
  );
}

function SettingsSection({ title, icon, children }: { title: string; icon: "account-circle-outline" | "palette-outline" | "shield-lock-outline" | "bell-outline" | "youtube"; children: React.ReactNode }) {
  const { theme } = useSettings();
  return (
    <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.sectionTitleRow}><MaterialCommunityIcons name={icon} size={25} color={theme.secondary} /><Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text></View>
      {children}
    </View>
  );
}

function SettingSwitch({ label, value, onChange }: { label: string; value: boolean; onChange(value: boolean): void }) {
  const { theme } = useSettings();
  return <View style={styles.switchRow}><Text style={[styles.label, { color: theme.text }]}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: theme.border, true: theme.secondary }} thumbColor={value ? theme.primary : theme.textMuted} /></View>;
}

function formatBytes(value: number | null): string {
  if (!value) return "~45 MB";
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  title: { fontFamily: typography.display, fontSize: 38, marginBottom: 10 },
  message: { fontFamily: typography.bodyMedium, fontSize: 14, lineHeight: 20, marginBottom: 9 },
  section: { width: "100%", maxWidth: 720, alignSelf: "center", borderWidth: 2, borderRadius: radii.large, padding: 18, gap: 13, marginTop: 14 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionTitle: { flex: 1, fontFamily: typography.displayMedium, fontSize: 21 },
  label: { fontFamily: typography.bodyBold, fontSize: 14 },
  help: { fontFamily: typography.body, fontSize: 13, lineHeight: 19 },
  accountName: { fontFamily: typography.bodyBold, fontSize: 17 },
  accountEmail: { fontFamily: typography.body, fontSize: 14, marginTop: -8 },
  switchRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 },
  modelRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  modelCopy: { flex: 1, gap: 3 },
  warning: { fontFamily: typography.bodyBold, fontSize: 13, lineHeight: 19 },
  codeCard: { borderWidth: 2, borderRadius: radii.medium, padding: 14, gap: 11 },
  codeRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  code: { fontFamily: typography.display, fontSize: 30, letterSpacing: 4 },
});
