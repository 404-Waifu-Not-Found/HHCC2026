// App-local Workplace tool execution.
//
// The shared orchestrator (`runWorkplaceChatTurn` in
// @clipquest/local-quiz-engine) is deliberately platform-free and calls into
// injected executors for every source read and practice generation. This module
// is the app-local wiring for those executors: it turns the learner's owned
// captions and notes into *bounded local excerpts*, searches authenticated
// library metadata for owned videos only, and delegates practice generation to
// the proven local quiz engine. It is intentionally non-visual (no React, no
// transport): a later adapter/UI layer supplies the concrete `services` that
// reach the network, extension, or native bridge.
//
// Privacy invariants enforced here:
//   * Raw caption arrays, full transcripts, and full note documents never leave
//     this module -- only short, sanitized excerpts and bounded metadata do.
//   * The learner's DeepSeek key is never handled here; it stays in the
//     orchestrator's Authorization header.

import type {
  CheatSheetDocument,
  MasteryState,
  TranscriptSegment,
  VideoSource,
} from "@clipquest/contracts";
import {
  WORKPLACE_CHAT_LIMITS,
  sanitizeWorkplaceSourceText,
  type WorkplaceChatTools,
  type WorkplacePracticeArtifact,
  type WorkplaceSearchResult,
  type WorkplaceSourceExcerpt,
  type WorkplaceSourceReadResult,
} from "@clipquest/local-quiz-engine";

/** Bounded, owned-video metadata a library search may expose to the model. */
export type WorkplaceLibraryVideo = {
  videoId: string;
  title: string;
  source: VideoSource;
  mastery: MasteryState;
  dueForReview: boolean;
  bestScore: number | null;
  quizId: string | null;
};

/** The caption material for one owned video, kept in memory only. */
export type WorkplaceCaptionSource = {
  title: string;
  segments: TranscriptSegment[];
  transcriptComplete: boolean;
};

/** The saved notes / cheat sheet for one owned video. */
export type WorkplaceNotesSource = {
  title: string;
  document: CheatSheetDocument;
};

/**
 * Concrete, authenticated app services the executors compose. A later
 * adapter/UI layer supplies these (e.g. wiring `loadCaptions` to
 * `acquireTextTranscript`, `loadNotes` to the cheat-sheet API, and
 * `generatePracticeSet` to the local generation client). Keeping them injected
 * makes this module unit-testable and free of platform imports.
 */
export type WorkplaceToolServices = {
  /** Authenticated library metadata search restricted to owned videos. */
  searchLibrary: (
    query: string,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<WorkplaceLibraryVideo[]>;
  /** Resolve captions for one owned video, or null when unavailable. */
  loadCaptions: (
    videoId: string,
    signal?: AbortSignal,
  ) => Promise<WorkplaceCaptionSource | null>;
  /** Resolve saved notes for one owned video, or null when unavailable. */
  loadNotes: (
    videoId: string,
    signal?: AbortSignal,
  ) => Promise<WorkplaceNotesSource | null>;
  /** Generate a validated practice artifact via the local quiz engine. */
  generatePracticeSet: (input: {
    videoIds: string[];
    topic?: string;
    signal?: AbortSignal;
  }) => Promise<WorkplacePracticeArtifact>;
};

const DEFAULT_MAX_EXCERPTS = 3;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function clampExcerptCount(value: unknown): number {
  const requested = typeof value === "number" ? Math.trunc(value) : NaN;
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_MAX_EXCERPTS;
  return Math.min(requested, WORKPLACE_CHAT_LIMITS.maxSourceExcerptsPerRead);
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2)
    .slice(0, 12);
}

// Select up to `maxExcerpts` bounded caption excerpts, preferring segments that
// match the query. Never returns the raw segment array.
function selectCaptionExcerpts(
  source: WorkplaceCaptionSource,
  videoId: string,
  query: string,
  maxExcerpts: number,
): WorkplaceSourceExcerpt[] {
  const terms = queryTerms(query);
  const ranked = source.segments
    .map((segment, index) => {
      const text = segment.text.toLowerCase();
      const score = terms.reduce(
        (total, term) => (text.includes(term) ? total + 1 : total),
        0,
      );
      return { segment, index, score };
    })
    .filter((entry) => (terms.length === 0 ? true : entry.score > 0));

  const chosen = (
    terms.length === 0 ? ranked : [...ranked].sort((a, b) => b.score - a.score)
  )
    .slice(0, maxExcerpts)
    // Restore chronological order for a readable, citable set.
    .sort((a, b) => a.index - b.index);

  return chosen.map((entry) => ({
    videoId,
    title: source.title.slice(0, 300) || "Untitled video",
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

// Build bounded note excerpts from a cheat-sheet document. Notes carry no video
// time range, so these are surfaced to the model as reference text only and are
// intentionally not turned into time-coded citations.
function selectNoteExcerpts(
  document: CheatSheetDocument,
  query: string,
  maxExcerpts: number,
): WorkplaceSourceExcerpt[] {
  const terms = queryTerms(query);
  const candidates: string[] = [
    document.summary,
    ...document.keyConcepts,
    ...document.definitions.map((item) => `${item.term}: ${item.definition}`),
    ...document.rememberThis,
  ].filter(
    (text): text is string => typeof text === "string" && text.length > 0,
  );

  const ranked =
    terms.length === 0
      ? candidates
      : candidates
          .map((text) => {
            const lowered = text.toLowerCase();
            const score = terms.reduce(
              (total, term) => (lowered.includes(term) ? total + 1 : total),
              0,
            );
            return { text, score };
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.text);

  return ranked.slice(0, maxExcerpts).map((text) => ({
    // startMs/endMs are placeholders; notes are not time-coded citations.
    videoId: "",
    title: document.title.slice(0, 300) || "Notes",
    startMs: 0,
    endMs: 1,
    quote: sanitizeWorkplaceSourceText(
      text,
      WORKPLACE_CHAT_LIMITS.maxCitationQuoteLength,
    ),
  }));
}

/**
 * Build the injected tool set the orchestrator calls during a Workplace turn.
 * Every executor keeps raw source material in memory and only emits bounded,
 * sanitized excerpts / metadata.
 */
export function createWorkplaceToolExecutors(
  services: WorkplaceToolServices,
): WorkplaceChatTools {
  return {
    async searchLibrary(args, ctx): Promise<WorkplaceSearchResult> {
      const query = asString(args.query);
      const limit =
        typeof args.limit === "number" && Number.isFinite(args.limit)
          ? Math.min(Math.max(Math.trunc(args.limit), 1), 20)
          : 10;
      const videos = await services.searchLibrary(query, limit, ctx.signal);
      const bounded = videos.slice(0, limit);
      const summary = bounded.length
        ? `Found ${bounded.length} owned video${
            bounded.length === 1 ? "" : "s"
          }: ${bounded
            .map((video) => sanitizeWorkplaceSourceText(video.title, 120))
            .join("; ")}`
        : `No owned videos matched "${sanitizeWorkplaceSourceText(query, 120)}".`;
      return {
        summary: summary.slice(
          0,
          WORKPLACE_CHAT_LIMITS.maxToolResultSummaryLength,
        ),
        results: bounded.map((video) => ({
          videoId: video.videoId,
          title: sanitizeWorkplaceSourceText(video.title, 200),
          mastery: video.mastery,
          dueForReview: video.dueForReview,
          bestScore: video.bestScore,
          hasQuiz: video.quizId !== null,
        })),
      };
    },

    async readVideoCaptions(args, ctx): Promise<WorkplaceSourceReadResult> {
      const videoId = asString(args.videoId);
      const query = asString(args.query);
      const maxExcerpts = clampExcerptCount(args.maxExcerpts);
      const source = videoId
        ? await services.loadCaptions(videoId, ctx.signal)
        : null;
      if (!source) {
        return {
          summary: "No captions are available for that video.",
          excerpts: [],
          transcriptComplete: false,
        };
      }
      const excerpts = selectCaptionExcerpts(
        source,
        videoId,
        query,
        maxExcerpts,
      );
      return {
        summary: `Read ${excerpts.length} caption excerpt${
          excerpts.length === 1 ? "" : "s"
        } from ${sanitizeWorkplaceSourceText(source.title, 120)}.`,
        excerpts,
        transcriptComplete: source.transcriptComplete,
      };
    },

    async readPdfNotes(args, ctx): Promise<WorkplaceSourceReadResult> {
      const videoId = asString(args.videoId);
      const query = asString(args.query);
      const maxExcerpts = clampExcerptCount(args.maxExcerpts);
      const source = videoId
        ? await services.loadNotes(videoId, ctx.signal)
        : null;
      if (!source) {
        return {
          summary: "No saved notes are available for that video.",
          excerpts: [],
          transcriptComplete: false,
        };
      }
      const excerpts = selectNoteExcerpts(source.document, query, maxExcerpts);
      return {
        summary: `Read ${excerpts.length} note excerpt${
          excerpts.length === 1 ? "" : "s"
        } from ${sanitizeWorkplaceSourceText(source.title, 120)}.`,
        excerpts,
        // Notes do not establish transcript completeness for diagnostics.
        transcriptComplete: false,
      };
    },

    async createPracticeSet(args, ctx): Promise<WorkplacePracticeArtifact> {
      const videoIds = Array.from(new Set(asStringArray(args.videoIds))).slice(
        0,
        WORKPLACE_CHAT_LIMITS.maxToolArgumentArrayItems,
      );
      const topic = asString(args.topic) || undefined;
      // The engine re-validates and applies the practice/diagnostic policy; we
      // just produce the grounded artifact via the proven local quiz engine.
      return services.generatePracticeSet({
        videoIds,
        topic,
        signal: ctx.signal,
      });
    },
  };
}
