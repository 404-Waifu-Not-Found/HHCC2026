// Framework-free logic for the inline Workplace practice-set experience.
//
// The Workplace orchestrator can hand a validated `WorkplacePracticeSet` (five
// already-graded questions plus a requested-vs-effective policy) back into the
// chat thread. This module owns everything the inline UI needs that is not
// JSX, so it can be unit-tested without a renderer:
//   * local, deterministic per-question feedback (formative only),
//   * score aggregation for the completion summary,
//   * policy detection that decides whether "save" is a graded diagnostic or a
//     practice-only import, and
//   * the submission orchestration that reuses the existing `/api/quizzes`
//     attempt/grading flow, tagged with the Workplace origin + thread link.
//
// Critically, mastery is never computed here. The client submits the attempt
// and the server alone decides -- via the quiz bank's `affects_mastery` flag,
// set only for a completed single-video diagnostic import -- whether mastery
// moves. No mastery prediction is ever surfaced to the learner from this code.

import {
  AttemptAnswerResponseSchema,
  QuizStartResponseSchema,
  WorkplacePracticeSetImportRequestSchema,
  WorkplacePracticeSetImportResponseSchema,
  type AttemptAnswerRequest,
  type AttemptAnswerResponse,
  type LocalConceptQuizQuestion,
  type PublicQuestion,
  type WorkplacePracticeSet,
} from "@clipquest/contracts";
import type { ZodType } from "zod";

/** The three answer shapes the inline set accepts, one per supported type. */
export type PracticeLocalAnswer = number | boolean | string;

export type PracticePolicyMode = "diagnostic" | "practice";

export type PracticeQuestionGrade = {
  questionId: string;
  index: number;
  correct: boolean;
  correctAnswer: PracticeLocalAnswer;
  explanation: string;
};

export type PracticeSubmissionOutcome = {
  quizId: string;
  attemptId: string;
  messageId: string;
  score: number;
  /** Server-authoritative: whether this attempt was allowed to move mastery. */
  affectsMastery: boolean;
  saveMode: PracticePolicyMode;
};

export type PracticeErrorKind = "aborted" | "offline" | "error";

/**
 * Minimal shape of the app's `apiRequest`, injected so the orchestration can
 * be exercised in tests without the real network client.
 */
export type PracticeApiRequest = <T>(
  path: string,
  options: RequestInit,
  schema?: ZodType<T>,
) => Promise<T>;

export type PracticeSubmissionDeps = {
  request: PracticeApiRequest;
  /** Idempotency-key/UUID factory (expo-crypto in the app, deterministic in tests). */
  createId: () => string;
};

// ---------------------------------------------------------------------------
// Policy detection
// ---------------------------------------------------------------------------

/**
 * A practice set can only be saved as a graded diagnostic when the model's
 * effective policy is "diagnostic" AND it is grounded in exactly one owned
 * video. Mastery is tracked per single video, so a multi-video set can never
 * be a mastery-affecting diagnostic even if the model asked for one. This is a
 * UI affordance only -- the server re-derives the same rule when importing.
 */
export function isDiagnosticEligible(set: WorkplacePracticeSet): boolean {
  return set.effectivePolicy === "diagnostic" && set.videoIds.length === 1;
}

/** Which label/behavior the save button uses: graded diagnostic vs practice. */
export function practiceSaveMode(
  set: WorkplacePracticeSet,
): PracticePolicyMode {
  return isDiagnosticEligible(set) ? "diagnostic" : "practice";
}

// ---------------------------------------------------------------------------
// Local, formative grading (never authoritative for mastery)
// ---------------------------------------------------------------------------

export function normalizeShortAnswer(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function gradeShortAnswerLocally(
  question: Extract<LocalConceptQuizQuestion, { type: "short_answer" }>,
  answer: string,
): boolean {
  const normalized = normalizeShortAnswer(answer);
  if (normalized.length === 0) return false;
  const accepted = [question.answer, ...question.acceptableAnswers].map(
    normalizeShortAnswer,
  );
  return accepted.includes(normalized);
}

/**
 * Deterministic local feedback for one answered question. Multiple-choice and
 * true/false are exact; short-answer uses a conservative canonical/alias match
 * for immediate feedback only -- the server remains the authoritative grader
 * when the attempt is saved.
 */
export function gradeLocalPracticeAnswer(
  question: LocalConceptQuizQuestion,
  index: number,
  answer: PracticeLocalAnswer,
): PracticeQuestionGrade {
  if (question.type === "multiple_choice") {
    return {
      questionId: question.id,
      index,
      correct: answer === question.answerIndex,
      correctAnswer: question.answerIndex,
      explanation: question.explanation,
    };
  }
  if (question.type === "true_false") {
    return {
      questionId: question.id,
      index,
      correct: answer === question.answer,
      correctAnswer: question.answer,
      explanation: question.explanation,
    };
  }
  return {
    questionId: question.id,
    index,
    correct:
      typeof answer === "string" && gradeShortAnswerLocally(question, answer),
    correctAnswer: question.answer,
    explanation: question.explanation,
  };
}

/** Percentage of correct answers, rounded, matching the server's rounding. */
export function computePracticeScore(grades: PracticeQuestionGrade[]): number {
  if (grades.length === 0) return 0;
  const correct = grades.filter((grade) => grade.correct).length;
  return Math.round((correct / grades.length) * 100);
}

// ---------------------------------------------------------------------------
// Attempt-answer marshalling
// ---------------------------------------------------------------------------

/**
 * Convert an inline answer into the `AnswerValue` the `/api/quizzes` attempt
 * endpoint expects, validating the shape against the question type. Options are
 * stored server-side in their original order, so a choice index maps directly.
 */
export function toAttemptAnswerValue(
  question: LocalConceptQuizQuestion,
  answer: PracticeLocalAnswer,
): AttemptAnswerRequest["answer"] {
  if (question.type === "multiple_choice") {
    if (typeof answer !== "number" || !Number.isInteger(answer) || answer < 0) {
      throw new PracticeSubmissionError(
        "error",
        "Select an option before saving.",
      );
    }
    return answer;
  }
  if (question.type === "true_false") {
    if (typeof answer !== "boolean") {
      throw new PracticeSubmissionError(
        "error",
        "Choose true or false before saving.",
      );
    }
    return answer;
  }
  if (typeof answer !== "string" || answer.trim().length === 0) {
    throw new PracticeSubmissionError(
      "error",
      "Write a short answer before saving.",
    );
  }
  return answer.trim();
}

// ---------------------------------------------------------------------------
// Errors + classification
// ---------------------------------------------------------------------------

export class PracticeSubmissionError extends Error {
  constructor(
    readonly kind: PracticeErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "PracticeSubmissionError";
  }
}

/**
 * Classify a thrown value from submission into an inline UI state. Aborts (the
 * learner navigated away / left the Workplace tab) are surfaced separately so
 * the component can stay silent, and network-shaped failures collapse into a
 * single "offline" retry affordance.
 */
export function classifyPracticeError(error: unknown): PracticeErrorKind {
  if (error instanceof PracticeSubmissionError) return error.kind;
  if (isAbortError(error)) return "aborted";
  if (isOfflineError(error)) return "offline";
  return "error";
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function isOfflineError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  if (candidate.code === "request_timeout" || candidate.status === 504) {
    return true;
  }
  if (candidate.name === "TypeError" || candidate.name === "TimeoutError") {
    return true;
  }
  const message =
    typeof candidate.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  return (
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("timed out")
  );
}

// ---------------------------------------------------------------------------
// Submission orchestration
// ---------------------------------------------------------------------------

function idempotencyHeaders(id: string): HeadersInit {
  return { "Idempotency-Key": id, "Content-Type": "application/json" };
}

async function runAttemptAnswers(input: {
  request: PracticeApiRequest;
  attemptId: string;
  firstQuestion: PublicQuestion;
  questions: LocalConceptQuizQuestion[];
  answers: PracticeLocalAnswer[];
  signal?: AbortSignal;
}): Promise<{ score: number }> {
  let current: PublicQuestion | null = input.firstQuestion;
  // Each of the N questions can serve at most one adaptive retry, so bound the
  // loop generously to guarantee termination even if the server misbehaves.
  const maxIterations = input.questions.length * 2 + 4;
  let iterations = 0;
  let finalScore = 0;

  while (current) {
    if (iterations++ > maxIterations) {
      throw new PracticeSubmissionError(
        "error",
        "The practice attempt could not be submitted.",
      );
    }
    const position = current.position - 1;
    const question = input.questions[position];
    const answer = input.answers[position];
    if (!question || answer === undefined) {
      throw new PracticeSubmissionError(
        "error",
        "This practice set is missing an answer.",
      );
    }
    const result: AttemptAnswerResponse = await input.request(
      `/api/attempts/${input.attemptId}/answer`,
      {
        method: "POST",
        body: JSON.stringify({
          questionId: current.id,
          answer: toAttemptAnswerValue(question, answer),
        }),
        signal: input.signal,
      },
      AttemptAnswerResponseSchema,
    );
    if (result.completed) {
      finalScore = result.score ?? 0;
      break;
    }
    current = result.nextQuestion;
  }

  return { score: finalScore };
}

/**
 * Save an inline practice set as a graded attempt.
 *
 * 1. Import the set (`/api/workplace/practice-imports`) -- this is where the
 *    Workplace origin, thread link, and server-gated mastery eligibility are
 *    stamped onto the quiz bank.
 * 2. Start a learn-mode attempt on that quiz via the standard `/api/quizzes`
 *    flow.
 * 3. Replay the learner's answers so the server grades them and, only when the
 *    quiz bank is mastery-eligible, updates mastery on completion.
 *
 * The returned `affectsMastery` is the server's decision, never a local guess.
 */
export async function submitWorkplacePracticeAttempt(input: {
  threadId: string;
  practiceSet: WorkplacePracticeSet;
  answers: PracticeLocalAnswer[];
  deps: PracticeSubmissionDeps;
  signal?: AbortSignal;
}): Promise<PracticeSubmissionOutcome> {
  const { threadId, practiceSet, answers, deps, signal } = input;
  if (answers.length !== practiceSet.questions.length) {
    throw new PracticeSubmissionError(
      "error",
      "Answer every question before saving.",
    );
  }
  if (signal?.aborted) {
    throw new PracticeSubmissionError("aborted", "Practice save cancelled.");
  }

  const importBody = WorkplacePracticeSetImportRequestSchema.parse({
    threadId,
    practiceSet,
  });
  const imported = await deps.request(
    "/api/workplace/practice-imports",
    {
      method: "POST",
      headers: idempotencyHeaders(deps.createId()),
      body: JSON.stringify(importBody),
      signal,
    },
    WorkplacePracticeSetImportResponseSchema,
  );

  const start = await deps.request(
    `/api/quizzes/${imported.quizId}/start`,
    {
      method: "POST",
      headers: idempotencyHeaders(deps.createId()),
      body: JSON.stringify({
        mode: "learn",
        sessionLength: "short",
        watched: true,
      }),
      signal,
    },
    QuizStartResponseSchema,
  );

  const { score } = await runAttemptAnswers({
    request: deps.request,
    attemptId: start.attemptId,
    firstQuestion: start.question,
    questions: practiceSet.questions,
    answers,
    signal,
  });

  return {
    quizId: imported.quizId,
    attemptId: start.attemptId,
    messageId: imported.messageId,
    score,
    affectsMastery: imported.affectsMastery,
    saveMode: practiceSaveMode(practiceSet),
  };
}
