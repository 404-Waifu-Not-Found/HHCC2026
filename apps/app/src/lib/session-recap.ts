/**
 * Session recap: the learner-visible summary of what was answered during one
 * quiz session. Entries are recorded client-side as each graded response
 * arrives so the completion screen can show which concepts were missed, what
 * the correct answer was, and the reasoning — corrective feedback that a score
 * alone does not provide.
 *
 * The helpers are pure and platform-neutral so they can be unit tested without
 * the quiz screen.
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
  /** The stored "Why" explanation returned with grading. */
  explanation: string;
  /**
   * The reason-first text the learner actually saw in the feedback panel when
   * the device-local grade agreed with the server verdict. Falls back to
   * `explanation` when absent so the recap never contradicts the feedback.
   */
  reason?: string;
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

export type ComboSummary = {
  /** Current consecutive correct answers at the latest graded item. */
  current: number;
  /** Highest consecutive-correct combo reached in this session. */
  best: number;
  /** Lightweight local bonus points earned from combos. */
  bonus: number;
};

export function comboBonusForCount(count: number): number {
  if (count < 2) return 0;
  if (count < 4) return 1;
  if (count < 6) return 2;
  if (count < 10) return 3;
  return 5;
}

export function summarizeCombo(entries: readonly RecapEntry[]): ComboSummary {
  let current = 0;
  let best = 0;
  let bonus = 0;
  for (const entry of entries) {
    if (!entry.correct) {
      current = 0;
      continue;
    }
    current += 1;
    if (current > best) best = current;
    bonus += comboBonusForCount(current);
  }
  return { current, best, bonus };
}

export function summarizeRecap(entries: readonly RecapEntry[]): RecapSummary {
  const seen = new Set<string>();
  const firstMissByQuestion = new Map<string, RecapEntry>();
  const recoveredQuestions = new Set<string>();
  let firstTryCorrect = 0;

  for (const entry of entries) {
    if (!seen.has(entry.questionId)) {
      seen.add(entry.questionId);
      if (entry.correct && !entry.isRetry) firstTryCorrect += 1;
    }
    if (!entry.correct) {
      if (!firstMissByQuestion.has(entry.questionId)) {
        firstMissByQuestion.set(entry.questionId, entry);
      }
    } else if (entry.isRetry && firstMissByQuestion.has(entry.questionId)) {
      recoveredQuestions.add(entry.questionId);
    }
  }

  return {
    answered: seen.size,
    firstTryCorrect,
    missed: [...firstMissByQuestion.values()].map((entry) => ({
      ...entry,
      recoveredOnRetry: recoveredQuestions.has(entry.questionId),
    })),
  };
}

/**
 * Attach the device-local grading reason to the most recent entry for the
 * same question and retry state, but only when that grade reached the same
 * verdict as the server — the same rule the feedback panel applies before it
 * prefers the local reason over the stored explanation.
 */
export function attachLocalReason(
  entries: readonly RecapEntry[],
  target: { questionId: string; isRetry: boolean },
  grade: { correct: boolean; reason: string },
): RecapEntry[] {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (
      entry.questionId !== target.questionId ||
      entry.isRetry !== target.isRetry
    )
      continue;
    if (entry.correct !== grade.correct || !grade.reason.trim())
      return [...entries];
    const next = [...entries];
    next[index] = { ...entry, reason: grade.reason };
    return next;
  }
  return [...entries];
}

/**
 * Validate recap entries restored from device storage. Anything malformed is
 * dropped rather than trusted, so a stale or hand-edited record can only
 * shorten the recap, never crash the completion screen.
 */
export function parseRecapEntries(value: unknown): RecapEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: RecapEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.questionId !== "string" ||
      typeof record.prompt !== "string" ||
      typeof record.correct !== "boolean" ||
      typeof record.isRetry !== "boolean" ||
      typeof record.explanation !== "string"
    ) {
      continue;
    }
    const optional = (key: "learnerAnswer" | "correctAnswer" | "reason") =>
      typeof record[key] === "string" ? (record[key] as string) : undefined;
    entries.push({
      questionId: record.questionId,
      prompt: record.prompt,
      correct: record.correct,
      isRetry: record.isRetry,
      explanation: record.explanation,
      learnerAnswer: optional("learnerAnswer"),
      correctAnswer: optional("correctAnswer"),
      reason: optional("reason"),
    });
  }
  return entries;
}
