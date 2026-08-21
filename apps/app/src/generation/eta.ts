export type SupportedQuestionCount = 5 | 10 | 15;

/**
 * Rounded production ETAs measured against one fixed YouTube lesson.
 * Normal runs were 34-42s for 5 questions, 49-58s for 10 questions,
 * and 56-59s for 15 questions. Automatic model retries are intentionally
 * treated as long-tail events instead of inflating every learner's estimate.
 */
const GENERATION_ETA_MS: Record<SupportedQuestionCount, number> = {
  5: 45_000,
  10: 60_000,
  15: 65_000,
};

export function estimatedGenerationDurationMs(
  questionCount: SupportedQuestionCount,
): number {
  return GENERATION_ETA_MS[questionCount];
}
