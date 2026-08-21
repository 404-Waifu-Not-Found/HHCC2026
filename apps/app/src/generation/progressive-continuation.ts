import {
  AttemptGenerationResponseSchema,
  ExtensionQuizProgressiveImportResponseSchema,
  MediaResolveResponseSchema,
  createTranscriptCompleteness,
  type LocalQuizContext,
  type TranscriptCompleteness,
  type TranscriptSegment,
} from "@clipquest/contracts";
import { apiRequest, jsonBody } from "../lib/api";
import {
  clearImportedVideo,
  loadGenerationState,
  loadImportedVideo,
  saveGenerationState,
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
  if (!status.continuation) {
    throw new Error("This quiz is not ready for local continuation yet.");
  }
  const stored = await loadGenerationState(status.continuation.videoId);
  if (!stored?.idempotencyKey) {
    throw new Error(
      "The local video setup expired. Reopen the source video to continue generating.",
    );
  }
  if (stored.quizId && stored.quizId !== status.quizId) {
    throw new Error(
      "The saved local generation state belongs to another quiz.",
    );
  }

  const retrying = await updateProgress(
    status.quizId,
    stored.idempotencyKey,
    { state: "retrying" },
    signal,
  );
  publishAttemptGeneration(attemptId, status.quizId, retrying.generation);

  let ingestion = Promise.resolve();
  try {
    const imported = await loadImportedVideo(status.continuation.videoId);
    if (!imported) {
      throw new Error(
        "The local video setup expired. Reopen the source video to continue generating.",
      );
    }
    let segments: TranscriptSegment[] = [];
    let completeness: TranscriptCompleteness | null = null;
    let language = imported.video.sourceLanguage ?? "und";
    const textTranscript = await acquireTextTranscript(
      imported,
      signal,
      () => undefined,
    );
    if (textTranscript) {
      segments = textTranscript.segments;
      completeness = textTranscript.completeness;
      language = textTranscript.language;
    }
    if (!segments.length) {
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
      segments = result.segments;
      language = result.language;
      completeness = createTranscriptCompleteness(
        segments,
        imported.video.durationSeconds,
      );
    }
    if (!completeness) {
      throw new Error(
        "ClipQuest could not verify the complete local transcript.",
      );
    }

    const context: LocalQuizContext = {
      protocolVersion: 1,
      jobId: stored.idempotencyKey,
      videoId: imported.video.id,
      title: imported.video.title,
      quizLanguage: status.continuation.quizLanguage,
      questionTypes: status.continuation.questionTypes,
      questionCount: status.generation.totalQuestions,
      transcriptFingerprint: completeness.textFingerprint,
      transcriptLanguage: language,
      segments,
      continuation: {
        startIndex: status.continuation.startIndex,
        acceptedQuestions: status.continuation.acceptedQuestions,
      },
    };
    let latest = retrying;
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
              headers: { "Idempotency-Key": stored.idempotencyKey },
              body: jsonBody({ chunk }),
              signal,
            },
            ExtensionQuizProgressiveImportResponseSchema,
          );
          publishAttemptGeneration(attemptId, status.quizId, latest.generation);
          await saveGenerationState(imported.video.id, {
            ...stored,
            quizId: status.quizId,
            attemptId,
            acceptedCount: latest.generation.availableQuestions,
            plannedCount: latest.generation.totalQuestions,
          });
        });
        void ingestion.catch(() => undefined);
      },
    );
    await ingestion;
    if (latest.generation.state !== "ready") {
      throw new Error("Continuation ended before every question was stored.");
    }
    await clearImportedVideo(imported.video.id);
  } catch (error) {
    await ingestion.catch(() => undefined);
    const reasonCode =
      error instanceof LocalGenerationRequestError
        ? error.reasonCode
        : "automatic_retries_exhausted";
    const failed = await updateProgress(status.quizId, stored.idempotencyKey, {
      state: "retry_required",
      reasonCode,
    }).catch(() => undefined);
    if (failed) {
      publishAttemptGeneration(attemptId, status.quizId, failed.generation);
    }
    throw error;
  }
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
