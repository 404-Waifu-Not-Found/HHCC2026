import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  GenerationStatusSchema,
  MediaResolveResponseSchema,
  QuizQuestionTypesSchema,
  QuizStartResponseSchema,
  TranscriptUploadResponseSchema,
  createTranscriptCompleteness,
  type AppLanguage,
  type GenerationStage,
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
import { apiRequest, ClientApiError, jsonBody } from "../../src/lib/api";
import { isGenerationPollExpired } from "../../src/lib/generation-timeout";
import { useSettings } from "../../src/providers/SettingsProvider";
import { saveAttemptStart } from "../../src/state/attempt";
import {
  clearGenerationState,
  clearImportedVideo,
  loadGenerationState,
  loadImportedVideo,
  saveGenerationState,
} from "../../src/state/creation";
import { transcribeLocally } from "../../src/transcription/local-transcriber";
import { TranscriptionPausedError } from "../../src/transcription/types";
import { acquireTextTranscript } from "../../src/transcription/acquire-text-transcript";
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

function sameQuestionTypes(
  stored: QuizQuestionType[] | undefined,
  requested: QuizQuestionType[],
): boolean {
  return (
    stored?.length === requested.length &&
    stored.every((type, index) => type === requested[index])
  );
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

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
  const [jobId, setJobId] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const [localTranscription, setLocalTranscription] = useState(false);
  const importedRef =
    useRef<Awaited<ReturnType<typeof loadImportedVideo>>>(null);
  const questionTypes = useMemo<QuizQuestionType[]>(() => {
    const parsed = QuizQuestionTypesSchema.safeParse(
      params.questionTypes?.split(",").filter(Boolean),
    );
    return parsed.success ? parsed.data : [...DEFAULT_QUIZ_QUESTION_TYPES];
  }, [params.questionTypes]);

  const execute = useCallback(
    async (signal: AbortSignal, retryExisting: boolean) => {
      const imported = await loadImportedVideo(params.videoId);
      if (!imported) throw new Error(t("generationSetupExpired"));
      importedRef.current = imported;
      setLocalTranscription(imported.transcriptionMode === "device_media");
      let storedGeneration = await loadGenerationState(imported.video.id);
      if (
        !storedGeneration ||
        storedGeneration.quizLanguage !== params.quizLanguage ||
        !sameQuestionTypes(storedGeneration.questionTypes, questionTypes)
      ) {
        storedGeneration = {
          idempotencyKey: Crypto.randomUUID(),
          quizLanguage: params.quizLanguage,
          questionTypes,
        };
        await saveGenerationState(imported.video.id, storedGeneration);
      }

      let queuedJobId = storedGeneration.jobId;
      if (!queuedJobId && storedGeneration.preworkStatus === "running") {
        for (let attempt = 0; attempt < 6 && !queuedJobId; attempt += 1) {
          await waitFor(250, signal);
          const latest = await loadGenerationState(imported.video.id);
          if (latest?.idempotencyKey !== storedGeneration.idempotencyKey) break;
          storedGeneration = latest;
          queuedJobId = latest.jobId;
          if (latest.preworkStatus !== "running") break;
        }
      }
      if (!queuedJobId) {
        try {
          const found = await apiRequest(
            `/api/generation/idempotency/${encodeURIComponent(storedGeneration.idempotencyKey)}`,
            { signal },
            TranscriptUploadResponseSchema.nullable(),
          );
          if (found) {
            queuedJobId = found.jobId;
            storedGeneration = { ...storedGeneration, jobId: queuedJobId };
            await saveGenerationState(imported.video.id, storedGeneration);
          }
        } catch (cause) {
          if (!(cause instanceof ClientApiError && cause.status === 404))
            throw cause;
        }
      }

      if (queuedJobId) {
        setJobId(queuedJobId);
        setStage("creating_questions");
        setProgress(0.05);
        if (retryExisting) {
          await apiRequest(
            `/api/generation/${queuedJobId}/retry`,
            { method: "POST", signal },
            GenerationStatusSchema,
          );
        }
        const quizId = await pollGeneration(
          queuedJobId,
          signal,
          (value) => setProgress(value),
          t("generationTimeout"),
        );
        await startQuiz(quizId, imported.video.id, signal);
        return;
      }

      setStage("getting_video");
      setProgress(1);
      let segments: TranscriptSegment[] = [];
      let completeness: TranscriptCompleteness | null = null;
      let language = imported.video.sourceLanguage ?? "und";
      let origin: "captions" | "device_whisper" = "captions";
      let acquisition:
        | "server_captions"
        | "youtube_signed_captions"
        | "youtube_text_provider"
        | "device_whisper" = "server_captions";
      setStage("preparing_audio");
      const textTranscript = await acquireTextTranscript(
        imported,
        signal,
        setProgress,
      );
      if (textTranscript) {
        segments = textTranscript.segments;
        language = textTranscript.language;
        acquisition = textTranscript.acquisition;
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
        origin = "device_whisper";
        acquisition = "device_whisper";
      }
      if (signal.aborted) throw new TranscriptionPausedError();
      if (!completeness) {
        throw new Error(
          "ClipQuest could not verify a complete transcript for this video.",
        );
      }
      setStage("creating_questions");
      setProgress(0.04);
      setDetail(undefined);
      const queued = await apiRequest(
        "/api/transcripts",
        {
          method: "POST",
          signal,
          headers: { "Idempotency-Key": storedGeneration.idempotencyKey },
          body: jsonBody({
            videoId: imported.video.id,
            language,
            origin,
            acquisition,
            completeness,
            segments,
            quizLanguage: params.quizLanguage,
            sessionLength: "long",
            watched: params.watched === "true",
            questionTypes,
          }),
        },
        TranscriptUploadResponseSchema,
      );
      setJobId(queued.jobId);
      await saveGenerationState(imported.video.id, {
        ...storedGeneration,
        jobId: queued.jobId,
      });
      const quizId = await pollGeneration(
        queued.jobId,
        signal,
        (value) => setProgress(value),
        t("generationTimeout"),
      );
      await startQuiz(quizId, imported.video.id, signal);

      async function startQuiz(
        quizId: string,
        videoId: string,
        startSignal: AbortSignal,
      ) {
        const start = await apiRequest(
          `/api/quizzes/${quizId}/start`,
          {
            method: "POST",
            signal: startSignal,
            body: jsonBody({
              mode: "learn",
              sessionLength: params.sessionLength,
              questionTypes,
              watched: params.watched === "true",
            }),
          },
          QuizStartResponseSchema,
        );
        await saveAttemptStart(start);
        await clearImportedVideo(videoId);
        setStage("complete");
        setProgress(1);
        router.replace({
          pathname: "/quiz/[attemptId]",
          params: { attemptId: start.attemptId },
        });
      }
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
      .then(() => execute(controller.signal, runNumber > 0))
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
        setError(
          cause instanceof Error ? cause.message : t("trustworthyError"),
        );
      });
    return () => controller.abort();
  }, [execute, runNumber, t]);

  const stages = useMemo(
    () => [
      { id: "getting_video" as const, label: t("gettingVideo") },
      { id: "preparing_audio" as const, label: t("preparingAudio") },
      { id: "downloading_model" as const, label: t("downloadingModel") },
      { id: "transcribing_device" as const, label: t("transcribing") },
      { id: "creating_questions" as const, label: t("creatingQuestions") },
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
      const stored = await loadGenerationState(params.videoId);
      const activeJobId = jobId ?? stored?.jobId;
      if (activeJobId)
        await apiRequest(
          `/api/generation/${activeJobId}`,
          { method: "DELETE" },
          GenerationStatusSchema,
        );
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

async function pollGeneration(
  jobId: string,
  signal: AbortSignal,
  onProgress: (value: number) => void,
  timeoutMessage: string,
): Promise<string> {
  const startedAt = Date.now();
  while (!signal.aborted) {
    if (isGenerationPollExpired(startedAt, Date.now()))
      throw new Error(timeoutMessage);
    const status = await apiRequest(
      `/api/generation/${jobId}`,
      { signal },
      GenerationStatusSchema,
    );
    onProgress(Math.max(0.05, status.progress));
    if (status.stage === "complete" && status.quizId) return status.quizId;
    if (status.stage === "failed")
      throw new Error(status.error?.message ?? timeoutMessage);
    await wait(500, signal);
  }
  throw new TranscriptionPausedError();
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new TranscriptionPausedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1_000)} KB`;
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
