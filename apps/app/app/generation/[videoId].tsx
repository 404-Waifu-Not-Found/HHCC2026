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

type JourneyPhase = "video" | "transcript" | "ai" | "finalizing" | "complete";

type JourneyStep = {
  id: string;
  label: string;
  durationSeconds: number;
};

const JOURNEY_TICK_MS = 250;
const MINIMUM_FINAL_STEP_MS = 550;

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
      { id: "video", label: t("gettingVideo"), durationSeconds: 5 },
      {
        id: "transcript",
        label: t("findingTranscript"),
        durationSeconds: 10,
      },
      {
        id: "lesson-text",
        label: t("preparingLessonText"),
        durationSeconds: 6,
      },
      {
        id: "concepts",
        label: t("mappingConcepts"),
        durationSeconds:
          questionCount === 5 ? 12 : questionCount === 10 ? 16 : 20,
      },
      {
        id: "questions",
        label: t("writingQuestions"),
        durationSeconds:
          questionCount === 5 ? 45 : questionCount === 10 ? 75 : 105,
      },
      {
        id: "choices",
        label: t("shufflingChoices"),
        durationSeconds: 5,
      },
      {
        id: "opening",
        label: t("finalizingQuestions"),
        durationSeconds: 6,
      },
    ],
    [questionCount, t],
  );
  const [estimatedProgress, setEstimatedProgressState] = useState(0);
  const [journeyPhase, setJourneyPhase] = useState<JourneyPhase>("video");
  const [phaseOverdue, setPhaseOverdue] = useState(false);
  const estimatedProgressRef = useRef(0);
  const journeyPhaseStartedAtRef = useRef(0);
  const finishingPresentationRef = useRef(false);

  const setEstimatedProgress = useCallback((next: number) => {
    const normalized = Math.max(
      estimatedProgressRef.current,
      Math.min(1, next),
    );
    estimatedProgressRef.current = normalized;
    setEstimatedProgressState(normalized);
  }, []);

  const beginJourneyPhase = useCallback((next: JourneyPhase, reset = false) => {
    journeyPhaseStartedAtRef.current = Date.now();
    finishingPresentationRef.current = false;
    setJourneyPhase(next);
    setPhaseOverdue(false);
    if (reset) {
      estimatedProgressRef.current = 0;
      setEstimatedProgressState(0);
    }
  }, []);

  useEffect(() => {
    if (paused || error || finishingPresentationRef.current) return;
    const tick = () => {
      const range = journeyPhaseRange(journeySteps, journeyPhase);
      const elapsedSeconds =
        (Date.now() - journeyPhaseStartedAtRef.current) / 1_000;
      setPhaseOverdue(
        journeyPhase !== "complete" && elapsedSeconds > range.durationSeconds,
      );
      const timedFraction = Math.min(
        journeyPhase === "complete" ? 1 : 0.96,
        elapsedSeconds / Math.max(1, range.durationSeconds),
      );
      const target = range.start + (range.end - range.start) * timedFraction;
      const current = estimatedProgressRef.current;
      const maxAdvance = reduceMotion ? 1 : 0.012;
      setEstimatedProgress(
        current + Math.min(maxAdvance, Math.max(0, target - current)),
      );
    };
    tick();
    const timer = setInterval(tick, JOURNEY_TICK_MS);
    return () => clearInterval(timer);
  }, [
    error,
    journeyPhase,
    journeySteps,
    paused,
    reduceMotion,
    setEstimatedProgress,
  ]);

  const finishJourneyPresentation = useCallback(
    async (signal: AbortSignal) => {
      finishingPresentationRef.current = true;
      setJourneyPhase("complete");
      setPhaseOverdue(false);
      const firstUnseenStep = journeyStepIndex(
        journeySteps,
        estimatedProgressRef.current,
      );
      for (
        let index = firstUnseenStep;
        index < journeySteps.length;
        index += 1
      ) {
        const range = journeyStepRange(journeySteps, index);
        setEstimatedProgress(range.start + (range.end - range.start) * 0.55);
        if (!reduceMotion) {
          await abortableDelay(MINIMUM_FINAL_STEP_MS, signal);
        }
      }
      setEstimatedProgress(1);
    },
    [journeySteps, reduceMotion, setEstimatedProgress],
  );

  const execute = useCallback(
    async (signal: AbortSignal) => {
      beginJourneyPhase("video", true);
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
      beginJourneyPhase("transcript");
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
      beginJourneyPhase("ai");
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
      beginJourneyPhase("finalizing");
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
      beginJourneyPhase,
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
  const activeIndex = journeyStepIndex(journeySteps, estimatedProgress);
  const activeStep = journeySteps[activeIndex] ?? journeySteps[0]!;
  const activeStepRange = journeyStepRange(journeySteps, activeIndex);
  const activeStepFraction = Math.max(
    0,
    Math.min(
      1,
      (estimatedProgress - activeStepRange.start) /
        Math.max(0.001, activeStepRange.end - activeStepRange.start),
    ),
  );
  const estimatedSecondsLeft = journeySteps.reduce(
    (total, item, index) =>
      total +
      (index < activeIndex
        ? 0
        : index === activeIndex
          ? item.durationSeconds * (1 - activeStepFraction)
          : item.durationSeconds),
    0,
  );
  const compactFooter = width < breakpoints.compact;
  const stageTitle = failed
    ? t("generationFailed")
    : paused
      ? t("paused")
      : activeStep.label;
  const stepItems = journeySteps.map((item, index) => {
    const current = index === activeIndex;
    const complete = stage === "complete" || (!paused && index < activeIndex);
    const state: ProcessingStepState =
      failed && index === activeIndex
        ? "error"
        : current
          ? "active"
          : complete
            ? "complete"
            : "upcoming";
    const stepRemaining = Math.max(
      1,
      Math.ceil(item.durationSeconds * (current ? 1 - activeStepFraction : 1)),
    );
    return {
      label: item.label,
      state,
      detail:
        state === "complete"
          ? t("stepComplete")
          : current && phaseOverdue
            ? t("takingLonger")
            : current
              ? formatEstimatedRemaining(stepRemaining, locale)
              : formatPlannedDuration(item.durationSeconds, locale),
    };
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
                {activeStep.label} · {activeIndex + 1}/{journeySteps.length}
              </Text>
              <Text style={[styles.progressPercent, { color: theme.primary }]}>
                {Math.round(estimatedProgress * 100)}%
              </Text>
            </View>
            <ProgressBar
              progress={estimatedProgress}
              accessibilityLabel={`${t("estimatedProgress")}: ${Math.round(estimatedProgress * 100)}%`}
              tone={failed ? "secondary" : "primary"}
            />
            <View style={styles.detailRow}>
              <Text style={[styles.detail, { color: theme.textMuted }]}>
                {t("estimatedProgress")}
              </Text>
              <Text style={[styles.detail, { color: theme.textMuted }]}>
                {phaseOverdue
                  ? t("takingLonger")
                  : formatEstimatedRemaining(estimatedSecondsLeft, locale)}
              </Text>
            </View>
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

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}

function journeyStepRange(
  steps: readonly JourneyStep[],
  index: number,
): { start: number; end: number; durationSeconds: number } {
  const total = steps.reduce((sum, item) => sum + item.durationSeconds, 0);
  const startSeconds = steps
    .slice(0, index)
    .reduce((sum, item) => sum + item.durationSeconds, 0);
  const durationSeconds = steps[index]?.durationSeconds ?? 0;
  return {
    start: startSeconds / total,
    end: (startSeconds + durationSeconds) / total,
    durationSeconds,
  };
}

function journeyStepIndex(
  steps: readonly JourneyStep[],
  progress: number,
): number {
  if (progress >= 1) return steps.length - 1;
  for (let index = 0; index < steps.length; index += 1) {
    if (progress < journeyStepRange(steps, index).end) return index;
  }
  return steps.length - 1;
}

function journeyPhaseRange(
  steps: readonly JourneyStep[],
  phase: JourneyPhase,
): { start: number; end: number; durationSeconds: number } {
  const indexes =
    phase === "video"
      ? [0]
      : phase === "transcript"
        ? [1, 2]
        : phase === "ai"
          ? [3, 4, 5]
          : phase === "finalizing"
            ? [6]
            : steps.map((_, index) => index);
  const first = journeyStepRange(steps, indexes[0] ?? 0);
  const last = journeyStepRange(steps, indexes[indexes.length - 1] ?? 0);
  return {
    start: first.start,
    end: last.end,
    durationSeconds: indexes.reduce(
      (sum, index) => sum + (steps[index]?.durationSeconds ?? 0),
      0,
    ),
  };
}

function formatPlannedDuration(
  seconds: number,
  locale: "en" | "zh-CN",
): string {
  if (seconds < 60) {
    return locale === "zh-CN" ? `约 ${seconds} 秒` : `~${seconds} sec`;
  }
  const minutes = Math.ceil(seconds / 60);
  return locale === "zh-CN" ? `约 ${minutes} 分钟` : `~${minutes} min`;
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
