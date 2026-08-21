import type { AppLanguage, SessionLength, VideoImportResponse } from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Mascot } from "../../src/components/Mascot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { Screen } from "../../src/components/Screen";
import { SegmentedControl } from "../../src/components/SegmentedControl";
import { useSettings } from "../../src/providers/SettingsProvider";
import { loadImportedVideo } from "../../src/state/creation";
import { radii, typography } from "../../src/theme/tokens";
import { canTranscribeInBrowser } from "../../src/transcription/limits";
import { blurActiveWebElement } from "../../src/lib/web-focus";

export default function CreateQuestScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { t, theme, locale } = useSettings();
  const [video, setVideo] = useState<VideoImportResponse>();
  const [error, setError] = useState<string>();
  const [watched, setWatched] = useState(true);
  const [quizLanguage, setQuizLanguage] = useState<AppLanguage>(locale);
  const [sessionLength, setSessionLength] = useState<SessionLength>("medium");

  useEffect(() => {
    if (!videoId) return;
    void loadImportedVideo(videoId).then((value) => {
      if (value) setVideo(value);
      else setError(t("videoSetupExpired"));
    });
  }, [t, videoId]);

  if (!video && !error) {
    return <Screen scroll={false}><View style={styles.center}><ActivityIndicator color={theme.secondary} /></View></Screen>;
  }
  if (!video) {
    return (
      <Screen>
        <BackButton />
        <View style={styles.center}><Mascot mood="oops" /><Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text></View>
      </Screen>
    );
  }
  const tooLong = video.requiresLocalTranscription && video.video.durationSeconds > 5_400;
  const tooLongForWeb = video.requiresLocalTranscription && Platform.OS === "web" && !canTranscribeInBrowser(video.video.durationSeconds);
  const proceed = () => {
    blurActiveWebElement();
    router.push({
      pathname: "/generation/[videoId]",
      params: { videoId: video.video.id, watched: String(watched), quizLanguage, sessionLength },
    });
  };

  return (
    <Screen>
      <BackButton />
      <View style={styles.hero}>
        <Image source={{ uri: video.video.thumbnailUrl }} contentFit="cover" style={styles.thumbnail} />
        <View style={styles.heroCopy}>
          <Text style={[styles.kicker, { color: theme.textMuted }]}>{video.video.source === "youtube" ? "YOUTUBE" : "BILIBILI"}</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{video.video.title}</Text>
          <View style={[styles.captionStatus, { backgroundColor: video.requiresLocalTranscription ? theme.elevated : theme.primary }]}>
            <MaterialCommunityIcons name={video.requiresLocalTranscription ? "cellphone-sound" : "subtitles-outline"} size={19} color={theme.text} />
            <Text style={[styles.captionStatusText, { color: theme.text }]}>{video.requiresLocalTranscription ? t("localTranscript") : t("sourceCaptions")}</Text>
          </View>
        </View>
      </View>

      <View style={styles.grid}>
        <SettingCard title={t("watchedQuestion")} help={t("watchedHelp")}>
          <SegmentedControl
            label={t("watchedQuestion")}
            value={watched ? "yes" : "no"}
            onChange={(value) => setWatched(value === "yes")}
            options={[{ value: "yes", label: t("watchedYes") }, { value: "no", label: t("watchedNo") }] as const}
          />
        </SettingCard>
        <SettingCard title={t("quizLanguage")} help={t("quizLanguageHelp")}>
          <SegmentedControl
            label={t("quizLanguage")}
            value={quizLanguage}
            onChange={(value) => setQuizLanguage(value as AppLanguage)}
            options={[{ value: "en", label: t("languageEnglish") }, { value: "zh-CN", label: t("languageChinese") }] as const}
          />
        </SettingCard>
        <SettingCard title={t("sessionLength")}>
          <SegmentedControl
            label={t("sessionLength")}
            value={sessionLength}
            onChange={(value) => setSessionLength(value as SessionLength)}
            options={[{ value: "short", label: t("short") }, { value: "medium", label: t("medium") }, { value: "long", label: t("long") }] as const}
          />
        </SettingCard>
      </View>

      {video.requiresLocalTranscription ? (
        <View style={[styles.privacy, { borderColor: theme.secondary, backgroundColor: theme.surface }]}>
          <MaterialCommunityIcons name="shield-lock-outline" size={28} color={theme.secondary} />
          <View style={styles.privacyCopy}>
            <Text style={[styles.privacyTitle, { color: theme.text }]}>{t("modelSize")}</Text>
            <Text style={[styles.help, { color: theme.textMuted }]}>{t("privateTranscription")}</Text>
          </View>
        </View>
      ) : null}
      {tooLong || tooLongForWeb ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{t(tooLongForWeb ? "webUnsupportedLength" : "unsupportedLength")}</Text> : null}
      <View style={styles.submit}><PrimaryButton disabled={tooLong || tooLongForWeb} onPress={proceed}>{t("generate")}</PrimaryButton></View>
    </Screen>
  );
}

function SettingCard({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  const { theme } = useSettings();
  return (
    <View style={[styles.settingCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.settingTitle, { color: theme.text }]}>{title}</Text>
      {help ? <Text style={[styles.help, { color: theme.textMuted }]}>{help}</Text> : null}
      {children}
    </View>
  );
}

function BackButton() {
  const { t, theme } = useSettings();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("back")} onPress={() => router.back()} style={styles.back}>
      <MaterialCommunityIcons name="arrow-left" size={24} color={theme.text} />
      <Text style={[styles.backText, { color: theme.text }]}>{t("back")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, minHeight: 400, alignItems: "center", justifyContent: "center", gap: 18 },
  back: { alignSelf: "flex-start", minHeight: 48, flexDirection: "row", alignItems: "center", gap: 7, paddingRight: 14 },
  backText: { fontFamily: typography.bodyBold, fontSize: 15 },
  hero: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 22 },
  thumbnail: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0, maxWidth: 520, aspectRatio: 16 / 9, borderRadius: radii.large, backgroundColor: "#CBD2DE" },
  heroCopy: { flex: 1, flexShrink: 1, flexBasis: 280, minWidth: 0, gap: 8 },
  kicker: { fontFamily: typography.bodyBold, fontSize: 12, letterSpacing: 1.5 },
  title: { fontFamily: typography.display, fontSize: 30, lineHeight: 36 },
  captionStatus: { marginTop: 5, borderRadius: radii.medium, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  captionStatusText: { flex: 1, fontFamily: typography.bodyMedium, fontSize: 13, lineHeight: 18 },
  grid: { marginTop: 28, flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 16 },
  settingCard: { flex: 1, flexShrink: 1, flexBasis: 290, minWidth: 0, borderWidth: 2, borderRadius: radii.large, padding: 17, gap: 10 },
  settingTitle: { fontFamily: typography.displayMedium, fontSize: 20 },
  help: { fontFamily: typography.body, fontSize: 13, lineHeight: 19 },
  privacy: { marginTop: 18, borderWidth: 2, borderRadius: radii.large, padding: 16, flexDirection: "row", alignItems: "center", gap: 13 },
  privacyCopy: { flex: 1, gap: 3 },
  privacyTitle: { fontFamily: typography.bodyBold, fontSize: 14 },
  error: { fontFamily: typography.bodyMedium, fontSize: 14, textAlign: "center", marginTop: 14 },
  submit: { width: "100%", maxWidth: 520, alignSelf: "center", marginTop: 24 },
});
