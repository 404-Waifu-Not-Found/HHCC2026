import {
  AttemptGenerationResponseSchema,
  ExtensionQuizGenerationCallEventResponseSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  GenerationClaimResponseSchema,
  MediaResolveResponseSchema,
  createTranscriptCompleteness,
  type GenerationRecordV2,
  type LocalGenerationCallEvent,
  type LocalQuizContext,
  type TranscriptCompleteness,
  type TranscriptSegment,
} from "@clipquest/contracts";
import * as Crypto from "expo-crypto";
import { apiRequest, jsonBody } from "../lib/api";
import {
  authClient,
  type AppSession as AuthAppSession,
} from "../lib/auth-client";
import {
  clearGenerationRecord,
  generationRecordHasLiveHeartbeat,
  loadGenerationRecord,
  loadGenerationRecordForAttempt,
  loadImportedVideo,
  migrateLegacyGenerationRecord,
  saveGenerationRecord,
  startGenerationRecordHeartbeat,
  updateGenerationRecord,
} from "../state/creation";
import { acquireTextTranscript } from "../transcription/acquire-text-transcript";
import {
  LocalGenerationRequestError,
  requestExtensionLocalQuiz,
} from "../transcription/clipquest-extension";
import { transcribeLocally } from "../transcription/local-transcriber";
import {
  getOrStartProgressiveContinuationTask,
  publishAttemptGeneration,
} from "./progressive-coordinator";

export function continueProgressiveAttempt(attemptId: string): Promise<void> {
  return getOrStartProgressiveContinuationTask(attemptId, (signal) =>
    runContinuation(attemptId, signal),
  ).completion;
}

export async function markProgressiveAttemptRequiresReclaim(
  attemptId: string,
): Promise<boolean> {
  const status = await apiRequest(
    `/api/attempts/${attemptId}/generation`,
    {},
    AttemptGenerationResponseSchema,
  );
  if (
    status.generation.state === "ready" ||
    status.generation.state === "retry_required"
  ) {
    return true;
  }
  let stored = await matchingGenerationRecord(attemptId, status.quizId);
  if (!stored && status.continuation) {
    const sessionResult = await authClient.getSession();
    const session = sessionResult.data as AuthAppSession | null;
    if (session?.user.id) {
      stored = await migrateLegacyGenerationRecord({
        videoId: status.continuation.videoId,
        expectedQuizId: status.quizId,
        expectedAttemptId: attemptId,
        ownerUserId: session.user.id,
        generationId: status.continuation.generationId ?? Crypto.randomUUID(),
        generationSessionId: Crypto.randomUUID(),
        plannedCount: status.generation.totalQuestions,
        acceptedCount: status.generation.availableQuestions,
        sessionLength: status.continuation.sessionLength,
        quizLanguage: status.continuation.quizLanguage,
        questionTypes: status.continuation.questionTypes,
        watched: status.continuation.watched,
        generationProfile: status.continuation.generationProfile,
        questionPlan: status.continuation.questionPlan,
      });
    }
  }
  if (stored && generationRecordHasLiveHeartbeat(stored)) return false;
  if (!stored) {
    throw new Error(
      "ClipQuest lost this tab's local generation state. Reopen the source video before reclaiming this attempt.",
    );
  }
  const failed = await updateProgress(status.quizId, stored.idempotencyKey, {
    state: "retry_required",
    reasonCode: "local_state_conflict",
  });
  await updateGenerationRecord(stored.generationId, {
    state: "retry_required",
  });
  publishAttemptGeneration(attemptId, status.quizId, failed.generation);
  return true;
}

async function runContinuation(
  attemptId: string,
  signal: AbortSignal,
): Promise<void> {
  const status = await apiRequest(
    `/api/attempts/${attemptId}/generation`,
    { signal },
    AttemptGenerationResponseSchema,
  );
  if (status.generation.state === "ready") return;
  if (status.generation.state !== "retry_required" || !status.continuation) {
    throw new Error(
      "Generation is still active in another tab. Wait for it to finish or pause before reclaiming it.",
    );
  }

  const sessionResult = await authClient.getSession();
  const session = sessionResult.data as AuthAppSession | null;
  if (!session?.user.id) {
    throw new Error("Sign in again before continuing this quiz.");
  }

  const imported = await loadImportedVideo(status.continuation.videoId);
  if (!imported) {
    throw new Error(
      "The local transcript cache expired. Reopen the source video to continue generating.",
    );
  }
  const transcript = await acquireContinuationTranscript(imported, signal);

  const claimKey = Crypto.randomUUID();
  const generationSessionId = Crypto.randomUUID();
  const claim = await apiRequest(
    `/api/attempts/${attemptId}/generation/claim`,
    {
      method: "POST",
      body: jsonBody({ claimKey, generationSessionId }),
      signal,
    },
    GenerationClaimResponseSchema,
  );

  let stored = await matchingGenerationRecord(attemptId, status.quizId);
  if (!stored && status.continuation.generationId) {
    const byGenerationId = await loadGenerationRecord(
      status.continuation.generationId,
    );
    if (
      byGenerationId?.ownerUserId === session.user.id &&
      byGenerationId.quizId === status.quizId
    ) {
      stored = byGenerationId;
    }
  }
  if (!stored) {
    stored = await migrateLegacyGenerationRecord({
      videoId: status.continuation.videoId,
      expectedQuizId: status.quizId,
      expectedAttemptId: attemptId,
      ownerUserId: session.user.id,
      generationId: status.continuation.generationId ?? Crypto.randomUUID(),
      generationSessionId,
      plannedCount: status.generation.totalQuestions,
      acceptedCount: status.generation.availableQuestions,
      sessionLength: status.continuation.sessionLength,
      quizLanguage: status.continuation.quizLanguage,
      questionTypes: status.continuation.questionTypes,
      watched: status.continuation.watched,
      generationProfile: status.continuation.generationProfile,
      questionPlan: status.continuation.questionPlan,
    });
  }
  if (!stored) {
    const timestamp = Date.now();
    stored = await saveGenerationRecord({
      version: 2,
      generationId: status.continuation.generationId ?? Crypto.randomUUID(),
      generationSessionId,
      idempotencyKey: claimKey,
      ownerUserId: session.user.id,
      videoId: status.continuation.videoId,
      quizLanguage: status.continuation.quizLanguage,
      questionTypes: status.continuation.questionTypes,
      sessionLength: status.continuation.sessionLength,
      watched: status.continuation.watched,
      generationProfile: status.continuation.generationProfile,
      questionPlan: status.continuation.questionPlan,
      quizId: status.quizId,
      attemptId,
      acceptedCount: status.generation.availableQuestions,
      plannedCount: status.generation.totalQuestions,
      state: "retrying",
      nextCallIndex: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } else {
    stored =
      (await updateGenerationRecord(stored.generationId, {
        generationSessionId,
        idempotencyKey: claimKey,
        quizId: status.quizId,
        attemptId,
        acceptedCount: status.generation.availableQuestions,
        plannedCount: status.generation.totalQuestions,
        state: "retrying",
        nextCallIndex: 0,
        questionPlan: status.continuation.questionPlan,
        generationProfile: status.continuation.generationProfile,
      })) ?? stored;
  }

  const retrying = await updateProgress(
    status.quizId,
    claimKey,
    { state: "retrying" },
    signal,
  );
  publishAttemptGeneration(attemptId, status.quizId, retrying.generation);

  const context: LocalQuizContext = {
    protocolVersion: 1,
    jobId: claimKey,
    generationId: stored.generationId,
    generationSessionId,
    generationProfile: status.continuation.generationProfile,
    videoId: imported.video.id,
    title: imported.video.title,
    quizLanguage: status.continuation.quizLanguage,
    questionTypes: status.continuation.questionTypes,
    questionCount: status.generation.totalQuestions,
    transcriptFingerprint: transcript.completeness.textFingerprint,
    transcriptLanguage: transcript.language,
    segments: transcript.segments,
    continuation: {
      startIndex: status.continuation.startIndex,
      resultProtocolVersion: status.continuation.resultProtocolVersion,
      promptVersion: status.continuation.promptVersion,
      validatorVersion: status.continuation.validatorVersion,
      generationProfile: status.continuation.generationProfile,
      questionPlan: status.continuation.questionPlan,
      claim: claim.claim,
      acceptedQuestions: status.continuation.acceptedQuestions,
    },
  };

  let latest = retrying;
  let ingestion = Promise.resolve();
  const generationId = stored.generationId;
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
      const current = await loadGenerationRecord(generationId);
      if (current) {
        await updateGenerationRecord(generationId, {
          nextCallIndex: Math.max(current.nextCallIndex, event.callIndex + 1),
        });
      }
    });
    void ingestion.catch(() => undefined);
  };
  const stopHeartbeat = startGenerationRecordHeartbeat(generationId);

  try {
    await requestExtensionLocalQuiz(
      context,
      signal,
      () => undefined,
      (chunk) => {
        ingestion = ingestion.then(async () => {
          latest = await apiRequest(
            `/api/quiz-imports/${status.quizId}/questions`,
            {
              method: "PUT",
              headers: { "Idempotency-Key": claimKey },
              body: jsonBody({ chunk }),
              signal,
            },
            ExtensionQuizProgressiveImportResponseSchema,
          );
          publishAttemptGeneration(attemptId, status.quizId, latest.generation);
          await updateGenerationRecord(generationId, {
            quizId: status.quizId,
            attemptId,
            acceptedCount: latest.generation.availableQuestions,
            plannedCount: latest.generation.totalQuestions,
            state: latest.generation.state,
          });
        });
        void ingestion.catch(() => undefined);
      },
      enqueueCall,
    );
    await ingestion;
    if (latest.generation.state !== "ready") {
      throw new Error("Continuation ended before every question was stored.");
    }
    await clearGenerationRecord(generationId);
  } catch (error) {
    await ingestion.catch(() => undefined);
    const reasonCode =
      error instanceof LocalGenerationRequestError
        ? error.reasonCode
        : "local_state_conflict";
    const failed = await updateProgress(status.quizId, claimKey, {
      state: "retry_required",
      reasonCode,
    }).catch(() => undefined);
    await updateGenerationRecord(generationId, {
      state: "retry_required",
    }).catch(() => undefined);
    if (failed) {
      publishAttemptGeneration(attemptId, status.quizId, failed.generation);
    }
    throw error;
  } finally {
    stopHeartbeat();
  }
}

async function matchingGenerationRecord(
  attemptId: string,
  quizId: string,
): Promise<GenerationRecordV2 | null> {
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
    state: "retrying" | "retry_required";
    reasonCode?: string;
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
