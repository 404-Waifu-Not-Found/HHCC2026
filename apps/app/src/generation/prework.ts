import {
  type AppLanguage,
  type QuizQuestionType,
  type VideoImportResponse,
} from "@clipquest/contracts";
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
      video: {
        ...imported.video,
        durationSeconds: transcript.verifiedDurationSeconds,
        sourceLanguage: imported.video.sourceLanguage ?? transcript.language,
      },
      captions: {
        ...imported.captions,
        available: true,
        preferredSegments: transcript.segments,
        preferredCompleteness: transcript.completeness,
      },
      transcriptionMode: "captions",
      capture: {
        ...imported.capture,
        expectedDurationSeconds: transcript.verifiedDurationSeconds,
      },
      requiresLocalTranscription: false,
    });
    await updateMatchingState(imported.video.id, input.idempotencyKey, {
      preworkStatus: "ready",
    });
    console.info(
      JSON.stringify({
        scope: "generation_prework",
        event: "captions_cached_locally",
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
  update: { preworkStatus: "ready" | "unavailable" | "failed" },
) {
  const current = await loadGenerationState(videoId);
  if (!current || current.idempotencyKey !== idempotencyKey) return;
  await saveGenerationState(videoId, { ...current, ...update });
}
