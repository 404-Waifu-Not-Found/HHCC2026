import {
  TranscriptUploadResponseSchema,
  type AppLanguage,
  type QuizQuestionType,
  type VideoImportResponse,
} from "@clipquest/contracts";
import { apiRequest, jsonBody } from "../lib/api";
import {
  loadGenerationState,
  saveGenerationState,
  saveImportedVideo,
} from "../state/creation";
import { acquireTextTranscript } from "../transcription/acquire-text-transcript";

export async function preGenerateImportedQuiz(
  imported: VideoImportResponse,
  input: {
    idempotencyKey: string;
    quizLanguage: AppLanguage;
    questionTypes: QuizQuestionType[];
  },
): Promise<void> {
  const startedAt = Date.now();
  const controller = new AbortController();
  try {
    const transcript = await acquireTextTranscript(imported, controller.signal);
    if (!transcript) {
      await updateMatchingState(imported.video.id, input.idempotencyKey, {
        preworkStatus: "unavailable",
      });
      return;
    }
    await saveImportedVideo({
      ...imported,
      captions: {
        ...imported.captions,
        available: true,
        preferredSegments: transcript.segments,
        preferredCompleteness: transcript.completeness,
      },
      transcriptionMode: "captions",
      requiresLocalTranscription: false,
    });
    const queued = await apiRequest(
      "/api/transcripts",
      {
        method: "POST",
        headers: { "Idempotency-Key": input.idempotencyKey },
        body: jsonBody({
          videoId: imported.video.id,
          language: transcript.language,
          origin: "captions",
          acquisition: transcript.acquisition,
          completeness: transcript.completeness,
          segments: transcript.segments,
          quizLanguage: input.quizLanguage,
          sessionLength: "long",
          watched: true,
          questionTypes: input.questionTypes,
        }),
      },
      TranscriptUploadResponseSchema,
    );
    await updateMatchingState(imported.video.id, input.idempotencyKey, {
      jobId: queued.jobId,
      preworkStatus: "ready",
    });
    console.info(
      JSON.stringify({
        scope: "generation_prework",
        event: "quiz_queued",
        videoId: imported.video.id,
        questionTypes: input.questionTypes,
        sourceSegmentCount: transcript.completeness.sourceSegmentCount,
        segmentCount: transcript.segments.length,
        characterCount: transcript.completeness.characterCount,
        transcriptComplete: true,
        elapsedMs: Date.now() - startedAt,
      }),
    );
  } catch (error) {
    await updateMatchingState(imported.video.id, input.idempotencyKey, {
      preworkStatus: "failed",
    });
    console.warn(
      JSON.stringify({
        scope: "generation_prework",
        event: "failed",
        videoId: imported.video.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
        elapsedMs: Date.now() - startedAt,
      }),
    );
  }
}

async function updateMatchingState(
  videoId: string,
  idempotencyKey: string,
  update: { jobId?: string; preworkStatus: "ready" | "unavailable" | "failed" },
) {
  const current = await loadGenerationState(videoId);
  if (!current || current.idempotencyKey !== idempotencyKey) return;
  await saveGenerationState(videoId, { ...current, ...update });
}
