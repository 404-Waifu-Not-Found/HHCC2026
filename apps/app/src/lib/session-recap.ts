/**
 * Session recap: the learner-visible summary of what was answered during one
 * quiz session. Entries are recorded client-side as each graded response
 * arrives so the completion screen can show which concepts were missed, what
 * the correct answer was, and the reasoning — corrective feedback that a score
 * alone does not provide.
 *
 * The helper is pure and platform-neutral so it can be unit tested without the
 * quiz screen.
 */

export type RecapEntry = {
  /** Stable question id from the attempt; retries reuse the same id. */
  questionId: string;
  /** Presentation-normalised prompt shown to the learner. */
  prompt: string;
  correct: boolean;
  /** True when this entry graded an adaptive retry of an earlier miss. */
  isRetry: boolean;
  /** Human-readable form of what the learner submitted. */
  learnerAnswer?: string;
  /** Human-readable canonical answer; present for incorrect responses. */
  correctAnswer?: string;
  /** The "Why" explanation returned with grading. */
  explanation: string;
};

export type RecapItem = RecapEntry & {
  /** A later retry of the same question was answered correctly. */
  recoveredOnRetry: boolean;
};

export type RecapSummary = {
  /** Number of distinct questions that received at least one graded answer. */
  answered: number;
  /** Questions whose first non-retry answer was correct. */
  firstTryCorrect: number;
  /** First miss per question, in session order, with retry outcome. */
  missed: RecapItem[];
};

export function recordRecapEntry(
  entries: readonly RecapEntry[],
  entry: RecapEntry,
): RecapEntry[] {
  return [...entries, entry];
}

export function summarizeRecap(entries: readonly RecapEntry[]): RecapSummary {
  const firstEntryByQuestion = new Map<string, RecapEntry>();
  const firstMissByQuestion = new Map<string, RecapEntry>();
  const recoveredQuestions = new Set<string>();
  const missOrder: string[] = [];

  for (const entry of entries) {
    if (!firstEntryByQuestion.has(entry.questionId)) {
      firstEntryByQuestion.set(entry.questionId, entry);
    }
    if (!entry.correct) {
      if (!firstMissByQuestion.has(entry.questionId)) {
        firstMissByQuestion.set(entry.questionId, entry);
        missOrder.push(entry.questionId);
      }
      continue;
    }
    if (entry.isRetry && firstMissByQuestion.has(entry.questionId)) {
      recoveredQuestions.add(entry.questionId);
    }
  }

  let firstTryCorrect = 0;
  for (const first of firstEntryByQuestion.values()) {
    if (first.correct && !first.isRetry) firstTryCorrect += 1;
  }

  return {
    answered: firstEntryByQuestion.size,
    firstTryCorrect,
    missed: missOrder.map((questionId) => ({
      ...firstMissByQuestion.get(questionId)!,
      recoveredOnRetry: recoveredQuestions.has(questionId),
    })),
  };
}
