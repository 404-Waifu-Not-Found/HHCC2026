import { DatabaseSync, type StatementSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/lib/errors";
import type { ApiBindings } from "../src/middleware/authenticated";
import { quizzesRouter } from "../src/routes/quizzes";

// ---------------------------------------------------------------------------
// Server-side mastery guardrail for Workplace practice attempts.
//
// Workplace practice imports stamp `affects_mastery` onto the quiz bank: 1 only
// for a completed single-video diagnostic, 0 for practice-only or multi-video
// sets. These tests drive a real attempt to completion through the standard
// `/api/quizzes` grading flow and assert that mastery only moves when the bank
// is mastery-eligible -- and that the completion response never leaks a mastery
// figure for a practice-only attempt.
// ---------------------------------------------------------------------------

const USER_ID = "user-1";
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const QUIZ_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const QUESTION_IDS = [
  "55555555-5555-4555-8555-555555555501",
  "55555555-5555-4555-8555-555555555502",
  "55555555-5555-4555-8555-555555555503",
  "55555555-5555-4555-8555-555555555504",
  "55555555-5555-4555-8555-555555555505",
];

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

function createDatabase(affectsMastery: 0 | 1): {
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
      origin TEXT NOT NULL DEFAULT 'quest',
      affects_mastery INTEGER NOT NULL DEFAULT 1,
      workplace_thread_id TEXT,
      assessment_rationale TEXT,
      created_at INTEGER NOT NULL
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
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      attempt_id TEXT,
      score REAL,
      scheduled_for INTEGER,
      completed_at INTEGER
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
  // A "passed" 5-question Workplace quiz. An empty progressive summary makes
  // attemptGenerationState treat it as fully ready.
  sqlite
    .prepare(
      "INSERT INTO quiz_banks (id, user_id, video_id, language, session_length, primer, concepts_json, watched, pipeline_version, quality_status, quality_summary_json, import_key, origin, affects_mastery, workplace_thread_id, assessment_rationale, created_at) VALUES (?, ?, ?, 'en', 'short', 'Primer', '[]', 1, 9, 'passed', '{}', 'wp-import-1', 'workplace', ?, '77777777-7777-4777-8777-777777777777', 'Because…', 1)",
    )
    .run(QUIZ_ID, USER_ID, VIDEO_ID, affectsMastery);
  const insertQuestion = sqlite.prepare(
    `INSERT INTO questions VALUES
     (?, ?, ?, ?, 'multiple_choice', 'q', ?, ?, ?, NULL, '0', NULL, ?, '[]', 1, '{}')`,
  );
  const insertAttemptItem = sqlite.prepare(
    "INSERT INTO attempt_items VALUES (?, ?, ?)",
  );
  QUESTION_IDS.forEach((questionId, index) => {
    insertQuestion.run(
      questionId,
      QUIZ_ID,
      index,
      `q${index + 1}`,
      `Which value is the limit? (${index + 1})`,
      `Which value is the limit? (${index + 1})`,
      JSON.stringify(["4", "3", "2", "1"]),
      "The limit is 4.",
    );
    insertAttemptItem.run(ATTEMPT_ID, index, questionId);
  });
  sqlite
    .prepare(
      `INSERT INTO attempts VALUES
       (?, ?, ?, 'learn', 'active', 0, 0, 0, 2, 0, 0, 5, NULL, NULL, NULL, 1, 1, NULL)`,
    )
    .run(ATTEMPT_ID, USER_ID, QUIZ_ID);
  sqlite
    .prepare(
      "INSERT INTO mastery VALUES (?, ?, 'not_started', NULL, NULL, NULL, NULL, 1)",
    )
    .run(USER_ID, VIDEO_ID);
  return { sqlite, adapter: new SqliteD1Adapter(sqlite) };
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

async function completeAttempt(adapter: SqliteD1Adapter, answer: number) {
  const app = testApp(adapter);
  let response!: Response;
  for (const questionId of QUESTION_IDS) {
    response = await app.request(
      `/attempts/${ATTEMPT_ID}/answer`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, answer }),
      },
      { DB: adapter } as unknown as ApiBindings["Bindings"],
    );
    if (response.status !== 200) break;
  }
  return response;
}

describe("Workplace practice mastery guardrail", () => {
  it("updates mastery when the quiz bank is a mastery-eligible diagnostic", async () => {
    const { sqlite, adapter } = createDatabase(1);
    const response = await completeAttempt(adapter, 0);
    const body = (await response.json()) as {
      completed: boolean;
      score: number;
      mastery: string | null;
    };
    expect(response.status).toBe(200);
    expect(body.completed).toBe(true);
    expect(body.score).toBe(100);
    expect(body.mastery).toBe("mastered");

    const mastery = sqlite
      .prepare("SELECT state, best_score FROM mastery WHERE user_id = ?")
      .get(USER_ID) as { state: string; best_score: number | null };
    expect(mastery.state).toBe("mastered");
    expect(mastery.best_score).toBe(100);
  });

  it("never moves mastery for a practice-only import, and hides mastery in the response", async () => {
    const { sqlite, adapter } = createDatabase(0);
    const response = await completeAttempt(adapter, 0);
    const body = (await response.json()) as {
      completed: boolean;
      score: number;
      mastery: string | null;
    };
    expect(response.status).toBe(200);
    expect(body.completed).toBe(true);
    expect(body.score).toBe(100);
    // No mastery figure is leaked for a practice-only attempt.
    expect(body.mastery).toBeNull();

    const mastery = sqlite
      .prepare("SELECT state, best_score FROM mastery WHERE user_id = ?")
      .get(USER_ID) as { state: string; best_score: number | null };
    expect(mastery.state).toBe("not_started");
    expect(mastery.best_score).toBeNull();
  });
});
