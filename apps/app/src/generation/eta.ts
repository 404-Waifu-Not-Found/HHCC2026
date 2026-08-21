import type { QuizQuestionType, TranscriptSegment } from "@clipquest/contracts";

export type SupportedQuestionCount = 5 | 10 | 15;

export type FirstQuestionEtaInput = {
  captionWordCount?: number;
  videoDurationSeconds?: number;
  questionCount: SupportedQuestionCount;
  firstQuestionType: QuizQuestionType;
};

const DEFAULT_CAPTION_WORD_COUNT = 2_500;
const ESTIMATED_CAPTION_WORDS_PER_MINUTE = 155;
const MAX_CALIBRATED_CAPTION_WORD_COUNT = 12_000;
const MIN_FIRST_QUESTION_ETA_MS = 15_000;
const MAX_FIRST_QUESTION_ETA_MS = 35_000;

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
 * and a balanced first-question type plan. DeepSeek only receives five
 * questions in its first call, so total question count has a deliberately
 * small effect. The word term is capped at the largest measured transcript to
 * avoid pretending that this small calibration set supports extrapolation.
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
