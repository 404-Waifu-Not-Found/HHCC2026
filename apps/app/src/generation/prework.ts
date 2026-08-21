import {
  type AppLanguage,
  type QuizQuestionType,
  type VideoImportResponse,
} from "@clipquest/contracts";
import {
  clearImportedVideo,
  loadGenerationRecord,
  saveImportedVideo,
  updateGenerationRecord,
} from "../state/creation";
import { acquireTextTranscript } from "../transcription/acquire-text-transcript";
import { normalizeTranscriptLanguage } from "../transcription/youtube-captions";

const activePrework = new Map<
  string,
  { ownerUserId: string; controller: AbortController }
>();

export function cancelPreGenerationForAccount(ownerUserId: string): void {
  for (const [generationId, task] of activePrework) {
    if (task.ownerUserId !== ownerUserId) continue;
    task.controller.abort();
    activePrework.delete(generationId);
  }
}

export async function preGenerateImportedQuiz(
  imported: VideoImportResponse,
  input: {
    ownerUserId: string;
    generationId: string;
    quizLanguage: AppLanguage;
    questionTypes: QuizQuestionType[];
  },
): Promise<void> {
  const startedAt = Date.now();
  activePrework.get(input.generationId)?.controller.abort();
  const controller = new AbortController();
  activePrework.set(input.generationId, {
    ownerUserId: input.ownerUserId,
    controller,
  });
  try {
    const initial = await loadGenerationRecord(input.generationId);
    if (!initial || initial.ownerUserId !== input.ownerUserId) return;
    const transcript = await acquireTextTranscript(
      imported,
      controller.signal,
      undefined,
      input.quizLanguage,
    );
    if (!transcript) {
      await updateMatchingState(input.generationId, input.ownerUserId, {
        preworkStatus: "unavailable",
      });
      return;
    }
    const current = await loadGenerationRecord(input.generationId);
    if (
      controller.signal.aborted ||
      !current ||
      current.ownerUserId !== input.ownerUserId
    ) {
      return;
    }
    await saveImportedVideo(input.ownerUserId, {
      ...imported,
      video: {
        ...imported.video,
        durationSeconds: transcript.verifiedDurationSeconds,
        sourceLanguage: normalizeTranscriptLanguage(transcript.language),
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
    const activeTask = activePrework.get(input.generationId);
    if (
      controller.signal.aborted ||
      activeTask?.controller !== controller ||
      activeTask.ownerUserId !== input.ownerUserId
    ) {
      if (!activeTask) {
        await clearImportedVideo(input.ownerUserId, imported.video.id);
      }
      return;
    }
    const stored = await updateMatchingState(
      input.generationId,
      input.ownerUserId,
      {
        preworkStatus: "ready",
      },
    );
    if (!stored) {
      await clearImportedVideo(input.ownerUserId, imported.video.id);
      return;
    }
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
    if (controller.signal.aborted) return;
    await updateMatchingState(input.generationId, input.ownerUserId, {
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
  } finally {
    if (activePrework.get(input.generationId)?.controller === controller) {
      activePrework.delete(input.generationId);
    }
  }
}

async function updateMatchingState(
  generationId: string,
  ownerUserId: string,
  update: { preworkStatus: "ready" | "unavailable" | "failed" },
): Promise<boolean> {
  const current = await loadGenerationRecord(generationId);
  if (!current || current.ownerUserId !== ownerUserId) return false;
  return Boolean(await updateGenerationRecord(generationId, update));
}
