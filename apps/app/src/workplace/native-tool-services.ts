// Concrete, native (iOS/Android) implementation of `WorkplaceToolServices`.
//
// Every method here is authenticated, owner-scoped app plumbing: it reuses the
// existing library API, the account-scoped imported-video cache, the shared
// caption-acquisition pipeline, the structured cheat-sheet API, and the
// proven local quiz generation path. Nothing here invents data -- an owned
// source that cannot be resolved (not in the library, no captions, no ready
// notes) resolves to `null` rather than a fabricated fallback, and a practice
// request that cannot be grounded throws a clear error instead of silently
// degrading.
//
// The learner's DeepSeek key is only ever held in the closure created by
// `createNativeWorkplaceToolServices` for the single `generatePracticeSet`
// call that needs it (to run the local quiz engine); it never appears in a
// tool argument, tool result, citation, or log line.

import {
  CheatSheetResponseSchema,
  LibraryResponseSchema,
  LocalQuizContextSchema,
  VideoImportResponseSchema,
  DEFAULT_QUIZ_QUESTION_TYPES,
  LOCAL_QUIZ_PROTOCOL_VERSION,
  type LibraryCard,
  type LocalQuizContext,
  type TranscriptSegment,
  type VideoImportResponse,
} from "@clipquest/contracts";
import {
  generateLocalQuiz,
  sanitizeWorkplaceSourceText,
  WORKPLACE_CHAT_LIMITS,
  type WorkplacePracticeArtifact,
  type WorkplaceSourceExcerpt,
} from "@clipquest/local-quiz-engine";
import { apiRequest, ClientApiError } from "../lib/api";
import { createLocalCrypto } from "../generation/local-crypto";
import { loadImportedVideo, saveImportedVideo } from "../state/creation";
import {
  acquireTextTranscript,
  CAPTIONS_REQUIRED_MESSAGE,
} from "../transcription/acquire-text-transcript";
import type {
  WorkplaceCaptionSource,
  WorkplaceLibraryVideo,
  WorkplaceNotesSource,
  WorkplaceToolServices,
} from "./tool-executors";

export type NativeWorkplaceToolServicesConfig = {
  /** The signed-in learner this session's sources are scoped to. */
  userId: string;
  /**
   * The learner's account-scoped DeepSeek key, read once by the platform
   * adapter before the turn starts. Held only in this closure.
   */
  apiKey: string;
};

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1)
    .slice(0, 12);
}

function libraryCardToWorkplaceVideo(card: LibraryCard): WorkplaceLibraryVideo {
  return {
    videoId: card.videoId,
    title: card.title,
    source: card.source,
    mastery: card.mastery,
    dueForReview: card.dueForReview,
    bestScore: card.bestScore,
    quizId: card.quizId,
  };
}

// The learner's owned library, deduplicated across the due/saved/suggestion
// groupings the `/api/library` route returns. Ownership itself is enforced
// server-side (the route is scoped to the signed-in user); this only shapes
// the response for the tool.
async function fetchOwnedLibraryCards(
  signal?: AbortSignal,
): Promise<LibraryCard[]> {
  const response = await apiRequest(
    "/api/library",
    { signal },
    LibraryResponseSchema,
  );
  const seen = new Set<string>();
  const cards: LibraryCard[] = [];
  for (const group of [
    response.dueReviews,
    response.saved,
    response.youtubeSuggestions,
  ]) {
    for (const card of group) {
      if (seen.has(card.videoId)) continue;
      seen.add(card.videoId);
      cards.push(card);
    }
  }
  return cards;
}

async function searchOwnedLibrary(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<WorkplaceLibraryVideo[]> {
  const cards = await fetchOwnedLibraryCards(signal);
  const terms = queryTerms(query);
  const ranked =
    terms.length === 0
      ? cards
      : cards
          .map((card) => ({
            card,
            score: terms.reduce(
              (total, term) =>
                card.title.toLowerCase().includes(term) ? total + 1 : total,
              0,
            ),
          }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.card);
  return ranked.slice(0, limit).map(libraryCardToWorkplaceVideo);
}

// Resolve one owned video's import metadata, preferring the existing
// account-scoped cache (shared with generation/recovery) over a network call.
// Returns null -- never a fabricated video -- when the learner does not own
// this videoId.
async function resolveOwnedImportedVideo(
  userId: string,
  videoId: string,
  signal?: AbortSignal,
): Promise<VideoImportResponse | null> {
  const cached = await loadImportedVideo(userId, videoId);
  if (cached) return cached;
  try {
    const imported = await apiRequest(
      `/api/videos/${encodeURIComponent(videoId)}/recovery`,
      { signal },
      VideoImportResponseSchema,
    );
    await saveImportedVideo(userId, imported);
    return imported;
  } catch (error) {
    if (error instanceof ClientApiError && error.code === "video_not_found") {
      return null;
    }
    throw error;
  }
}

async function loadOwnedCaptions(
  userId: string,
  videoId: string,
  signal?: AbortSignal,
): Promise<WorkplaceCaptionSource | null> {
  const imported = await resolveOwnedImportedVideo(userId, videoId, signal);
  if (!imported) return null;
  const transcript = await acquireTextTranscript(
    imported,
    signal ?? new AbortController().signal,
    undefined,
    imported.video.sourceLanguage,
  );
  if (!transcript) return null;
  return {
    title: imported.video.title,
    segments: transcript.segments,
    // acquireTextTranscript only ever resolves a transcript whose
    // completeness status is "complete" (see TranscriptCompletenessSchema);
    // an incomplete/unverifiable source resolves to null above instead.
    transcriptComplete: true,
  };
}

async function loadOwnedNotes(
  videoId: string,
  signal?: AbortSignal,
): Promise<WorkplaceNotesSource | null> {
  const cards = await fetchOwnedLibraryCards(signal);
  const card = cards.find((entry) => entry.videoId === videoId);
  if (!card || card.cheatSheet.status !== "ready" || !card.cheatSheet.sheetId) {
    return null;
  }
  try {
    // Structured retrieval only -- the PDF export endpoint
    // (`/api/cheat-sheets/:id/file`) is never used here.
    const sheet = await apiRequest(
      `/api/cheat-sheets/${encodeURIComponent(card.cheatSheet.sheetId)}`,
      { signal },
      CheatSheetResponseSchema,
    );
    if (!sheet.document) return null;
    return { title: card.title, document: sheet.document };
  } catch (error) {
    if (
      error instanceof ClientApiError &&
      error.code === "cheat_sheet_not_found"
    ) {
      return null;
    }
    throw error;
  }
}

// Bounded, generic grounding excerpts for a practice set. Practice questions
// in this pipeline are not individually tagged with evidence segments, so a
// handful of representative (topic-biased when possible) excerpts are used as
// the required citations instead of the full transcript.
function selectPracticeCitations(
  segments: TranscriptSegment[],
  videoId: string,
  title: string,
  topic: string | undefined,
): WorkplaceSourceExcerpt[] {
  const terms = topic ? queryTerms(topic) : [];
  const scored = segments.map((segment, index) => {
    const text = segment.text.toLowerCase();
    const score = terms.reduce(
      (total, term) => (text.includes(term) ? total + 1 : total),
      0,
    );
    return { segment, index, score };
  });
  const matched = terms.length ? scored.filter((entry) => entry.score > 0) : [];
  const pool = matched.length ? matched : scored;
  const chosen = [...pool]
    .sort((a, b) => b.score - a.score)
    .slice(0, WORKPLACE_CHAT_LIMITS.maxCitationsPerToolResult)
    .sort((a, b) => a.index - b.index);
  return chosen.map((entry) => ({
    videoId,
    title: title.slice(0, 300) || "Untitled video",
    startMs: entry.segment.startMs,
    endMs:
      entry.segment.endMs > entry.segment.startMs
        ? entry.segment.endMs
        : entry.segment.startMs + 1,
    quote: sanitizeWorkplaceSourceText(
      entry.segment.text,
      WORKPLACE_CHAT_LIMITS.maxCitationQuoteLength,
    ),
  }));
}

async function generateOwnedPracticeSet(
  config: NativeWorkplaceToolServicesConfig,
  input: { videoIds: string[]; topic?: string; signal?: AbortSignal },
): Promise<WorkplacePracticeArtifact> {
  if (input.videoIds.length === 0) {
    throw new Error(
      "Select at least one owned video before generating practice questions.",
    );
  }
  let imported: VideoImportResponse | null = null;
  let videoId = "";
  for (const candidate of input.videoIds) {
    const resolved = await resolveOwnedImportedVideo(
      config.userId,
      candidate,
      input.signal,
    );
    if (resolved) {
      imported = resolved;
      videoId = candidate;
      break;
    }
  }
  if (!imported) {
    throw new Error("None of the requested videos are in your library.");
  }
  const transcript = await acquireTextTranscript(
    imported,
    input.signal ?? new AbortController().signal,
    undefined,
    imported.video.sourceLanguage,
  );
  if (!transcript) {
    throw new Error(CAPTIONS_REQUIRED_MESSAGE);
  }
  const localCrypto = createLocalCrypto([
    config.userId,
    "workplace-practice-set",
    videoId,
    transcript.completeness.textFingerprint,
  ]);
  const context: LocalQuizContext = LocalQuizContextSchema.parse({
    protocolVersion: LOCAL_QUIZ_PROTOCOL_VERSION,
    jobId: localCrypto.randomUUID(),
    videoId,
    title: imported.video.title,
    quizLanguage: "en",
    questionTypes: DEFAULT_QUIZ_QUESTION_TYPES,
    // Workplace practice sets are always exactly five questions
    // (WORKPLACE_CHAT_LIMITS.practiceQuestionCount); no continuation round.
    questionCount: 5,
    transcriptFingerprint: transcript.completeness.textFingerprint,
    transcriptLanguage: transcript.language,
    segments: transcript.segments,
  });
  const result = await generateLocalQuiz(
    context,
    config.apiKey,
    () => {},
    input.signal,
    undefined,
    undefined,
    {
      fetch: globalThis.fetch.bind(globalThis),
      crypto: localCrypto,
      disableStreaming: true,
    },
  );
  if (!("quiz" in result)) {
    throw new Error(
      "Practice generation did not return a complete question set.",
    );
  }
  const citations = selectPracticeCitations(
    transcript.segments,
    videoId,
    imported.video.title,
    input.topic,
  );
  return {
    questions: result.quiz.questions,
    videoIds: [videoId],
    transcriptComplete: true,
    citations,
  };
}

/**
 * Build the concrete `WorkplaceToolServices` the native (iOS/Android)
 * adapters compose with `createWorkplaceToolExecutors` before running a
 * Workplace turn. See the module doc comment for the ownership and
 * key-handling invariants this enforces.
 */
export function createNativeWorkplaceToolServices(
  config: NativeWorkplaceToolServicesConfig,
): WorkplaceToolServices {
  if (!config.userId.trim()) {
    throw new Error("A signed-in account is required.");
  }
  return {
    searchLibrary: (query, limit, signal) =>
      searchOwnedLibrary(query, limit, signal),
    loadCaptions: (videoId, signal) =>
      loadOwnedCaptions(config.userId, videoId, signal),
    loadNotes: (videoId, signal) => loadOwnedNotes(videoId, signal),
    generatePracticeSet: (input) => generateOwnedPracticeSet(config, input),
  };
}
