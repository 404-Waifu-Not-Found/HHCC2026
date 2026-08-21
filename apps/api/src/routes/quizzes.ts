import {
  AnswerValueSchema,
  AttemptGenerationAvailabilitySchema,
  AttemptGenerationResponseSchema,
  AttemptAnswerRequestSchema,
  AttemptAnswerResponseSchema,
  AttemptResumeResponseSchema,
  LOCAL_QUIZ_PIPELINE_VERSION,
  MasteryStateSchema,
  PublicQuestionSchema,
  QuizStartRequestSchema,
  QuizStartResponseSchema,
  questionLimitForSession,
  type MasteryState,
  type AttemptGenerationAvailability,
  type PublicQuestion,
  type QuizQuestionType,
  type QuizStartRequest,
  type QuizStartResponse,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { gradeWrittenAnswer } from "../lib/ai-services";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { requireIdempotencyKey } from "../lib/idempotency";
import { calculateMastery } from "../lib/mastery";
import {
  gradeProgressiveShortAnswer,
  readProgressiveGenerationSnapshot,
  type ProgressiveGenerationSnapshot,
} from "../lib/progressive-quiz";
import { enforceRateLimit } from "../lib/rate-limit";
import { StoredTranscriptSchema } from "../lib/stored-transcript";
import { parseJson, parseStoredJson } from "../lib/validation";
import type { ApiBindings } from "../middleware/authenticated";

const QuestionTypeSchema = z.enum([
  "multiple_choice",
  "true_false",
  "ordering",
  "short_answer",
]);
const QuestionRowSchema = z.object({
  id: z.string().uuid(),
  quiz_id: z.string().uuid(),
  ordinal: z.number().int(),
  type: QuestionTypeSchema,
  concept_id: z.string(),
  prompt: z.string(),
  reformulated_prompt: z.string(),
  options_json: z.string().nullable(),
  items_json: z.string().nullable(),
  correct_answer_json: z.string().nullable(),
  rubric_json: z.string().nullable(),
  explanation: z.string(),
  evidence_segment_ids_json: z.string(),
  difficulty: z.number().int().min(1).max(5),
});
type QuestionRow = z.infer<typeof QuestionRowSchema>;

const AttemptRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string(),
  quiz_id: z.string().uuid(),
  video_id: z.string().uuid(),
  mode: z.enum(["learn", "review"]),
  status: z.enum(["active", "complete"]),
  current_index: z.number().int().nonnegative(),
  current_variant: z.number().int().nonnegative(),
  retry_pending: z.number().int(),
  target_difficulty: z.number(),
  correct_count: z.number().int().nonnegative(),
  total_answered: z.number().int().nonnegative(),
  item_count: z.number().int().positive(),
  score: z.number().nullable(),
  mastery_state: MasteryStateSchema.nullable(),
  quiz_pipeline_version: z.number().int(),
  quiz_language: z.string(),
  quiz_session_length: z.enum(["short", "medium", "long"]),
  quiz_watched: z.number().int(),
});
type AttemptRow = z.infer<typeof AttemptRowSchema>;

const MasteryRowSchema = z.object({
  state: MasteryStateSchema,
  best_score: z.number().nullable(),
  initial_passed_at: z.number().nullable(),
  review_passed_at: z.number().nullable(),
  next_review_at: z.number().nullable(),
});

const RubricSchema = z.object({
  requiredIdeas: z.array(z.string()).min(1),
  acceptableAlternatives: z.array(z.string()),
});

const QUIZ_STARTS_PER_MINUTE = 8;
const LEGACY_LOCAL_QUIZ_PIPELINE_VERSION = 7;
export const ANSWER_RESERVATION_TTL_MS = 90_000;
export const ANSWER_RESERVATION_SQL = `
  UPDATE attempts
  SET grading_token = ?, grading_expires_at = ?, updated_at = ?
  WHERE id = ?
    AND user_id = ?
    AND status = 'active'
    AND current_index = ?
    AND current_variant = ?
    AND retry_pending = ?
    AND (
      grading_token IS NULL
      OR grading_expires_at IS NULL
      OR grading_expires_at <= ?
    )
  RETURNING id`;

export const quizzesRouter = new Hono<ApiBindings>();

quizzesRouter.post("/quizzes/:quizId/start", async (c) => {
  const user = c.get("user");
  const idempotencyKey = requireIdempotencyKey(c);
  const input = await parseJson(c, QuizStartRequestSchema);
  const quizId = c.req.param("quizId");
  const startRequestJson = JSON.stringify({ quizId, ...input });
  const existingStart = await findAttemptStartByKey(
    c.env.DB,
    user.id,
    idempotencyKey,
  );
  if (existingStart) {
    return c.json(
      await replayAttemptStart(
        c.env.DB,
        user.id,
        existingStart,
        quizId,
        startRequestJson,
      ),
    );
  }
  const quiz = await c.env.DB.prepare(
    "SELECT id, video_id, primer, watched, pipeline_version, language, session_length FROM quiz_banks WHERE id = ? AND user_id = ? AND ((pipeline_version = ? AND quality_status = 'passed') OR (pipeline_version = ? AND quality_status IN ('generating', 'passed')))",
  )
    .bind(
      quizId,
      user.id,
      LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
      LOCAL_QUIZ_PIPELINE_VERSION,
    )
    .first<{
      id: string;
      video_id: string;
      primer: string;
      watched: number;
      pipeline_version: number;
      language: string;
      session_length: "short" | "medium" | "long";
    }>();
  if (!quiz) throw new ApiError(404, "quiz_not_found", "Quiz not found.");
  const quizSnapshot = await readProgressiveGenerationSnapshot(
    c.env.DB,
    quiz.id,
  );
  if (quizSnapshot.pipelineVersion !== quiz.pipeline_version) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "Quiz pipeline metadata changed while starting the attempt.",
    );
  }
  const progressiveSummary =
    quiz.pipeline_version === LOCAL_QUIZ_PIPELINE_VERSION
      ? quizSnapshot.summary
      : null;
  if (quizSnapshot.qualityStatus === "generating" && !progressiveSummary) {
    throw new ApiError(
      409,
      "quiz_not_progressive",
      "This generating quiz does not support current progressive delivery.",
    );
  }

  if (input.mode === "review") {
    if (quizSnapshot.qualityStatus !== "passed") {
      throw new ApiError(
        409,
        "quiz_still_generating",
        "Finish generating this quiz before starting a review.",
      );
    }
    const mastery = await c.env.DB.prepare(
      "SELECT initial_passed_at FROM mastery WHERE user_id = ? AND video_id = ?",
    )
      .bind(user.id, quiz.video_id)
      .first<{ initial_passed_at: number | null }>();
    if (!mastery?.initial_passed_at) {
      throw new ApiError(
        409,
        "review_not_ready",
        "Complete an 80% learning session before starting a mastery review.",
      );
    }
  }

  const activeAttemptId = await findActiveAttemptId(
    c.env.DB,
    user.id,
    quiz.id,
    input.mode,
  );
  if (activeAttemptId) {
    const activeAttempt = await getAttempt(c.env.DB, activeAttemptId, user.id);
    const activeGeneration = await attemptGenerationState(
      c.env.DB,
      activeAttempt,
    );
    if (
      activeAttempt.current_index >=
      activeGeneration.generation.availableQuestions
    ) {
      throw new ApiError(
        409,
        "quiz_still_generating",
        "The next quiz question is still being generated.",
      );
    }
    await reconcileAttemptItems(c.env.DB, activeAttempt.quiz_id);
    const activeQuestion = await getAttemptQuestion(
      c.env.DB,
      activeAttempt.id,
      activeAttempt.current_index,
    );
    if (!activeQuestion) {
      throw new ApiError(
        500,
        "attempt_corrupt",
        "The active quiz question is missing.",
      );
    }
    return c.json(
      QuizStartResponseSchema.parse({
        attemptId: activeAttempt.id,
        primer: null,
        question: toPublicQuestion(
          activeQuestion,
          activeAttempt.current_index,
          activeAttempt.item_count,
          Boolean(activeAttempt.retry_pending),
        ),
        generation: activeGeneration.generation,
      }),
    );
  }

  await enforceRateLimit(c.env.DB, {
    namespace: "quiz-start",
    identifier: user.id,
    maximum: QUIZ_STARTS_PER_MINUTE,
    windowSeconds: 60,
  });

  const questionResult = progressiveSummary
    ? await c.env.DB.prepare(
        "SELECT id, quiz_id, ordinal, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty FROM questions WHERE quiz_id = ? AND ordinal < ? ORDER BY ordinal",
      )
        .bind(quiz.id, quizSnapshot.authoritativeCount)
        .all()
    : await c.env.DB.prepare(
        "SELECT id, quiz_id, ordinal, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty FROM questions WHERE quiz_id = ? ORDER BY ABS(difficulty - 2), ordinal",
      )
        .bind(quiz.id)
        .all();
  const questions = z
    .array(QuestionRowSchema)
    .safeParse(questionResult.results);
  if (!questions.success || questions.data.length < 1) {
    throw new ApiError(500, "quiz_empty", "This quiz has no valid questions.");
  }
  if (
    progressiveSummary &&
    questions.data.length !== quizSnapshot.authoritativeCount
  ) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "The streamed question sequence changed while starting the quiz.",
    );
  }

  const eligibleQuestions = selectEligibleQuestions(
    questions.data,
    input.questionTypes,
  );
  const desired = questionLimitForSession(input.sessionLength);
  if (
    progressiveSummary &&
    (desired !== progressiveSummary.plannedCount ||
      JSON.stringify(input.questionTypes) !==
        JSON.stringify(progressiveSummary.requestedQuestionTypes))
  ) {
    throw new ApiError(
      409,
      "quiz_start_mismatch",
      "The start request does not match this progressively generated quiz.",
    );
  }
  const selected = progressiveSummary
    ? [...eligibleQuestions].sort((left, right) => left.ordinal - right.ordinal)
    : selectVariedQuestions(
        eligibleQuestions,
        Math.min(desired, eligibleQuestions.length),
      );
  if (
    progressiveSummary &&
    selected.length !== quizSnapshot.authoritativeCount
  ) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "Stored questions do not match the progressive type plan.",
    );
  }
  const firstQuestion = selected.at(0);
  if (!firstQuestion)
    throw new ApiError(500, "quiz_empty", "This quiz has no valid questions.");
  const attemptId = createId();
  const timestamp = now();
  const itemCount = progressiveSummary
    ? progressiveSummary.plannedCount
    : selected.length;
  const generation = progressiveSummary
    ? requireProgressiveAvailability(quizSnapshot)
    : readyGeneration(itemCount);
  const startResponse = QuizStartResponseSchema.parse({
    attemptId,
    primer: (input.watched ?? Boolean(quiz.watched)) ? null : quiz.primer,
    question: toPublicQuestion(firstQuestion, 0, itemCount, false),
    generation,
  });
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO attempts (id, user_id, quiz_id, mode, status, current_index, current_variant, retry_pending, target_difficulty, correct_count, total_answered, item_count, start_key, start_request_json, start_response_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 0, 0, 0, 2, 0, 0, ?, ?, ?, ?, ?, ?)",
      ).bind(
        attemptId,
        user.id,
        quiz.id,
        input.mode,
        itemCount,
        idempotencyKey,
        startRequestJson,
        JSON.stringify(startResponse),
        timestamp,
        timestamp,
      ),
      ...selected.map((question, index) =>
        c.env.DB.prepare(
          "INSERT INTO attempt_items (attempt_id, ordinal, question_id) VALUES (?, ?, ?)",
        ).bind(attemptId, index, question.id),
      ),
      c.env.DB.prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'learning', ?) ON CONFLICT(user_id, video_id) DO UPDATE SET state = CASE WHEN mastery.state = 'not_started' THEN 'learning' ELSE mastery.state END, updated_at = excluded.updated_at",
      ).bind(user.id, quiz.video_id, timestamp),
    ]);
  } catch (error) {
    const raced = await findAttemptStartByKey(
      c.env.DB,
      user.id,
      idempotencyKey,
    );
    if (raced) {
      return c.json(
        await replayAttemptStart(
          c.env.DB,
          user.id,
          raced,
          quizId,
          startRequestJson,
        ),
      );
    }
    throw error;
  }

  return c.json(startResponse, 201);
});

quizzesRouter.post("/attempts/:attemptId/answer", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "quiz-answer",
    identifier: user.id,
    maximum: 90,
    windowSeconds: 60,
  });
  const input = await parseJson(c, AttemptAnswerRequestSchema);
  const attempt = await getAttempt(c.env.DB, c.req.param("attemptId"), user.id);
  if (attempt.status === "complete") {
    throw new ApiError(
      409,
      "attempt_complete",
      "This quiz is already complete.",
    );
  }
  await reconcileAttemptItems(c.env.DB, attempt.quiz_id);
  const question = await getAttemptQuestion(
    c.env.DB,
    attempt.id,
    attempt.current_index,
  );
  if (!question || question.id !== input.questionId) {
    throw new ApiError(
      409,
      "answer_out_of_sequence",
      "This answer is no longer current. Resume the quiz to continue.",
    );
  }

  const gradingToken = await reserveAttemptForAnswer(
    c.env.DB,
    attempt,
    user.id,
  );
  if (!gradingToken) {
    throw new ApiError(
      409,
      "answer_in_progress",
      "This answer is already being checked. Wait a moment and resume the quiz.",
    );
  }

  let reservationCommitted = false;
  try {
    const grade = await gradeAnswer(c.env, attempt, question, input.answer);
    // Freeze one coherent generation snapshot before any answer write. A
    // concurrent append may become visible on the next poll, but can never turn
    // this committed answer into a generation-state error response.
    const generationState = await attemptGenerationState(c.env.DB, attempt);
    const generation = generationState.generation;
    const timestamp = now();
    const answerInsert = c.env.DB.prepare(
      "INSERT INTO answers (id, attempt_id, question_id, answer_json, is_correct, feedback, variant_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      createId(),
      attempt.id,
      question.id,
      JSON.stringify(input.answer),
      grade.correct ? 1 : 0,
      grade.feedback,
      attempt.current_variant,
      timestamp,
    );

    if (!grade.correct && !attempt.retry_pending) {
      await c.env.DB.batch([
        answerInsert,
        c.env.DB.prepare(
          "UPDATE attempts SET retry_pending = 1, current_variant = 1, total_answered = total_answered + 1, target_difficulty = MAX(1, target_difficulty - 0.5), grading_token = NULL, grading_expires_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND grading_token = ?",
        ).bind(timestamp, attempt.id, user.id, gradingToken),
      ]);
      reservationCommitted = true;
      return c.json(
        AttemptAnswerResponseSchema.parse({
          correct: false,
          explanation: grade.feedback,
          evidenceSegmentIds: parseQuestionEvidence(question),
          nextQuestion: toPublicQuestion(
            question,
            attempt.current_index,
            attempt.item_count,
            true,
          ),
          completed: false,
          score: null,
          mastery: null,
          generation,
        }),
      );
    }

    const nextIndex = attempt.current_index + 1;
    const nextCorrectCount = attempt.correct_count + (grade.correct ? 1 : 0);
    const nextTargetDifficulty = Math.min(
      5,
      Math.max(1, attempt.target_difficulty + (grade.correct ? 0.5 : -0.5)),
    );
    const completed =
      nextIndex >= attempt.item_count && generation.state === "ready";
    if (completed) {
      const score = Math.round((nextCorrectCount / attempt.item_count) * 100);
      const mastery = await updateMastery(c.env.DB, {
        userId: user.id,
        videoId: attempt.video_id,
        attemptId: attempt.id,
        mode: attempt.mode,
        score,
        timestamp,
      });
      await c.env.DB.batch([
        answerInsert,
        c.env.DB.prepare(
          "UPDATE attempts SET status = 'complete', current_index = ?, current_variant = 0, retry_pending = 0, correct_count = ?, total_answered = total_answered + 1, target_difficulty = ?, score = ?, grading_token = NULL, grading_expires_at = NULL, updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ? AND grading_token = ?",
        ).bind(
          nextIndex,
          nextCorrectCount,
          nextTargetDifficulty,
          score,
          timestamp,
          timestamp,
          attempt.id,
          user.id,
          gradingToken,
        ),
      ]);
      reservationCommitted = true;
      return c.json(
        AttemptAnswerResponseSchema.parse({
          correct: grade.correct,
          explanation: grade.feedback,
          evidenceSegmentIds: parseQuestionEvidence(question),
          nextQuestion: null,
          completed: true,
          score,
          mastery,
          generation: readyGeneration(attempt.item_count),
        }),
      );
    }

    let nextQuestion: QuestionRow | null = null;
    const progressive = Boolean(generationState.snapshot.summary);
    if (progressive && nextIndex < generation.availableQuestions) {
      await reconcileAttemptItems(c.env.DB, attempt.quiz_id);
      nextQuestion = await getAttemptQuestion(c.env.DB, attempt.id, nextIndex);
      if (!nextQuestion) {
        throw new ApiError(
          500,
          "attempt_corrupt",
          "The next quiz question is missing.",
        );
      }
    }

    await c.env.DB.batch([
      answerInsert,
      c.env.DB.prepare(
        "UPDATE attempts SET current_index = ?, current_variant = 0, retry_pending = 0, correct_count = ?, total_answered = total_answered + 1, target_difficulty = ?, grading_token = NULL, grading_expires_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND grading_token = ?",
      ).bind(
        nextIndex,
        nextCorrectCount,
        nextTargetDifficulty,
        timestamp,
        attempt.id,
        user.id,
        gradingToken,
      ),
    ]);
    reservationCommitted = true;

    if (!progressive) {
      await adaptNextQuestion(
        c.env.DB,
        attempt.id,
        nextIndex,
        nextTargetDifficulty,
      );
      nextQuestion = await getAttemptQuestion(c.env.DB, attempt.id, nextIndex);
      if (!nextQuestion) {
        throw new ApiError(
          500,
          "attempt_corrupt",
          "The next quiz question is missing.",
        );
      }
    }

    return c.json(
      AttemptAnswerResponseSchema.parse({
        correct: grade.correct,
        explanation: grade.feedback,
        evidenceSegmentIds: parseQuestionEvidence(question),
        nextQuestion: nextQuestion
          ? toPublicQuestion(nextQuestion, nextIndex, attempt.item_count, false)
          : null,
        completed: false,
        score: null,
        mastery: null,
        generation,
      }),
    );
  } finally {
    if (!reservationCommitted) {
      await releaseAnswerReservation(
        c.env.DB,
        attempt.id,
        user.id,
        gradingToken,
      );
    }
  }
});

quizzesRouter.get("/attempts/:attemptId/resume", async (c) => {
  const user = c.get("user");
  const attempt = await getAttempt(c.env.DB, c.req.param("attemptId"), user.id);
  const generationState = await attemptGenerationState(c.env.DB, attempt);
  const generation = generationState.generation;
  if (attempt.status === "complete") {
    return c.json(
      AttemptResumeResponseSchema.parse({
        attemptId: attempt.id,
        question: null,
        completed: true,
        score: attempt.score,
        mastery: attempt.mastery_state ?? "learning",
        generation: readyGeneration(attempt.item_count),
      }),
    );
  }
  const question =
    attempt.current_index < generation.availableQuestions
      ? await (async () => {
          await reconcileAttemptItems(c.env.DB, attempt.quiz_id);
          return getAttemptQuestion(
            c.env.DB,
            attempt.id,
            attempt.current_index,
          );
        })()
      : null;
  if (!question) {
    if (generation.state === "ready") {
      throw new ApiError(
        500,
        "attempt_corrupt",
        "The current quiz question is missing.",
      );
    }
    return c.json(
      AttemptResumeResponseSchema.parse({
        attemptId: attempt.id,
        question: null,
        completed: false,
        score: null,
        mastery: null,
        generation,
      }),
    );
  }
  return c.json(
    AttemptResumeResponseSchema.parse({
      attemptId: attempt.id,
      question: toPublicQuestion(
        question,
        attempt.current_index,
        attempt.item_count,
        Boolean(attempt.retry_pending),
      ),
      completed: false,
      score: null,
      mastery: null,
      generation,
    }),
  );
});

quizzesRouter.get("/attempts/:attemptId/generation", async (c) => {
  const user = c.get("user");
  const attempt = await getAttempt(c.env.DB, c.req.param("attemptId"), user.id);
  const generationState = await attemptGenerationState(c.env.DB, attempt);
  const generation = generationState.generation;
  const summary = generationState.snapshot.summary;
  return c.json(
    AttemptGenerationResponseSchema.parse({
      attemptId: attempt.id,
      quizId: attempt.quiz_id,
      generation,
      ...(generation.state !== "ready" && summary
        ? {
            continuation: {
              videoId: attempt.video_id,
              quizLanguage: attempt.quiz_language,
              sessionLength: attempt.quiz_session_length,
              questionTypes: summary.requestedQuestionTypes,
              watched: Boolean(attempt.quiz_watched),
              startIndex: summary.acceptedCount,
              acceptedQuestions: summary.acceptedQuestionSummaries,
            },
          }
        : {}),
    }),
  );
});

export function selectVariedQuestions(
  questions: QuestionRow[],
  count: number,
): QuestionRow[] {
  const timeline = [...questions].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  if (count >= timeline.length) return timeline;
  if (count <= 0) return [];
  if (count === 1) return timeline.length ? [timeline[0]!] : [];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (timeline.length - 1)) / (count - 1),
    );
    return timeline[sourceIndex]!;
  });
}

export function selectEligibleQuestions(
  questions: QuestionRow[],
  requestedTypes: QuizQuestionType[],
): QuestionRow[] {
  const allowedTypes = new Set(requestedTypes);
  return questions.filter(
    (question) =>
      question.type !== "ordering" && allowedTypes.has(question.type),
  );
}

function readyGeneration(total: number): AttemptGenerationAvailability {
  return AttemptGenerationAvailabilitySchema.parse({
    state: "ready",
    availableQuestions: total,
    totalQuestions: total,
  });
}

async function attemptGenerationState(
  db: D1Database,
  attempt: AttemptRow,
): Promise<{
  snapshot: ProgressiveGenerationSnapshot;
  generation: AttemptGenerationAvailability;
}> {
  const snapshot = await readProgressiveGenerationSnapshot(db, attempt.quiz_id);
  if (!snapshot.summary || !snapshot.availability) {
    if (
      ![
        LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
        LOCAL_QUIZ_PIPELINE_VERSION,
      ].includes(snapshot.pipelineVersion) ||
      snapshot.qualityStatus !== "passed"
    ) {
      throw new ApiError(
        409,
        "quiz_not_progressive",
        "This generating quiz does not support current progressive delivery.",
      );
    }
    return {
      snapshot,
      generation: readyGeneration(attempt.item_count),
    };
  }
  if (
    snapshot.pipelineVersion !== LOCAL_QUIZ_PIPELINE_VERSION ||
    snapshot.summary.plannedCount !== attempt.item_count
  ) {
    throw new ApiError(
      409,
      "quiz_generation_state_conflict",
      "The attempt and progressive quiz totals do not agree.",
    );
  }
  return { snapshot, generation: snapshot.availability };
}

function requireProgressiveAvailability(
  snapshot: ProgressiveGenerationSnapshot,
): AttemptGenerationAvailability {
  if (
    snapshot.pipelineVersion !== LOCAL_QUIZ_PIPELINE_VERSION ||
    !snapshot.summary ||
    !snapshot.availability
  ) {
    throw new ApiError(
      409,
      "quiz_not_progressive",
      "This quiz does not support current progressive question delivery.",
    );
  }
  return snapshot.availability;
}

async function reconcileAttemptItems(
  db: D1Database,
  quizId: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO attempt_items (attempt_id, ordinal, question_id) SELECT a.id, q.ordinal, q.id FROM attempts a JOIN questions q ON q.quiz_id = a.quiz_id WHERE a.quiz_id = ?",
    )
    .bind(quizId)
    .run();
}

function toPublicQuestion(
  question: QuestionRow,
  zeroBasedPosition: number,
  total: number,
  isRetry: boolean,
): PublicQuestion {
  return PublicQuestionSchema.parse({
    id: question.id,
    type: question.type,
    prompt: isRetry ? question.reformulated_prompt : question.prompt,
    ...(question.options_json
      ? {
          options: parseStoredJson(
            question.options_json,
            z.array(z.string()).min(2),
            "question options",
          ),
        }
      : {}),
    ...(question.items_json
      ? {
          items: parseStoredJson(
            question.items_json,
            z.array(z.string()).min(2),
            "ordering items",
          ),
        }
      : {}),
    difficulty: question.difficulty,
    position: zeroBasedPosition + 1,
    total,
    isRetry,
  });
}

type StoredAttemptStartRow = {
  quiz_id: string;
  start_request_json: string | null;
  start_response_json: string | null;
};

async function findAttemptStartByKey(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
): Promise<StoredAttemptStartRow | null> {
  return db
    .prepare(
      "SELECT quiz_id, start_request_json, start_response_json FROM attempts WHERE user_id = ? AND start_key = ? LIMIT 1",
    )
    .bind(userId, idempotencyKey)
    .first<StoredAttemptStartRow>();
}

async function replayAttemptStart(
  db: D1Database,
  userId: string,
  stored: StoredAttemptStartRow,
  quizId: string,
  startRequestJson: string,
): Promise<QuizStartResponse> {
  if (
    stored.quiz_id !== quizId ||
    stored.start_request_json !== startRequestJson
  ) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used for a different quiz start.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(stored.start_response_json ?? "null");
  } catch {
    throw new ApiError(
      500,
      "stored_json_corrupt",
      "Stored quiz start response is invalid.",
    );
  }
  const current = QuizStartResponseSchema.safeParse(raw);
  const legacy = z
    .object({
      attemptId: z.string().uuid(),
      primer: z.string().nullable(),
      question: PublicQuestionSchema,
    })
    .safeParse(raw);
  const storedResponse = current.success
    ? current.data
    : legacy.success
      ? QuizStartResponseSchema.parse({
          ...legacy.data,
          generation: readyGeneration(legacy.data.question.total),
        })
      : null;
  if (!storedResponse) {
    throw new ApiError(
      500,
      "stored_json_corrupt",
      "Stored quiz start response is invalid.",
    );
  }
  const attempt = await getAttempt(db, storedResponse.attemptId, userId);
  if (attempt.quiz_id !== quizId) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used for a different quiz start.",
    );
  }
  const generationState = await attemptGenerationState(db, attempt);
  return QuizStartResponseSchema.parse({
    ...storedResponse,
    generation: generationState.generation,
  });
}

async function findActiveAttemptId(
  db: D1Database,
  userId: string,
  quizId: string,
  mode: QuizStartRequest["mode"],
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT id FROM attempts WHERE user_id = ? AND quiz_id = ? AND mode = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(userId, quizId, mode)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function reserveAttemptForAnswer(
  db: D1Database,
  attempt: AttemptRow,
  userId: string,
): Promise<string | null> {
  const timestamp = now();
  const gradingToken = createId();
  const reserved = await db
    .prepare(ANSWER_RESERVATION_SQL)
    .bind(
      gradingToken,
      timestamp + ANSWER_RESERVATION_TTL_MS,
      timestamp,
      attempt.id,
      userId,
      attempt.current_index,
      attempt.current_variant,
      attempt.retry_pending,
      timestamp,
    )
    .first<{ id: string }>();
  return reserved ? gradingToken : null;
}

async function releaseAnswerReservation(
  db: D1Database,
  attemptId: string,
  userId: string,
  gradingToken: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE attempts SET grading_token = NULL, grading_expires_at = NULL WHERE id = ? AND user_id = ? AND grading_token = ?",
    )
    .bind(attemptId, userId, gradingToken)
    .run();
}

async function getAttempt(
  db: D1Database,
  attemptId: string,
  userId: string,
): Promise<AttemptRow> {
  const row = await db
    .prepare(
      "SELECT a.id, a.user_id, a.quiz_id, q.video_id, a.mode, a.status, a.current_index, a.current_variant, a.retry_pending, a.target_difficulty, a.correct_count, a.total_answered, a.item_count, a.score, m.state AS mastery_state, q.pipeline_version AS quiz_pipeline_version, q.language AS quiz_language, q.session_length AS quiz_session_length, q.watched AS quiz_watched FROM attempts a JOIN quiz_banks q ON q.id = a.quiz_id AND ((q.pipeline_version = ? AND q.quality_status = 'passed') OR (q.pipeline_version = ? AND q.quality_status IN ('generating', 'passed'))) LEFT JOIN mastery m ON m.user_id = a.user_id AND m.video_id = q.video_id WHERE a.id = ? AND a.user_id = ?",
    )
    .bind(
      LEGACY_LOCAL_QUIZ_PIPELINE_VERSION,
      LOCAL_QUIZ_PIPELINE_VERSION,
      attemptId,
      userId,
    )
    .first();
  const parsed = AttemptRowSchema.safeParse(row);
  if (!parsed.success)
    throw new ApiError(404, "attempt_not_found", "Quiz attempt not found.");
  return parsed.data;
}

async function getAttemptQuestion(
  db: D1Database,
  attemptId: string,
  ordinal: number,
): Promise<QuestionRow | null> {
  const row = await db
    .prepare(
      "SELECT q.id, q.quiz_id, q.ordinal, q.type, q.concept_id, q.prompt, q.reformulated_prompt, q.options_json, q.items_json, q.correct_answer_json, q.rubric_json, q.explanation, q.evidence_segment_ids_json, q.difficulty FROM attempt_items ai JOIN questions q ON q.id = ai.question_id WHERE ai.attempt_id = ? AND ai.ordinal = ?",
    )
    .bind(attemptId, ordinal)
    .first();
  if (!row) return null;
  const parsed = QuestionRowSchema.safeParse(row);
  if (!parsed.success)
    throw new ApiError(
      500,
      "question_corrupt",
      "A quiz question failed integrity checks.",
    );
  return parsed.data;
}

async function gradeAnswer(
  env: ApiBindings["Bindings"],
  attempt: AttemptRow,
  question: QuestionRow,
  answer: z.infer<typeof AnswerValueSchema>,
): Promise<{ correct: boolean; feedback: string }> {
  if (question.type === "short_answer") {
    if (typeof answer !== "string") {
      throw new ApiError(
        422,
        "answer_type_mismatch",
        "Write a short answer for this question.",
      );
    }
    const rubric = parseStoredJson(
      question.rubric_json,
      RubricSchema,
      "short-answer rubric",
    );
    if (attempt.quiz_pipeline_version === LOCAL_QUIZ_PIPELINE_VERSION) {
      return {
        correct: gradeProgressiveShortAnswer({
          answer,
          requiredIdeas: rubric.requiredIdeas,
          acceptableAlternatives: rubric.acceptableAlternatives,
        }),
        feedback: question.explanation,
      };
    }
    const evidenceIds = new Set(parseQuestionEvidence(question));
    let evidence: z.infer<typeof StoredTranscriptSchema>["segments"] = [];
    if (evidenceIds.size > 0) {
      const transcriptObject = await env.PRIVATE_BUCKET.get(
        `transcripts/${attempt.user_id}/${attempt.video_id}/${attempt.quiz_id}.json`,
      );
      if (!transcriptObject)
        throw new ApiError(
          500,
          "transcript_missing",
          "Video evidence is unavailable.",
        );
      const transcript = StoredTranscriptSchema.safeParse(
        await transcriptObject.json(),
      );
      if (!transcript.success)
        throw new ApiError(
          500,
          "transcript_invalid",
          "Video evidence failed integrity checks.",
        );
      evidence = transcript.data.segments.filter((segment) =>
        evidenceIds.has(segment.id),
      );
    }
    return gradeWrittenAnswer(env, {
      prompt: attempt.current_variant
        ? question.reformulated_prompt
        : question.prompt,
      answer,
      requiredIdeas: rubric.requiredIdeas,
      acceptableAlternatives: rubric.acceptableAlternatives,
      evidence,
    });
  }

  const expected = parseStoredJson(
    question.correct_answer_json,
    AnswerValueSchema,
    "correct answer",
  );
  let correct = false;
  if (question.type === "multiple_choice") {
    if (typeof answer !== "number" || typeof expected !== "number") {
      throw new ApiError(
        422,
        "answer_type_mismatch",
        "Choose one answer option.",
      );
    }
    correct = answer === expected;
  } else if (question.type === "true_false") {
    if (typeof answer !== "boolean" || typeof expected !== "boolean") {
      throw new ApiError(422, "answer_type_mismatch", "Choose true or false.");
    }
    correct = answer === expected;
  } else {
    if (!Array.isArray(answer) || !Array.isArray(expected)) {
      throw new ApiError(
        422,
        "answer_type_mismatch",
        "Put every item in order.",
      );
    }
    correct =
      answer.length === expected.length &&
      answer.every((value, index) => value === expected[index]);
  }
  return { correct, feedback: question.explanation };
}

export function parseQuestionEvidence(
  question: Pick<QuestionRow, "evidence_segment_ids_json">,
): string[] {
  return parseStoredJson(
    question.evidence_segment_ids_json,
    z.array(z.string()),
    "question evidence",
  );
}

async function adaptNextQuestion(
  db: D1Database,
  attemptId: string,
  nextIndex: number,
  targetDifficulty: number,
): Promise<void> {
  const candidate = await db
    .prepare(
      "SELECT ai.ordinal FROM attempt_items ai JOIN questions q ON q.id = ai.question_id WHERE ai.attempt_id = ? AND ai.ordinal >= ? ORDER BY ABS(q.difficulty - ?), ai.ordinal LIMIT 1",
    )
    .bind(attemptId, nextIndex, targetDifficulty)
    .first<{ ordinal: number }>();
  if (!candidate || candidate.ordinal === nextIndex) return;
  await db.batch([
    db
      .prepare(
        "UPDATE attempt_items SET ordinal = -1 WHERE attempt_id = ? AND ordinal = ?",
      )
      .bind(attemptId, nextIndex),
    db
      .prepare(
        "UPDATE attempt_items SET ordinal = ? WHERE attempt_id = ? AND ordinal = ?",
      )
      .bind(nextIndex, attemptId, candidate.ordinal),
    db
      .prepare(
        "UPDATE attempt_items SET ordinal = ? WHERE attempt_id = ? AND ordinal = -1",
      )
      .bind(candidate.ordinal, attemptId),
  ]);
}

async function updateMastery(
  db: D1Database,
  input: {
    userId: string;
    videoId: string;
    attemptId: string;
    mode: "learn" | "review";
    score: number;
    timestamp: number;
  },
): Promise<MasteryState> {
  const row = await db
    .prepare(
      "SELECT state, best_score, initial_passed_at, review_passed_at, next_review_at FROM mastery WHERE user_id = ? AND video_id = ?",
    )
    .bind(input.userId, input.videoId)
    .first();
  const parsed = MasteryRowSchema.safeParse(row);
  const current = parsed.success
    ? parsed.data
    : {
        state: "not_started" as const,
        best_score: null,
        initial_passed_at: null,
        review_passed_at: null,
        next_review_at: null,
      };
  const next = calculateMastery(
    {
      state: current.state,
      bestScore: current.best_score,
      initialPassedAt: current.initial_passed_at,
      reviewPassedAt: current.review_passed_at,
      nextReviewAt: current.next_review_at,
    },
    input,
  );
  const statements = [
    db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, best_score, initial_passed_at, review_passed_at, next_review_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, video_id) DO UPDATE SET state = excluded.state, best_score = excluded.best_score, initial_passed_at = excluded.initial_passed_at, review_passed_at = excluded.review_passed_at, next_review_at = excluded.next_review_at, updated_at = excluded.updated_at",
      )
      .bind(
        input.userId,
        input.videoId,
        next.state,
        next.bestScore,
        next.initialPassedAt,
        next.reviewPassedAt,
        next.nextReviewAt,
        input.timestamp,
      ),
    db
      .prepare(
        "UPDATE reviews SET completed_at = ? WHERE user_id = ? AND video_id = ? AND completed_at IS NULL",
      )
      .bind(input.timestamp, input.userId, input.videoId),
  ];
  if (next.nextReviewAt) {
    statements.push(
      db
        .prepare(
          "INSERT INTO reviews (id, user_id, video_id, attempt_id, score, scheduled_for, completed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
        )
        .bind(
          createId(),
          input.userId,
          input.videoId,
          input.attemptId,
          input.score,
          next.nextReviewAt,
        ),
    );
  }
  await db.batch(statements);
  return MasteryStateSchema.parse(next.state);
}
