import type { QuizQuestionType, TranscriptSegment } from "@clipquest/contracts";

export type SupportedQuestionCount = 5 | 10 | 15;

export type FirstQuestionEtaInput = {
  captionWordCount?: number;
  videoDurationSeconds?: number;
  questionCount: SupportedQuestionCount;
  firstQuestionType: QuizQuestionType;
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
const MIN_FIRST_QUESTION_ETA_MS = 15_000;
const MAX_FIRST_QUESTION_ETA_MS = 35_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

const FIRST_QUESTION_TYPE_ADJUSTMENT_MS: Record<QuizQuestionType, number> = {
  true_false: 0,
  multiple_choice: 3_500,
  short_answer: 12_500,
};

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
  const captionWordCount = resolveCaptionWordCount(input);
  const captionInputMs =
    (Math.min(captionWordCount, MAX_CALIBRATED_CAPTION_WORD_COUNT) / 1_000) *
    200;
  const additionalBatchPlanningMs = ((input.questionCount - 5) / 5) * 2_000;
  const typeAdjustmentMs =
    FIRST_QUESTION_TYPE_ADJUSTMENT_MS[input.firstQuestionType];
  const estimateMs =
    12_000 + captionInputMs + additionalBatchPlanningMs + typeAdjustmentMs;

  return Math.round(
    Math.max(
      MIN_FIRST_QUESTION_ETA_MS,
      Math.min(MAX_FIRST_QUESTION_ETA_MS, estimateMs),
    ),
  );
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
