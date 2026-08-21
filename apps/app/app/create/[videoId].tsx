import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  type AppLanguage,
  type QuizQuestionType,
  type SessionLength,
  type VideoImportResponse,
} from "@clipquest/contracts";
import { VoxelIcon } from "../../src/components/VoxelIcon";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LearningPrism } from "../../src/components/LearningPrism";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { QuestionTypeSelector } from "../../src/components/QuestionTypeSelector";
import { Screen } from "../../src/components/Screen";
import { SegmentedControl } from "../../src/components/SegmentedControl";
import { Surface } from "../../src/components/Surface";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  loadImportedVideo,
  loadQuestPreferences,
  saveQuestPreferences,
} from "../../src/state/creation";
import {
  borders,
  breakpoints,
  layout,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";
import { canTranscribeInBrowser } from "../../src/transcription/limits";
import { blurActiveWebElement } from "../../src/lib/web-focus";
import {
  FeedbackMotion,
  MotionSkeleton,
  MotionView,
} from "../../src/motion/Motion";

export default function CreateQuestScreen() {
  const { videoId } = useLocalSearchParams<{ videoId: string }>();
  const { t, theme, locale } = useSettings();
  const { width } = useWindowDimensions();
  const [video, setVideo] = useState<VideoImportResponse>();
  const [error, setError] = useState<string>();
  const [watched, setWatched] = useState(true);
  const [quizLanguage, setQuizLanguage] = useState<AppLanguage>(locale);
  const [sessionLength, setSessionLength] = useState<SessionLength>("medium");
  const [questionTypes, setQuestionTypes] = useState<QuizQuestionType[]>([
    ...DEFAULT_QUIZ_QUESTION_TYPES,
  ]);

  useEffect(() => {
    if (!videoId) return;
    void Promise.all([
      loadImportedVideo(videoId),
      loadQuestPreferences(videoId),
    ]).then(([value, preferences]) => {
      if (value) {
        setVideo(value);
        setQuizLanguage(preferences.quizLanguage);
        setQuestionTypes(preferences.questionTypes);
      } else setError(t("videoSetupExpired"));
    });
  }, [t, videoId]);

  if (!video && !error) {
    return (
      <Screen scroll={false}>
        <MotionView preset="fade" style={styles.center}>
          <ActivityIndicator color={theme.secondary} />
          <MotionSkeleton
            color={theme.primarySoft}
            style={styles.loadingSkeleton}
          />
        </MotionView>
      </Screen>
    );
  }
  if (!video) {
    return (
      <Screen contentWidth="reading" centered>
        <BackButton />
        <FeedbackMotion signal={error} kind="error">
          <MotionView preset="rise">
            <Surface tone="error" style={styles.expiredCard}>
              <LearningPrism size={96} variant="tile" />
              <Text
                accessibilityRole="alert"
                style={[styles.expiredText, { color: theme.text }]}
              >
                {error}
              </Text>
            </Surface>
          </MotionView>
        </FeedbackMotion>
      </Screen>
    );
  }
  const tooLong =
    video.requiresLocalTranscription && video.video.durationSeconds > 5_400;
  const tooLongForWeb =
    video.requiresLocalTranscription &&
    Platform.OS === "web" &&
    !canTranscribeInBrowser(video.video.durationSeconds);
  const compact = width < breakpoints.tablet;
  const transcriptStatus = (
    video.requiresLocalTranscription
      ? t("localTranscript")
      : t("sourceCaptions")
  ).replace(/[—–]/g, "-");
  const proceed = async () => {
    blurActiveWebElement();
    await saveQuestPreferences(video.video.id, {
      quizLanguage,
      questionTypes,
    });
    router.push({
      pathname: "/generation/[videoId]",
      params: {
        videoId: video.video.id,
        watched: String(watched),
        quizLanguage,
        sessionLength,
        questionTypes: questionTypes.join(","),
      },
    });
  };

  return (
    <Screen
      contentWidth="wide"
      footer={
        <View style={styles.footerInner}>
          <PrimaryButton
            disabled={tooLong || tooLongForWeb}
            onPress={() => void proceed()}
          >
            {t("generate")}
          </PrimaryButton>
        </View>
      }
    >
      <View style={styles.page}>
        <BackButton />

        <MotionView preset="rise" style={styles.heading}>
          <Text
            accessibilityRole="header"
            style={[styles.pageTitle, { color: theme.text }]}
          >
            {t("videoReady")}
          </Text>
          <Text style={[styles.pageSubtitle, { color: theme.textMuted }]}>
            {t("tagline")}
          </Text>
        </MotionView>

        <MotionView preset="rise" delay={44}>
          <Surface elevated padded={false} style={styles.previewSurface}>
            <View style={[styles.preview, compact && styles.previewCompact]}>
              <Image
                accessibilityLabel={video.video.title}
                source={{ uri: video.video.thumbnailUrl }}
                contentFit="cover"
                style={[styles.thumbnail, compact && styles.thumbnailCompact]}
              />
              <View style={styles.previewCopy}>
                <Text style={[styles.source, { color: theme.primary }]}>
                  YouTube
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.videoTitle, { color: theme.text }]}
                >
                  {video.video.title}
                </Text>
                <View
                  style={[
                    styles.captionStatus,
                    {
                      backgroundColor: video.requiresLocalTranscription
                        ? theme.secondarySoft
                        : theme.successSoft,
                      borderColor: video.requiresLocalTranscription
                        ? theme.secondary
                        : theme.success,
                    },
                  ]}
                >
                  <VoxelIcon
                    name={
                      video.requiresLocalTranscription
                        ? "processing"
                        : "captions"
                    }
                    size={22}
                    color={
                      video.requiresLocalTranscription
                        ? theme.secondaryPressed
                        : theme.successPressed
                    }
                  />
                  <Text
                    style={[styles.captionStatusText, { color: theme.text }]}
                  >
                    {transcriptStatus}
                  </Text>
                </View>
              </View>
            </View>
          </Surface>
        </MotionView>

        <MotionView preset="rise" delay={88}>
          <Surface style={styles.setupSurface}>
            <SettingGroup title={t("watchedQuestion")} help={t("watchedHelp")}>
              <SegmentedControl
                label={t("watchedQuestion")}
                value={watched ? "yes" : "no"}
                onChange={(value) => setWatched(value === "yes")}
                options={
                  [
                    { value: "yes", label: t("watchedYes") },
                    { value: "no", label: t("watchedNo") },
                  ] as const
                }
              />
            </SettingGroup>
            <SettingGroup
              divided
              title={t("quizLanguage")}
              help={t("quizLanguageHelp")}
            >
              <SegmentedControl
                label={t("quizLanguage")}
                value={quizLanguage}
                onChange={(value) => setQuizLanguage(value as AppLanguage)}
                options={
                  [
                    { value: "en", label: t("languageEnglish") },
                    { value: "zh-CN", label: t("languageChinese") },
                  ] as const
                }
              />
            </SettingGroup>
            <SettingGroup divided title={t("sessionLength")}>
              <SegmentedControl
                label={t("sessionLength")}
                value={sessionLength}
                onChange={(value) => setSessionLength(value as SessionLength)}
                options={
                  [
                    { value: "short", label: t("short") },
                    { value: "medium", label: t("medium") },
                    { value: "long", label: t("long") },
                  ] as const
                }
              />
            </SettingGroup>
            <SettingGroup
              divided
              title={t("questionTypes")}
              help={t("questionTypesHelp")}
            >
              <QuestionTypeSelector
                value={questionTypes}
                onChange={setQuestionTypes}
              />
            </SettingGroup>
          </Surface>
        </MotionView>

        {video.requiresLocalTranscription ? (
          <MotionView preset="rise" delay={132} exiting>
            <Surface tone="tinted" style={styles.noticeSurface}>
              <View style={styles.noticeRow}>
                <View
                  style={[
                    styles.noticeIcon,
                    { backgroundColor: theme.surface },
                  ]}
                >
                  <VoxelIcon name="privacy" size={27} color={theme.primary} />
                </View>
                <View style={styles.noticeCopy}>
                  <Text style={[styles.noticeTitle, { color: theme.text }]}>
                    {t("modelSize")}
                  </Text>
                  <Text style={[styles.help, { color: theme.textMuted }]}>
                    {t("privateTranscription")}
                  </Text>
                </View>
              </View>
            </Surface>
          </MotionView>
        ) : null}

        {tooLong || tooLongForWeb ? (
          <FeedbackMotion
            signal={tooLongForWeb ? "web" : "duration"}
            kind="error"
          >
            <MotionView preset="rise" exiting>
              <Surface tone="error" style={styles.limitSurface}>
                <View style={styles.noticeRow}>
                  <VoxelIcon name="error" size={25} color={theme.error} />
                  <Text
                    accessibilityRole="alert"
                    style={[styles.limitText, { color: theme.text }]}
                  >
                    {t(
                      tooLongForWeb
                        ? "webUnsupportedLength"
                        : "unsupportedLength",
                    )}
                  </Text>
                </View>
              </Surface>
            </MotionView>
          </FeedbackMotion>
        ) : null}
      </View>
    </Screen>
  );
}

function SettingGroup({
  title,
  help,
  children,
  divided = false,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
  divided?: boolean;
}) {
  const { theme } = useSettings();
  return (
    <View
      style={[
        styles.settingGroup,
        divided && styles.settingGroupDivided,
        divided && { borderTopColor: theme.divider },
      ]}
    >
      <View style={styles.settingCopy}>
        <Text style={[styles.settingTitle, { color: theme.text }]}>
          {title}
        </Text>
        {help ? (
          <Text style={[styles.help, { color: theme.textMuted }]}>{help}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function BackButton() {
  const { t, theme } = useSettings();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("back")}
      onPress={() => router.back()}
      style={styles.back}
    >
      <VoxelIcon name="back" size={24} color={theme.text} />
      <Text style={[styles.backText, { color: theme.text }]}>{t("back")}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    minHeight: 400,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  loadingSkeleton: {
    width: 220,
    height: 10,
    borderRadius: radii.pill,
  },
  page: { width: "100%", maxWidth: 920, alignSelf: "center", gap: spacing[5] },
  back: {
    alignSelf: "flex-start",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[4],
  },
  backText: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  heading: { gap: spacing[1], marginTop: spacing[1] },
  pageTitle: {
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
  },
  pageSubtitle: {
    fontFamily: typography.body,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  previewSurface: { width: "100%" },
  preview: { flexDirection: "row", alignItems: "stretch" },
  previewCompact: { flexDirection: "column" },
  thumbnail: {
    flex: 0.95,
    minWidth: 0,
    aspectRatio: 16 / 10,
    backgroundColor: "#CBD2DE",
  },
  thumbnailCompact: { width: "100%", flex: 0, aspectRatio: 16 / 9 },
  previewCopy: {
    flex: 1.05,
    minWidth: 0,
    padding: spacing[6],
    justifyContent: "center",
    gap: spacing[3],
  },
  source: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  videoTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.title,
    lineHeight: typography.lineHeight.title,
  },
  captionStatus: {
    borderWidth: borders.standard,
    borderRadius: radii.medium,
    padding: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
  },
  captionStatusText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  setupSurface: { gap: 0 },
  settingGroup: { gap: spacing[4], paddingVertical: spacing[1] },
  settingGroupDivided: {
    marginTop: spacing[5],
    paddingTop: spacing[6],
    borderTopWidth: borders.hairline,
  },
  settingCopy: { gap: spacing[1] },
  settingTitle: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  help: {
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  noticeSurface: { padding: spacing[5] },
  noticeRow: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  noticeIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeCopy: { flex: 1, minWidth: 0, gap: spacing[1] },
  noticeTitle: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  limitSurface: { padding: spacing[4] },
  limitText: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  footerInner: { width: "100%", maxWidth: layout.reading, alignSelf: "center" },
  expiredCard: { width: "100%", alignItems: "center", gap: spacing[5] },
  expiredText: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
});
