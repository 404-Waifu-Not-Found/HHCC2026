import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import { quizzesRouter } from "../src/routes/quizzes";

const USER_ID = "user-1";
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const QUIZ_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const QUESTION_ONE_ID = "55555555-5555-4555-8555-555555555555";
const QUESTION_TWO_ID = "66666666-6666-4666-8666-666666666666";

type BatchResult = { success: true; meta: { changes: number } };

class SqliteD1Statement {
  constructor(
    private readonly adapter: SqliteD1Adapter,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.adapter, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    this.adapter.beforeFirst?.(this.sql);
    return (
      (this.statement().get(
        ...(this.params as Parameters<StatementSync["get"]>),
      ) as T | undefined) ?? null
    );
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    return {
      results: this.statement().all(
        ...(this.params as Parameters<StatementSync["all"]>),
      ) as T[],
      success: true,
    };
  }

  async run(): Promise<BatchResult> {
    return this.runSync();
  }

  runSync(): BatchResult {
    const result = this.statement().run(
      ...(this.params as Parameters<StatementSync["run"]>),
    );
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  private statement(): StatementSync {
    return this.adapter.sqlite.prepare(this.sql);
  }
}

class SqliteD1Adapter {
  beforeFirst: ((sql: string) => void) | undefined;

  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements: SqliteD1Statement[]): Promise<BatchResult[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function progressiveSummary(count: 1 | 2) {
  const summaries = [
    {
      id: "q1",
      type: "multiple_choice",
      concept: "Limits",
      question: "Which value is the limit?",
    },
    {
      id: "q2",
      type: "true_false",
      concept: "Continuity",
      question: "A continuous function has no jump at this point.",
    },
  ] as const;
  return {
    source: "extension-local-json-stream",
    importVersion: "extension-progressive-import-v3",
    pipelineVersion: 9,
    model: "deepseek-v4-flash",
    reasoningEffort: "high",
    promptVersion: "quiz-local-json-stream-v5.0",
    validatorVersion: "validator-local-progressive-v4.0",
    generationState: "generating",
    requestedQuestionTypes: ["multiple_choice", "true_false", "short_answer"],
    generatedQuestionTypes: summaries
      .slice(0, count)
      .map((question) => question.type),
    plannedCount: 5,
    acceptedCount: count,
    lastProgressAt: Date.now(),
    acceptedQuestionSummaries: summaries.slice(0, count),
    transcriptStored: false,
    aiCalls: 1,
    retryCount: 0,
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 10,
    elapsedMs: 1_000,
  };
}

function createDatabase(): {
  sqlite: DatabaseSync;
  adapter: SqliteD1Adapter;
} {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE api_rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE quiz_banks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      language TEXT NOT NULL,
      session_length TEXT NOT NULL,
      primer TEXT NOT NULL,
      concepts_json TEXT NOT NULL,
      watched INTEGER NOT NULL,
      pipeline_version INTEGER NOT NULL,
      quality_status TEXT NOT NULL,
      quality_summary_json TEXT NOT NULL,
      import_key TEXT,
      created_at INTEGER NOT NULL,
      origin TEXT NOT NULL DEFAULT 'quest',
      affects_mastery INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      source_question_id TEXT NOT NULL,
      type TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      reformulated_prompt TEXT NOT NULL,
      options_json TEXT,
      items_json TEXT,
      correct_answer_json TEXT,
      rubric_json TEXT,
      explanation TEXT NOT NULL,
      evidence_segment_ids_json TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      generation_metadata_json TEXT,
      UNIQUE(quiz_id, ordinal)
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quiz_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      current_index INTEGER NOT NULL,
      current_variant INTEGER NOT NULL,
      retry_pending INTEGER NOT NULL,
      target_difficulty REAL NOT NULL,
      correct_count INTEGER NOT NULL,
      total_answered INTEGER NOT NULL,
      item_count INTEGER NOT NULL,
      score REAL,
      grading_token TEXT,
      grading_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE TABLE attempt_items (
      attempt_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      PRIMARY KEY(attempt_id, ordinal)
    );
    CREATE TABLE answers (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      feedback TEXT NOT NULL,
      variant_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE mastery (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      state TEXT NOT NULL,
      best_score REAL,
      initial_passed_at INTEGER,
      review_passed_at INTEGER,
      next_review_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, video_id)
    );
    CREATE TABLE quiz_generation_call_events (
      quiz_id TEXT NOT NULL,
      generation_session_id TEXT NOT NULL,
      call_index INTEGER NOT NULL,
      start_ordinal INTEGER NOT NULL,
      requested_count INTEGER NOT NULL,
      accepted_count INTEGER NOT NULL,
      classification TEXT NOT NULL,
      outcome_code TEXT NOT NULL,
      retry_delay_ms INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      reasoning_tokens INTEGER,
      usage_complete INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      protocol_version INTEGER,
      retry_kind TEXT,
      ordinal_attempt INTEGER,
      recovery_session_id TEXT,
      purpose TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'completed',
      dispatched_at INTEGER,
      completed_at INTEGER,
      last_stream_activity_at INTEGER,
      PRIMARY KEY (quiz_id, generation_session_id, call_index)
    );
    CREATE TABLE quiz_generation_claims (
      quiz_id TEXT PRIMARY KEY,
      generation_session_id TEXT NOT NULL,
      claim_key TEXT NOT NULL,
      lease_expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      recovery_session_id TEXT,
      heartbeat_at INTEGER
    );
  `);
  sqlite
    .prepare(
      "INSERT INTO quiz_banks VALUES (?, ?, ?, 'en', 'short', 'Primer', '[]', 1, 9, 'generating', ?, 'import-1', ?, 'quest', 1)",
    )
    .run(QUIZ_ID, USER_ID, VIDEO_ID, JSON.stringify(progressiveSummary(1)), 1);
  sqlite
    .prepare(
      `INSERT INTO questions VALUES
       (?, ?, 0, 'q1', 'multiple_choice', 'q1', ?, ?, ?, NULL, '0', NULL, ?, '[]', 1, '{}')`,
    )
    .run(
      QUESTION_ONE_ID,
      QUIZ_ID,
      "Which value is the limit?",
      "Which value is the limit?",
      JSON.stringify(["4", "3", "2", "1"]),
      "The limit is 4.",
    );
  sqlite
    .prepare(
      `INSERT INTO attempts VALUES
       (?, ?, ?, 'learn', 'active', 0, 0, 0, 2, 0, 0, 5, NULL, NULL, NULL, 1, 1, NULL)`,
    )
    .run(ATTEMPT_ID, USER_ID, QUIZ_ID);
  sqlite
    .prepare("INSERT INTO attempt_items VALUES (?, 0, ?)")
    .run(ATTEMPT_ID, QUESTION_ONE_ID);
  sqlite
    .prepare(
      "INSERT INTO mastery VALUES (?, ?, 'basic', NULL, NULL, NULL, NULL, 1)",
    )
    .run(USER_ID, VIDEO_ID);
  return { sqlite, adapter: new SqliteD1Adapter(sqlite) };
}

function appendQuestionTwo(sqlite: DatabaseSync, updateSummary: boolean): void {
  sqlite.exec("BEGIN");
  try {
    sqlite
      .prepare(
        `INSERT INTO questions VALUES
         (?, ?, 1, 'q2', 'true_false', 'q2', ?, ?, NULL, NULL, 'true', NULL, ?, '[]', 1, '{}')`,
      )
      .run(
        QUESTION_TWO_ID,
        QUIZ_ID,
        "A continuous function has no jump at this point.",
        "A continuous function has no jump at this point.",
        "This is the definition used by the lesson.",
      );
    if (updateSummary) {
      sqlite
        .prepare("UPDATE quiz_banks SET quality_summary_json = ? WHERE id = ?")
        .run(JSON.stringify(progressiveSummary(2)), QUIZ_ID);
    }
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

function testApp(adapter: SqliteD1Adapter): Hono<ApiBindings> {
  const app = new Hono<ApiBindings>();
  app.use("*", async (context, next) => {
    context.set("user", {
      id: USER_ID,
      email: "qa@example.com",
      name: "QA Learner",
      username: null,
      role: "user",
      banned: false,
    });
    await next();
  });
  app.route("/", quizzesRouter);
  app.onError((error, context) => errorResponse(error, context));
  return app;
}

describe("progressive answer and append consistency", () => {
  it("stores and advances an answer exactly once when an append commits before the snapshot", async () => {
    const { sqlite, adapter } = createDatabase();
    let appended = false;
    adapter.beforeFirst = (sql) => {
      if (!appended && sql.includes("stored_question.quiz_id = qb.id")) {
        appended = true;
        appendQuestionTwo(sqlite, true);
      }
    };

    const response = await testApp(adapter).request(
      `/attempts/${ATTEMPT_ID}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: QUESTION_ONE_ID, answer: 0 }),
      },
      { DB: adapter } as unknown as ApiBindings["Bindings"],
    );
    const body = (await response.json()) as {
      completed: boolean;
      nextQuestion: { id: string } | null;
      generation: { availableQuestions: number; totalQuestions: number };
    };

    expect(response.status).toBe(200);
    expect(body.completed).toBe(false);
    expect(body.nextQuestion?.id).toBe(QUESTION_TWO_ID);
    expect(body.generation).toMatchObject({
      availableQuestions: 2,
      totalQuestions: 5,
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM answers").get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare(
          "SELECT current_index, grading_token, grading_expires_at FROM attempts WHERE id = ?",
        )
        .get(ATTEMPT_ID),
    ).toEqual({
      current_index: 1,
      grading_token: null,
      grading_expires_at: null,
    });
    expect(
      sqlite
        .prepare(
          "SELECT question_id FROM attempt_items WHERE attempt_id = ? AND ordinal = 1",
        )
        .get(ATTEMPT_ID),
    ).toEqual({ question_id: QUESTION_TWO_ID });
  });

  it("fails before writing and releases the reservation on genuine count corruption", async () => {
    const { sqlite, adapter } = createDatabase();
    let corrupted = false;
    adapter.beforeFirst = (sql) => {
      if (!corrupted && sql.includes("stored_question.quiz_id = qb.id")) {
        corrupted = true;
        appendQuestionTwo(sqlite, false);
      }
    };

    const response = await testApp(adapter).request(
      `/attempts/${ATTEMPT_ID}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId: QUESTION_ONE_ID, answer: 0 }),
      },
      { DB: adapter } as unknown as ApiBindings["Bindings"],
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "quiz_generation_state_conflict" },
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM answers").get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT current_index, grading_token, grading_expires_at FROM attempts WHERE id = ?",
        )
        .get(ATTEMPT_ID),
    ).toEqual({
      current_index: 0,
      grading_token: null,
      grading_expires_at: null,
    });
  });
});
