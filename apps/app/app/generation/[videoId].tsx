import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  ExtensionQuizImportResponseSchema,
  MediaResolveResponseSchema,
  QuizStartResponseSchema,
  QuizQuestionTypesSchema,
  createTranscriptCompleteness,
  questionLimitForSession,
  type AppLanguage,
  type GenerationStage,
  type LocalQuizContext,
  type QuizQuestionType,
  type SessionLength,
  type TranscriptCompleteness,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Mascot } from "../../src/components/Mascot";
import {
  ProcessingSteps,
  type ProcessingStepState,
} from "../../src/components/ProcessingSteps";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressBar } from "../../src/components/ProgressBar";
import { Screen } from "../../src/components/Screen";
import { Surface } from "../../src/components/Surface";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  clearImportedVideo,
  clearGenerationState,
  loadGenerationState,
  loadImportedVideo,
  saveGenerationState,
} from "../../src/state/creation";
import { saveAttemptStart } from "../../src/state/attempt";
import { transcribeLocally } from "../../src/transcription/local-transcriber";
import { TranscriptionPausedError } from "../../src/transcription/types";
import { acquireTextTranscript } from "../../src/transcription/acquire-text-transcript";
import { requestExtensionLocalQuiz } from "../../src/transcription/clipquest-extension";
import {
  breakpoints,
  layout,
  radii,
  spacing,
  typography,
} from "../../src/theme/tokens";

type ProgressDetail = {
  loadedBytes?: number;
  totalBytes?: number;
  cached?: boolean;
};

export default function GenerationScreen() {
  const params = useLocalSearchParams<{
    videoId: string;
    watched: string;
    quizLanguage: AppLanguage;
    sessionLength: SessionLength;
    questionTypes?: string;
  }>();
  const { t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const [stage, setStage] = useState<GenerationStage>("getting_video");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState<ProgressDetail>();
  const [error, setError] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [runNumber, setRunNumber] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const [localTranscription, setLocalTranscription] = useState(false);
  const questionTypes = useMemo<QuizQuestionType[]>(() => {
    const parsed = QuizQuestionTypesSchema.safeParse(
      params.questionTypes?.split(",").filter(Boolean),
    );
    return parsed.success ? parsed.data : [...DEFAULT_QUIZ_QUESTION_TYPES];
  }, [params.questionTypes]);

  const execute = useCallback(
    async (signal: AbortSignal) => {
      const imported = await loadImportedVideo(params.videoId);
      if (!imported) throw new Error(t("generationSetupExpired"));
      const storedGeneration = await loadGenerationState(params.videoId);
      const idempotencyKey = isUuid(storedGeneration?.idempotencyKey)
        ? storedGeneration.idempotencyKey
        : Crypto.randomUUID();
      if (storedGeneration?.idempotencyKey !== idempotencyKey) {
        await saveGenerationState(params.videoId, {
          ...storedGeneration,
          idempotencyKey,
          quizLanguage: params.quizLanguage,
          questionTypes,
        });
      }
      setLocalTranscription(imported.transcriptionMode === "device_media");
      setStage("getting_video");
      setProgress(1);
      let segments: TranscriptSegment[] = [];
      let completeness: TranscriptCompleteness | null = null;
      let language = imported.video.sourceLanguage ?? "und";
      setStage("preparing_audio");
      const textTranscript = await acquireTextTranscript(
        imported,
        signal,
        setProgress,
      );
      if (textTranscript) {
        segments = textTranscript.segments;
        language = textTranscript.language;
        completeness = textTranscript.completeness;
        setProgress(1);
      }
      if (!segments.length) {
        setLocalTranscription(true);
        const media = await apiRequest(
          "/api/media/resolve",
          {
            method: "POST",
            body: jsonBody({ videoId: imported.video.id }),
            signal,
          },
          MediaResolveResponseSchema,
        );
        const result = await transcribeLocally({
          videoId: imported.video.id,
          mediaUrl: media.mediaUrl,
          durationSeconds: imported.video.durationSeconds,
          language: imported.video.sourceLanguage,
          signal,
          onPhase: (phase) => {
            setStage(phase);
            setProgress(0);
          },
          onProgress: (value, nextDetail) => {
            setProgress(value);
            setDetail(nextDetail);
          },
        });
        language = result.language;
        segments = result.segments;
        completeness = createTranscriptCompleteness(
          segments,
          imported.video.durationSeconds,
        );
      }
      if (signal.aborted) throw new TranscriptionPausedError();
      if (!completeness) {
        throw new Error(
          "ClipQuest could not verify a complete transcript for this video.",
        );
      }
      setStage("creating_questions");
      setProgress(0.15);
      setDetail(undefined);
      const context: LocalQuizContext = {
        protocolVersion: 1,
        jobId: idempotencyKey,
        videoId: imported.video.id,
        title: imported.video.title,
        quizLanguage: params.quizLanguage,
        questionTypes,
        questionCount: questionLimitForSession(params.sessionLength) as
          5 | 10 | 15,
        transcriptFingerprint: completeness.textFingerprint,
        transcriptLanguage: language,
        segments,
      };
      const result = await requestExtensionLocalQuiz(
        context,
        signal,
        (nextStage, value) => {
          setStage(nextStage);
          setProgress(value);
        },
      );
      setStage("finalizing_questions");
      setProgress(0.96);
      const importedQuiz = await apiRequest(
        "/api/quiz-imports",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: jsonBody({
            videoId: imported.video.id,
            quizLanguage: params.quizLanguage,
            sessionLength: params.sessionLength,
            watched: params.watched === "true",
            quiz: result,
          }),
          signal,
        },
        ExtensionQuizImportResponseSchema,
      );
      const start = await apiRequest(
        `/api/quizzes/${importedQuiz.quizId}/start`,
        {
          method: "POST",
          body: jsonBody({
            mode: "learn",
            sessionLength: params.sessionLength,
            questionTypes: ["multiple_choice"],
            watched: params.watched === "true",
          }),
          signal,
        },
        QuizStartResponseSchema,
      );
      await saveAttemptStart(start);
      await clearImportedVideo(imported.video.id);
      setStage("complete");
      setProgress(1);
      router.replace({
        pathname: "/quiz/[attemptId]",
        params: { attemptId: start.attemptId },
      });
    },
    [
      params.quizLanguage,
      params.sessionLength,
      params.videoId,
      params.watched,
      questionTypes,
      t,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void Promise.resolve()
      .then(() => execute(controller.signal))
      .catch((cause) => {
        // Expo's development Strict Mode mounts, cleans up, then remounts an
        // effect. Ignore the aborted controller from the obsolete run so it
        // cannot mark the fresh generation as paused.
        if (controllerRef.current !== controller) return;
        if (
          cause instanceof TranscriptionPausedError ||
          controller.signal.aborted
        ) {
          setPaused(true);
          return;
        }
        setError(formatGenerationError(cause, t("trustworthyError")));
      });
    return () => controller.abort();
  }, [execute, runNumber, t]);

  const stages = useMemo(
    () => [
      { id: "getting_video" as const, label: t("gettingVideo") },
      { id: "preparing_audio" as const, label: t("preparingAudio") },
      { id: "downloading_model" as const, label: t("downloadingModel") },
      { id: "transcribing_device" as const, label: t("transcribing") },
      { id: "planning_questions" as const, label: t("planningQuestions") },
      { id: "creating_questions" as const, label: t("creatingQuestions") },
      { id: "finalizing_questions" as const, label: t("finalizingQuestions") },
    ],
    [t],
  );
  const failed = Boolean(error);
  const displayedStage = stage;
  const activeIndex = Math.max(
    0,
    stages.findIndex((item) => item.id === displayedStage),
  );
  const bytes =
    detail?.loadedBytes !== undefined && detail.totalBytes !== undefined
      ? `${formatBytes(detail.loadedBytes)} / ${formatBytes(detail.totalBytes)}`
      : null;
  const compactFooter = width < breakpoints.compact;
  const stageTitle = failed
    ? t("generationFailed")
    : paused
      ? t("paused")
      : (stages[activeIndex]?.label ?? t("creatingQuestions"));
  const stepItems = stages.map((item, index) => {
    const current = item.id === displayedStage;
    const complete =
      stage === "complete" ||
      (!paused && stage !== "failed" && index < activeIndex);
    const state: ProcessingStepState =
      failed && index === activeIndex
        ? "error"
        : current
          ? "active"
          : complete
            ? "complete"
            : "upcoming";
    return { label: item.label, state };
  });

  const pause = () => {
    controllerRef.current?.abort();
    setPaused(true);
  };
  const retry = () => {
    setPaused(false);
    setError(undefined);
    setRunNumber((value) => value + 1);
  };
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    controllerRef.current?.abort();
    try {
      await clearGenerationState(params.videoId);
      router.replace("/(tabs)");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("cancelGenerationFailed"),
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Screen
      footer={
        <View
          style={[styles.footerRow, compactFooter && styles.footerRowCompact]}
        >
          <View style={styles.footerAction}>
            <PrimaryButton
              variant="ghost"
              loading={cancelling}
              onPress={() => void cancel()}
            >
              {t("cancel")}
            </PrimaryButton>
          </View>
          {paused || failed ? (
            <View style={styles.footerAction}>
              <PrimaryButton disabled={cancelling} onPress={retry}>
                {t("retry")}
              </PrimaryButton>
            </View>
          ) : localTranscription &&
            [
              "preparing_audio",
              "downloading_model",
              "transcribing_device",
            ].includes(stage) ? (
            <View style={styles.footerAction}>
              <PrimaryButton
                variant="secondary"
                disabled={cancelling}
                onPress={pause}
              >
                {t("pause")}
              </PrimaryButton>
            </View>
          ) : null}
        </View>
      }
      contentWidth="reading"
    >
      <View style={styles.page}>
        <View style={styles.top}>
          <Mascot mood={failed ? "oops" : "thinking"} size={112} />
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.text }]}
          >
            {stageTitle}
          </Text>
        </View>

        <Surface elevated style={styles.processingSurface}>
          <View style={styles.progressSummary}>
            <View style={styles.progressCopy}>
              <Text style={[styles.progressLabel, { color: theme.text }]}>
                {stages[activeIndex]?.label ?? t("creatingQuestions")}
              </Text>
              <Text style={[styles.progressPercent, { color: theme.primary }]}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
            <ProgressBar
              progress={progress}
              accessibilityLabel={
                stages[activeIndex]?.label ?? t("creatingQuestions")
              }
              tone={failed ? "secondary" : "primary"}
            />
            {detail?.cached || bytes ? (
              <View style={styles.detailRow}>
                {detail?.cached ? (
                  <Text style={[styles.cached, { color: theme.success }]}>
                    {t("cached")}
                  </Text>
                ) : null}
                {bytes ? (
                  <Text style={[styles.detail, { color: theme.textMuted }]}>
                    {bytes}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <ProcessingSteps steps={stepItems} />
        </Surface>

        <Surface tone="tinted" style={styles.privacySurface}>
          <View style={styles.privacyRow}>
            <View
              style={[styles.privacyIcon, { backgroundColor: theme.surface }]}
            >
              <MaterialCommunityIcons
                name="shield-lock-outline"
                size={27}
                color={theme.primary}
              />
            </View>
            <Text style={[styles.privacyText, { color: theme.textMuted }]}>
              {t("privateTranscription")}
            </Text>
          </View>
        </Surface>

        {error ? (
          <View accessibilityLiveRegion="assertive">
            <Surface tone="error" style={styles.errorSurface}>
              <View style={styles.errorRow}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={27}
                  color={theme.error}
                />
                <Text
                  accessibilityRole="alert"
                  style={[styles.error, { color: theme.text }]}
                >
                  {error}
                </Text>
              </View>
            </Surface>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function formatGenerationError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  return cause.message;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1_000)} KB`;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}

const styles = StyleSheet.create({
  page: { width: "100%", gap: spacing[5], paddingTop: spacing[2] },
  top: { alignItems: "center", gap: spacing[4], paddingVertical: spacing[3] },
  title: {
    fontFamily: typography.display,
    fontSize: typography.size.displaySmall,
    lineHeight: typography.lineHeight.displaySmall,
    textAlign: "center",
  },
  processingSurface: { width: "100%", gap: spacing[7] },
  progressSummary: { gap: spacing[3] },
  progressCopy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[4],
  },
  progressLabel: {
    flex: 1,
    fontFamily: typography.bodyBold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  progressPercent: {
    fontFamily: typography.displayMedium,
    fontSize: typography.size.titleSmall,
    lineHeight: typography.lineHeight.titleSmall,
  },
  detailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  detail: {
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  cached: {
    fontFamily: typography.bodyBold,
    fontSize: typography.size.caption,
    lineHeight: typography.lineHeight.caption,
  },
  privacySurface: { padding: spacing[4] },
  privacyRow: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  privacyIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  privacyText: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  errorSurface: { padding: spacing[4] },
  errorRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  error: {
    flex: 1,
    fontFamily: typography.bodyMedium,
    fontSize: typography.size.label,
    lineHeight: typography.lineHeight.label,
  },
  footerRow: {
    width: "100%",
    maxWidth: layout.reading,
    alignSelf: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing[3],
  },
  footerRowCompact: { flexDirection: "column" },
  footerAction: { flex: 1, minWidth: 0 },
});
