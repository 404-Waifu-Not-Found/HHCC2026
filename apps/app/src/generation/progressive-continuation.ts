import {
  AttemptGenerationResponseSchema,
  ExtensionQuizGenerationCallEventResponseSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  GenerationClaimResponseSchema,
  MediaResolveResponseSchema,
  createTranscriptCompleteness,
  type AutomaticRetryKind,
  type GenerationFailureCode,
  type GenerationRecord,
  type LocalGenerationCallEvent,
  type LocalQuizContext,
  type TranscriptCompleteness,
  type TranscriptSegment,
} from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { apiRequest, ClientApiError, jsonBody } from "../lib/api";
import {
  authClient,
  type AppSession as AuthAppSession,
} from "../lib/auth-client";
import {
  loadGenerationRecord,
  loadGenerationRecordForAttempt,
  loadImportedVideo,
  clearGenerationRecord,
  saveGenerationRecord,
  startGenerationRecordHeartbeat,
  updateGenerationRecord,
} from "../state/creation";
import { acquireTextTranscript } from "../transcription/acquire-text-transcript";
import {
  LocalGenerationRequestError,
  requestExtensionLocalQuiz,
  type LocalGenerationProgress,
} from "../transcription/clipquest-extension";
import { transcribeLocally } from "../transcription/local-transcriber";
import {
  getOrStartProgressiveRecoveryTask,
  publishAttemptGeneration,
} from "./progressive-coordinator";

const RECOVERY_HEARTBEAT_MS = 10_000;

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
  if (
    status.generation.state === "ready" ||
    status.generation.state === "generation_failed" ||
    !status.continuation
  ) {
    return;
  }
  const continuation = status.continuation;
  const automatic =
    continuation.generationProfile === "stable_auto_recovery_v5_3";
  if (status.generation.state === "action_required" && !automatic) return;
  if (status.generation.state === "retry_required" && automatic) {
    throw new Error("Automatic banks cannot enter manual continuation state.");
  }

  const sessionResult = await authClient.getSession();
  const session = sessionResult.data as AuthAppSession | null;
  if (!session?.user.id) return;
  const claimKey = Crypto.randomUUID();
  const generationSessionId = automatic
    ? continuation.generationSessionId
    : Crypto.randomUUID();
  if (!generationSessionId) {
    throw new Error("The generation session metadata is missing.");
  }
  const recoverySessionId = automatic ? Crypto.randomUUID() : undefined;

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

  const imported = await loadImportedVideo(continuation.videoId);
  if (!imported) {
    const failed = await stopGeneration(status.quizId, claimKey, {
      state: "generation_failed",
      reasonCode: "source_unavailable",
    }).catch(() => undefined);
    if (failed) {
      publishAttemptGeneration(attemptId, status.quizId, failed.generation);
    }
    return;
  }

  const generationId = continuation.generationId ?? Crypto.randomUUID();
  let stored = await matchingGenerationRecord(attemptId, status.quizId);
  if (!stored && continuation.generationId) {
    const candidate = await loadGenerationRecord(continuation.generationId);
    if (
      candidate?.ownerUserId === session.user.id &&
      candidate.quizId === status.quizId
    ) {
      stored = candidate;
    }
  }
  if (automatic && (!continuation.questionPlan || !recoverySessionId)) {
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
    transcript = await acquireContinuationTranscript(imported, signal);
  } catch (error) {
    stopLeaseHeartbeat();
    throw error;
  }

  const timestamp = Date.now();
  try {
    if (automatic) {
      if (!continuation.questionPlan || !recoverySessionId) {
        throw new Error("The automatic question plan is missing.");
      }
      stored = await saveGenerationRecord({
        version: 3,
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
        generationProfile: "stable_auto_recovery_v5_3",
        quizId: status.quizId,
        attemptId,
        acceptedCount: status.generation.availableQuestions,
        plannedCount: status.generation.totalQuestions,
        state: "recovering",
        nextCallIndex: continuation.nextCallIndex ?? 0,
        ordinalAttempts: {
          [String(status.generation.availableQuestions + 1)]:
            continuation.nextOrdinalAttempt ?? 1,
        },
        automaticRetryCount: continuation.automaticRetryCount ?? 0,
        activeRecoveryStartedAt: timestamp,
        createdAt: stored?.createdAt ?? timestamp,
        updatedAt: timestamp,
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
        nextCallIndex: 0,
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
      generationProfile: continuation.generationProfile,
      questionPlan: continuation.questionPlan,
      claim: claim.claim,
      nextCallIndex: automatic ? continuation.nextCallIndex : 0,
      nextOrdinalAttempt: continuation.nextOrdinalAttempt,
      retryKind: continuation.retryKind,
      automaticRetryCount: continuation.automaticRetryCount,
      acceptedQuestions: continuation.acceptedQuestions,
    },
  };

  let latest = status.generation;
  let ingestion = Promise.resolve();
  let lastProgressState = "recovering";
  let automaticRetryCount =
    stored?.version === 3 ? stored.automaticRetryCount : 0;
  const stopLocalHeartbeat = startGenerationRecordHeartbeat(generationId);

  const enqueueCall = (event: LocalGenerationCallEvent) => {
    ingestion = ingestion.then(async () => {
      await apiRequest(
        `/api/quiz-imports/${status.quizId}/calls/${event.generationSessionId}/${event.callIndex}`,
        {
          method: "PUT",
          headers: { "Idempotency-Key": claimKey },
          body: jsonBody(event),
          signal,
        },
        ExtensionQuizGenerationCallEventResponseSchema,
      );
      if (event.classification === "automatic_retry") {
        automaticRetryCount = Math.min(12, automaticRetryCount + 1);
      }
      await updateGenerationRecord(generationId, {
        nextCallIndex: event.callIndex + 1,
        ...(event.classification === "automatic_retry"
          ? { automaticRetryCount }
          : {}),
      });
    });
    void ingestion.catch(() => undefined);
  };

  try {
    await requestExtensionLocalQuiz(
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
        ingestion = ingestion.then(async () => {
          const response = await updateProgress(
            status.quizId,
            claimKey,
            progressPayload(nextState, detail, recoverySessionId),
            signal,
          );
          latest = response.generation;
          publishAttemptGeneration(attemptId, status.quizId, latest);
          await updateGenerationRecord(generationId, {
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
          });
        });
        void ingestion.catch(() => undefined);
      },
      (chunk) => {
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
            automatic
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
      },
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
    const reasonCode =
      error instanceof LocalGenerationRequestError
        ? error.reasonCode
        : "local_state_conflict";
    const state =
      reasonCode === "credential_required" || reasonCode === "billing_required"
        ? "action_required"
        : "generation_failed";
    const failed = await stopGeneration(status.quizId, claimKey, {
      state,
      reasonCode,
    }).catch(() => undefined);
    await updateGenerationRecord(
      generationId,
      automatic
        ? {
            state,
            reasonCode,
            retryOrdinal: undefined,
            ordinalAttempt: undefined,
            retryKind: undefined,
            retryDelayMs: undefined,
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
  imported: NonNullable<Awaited<ReturnType<typeof loadImportedVideo>>>,
  signal: AbortSignal,
): Promise<{
  segments: TranscriptSegment[];
  completeness: TranscriptCompleteness;
  language: string;
}> {
  const textTranscript = await acquireTextTranscript(
    imported,
    signal,
    () => undefined,
  );
  if (textTranscript) return textTranscript;
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
    onPhase: () => undefined,
    onProgress: () => undefined,
  });
  return {
    segments: result.segments,
    language: result.language,
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
      | "action_required"
      | "generation_failed";
    reasonCode?: GenerationFailureCode;
    retryOrdinal?: number;
    ordinalAttempt?: number;
    retryKind?: AutomaticRetryKind;
    retryDelayMs?: number;
    recoverySessionId?: string;
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
    state: "action_required" | "generation_failed";
    reasonCode: GenerationFailureCode;
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
