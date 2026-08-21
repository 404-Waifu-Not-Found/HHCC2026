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
import { VoxelIcon } from "../../src/components/VoxelIcon";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { LearningPrism } from "../../src/components/LearningPrism";
import { PrimaryButton } from "../../src/components/PrimaryButton";
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

type JourneyStep = {
  id: string;
  label: string;
};

const JOURNEY_DURATION_MS = 35_000;
const JOURNEY_TICK_MS = 100;
const LINEAR_PROGRESS_LIMIT = 0.99;
const FINAL_SWEEP_MS = 500;
const FINAL_SWEEP_TICK_MS = 25;
const FINAL_SWEEP_ANIMATION_MS = FINAL_SWEEP_MS - FINAL_SWEEP_TICK_MS;

export default function GenerationScreen() {
  const params = useLocalSearchParams<{
    videoId: string;
    watched: string;
    quizLanguage: AppLanguage;
    sessionLength: SessionLength;
    questionTypes?: string;
  }>();
  const { locale, reduceMotion, t, theme } = useSettings();
  const { width } = useWindowDimensions();
  const [stage, setStage] = useState<GenerationStage>("getting_video");
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
  const questionCount = questionLimitForSession(params.sessionLength) as
    5 | 10 | 15;
  const journeySteps = useMemo<JourneyStep[]>(
    () => [
      { id: "video", label: t("gettingVideo") },
      { id: "captions", label: t("preparingAudio") },
      { id: "model", label: t("downloadingModel") },
      { id: "transcribing", label: t("transcribing") },
      { id: "planning", label: t("planningQuestions") },
      { id: "questions", label: t("creatingQuestions") },
      { id: "opening", label: t("finalizingQuestions") },
    ],
    [t],
  );
  const [estimatedProgress, setEstimatedProgressState] = useState(0);
  const estimatedProgressRef = useRef(0);
  const journeyStartedAtRef = useRef(0);
  const finishingPresentationRef = useRef(false);

  const setEstimatedProgress = useCallback((next: number) => {
    const normalized = Math.max(
      estimatedProgressRef.current,
      Math.min(1, next),
    );
    estimatedProgressRef.current = normalized;
    setEstimatedProgressState(normalized);
  }, []);

  const beginJourney = useCallback(() => {
    journeyStartedAtRef.current = Date.now();
    finishingPresentationRef.current = false;
    estimatedProgressRef.current = 0;
    setEstimatedProgressState(0);
  }, []);

  useEffect(() => {
    if (paused || error || finishingPresentationRef.current) return;
    const tick = () => {
      if (journeyStartedAtRef.current === 0) return;
      const elapsed = Date.now() - journeyStartedAtRef.current;
      setEstimatedProgress(
        Math.min(
          LINEAR_PROGRESS_LIMIT,
          (elapsed / JOURNEY_DURATION_MS) * LINEAR_PROGRESS_LIMIT,
        ),
      );
    };
    tick();
    const timer = setInterval(tick, JOURNEY_TICK_MS);
    return () => clearInterval(timer);
  }, [error, paused, setEstimatedProgress]);

  const finishJourneyPresentation = useCallback(
    async (signal: AbortSignal) => {
      finishingPresentationRef.current = true;
      const initialProgress = estimatedProgressRef.current;
      if (reduceMotion) {
        setEstimatedProgress(1);
        return;
      }
      const sweepStartedAt = Date.now();
      while (Date.now() - sweepStartedAt < FINAL_SWEEP_ANIMATION_MS) {
        const sweepProgress = Math.min(
          1,
          (Date.now() - sweepStartedAt) / FINAL_SWEEP_ANIMATION_MS,
        );
        setEstimatedProgress(
          initialProgress + (1 - initialProgress) * sweepProgress,
        );
        await abortableDelay(FINAL_SWEEP_TICK_MS, signal);
      }
      setEstimatedProgress(1);
      await abortableDelay(FINAL_SWEEP_TICK_MS, signal);
    },
    [reduceMotion, setEstimatedProgress],
  );

  const execute = useCallback(
    async (signal: AbortSignal) => {
      beginJourney();
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
      let segments: TranscriptSegment[] = [];
      let completeness: TranscriptCompleteness | null = null;
      let language = imported.video.sourceLanguage ?? "und";
      setStage("preparing_audio");
      const textTranscript = await acquireTextTranscript(
        imported,
        signal,
        () => undefined,
      );
      if (textTranscript) {
        segments = textTranscript.segments;
        language = textTranscript.language;
        completeness = textTranscript.completeness;
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
          },
          onProgress: () => undefined,
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
      const context: LocalQuizContext = {
        protocolVersion: 1,
        jobId: idempotencyKey,
        videoId: imported.video.id,
        title: imported.video.title,
        quizLanguage: params.quizLanguage,
        questionTypes,
        questionCount,
        transcriptFingerprint: completeness.textFingerprint,
        transcriptLanguage: language,
        segments,
      };
      const result = await requestExtensionLocalQuiz(
        context,
        signal,
        (nextStage) => {
          setStage(nextStage);
        },
      );
      setStage("finalizing_questions");
      const importedQuiz = await apiRequest(
        "/api/quiz-imports",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: jsonBody({
            videoId: imported.video.id,
            quizLanguage: params.quizLanguage,
            sessionLength: params.sessionLength,
            questionTypes,
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
            questionTypes,
            watched: params.watched === "true",
          }),
          signal,
        },
        QuizStartResponseSchema,
      );
      await saveAttemptStart(start);
      await clearImportedVideo(imported.video.id);
      await finishJourneyPresentation(signal);
      setStage("complete");
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
      beginJourney,
      finishJourneyPresentation,
      questionCount,
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

  const failed = Boolean(error);
  const activeIndex = journeyStepIndex(estimatedProgress, journeySteps.length);
  const activeStep = journeySteps[activeIndex] ?? journeySteps[0]!;
  const linearFraction = Math.max(
    0,
    Math.min(1, estimatedProgress / LINEAR_PROGRESS_LIMIT),
  );
  const estimatedSecondsLeft = Math.max(
    0,
    Math.ceil((JOURNEY_DURATION_MS / 1_000) * (1 - linearFraction)),
  );
  const compactFooter = width < breakpoints.compact;
  const stageTitle = failed
    ? t("generationFailed")
    : paused
      ? t("paused")
      : activeStep.label;

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
          <LearningPrism size={112} variant="tile" />
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
                {activeStep.label} · {activeIndex + 1}/{journeySteps.length}
              </Text>
              <Text style={[styles.progressPercent, { color: theme.primary }]}>
                {Math.round(estimatedProgress * 100)}%
              </Text>
            </View>
            <LinearJourneyBar
              progress={estimatedProgress}
              accessibilityLabel={`${t("estimatedProgress")}: ${Math.round(estimatedProgress * 100)}%`}
              failed={failed}
              segmentCount={journeySteps.length}
            />
            <View style={styles.detailRow}>
              <Text style={[styles.detail, { color: theme.textMuted }]}>
                {t("estimatedProgress")}
              </Text>
              <Text style={[styles.detail, { color: theme.textMuted }]}>
                {estimatedSecondsLeft > 0
                  ? formatEstimatedRemaining(estimatedSecondsLeft, locale)
                  : t("takingLonger")}
              </Text>
            </View>
          </View>
        </Surface>

        <Surface tone="tinted" style={styles.privacySurface}>
          <View style={styles.privacyRow}>
            <View
              style={[styles.privacyIcon, { backgroundColor: theme.surface }]}
            >
              <VoxelIcon name="privacy" size={27} color={theme.primary} />
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
                <VoxelIcon name="error" size={27} color={theme.error} />
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

function LinearJourneyBar({
  progress,
  accessibilityLabel,
  failed,
  segmentCount,
}: {
  progress: number;
  accessibilityLabel: string;
  failed: boolean;
  segmentCount: number;
}) {
  const { theme } = useSettings();
  const value = Math.max(0, Math.min(1, progress));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={[styles.journeyTrack, { backgroundColor: theme.surfaceSunken }]}
    >
      <View
        style={[
          styles.journeyFill,
          {
            width: `${value * 100}%`,
            backgroundColor: failed ? theme.secondary : theme.primary,
          },
        ]}
      >
        <View style={styles.journeyHighlight} />
      </View>
      <View pointerEvents="none" style={styles.journeySegments}>
        {Array.from({ length: segmentCount }, (_, index) => (
          <View
            key={index}
            style={[
              styles.journeySegment,
              index < segmentCount - 1
                ? {
                    borderRightColor: theme.surface,
                    borderRightWidth: 2,
                  }
                : null,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function formatGenerationError(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  return cause.message;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}

function journeyStepIndex(progress: number, stepCount: number): number {
  if (stepCount <= 1) return 0;
  return Math.min(
    stepCount - 1,
    Math.floor(
      (Math.min(progress, LINEAR_PROGRESS_LIMIT) / LINEAR_PROGRESS_LIMIT) *
        stepCount,
    ),
  );
}

function formatEstimatedRemaining(
  seconds: number,
  locale: "en" | "zh-CN",
): string {
  if (seconds < 60) {
    const roundedSeconds = Math.max(5, Math.ceil(seconds / 5) * 5);
    return locale === "zh-CN"
      ? `预计还需约 ${roundedSeconds} 秒`
      : `About ${roundedSeconds} sec left`;
  }
  const minutes = Math.ceil(seconds / 60);
  return locale === "zh-CN"
    ? `预计还需约 ${minutes} 分钟`
    : `About ${minutes} min left`;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new TranscriptionPausedError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new TranscriptionPausedError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
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
  journeyTrack: {
    position: "relative",
    height: 12,
    overflow: "hidden",
    borderRadius: radii.pill,
  },
  journeyFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
    borderRadius: radii.pill,
  },
  journeyHighlight: {
    height: 3,
    marginHorizontal: 5,
    marginTop: 2,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  journeySegments: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
  },
  journeySegment: { flex: 1 },
  detailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  detail: {
    fontFamily: typography.bodyMedium,
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
