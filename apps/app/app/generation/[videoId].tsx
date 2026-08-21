import {
  GenerationStatusSchema,
  MediaResolveResponseSchema,
  QuizStartResponseSchema,
  TranscriptUploadResponseSchema,
  type AppLanguage,
  type GenerationStage,
  type SessionLength,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Mascot } from "../../src/components/Mascot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressBar } from "../../src/components/ProgressBar";
import { Screen } from "../../src/components/Screen";
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
import { radii, typography } from "../../src/theme/tokens";

type ProgressDetail = { loadedBytes?: number; totalBytes?: number; cached?: boolean };

export default function GenerationScreen() {
  const params = useLocalSearchParams<{ videoId: string; watched: string; quizLanguage: AppLanguage; sessionLength: SessionLength }>();
  const { t, theme } = useSettings();
  const [stage, setStage] = useState<GenerationStage>("getting_video");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState<ProgressDetail>();
  const [error, setError] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [runNumber, setRunNumber] = useState(0);
  const [jobId, setJobId] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const localTranscriptionRef = useRef(false);

  const execute = useCallback(async (signal: AbortSignal, retryExisting: boolean) => {
    const imported = await loadImportedVideo(params.videoId);
    if (!imported) throw new Error(t("generationSetupExpired"));
    let storedGeneration = await loadGenerationState(imported.video.id);
    if (!storedGeneration) {
      storedGeneration = { idempotencyKey: Crypto.randomUUID() };
      await saveGenerationState(imported.video.id, storedGeneration);
    }

    let queuedJobId = storedGeneration.jobId;
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
        if (!(cause instanceof ClientApiError && cause.status === 404)) throw cause;
      }
    }

    if (queuedJobId) {
      setJobId(queuedJobId);
      setStage("creating_questions");
      setProgress(0.05);
      if (retryExisting) {
        await apiRequest(`/api/generation/${queuedJobId}/retry`, { method: "POST", signal }, GenerationStatusSchema);
      }
      const quizId = await pollGeneration(queuedJobId, signal, (value) => setProgress(value), t("generationTimeout"));
      await startQuiz(quizId, imported.video.id, signal);
      return;
    }

    setStage("getting_video");
    setProgress(1);
    let segments: TranscriptSegment[];
    let language = imported.video.sourceLanguage ?? "und";
    let origin: "captions" | "device_whisper" = "captions";
    if (imported.captions.preferredSegments?.length) {
      setStage("preparing_audio");
      setProgress(1);
      segments = imported.captions.preferredSegments;
    } else {
      localTranscriptionRef.current = true;
      const media = await apiRequest(
        "/api/media/resolve",
        { method: "POST", body: jsonBody({ videoId: imported.video.id }), signal },
        MediaResolveResponseSchema,
      );
      const result = await transcribeLocally({
        videoId: imported.video.id,
        mediaUrl: media.mediaUrl,
        durationSeconds: imported.video.durationSeconds,
        language: imported.video.sourceLanguage,
        signal,
        onPhase: (phase) => { setStage(phase); setProgress(0); },
        onProgress: (value, nextDetail) => { setProgress(value); setDetail(nextDetail); },
      });
      language = result.language;
      segments = result.segments;
      origin = "device_whisper";
    }
    if (signal.aborted) throw new TranscriptionPausedError();
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
          segments,
          quizLanguage: params.quizLanguage,
          sessionLength: params.sessionLength,
          watched: params.watched === "true",
        }),
      },
      TranscriptUploadResponseSchema,
    );
    setJobId(queued.jobId);
    await saveGenerationState(imported.video.id, { ...storedGeneration, jobId: queued.jobId });
    const quizId = await pollGeneration(queued.jobId, signal, (value) => setProgress(value), t("generationTimeout"));
    await startQuiz(quizId, imported.video.id, signal);

    async function startQuiz(quizId: string, videoId: string, startSignal: AbortSignal) {
      const start = await apiRequest(
        `/api/quizzes/${quizId}/start`,
        { method: "POST", signal: startSignal, body: jsonBody({ mode: "learn", sessionLength: params.sessionLength }) },
        QuizStartResponseSchema,
      );
      await saveAttemptStart(start);
      await clearImportedVideo(videoId);
      setStage("complete");
      setProgress(1);
      router.replace({ pathname: "/quiz/[attemptId]", params: { attemptId: start.attemptId } });
    }
  }, [params.quizLanguage, params.sessionLength, params.videoId, params.watched, t]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    localTranscriptionRef.current = false;
    setPaused(false);
    setError(undefined);
    void execute(controller.signal, runNumber > 0).catch((cause) => {
      if (cause instanceof TranscriptionPausedError || controller.signal.aborted) {
        setPaused(true);
        return;
      }
      setStage("failed");
      setError(cause instanceof Error ? cause.message : t("trustworthyError"));
    });
    return () => controller.abort();
  }, [execute, runNumber, t]);

  const stages = useMemo(() => [
    { id: "getting_video" as const, label: t("gettingVideo") },
    { id: "preparing_audio" as const, label: t("preparingAudio") },
    { id: "downloading_model" as const, label: t("downloadingModel") },
    { id: "transcribing_device" as const, label: t("transcribing") },
    { id: "creating_questions" as const, label: t("creatingQuestions") },
  ], [t]);
  const activeIndex = Math.max(0, stages.findIndex((item) => item.id === stage));
  const bytes = detail?.loadedBytes !== undefined && detail.totalBytes !== undefined
    ? `${formatBytes(detail.loadedBytes)} / ${formatBytes(detail.totalBytes)}`
    : null;

  const pause = () => {
    controllerRef.current?.abort();
    setPaused(true);
  };
  const retry = () => setRunNumber((value) => value + 1);
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    controllerRef.current?.abort();
    try {
      const stored = await loadGenerationState(params.videoId);
      const activeJobId = jobId ?? stored?.jobId;
      if (activeJobId) await apiRequest(`/api/generation/${activeJobId}`, { method: "DELETE" }, GenerationStatusSchema);
      await clearGenerationState(params.videoId);
      router.replace("/(tabs)");
    } catch (cause) {
      setPaused(false);
      setStage("failed");
      setError(cause instanceof Error ? cause.message : t("cancelGenerationFailed"));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Screen footer={
      <View style={styles.footerRow}>
        <PrimaryButton variant="ghost" loading={cancelling} onPress={() => void cancel()}>{t("cancel")}</PrimaryButton>
        {paused || stage === "failed" ? <PrimaryButton disabled={cancelling} onPress={retry}>{t("retry")}</PrimaryButton> : localTranscriptionRef.current && ["preparing_audio", "downloading_model", "transcribing_device"].includes(stage) ? <PrimaryButton variant="secondary" disabled={cancelling} onPress={pause}>{t("pause")}</PrimaryButton> : null}
      </View>
    }>
      <View style={styles.top}>
        <Mascot mood={stage === "failed" ? "oops" : "thinking"} size={96} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {stage === "failed" ? t("generationFailed") : paused ? t("paused") : stages[activeIndex]?.label ?? t("creatingQuestions")}
        </Text>
        <Text style={[styles.privacy, { color: theme.textMuted }]}>{t("privateTranscription")}</Text>
      </View>

      <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {stages.map((item, index) => {
          const current = item.id === stage;
          const done = stage === "complete" || (!paused && stage !== "failed" && index < activeIndex);
          const skippedModel = index === 2 && stage === "creating_questions" && !localTranscriptionRef.current;
          return (
            <View key={item.id} style={styles.stageRow}>
              <View style={[styles.stageIcon, { borderColor: current ? theme.secondary : theme.border, backgroundColor: done || skippedModel ? theme.primary : theme.elevated }]}>
                <MaterialCommunityIcons name={done || skippedModel ? "check" : current ? "dots-horizontal" : "circle-small"} size={22} color={theme.text} />
              </View>
              <View style={styles.stageCopy}>
                <Text style={[styles.stageLabel, { color: current ? theme.text : theme.textMuted }]}>{item.label}</Text>
                {current ? (
                  <View style={styles.progressWrap}>
                    <ProgressBar progress={progress} accessibilityLabel={item.label} />
                    <View style={styles.detailRow}>
                      <Text style={[styles.detail, { color: theme.textMuted }]}>{Math.round(progress * 100)}%</Text>
                      {detail?.cached ? <Text style={[styles.cached, { color: theme.success }]}>{t("cached")}</Text> : null}
                      {bytes ? <Text style={[styles.detail, { color: theme.textMuted }]}>{bytes}</Text> : null}
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.error }]}>{error}</Text> : null}
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
    if (isGenerationPollExpired(startedAt, Date.now())) throw new Error(timeoutMessage);
    const status = await apiRequest(`/api/generation/${jobId}`, { signal }, GenerationStatusSchema);
    onProgress(Math.max(0.05, status.progress));
    if (status.stage === "complete" && status.quizId) return status.quizId;
    if (status.stage === "failed") throw new Error(status.error?.message ?? timeoutMessage);
    await wait(1_500, signal);
  }
  throw new TranscriptionPausedError();
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new TranscriptionPausedError()); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1_000)} KB`;
}

const styles = StyleSheet.create({
  top: { alignItems: "center", gap: 10, paddingTop: 12, paddingBottom: 18 },
  title: { fontFamily: typography.display, fontSize: 29, lineHeight: 35, textAlign: "center" },
  privacy: { maxWidth: 620, fontFamily: typography.body, fontSize: 13, lineHeight: 19, textAlign: "center" },
  panel: { width: "100%", maxWidth: 680, alignSelf: "center", borderWidth: 2, borderRadius: radii.large, padding: 18, gap: 3 },
  stageRow: { flexDirection: "row", alignItems: "flex-start", gap: 13, minHeight: 58 },
  stageIcon: { width: 38, height: 38, borderWidth: 2, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  stageCopy: { flex: 1, paddingTop: 8, paddingBottom: 12 },
  stageLabel: { fontFamily: typography.bodyBold, fontSize: 16 },
  progressWrap: { gap: 7, marginTop: 10 },
  detailRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  detail: { fontFamily: typography.bodyMedium, fontSize: 12 },
  cached: { fontFamily: typography.bodyBold, fontSize: 12 },
  error: { maxWidth: 680, alignSelf: "center", fontFamily: typography.bodyMedium, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 16 },
  footerRow: { width: "100%", maxWidth: 680, alignSelf: "center", flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
});
