import {
  LOCAL_QUIZ_PIPELINE_VERSION,
  MasteryStateSchema,
  WorkplaceMessagePartSchema,
  WorkplaceMessageRoleSchema,
  WorkplaceMessageSyncRequestSchema,
  WorkplaceMessageSyncResponseSchema,
  WorkplaceMessagesRequestSchema,
  WorkplaceMessagesResponseSchema,
  WorkplacePracticeSetImportRequestSchema,
  WorkplacePracticeSetImportResponseSchema,
  WorkplaceSuggestionsResponseSchema,
  WorkplaceThreadCreateRequestSchema,
  WorkplaceThreadDeleteResponseSchema,
  WorkplaceThreadListResponseSchema,
  WorkplaceThreadRenameRequestSchema,
  WorkplaceThreadResponseSchema,
  type LocalConceptQuizQuestion,
  type WorkplaceMessage,
  type WorkplaceMessagePart,
  type WorkplaceMessageRole,
  type WorkplacePracticeSet,
  type WorkplaceThreadSummary,
} from "@clipquest/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../lib/errors";
import { createId, now } from "../lib/ids";
import { requireIdempotencyKey } from "../lib/idempotency";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson, parseStoredJson } from "../lib/validation";
import {
  selectWorkplaceSuggestions,
  type WorkplaceSuggestionCandidate,
} from "../lib/workplace-suggestions";
import type { ApiBindings } from "../middleware/authenticated";
import { storedQuestionFields, structuralDifficulty } from "./quiz-imports";

export const workplaceRouter = new Hono<ApiBindings>();

const THREAD_CREATE_LIMIT_PER_MINUTE = 20;
const THREAD_MUTATION_LIMIT_PER_MINUTE = 30;
const MESSAGE_APPEND_LIMIT_PER_MINUTE = 60;
const PRACTICE_IMPORT_LIMIT_PER_MINUTE = 10;
const DEFAULT_THREAD_TITLE = "New Workplace thread";

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const WorkplaceSuggestionRowSchema = z.object({
  video_id: z.string().uuid(),
  title: z.string(),
  video_updated_at: z.number().int().nonnegative(),
  mastery_state: MasteryStateSchema,
  best_score: z.number().nullable(),
  next_review_at: z.number().int().nonnegative().nullable(),
  quiz_id: z.string().uuid().nullable(),
});

export const WORKPLACE_SUGGESTION_CANDIDATES_SQL = `
  SELECT
    v.id AS video_id,
    v.title AS title,
    v.updated_at AS video_updated_at,
    COALESCE(m.state, 'not_started') AS mastery_state,
    m.best_score AS best_score,
    m.next_review_at AS next_review_at,
    qb.id AS quiz_id
  FROM videos v
  LEFT JOIN mastery m ON m.user_id = v.owner_id AND m.video_id = v.id
  LEFT JOIN quiz_banks qb ON qb.id = (
    SELECT candidate.id FROM quiz_banks candidate
    WHERE candidate.video_id = v.id AND candidate.user_id = v.owner_id
      AND candidate.pipeline_version = ? AND candidate.quality_status = 'passed'
    ORDER BY candidate.created_at DESC LIMIT 1
  )
  WHERE v.owner_id = ? AND v.source = 'youtube'
  ORDER BY v.updated_at DESC
  LIMIT 250`;

workplaceRouter.get("/suggestions", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(WORKPLACE_SUGGESTION_CANDIDATES_SQL)
    .bind(LOCAL_QUIZ_PIPELINE_VERSION, user.id)
    .all();
  const parsed = z
    .array(WorkplaceSuggestionRowSchema)
    .safeParse(result.results);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        scope: "workplace",
        event: "invalid_suggestion_rows",
        issueCount: parsed.error.issues.length,
      }),
    );
  }
  const candidates: WorkplaceSuggestionCandidate[] = (
    parsed.success ? parsed.data : []
  ).map((row) => ({
    videoId: row.video_id,
    title: row.title,
    quizId: row.quiz_id,
    masteryState: row.mastery_state,
    bestScore: row.best_score,
    nextReviewAt: row.next_review_at,
    updatedAt: row.video_updated_at,
  }));
  const suggestions = selectWorkplaceSuggestions(candidates, now());
  if (!suggestions) {
    throw new ApiError(
      404,
      "workplace_suggestions_unavailable",
      "Add a video to your library to get personalized suggestions.",
    );
  }
  return c.json(WorkplaceSuggestionsResponseSchema.parse({ suggestions }));
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

const WorkplaceThreadRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  message_count: z.number().int().nonnegative(),
  last_message_at: z.number().int().nonnegative().nullable(),
  created_at: z.number().int().nonnegative(),
  updated_at: z.number().int().nonnegative(),
});

function rowToThreadSummary(
  row: z.infer<typeof WorkplaceThreadRowSchema>,
): WorkplaceThreadSummary {
  return {
    id: row.id,
    title: row.title,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOwnedThread(
  db: D1Database,
  threadId: string,
  userId: string,
): Promise<WorkplaceThreadSummary> {
  const row = await db
    .prepare(
      `SELECT id, title, message_count, last_message_at, created_at, updated_at
       FROM workplace_threads WHERE id = ? AND user_id = ?`,
    )
    .bind(threadId, userId)
    .first();
  const parsed = WorkplaceThreadRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new ApiError(
      404,
      "workplace_thread_not_found",
      "This Workplace thread was not found.",
    );
  }
  return rowToThreadSummary(parsed.data);
}

workplaceRouter.post("/threads", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "workplace-thread-create",
    identifier: user.id,
    maximum: THREAD_CREATE_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  const input = await parseJson(c, WorkplaceThreadCreateRequestSchema);
  const timestamp = now();
  const id = createId();
  const title = input.title?.trim() || DEFAULT_THREAD_TITLE;
  await c.env.DB.prepare(
    `INSERT INTO workplace_threads (id, user_id, title, message_count, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, NULL, ?, ?)`,
  )
    .bind(id, user.id, title, timestamp, timestamp)
    .run();
  return c.json(
    WorkplaceThreadResponseSchema.parse({
      thread: {
        id,
        title,
        messageCount: 0,
        lastMessageAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }),
    201,
  );
});

workplaceRouter.get("/threads", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    `SELECT id, title, message_count, last_message_at, created_at, updated_at
     FROM workplace_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(user.id)
    .all();
  const parsed = z.array(WorkplaceThreadRowSchema).safeParse(result.results);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        scope: "workplace",
        event: "invalid_thread_rows",
        issueCount: parsed.error.issues.length,
      }),
    );
  }
  const threads = (parsed.success ? parsed.data : []).map(rowToThreadSummary);
  return c.json(WorkplaceThreadListResponseSchema.parse({ threads }));
});

workplaceRouter.get("/threads/:threadId", async (c) => {
  const user = c.get("user");
  const thread = await getOwnedThread(
    c.env.DB,
    c.req.param("threadId"),
    user.id,
  );
  return c.json(WorkplaceThreadResponseSchema.parse({ thread }));
});

workplaceRouter.patch("/threads/:threadId", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "workplace-thread-rename",
    identifier: user.id,
    maximum: THREAD_MUTATION_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  const input = await parseJson(c, WorkplaceThreadRenameRequestSchema);
  const threadId = c.req.param("threadId");
  const timestamp = now();
  const result = await c.env.DB.prepare(
    `UPDATE workplace_threads SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(input.title.trim(), timestamp, threadId, user.id)
    .run();
  if (result.meta.changes === 0) {
    throw new ApiError(
      404,
      "workplace_thread_not_found",
      "This Workplace thread was not found.",
    );
  }
  const thread = await getOwnedThread(c.env.DB, threadId, user.id);
  return c.json(WorkplaceThreadResponseSchema.parse({ thread }));
});

workplaceRouter.delete("/threads/:threadId", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "workplace-thread-delete",
    identifier: user.id,
    maximum: THREAD_MUTATION_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  const threadId = c.req.param("threadId");
  const result = await c.env.DB.prepare(
    `DELETE FROM workplace_threads WHERE id = ? AND user_id = ?`,
  )
    .bind(threadId, user.id)
    .run();
  if (result.meta.changes === 0) {
    throw new ApiError(
      404,
      "workplace_thread_not_found",
      "This Workplace thread was not found.",
    );
  }
  return c.json(WorkplaceThreadDeleteResponseSchema.parse({ deleted: true }));
});

// ---------------------------------------------------------------------------
// Messages: cursor-paginated reads and idempotent appends
// ---------------------------------------------------------------------------

const WorkplaceMessageRowSchema = z.object({
  id: z.string().uuid(),
  ordinal: z.number().int().nonnegative(),
  client_message_id: z.string(),
  role: WorkplaceMessageRoleSchema,
  parts_json: z.string(),
  created_at: z.number().int().nonnegative(),
});

function rowToMessage(
  threadId: string,
  row: z.infer<typeof WorkplaceMessageRowSchema>,
): WorkplaceMessage {
  const parts = parseStoredJson(
    row.parts_json,
    z.array(WorkplaceMessagePartSchema).min(1).max(20),
    "Workplace message parts",
  );
  return {
    id: row.id,
    threadId,
    clientMessageId: row.client_message_id,
    role: row.role,
    parts,
    createdAt: row.created_at,
  };
}

export function encodeWorkplaceMessagesCursor(ordinal: number): string {
  return String(ordinal);
}

export function decodeWorkplaceMessagesCursor(cursor: string): number {
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
    throw new ApiError(
      422,
      "invalid_cursor",
      "The pagination cursor is invalid.",
    );
  }
  return Number(cursor);
}

workplaceRouter.get("/threads/:threadId/messages", async (c) => {
  const user = c.get("user");
  const threadId = c.req.param("threadId");
  await getOwnedThread(c.env.DB, threadId, user.id);

  const rawLimit = c.req.query("limit");
  const parsedInput = WorkplaceMessagesRequestSchema.safeParse({
    threadId,
    cursor: c.req.query("cursor"),
    limit: rawLimit === undefined ? undefined : Number(rawLimit),
  });
  if (!parsedInput.success) {
    throw new ApiError(
      422,
      "invalid_request",
      "Some request fields are invalid.",
      parsedInput.error.flatten(),
    );
  }
  const input = parsedInput.data;
  const beforeOrdinal = input.cursor
    ? decodeWorkplaceMessagesCursor(input.cursor)
    : null;

  const result = await c.env.DB.prepare(
    `SELECT id, ordinal, client_message_id, role, parts_json, created_at
     FROM workplace_messages
     WHERE thread_id = ? AND (? IS NULL OR ordinal < ?)
     ORDER BY ordinal DESC
     LIMIT ?`,
  )
    .bind(threadId, beforeOrdinal, beforeOrdinal, input.limit + 1)
    .all();
  const parsedRows = z
    .array(WorkplaceMessageRowSchema)
    .safeParse(result.results);
  if (!parsedRows.success) {
    throw new ApiError(
      500,
      "corrupt_data",
      "Workplace messages could not be read.",
    );
  }
  const hasMore = parsedRows.data.length > input.limit;
  const page = hasMore
    ? parsedRows.data.slice(0, input.limit)
    : parsedRows.data;
  const nextCursor = hasMore
    ? encodeWorkplaceMessagesCursor(page[page.length - 1]!.ordinal)
    : null;
  const messages = [...page]
    .reverse()
    .map((row) => rowToMessage(threadId, row));
  return c.json(
    WorkplaceMessagesResponseSchema.parse({ messages, nextCursor }),
  );
});

// A citation, tool-status citation, or practice-set video/citation embedded
// in a message can only ever point at videos the sender owns -- collected
// once here so the route can verify every reference in a single query
// before anything is persisted.
export function collectReferencedVideoIds(
  parts: readonly WorkplaceMessagePart[],
): string[] {
  const ids = new Set<string>();
  for (const part of parts) {
    if (part.type === "citation") {
      ids.add(part.citation.videoId);
    } else if (part.type === "tool_status") {
      for (const citation of part.tool.citations) ids.add(citation.videoId);
    } else if (part.type === "practice_set") {
      for (const videoId of part.practiceSet.videoIds) ids.add(videoId);
      for (const citation of part.practiceSet.citations) {
        ids.add(citation.videoId);
      }
    }
  }
  return [...ids];
}

export async function assertOwnedVideos(
  db: D1Database,
  userId: string,
  videoIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(videoIds)];
  if (unique.length === 0) return;
  const placeholders = unique.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM videos WHERE owner_id = ? AND id IN (${placeholders})`,
    )
    .bind(userId, ...unique)
    .first<{ count: number }>();
  if (!result || result.count !== unique.length) {
    throw new ApiError(
      404,
      "workplace_video_not_found",
      "One or more referenced videos could not be found.",
    );
  }
}

// A single INSERT ... SELECT ... WHERE NOT EXISTS statement: the new
// message's ordinal is computed as one past the thread's current maximum,
// and the insert is a no-op (0 rows, nothing RETURNING) whenever this
// `client_message_id` has already been stored for the thread. Combined with
// the `UNIQUE(thread_id, ordinal)` and `UNIQUE(thread_id, client_message_id)`
// constraints from migration 0025, this keeps a retried append from ever
// creating a duplicate row or skipping an ordinal, without needing an
// explicit multi-round-trip transaction that D1 does not support.
export const WORKPLACE_MESSAGE_INSERT_SQL = `
  INSERT INTO workplace_messages (id, thread_id, user_id, ordinal, client_message_id, role, parts_json, created_at)
  SELECT ?, ?, ?, COALESCE((SELECT MAX(ordinal) FROM workplace_messages WHERE thread_id = ?), -1) + 1, ?, ?, ?, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM workplace_messages WHERE thread_id = ? AND client_message_id = ?
  )
  RETURNING id, ordinal, created_at`;

// Recomputed from `workplace_messages` on every append (rather than
// incremented) so a no-op idempotent replay never double-counts: running
// this statement any number of times for the same thread always converges
// on the same, correct `message_count`/`last_message_at`.
export const WORKPLACE_THREAD_STATS_UPDATE_SQL = `
  UPDATE workplace_threads
  SET message_count = (SELECT COUNT(*) FROM workplace_messages WHERE thread_id = ?),
      last_message_at = (SELECT MAX(created_at) FROM workplace_messages WHERE thread_id = ?),
      updated_at = ?
  WHERE id = ? AND user_id = ?`;

export async function appendWorkplaceMessage(
  db: D1Database,
  input: {
    threadId: string;
    userId: string;
    clientMessageId: string;
    role: WorkplaceMessageRole;
    parts: WorkplaceMessagePart[];
  },
): Promise<{ message: WorkplaceMessage; created: boolean }> {
  const timestamp = now();
  const messageId = createId();
  const partsJson = JSON.stringify(input.parts);
  const results = await db.batch([
    db
      .prepare(WORKPLACE_MESSAGE_INSERT_SQL)
      .bind(
        messageId,
        input.threadId,
        input.userId,
        input.threadId,
        input.clientMessageId,
        input.role,
        partsJson,
        timestamp,
        input.threadId,
        input.clientMessageId,
      ),
    db
      .prepare(WORKPLACE_THREAD_STATS_UPDATE_SQL)
      .bind(
        input.threadId,
        input.threadId,
        timestamp,
        input.threadId,
        input.userId,
      ),
  ]);
  const insertedRows = (results[0]?.results ?? []) as {
    id: string;
    ordinal: number;
    created_at: number;
  }[];
  const inserted = insertedRows[0];
  if (inserted) {
    return {
      created: true,
      message: {
        id: inserted.id,
        threadId: input.threadId,
        clientMessageId: input.clientMessageId,
        role: input.role,
        parts: input.parts,
        createdAt: inserted.created_at,
      },
    };
  }

  // Idempotent replay: another request already stored this
  // `client_message_id` for this thread. Return the stored message rather
  // than creating a duplicate, but fail loudly if the same ID was somehow
  // reused for genuinely different content.
  const existing = await db
    .prepare(
      `SELECT id, role, parts_json, created_at FROM workplace_messages WHERE thread_id = ? AND client_message_id = ?`,
    )
    .bind(input.threadId, input.clientMessageId)
    .first<{
      id: string;
      role: WorkplaceMessageRole;
      parts_json: string;
      created_at: number;
    }>();
  if (!existing) {
    throw new ApiError(
      500,
      "workplace_message_append_failed",
      "The message could not be stored.",
    );
  }
  const existingParts = parseStoredJson(
    existing.parts_json,
    z.array(WorkplaceMessagePartSchema).min(1).max(20),
    "Workplace message parts",
  );
  if (
    existing.role !== input.role ||
    JSON.stringify(existingParts) !== partsJson
  ) {
    throw new ApiError(
      409,
      "client_message_id_reused",
      "This client message ID was already used for a different message.",
    );
  }
  return {
    created: false,
    message: {
      id: existing.id,
      threadId: input.threadId,
      clientMessageId: input.clientMessageId,
      role: existing.role,
      parts: existingParts,
      createdAt: existing.created_at,
    },
  };
}

workplaceRouter.post("/threads/:threadId/messages", async (c) => {
  const user = c.get("user");
  await enforceRateLimit(c.env.DB, {
    namespace: "workplace-message-append",
    identifier: user.id,
    maximum: MESSAGE_APPEND_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  const threadId = c.req.param("threadId");
  await getOwnedThread(c.env.DB, threadId, user.id);
  const input = await parseJson(c, WorkplaceMessageSyncRequestSchema);
  if (input.threadId !== threadId) {
    throw new ApiError(
      422,
      "workplace_thread_id_mismatch",
      "The message thread does not match the URL.",
    );
  }
  const referencedVideoIds = collectReferencedVideoIds(input.parts);
  if (referencedVideoIds.length > 0) {
    await assertOwnedVideos(c.env.DB, user.id, referencedVideoIds);
  }
  const { message, created } = await appendWorkplaceMessage(c.env.DB, {
    threadId,
    userId: user.id,
    clientMessageId: input.clientMessageId,
    role: input.role,
    parts: input.parts,
  });
  return c.json(
    WorkplaceMessageSyncResponseSchema.parse({ message }),
    created ? 201 : 200,
  );
});

// ---------------------------------------------------------------------------
// Practice-set import: reuses the same quiz_banks/questions persistence
// conventions as the extension quiz importer (see quiz-imports.ts), tagged
// with the Workplace origin/thread link/mastery-eligibility metadata added
// by migration 0025.
// ---------------------------------------------------------------------------

function workplaceQuestionInsert(
  db: D1Database,
  quizId: string,
  question: LocalConceptQuizQuestion,
  ordinal: number,
  threadId: string,
): D1PreparedStatement {
  const stored = storedQuestionFields(question);
  const difficulty = structuralDifficulty(question);
  const reformulatedPrompt = question.retryQuestion ?? question.question;
  return db
    .prepare(
      `INSERT INTO questions
       (id, quiz_id, ordinal, source_question_id, type, concept_id, prompt, reformulated_prompt, options_json, items_json, correct_answer_json, rubric_json, explanation, evidence_segment_ids_json, difficulty, generation_metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', ?, ?)`,
    )
    .bind(
      createId(),
      quizId,
      ordinal,
      question.id,
      question.type,
      question.id,
      question.question,
      reformulatedPrompt,
      stored.optionsJson,
      stored.correctAnswerJson,
      stored.rubricJson,
      stored.explanation,
      difficulty,
      JSON.stringify({
        source: "workplace-practice-import",
        workplaceThreadId: threadId,
        concept: question.concept,
        questionType: question.type,
        structuralDifficulty: difficulty,
        schemaValidated: true,
        transcriptStored: false,
      }),
    );
}

async function findWorkplaceQuizByImportKey(
  db: D1Database,
  userId: string,
  importKey: string,
): Promise<{ id: string; affectsMastery: boolean } | null> {
  const bank = await db
    .prepare(
      `SELECT id, affects_mastery FROM quiz_banks WHERE user_id = ? AND import_key = ? AND origin = 'workplace'`,
    )
    .bind(userId, importKey)
    .first<{ id: string; affects_mastery: number }>();
  return bank
    ? { id: bank.id, affectsMastery: bank.affects_mastery === 1 }
    : null;
}

async function persistWorkplacePracticeSet(input: {
  db: D1Database;
  quizId: string;
  userId: string;
  threadId: string;
  importKey: string;
  language: string;
  videoId: string;
  affectsMastery: boolean;
  practiceSet: WorkplacePracticeSet;
}): Promise<void> {
  const timestamp = now();
  const questions = input.practiceSet.questions;
  const summary = {
    source: "workplace-practice-import",
    requestedPolicy: input.practiceSet.requestedPolicy,
    effectivePolicy: input.practiceSet.effectivePolicy,
    rationale: input.practiceSet.rationale,
    transcriptComplete: input.practiceSet.transcriptComplete,
    videoIds: input.practiceSet.videoIds,
    citationCount: input.practiceSet.citations.length,
    plannedCount: questions.length,
    passedCount: questions.length,
    transcriptStored: false,
  };
  const statements = [
    input.db
      .prepare(
        `INSERT INTO quiz_banks
         (id, user_id, video_id, language, session_length, primer, concepts_json, watched,
          pipeline_version, quality_status, quality_summary_json, import_key,
          origin, affects_mastery, workplace_thread_id, assessment_rationale, created_at)
         VALUES (?, ?, ?, ?, 'short', ?, ?, 1, ?, 'passed', ?, ?, 'workplace', ?, ?, ?, ?)`,
      )
      .bind(
        input.quizId,
        input.userId,
        input.videoId,
        input.language,
        input.practiceSet.rationale.slice(0, 500),
        JSON.stringify(
          questions.map((question) => ({
            id: question.id,
            title: question.concept,
            summary: question.concept,
            evidenceSegmentIds: [],
          })),
        ),
        LOCAL_QUIZ_PIPELINE_VERSION,
        JSON.stringify(summary),
        input.importKey,
        input.affectsMastery ? 1 : 0,
        input.threadId,
        input.practiceSet.rationale,
        timestamp,
      ),
    ...questions.map((question, ordinal) =>
      workplaceQuestionInsert(
        input.db,
        input.quizId,
        question,
        ordinal,
        input.threadId,
      ),
    ),
    input.db
      .prepare(
        "INSERT INTO mastery (user_id, video_id, state, updated_at) VALUES (?, ?, 'not_started', ?) ON CONFLICT(user_id, video_id) DO NOTHING",
      )
      .bind(input.userId, input.videoId, timestamp),
  ];

  const results = await input.db.batch(statements);
  const questionResults = results.slice(1, 1 + questions.length);
  if (
    results.length !== statements.length ||
    results[0]?.meta.changes !== 1 ||
    questionResults.some((result) => result.meta.changes !== 1)
  ) {
    throw new ApiError(
      409,
      "workplace_practice_import_rejected",
      "The practice set could not be stored atomically.",
    );
  }
}

workplaceRouter.post("/practice-imports", async (c) => {
  const user = c.get("user");
  const importKey = requireIdempotencyKey(c);
  await enforceRateLimit(c.env.DB, {
    namespace: "workplace-practice-import",
    identifier: user.id,
    maximum: PRACTICE_IMPORT_LIMIT_PER_MINUTE,
    windowSeconds: 60,
  });
  const input = await parseJson(c, WorkplacePracticeSetImportRequestSchema);
  await getOwnedThread(c.env.DB, input.threadId, user.id);
  await assertOwnedVideos(c.env.DB, user.id, input.practiceSet.videoIds);

  const anchorVideoId = input.practiceSet.videoIds[0]!;
  // Mastery is tracked per single video (see `mastery`'s primary key), so a
  // practice set spanning multiple videos can never be an eligible
  // diagnostic for mastery purposes even when the model requested one; the
  // later "workplace-practice" todo enforces this against attempts too.
  const affectsMastery =
    input.practiceSet.effectivePolicy === "diagnostic" &&
    input.practiceSet.videoIds.length === 1;
  const clientMessageId = `workplace-practice-import:${importKey}`;

  const existingRecord = await findWorkplaceQuizByImportKey(
    c.env.DB,
    user.id,
    importKey,
  );
  let quizRecord = existingRecord;
  if (!quizRecord) {
    const anchorVideo = await c.env.DB.prepare(
      "SELECT source_language FROM videos WHERE id = ? AND owner_id = ?",
    )
      .bind(anchorVideoId, user.id)
      .first<{ source_language: string | null }>();
    const quizId = createId();
    try {
      await persistWorkplacePracticeSet({
        db: c.env.DB,
        quizId,
        userId: user.id,
        threadId: input.threadId,
        importKey,
        language: anchorVideo?.source_language ?? "en",
        videoId: anchorVideoId,
        affectsMastery,
        practiceSet: input.practiceSet,
      });
      quizRecord = { id: quizId, affectsMastery };
    } catch (error) {
      const raced = await findWorkplaceQuizByImportKey(
        c.env.DB,
        user.id,
        importKey,
      );
      if (!raced) throw error;
      quizRecord = raced;
    }
  }

  const { message } = await appendWorkplaceMessage(c.env.DB, {
    threadId: input.threadId,
    userId: user.id,
    clientMessageId,
    role: "assistant",
    parts: [{ type: "practice_set", practiceSet: input.practiceSet }],
  });

  return c.json(
    WorkplacePracticeSetImportResponseSchema.parse({
      quizId: quizRecord.id,
      messageId: message.id,
      affectsMastery: quizRecord.affectsMastery,
    }),
    existingRecord ? 200 : 201,
  );
});
