import {
  AnswerValueSchema,
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
  type PublicQuestion,
  type QuizQuestionType,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { gradeWrittenAnswer } from "../lib/ai-services";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { calculateMastery } from "../lib/mastery";
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
  transcript_key: z.string().nullable(),
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

export const quizzesRouter = new Hono<ApiBindings>();

quizzesRouter.post("/quizzes/:quizId/start", async (c) => {
  const user = c.get("user");
  const input = await parseJson(c, QuizStartRequestSchema);
  const quiz = await c.env.DB.prepare(
    "SELECT id, video_id, primer, watched FROM quiz_banks WHERE id = ? AND user_id = ? AND pipeline_version = ? AND quality_status = 'passed'",
  )
    .bind(c.req.param("quizId"), user.id, LOCAL_QUIZ_PIPELINE_VERSION)
    .first<{ id: string; video_id: string; primer: string; watched: number }>();
  if (!quiz) throw new ApiError(404, "quiz_not_found", "Quiz not found.");

  if (input.mode === "review") {
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

  const questionResult = await c.env.DB.prepare(
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

  const eligibleQuestions = selectEligibleQuestions(
    questions.data,
    input.questionTypes,
  );
  const desired = questionLimitForSession(input.sessionLength);
  const selected = selectVariedQuestions(
    eligibleQuestions,
    Math.min(desired, eligibleQuestions.length),
  );
  const firstQuestion = selected.at(0);
  if (!firstQuestion)
    throw new ApiError(500, "quiz_empty", "This quiz has no valid questions.");
  const attemptId = createId();
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO attempts (id, user_id, quiz_id, mode, status, current_index, current_variant, retry_pending, target_difficulty, correct_count, total_answered, item_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 0, 0, 0, 2, 0, 0, ?, ?, ?)",
    ).bind(
      attemptId,
      user.id,
      quiz.id,
      input.mode,
      selected.length,
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

  return c.json(
    QuizStartResponseSchema.parse({
      attemptId,
      primer: (input.watched ?? Boolean(quiz.watched)) ? null : quiz.primer,
      question: toPublicQuestion(firstQuestion, 0, selected.length, false),
    }),
    201,
  );
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

  const grade = await gradeAnswer(c.env, attempt, question, input.answer);
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
        "UPDATE attempts SET retry_pending = 1, current_variant = 1, total_answered = total_answered + 1, target_difficulty = MAX(1, target_difficulty - 0.5), updated_at = ? WHERE id = ? AND user_id = ?",
      ).bind(timestamp, attempt.id, user.id),
    ]);
    return c.json(
      AttemptAnswerResponseSchema.parse({
        correct: false,
        explanation: grade.feedback,
        evidenceSegmentIds: parseEvidence(question),
        nextQuestion: toPublicQuestion(
          question,
          attempt.current_index,
          attempt.item_count,
          true,
        ),
        completed: false,
        score: null,
        mastery: null,
      }),
    );
  }

  const nextIndex = attempt.current_index + 1;
  const nextCorrectCount = attempt.correct_count + (grade.correct ? 1 : 0);
  const nextTargetDifficulty = Math.min(
    5,
    Math.max(1, attempt.target_difficulty + (grade.correct ? 0.5 : -0.5)),
  );
  const completed = nextIndex >= attempt.item_count;
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
        "UPDATE attempts SET status = 'complete', current_index = ?, current_variant = 0, retry_pending = 0, correct_count = ?, total_answered = total_answered + 1, target_difficulty = ?, score = ?, updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ?",
      ).bind(
        nextIndex,
        nextCorrectCount,
        nextTargetDifficulty,
        score,
        timestamp,
        timestamp,
        attempt.id,
        user.id,
      ),
    ]);
    return c.json(
      AttemptAnswerResponseSchema.parse({
        correct: grade.correct,
        explanation: grade.feedback,
        evidenceSegmentIds: parseEvidence(question),
        nextQuestion: null,
        completed: true,
        score,
        mastery,
      }),
    );
  }

  await c.env.DB.batch([
    answerInsert,
    c.env.DB.prepare(
      "UPDATE attempts SET current_index = ?, current_variant = 0, retry_pending = 0, correct_count = ?, total_answered = total_answered + 1, target_difficulty = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    ).bind(
      nextIndex,
      nextCorrectCount,
      nextTargetDifficulty,
      timestamp,
      attempt.id,
      user.id,
    ),
  ]);
  await adaptNextQuestion(
    c.env.DB,
    attempt.id,
    nextIndex,
    nextTargetDifficulty,
  );
  const nextQuestion = await getAttemptQuestion(
    c.env.DB,
    attempt.id,
    nextIndex,
  );
  if (!nextQuestion)
    throw new ApiError(
      500,
      "attempt_corrupt",
      "The next quiz question is missing.",
    );
  return c.json(
    AttemptAnswerResponseSchema.parse({
      correct: grade.correct,
      explanation: grade.feedback,
      evidenceSegmentIds: parseEvidence(question),
      nextQuestion: toPublicQuestion(
        nextQuestion,
        nextIndex,
        attempt.item_count,
        false,
      ),
      completed: false,
      score: null,
      mastery: null,
    }),
  );
});

quizzesRouter.get("/attempts/:attemptId/resume", async (c) => {
  const user = c.get("user");
  const attempt = await getAttempt(c.env.DB, c.req.param("attemptId"), user.id);
  if (attempt.status === "complete") {
    return c.json(
      AttemptResumeResponseSchema.parse({
        attemptId: attempt.id,
        question: null,
        completed: true,
        score: attempt.score,
        mastery: attempt.mastery_state ?? "learning",
      }),
    );
  }
  const question = await getAttemptQuestion(
    c.env.DB,
    attempt.id,
    attempt.current_index,
  );
  if (!question)
    throw new ApiError(
      500,
      "attempt_corrupt",
      "The current quiz question is missing.",
    );
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

async function getAttempt(
  db: D1Database,
  attemptId: string,
  userId: string,
): Promise<AttemptRow> {
  const row = await db
    .prepare(
      "SELECT a.id, a.user_id, a.quiz_id, q.video_id, a.mode, a.status, a.current_index, a.current_variant, a.retry_pending, a.target_difficulty, a.correct_count, a.total_answered, a.item_count, a.score, m.state AS mastery_state, (SELECT gj.transcript_key FROM generation_jobs gj WHERE gj.quiz_id = a.quiz_id ORDER BY gj.updated_at DESC LIMIT 1) AS transcript_key FROM attempts a JOIN quiz_banks q ON q.id = a.quiz_id AND q.pipeline_version = ? AND q.quality_status = 'passed' LEFT JOIN mastery m ON m.user_id = a.user_id AND m.video_id = q.video_id WHERE a.id = ? AND a.user_id = ?",
    )
    .bind(LOCAL_QUIZ_PIPELINE_VERSION, attemptId, userId)
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
    const transcriptObject = await env.PRIVATE_BUCKET.get(
      attempt.transcript_key ??
        `transcripts/${attempt.user_id}/${attempt.video_id}.json`,
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
    const evidenceIds = new Set(parseEvidence(question));
    return gradeWrittenAnswer(env, {
      prompt: attempt.current_variant
        ? question.reformulated_prompt
        : question.prompt,
      answer,
      requiredIdeas: rubric.requiredIdeas,
      acceptableAlternatives: rubric.acceptableAlternatives,
      evidence: transcript.data.segments.filter((segment) =>
        evidenceIds.has(segment.id),
      ),
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

function parseEvidence(question: QuestionRow): string[] {
  return parseStoredJson(
    question.evidence_segment_ids_json,
    z.array(z.string()).min(1),
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
