import {
  AttemptGenerationResponseSchema,
  ExtensionQuizGenerationCallEventResponseSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  GenerationFailureCodeSchema,
  GenerationClaimResponseSchema,
  MediaResolveResponseSchema,
  VideoImportResponseSchema,
  VerifiedVideoMetadataResponseSchema,
  createTranscriptCompleteness,
  type AutomaticRetryKind,
  type GenerationFailureCode,
  type GenerationRecord,
  type LocalConceptQuizQuestionChunk,
  type LocalGenerationCallEvent,
  type LocalQuizContext,
  type TranscriptCompleteness,
  type TranscriptSegment,
} from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { apiRequest, ClientApiError, jsonBody } from "../lib/api";
import { countCaptionWords } from "./eta";
import {
  authClient,
  type AppSession as AuthAppSession,
} from "../lib/auth-client";
import {
  loadGenerationRecord,
  loadGenerationRecordForAttempt,
  loadImportedVideo,
  clearGenerationRecord,
  saveImportedVideo,
  saveGenerationRecord,
  startGenerationRecordHeartbeat,
  updateGenerationRecord,
} from "../state/creation";
import { acquireTextTranscript } from "../transcription/acquire-text-transcript";
import {
  flushLocalGenerationOutbox,
  LocalGenerationRequestError,
  requestLocalQuiz,
  type LocalGenerationProgress,
} from "./local-generation-client";
import { transcribeLocally } from "../transcription/local-transcriber";
import {
  getOrStartProgressiveRecoveryTask,
  publishAttemptGeneration,
} from "./progressive-coordinator";
import {
  authoritativeRecoveryFailureCode,
  groundedRecoveryCooldownMs,
  groundedRecoveryIsExhausted,
} from "./automatic-recovery-policy";
import { retryAuthoritativeTelemetryWrite } from "./telemetry-write";

const RECOVERY_HEARTBEAT_MS = 10_000;

function automaticProfile(profile: string | undefined): boolean {
  return (
    profile === "stable_auto_recovery_v5_3" ||
    profile === "evidence_grounded_auto_v5_4" ||
    profile === "concept_first_auto_v5_8" ||
    profile === "prompt_first_auto_v5_9" ||
    profile === "prompt_first_auto_v5_10" ||
    profile === "prompt_first_auto_v5_11" ||
    profile === "prompt_first_auto_v5_12"
  );
}

export function ensureProgressiveAttemptRecovery(
  attemptId: string,
): Promise<void> {
  return getOrStartProgressiveRecoveryTask(attemptId, (signal) =>
    runAutomaticRecovery(attemptId, signal),
  ).completion;
}

async function runAutomaticRecovery(
  attemptId: string,
  signal: AbortSignal,
): Promise<void> {
  const status = await readStatus(attemptId, signal);
  if (status.generation.state === "ready" || !status.continuation) {
    return;
  }
  const continuation = status.continuation;
  const profileAutomatic = automaticProfile(continuation.generationProfile);
  const legacyAutomaticRecovery = continuation.resultProtocolVersion === 5;
  const automatic = profileAutomatic || legacyAutomaticRecovery;
  const grounded =
    continuation.generationProfile === "evidence_grounded_auto_v5_4" ||
    continuation.generationProfile === "concept_first_auto_v5_8" ||
    continuation.generationProfile === "prompt_first_auto_v5_9" ||
    continuation.generationProfile === "prompt_first_auto_v5_10" ||
    continuation.generationProfile === "prompt_first_auto_v5_11" ||
    continuation.generationProfile === "prompt_first_auto_v5_12";
  if (
    status.generation.state === "cooldown" &&
    status.generation.nextRecoveryAt &&
    Date.parse(status.generation.nextRecoveryAt) > Date.now()
  ) {
    return;
  }
  if (
    status.generation.state === "action_required" ||
    (status.generation.state === "generation_failed" &&
      status.continuation.claim.state !== "available")
  ) {
    return;
  }
  const sessionResult = await authClient.getSession();
  const session = sessionResult.data as AuthAppSession | null;
  if (!session?.user.id) return;
  // Native apps use one active scene. Preserve the local lease identity
  // across a foreground interruption so that the same app can renew the lease
  // immediately. Web tabs still receive independent claim identities.
  let stored =
    Platform.OS !== "web"
      ? await matchingGenerationRecord(attemptId, status.quizId)
      : null;
  const resumableNativeLease =
    Platform.OS !== "web" &&
    stored &&
    (stored.version === 3 || stored.version === 4) &&
    stored.generationSessionId === continuation.generationSessionId
      ? stored
      : undefined;
  const claimKey = resumableNativeLease
    ? resumableNativeLease.idempotencyKey
    : Crypto.randomUUID();
  const generationSessionId =
    continuation.generationSessionId ??
    (legacyAutomaticRecovery ? Crypto.randomUUID() : undefined);
  if (!generationSessionId) {
    throw new Error("The generation session metadata is missing.");
  }
  const recoverySessionId = automatic
    ? resumableNativeLease
      ? resumableNativeLease.recoverySessionId
      : Crypto.randomUUID()
    : undefined;

  let claim;
  try {
    claim = await apiRequest(
      `/api/attempts/${attemptId}/generation/claim`,
      {
        method: "POST",
        body: jsonBody({
          claimKey,
          generationSessionId,
          ...(recoverySessionId ? { recoverySessionId } : {}),
        }),
        signal,
      },
      GenerationClaimResponseSchema,
    );
  } catch (error) {
    if (isLeaseConflict(error)) return;
    throw error;
  }

  if (automatic && recoverySessionId) {
    const preparing = await updateProgress(status.quizId, claimKey, {
      state: "recovering",
      recoverySessionId,
      recoveryPhase: "preparing",
    });
    publishAttemptGeneration(attemptId, status.quizId, preparing.generation);
  }

  let imported = await loadImportedVideo(session.user.id, continuation.videoId);
  if (!imported) {
    try {
      imported = await apiRequest(
        `/api/videos/${encodeURIComponent(continuation.videoId)}/recovery`,
        { signal },
        VideoImportResponseSchema,
      );
      await saveImportedVideo(session.user.id, imported);
    } catch (error) {
      const terminal =
        error instanceof ClientApiError && error.code === "video_not_found";
      const state = automatic && !terminal ? "cooldown" : "generation_failed";
      const nextRecoveryAt =
        state === "cooldown"
          ? Date.now() + groundedRecoveryCooldownMs(0)
          : undefined;
      const stopped = await stopGeneration(status.quizId, claimKey, {
        state,
        reasonCode: "source_unavailable",
        ...(nextRecoveryAt
          ? { nextRecoveryAt: new Date(nextRecoveryAt).toISOString() }
          : {}),
      }).catch(() => undefined);
      if (stopped) {
        publishAttemptGeneration(attemptId, status.quizId, stopped.generation);
      }
      return;
    }
  }

  const generationId = continuation.generationId ?? Crypto.randomUUID();
  stored ??= await matchingGenerationRecord(attemptId, status.quizId);
  if (!stored && continuation.generationId) {
    const candidate = await loadGenerationRecord(continuation.generationId);
    if (
      candidate?.ownerUserId === session.user.id &&
      candidate.quizId === status.quizId
    ) {
      stored = candidate;
    }
  }
  if (profileAutomatic && (!continuation.questionPlan || !recoverySessionId)) {
    throw new Error("The automatic question plan is missing.");
  }
  const stopLeaseHeartbeat =
    automatic && recoverySessionId
      ? startRecoveryLeaseHeartbeat({
          attemptId,
          claimKey,
          generationSessionId,
          recoverySessionId,
          signal,
        })
      : () => undefined;
  let transcript;
  try {
    transcript = await acquireContinuationTranscript(
      session.user.id,
      imported,
      signal,
      continuation.quizLanguage,
    );
  } catch (error) {
    stopLeaseHeartbeat();
    throw error;
  }
  const captionWordCount = countCaptionWords(transcript.segments);
  await apiRequest(
    `/api/videos/${encodeURIComponent(imported.video.id)}/source-metadata`,
    {
      method: "PATCH",
      body: jsonBody({
        durationSeconds: transcript.verifiedDurationSeconds,
        sourceLanguage: transcript.language || "und",
        captionSourceCategory: transcript.captionSourceCategory,
        captionSegmentCount: transcript.segments.length,
        captionWordCount,
      }),
      signal,
    },
    VerifiedVideoMetadataResponseSchema,
  );

  const timestamp = Date.now();
  try {
    if (profileAutomatic) {
      if (!continuation.questionPlan || !recoverySessionId) {
        throw new Error("The automatic question plan is missing.");
      }
      const commonRecord = {
        generationId,
        generationSessionId,
        recoverySessionId,
        idempotencyKey: claimKey,
        ownerUserId: session.user.id,
        videoId: continuation.videoId,
        quizLanguage: continuation.quizLanguage,
        questionTypes: continuation.questionTypes,
        sessionLength: continuation.sessionLength,
        watched: continuation.watched,
        questionPlan: continuation.questionPlan,
        quizId: status.quizId,
        attemptId,
        acceptedCount: status.generation.availableQuestions,
        plannedCount: status.generation.totalQuestions,
        state: "recovering" as const,
        nextCallIndex: continuation.nextCallIndex ?? 0,
        ordinalAttempts: {
          [String(status.generation.availableQuestions + 1)]:
            continuation.nextOrdinalAttempt ?? 1,
        },
        automaticRetryCount: continuation.automaticRetryCount ?? 0,
        activeRecoveryStartedAt: timestamp,
        createdAt: stored?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      stored = grounded
        ? await saveGenerationRecord({
            ...commonRecord,
            version: 4,
            generationProfile: continuation.generationProfile as
              | "evidence_grounded_auto_v5_4"
              | "concept_first_auto_v5_8"
              | "prompt_first_auto_v5_9"
              | "prompt_first_auto_v5_10"
              | "prompt_first_auto_v5_11"
              | "prompt_first_auto_v5_12",
            recoveryCycle:
              stored?.version === 4
                ? Math.min(24, stored.recoveryCycle + 1)
                : 1,
          })
        : await saveGenerationRecord({
            ...commonRecord,
            version: 3,
            generationProfile: "stable_auto_recovery_v5_3",
          });
    } else {
      stored = await saveGenerationRecord({
        version: 2,
        generationId,
        generationSessionId,
        idempotencyKey: claimKey,
        ownerUserId: session.user.id,
        videoId: continuation.videoId,
        quizLanguage: continuation.quizLanguage,
        questionTypes: continuation.questionTypes,
        sessionLength: continuation.sessionLength,
        watched: continuation.watched,
        generationProfile: continuation.generationProfile,
        questionPlan: continuation.questionPlan,
        quizId: status.quizId,
        attemptId,
        acceptedCount: status.generation.availableQuestions,
        plannedCount: status.generation.totalQuestions,
        state: "retrying",
        nextCallIndex: continuation.nextCallIndex ?? 0,
        createdAt: stored?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
    }
  } catch (error) {
    stopLeaseHeartbeat();
    throw error;
  }

  publishAttemptGeneration(attemptId, status.quizId, {
    ...status.generation,
    state: automatic ? "recovering" : "retrying",
    ...(recoverySessionId ? { recoverySessionId } : {}),
    ...(automatic ? { recoveryPhase: "preparing" as const } : {}),
  });

  const context: LocalQuizContext = {
    protocolVersion: 1,
    jobId: claimKey,
    generationId,
    generationSessionId,
    ...(recoverySessionId ? { recoverySessionId } : {}),
    generationProfile: continuation.generationProfile,
    videoId: imported.video.id,
    title: imported.video.title,
    quizLanguage: continuation.quizLanguage,
    questionTypes: continuation.questionTypes,
    questionCount: status.generation.totalQuestions,
    transcriptFingerprint: transcript.completeness.textFingerprint,
    transcriptLanguage: transcript.language,
    segments: transcript.segments,
    continuation: {
      startIndex: continuation.startIndex,
      resultProtocolVersion: continuation.resultProtocolVersion,
      promptVersion: continuation.promptVersion,
      validatorVersion: continuation.validatorVersion,
      client: continuation.client,
      generationProfile: continuation.generationProfile,
      questionPlan: continuation.questionPlan,
      claim: claim.claim,
      nextCallIndex: automatic ? continuation.nextCallIndex : 0,
      nextOrdinalAttempt: continuation.activeCall
        ? Math.min(24, continuation.activeCall.ordinalAttempt + 1)
        : continuation.nextOrdinalAttempt,
      retryKind: continuation.activeCall
        ? "automatic_resume"
        : continuation.retryKind,
      automaticRetryCount: continuation.automaticRetryCount,
      retryBudgetUsedCount: continuation.retryBudgetUsedCount,
      retryOrdinals: continuation.activeCall
        ? [
            ...new Set([
              ...(continuation.retryOrdinals ?? []),
              continuation.activeCall.startIndex + 1,
            ]),
          ].sort((left, right) => left - right)
        : continuation.retryOrdinals,
      previousOutcome: continuation.activeCall
        ? "network_interrupted"
        : continuation.previousOutcome,
      acceptedQuestions: continuation.acceptedQuestions,
      promptFingerprint: continuation.promptFingerprint,
    },
  };

  let latest = status.generation;
  let ingestion = Promise.resolve();
  let lastProgressState = "recovering";
  let automaticRetryCount =
    stored?.version === 3 || stored?.version === 4
      ? stored.automaticRetryCount
      : (continuation.automaticRetryCount ?? 0);
  let retryBudgetUsedCount =
    continuation.retryBudgetUsedCount ?? automaticRetryCount;
  let latestOrdinalAttempt = continuation.nextOrdinalAttempt ?? 1;
  let latestModelFailureReason: GenerationFailureCode | undefined;
  const stopLocalHeartbeat = startGenerationRecordHeartbeat(generationId);

  const enqueueCall = (event: LocalGenerationCallEvent) => {
    ingestion = ingestion.then(async () => {
      await retryAuthoritativeTelemetryWrite(
        () =>
          apiRequest(
            `/api/quiz-imports/${status.quizId}/calls/${event.generationSessionId}/${event.callIndex}`,
            {
              method: "PUT",
              headers: { "Idempotency-Key": claimKey },
              body: jsonBody(event),
              signal,
            },
            ExtensionQuizGenerationCallEventResponseSchema,
          ),
        signal,
      );
      if ("lifecycleState" in event) {
        if (
          event.lifecycleState === "completed" &&
          event.outcome !== "complete"
        ) {
          latestModelFailureReason = GenerationFailureCodeSchema.safeParse(
            event.outcome,
          ).data;
        }
        latest = {
          ...latest,
          recoveryPhase:
            event.lifecycleState === "started" ? "dispatched" : undefined,
          activeCallIndex:
            event.lifecycleState === "started" ? event.callIndex : undefined,
        };
        publishAttemptGeneration(attemptId, status.quizId, latest);
      }
      if (
        event.classification === "automatic_retry" &&
        (!("lifecycleState" in event) || event.lifecycleState === "started")
      ) {
        automaticRetryCount = Math.min(
          continuation.promptVersion === "quiz-local-json-stream-v5.12" ||
            continuation.promptVersion === "quiz-local-json-stream-v5.11" ||
            continuation.promptVersion === "quiz-local-json-stream-v5.10" ||
            continuation.promptVersion === "quiz-local-json-stream-v5.9" ||
            continuation.promptVersion === "quiz-local-json-stream-v5.8" ||
            continuation.promptVersion === "quiz-local-json-stream-v5.7" ||
            continuation.promptVersion === "quiz-local-json-stream-v5.6" ||
            legacyAutomaticRecovery
            ? 12
            : grounded
              ? 48
              : 12,
          automaticRetryCount + 1,
        );
        retryBudgetUsedCount = Math.min(48, retryBudgetUsedCount + 1);
      }
      // The Worker event is authoritative. A stale or missing browser cache
      // record cannot be allowed to poison the ingestion chain and suppress
      // the remaining model-call events.
      await updateGenerationRecord(
        generationId,
        stored?.version === 3 || stored?.version === 4
          ? {
              nextCallIndex: event.callIndex + 1,
              ...(event.classification === "automatic_retry"
                ? { automaticRetryCount }
                : {}),
            }
          : { nextCallIndex: event.callIndex + 1 },
      ).catch(() => undefined);
    });
    void ingestion.catch(() => undefined);
    return ingestion;
  };

  const enqueueQuestion = (chunk: LocalConceptQuizQuestionChunk) => {
    ingestion = ingestion.then(async () => {
      const response = await apiRequest(
        `/api/quiz-imports/${status.quizId}/questions`,
        {
          method: "PUT",
          headers: { "Idempotency-Key": claimKey },
          body: jsonBody({ chunk }),
          signal,
        },
        ExtensionQuizProgressiveImportResponseSchema,
      );
      latest = response.generation;
      publishAttemptGeneration(attemptId, status.quizId, latest);
      await updateGenerationRecord(
        generationId,
        stored?.version === 3 || stored?.version === 4
          ? {
              acceptedCount: latest.availableQuestions,
              state: latest.state,
              retryOrdinal: undefined,
              ordinalAttempt: undefined,
              retryKind: undefined,
              retryDelayMs: undefined,
            }
          : {
              acceptedCount: latest.availableQuestions,
              state: latest.state,
            },
      );
    });
    void ingestion.catch(() => undefined);
    return ingestion;
  };

  try {
    const replayed = await flushLocalGenerationOutbox(
      generationId,
      enqueueQuestion,
      enqueueCall,
    );
    await ingestion;
    if (replayed.questions > 0) {
      const refreshed = await readStatus(attemptId, signal);
      latest = refreshed.generation;
      publishAttemptGeneration(attemptId, status.quizId, latest);
      if (latest.state === "ready") {
        await clearGenerationRecord(generationId);
        return;
      }
      if (!refreshed.continuation || !context.continuation) {
        throw new Error("Automatic recovery metadata is missing.");
      }
      context.continuation = {
        ...context.continuation,
        startIndex: refreshed.continuation.startIndex,
        acceptedQuestions: refreshed.continuation.acceptedQuestions,
        nextCallIndex: refreshed.continuation.nextCallIndex,
        nextOrdinalAttempt: refreshed.continuation.nextOrdinalAttempt,
        retryKind: refreshed.continuation.retryKind,
        automaticRetryCount: refreshed.continuation.automaticRetryCount,
        retryBudgetUsedCount: refreshed.continuation.retryBudgetUsedCount,
        retryOrdinals: refreshed.continuation.retryOrdinals,
        previousOutcome: refreshed.continuation.previousOutcome,
      };
    }
    await requestLocalQuiz(
      context,
      signal,
      (_stage, _progress, detail) => {
        if (!automatic || !recoverySessionId) return;
        const nextState =
          detail.status === "retrying" ? "retrying" : "generating";
        if (
          nextState === lastProgressState &&
          detail.ordinalAttempt === undefined
        ) {
          return;
        }
        lastProgressState = nextState;
        if (detail.ordinalAttempt) {
          latestOrdinalAttempt = detail.ordinalAttempt;
        }
        ingestion = ingestion.then(async () => {
          // A progress snapshot may race an append. It is safe to drop after
          // bounded retries; model-call and question writes remain fail-closed.
          const response = await retryAuthoritativeTelemetryWrite(
            () =>
              updateProgress(
                status.quizId,
                claimKey,
                progressPayload(nextState, detail, recoverySessionId),
                signal,
              ),
            signal,
          ).catch(() => undefined);
          if (!response) return;
          latest = response.generation;
          publishAttemptGeneration(attemptId, status.quizId, latest);
          await updateGenerationRecord(
            generationId,
            stored?.version === 3 || stored?.version === 4
              ? {
                  state: nextState,
                  ...(nextState === "retrying"
                    ? {
                        retryOrdinal: detail.retryOrdinal,
                        ordinalAttempt: detail.ordinalAttempt,
                        retryKind: detail.retryKind,
                        retryDelayMs: detail.retryDelayMs,
                      }
                    : {
                        retryOrdinal: undefined,
                        ordinalAttempt: undefined,
                        retryKind: undefined,
                        retryDelayMs: undefined,
                      }),
                }
              : { state: nextState },
          ).catch(() => undefined);
        });
        void ingestion.catch(() => undefined);
      },
      enqueueQuestion,
      enqueueCall,
    );
    await ingestion;
    if (latest.state !== "ready") {
      throw new Error("Automatic recovery ended before the bank was complete.");
    }
    await clearGenerationRecord(generationId);
  } catch (error) {
    await ingestion.catch(() => undefined);
    if (signal.aborted || isLeaseConflict(error)) return;
    const reasonCode = authoritativeRecoveryFailureCode({
      requestReasonCode:
        error instanceof LocalGenerationRequestError
          ? error.reasonCode
          : undefined,
      endedBeforeComplete:
        error instanceof Error &&
        error.message ===
          "Automatic recovery ended before the bank was complete.",
      latestModelFailureReason,
    });
    const groundedExhausted =
      grounded &&
      groundedRecoveryIsExhausted({
        reasonCode,
        record: stored,
        automaticRetryCount,
        ordinalAttempt: latestOrdinalAttempt,
        strictBudget:
          continuation.promptVersion === "quiz-local-json-stream-v5.12" ||
          continuation.promptVersion === "quiz-local-json-stream-v5.11" ||
          continuation.promptVersion === "quiz-local-json-stream-v5.10" ||
          continuation.promptVersion === "quiz-local-json-stream-v5.9" ||
          continuation.promptVersion === "quiz-local-json-stream-v5.8" ||
          continuation.promptVersion === "quiz-local-json-stream-v5.7" ||
          continuation.promptVersion === "quiz-local-json-stream-v5.6",
      });
    const compatibilityExhausted =
      legacyAutomaticRecovery &&
      (retryBudgetUsedCount >= 12 ||
        (continuation.automaticRecoveryCount ?? 0) + 1 >= 3);
    const state =
      reasonCode === "credential_required" || reasonCode === "billing_required"
        ? "action_required"
        : automatic && !groundedExhausted && !compatibilityExhausted
          ? "cooldown"
          : "generation_failed";
    const nextRecoveryAt =
      state === "cooldown"
        ? Date.now() +
          groundedRecoveryCooldownMs(
            stored?.version === 4 ? stored.recoveryCycle : 0,
          )
        : undefined;
    const failed = await stopGeneration(status.quizId, claimKey, {
      state,
      reasonCode,
      ...(nextRecoveryAt
        ? { nextRecoveryAt: new Date(nextRecoveryAt).toISOString() }
        : {}),
    }).catch(() => undefined);
    await updateGenerationRecord(
      generationId,
      stored?.version === 3 || stored?.version === 4
        ? {
            state,
            reasonCode,
            retryOrdinal: undefined,
            ordinalAttempt: undefined,
            retryKind: undefined,
            retryDelayMs: undefined,
            ...(nextRecoveryAt ? { nextRecoveryAt } : {}),
          }
        : { state: "retry_required" },
    ).catch(() => undefined);
    if (failed) {
      latest = failed.generation;
      publishAttemptGeneration(attemptId, status.quizId, latest);
    }
  } finally {
    stopLeaseHeartbeat();
    stopLocalHeartbeat();
  }
}

function progressPayload(
  state: "generating" | "retrying",
  detail: LocalGenerationProgress,
  recoverySessionId: string,
) {
  return {
    state,
    recoverySessionId,
    ...(state === "retrying"
      ? {
          retryOrdinal: detail.retryOrdinal,
          ordinalAttempt: detail.ordinalAttempt,
          retryKind: detail.retryKind,
          retryDelayMs: detail.retryDelayMs,
          reasonCode: detail.reasonCode,
          recoveryPhase: "preparing" as const,
        }
      : {}),
  };
}

function startRecoveryLeaseHeartbeat(input: {
  attemptId: string;
  claimKey: string;
  generationSessionId: string;
  recoverySessionId: string;
  signal: AbortSignal;
}): () => void {
  let active = true;
  const renew = () => {
    if (!active || input.signal.aborted) return;
    void apiRequest(
      `/api/attempts/${input.attemptId}/generation/heartbeat`,
      {
        method: "PUT",
        body: jsonBody({
          claimKey: input.claimKey,
          generationSessionId: input.generationSessionId,
          recoverySessionId: input.recoverySessionId,
        }),
        signal: input.signal,
      },
      GenerationClaimResponseSchema,
    ).catch(() => undefined);
  };
  const timer = setInterval(renew, RECOVERY_HEARTBEAT_MS);
  renew();
  return () => {
    active = false;
    clearInterval(timer);
  };
}

async function readStatus(attemptId: string, signal: AbortSignal) {
  return apiRequest(
    `/api/attempts/${attemptId}/generation`,
    { signal },
    AttemptGenerationResponseSchema,
  );
}

async function matchingGenerationRecord(
  attemptId: string,
  quizId: string,
): Promise<GenerationRecord | null> {
  const stored = await loadGenerationRecordForAttempt(attemptId);
  return stored?.quizId === quizId && stored.attemptId === attemptId
    ? stored
    : null;
}

async function acquireContinuationTranscript(
  ownerUserId: string,
  imported: NonNullable<Awaited<ReturnType<typeof loadImportedVideo>>>,
  signal: AbortSignal,
  preferredLanguage: string,
): Promise<{
  segments: TranscriptSegment[];
  completeness: TranscriptCompleteness;
  language: string;
  verifiedDurationSeconds: number;
  captionSourceCategory:
    "manual" | "automatic" | "local_transcription" | "unknown";
}> {
  const textTranscript = await acquireTextTranscript(
    imported,
    signal,
    () => undefined,
    preferredLanguage,
  );
  if (textTranscript) return textTranscript;
  if (Platform.OS !== "web") {
    throw new Error(
      "This native beta requires a public YouTube video with usable captions.",
    );
  }
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
    ownerUserId,
    videoId: imported.video.id,
    mediaUrl: media.mediaUrl,
    durationSeconds: imported.video.durationSeconds,
    language: imported.video.sourceLanguage,
    signal,
    onPhase: () => undefined,
    onProgress: () => undefined,
  });
  return {
    segments: result.segments,
    language: result.language,
    verifiedDurationSeconds: imported.video.durationSeconds,
    captionSourceCategory: "local_transcription",
    completeness: createTranscriptCompleteness(
      result.segments,
      imported.video.durationSeconds,
    ),
  };
}

function updateProgress(
  quizId: string,
  idempotencyKey: string,
  progress: {
    state:
      | "generating"
      | "retrying"
      | "recovering"
      | "cooldown"
      | "action_required"
      | "generation_failed";
    reasonCode?: GenerationFailureCode;
    retryOrdinal?: number;
    ordinalAttempt?: number;
    retryKind?: AutomaticRetryKind;
    retryDelayMs?: number;
    recoverySessionId?: string;
    nextRecoveryAt?: string;
    recoveryPhase?:
      | "preparing"
      | "dispatched"
      | "streaming"
      | "repairing"
      | "cooldown"
      | "complete"
      | "failed";
    activeCallIndex?: number;
  },
  signal?: AbortSignal,
) {
  return apiRequest(
    `/api/quiz-imports/${quizId}/progress`,
    {
      method: "PATCH",
      headers: { "Idempotency-Key": idempotencyKey },
      body: jsonBody(progress),
      signal,
    },
    ExtensionQuizProgressiveImportResponseSchema,
  );
}

function stopGeneration(
  quizId: string,
  idempotencyKey: string | undefined,
  progress: {
    state: "action_required" | "generation_failed" | "cooldown";
    reasonCode: GenerationFailureCode;
    nextRecoveryAt?: string;
  },
) {
  if (!idempotencyKey) throw new Error("The generation key is unavailable.");
  return updateProgress(quizId, idempotencyKey, progress);
}

function isLeaseConflict(error: unknown): boolean {
  return (
    error instanceof ClientApiError &&
    [
      "generation_claim_leased",
      "generation_claim_conflict",
      "generation_recovery_lease_conflict",
      "generation_recovery_lease_lost",
    ].includes(error.code)
  );
}
