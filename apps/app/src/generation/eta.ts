import type { QuizQuestionType, TranscriptSegment } from "@clipquest/contracts";

export type SupportedQuestionCount = 5 | 10 | 15;

export type CompleteBankEtaInput = {
  questionCount: SupportedQuestionCount;
  questionTypes: readonly QuizQuestionType[];
};

export type FirstQuestionEtaInput = {
  captionWordCount?: number;
  videoDurationSeconds?: number;
  focusWindowWordCount?: number;
  questionCount: SupportedQuestionCount;
  firstQuestionType: QuizQuestionType;
  shortAnswerMode?:
    "atomic_term" | "proposition" | "enumeration" | "formula" | "unknown";
  prefixCacheState?: "hot" | "cold" | "unknown";
  recentLatencyBucket?: "fast" | "typical" | "slow" | "unknown";
};

export type FirstQuestionEtaBreakdown = {
  baseMs: number;
  captionInputMs: number;
  focusWindowMs: number;
  planningMs: number;
  questionTypeMs: number;
  shortAnswerModeMs: number;
  prefixCacheMs: number;
  recentLatencyMs: number;
  estimatedDurationMs: number;
};

export type FirstQuestionRetryEtaPhase = {
  attempt: number;
  maxAttempts: number;
  retryDelayMs: number;
  startedAtMs: number;
  estimatedDurationMs: number;
};

type FirstQuestionRetryProgress = {
  attempt?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

const DEFAULT_CAPTION_WORD_COUNT = 2_500;
const ESTIMATED_CAPTION_WORDS_PER_MINUTE = 155;
const MAX_CALIBRATED_CAPTION_WORD_COUNT = 12_000;
const MAX_FOCUS_WINDOW_WORD_COUNT = 800;
const MIN_FIRST_QUESTION_ETA_MS = 15_000;
const MAX_FIRST_QUESTION_ETA_MS = 35_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

const COMPLETE_BANK_BASE_MS: Record<SupportedQuestionCount, number> = {
  5: 28_000,
  10: 42_000,
  15: 56_000,
};

const FIRST_QUESTION_TYPE_ADJUSTMENT_MS: Record<QuizQuestionType, number> = {
  true_false: 0,
  multiple_choice: 3_500,
  short_answer: 12_500,
};

const SHORT_ANSWER_MODE_ADJUSTMENT_MS = {
  atomic_term: -2_000,
  proposition: 1_000,
  enumeration: 2_000,
  formula: 3_500,
  unknown: 0,
} as const;

const PREFIX_CACHE_ADJUSTMENT_MS = {
  hot: -2_500,
  cold: 2_000,
  unknown: 0,
} as const;

const RECENT_LATENCY_ADJUSTMENT_MS = {
  fast: -1_500,
  typical: 0,
  slow: 4_000,
  unknown: 0,
} as const;

const CJK_CHARACTER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[\u2019'][\p{L}\p{N}]+)*/gu;

/**
 * Counts caption words without retaining or exporting transcript text.
 * CJK captions do not always contain spaces, so two CJK characters count as
 * one word-equivalent for the input-size estimate.
 */
export function countCaptionWords(
  segments: Pick<TranscriptSegment, "text">[],
): number {
  const text = segments
    .map((segment) => segment.text)
    .join(" ")
    .trim();
  if (!text) return 0;

  const cjkCharacterCount = text.match(CJK_CHARACTER_PATTERN)?.length ?? 0;
  const nonCjkText = text.replace(CJK_CHARACTER_PATTERN, " ");
  const nonCjkWordCount = nonCjkText.match(WORD_PATTERN)?.length ?? 0;

  return nonCjkWordCount + Math.ceil(cjkCharacterCount / 2);
}

/**
 * Estimates click-to-visible-question-1 latency, not full quiz generation.
 *
 * The coefficients are a rounded, bias-corrected Huber fit from 15 real
 * Chrome runs: five captioned YouTube videos crossed with 5/10/15 questions
 * and a balanced first-question type plan. The stable profile now requests q1
 * alone; the small question-count coefficient is retained as the measured
 * setup and planning effect, not as an output-batch cost. The word term is
 * capped at the largest measured transcript to avoid extrapolating beyond the
 * calibration set.
 */
export function estimatedFirstQuestionDurationMs(
  input: FirstQuestionEtaInput,
): number {
  return firstQuestionEtaBreakdown(input).estimatedDurationMs;
}

/**
 * Estimates one complete non-thinking JSON-bank request. The value depends
 * only on choices made before generation starts, so the progress clock never
 * changes speed after caption metadata arrives.
 */
export function estimatedCompleteBankDurationMs(
  input: CompleteBankEtaInput,
): number {
  const selected = new Set(input.questionTypes);
  const shortAnswerAdjustmentMs = selected.has("short_answer") ? 8_000 : 0;
  const mixedTypeAdjustmentMs = selected.size > 1 ? 3_000 : 0;
  return (
    COMPLETE_BANK_BASE_MS[input.questionCount] +
    shortAnswerAdjustmentMs +
    mixedTypeAdjustmentMs
  );
}

/** Maps one elapsed-time clock to a constant-speed visual fill. */
export function linearJourneyProgress(
  elapsedMs: number,
  durationMs: number,
  limit = 0.99,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return limit;
  return Math.min(limit, (elapsedMs / durationMs) * limit);
}

/**
 * Returns the privacy-safe factors behind the q1 estimate so browser QA can
 * compare predictions with observed readiness without retaining captions.
 */
export function firstQuestionEtaBreakdown(
  input: FirstQuestionEtaInput,
): FirstQuestionEtaBreakdown {
  const captionWordCount = resolveCaptionWordCount(input);
  const captionInputMs =
    (Math.min(captionWordCount, MAX_CALIBRATED_CAPTION_WORD_COUNT) / 1_000) *
    200;
  const focusWindowMs = Number.isFinite(input.focusWindowWordCount)
    ? (Math.min(
        Math.max(0, input.focusWindowWordCount ?? 0),
        MAX_FOCUS_WINDOW_WORD_COUNT,
      ) /
        100) *
      250
    : 0;
  const planningMs = ((input.questionCount - 5) / 5) * 2_000;
  const questionTypeMs =
    FIRST_QUESTION_TYPE_ADJUSTMENT_MS[input.firstQuestionType];
  const shortAnswerModeMs =
    input.firstQuestionType === "short_answer"
      ? SHORT_ANSWER_MODE_ADJUSTMENT_MS[input.shortAnswerMode ?? "unknown"]
      : 0;
  const prefixCacheMs =
    PREFIX_CACHE_ADJUSTMENT_MS[input.prefixCacheState ?? "unknown"];
  const recentLatencyMs =
    RECENT_LATENCY_ADJUSTMENT_MS[input.recentLatencyBucket ?? "unknown"];
  const baseMs = 12_000;
  const rawEstimateMs =
    baseMs +
    captionInputMs +
    focusWindowMs +
    planningMs +
    questionTypeMs +
    shortAnswerModeMs +
    prefixCacheMs +
    recentLatencyMs;
  const estimatedDurationMs = Math.round(
    Math.max(
      MIN_FIRST_QUESTION_ETA_MS,
      Math.min(MAX_FIRST_QUESTION_ETA_MS, rawEstimateMs),
    ),
  );

  return {
    baseMs,
    captionInputMs,
    focusWindowMs,
    planningMs,
    questionTypeMs,
    shortAnswerModeMs,
    prefixCacheMs,
    recentLatencyMs,
    estimatedDurationMs,
  };
}

/**
 * Start one retry ETA phase. Repeated progress events for the same attempt
 * preserve the original phase clock so a streaming retry cannot continually
 * reset its own countdown.
 */
export function updateFirstQuestionRetryEtaPhase(
  current: FirstQuestionRetryEtaPhase | undefined,
  progress: FirstQuestionRetryProgress,
  baseEstimateMs: number,
  nowMs = Date.now(),
): FirstQuestionRetryEtaPhase | undefined {
  if (
    !Number.isInteger(progress.attempt) ||
    !Number.isInteger(progress.maxAttempts) ||
    !Number.isInteger(progress.retryDelayMs) ||
    (progress.attempt ?? 0) < 1 ||
    (progress.maxAttempts ?? 0) < (progress.attempt ?? 0) ||
    (progress.retryDelayMs ?? -1) < 0
  ) {
    return current;
  }
  if (current?.attempt === progress.attempt) return current;

  const retryDelayMs = Math.min(MAX_RETRY_DELAY_MS, progress.retryDelayMs ?? 0);
  return {
    attempt: progress.attempt!,
    maxAttempts: progress.maxAttempts!,
    retryDelayMs,
    startedAtMs: nowMs,
    estimatedDurationMs: retryDelayMs + Math.max(0, baseEstimateMs),
  };
}

export function firstQuestionRetryRemainingMs(
  phase: FirstQuestionRetryEtaPhase,
  nowMs = Date.now(),
): number {
  return Math.max(
    0,
    phase.estimatedDurationMs - Math.max(0, nowMs - phase.startedAtMs),
  );
}

function resolveCaptionWordCount(input: FirstQuestionEtaInput): number {
  if (
    Number.isFinite(input.captionWordCount) &&
    (input.captionWordCount ?? 0) >= 0
  ) {
    return input.captionWordCount ?? 0;
  }
  if (
    Number.isFinite(input.videoDurationSeconds) &&
    (input.videoDurationSeconds ?? 0) > 0
  ) {
    return (
      ((input.videoDurationSeconds ?? 0) / 60) *
      ESTIMATED_CAPTION_WORDS_PER_MINUTE
    );
  }
  return DEFAULT_CAPTION_WORD_COUNT;
}
