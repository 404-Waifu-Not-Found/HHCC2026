import {
  DEFAULT_QUIZ_QUESTION_TYPES,
  ExtensionQuizGenerationCallEventResponseSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  GenerationClaimResponseSchema,
  MediaResolveResponseSchema,
  QuizStartResponseSchema,
  QuizGenerationProfileResponseSchema,
  QuizQuestionTypesSchema,
  VerifiedVideoMetadataResponseSchema,
  createTranscriptCompleteness,
  questionLimitForSession,
  type AppLanguage,
  type AttemptGenerationAvailability,
  type ExtensionQuizProgressiveImportResponse,
  type GenerationStage,
  type GenerationRecord,
  type LocalConceptQuizQuestionChunk,
  type LocalGenerationCallEvent,
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
import {
  countCaptionWords,
  estimatedFirstQuestionDurationMs,
  firstQuestionRetryRemainingMs,
  updateFirstQuestionRetryEtaPhase,
  type FirstQuestionRetryEtaPhase,
} from "../../src/generation/eta";
import {
  cancelProgressiveGenerationTask,
  getOrStartProgressiveGenerationTask,
  type ProgressiveGenerationTaskContext,
} from "../../src/generation/progressive-coordinator";
import {
  groundedRecoveryCooldownMs,
  groundedRecoveryIsExhausted,
} from "../../src/generation/automatic-recovery-policy";
import { apiRequest, jsonBody } from "../../src/lib/api";
import { useAppSession } from "../../src/lib/auth-client";
import { useSettings } from "../../src/providers/SettingsProvider";
import {
  FeedbackMotion,
  MotionProgressFill,
  MotionView,
} from "../../src/motion/Motion";
import {
  bindAttemptToGeneration,
  clearGenerationRecord,
  loadGenerationRecord,
  loadImportedVideo,
  saveGenerationRecord,
  startGenerationRecordHeartbeat,
  updateGenerationRecord,
} from "../../src/state/creation";
import { saveAttemptStart } from "../../src/state/attempt";
import { transcribeLocally } from "../../src/transcription/local-transcriber";
import { TranscriptionPausedError } from "../../src/transcription/types";
import { acquireTextTranscript } from "../../src/transcription/acquire-text-transcript";
import {
  LocalGenerationRequestError,
  openClipQuestExtensionSettings,
  requestExtensionLocalQuiz,
  subscribeToClipQuestExtension,
  type LocalGenerationProgress,
} from "../../src/transcription/clipquest-extension";
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

const JOURNEY_TICK_MS = 100;
const LINEAR_PROGRESS_LIMIT = 0.99;

function isAutomaticGenerationProfile(profile: string | undefined): boolean {
  return (
    profile === "stable_auto_recovery_v5_3" ||
    profile === "evidence_grounded_auto_v5_4" ||
    profile === "concept_first_auto_v5_8"
  );
}

function isGroundedGenerationProfile(profile: string | undefined): boolean {
  return (
    profile === "evidence_grounded_auto_v5_4" ||
    profile === "concept_first_auto_v5_8"
  );
}

export default function GenerationScreen() {
  const params = useLocalSearchParams<{
    videoId: string;
    generationId: string;
    watched: string;
    quizLanguage: AppLanguage;
    sessionLength: SessionLength;
    questionTypes?: string;
  }>();
  const { locale, t, theme } = useSettings();
  const { data: session } = useAppSession();
  const { width } = useWindowDimensions();
  const [stage, setStage] = useState<GenerationStage>("getting_video");
  const [error, setError] = useState<string>();
  const [configurationRequired, setConfigurationRequired] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runNumber, setRunNumber] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const taskKeyRef = useRef<string | undefined>(undefined);
  const [localTranscription, setLocalTranscription] = useState(false);
  const [captionWordCount, setCaptionWordCount] = useState<number>();
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number>();
  const [retryEtaPhase, setRetryEtaPhase] =
    useState<FirstQuestionRetryEtaPhase>();
  const questionTypes = useMemo<QuizQuestionType[]>(() => {
    const parsed = QuizQuestionTypesSchema.safeParse(
      params.questionTypes?.split(",").filter(Boolean),
    );
    return parsed.success ? parsed.data : [...DEFAULT_QUIZ_QUESTION_TYPES];
  }, [params.questionTypes]);
  const questionCount = questionLimitForSession(params.sessionLength) as
    5 | 10 | 15;
  const firstQuestionType = questionTypes[0] ?? "multiple_choice";
  const taskKey = useMemo(
    () => `${params.generationId}:${runNumber}`,
    [params.generationId, runNumber],
  );
  const journeyDurationMs = useMemo(
    () =>
      estimatedFirstQuestionDurationMs({
        captionWordCount,
        videoDurationSeconds,
        focusWindowWordCount:
          captionWordCount === undefined
            ? undefined
            : Math.min(520, Math.max(220, Math.round(captionWordCount * 0.08))),
        questionCount,
        firstQuestionType,
        prefixCacheState: "unknown",
        recentLatencyBucket: "unknown",
      }),
    [captionWordCount, firstQuestionType, questionCount, videoDurationSeconds],
  );
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
  const [journeyElapsedMs, setJourneyElapsedMs] = useState(0);
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
    setJourneyElapsedMs(0);
    setRetryEtaPhase(undefined);
  }, []);

  useEffect(() => {
    if (paused || error || finishingPresentationRef.current) return;
    const tick = () => {
      if (journeyStartedAtRef.current === 0) return;
      const elapsed = Date.now() - journeyStartedAtRef.current;
      setJourneyElapsedMs(elapsed);
      setEstimatedProgress(
        Math.min(
          LINEAR_PROGRESS_LIMIT,
          (elapsed / journeyDurationMs) * LINEAR_PROGRESS_LIMIT,
        ),
      );
    };
    tick();
    const timer = setInterval(tick, JOURNEY_TICK_MS);
    return () => clearInterval(timer);
  }, [error, journeyDurationMs, paused, setEstimatedProgress]);

  const execute = useCallback(
    async ({
      signal,
      publish,
      resolveFirst,
    }: ProgressiveGenerationTaskContext) => {
      beginJourney();
      if (!session?.user.id) {
        throw new Error("Sign in again before creating a quiz.");
      }
      if (!isUuid(params.generationId)) {
        throw new Error(
          "This generation setup is outdated. Return home and start the quiz again.",
        );
      }

      const storedRecord = await loadGenerationRecord(params.generationId);
      if (
        !storedRecord ||
        storedRecord.ownerUserId !== session.user.id ||
        storedRecord.videoId !== params.videoId
      ) {
        throw new Error(
          "This generation setup belongs to another tab or account. Return home and start again.",
        );
      }
      let generationRecord: GenerationRecord = storedRecord;
      const routeMatchesRecord =
        generationRecord.quizLanguage === params.quizLanguage &&
        generationRecord.sessionLength === params.sessionLength &&
        generationRecord.watched === (params.watched === "true") &&
        generationRecord.questionTypes.length === questionTypes.length &&
        generationRecord.questionTypes.every(
          (type, index) => type === questionTypes[index],
        );
      if (
        !routeMatchesRecord ||
        generationRecord.plannedCount !== questionCount
      ) {
        throw new Error(
          "This generation setup changed in another tab. Return to the quiz setup before continuing.",
        );
      }

      const updateStage = (nextStage: GenerationStage) => {
        setStage(nextStage);
        publish({ stage: nextStage });
      };
      const persistRecord = async (
        update: Parameters<typeof updateGenerationRecord>[1],
      ) => {
        const next = await updateGenerationRecord(
          generationRecord.generationId,
          update,
        );
        if (!next) {
          throw new Error(
            "The local generation record disappeared while the quiz was running.",
          );
        }
        generationRecord = next;
      };

      const idempotencyKey = generationRecord.idempotencyKey;
      let progressiveQuizId = generationRecord.quizId;
      let attemptId = generationRecord.attemptId;
      let latestGeneration: AttemptGenerationAvailability | undefined;

      const persistState = async () => {
        const nextState = latestGeneration?.state ?? generationRecord.state;
        await persistRecord({
          quizId: progressiveQuizId,
          attemptId,
          acceptedCount:
            latestGeneration?.availableQuestions ??
            generationRecord.acceptedCount,
          state: nextState,
          ...((generationRecord.version === 3 ||
            generationRecord.version === 4) &&
          (nextState === "action_required" || nextState === "generation_failed")
            ? { reasonCode: latestGeneration?.reasonCode }
            : {}),
          ...((generationRecord.version === 3 ||
            generationRecord.version === 4) &&
          nextState !== "retrying"
            ? {
                retryOrdinal: undefined,
                ordinalAttempt: undefined,
                retryKind: undefined,
                retryDelayMs: undefined,
              }
            : {}),
        });
      };

      const startAttempt = async (quizId: string) => {
        const start = await apiRequest(
          `/api/quizzes/${quizId}/start`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
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
        attemptId = start.attemptId;
        latestGeneration = start.generation;
        await saveAttemptStart(start);
        await bindAttemptToGeneration(
          generationRecord.generationId,
          start.attemptId,
          quizId,
        );
        await persistState();
        publish({
          quizId,
          attemptId: start.attemptId,
          generation: start.generation,
        });
        resolveFirst(start);
      };

      if (progressiveQuizId) {
        await startAttempt(progressiveQuizId);
        return;
      }

      const rolloutProfile = generationRecord.generationProfile
        ? {
            generationProfile: generationRecord.generationProfile,
          }
        : await apiRequest(
            "/api/local-ai/profile",
            { signal },
            QuizGenerationProfileResponseSchema,
          );
      await persistRecord({
        state: "generating",
        generationProfile: rolloutProfile.generationProfile,
      });
      const recoverySessionId = Crypto.randomUUID();
      const imported = await loadImportedVideo(params.videoId);
      if (!imported) throw new Error(t("generationSetupExpired"));
      setVideoDurationSeconds(imported.video.durationSeconds || undefined);
      setCaptionWordCount(
        imported.captions.preferredSegments?.length
          ? countCaptionWords(imported.captions.preferredSegments)
          : undefined,
      );
      setLocalTranscription(imported.transcriptionMode === "device_media");
      updateStage("getting_video");
      let segments: TranscriptSegment[] = [];
      let completeness: TranscriptCompleteness | null = null;
      let language = imported.video.sourceLanguage ?? "und";
      let verifiedDurationSeconds = imported.video.durationSeconds;
      let captionSourceCategory:
        "manual" | "automatic" | "local_transcription" | "unknown" = "unknown";
      updateStage("preparing_audio");
      const textTranscript = await acquireTextTranscript(
        imported,
        signal,
        () => undefined,
      );
      if (textTranscript) {
        segments = textTranscript.segments;
        language = textTranscript.language;
        completeness = textTranscript.completeness;
        verifiedDurationSeconds = textTranscript.verifiedDurationSeconds;
        captionSourceCategory = textTranscript.captionSourceCategory;
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
          onPhase: (phase) => updateStage(phase),
          onProgress: () => undefined,
        });
        language = result.language;
        segments = result.segments;
        completeness = createTranscriptCompleteness(
          segments,
          imported.video.durationSeconds,
        );
        verifiedDurationSeconds = imported.video.durationSeconds;
        captionSourceCategory = "local_transcription";
      }
      if (signal.aborted) throw new TranscriptionPausedError();
      if (!completeness) {
        throw new Error(
          "ClipQuest could not verify a complete transcript for this video.",
        );
      }

      if (
        !Number.isInteger(verifiedDurationSeconds) ||
        verifiedDurationSeconds < 1
      ) {
        throw new Error(
          "ClipQuest could not verify the source duration for this video.",
        );
      }

      const completeCaptionWordCount = countCaptionWords(segments);
      await apiRequest(
        `/api/videos/${encodeURIComponent(imported.video.id)}/source-metadata`,
        {
          method: "PATCH",
          body: jsonBody({
            durationSeconds: verifiedDurationSeconds,
            sourceLanguage: language || "und",
            captionSourceCategory,
            captionSegmentCount: segments.length,
            captionWordCount: completeCaptionWordCount,
          }),
          signal,
        },
        VerifiedVideoMetadataResponseSchema,
      );
      beginJourney();
      setCaptionWordCount(completeCaptionWordCount);
      setVideoDurationSeconds(verifiedDurationSeconds);
      updateStage("creating_questions");
      const retryBaseEstimateMs = estimatedFirstQuestionDurationMs({
        captionWordCount: completeCaptionWordCount,
        videoDurationSeconds: verifiedDurationSeconds,
        focusWindowWordCount: Math.min(
          520,
          Math.max(220, Math.round(completeCaptionWordCount * 0.08)),
        ),
        questionCount,
        firstQuestionType,
        prefixCacheState: "unknown",
        recentLatencyBucket: "unknown",
      });
      const context: LocalQuizContext = {
        protocolVersion: 1,
        jobId: idempotencyKey,
        generationId: generationRecord.generationId,
        generationSessionId: generationRecord.generationSessionId,
        ...(isAutomaticGenerationProfile(rolloutProfile.generationProfile)
          ? { recoverySessionId }
          : {}),
        generationProfile: rolloutProfile.generationProfile,
        videoId: imported.video.id,
        title: imported.video.title,
        quizLanguage: params.quizLanguage,
        questionTypes,
        questionCount,
        transcriptFingerprint: completeness.textFingerprint,
        transcriptLanguage: language,
        segments,
      };
      let ingestion = Promise.resolve();
      let lastProgressKey: string | undefined;
      const pendingCallEvents: LocalGenerationCallEvent[] = [];

      const uploadCallEvent = async (event: LocalGenerationCallEvent) => {
        if (!progressiveQuizId) {
          pendingCallEvents.push(event);
          return;
        }
        await apiRequest(
          `/api/quiz-imports/${progressiveQuizId}/calls/${event.generationSessionId}/${event.callIndex}`,
          {
            method: "PUT",
            headers: { "Idempotency-Key": idempotencyKey },
            body: jsonBody(event),
            signal,
          },
          ExtensionQuizGenerationCallEventResponseSchema,
        );
        await persistRecord({
          nextCallIndex: Math.max(
            generationRecord.nextCallIndex,
            event.callIndex + 1,
          ),
          ...((generationRecord.version === 3 ||
            generationRecord.version === 4) &&
          event.classification === "automatic_retry" &&
          (!("lifecycleState" in event) || event.lifecycleState === "started")
            ? {
                automaticRetryCount: Math.min(
                  generationRecord.version === 4 ? 48 : 12,
                  generationRecord.automaticRetryCount + 1,
                ),
              }
            : {}),
        });
      };

      const publishStoredState = async (
        response: ExtensionQuizProgressiveImportResponse,
      ) => {
        progressiveQuizId = response.quizId;
        latestGeneration = response.generation;
        await persistState();
        while (pendingCallEvents.length) {
          await uploadCallEvent(pendingCallEvents.shift()!);
        }
        if (attemptId) {
          publish({
            quizId: response.quizId,
            attemptId,
            generation: response.generation,
          });
        }
      };

      const enqueueQuestion = (chunk: LocalConceptQuizQuestionChunk) => {
        ingestion = ingestion.then(async () => {
          const response = progressiveQuizId
            ? await apiRequest(
                `/api/quiz-imports/${progressiveQuizId}/questions`,
                {
                  method: "PUT",
                  headers: { "Idempotency-Key": idempotencyKey },
                  body: jsonBody({ chunk }),
                  signal,
                },
                ExtensionQuizProgressiveImportResponseSchema,
              )
            : await apiRequest(
                "/api/quiz-imports/progressive",
                {
                  method: "POST",
                  headers: { "Idempotency-Key": idempotencyKey },
                  body: jsonBody({
                    videoId: imported.video.id,
                    quizLanguage: params.quizLanguage,
                    sessionLength: params.sessionLength,
                    questionTypes,
                    watched: params.watched === "true",
                    chunk,
                  }),
                  signal,
                },
                ExtensionQuizProgressiveImportResponseSchema,
              );
          if (
            isAutomaticGenerationProfile(rolloutProfile.generationProfile) &&
            generationRecord.version === 2
          ) {
            if (!chunk.questionPlan) {
              throw new Error("The automatic question plan is missing.");
            }
            const grounded = isGroundedGenerationProfile(
              rolloutProfile.generationProfile,
            );
            const commonRecord = {
              generationId: generationRecord.generationId,
              generationSessionId: generationRecord.generationSessionId,
              recoverySessionId,
              idempotencyKey: generationRecord.idempotencyKey,
              ownerUserId: generationRecord.ownerUserId,
              videoId: generationRecord.videoId,
              quizLanguage: generationRecord.quizLanguage,
              questionTypes: generationRecord.questionTypes,
              sessionLength: generationRecord.sessionLength,
              watched: generationRecord.watched,
              questionPlan: chunk.questionPlan,
              quizId: response.quizId,
              acceptedCount: response.generation.availableQuestions,
              plannedCount: response.generation.totalQuestions,
              state: "generating" as const,
              nextCallIndex: generationRecord.nextCallIndex,
              ordinalAttempts: {},
              automaticRetryCount: 0,
              activeRecoveryStartedAt: Date.now(),
              sourceReadyAt: Date.now(),
              preworkStatus: generationRecord.preworkStatus,
              createdAt: generationRecord.createdAt,
              updatedAt: Date.now(),
            };
            const upgraded = grounded
              ? await saveGenerationRecord({
                  ...commonRecord,
                  version: 4,
                  generationProfile: rolloutProfile.generationProfile as
                    "evidence_grounded_auto_v5_4" | "concept_first_auto_v5_8",
                  recoveryCycle: 0,
                })
              : await saveGenerationRecord({
                  ...commonRecord,
                  version: 3,
                  generationProfile: "stable_auto_recovery_v5_3",
                });
            generationRecord = upgraded;
          }
          await publishStoredState(response);
          if (chunk.questionPlan && !generationRecord.questionPlan) {
            await persistRecord({ questionPlan: chunk.questionPlan });
          }
          lastProgressKey = undefined;
          if (!attemptId) await startAttempt(response.quizId);
        });
        void ingestion.catch(() => undefined);
      };

      const enqueueCall = (event: LocalGenerationCallEvent) => {
        ingestion = ingestion.then(async () => {
          await uploadCallEvent(event);
        });
        void ingestion.catch(() => undefined);
      };

      const enqueueRetrying = (detail: LocalGenerationProgress) => {
        const progressKey = `retrying:${detail.retryOrdinal ?? 0}:${detail.ordinalAttempt ?? detail.attempt ?? 0}`;
        if (lastProgressKey === progressKey) return;
        lastProgressKey = progressKey;
        ingestion = ingestion.then(async () => {
          if (!progressiveQuizId) return;
          if (
            isAutomaticGenerationProfile(rolloutProfile.generationProfile) &&
            (!detail.retryOrdinal ||
              !detail.ordinalAttempt ||
              !detail.retryKind)
          ) {
            throw new Error("Automatic retry metadata is incomplete.");
          }
          const response = await apiRequest(
            `/api/quiz-imports/${progressiveQuizId}/progress`,
            {
              method: "PATCH",
              headers: { "Idempotency-Key": idempotencyKey },
              body: jsonBody(
                isAutomaticGenerationProfile(rolloutProfile.generationProfile)
                  ? {
                      state: "retrying",
                      retryOrdinal: detail.retryOrdinal,
                      ordinalAttempt: detail.ordinalAttempt,
                      retryKind: detail.retryKind,
                      retryDelayMs: detail.retryDelayMs,
                      reasonCode: detail.reasonCode,
                      recoverySessionId,
                      recoveryPhase: "preparing",
                    }
                  : { state: "retrying" },
              ),
              signal,
            },
            ExtensionQuizProgressiveImportResponseSchema,
          );
          if (isAutomaticGenerationProfile(rolloutProfile.generationProfile)) {
            await persistRecord({
              state: "retrying",
              retryOrdinal: detail.retryOrdinal,
              ordinalAttempt: detail.ordinalAttempt,
              retryKind: detail.retryKind,
              retryDelayMs: detail.retryDelayMs,
            });
          }
          await publishStoredState(response);
        });
        void ingestion.catch(() => undefined);
      };
      const stopHeartbeat = startGenerationRecordHeartbeat(
        generationRecord.generationId,
      );
      const serverHeartbeat = setInterval(() => {
        if (
          !isAutomaticGenerationProfile(rolloutProfile.generationProfile) ||
          !attemptId ||
          !progressiveQuizId
        ) {
          return;
        }
        void apiRequest(
          `/api/attempts/${attemptId}/generation/heartbeat`,
          {
            method: "PUT",
            body: jsonBody({
              claimKey: idempotencyKey,
              generationSessionId: generationRecord.generationSessionId,
              recoverySessionId,
            }),
            signal,
          },
          GenerationClaimResponseSchema,
        ).catch(() => undefined);
      }, 10_000);

      try {
        await requestExtensionLocalQuiz(
          context,
          signal,
          (nextStage, _progress, detail) => {
            updateStage(nextStage);
            if (detail.status === "retrying") {
              setRetryEtaPhase((current) =>
                updateFirstQuestionRetryEtaPhase(
                  current,
                  detail,
                  retryBaseEstimateMs,
                ),
              );
              enqueueRetrying(detail);
            }
          },
          enqueueQuestion,
          enqueueCall,
        );
        await ingestion;
        if (!latestGeneration || latestGeneration.state !== "ready") {
          throw new Error(
            "DeepSeek finished before every planned question was stored.",
          );
        }
        updateStage("complete");
        await clearGenerationRecord(generationRecord.generationId);
      } catch (cause) {
        await ingestion.catch(() => undefined);
        const reasonCode =
          cause instanceof LocalGenerationRequestError
            ? cause.reasonCode
            : "local_state_conflict";
        const automatic = isAutomaticGenerationProfile(
          rolloutProfile.generationProfile,
        );
        const grounded = isGroundedGenerationProfile(
          rolloutProfile.generationProfile,
        );
        const groundedExhausted =
          grounded &&
          groundedRecoveryIsExhausted({
            reasonCode,
            record: generationRecord,
          });
        const terminalState = automatic
          ? reasonCode === "credential_required" ||
            reasonCode === "billing_required"
            ? "action_required"
            : grounded && !groundedExhausted
              ? "cooldown"
              : "generation_failed"
          : "retry_required";
        const nextRecoveryAt =
          terminalState === "cooldown"
            ? Date.now() +
              groundedRecoveryCooldownMs(
                generationRecord.version === 4
                  ? generationRecord.recoveryCycle
                  : 0,
              )
            : undefined;
        if (!progressiveQuizId) {
          if (!automatic) {
            await persistRecord({ state: "retry_required" }).catch(
              () => undefined,
            );
          }
          throw cause;
        }
        const response = await apiRequest(
          `/api/quiz-imports/${progressiveQuizId}/progress`,
          {
            method: "PATCH",
            headers: { "Idempotency-Key": idempotencyKey },
            body: jsonBody({
              state: terminalState,
              reasonCode,
              ...(automatic ? { recoverySessionId } : {}),
              ...(nextRecoveryAt
                ? { nextRecoveryAt: new Date(nextRecoveryAt).toISOString() }
                : {}),
            }),
          },
          ExtensionQuizProgressiveImportResponseSchema,
        ).catch(() => undefined);
        if (response) {
          await publishStoredState(response);
        } else {
          await persistRecord({
            state: terminalState,
            ...(automatic ? { reasonCode } : {}),
            ...(nextRecoveryAt ? { nextRecoveryAt } : {}),
          }).catch(() => undefined);
        }
        if (!attemptId) throw cause;
      } finally {
        clearInterval(serverHeartbeat);
        stopHeartbeat();
      }
    },
    [
      beginJourney,
      firstQuestionType,
      params.generationId,
      params.quizLanguage,
      params.sessionLength,
      params.videoId,
      params.watched,
      questionCount,
      questionTypes,
      session?.user.id,
      t,
    ],
  );

  useEffect(() => {
    taskKeyRef.current = taskKey;
    const task = getOrStartProgressiveGenerationTask(taskKey, execute);
    const unsubscribe = task.subscribe((snapshot) => {
      setStage(snapshot.stage);
    });
    let active = true;
    void task.firstReady
      .then((start) => {
        if (!active) return;
        finishingPresentationRef.current = true;
        setEstimatedProgress(1);
        setStage("complete");
        router.replace({
          pathname: "/quiz/[attemptId]",
          params: {
            attemptId: start.attemptId,
            generationId: params.generationId,
          },
        });
      })
      .catch((cause) => {
        if (!active || taskKeyRef.current !== taskKey) return;
        if (
          cause instanceof TranscriptionPausedError ||
          task.controller.signal.aborted
        ) {
          setPaused(true);
          return;
        }
        setError(formatGenerationError(cause, t("trustworthyError")));
        setConfigurationRequired(
          cause instanceof LocalGenerationRequestError &&
            (cause.reasonCode === "credential_required" ||
              cause.reasonCode === "billing_required"),
        );
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [execute, params.generationId, setEstimatedProgress, t, taskKey]);

  useEffect(() => {
    if (!configurationRequired) return;
    let restarting = false;
    return subscribeToClipQuestExtension((extension) => {
      if (!extension.configured || restarting) return;
      restarting = true;
      void (async () => {
        const current = await loadGenerationRecord(params.generationId);
        if (!current || current.acceptedCount > 0) return;
        await updateGenerationRecord(params.generationId, {
          generationSessionId: Crypto.randomUUID(),
          idempotencyKey: Crypto.randomUUID(),
          nextCallIndex: 0,
          state: "generating",
        });
        setError(undefined);
        setConfigurationRequired(false);
        setRunNumber((value) => value + 1);
      })().catch((cause) => {
        restarting = false;
        setError(
          cause instanceof Error ? cause.message : t("trustworthyError"),
        );
      });
    });
  }, [configurationRequired, params.generationId, t]);

  const failed = Boolean(error);
  const activeIndex = journeyStepIndex(estimatedProgress, journeySteps.length);
  const activeStep = journeySteps[activeIndex] ?? journeySteps[0]!;
  const estimatedSecondsLeft = Math.max(
    0,
    Math.ceil((journeyDurationMs - journeyElapsedMs) / 1_000),
  );
  const retrySecondsLeft = retryEtaPhase
    ? Math.ceil(firstQuestionRetryRemainingMs(retryEtaPhase) / 1_000)
    : undefined;
  const compactFooter = width < breakpoints.compact;
  const stageTitle = failed
    ? t("generationFailed")
    : paused
      ? t("paused")
      : activeStep.label;

  const pause = () => {
    if (taskKeyRef.current) cancelProgressiveGenerationTask(taskKeyRef.current);
    setPaused(true);
  };
  const resumePausedGeneration = () => {
    void (async () => {
      if (!isUuid(params.generationId)) return;
      const current = await loadGenerationRecord(params.generationId);
      if (!current || current.acceptedCount > 0) return;
      await updateGenerationRecord(params.generationId, {
        generationSessionId: Crypto.randomUUID(),
        idempotencyKey: Crypto.randomUUID(),
        nextCallIndex: 0,
        state: "generating",
      });
      setPaused(false);
      setError(undefined);
      setConfigurationRequired(false);
      setRunNumber((value) => value + 1);
    })().catch((cause) => {
      setError(cause instanceof Error ? cause.message : t("trustworthyError"));
    });
  };
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    if (taskKeyRef.current) cancelProgressiveGenerationTask(taskKeyRef.current);
    try {
      if (isUuid(params.generationId)) {
        await clearGenerationRecord(params.generationId);
      }
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
          {paused ? (
            <View style={styles.footerAction}>
              <PrimaryButton
                disabled={cancelling}
                onPress={resumePausedGeneration}
              >
                {locale === "zh-CN" ? "恢复" : "Resume"}
              </PrimaryButton>
            </View>
          ) : failed && configurationRequired ? (
            <View style={styles.footerAction}>
              <PrimaryButton
                disabled={cancelling}
                onPress={openClipQuestExtensionSettings}
              >
                {locale === "zh-CN"
                  ? "打开扩展设置"
                  : "Open extension settings"}
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
        <MotionView preset="drop" style={styles.top}>
          <LearningPrism size={112} variant="tile" />
          <MotionView key={stageTitle} preset="rise" exiting>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: theme.text }]}
            >
              {stageTitle}
            </Text>
          </MotionView>
        </MotionView>

        <MotionView preset="rise" delay={60}>
          <Surface elevated style={styles.processingSurface}>
            <View style={styles.progressSummary}>
              <View style={styles.progressCopy}>
                <Text style={[styles.progressLabel, { color: theme.text }]}>
                  {activeStep.label} · {activeIndex + 1}/{journeySteps.length}
                </Text>
                <FeedbackMotion signal={activeIndex} kind="progress">
                  <Text
                    style={[styles.progressPercent, { color: theme.primary }]}
                  >
                    {Math.round(estimatedProgress * 100)}%
                  </Text>
                </FeedbackMotion>
              </View>
              <LinearJourneyBar
                progress={estimatedProgress}
                accessibilityLabel={`${t("estimatedProgress")}: ${Math.round(estimatedProgress * 100)}%`}
                failed={failed}
                segmentCount={journeySteps.length}
              />
              <View style={styles.detailRow}>
                <Text style={[styles.detail, { color: theme.textMuted }]}>
                  {t("firstQuestionEta")}
                </Text>
                <Text style={[styles.detail, { color: theme.textMuted }]}>
                  {retryEtaPhase && retrySecondsLeft !== undefined
                    ? formatRetryFirstQuestionRemaining(
                        retryEtaPhase,
                        retrySecondsLeft,
                        locale,
                      )
                    : estimatedSecondsLeft > 0
                      ? formatFirstQuestionRemaining(
                          estimatedSecondsLeft,
                          locale,
                        )
                      : t("firstQuestionTakingLonger")}
                </Text>
              </View>
              {retryEtaPhase ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.visuallyHidden}
                >
                  {formatRetryTransition(retryEtaPhase, locale)}
                </Text>
              ) : null}
            </View>
          </Surface>
        </MotionView>

        <MotionView preset="rise" delay={120}>
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
        </MotionView>

        {error ? (
          <FeedbackMotion signal={error} kind="error">
            <MotionView
              preset="rise"
              exiting
              accessibilityLiveRegion="assertive"
            >
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
            </MotionView>
          </FeedbackMotion>
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
      <MotionProgressFill
        progress={value}
        duration={120}
        color={failed ? theme.secondary : theme.primary}
        style={styles.journeyFill}
      >
        <View style={styles.journeyHighlight} />
      </MotionProgressFill>
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

function formatFirstQuestionRemaining(
  seconds: number,
  locale: "en" | "zh-CN",
): string {
  if (seconds < 60) {
    const roundedSeconds = Math.max(5, Math.ceil(seconds / 5) * 5);
    return locale === "zh-CN"
      ? `第一题预计约 ${roundedSeconds} 秒后出现`
      : `Question 1 in about ${roundedSeconds} sec`;
  }
  const minutes = Math.ceil(seconds / 60);
  return locale === "zh-CN"
    ? `第一题预计约 ${minutes} 分钟后出现`
    : `Question 1 in about ${minutes} min`;
}

function formatRetryFirstQuestionRemaining(
  phase: FirstQuestionRetryEtaPhase,
  seconds: number,
  locale: "en" | "zh-CN",
): string {
  if (seconds <= 0) {
    return locale === "zh-CN"
      ? `第 ${phase.attempt}/${phase.maxAttempts} 次尝试仍在生成第一题`
      : `Retry ${phase.attempt}/${phase.maxAttempts} is still streaming`;
  }
  const roundedSeconds = Math.max(5, Math.ceil(seconds / 5) * 5);
  return locale === "zh-CN"
    ? `正在重试 ${phase.attempt}/${phase.maxAttempts} · 第一题预计约 ${roundedSeconds} 秒后出现`
    : `Retrying ${phase.attempt}/${phase.maxAttempts} · about ${roundedSeconds} seconds to question 1`;
}

function formatRetryTransition(
  phase: FirstQuestionRetryEtaPhase,
  locale: "en" | "zh-CN",
): string {
  return locale === "zh-CN"
    ? `正在开始第 ${phase.attempt}/${phase.maxAttempts} 次尝试`
    : `Starting retry ${phase.attempt} of ${phase.maxAttempts}`;
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
  visuallyHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0.01,
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
